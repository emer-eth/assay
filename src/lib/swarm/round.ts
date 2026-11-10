import type { Agent, Bid, Job, RoundResult, Skill, Verdict } from "./types";

// Pure implementation of one round from RULES.md, split in two so the simulation and the live
// coordinator share the exact same rules:
//   decide()  who may bid, the revealed bids and the winner
//   settle()  where every NEAR goes after the delivery is graded, and the new quality
// No chain and no AI in here: callers pass in the review, the asks and the delivery outcome.

export const FEE = 0.02;
export const START_QUALITY = 0.5;
export const nextQuality = (q: number, passed: boolean) => 0.8 * q + 0.2 * (passed ? 1 : 0);
/** Value of a bid. Quality is squared so a cheap but unreliable agent can't win on price alone. */
export const bidValue = (quality: number, ask: number) => quality ** 3 / ask;

export const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/**
 * The reputation a bid is ranked on: the agent's record in the job's own skills (the average, if it asks for
 * several), so passing transaction forensics doesn't win an agent code reviews it keeps failing. A skill the
 * agent has no record in starts at START_QUALITY. Agents without per-skill records (the simulation) use quality.
 */
export function jobQuality(a: Pick<Agent, "quality" | "skillQuality">, job: Pick<Job, "skills">): number {
  if (!a.skillQuality || !job.skills.length) return a.quality;
  return job.skills.reduce((sum, s) => sum + (a.skillQuality![s] ?? START_QUALITY), 0) / job.skills.length;
}

/** Per-skill reputation rebuilt from graded rounds, oldest first (rounds the reviewer couldn't grade don't count). */
export function skillQualityFrom(
  rounds: { winner?: string; status: string; job: Pick<Job, "skills">; grade?: { passed: boolean; unavailable?: boolean }; createdAt: string }[],
  agentId: string,
  skills: readonly Skill[],
): Partial<Record<Skill, number>> {
  const out: Partial<Record<Skill, number>> = {};
  for (const r of [...rounds].sort((x, y) => x.createdAt.localeCompare(y.createdAt))) {
    if (r.winner !== agentId || r.status !== "done" || !r.grade || r.grade.unavailable) continue;
    for (const s of r.job.skills) if (skills.includes(s)) out[s] = round4(nextQuality(out[s] ?? START_QUALITY, r.grade.passed));
  }
  return out;
}

export function eligibleAgents<A extends Agent>(job: Job, agents: A[]): A[] {
  return agents.filter((a) => job.skills.every((s) => a.skills.includes(s)) && a.balance >= a.costPerJob);
}

/** Highest value wins; ties go to the lower ask, then to whoever joined first. */
export function pickWinner(bids: Bid[], agents: Agent[]): Bid | null {
  const joined = new Map(agents.map((a) => [a.id, a.joinedAt]));
  const sorted = [...bids].sort((a, b) => b.value - a.value || a.ask - b.ask || (joined.get(a.agent) ?? 0) - (joined.get(b.agent) ?? 0));
  return sorted[0] ?? null;
}

/** Turns raw asks into revealed bids (clamped to (0, budget]) and picks the winner. */
export function decide(job: Job, agents: Agent[], asks: Map<string, number>) {
  const eligible = eligibleAgents(job, agents);
  const bids: Bid[] = eligible
    .filter((a) => asks.has(a.id) && Number.isFinite(asks.get(a.id)))
    .map((a) => {
      const ask = round4(Math.min(job.budget, Math.max(0.0001, asks.get(a.id)!)));
      return { agent: a.id, ask, value: bidValue(jobQuality(a, job), ask) };
    });
  return { eligible: eligible.map((a) => a.id), bids, winner: pickWinner(bids, agents) };
}

/** Money and reputation after the delivery review. aiCost is what the agent spent on its own AI. */
export function settle(job: Job, agent: Agent, ask: number, delivery: { passed: boolean; aiCost: number }) {
  const aiCost = round4(Math.min(delivery.aiCost, agent.balance));
  const fee = delivery.passed ? round4(ask * FEE) : 0;
  const toAgent = delivery.passed ? round4(ask - fee) : 0;
  // The agent's AI cost is repaid into its balance first; what's left is the backer's profit.
  const toBacker = delivery.passed ? round4(Math.max(0, toAgent - aiCost)) : 0;
  const refundToPoster = round4(job.budget - (delivery.passed ? ask : 0));
  const quality = round4(nextQuality(agent.quality, delivery.passed));
  const skillQuality = agent.skillQuality
    ? { ...agent.skillQuality, ...Object.fromEntries(job.skills.map((s) => [s, round4(nextQuality(agent.skillQuality![s] ?? START_QUALITY, delivery.passed))])) }
    : undefined;
  const balance = round4(agent.balance - aiCost + (delivery.passed ? Math.min(toAgent, aiCost) : 0));
  return { aiCost, payout: { toAgent, toBacker, fee, refundToPoster }, quality, skillQuality, balance };
}

/** One full round with synchronous inputs (used by the simulation and the tests). */
export function runRound(
  job: Job,
  agents: Agent[],
  review: Verdict,
  askFor: (agent: Agent, job: Job) => number,
  deliver: (agent: Agent, job: Job) => { passed: boolean; aiCost: number },
): { result: RoundResult; agents: Agent[] } {
  const none = { job, review, eligible: [], bids: [], winner: null, delivery: null, payout: { toAgent: 0, toBacker: 0, fee: 0, refundToPoster: job.budget }, qualityAfter: null };
  if (!review.allowed) return { result: none, agents };

  const asks = new Map(eligibleAgents(job, agents).map((a) => [a.id, askFor(a, job)]));
  const { eligible, bids, winner } = decide(job, agents, asks);
  if (!winner) return { result: { ...none, eligible, bids }, agents };

  const agent = agents.find((a) => a.id === winner.agent)!;
  const delivery = deliver(agent, job);
  const s = settle(job, agent, winner.ask, delivery);
  return {
    result: { job, review, eligible, bids, winner: agent.id, delivery: { passed: delivery.passed, aiCost: s.aiCost }, payout: s.payout, qualityAfter: s.quality },
    agents: agents.map((a) => (a.id === agent.id ? { ...a, balance: s.balance, quality: s.quality } : a)),
  };
}
