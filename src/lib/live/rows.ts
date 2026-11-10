import type { LiveAgent, LiveRound } from "./store";

// Slim ledger rows: one balanced line per round (budget = paid + fee + refunded), no report text or evidence.
export type RoundRow = {
  id: string;
  createdAt: string;
  status: LiveRound["status"];
  skills: LiveRound["job"]["skills"];
  winner: string | null;
  passed: boolean | null;
  budget: number;
  paid: number;
  fee: number;
  refunded: number;
  txs: number;
};

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

export function toRow(r: LiveRound, agents: Pick<LiveAgent, "id" | "name">[]): RoundRow {
  const p = r.payout;
  const paid = p ? r4(p.toAgent) : 0;
  const fee = p ? r4(p.fee) : 0;
  // A round still running has its whole budget in escrow: nothing paid or refunded yet.
  const refunded = p ? r4(p.refundToPoster) : 0;
  return {
    id: r.id,
    createdAt: r.createdAt,
    status: r.status,
    skills: r.job.skills,
    winner: r.winner ? (agents.find((a) => a.id === r.winner)?.name ?? r.winner) : null,
    passed: r.grade ? r.grade.passed : null,
    budget: r.job.budget,
    paid,
    fee,
    refunded,
    txs: r.txs.length,
  };
}

/** Newest first; `cursor` is the last id the caller has, so the next page starts after it. */
export function pageRows(rounds: LiveRound[], agents: Pick<LiveAgent, "id" | "name">[], cursor: string | null, limit = 50) {
  const start = cursor ? rounds.findIndex((r) => r.id === cursor) + 1 : 0;
  if (cursor && start === 0) return { rows: [] as RoundRow[], next: null };
  const slice = rounds.slice(start, start + limit);
  return { rows: slice.map((r) => toRow(r, agents)), next: start + limit < rounds.length ? (slice.at(-1)?.id ?? null) : null };
}
