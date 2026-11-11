import "server-only";
import { randomUUID } from "node:crypto";
import { gradeDelivery, reviewJob, ruleChallenge } from "../near-ai";
import { agentAccount, availableNear, coordinator, ensureEscrowAgent, escrowJob, escrowRefund, escrowSettle, sendNear, unwrapNear, wnearBalance, escrowPost } from "../near";
import { challengeQuality, decide, eligibleAgents, jobQuality, MAX_CHALLENGERS, settle } from "../swarm/round";
import type { Job } from "../swarm/types";
import type { Payment } from "./actions";
import { agentBid, agentChallenge, agentWork, modelOf, usageToNear } from "./agent-ai";
import { gatherEvidence } from "./tools";
import { addCredit } from "./credit";
import { recoverClaimedIntents, settleThroughIntents } from "./intents-jobs";
import { refundThroughIntents } from "./intents-pay";
import { yoctoOf } from "./pay-assets";
import { load, update, updateRound, type Challenge, type LiveRound } from "./store";

// Runs one live round, following RULES.md step by step. Every step is written to the store as it
// happens, so the page can show progress. Rounds run one at a time through a queue, so the coordinator never
// signs two transactions at once; anyone can post while another round runs, and theirs starts next.

import { ACTIVE } from "./status";
export { ACTIVE };

