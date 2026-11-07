import "server-only";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { nearToYocto } from "near-api-js";
import { coordinator, createAgentAccount, ensureEscrowAgent, escrowId, escrowJob, sendNear } from "../near";
import { activeRound, createRound } from "./coordinator";
import { addCredit, spendCredit } from "./credit";
import { claimDeposit } from "./deposit";
import { LIMITS } from "./guard";
import { targetProblem } from "./tools";
import { AGENT_MODELS, type AgentModel } from "../models";
import { SKILLS } from "../swarm/types";
import { load, update, type LiveAgent } from "./store";

// The two things that cost money, shared by the website (paid from a wallet) and MCP (paid from credit),
// so both follow exactly the same rules.

const SKILL = z.enum(SKILLS);
export const jobInput = z.object({
  description: z.string().trim().min(10).max(2000),
  skills: z.array(SKILL).min(1),
  budget: z.coerce.number().min(0.05).max(LIMITS.maxBudget),
});
export const agentInput = z.object({
  name: z.string().trim().min(2).max(40),
  prompt: z.string().trim().min(10).max(2000),
  skills: z.array(SKILL).min(1),
  funding: z.coerce.number().min(0.1).max(LIMITS.maxFunding),
  model: z.enum(Object.keys(AGENT_MODELS) as [AgentModel, ...AgentModel[]]).optional(),
});

export type Payment = { via: "wallet"; txHash: string } | { via: "credit" } | { via: "escrow"; jobId: string; txHash?: string };
type Fail = { ok: false; status: number; error: string };

/** Checks the escrow contract's own record: open, deposited by this account, for exactly this budget. Then claims it once. */
async function takeEscrow(account: string, near: number, jobId: string): Promise<Fail | null> {
  let onChain;
  for (let i = 0; i < 4 && !onChain; i++) {
    onChain = await escrowJob(jobId).catch(() => null);
    if (!onChain) await new Promise((r) => setTimeout(r, 1500)); // a fresh deposit can take a moment to be visible
  }
  if (!onChain) return { ok: false, status: 402, error: "The escrow contract has no deposit for this job yet. Wait a few seconds and try again." };
  if (onChain.poster !== account) return { ok: false, status: 402, error: "That deposit was made by a different account." };
  if (onChain.status !== "Open") return { ok: false, status: 409, error: "That deposit has already been used." };
  if (BigInt(onChain.budget) !== nearToYocto(Number(near.toFixed(6)))) return { ok: false, status: 402, error: "The deposit doesn't match the job's budget." };
  const claimed = update((s) => {
    const key = `escrow:${jobId}`;
    if (s.deposits.some((d) => d.txHash === key)) return false;
    s.deposits.push({ txHash: key, from: account, near, purpose: "job (escrow contract)", at: new Date().toISOString() });
    return true;
  });
  return claimed ? null : { ok: false, status: 409, error: "That deposit has already been used." };
}

async function take(account: string, near: number, payment: Payment, purpose: string): Promise<Fail | null> {
  if (payment.via === "escrow") return takeEscrow(account, near, payment.jobId);
  if (payment.via === "credit")
    return spendCredit(account, near) ? null : { ok: false, status: 402, error: `Not enough credit for ${near} NEAR. Top up on the website.` };
  const paid = await claimDeposit(payment.txHash, account, near, purpose);
  return paid.ok ? null : { ok: false, status: 402, error: paid.error };
}

/**
 * Step 1 of a wallet-paid job: reserve a job id. The wallet then calls post_job(job_id) on the escrow contract
 * with the budget attached, and step 2 (postJob with { via: "escrow", jobId }) confirms it from the contract.
 */
export async function prepareJob(account: string, job: z.infer<typeof jobInput>): Promise<{ ok: true; jobId: string; contractId: string } | Fail> {
  if (activeRound()) return { ok: false, status: 409, error: "A round is already running. Try again when it finishes." };
  const problem = await targetProblem(job); // before any money moves: the job must name a real account or repo
  if (problem) return { ok: false, status: 400, error: problem };
  const jobId = `sfh-${randomUUID().slice(0, 13)}`;
  update((s) => {
    for (const [k, d] of Object.entries(s.drafts)) if (d.expires < Date.now()) delete s.drafts[k];
    s.drafts[jobId] = { account, job, expires: Date.now() + 30 * 60_000 };
  });
  return { ok: true, jobId, contractId: escrowId() };
}

/** Takes payment and creates the round. The caller starts it (runLiveRound) in the background. */
export async function postJob(account: string, job: z.infer<typeof jobInput>, payment: Payment): Promise<{ ok: true; id: string } | Fail> {
  // Check before taking money: a wallet payment that's refused here stays unclaimed and can be retried.
  if (activeRound()) return { ok: false, status: 409, error: "A round is already running. Try again when it finishes." };
  // For escrow deposits, the job is the one reserved in step 1, not whatever the request says now.
  if (payment.via === "escrow") {
    const draft = load().drafts[payment.jobId];
    if (!draft || draft.account !== account) return { ok: false, status: 404, error: "Unknown job id. Start again from the form." };
    job = draft.job;
  } else {
    const problem = await targetProblem(job);
    if (problem) return { ok: false, status: 400, error: problem };
  }
  const failed = await take(account, job.budget, payment, "job");
  if (failed) return failed;
  if (payment.via === "escrow") update((s) => void delete s.drafts[payment.jobId]);
  const round = createRound(job, account, payment);
  return { ok: true, id: round.id };
}

/** Takes payment, creates the agent's own testnet account funded with it, and registers the agent. */
export async function backAgent(account: string, input: z.infer<typeof agentInput>, payment: Payment): Promise<{ ok: true; agent: LiveAgent } | Fail> {
  const { agents } = load();
  if (agents.length >= LIMITS.maxAgents) return { ok: false, status: 409, error: `The swarm is full (${LIMITS.maxAgents} agents).` };
  const failed = await take(account, input.funding, payment, "agent funding");
  if (failed) return failed;
  const n = Math.max(0, ...agents.map((a) => Number(a.id.match(/^agent-(\d+)\./)?.[1] || 0))) + 1;
  try {
    const created = await createAgentAccount(n, input.funding);
    mkdirSync(".keys", { recursive: true });
    writeFileSync(`.keys/${created.accountId}.json`, JSON.stringify(created, null, 2), { mode: 0o600 });
    const agent = update((s) => {
      const a: LiveAgent = { id: created.accountId, name: input.name, backer: account, prompt: input.prompt, skills: input.skills, model: input.model, balance: input.funding, costPerJob: 0.01, quality: 0.5, joinedAt: s.agents.length, funding: input.funding, earned: 0 };
      // load() may already have adopted the key file written above as a generic agent: replace it, never duplicate.
      s.agents = s.agents.filter((x) => x.id !== a.id);
      s.agents.push(a);
      return a;
    });
    // Let the escrow contract pay this agent (settle also ensures it, so a failure here isn't fatal).
    await ensureEscrowAgent(agent.id).catch(() => null);
    return { ok: true, agent };
  } catch (e) {
    // Already paid: give it back the way it came.
    let back = true;
    if (payment.via === "credit") addCredit(account, input.funding);
    else back = await sendNear(coordinator(), account, input.funding).then(() => true, () => false);
    const where = payment.via === "credit" ? "returned to your credit" : "sent back to your wallet";
    return { ok: false, status: 502, error: `Couldn't create the agent account (${e instanceof Error ? e.message : e}). ${back ? `Your ${input.funding} NEAR was ${where}.` : `Your ${input.funding} NEAR couldn't be sent back automatically; it's owed to you.`}` };
  }
}
