import type { LiveAgent, LiveRound } from "./store";
import { phaseOf, type Phase } from "./timeline";

// Slim ledger rows: one balanced line per round (budget = paid + fee + refunded), no report text or evidence.
export type RoundRow = {
  id: string;
  createdAt: string;
  status: LiveRound["status"];
  phase: Phase;
  /** One line for the ledger: the job, or for a refused job the reviewer's reason (the brief stays withheld). */
  title: string;
  skills: LiveRound["job"]["skills"];
  winner: string | null;
  passed: boolean | null;
  budget: number;
  paid: number;
  fee: number;
  refunded: number;
  txs: number;
  /** How the budget was paid: a signed NEAR Intent, the escrow contract, MCP credit... (absent on early demo rounds). */
  paidWith?: LiveRound["paidWith"];
};

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

export function toRow(r: LiveRound, agents: Pick<LiveAgent, "id" | "name">[]): RoundRow {
  const p = r.payout;
  const paid = p ? r4(p.toAgent) : 0;
  const fee = p ? r4(p.fee) : 0;
  // A round still running has its whole budget in escrow: nothing paid or refunded yet. A round that stopped
  // (a restart mid-round) has no settlement: its whole budget was refunded, which its transactions show.
  const refunded = p ? r4(p.refundToPoster) : r.status === "error" ? r.job.budget : 0;
  return {
    id: r.id,
    createdAt: r.createdAt,
    status: r.status,
    phase: phaseOf(r),
    title: r.status === "blocked" ? `Refused by the reviewer${r.review?.reasons[0] ? `: ${r.review.reasons[0]}` : ""}` : r.job.description,
    skills: r.job.skills,
    winner: r.winner ? (agents.find((a) => a.id === r.winner)?.name ?? r.winner) : null,
    passed: r.grade ? r.grade.passed : null,
    budget: r.job.budget,
    paid,
    fee,
    refunded,
    txs: r.txs.length,
    paidWith: r.paidWith,
  };
}

/** Newest first; `cursor` is the last id the caller has, so the next page starts after it. */
export function pageRows(rounds: LiveRound[], agents: Pick<LiveAgent, "id" | "name">[], cursor: string | null, limit = 50) {
  const start = cursor ? rounds.findIndex((r) => r.id === cursor) + 1 : 0;
  if (cursor && start === 0) return { rows: [] as RoundRow[], next: null };
  const slice = rounds.slice(start, start + limit);
  return { rows: slice.map((r) => toRow(r, agents)), next: start + limit < rounds.length ? (slice.at(-1)?.id ?? null) : null };
}