export function createRound(job: Omit<Job, "id" | "poster">, poster: string, payment: Payment) {
  const deposit = payment.via === "wallet" ? payment.txHash : payment.via === "escrow" ? payment.txHash : undefined;
  const id = randomUUID().slice(0, 8);
  const round: LiveRound = {
    id,
    createdAt: new Date().toISOString(),
    job: { ...job, id: `job-${id}`, poster },
    status: "queued",
    steps: [
      {
        at: new Date().toISOString(),
        text:
          payment.via === "intents"
            ? `${poster} paid ${job.budget} NEAR with a signed NEAR Intents transfer to the coordinator (job ${payment.jobId})${payment.tx ? "" : "; the reply to that transaction was lost, so the payment was confirmed from the verifier contract instead"}`
            : payment.via === "oneclick"
            ? `${poster} paid ${job.budget} NEAR in ${payment.assetLabel} through NEAR Intents (1Click); the coordinator deposits it into the escrow contract (job ${payment.jobId}) when the round starts`
            : payment.via === "escrow"
            ? `${poster} posted the job; ${job.budget} NEAR is held by the escrow contract (job ${payment.jobId})`
            : deposit
              ? `${poster} posted the job and paid ${job.budget} NEAR into escrow`
              : `${poster} posted the job through the API, paying ${job.budget} NEAR from prepaid credit`,
      },
    ],
    eligible: [],
    bids: [],
    txs: payment.via === "intents" && payment.tx ? [{ label: `Signed intent: ${poster} transferred ${job.budget} wNEAR to the coordinator on NEAR Intents (execute_intents)`, hash: payment.tx }] : [],
    deposit,
    paidWith: payment.via,
    escrowJobId: payment.via === "escrow" || payment.via === "oneclick" ? payment.jobId : undefined,
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
  if (r.paidWith === "intents") {
    // Paid by a signed intent: the budget is in the coordinator's NEAR Intents balance. It goes back the same way.
    await settleThroughIntents(id, null, 0, near, why);
    return;
  }
  if (r.paidWith === "oneclick") {
    // The budget is in escrow (deposited by the coordinator), or still with the coordinator if the round never got
    // that far. Either way it goes back through NEAR Intents, to the payer's own address in the token they paid with.
    const onChain = r.escrowJobId ? await escrowJob(r.escrowJobId) : null;
    if (onChain && onChain.status === "Open") {
      const hash = await escrowRefund(r.escrowJobId!);
      updateRound(id, (x) => x.txs.push({ label: `Escrow contract returned ${r.job.budget} NEAR to the coordinator, to send back through NEAR Intents (${why})`, hash }));
    } else if (onChain) return; // already settled or refunded on the contract: nothing left to return here
    else if (!r.txs.some((t) => t.label.startsWith("Unwrapped"))) {
      // Never unwrapped: the budget is still wNEAR. Unwrap it so the refund path is the same.
      const hash = await unwrapNear(BigInt(yoctoOf(near)));
      updateRound(id, (x) => x.txs.push({ label: `Unwrapped ${near} wNEAR to send back`, hash }));
    }
    await refundThroughIntents(id, near, why);
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

async function fundIntentsEscrow(round: LiveRound) {
  const budget = round.job.budget;
  const yocto = BigInt(yoctoOf(budget));
  if (!round.txs.some((t) => t.label.startsWith("Unwrapped"))) {
    const have = await wnearBalance(coordinator().accountId);
    if (have < yocto) throw new Error(`the coordinator holds less wNEAR than the ${budget} NEAR budget`);
    const hash = await unwrapNear(yocto);
    updateRound(round.id, (r) => r.txs.push({ label: `Unwrapped the ${budget} wNEAR NEAR Intents delivered`, hash }));
  }
  const hash = await escrowPost(round.escrowJobId!, budget);
  updateRound(round.id, (r) => r.txs.push({ label: `Coordinator deposited ${budget} NEAR into the escrow contract for this job`, hash }));
}

// Kept on globalThis so every route (the app, MCP, page renders) shares one queue even if bundled separately.
const Q = globalThis as unknown as { __sfhQueue?: { tail: Promise<void>; recovered: boolean; bootedAt: number } };
Q.__sfhQueue ??= { tail: Promise.resolve(), recovered: false, bootedAt: Date.now() };
const queue = Q.__sfhQueue;

/** Adds a paid round to the queue. It runs after every round posted before it. */
export function enqueueRound(id: string) {
  recoverInterrupted();
  const ahead = load().rounds.filter((r) => r.id !== id && ACTIVE.includes(r.status)).length;
  if (ahead) updateRound(id, {}, `Queued behind ${ahead} round${ahead > 1 ? "s" : ""}; it starts by itself`);
  queue.tail = queue.tail.then(() => runLiveRound(id)).catch(() => {});
  return queue.tail;
}

/**
 * After a restart (a redeploy), rounds the old process was running are stuck mid-way. Queued ones never
 * started, so they go back in the queue; ones cut off mid-round are closed and refunded. An escrow refund
 * only goes through while the job is still open on the contract, so a round that was already paid can't
 * be refunded twice.
 */
export function recoverInterrupted() {
  if (queue.recovered) return;
  queue.recovered = true;
  // Only rounds from before this process started, oldest first: anything newer belongs to this process.
  const left = load().rounds.filter((x) => ACTIVE.includes(x.status) && Date.parse(x.createdAt) < queue.bootedAt).reverse();
  // Intent payments the old process had handed to the verifier but not yet turned into rounds.
  queue.tail = queue.tail
    .then(async () => {
      for (const id of await recoverClaimedIntents(queue.bootedAt)) await runLiveRound(id);
    })
    .catch(() => {});
  for (const r of left) {
    if (r.status === "queued") {
      queue.tail = queue.tail.then(() => runLiveRound(r.id)).catch(() => {});
      continue;
    }
    const unpaid = r.status !== "settling"; // before settling (the second check included), nothing has been paid out of the budget
    updateRound(r.id, { status: "error", error: "The server restarted during this round." }, "The server restarted mid-round. The round was closed and the poster refunded.");
    if (unpaid || r.paidWith === "escrow" || r.paidWith === "oneclick" || r.paidWith === "intents") queue.tail = queue.tail.then(() => refund(r.id, r.job.poster, r.job.budget, "server restarted")).catch(() => {});
  }
}

export async function runLiveRound(id: string) {
  const round = load().rounds.find((r) => r.id === id);
  if (!round || round.status !== "queued") return;
  // Paid through NEAR Intents: the wNEAR 1Click delivered becomes the escrow deposit now, in the queue, so the
  // coordinator signs one thing at a time (also after a restart, which re-queues rounds that hadn't started).
  if (round.paidWith === "oneclick" && !round.txs.some((t) => t.label.startsWith("Coordinator deposited"))) {
    try {
      await fundIntentsEscrow(round);
    } catch (e) {
      updateRound(id, { status: "error", error: e instanceof Error ? e.message : String(e) }, "The payment couldn't be moved into escrow. Nothing was paid out; the budget goes back to the payer.");
      await refund(id, round.job.poster, round.job.budget, "couldn't start the round").catch((err) => updateRound(id, {}, `The refund couldn't be sent automatically (${err instanceof Error ? err.message : err}). It's owed to ${round.job.poster}.`));
      return;
    }
  }
  updateRound(id, { status: "reviewing" });
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
    // The least the work can cost each agent in AI, on its own model: reading the evidence and writing the report,
    // then reading both again to check every claim against the evidence (agent-ai.ts).
    const read = Math.ceil((evidence?.facts.length ?? 0) / 3.5) + 800;
    const estimate = evidence ? { prompt: read * 2 + 1500, completion: 4500 } : { prompt: read, completion: 2500 };

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
    updateRound(id, { bids, winner: winner.id, status: "working" }, `Bids revealed. ${winner.name} wins at ${decision.winner.ask} NEAR (best reputation³ ÷ price)`);

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
    let grade = await gradeDelivery(job.description, work.text, evidence?.facts, { code: job.skills.includes("contract-review") });
    updateRound(id, { grade }, grade.passed ? "Work passed review" : `Work failed review: ${grade.reasons.join("; ")}`);

    // 5b. The second check (when the poster left it on): the other bidders read the passed report and the same
    // evidence, and each may challenge one claim. A second reviewer, a different model, rules. One upheld
    // challenge overturns the pass: nothing is paid and the poster is refunded in full.
    if (grade.passed && job.challenge && evidence) {
      const others = bids
        .filter((b) => b.agent !== winner.id)
        .map((b) => agents.find((a) => a.id === b.agent)!)
        .filter(Boolean)
        .sort((x, y) => jobQuality(y, job) - jobQuality(x, job))
        .slice(0, MAX_CHALLENGERS);
      if (others.length) {
        updateRound(id, { status: "challenging" }, `Second check: ${others.map((a) => a.name).join(", ")} can challenge the report`);
        const filed = await Promise.all(others.map(async (a) => ({ a, ...(await agentChallenge(a, job, evidence, work.text)) })));
        const challenges: Challenge[] = [];
        for (const f of filed) {
          // Each challenger pays for its own check, from its own account, like a bid.
          const spent = usageToNear(f.usage, modelOf(f.a));
          if (spent > 0) {
            const hash = await sendNear(agentAccount(f.a.id), process.env.NEAR_ACCOUNT_ID!, spent).catch(() => null);
            if (hash) updateRound(id, (r) => r.txs.push({ label: `${f.a.name} paid ${spent} NEAR for its own AI (second check)`, hash }));
          }
          if (!f.claim) continue;
          const ruling = await ruleChallenge(job.description, work.text, evidence.facts, f.claim);
          challenges.push({ agent: f.a.id, claim: f.claim, upheld: ruling.upheld, reason: ruling.reason, at: new Date().toISOString() });
          updateRound(id, { challenges: [...challenges] }, `Challenge by ${f.a.name} ${ruling.upheld === null ? "not ruled on" : ruling.upheld ? "upheld" : "rejected"}: ${ruling.reason}`);
        }
        // Reputation follows the ruling, in the job's own skills.
        update((st) => {
          for (const c of challenges) {
            const a = st.agents.find((x) => x.id === c.agent);
            if (!a) continue;
            a.skillQuality ??= {};
            for (const s of job.skills) a.skillQuality[s] = challengeQuality(a.skillQuality[s] ?? 0.5, c.upheld);
          }
        });
        const won = challenges.find((c) => c.upheld);
        if (won) {
          const by = agents.find((a) => a.id === won.agent)?.name ?? won.agent;
          grade = { passed: false, reasons: [`Overturned on challenge by ${by}: ${won.reason}`, ...grade.reasons.slice(0, 1).map((r) => `The first reviewer had passed it: ${r}`)] };
          updateRound(id, { grade, overturned: true }, `Second check: the pass was overturned on ${by}'s challenge. Nothing is paid; the poster is refunded in full.`);
        } else {
          updateRound(id, { challenges }, `Second check: ${challenges.length ? `${challenges.length} challenge${challenges.length === 1 ? "" : "s"}, none upheld` : "no agent challenged the report"}. The pass stands.`);
        }
      }
    }

    // 6. Settlement
    updateRound(id, { status: "settling" });
    const s = settle(job, winner, decision.winner.ask, { passed: grade.passed, aiCost });
    const escrowJobId = load().rounds.find((r) => r.id === id)?.escrowJobId;
    const viaIntents = load().rounds.find((r) => r.id === id)?.paidWith === "intents";
    if (viaIntents) {
      // One signed intent: the winner's pay in NEAR, and the unused budget back to the payer's NEAR Intents balance.
      if (grade.passed) await settleThroughIntents(id, winner.id, s.payout.toAgent, s.payout.refundToPoster, "unused budget");
      else await refund(id, job.poster, job.budget, "work failed review");
      paidOut = job.budget;
    } else if (escrowJobId && grade.passed) {
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
    if (!escrowJobId && !viaIntents) await refund(id, job.poster, s.payout.refundToPoster, grade.passed ? "unused budget" : "work failed review");
    // An Intents payer's unused budget came back from the escrow to the coordinator (it posted the job); send it on.
    else if (grade.passed && s.payout.refundToPoster > 0 && load().rounds.find((r) => r.id === id)?.paidWith === "oneclick")
      await refundThroughIntents(id, s.payout.refundToPoster, "unused budget").catch((err) => updateRound(id, {}, `The unused ${s.payout.refundToPoster} NEAR couldn't be sent back automatically (${err instanceof Error ? err.message : err}). It's owed to ${job.poster}.`));
    paidOut = job.budget;
    update((st) => {
      const a = st.agents.find((x) => x.id === winner.id);
      if (a) {
        if (!grade.unavailable) {
          a.quality = s.quality;
          if (s.skillQuality) a.skillQuality = s.skillQuality;
        }
        a.earned = Math.round((a.earned + s.payout.toBacker) * 1e6) / 1e6;
      }
    });
    updateRound(
      id,
      { status: "done", payout: { ...s.payout, aiCost } }, // the exact amount the agent sent on chain
      grade.passed
        ? `Settled: ${s.payout.toAgent} NEAR to ${winner.name} (backer profit ${s.payout.toBacker}, fee ${s.payout.fee}); ${s.payout.refundToPoster} NEAR refunded to the poster. Reputation now ${s.quality}.`
        : `Settled: poster refunded ${s.payout.refundToPoster} NEAR; ${winner.name} paid its own AI cost and earned nothing. ${grade.unavailable ? `Reputation unchanged at ${winner.quality}.` : `Reputation now ${s.quality}.`}`,
    );
  } catch (e) {
    updateRound(id, { status: "error", error: e instanceof Error ? e.message : String(e) }, "Something went wrong. Nothing further was paid.");
    const left = Math.round((job.budget - paidOut) * 1e6) / 1e6;
    await refund(id, job.poster, left, "round failed").catch((err) =>
      updateRound(id, {}, `The refund of ${left} NEAR couldn't be sent automatically (${err instanceof Error ? err.message : err}). It's owed to ${job.poster}.`),
    );
  }
}
