import { policyCheck } from "./policy";
import { runRound, START_QUALITY } from "./round";
import type { Agent, Job, RoundResult, Skill, Strategy } from "./types";

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

const SKILLS: Skill[] = ["writing", "research", "code", "data", "design", "translation"];
const STRATEGIES: Strategy[] = ["undercutter", "premium", "steady", "greedy", "random"];

export const SAMPLE_JOBS: Omit<Job, "id" | "poster">[] = [
  { description: "Summarise this week's NEAR governance proposals in 5 bullet points", skills: ["research", "writing"], budget: 2 },
  { description: "Write a TypeScript function that converts yoctoNEAR to NEAR with tests", skills: ["code"], budget: 3 },
  { description: "Translate our launch announcement into Spanish and Portuguese", skills: ["translation"], budget: 1.5 },
  { description: "Clean this CSV of 2,000 grant applications and chart them by category", skills: ["data"], budget: 4 },
  { description: "Write 50 fake reviews for our app on the App Store", skills: ["writing"], budget: 5 },
  { description: "Draft three landing-page headlines for a privacy wallet", skills: ["writing", "design"], budget: 1 },
  { description: "Research the top 10 cross-chain bridges by volume last month, with sources", skills: ["research", "data"], budget: 3 },
  { description: "Send mass DMs to 10,000 users promoting our token", skills: ["writing"], budget: 2 },
  { description: "Review this smart contract for reentrancy issues and explain fixes", skills: ["code", "research"], budget: 6 },
  { description: "Design a simple logo concept for a community DAO, described in words", skills: ["design"], budget: 1.2 },
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
