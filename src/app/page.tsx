"use client";

import { useMemo, useState } from "react";
import { simulate } from "@/lib/swarm/sim";
import type { RoundResult } from "@/lib/swarm/types";

// Simulation mode: the whole market runs in the browser from a seed. No keys, no chain, no AI calls,
// so anyone (including the hackathon's screening bots) can see a round work end to end.

const near = (n: number) => `${n.toFixed(n < 1 ? 3 : 2)} Ⓝ`;
const short = (id: string | null) => (id ? id.replace(".swarm.testnet", "") : "—");

export default function Home() {
  const [seed, setSeed] = useState(7);
  const [rounds, setRounds] = useState(30);
  const sim = useMemo(() => simulate(seed, rounds), [seed, rounds]);
  const [open, setOpen] = useState<string | null>(null);
  const wins = useMemo(() => {
    const m = new Map<string, { wins: number; earned: number }>();
    for (const r of sim.results)
      if (r.winner && r.delivery?.passed) {
        const w = m.get(r.winner) || { wins: 0, earned: 0 };
        m.set(r.winner, { wins: w.wins + 1, earned: w.earned + r.payout.toBacker });
      }
    return m;
  }, [sim]);
  const t = sim.totals;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <p className="font-mono text-xs uppercase tracking-widest text-zinc-500">Simulation mode · 20 scripted agents · no AI calls</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Swarm-for-Hire</h1>
      <p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-400">
        Post a job with a NEAR bounty. Backers fund agents to pay for their AI. Agents place sealed bids, a reviewer blocks unsafe jobs and grades the
        work, and the winner is paid. Rules: <code className="font-mono text-sm">RULES.md</code>.
      </p>

      <div className="mt-6 flex flex-wrap items-end gap-4">
        <label className="text-sm">
          <span className="block text-zinc-500">Seed</span>
          <input type="number" className="mt-1 w-28 rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 dark:border-zinc-700" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} />
        </label>
        <label className="text-sm">
          <span className="block text-zinc-500">Jobs</span>
          <input type="number" min={1} max={200} className="mt-1 w-24 rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 dark:border-zinc-700" value={rounds} onChange={(e) => setRounds(Math.max(1, Math.min(200, Number(e.target.value) || 1)))} />
        </label>
        <button className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white dark:bg-white dark:text-zinc-900" onClick={() => setSeed(Math.floor(Math.random() * 1e6))}>
          New market
        </button>
      </div>

      <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Totals">
        {[
          ["Jobs posted", String(t.posted)],
          ["Blocked by reviewer", String(t.blocked)],
          ["Delivered · failed", `${t.passed} · ${t.failed}`],
          ["Paid to agents", near(t.paidToAgents)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <p className="text-xs text-zinc-500">{label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </section>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_300px]">
        <section aria-labelledby="rounds-h">
          <h2 id="rounds-h" className="text-lg font-semibold">Rounds</h2>
          <ol className="mt-3 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {sim.results.map((r) => (
              <Round key={r.job.id} r={r} open={open === r.job.id} toggle={() => setOpen(open === r.job.id ? null : r.job.id)} />
            ))}
          </ol>
        </section>

        <section aria-labelledby="agents-h">
          <h2 id="agents-h" className="text-lg font-semibold">Agents</h2>
          <ul className="mt-3 divide-y divide-zinc-200 rounded-lg border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
            {[...sim.agents]
              .sort((a, b) => b.quality - a.quality)
              .map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-xs">{short(a.id)}</span>
                    <span className="text-xs text-zinc-500">
                      {a.strategy} · {a.skills.join(", ")}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-xs tabular-nums">
                    q {a.quality.toFixed(2)} · {near(a.balance)}
                    <br />
                    <span className="text-zinc-500">{wins.get(a.id)?.wins ?? 0} wins · backer +{near(wins.get(a.id)?.earned ?? 0)}</span>
                  </span>
                </li>
              ))}
          </ul>
        </section>
      </div>
    </main>
  );
}

function Round({ r, open, toggle }: { r: RoundResult; open: boolean; toggle: () => void }) {
  const status = !r.review.allowed ? ["Blocked", "text-red-600"] : !r.winner ? ["No bids", "text-zinc-500"] : r.delivery?.passed ? ["Paid", "text-emerald-600"] : ["Failed review", "text-amber-600"];
  return (
    <li>
      <button className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900" onClick={toggle} aria-expanded={open}>
        <span className="w-14 shrink-0 font-mono text-xs text-zinc-500">{r.job.id}</span>
        <span className="min-w-0 flex-1 text-sm">{r.job.description}</span>
        <span className={`shrink-0 text-xs font-medium ${status[1]}`}>{status[0]}</span>
      </button>
      {open && (
        <div className="space-y-2 px-3 pb-3 pl-20 text-xs text-zinc-600 dark:text-zinc-400">
          <p>
            Budget {near(r.job.budget)} · needs {r.job.skills.join(" + ")}
          </p>
          {!r.review.allowed ? (
            <p className="text-red-600">Reviewer blocked it: {r.review.reasons.join("; ")}. Poster refunded {near(r.payout.refundToPoster)}.</p>
          ) : (
            <>
              <p>
                {r.eligible.length} eligible agents · sealed bids revealed:{" "}
                {r.bids
                  .slice()
                  .sort((a, b) => b.value - a.value)
                  .slice(0, 5)
                  .map((b) => `${short(b.agent)} ${near(b.ask)}`)
                  .join(", ") || "none"}
                {r.bids.length > 5 && ` +${r.bids.length - 5} more`}
              </p>
              {r.winner && (
                <p>
                  Winner {short(r.winner)} · AI cost {near(r.delivery?.aiCost ?? 0)} ·{" "}
                  {r.delivery?.passed
                    ? `paid ${near(r.payout.toAgent)} (backer profit ${near(r.payout.toBacker)}, fee ${near(r.payout.fee)}), poster refunded ${near(r.payout.refundToPoster)}`
                    : `work failed review, poster refunded ${near(r.payout.refundToPoster)}`}
                  {r.qualityAfter !== null && ` · quality now ${r.qualityAfter.toFixed(2)}`}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}
