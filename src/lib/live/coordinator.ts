import "server-only";
import { randomUUID } from "node:crypto";
import { gradeDelivery, reviewJob } from "../near-ai";
import { agentAccount, availableNear, coordinator, ensureEscrowAgent, escrowJob, escrowRefund, escrowSettle, sendNear } from "../near";
import { decide, eligibleAgents, settle } from "../swarm/round";
import type { Job } from "../swarm/types";
import type { Payment } from "./actions";
import { agentBid, agentWork, modelOf, usageToNear } from "./agent-ai";
import { gatherEvidence } from "./tools";
import { addCredit } from "./credit";
import { load, update, updateRound, type LiveRound } from "./store";

// Runs one live round, following RULES.md step by step. Every step is written to the store as it
// happens, so the page can show progress. One round at a time (nonces and budgets stay simple).

export const ACTIVE: LiveRound["status"][] = ["reviewing", "bidding", "working", "grading", "settling"];

export function activeRound() {
  return load().rounds.find((r) => ACTIVE.includes(r.status)) ?? null;
}

export function createRound(job: Omit<Job, "id" | "poster">, poster: string, payment: Payment) {
  const deposit = payment.via === "wallet" ? payment.txHash : payment.via === "escrow" ? payment.txHash : undefined;
  const id = randomUUID().slice(0, 8);
  const round: LiveRound = {
    id,
    createdAt: new Date().toISOString(),
    job: { ...job, id: `job-${id}`, poster },
    status: "reviewing",
    steps: [
      {
        at: new Date().toISOString(),
        text:
          payment.via === "escrow"
            ? `${poster} posted the job; ${job.budget} NEAR is held by the escrow contract (job ${payment.jobId})`
            : deposit
              ? `${poster} posted the job and paid ${job.budget} NEAR into escrow`
              : `${poster} posted the job through the API, paying ${job.budget} NEAR from prepaid credit`,
      },
    ],
    eligible: [],
    bids: [],
    txs: [],
    deposit,
    paidWith: payment.via,
    escrowJobId: payment.via === "escrow" ? payment.jobId : undefined,
  };
  update((s) => s.rounds.unshift(round));
  return round;
}

/** Gives the poster's money back the way it came: a real transfer to their wallet, or back into their credit. */
async function refund(id: string, poster: string, near: number, why: string) {
  const r = load().rounds.find((x) => x.id === id);
  if (!r || near <= 0) return;
  if (r.paidWith === "credit") {
    addCredit(poster, near);
    updateRound(id, {}, `Returned ${near} NEAR to ${poster}'s credit (${why})`);
    return;
  }
  if (r.paidWith === "escrow" && r.escrowJobId) {
    // The contract refunds the whole budget itself (only while the job is still open there).
    const onChain = await escrowJob(r.escrowJobId);
    if (onChain?.status !== "Open") return;
    const hash = await escrowRefund(r.escrowJobId);
    updateRound(id, (x) => x.txs.push({ label: `Escrow contract refunded ${r.job.budget} NEAR to ${poster} (${why})`, hash }));
    return;
  }
  if (!r.deposit) return; // early demo rounds funded by the coordinator
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

    // 1b. Tools read the real target (the account on chain, or the repo), so agents price and work from facts
    const evidence = await gatherEvidence(job);
    if (evidence) updateRound(id, { evidence }, `Tools: ${evidence.summary.join("; ")}`);
    // The least the work can cost each agent in AI, on its own model: reading the evidence plus writing the report.
    const estimate = { prompt: Math.ceil((evidence?.facts.length ?? 0) / 3.5) + 800, completion: 2500 };

    // 2. Eligibility from real on-chain balances
    const agents = await Promise.all(
      load().agents.map(async (a) => ({ ...a, balance: await availableNear(a.id).catch(() => 0) })),
    );
    update((s) => s.agents.forEach((a) => (a.balance = agents.find((x) => x.id === a.id)?.balance ?? a.balance)));
    const eligible = eligibleAgents(job, agents);
    updateRound(id, { eligible: eligible.map((a) => a.id) }, `${eligible.length} of ${agents.length} agents can bid (right skills and enough NEAR for their AI)`);

    // 3. Sealed bids: collected in parallel, revealed together once all are in
    // An agent can't bid below its own AI cost for the job (RULES.md): lower asks are raised to that floor.
    const floor = new Map(eligible.map((a) => [a.id, Math.max(a.costPerJob, usageToNear(estimate, modelOf(a)))]));
    const raw = await Promise.all(eligible.map(async (a) => [a.id, await agentBid(a, job, evidence, floor.get(a.id)!)] as const));
    const asks = new Map(raw.filter(([, b]) => b).map(([id, b]) => [id, Math.max(b!.ask, floor.get(id) ?? 0)]));
    const pitches = new Map(raw.filter(([, b]) => b).map(([id, b]) => [id, b!.pitch]));
    const bidUsage = new Map(raw.filter(([, b]) => b).map(([id, b]) => [id, b!.usage]));
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
    const work = await agentWork(winner, job, evidence);
    const bidU = bidUsage.get(winner.id) ?? { prompt: 0, completion: 0 };
    const tokens = work.usage.prompt + work.usage.completion + bidU.prompt + bidU.completion;
    const aiCost = usageToNear({ prompt: work.usage.prompt + bidU.prompt, completion: work.usage.completion + bidU.completion }, modelOf(winner));
    updateRound(id, { deliverable: work.text, tokens }, `${winner.name} delivered (${tokens} AI tokens)`);
    if (aiCost > 0) {
      const hash = await sendNear(agentAccount(winner.id), process.env.NEAR_ACCOUNT_ID!, aiCost);
      updateRound(id, (r) => r.txs.push({ label: `${winner.name} paid ${aiCost} NEAR for its own AI`, hash }));
    }

    // 5. Delivery review
    updateRound(id, { status: "grading" }, "Reviewer is grading the work");
    const grade = await gradeDelivery(job.description, work.text, evidence?.facts);

    // 6. Settlement
    updateRound(id, { grade, status: "settling" }, grade.passed ? "Work passed review" : `Work failed review: ${grade.reasons.join("; ")}`);
    const s = settle(job, winner, decision.winner.ask, { passed: grade.passed, aiCost });
    const escrowJobId = load().rounds.find((r) => r.id === id)?.escrowJobId;
    if (escrowJobId && grade.passed) {
      // One contract call pays the agent and the fee and refunds the rest of the budget to the poster.
      await ensureEscrowAgent(winner.id);
      const hash = await escrowSettle(escrowJobId, winner.id, s.payout.toAgent, s.payout.fee);
      paidOut = job.budget;
      updateRound(id, (r) =>
        r.txs.push({ label: `Escrow contract paid ${winner.name} ${s.payout.toAgent} NEAR, fee ${s.payout.fee}, and refunded ${s.payout.refundToPoster} NEAR to ${job.poster}`, hash }),
      );
    } else if (escrowJobId) {
      await refund(id, job.poster, job.budget, "work failed review");
      paidOut = job.budget;
    } else if (grade.passed && s.payout.toAgent > 0) {
      const hash = await sendNear(coordinator(), winner.id, s.payout.toAgent);
      paidOut += s.payout.toAgent + s.payout.fee;
      updateRound(id, (r) => r.txs.push({ label: `Coordinator paid ${winner.name} ${s.payout.toAgent} NEAR`, hash }));
    }
    if (!escrowJobId) await refund(id, job.poster, s.payout.refundToPoster, grade.passed ? "unused budget" : "work failed review");
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
