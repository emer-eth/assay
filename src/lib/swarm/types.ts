// Shared types for the swarm. Amounts are in NEAR as plain numbers in the simulation;
// the live coordinator converts to yoctoNEAR at the chain boundary.

/** What the swarm is hired for. Each skill comes with tools that read real inputs (src/lib/live/tools.ts). */
export const SKILLS = ["due-diligence", "contract-review", "proposal-review", "tx-forensics"] as const;
export type Skill = (typeof SKILLS)[number];
/** Skills whose reports still fail review more often than they pass; shown with a "beta" tag. */
export const BETA_SKILLS: Skill[] = ["contract-review"];

/** Skills the job form doesn't offer for now: code review fails review too often (1 pass in the last 10 on 11 Nov 2026).
 *  Everything behind it stays (tools, agents' skills, old rounds, MCP as beta); empty this list to bring it back. */
export const PAUSED_SKILLS: Skill[] = ["contract-review"];
export const OFFERED_SKILLS: Skill[] = SKILLS.filter((s) => !PAUSED_SKILLS.includes(s));
export const PAUSED_NOTE = "Contract code review is paused while we improve it: its reports failed review too often. Name an account, a DAO proposal or a transaction instead.";

export const SKILL_LABEL: Record<Skill, string> = { "due-diligence": "Contract due diligence", "contract-review": "Contract code review", "proposal-review": "DAO proposal review", "tx-forensics": "Transaction forensics" };

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
  /** Reputation per skill, earned only from jobs in that skill (live agents). Bids are ranked on this when present. */
  skillQuality?: Partial<Record<Skill, number>>;
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
