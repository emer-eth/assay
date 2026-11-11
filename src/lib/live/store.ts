import "server-only";
import { IS_MAINNET } from "../network";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, KEYS_DIR } from "../paths";
import { skillQualityFrom } from "../swarm/round";
import { publishChanges } from "./bus";
import type { IntentView } from "./intents";
import type { SwapView } from "./oneclick";
import { SKILLS, type Agent, type Bid, type Job, type Skill, type Verdict } from "../swarm/types";

// Local state for the live coordinator: a JSON file in data/ (git-ignored). One Node process,
// one round at a time, so a file is enough for the hackathon; swap for a database to deploy.

export type LiveAgent = Agent & { name: string; /** NEAR AI model it runs (see AGENT_MODELS); unset means the default agent model */ model?: string; funding: number; earned: number; createdTx?: string; withdrawn?: number; lastWithdrawTx?: string };

export type RoundStatus = "queued" | "reviewing" | "blocked" | "bidding" | "unfilled" | "working" | "grading" | "settling" | "done" | "error";
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
  /** What the winner's tools read before working (shown to the poster; the full facts also go to the reviewer). */
  evidence?: { summary: string[]; facts: string; intents?: IntentView[]; swap?: SwapView };
  deposit?: string; // escrow payment tx hash, when paid from a wallet
  paidWith?: "escrow" | "wallet" | "credit" | "intents"; // how the budget was paid; refunds go back the same way (absent: early demo rounds)
  /** Paid with NEAR Intents (1Click): who paid, in which token, and where a refund goes (their own address, same token). */
  payer?: { payment: string; asset: string; assetLabel: string; refundTo: string; depositAddress: string };
  /** A refund sent back through 1Click: the deposit address to follow it by, and how much NEAR went in. */
  refundSwaps?: { depositAddress: string; near: number; txHash: string; at: string }[];
  escrowJobId?: string; // the job id in the escrow contract, when paidWith is "escrow"
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
  /** Jobs waiting for their escrow deposit: the job id the wallet passes to post_job, and what was asked for. */
  drafts: Record<string, { account: string; job: Job_; expires: number }>;
  /** Jobs being paid through NEAR Intents (1Click), from quote to the round they become. */
  intentPayments: IntentPayment[];
};

export type IntentPayment = {
  id: string;
  createdAt: string;
  /** The 1Click quote's deadline: after it, an unpaid quote is dead and 1Click refunds anything sent late. */
  deadline: string;
  asset: string; // key in PAY_ASSETS
  assetLabel: string;
  refundTo: string;
  depositAddress: string;
  depositMemo?: string;
  amountInFormatted: string;
  job: Job_;
  status: "waiting" | "posting" | "posted" | "expired" | "failed";
  /** The last status 1Click reported (PENDING_DEPOSIT, KNOWN_DEPOSIT_TX, PROCESSING, SUCCESS, ...). */
  swapStatus?: string;
  roundId?: string;
  note?: string;
};
type Job_ = { description: string; skills: Skill[]; budget: number };

const DIR = DATA_DIR;
const FILE = join(DIR, "live.json");
const KEYS = KEYS_DIR;
// A fresh testnet host starts from the demo agents in seed/agents.json (no rounds, credit or keys). Those are
// testnet accounts, so a mainnet host starts with no agents: backers create them with real NEAR.
const SEED = join(process.cwd(), "seed", "agents.json");
const ALL_SKILLS: Skill[] = [...SKILLS];

export function load(): State {
  const state: State = existsSync(FILE)
    ? JSON.parse(readFileSync(FILE, "utf8"))
    : { agents: existsSync(SEED) && !IS_MAINNET ? JSON.parse(readFileSync(SEED, "utf8")) : [], rounds: [], deposits: [], credits: {}, apiKeys: [], drafts: {}, intentPayments: [] };
  state.deposits ??= [];
  state.credits ??= {};
  state.apiKeys ??= [];
  state.drafts ??= {};
  state.intentPayments ??= [];
  // Adopt agents created by `npm run spike -- --create` that aren't registered yet.
  if (existsSync(KEYS)) {
    for (const f of readdirSync(KEYS).filter((x) => x.endsWith(".json"))) {
      const id = f.replace(/\.json$/, "");
      if (state.agents.some((a) => a.id === id)) continue;
      state.agents.push({
        id,
        name: id.split(".")[0],
        backer: process.env.NEAR_ACCOUNT_ID || "coordinator",
        prompt: "You are a careful NEAR security analyst. Base every claim on the evidence you are given and say plainly what it can't show.",
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
  // Skills from before the specialist swarm (writing, research, ...) are dropped; an agent left with none can do both.
  for (const a of state.agents) {
    a.skills = a.skills.filter((s) => ALL_SKILLS.includes(s));
    if (!a.skills.length) a.skills = [...ALL_SKILLS];
  }
  // Per-skill reputation arrived after the market opened: rebuild it once from the ledger for agents that lack it.
  for (const a of state.agents) a.skillQuality ??= skillQualityFrom(state.rounds, a.id, ALL_SKILLS);
  // One entry per account, whatever happened before: the last write for an id wins.
  state.agents = state.agents.filter((a, i, all) => all.findLastIndex((x) => x.id === a.id) === i);
  return state;
}

export function save(state: State) {
  mkdirSync(DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, FILE); // atomic replace, so a crash never leaves half a file
  publishChanges(state); // tell open event streams what changed (bus.ts)
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
