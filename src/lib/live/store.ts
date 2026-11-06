import "server-only";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Agent, Bid, Job, Skill, Verdict } from "../swarm/types";

// Local state for the live coordinator: a JSON file in data/ (git-ignored). One Node process,
// one round at a time, so a file is enough for the hackathon; swap for a database to deploy.

export type LiveAgent = Agent & { name: string; funding: number; earned: number; createdTx?: string; withdrawn?: number; lastWithdrawTx?: string };

export type RoundStatus = "reviewing" | "blocked" | "bidding" | "unfilled" | "working" | "grading" | "settling" | "done" | "error";
export type Tx = { label: string; hash: string };
export type LiveRound = {
  id: string;
  createdAt: string;
  job: Job;
  status: RoundStatus;
  steps: { at: string; text: string }[];
  review?: Verdict;
  eligible: string[];
  bids: (Bid & { pitch?: string })[]; // only shown once bidding has closed
  winner?: string;
  deliverable?: string;
  tokens?: number;
  grade?: { passed: boolean; reasons: string[] };
  payout?: { toAgent: number; toBacker: number; fee: number; refundToPoster: number; aiCost: number };
  txs: Tx[];
  error?: string;
  deposit?: string; // escrow payment tx hash, when paid from a wallet
  paidWith?: "wallet" | "credit"; // how the budget was paid; refunds go back the same way (absent: early demo rounds)
};

export type Deposit = { txHash: string; from: string; near: number; purpose: string; at: string };
/** An API key for MCP and other programs. Only its SHA-256 hash is stored; the key itself is shown once. */
export type ApiKey = { id: string; hash: string; account: string; label: string; prefix: string; createdAt: string; lastUsedAt?: string; revoked?: boolean };
type State = {
  agents: LiveAgent[];
  rounds: LiveRound[];
  deposits: Deposit[];
  credits: Record<string, number>; // prepaid NEAR per account, spent by API keys (MCP), refunded back into
  apiKeys: ApiKey[];
};

const DIR = join(process.cwd(), "data");
const FILE = join(DIR, "live.json");
const KEYS = join(process.cwd(), ".keys");
const ALL_SKILLS: Skill[] = ["writing", "research", "code", "data", "design", "translation"];

export function load(): State {
  const state: State = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : { agents: [], rounds: [], deposits: [], credits: {}, apiKeys: [] };
  state.deposits ??= [];
  state.credits ??= {};
  state.apiKeys ??= [];
  // Adopt agents created by `npm run spike -- --create` that aren't registered yet.
  if (existsSync(KEYS)) {
    for (const f of readdirSync(KEYS).filter((x) => x.endsWith(".json"))) {
      const id = f.replace(/\.json$/, "");
      if (state.agents.some((a) => a.id === id)) continue;
      state.agents.push({
        id,
        name: id.split(".")[0],
        backer: process.env.NEAR_ACCOUNT_ID || "coordinator",
        prompt: "You are a careful generalist. Do exactly what the job asks, concisely and accurately.",
        skills: ALL_SKILLS,
        balance: 0,
        costPerJob: 0.01,
        quality: 0.5,
        joinedAt: state.agents.length,
        funding: 0.5,
        earned: 0,
      });
    }
  }
  // One entry per account, whatever happened before: the last write for an id wins.
  state.agents = state.agents.filter((a, i, all) => all.findLastIndex((x) => x.id === a.id) === i);
  return state;
}

export function save(state: State) {
  mkdirSync(DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, FILE); // atomic replace, so a crash never leaves half a file
}

/** Read-modify-write in one step. */
export function update<T>(fn: (s: State) => T): T {
  const state = load();
  const out = fn(state);
  save(state);
  return out;
}

export function updateRound(id: string, patch: Partial<LiveRound> | ((r: LiveRound) => void), step?: string) {
  update((s) => {
    const r = s.rounds.find((x) => x.id === id);
    if (!r) return;
    if (typeof patch === "function") patch(r);
    else Object.assign(r, patch);
    if (step) r.steps.push({ at: new Date().toISOString(), text: step });
  });
}
