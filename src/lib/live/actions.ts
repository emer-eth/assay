import "server-only";
import { mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { coordinator, createAgentAccount, sendNear } from "../near";
import { activeRound, createRound } from "./coordinator";
import { addCredit, spendCredit } from "./credit";
import { claimDeposit } from "./deposit";
import { LIMITS } from "./guard";
import { load, update, type LiveAgent } from "./store";

// The two things that cost money, shared by the website (paid from a wallet) and MCP (paid from credit),
// so both follow exactly the same rules.

const SKILL = z.enum(["writing", "research", "code", "data", "design", "translation"]);
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
});

export type Payment = { via: "wallet"; txHash: string } | { via: "credit" };
type Fail = { ok: false; status: number; error: string };

async function take(account: string, near: number, payment: Payment, purpose: string): Promise<Fail | null> {
  if (payment.via === "credit")
    return spendCredit(account, near) ? null : { ok: false, status: 402, error: `Not enough credit for ${near} NEAR. Top up on the website.` };
  const paid = await claimDeposit(payment.txHash, account, near, purpose);
  return paid.ok ? null : { ok: false, status: 402, error: paid.error };
}

/** Takes payment and creates the round. The caller starts it (runLiveRound) in the background. */
export async function postJob(account: string, job: z.infer<typeof jobInput>, payment: Payment): Promise<{ ok: true; id: string } | Fail> {
  // Check before taking money: a wallet payment that's refused here stays unclaimed and can be retried.
  if (activeRound()) return { ok: false, status: 409, error: "A round is already running. Try again when it finishes." };
  const failed = await take(account, job.budget, payment, "job");
  if (failed) return failed;
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
      const a: LiveAgent = { id: created.accountId, name: input.name, backer: account, prompt: input.prompt, skills: input.skills, balance: input.funding, costPerJob: 0.01, quality: 0.5, joinedAt: s.agents.length, funding: input.funding, earned: 0 };
      // load() may already have adopted the key file written above as a generic agent: replace it, never duplicate.
      s.agents = s.agents.filter((x) => x.id !== a.id);
      s.agents.push(a);
      return a;
    });
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
