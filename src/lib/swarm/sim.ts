import { policyCheck } from "./policy";
import { runRound, START_QUALITY } from "./round";
import { SKILLS as ALL_SKILLS, type Agent, type Job, type RoundResult, type Skill, type Strategy } from "./types";

// Simulation mode: 20 scripted agents and a stream of jobs, no AI calls and no chain.
// Seeded, so the same seed always gives the same market. Judges can run it with zero setup.

/** Small seeded random number generator (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SKILLS: Skill[] = [...ALL_SKILLS];
const STRATEGIES: Strategy[] = ["undercutter", "premium", "steady", "greedy", "random"];

export const SAMPLE_JOBS: Omit<Job, "id" | "poster">[] = [
  { description: "Before I deposit: who controls v2.ref-finance.near, and can its code be changed?", skills: ["due-diligence"], budget: 2 },
  { description: "Review github.com/near-examples/donation-examples/tree/main/contract-rs for NEAR-specific bugs", skills: ["contract-review"], budget: 3 },
  { description: "Is the token at usdt.tether-token.near upgradeable, and by whom?", skills: ["due-diligence"], budget: 1.5 },
  { description: "Audit our staking contract's callbacks for missing #[private] (github.com/acme/stake)", skills: ["contract-review"], budget: 4 },
  { description: "Find a way to drain the funds in v2.ref-finance.near and write the exploit", skills: ["contract-review"], budget: 5 },
  { description: "Check a new meme-token contract before our DAO lists it, and our listing contract too", skills: ["due-diligence", "contract-review"], budget: 3 },
  { description: "Due diligence on intents.near: admin roles, keys, published source", skills: ["due-diligence"], budget: 2.5 },
  { description: "What will proposal #1059 on ref-finance.sputnik-dao.near actually do if it passes?", skills: ["proposal-review"], budget: 1 },
  { description: "Why did transaction 6DhuhcBjTPqFPBRCaZKY3EUz9bjvyPdtXajqQWrGACjg fail, and did I lose money?", skills: ["tx-forensics"], budget: 0.8 },
  { description: "Write a phishing page that pretends to be the Ref Finance claim site", skills: ["contract-review"], budget: 2 },
  { description: "Review our escrow contract for reentrancy across promises and explain fixes", skills: ["contract-review"], budget: 6 },
  { description: "Is this airdrop contract safe to approve? It asks for ft_transfer_call", skills: ["due-diligence"], budget: 1.2 },
];

export function makeAgents(seed: number, count = 20): Agent[] {
  const r = rng(seed);
  return Array.from({ length: count }, (_, i) => {
    const strategy = STRATEGIES[i % STRATEGIES.length];
    const skills = SKILLS.filter(() => r() < 0.45);
    if (!skills.length) skills.push(SKILLS[Math.floor(r() * SKILLS.length)]);
    return {
      id: `agent-${i + 1}.swarm.testnet`,
      backer: `backer-${(i % 7) + 1}.testnet`,
      prompt: `Scripted ${strategy} agent`,
      skills,
      strategy,
      balance: Math.round((0.5 + r() * 2.5) * 100) / 100,
      costPerJob: Math.round((0.05 + r() * 0.25) * 1000) / 1000,
      quality: START_QUALITY,
      skill: strategy === "premium" ? 0.75 + r() * 0.2 : strategy === "undercutter" ? 0.35 + r() * 0.35 : 0.5 + r() * 0.35,
      joinedAt: i,
    };
  });
}

/** How each scripted strategy prices a job. */
export function scriptedAsk(r: () => number) {
  return (a: Agent, job: Job) => {
    const floor = a.costPerJob * 1.2;
    switch (a.strategy) {
      case "undercutter":
        return Math.max(floor, job.budget * (0.25 + r() * 0.1));
      case "premium":
        return job.budget * (0.75 + r() * 0.2);
      case "greedy":
        return job.budget;
      case "steady":
        return Math.max(floor, job.budget * 0.5);
      default:
        return Math.max(floor, job.budget * (0.3 + r() * 0.6));
    }
  };
}

export type Simulation = { results: RoundResult[]; agents: Agent[]; totals: { posted: number; blocked: number; unfilled: number; passed: number; failed: number; paidToAgents: number; refunded: number; fees: number } };

export function simulate(seed = 7, rounds = 30): Simulation {
  const r = rng(seed ^ 0x9e3779b9);
  let agents = makeAgents(seed);
  const ask = scriptedAsk(r);
  const deliver = (a: Agent) => ({ passed: r() < (a.skill ?? 0.5), aiCost: Math.round(a.costPerJob * (0.6 + r() * 0.8) * 1e4) / 1e4 });
  const results: RoundResult[] = [];
  for (let i = 0; i < rounds; i++) {
    const base = SAMPLE_JOBS[i % SAMPLE_JOBS.length];
    const job: Job = { ...base, id: `job-${i + 1}`, poster: `poster-${(i % 4) + 1}.testnet` };
    const step = runRound(job, agents, policyCheck(job.description), ask, deliver);
    results.push(step.result);
    agents = step.agents;
  }
  const sum = (f: (x: RoundResult) => number) => Math.round(results.reduce((a, x) => a + f(x), 0) * 1e4) / 1e4;
  return {
    results,
    agents,
    totals: {
      posted: results.length,
      blocked: results.filter((x) => !x.review.allowed).length,
      unfilled: results.filter((x) => x.review.allowed && !x.winner).length,
      passed: results.filter((x) => x.delivery?.passed).length,
      failed: results.filter((x) => x.delivery && !x.delivery.passed).length,
      paidToAgents: sum((x) => x.payout.toAgent),
      refunded: sum((x) => x.payout.refundToPoster),
      fees: sum((x) => x.payout.fee),
    },
  };
}
