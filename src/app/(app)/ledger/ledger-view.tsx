"use client";

import { useMemo, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { useMarket } from "@/lib/market";
import { toRow, type RoundRow } from "@/lib/live/rows";
import { SKILLS, type Skill } from "@/lib/swarm/types";
import { CONTAINER, Footer, Label, LedgerTable, VerdictStamp, type LedgerRow } from "@/ui";

const CHECK: Record<Skill, string> = { "due-diligence": "Due diligence", "contract-review": "Code review", "proposal-review": "Proposal review", "tx-forensics": "Tx forensics" };
type Filter = "all" | "passed" | "refunded" | "blocked" | "running";
const verdictOf = (r: RoundRow): Exclude<Filter, "all"> =>
  r.phase === "passed" ? "passed" : r.phase === "blocked" ? "blocked" : ["refunded", "unfilled", "error"].includes(r.phase) ? "refunded" : "running";
const date = (iso: string) => `${Number(iso.slice(8, 10))} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(iso.slice(5, 7)) - 1]} ${iso.slice(11, 16)}`;
const near = (n: number, d = 4) => n.toFixed(d);

export function LedgerView({ rows: initial, aiSpend, loading }: { rows: RoundRow[]; aiSpend: number; loading?: boolean }) {
  // New and moving rounds arrive over the event stream; the server's rows cover the rest of the history.
  const liveRounds = useMarket((s) => s?.rounds);
  const liveAgents = useMarket((s) => s?.agents);
  const rows = useMemo(() => {
    if (!liveRounds || !liveAgents) return initial;
    const live = new Map(liveRounds.map((r) => [r.id, toRow(r, liveAgents)]));
    const merged = initial.map((r) => live.get(r.id) ?? r);
    const fresh = [...live.values()].filter((r) => !initial.some((x) => x.id === r.id));
    return [...fresh, ...merged].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [initial, liveRounds, liveAgents]);

  // A line "enters" when a round finishes (or first appears) while the ledger is open: it slides in once.
  const [seen] = useState(() => new Map(initial.map((r) => [r.id, verdictOf(r)])));
  const fresh = (r: RoundRow) => {
    const before = seen.get(r.id);
    return verdictOf(r) !== "running" && (before === undefined || before === "running");
  };

  const [filter, setFilter] = useState<Filter>("all");
  const [check, setCheck] = useState<Skill | "all">("all");
  const shown = rows.filter((r) => (filter === "all" || verdictOf(r) === filter) && (check === "all" || r.skills.includes(check)));
  const count = (f: Filter) => rows.filter((r) => f === "all" || verdictOf(r) === f).length;

  const graded = rows.filter((r) => r.passed !== null).length;
  const passed = rows.filter((r) => r.passed).length;
  const totals = [
    ["Rounds", String(rows.length)],
    ["Passed review", `${passed} of ${graded}`],
    ["Blocked jobs", String(count("blocked"))],
    ["Paid to agents, NEAR", near(rows.reduce((s, r) => s + r.paid, 0))],
    ["Refunded, NEAR", near(rows.reduce((s, r) => s + r.refunded, 0))],
    ["Agents' AI spend, NEAR", near(aiSpend, 3)],
  ];

  const table: LedgerRow[] = shown.map((r) => {
    const v = verdictOf(r);
    const skill = r.skills.find((s) => s in CHECK);
    return {
      fresh: !loading && fresh(r),
      id: r.id,
      href: `/rounds/${r.id}`,
      date: date(r.createdAt),
      check: (
        <>
          <span className="line-clamp-1" title={r.title}>{r.title}</span>
          {skill && <span className="font-mono text-xs text-ink-2 uppercase">{CHECK[skill]}</span>}
        </>
      ),
      winner: r.winner ?? undefined,
      verdict: v === "running" ? <span className="font-mono text-xs text-stamp uppercase">Running</span> : <VerdictStamp verdict={v} size="xs" />,
      budget: r.budget,
      paid: r.paid,
      fee: r.fee,
      refunded: v === "running" ? 0 : r.refunded,
      txs: r.txs,
    };
  });

  return (
    <>
      <AppHeader />
      <main id="main" className={`${CONTAINER} pt-12`}>
        <Label>Ledger</Label>
        <h1 className="mt-3 max-w-[760px] font-archivo text-[40px] leading-[1.05] font-extrabold text-ink [text-wrap:balance] sm:text-[52px]">Every round, including the ones that failed.</h1>
        <p className="mt-5 max-w-[620px] text-[18px] leading-7 text-ink-2">Read from the coordinator as the page loads, and updated live. Each payment and refund links to the explorer from its round, so you can check it without trusting this page.</p>

        <dl className="mt-10 grid grid-cols-2 border border-rule bg-sheet sm:grid-cols-3 lg:grid-cols-6">
          {totals.map(([k, v]) => (
            <div key={k} className="border-r border-b border-rule p-5 last:border-r-0 lg:border-b-0">
              <dt className="text-sm text-ink-2">{k}</dt>
              <dd className="mt-2 font-mono text-[26px] text-ink">{loading ? "—" : v}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-10 mb-4 flex flex-wrap items-center justify-between gap-4">
          <div role="group" aria-label="Filter by verdict" className="flex flex-wrap gap-2">
            {(["all", "passed", "refunded", "blocked", "running"] as const).map((f) =>
              f === "running" && !count("running") ? null : (
                <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={`min-h-11 rounded-[2px] border px-4 text-[15px] capitalize ${filter === f ? "border-ink bg-ink font-semibold text-on-ink" : "border-ink text-ink hover:bg-tint"}`}>
                  {f} <span className="font-mono">{count(f)}</span>
                </button>
              ),
            )}
          </div>
          <label className="flex items-center gap-3 text-[15px] text-ink-2">
            Check
            <select value={check} onChange={(e) => setCheck(e.target.value as Skill | "all")} className="min-h-11 rounded-[2px] border border-ink bg-sheet px-3 text-base text-ink">
              <option value="all">All checks</option>
              {SKILLS.map((s) => <option key={s} value={s}>{CHECK[s]}</option>)}
            </select>
          </label>
        </div>

        <div className="border-2 border-ink bg-sheet">
          <LedgerTable rows={table} loading={loading} empty="No rounds match these filters." />
        </div>
        <p className="mt-4 text-sm text-ink-2">On every settled line, budget equals paid plus fee plus refunded. The ledger always balances.</p>
      </main>
      <Footer />
    </>
  );
}
