import "server-only";
import { randomUUID } from "node:crypto";
import { gradeDelivery, reviewJob } from "../near-ai";
import { agentAccount, availableNear, coordinator, sendNear } from "../near";
import { decide, eligibleAgents, settle } from "../swarm/round";
import type { Job } from "../swarm/types";
import { agentBid, agentWork, tokensToNear } from "./agent-ai";
import { load, update, updateRound, type LiveRound } from "./store";

// Runs one live round, following RULES.md step by step. Every step is written to the store as it
// happens, so the page can show progress. One round at a time (nonces and budgets stay simple).

export const ACTIVE: LiveRound["status"][] = ["reviewing", "bidding", "working", "grading", "settling"];

export function activeRound() {
  return load().rounds.find((r) => ACTIVE.includes(r.status)) ?? null;
}

export function createRound(job: Omit<Job, "id" | "poster">, poster: string, deposit?: string) {
  const id = randomUUID().slice(0, 8);
  const round: LiveRound = {
    id,
    createdAt: new Date().toISOString(),
    job: { ...job, id: `job-${id}`, poster },
    status: "reviewing",
    steps: [{ at: new Date().toISOString(), text: deposit ? `${poster} posted the job and paid ${job.budget} NEAR into escrow` : `${poster} posted the job with a ${job.budget} NEAR budget (held in escrow by the coordinator)` }],
    eligible: [],
    bids: [],
    txs: [],
    deposit,
  };
  update((s) => s.rounds.unshift(round));
  return round;
}

/** Sends the poster's money back from escrow as a real transfer (only for rounds they paid for from their wallet). */
async function refund(id: string, poster: string, near: number, why: string) {
  const r = load().rounds.find((x) => x.id === id);
  if (!r?.deposit || near <= 0) return;
  const hash = await sendNear(coordinator(), poster, near);
  updateRound(id, (x) => x.txs.push({ label: `Refunded ${near} NEAR to ${poster} (${why})`, hash }));
}

export async function runLiveRound(id: string) {
  const round = load().rounds.find((r) => r.id === id);
  if (!round) return;
  const { job } = round;
  let paidOut = 0; // NEAR already paid out of this job's escrow, so a crash never refunds more than is left
  try {

    // 1. Review gate
    const review = await reviewJob(job.description);
    if (!review.allowed) {
      updateRound(id, { review, status: "blocked", payout: { toAgent: 0, toBacker: 0, fee: 0, refundToPoster: job.budget, aiCost: 0 } }, `Blocked by the reviewer: ${review.reasons.join("; ")}. Poster refunded ${job.budget} NEAR.`);
      await refund(id, job.poster, job.budget, "job blocked");
      return;
    }
    updateRound(id, { review, status: "bidding" }, "Reviewer approved the job");

    // 2. Eligibility from real on-chain balances
    const agents = await Promise.all(
      load().agents.map(async (a) => ({ ...a, balance: await availableNear(a.id).catch(() => 0) })),
    );
    update((s) => s.agents.forEach((a) => (a.balance = agents.find((x) => x.id === a.id)?.balance ?? a.balance)));
    const eligible = eligibleAgents(job, agents);
    updateRound(id, { eligible: eligible.map((a) => a.id) }, `${eligible.length} of ${agents.length} agents can bid (right skills and enough NEAR for their AI)`);

    // 3. Sealed bids: collected in parallel, revealed together once all are in
    const raw = await Promise.all(eligible.map(async (a) => [a.id, await agentBid(a, job)] as const));
    const asks = new Map(raw.filter(([, b]) => b).map(([id, b]) => [id, b!.ask]));
    const pitches = new Map(raw.filter(([, b]) => b).map(([id, b]) => [id, b!.pitch]));
    const bidTokens = new Map(raw.filter(([, b]) => b).map(([id, b]) => [id, b!.tokens]));
    const decision = decide(job, agents, asks);
    const bids = decision.bids.map((b) => ({ ...b, pitch: pitches.get(b.agent) }));
    if (!decision.winner) {
      updateRound(id, { bids, status: "unfilled", payout: { toAgent: 0, toBacker: 0, fee: 0, refundToPoster: job.budget, aiCost: 0 } }, `No valid bids. Poster refunded ${job.budget} NEAR.`);
      await refund(id, job.poster, job.budget, "no bids");
      return;
    }
    const winner = agents.find((a) => a.id === decision.winner!.agent)!;
    updateRound(id, { bids, winner: winner.id, status: "working" }, `Bids revealed. ${winner.name} wins at ${decision.winner.ask} NEAR (best reputation² ÷ price)`);

    // 4. Work, paid for from the agent's own account
    const work = await agentWork(winner, job);
    const tokens = work.tokens + (bidTokens.get(winner.id) ?? 0);
    const aiCost = tokensToNear(tokens);
    updateRound(id, { deliverable: work.text, tokens }, `${winner.name} delivered (${tokens} AI tokens)`);
    if (aiCost > 0) {
      const hash = await sendNear(agentAccount(winner.id), process.env.NEAR_ACCOUNT_ID!, aiCost);
      updateRound(id, (r) => r.txs.push({ label: `${winner.name} paid ${aiCost} NEAR for its own AI`, hash }));
    }

    // 5. Delivery review
    updateRound(id, { status: "grading" }, "Reviewer is grading the work");
    const grade = await gradeDelivery(job.description, work.text);

    // 6. Settlement
    updateRound(id, { grade, status: "settling" }, grade.passed ? "Work passed review" : `Work failed review: ${grade.reasons.join("; ")}`);
    const s = settle(job, winner, decision.winner.ask, { passed: grade.passed, aiCost });
    if (grade.passed && s.payout.toAgent > 0) {
      const hash = await sendNear(coordinator(), winner.id, s.payout.toAgent);
      paidOut += s.payout.toAgent + s.payout.fee;
      updateRound(id, (r) => r.txs.push({ label: `Coordinator paid ${winner.name} ${s.payout.toAgent} NEAR`, hash }));
    }
    await refund(id, job.poster, s.payout.refundToPoster, grade.passed ? "unused budget" : "work failed review");
    paidOut = job.budget;
    update((st) => {
      const a = st.agents.find((x) => x.id === winner.id);
      if (a) {
        a.quality = s.quality;
        a.earned = Math.round((a.earned + s.payout.toBacker) * 1e6) / 1e6;
      }
    });
    updateRound(
      id,
      { status: "done", payout: { ...s.payout, aiCost } }, // the exact amount the agent sent on chain
      grade.passed
        ? `Settled: ${s.payout.toAgent} NEAR to ${winner.name} (backer profit ${s.payout.toBacker}, fee ${s.payout.fee}); ${s.payout.refundToPoster} NEAR refunded to the poster. Reputation now ${s.quality}.`
        : `Settled: poster refunded ${s.payout.refundToPoster} NEAR; ${winner.name} paid its own AI cost and earned nothing. Reputation now ${s.quality}.`,
    );
  } catch (e) {
    updateRound(id, { status: "error", error: e instanceof Error ? e.message : String(e) }, "Something went wrong. Nothing further was paid.");
    const left = Math.round((job.budget - paidOut) * 1e6) / 1e6;
    await refund(id, job.poster, left, "round failed").catch((err) =>
      updateRound(id, {}, `The refund of ${left} NEAR couldn't be sent automatically (${err instanceof Error ? err.message : err}). It's owed to ${job.poster}.`),
    );
  }
}
