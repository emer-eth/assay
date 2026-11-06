import type { Agent, Bid, Job, RoundResult, Verdict } from "./types";

// Pure implementation of one round from RULES.md. No chain, no AI: the caller passes in the
// review verdict, the asks and the delivery outcome, so the same code runs in simulation and live.

export const FEE = 0.02;
export const START_QUALITY = 0.5;
export const nextQuality = (q: number, passed: boolean) => 0.8 * q + 0.2 * (passed ? 1 : 0);

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

export function eligibleAgents(job: Job, agents: Agent[]) {
  return agents.filter((a) => job.skills.every((s) => a.skills.includes(s)) && a.balance >= a.costPerJob);
}

/** Highest quality per NEAR wins; ties go to the lower ask, then to whoever joined first. */
export function pickWinner(bids: Bid[], agents: Agent[]): Bid | null {
  const joined = new Map(agents.map((a) => [a.id, a.joinedAt]));
  const sorted = [...bids].sort((a, b) => b.value - a.value || a.ask - b.ask || (joined.get(a.agent) ?? 0) - (joined.get(b.agent) ?? 0));
  return sorted[0] ?? null;
}

export function runRound(
  job: Job,
  agents: Agent[],
  review: Verdict,
  askFor: (agent: Agent, job: Job) => number,
  deliver: (agent: Agent, job: Job) => { passed: boolean; aiCost: number },
): { result: RoundResult; agents: Agent[] } {
  const empty = { toAgent: 0, toBacker: 0, fee: 0, refundToPoster: job.budget };
  if (!review.allowed)
    return { result: { job, review, eligible: [], bids: [], winner: null, delivery: null, payout: empty, qualityAfter: null }, agents };

  const eligible = eligibleAgents(job, agents);
  const bids: Bid[] = eligible
    .map((a) => {
      const ask = round4(Math.min(job.budget, Math.max(0.0001, askFor(a, job))));
      return { agent: a.id, ask, value: a.quality / ask };
    });
  const win = pickWinner(bids, agents);
  if (!win)
    return { result: { job, review, eligible: [], bids: [], winner: null, delivery: null, payout: empty, qualityAfter: null }, agents };

  const agent = agents.find((a) => a.id === win.agent)!;
  const delivery = deliver(agent, job);
  const aiCost = round4(Math.min(delivery.aiCost, agent.balance));
  const fee = delivery.passed ? round4(win.ask * FEE) : 0;
  const toAgent = delivery.passed ? round4(win.ask - fee) : 0;
  // The agent's AI cost is repaid into its balance first; what's left is the backer's profit.
  const toBacker = delivery.passed ? round4(Math.max(0, toAgent - aiCost)) : 0;
  const refundToPoster = round4(job.budget - (delivery.passed ? win.ask : 0));
  const qualityAfter = round4(nextQuality(agent.quality, delivery.passed));

  const updated = agents.map((a) =>
    a.id !== agent.id ? a : { ...a, balance: round4(a.balance - aiCost + (delivery.passed ? Math.min(toAgent, aiCost) : 0)), quality: qualityAfter },
  );
  return {
    result: { job, review, eligible: eligible.map((a) => a.id), bids, winner: agent.id, delivery: { passed: delivery.passed, aiCost }, payout: { toAgent, toBacker, fee, refundToPoster }, qualityAfter },
    agents: updated,
  };
}
