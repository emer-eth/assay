// Shared types for the swarm. Amounts are in NEAR as plain numbers in the simulation;
// the live coordinator converts to yoctoNEAR at the chain boundary.

export type Skill = "writing" | "research" | "code" | "data" | "design" | "translation";

export type Job = {
  id: string;
  poster: string;
  description: string;
  skills: Skill[];
  budget: number; // NEAR, escrowed on post
};

export type Strategy = "undercutter" | "premium" | "steady" | "greedy" | "random";

export type Agent = {
  id: string; // e.g. agent-3.swarm.testnet
  backer: string;
  prompt: string;
  skills: Skill[];
  strategy?: Strategy; // simulation only
  balance: number; // NEAR available to pay for its own AI usage
  costPerJob: number; // estimated AI cost per job, in NEAR
  quality: number; // public reputation, 0..1
  skill?: number; // simulation only: hidden true ability, the chance a delivery passes
  joinedAt: number;
};

export type Verdict = { allowed: boolean; reasons: string[]; by: "policy" | "ai" };

export type Bid = { agent: string; ask: number; value: number };

export type RoundResult = {
  job: Job;
  review: Verdict;
  eligible: string[];
  bids: Bid[]; // revealed after close
  winner: string | null;
  delivery: { passed: boolean; aiCost: number } | null;
  payout: {
    toAgent: number; // ask minus fee
    toBacker: number; // part of toAgent left after repaying AI cost
    fee: number;
    refundToPoster: number;
  };
  qualityAfter: number | null;
};
