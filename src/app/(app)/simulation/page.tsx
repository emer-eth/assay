"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Hive, HiveLegend, type Cell, type CellState } from "@/components/hive";
import { near, Stat, TopBar } from "@/components/ui";
import { simulate } from "@/lib/swarm/sim";
import type { RoundResult } from "@/lib/swarm/types";

// Simulation mode: the whole market runs in the browser from a seed. No keys, no chain, no AI calls,
// so anyone (including the hackathon's screening bots) can see rounds work end to end.

const short = (id: string | null) =>
  id ? id.replace(".swarm.testnet", "") : "—";

function simState(agentId: string, r?: RoundResult): CellState {
  if (!r) return "idle";
  if (r.winner === agentId) return r.delivery?.passed ? "paid" : "failed";
  if (r.bids.some((b) => b.agent === agentId)) return "bid";
  return "idle";
}

const outcome = (r: RoundResult): [string, string] =>
  !r.review.allowed
    ? ["Blocked", "text-bad"]
    : !r.winner
      ? ["No bids", "text-muted"]
      : r.delivery?.passed
        ? ["Paid", "text-ok"]
        : ["Failed review", "text-accent"];

export default function Home() {
  const [seed, setSeed] = useState(7);
  const [rounds, setRounds] = useState(30);
  const sim = useMemo(() => simulate(seed, rounds), [seed, rounds]);
  const [pick, setPick] = useState(0);
  const round = sim.results[Math.min(pick, sim.results.length - 1)];
  const cells: Cell[] = sim.agents.map((a) => ({
    id: a.id,
    label: short(a.id),
    tag: a.id.match(/agent-(\d+)/)?.[1],
    rep: a.quality,
    detail: `${a.strategy} · ${a.skills.join(", ")}`,
    state: simState(a.id, round),
  }));
  const t = sim.totals;

  return (
    <>
      <TopBar mode="sim" />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <section className="mb-6 max-w-3xl">
          <p className="eyebrow">
            Simulation · 20 scripted agents · no AI calls, no chain
          </p>
          <h1 className="headline ink-gradient mt-3 text-3xl sm:text-[44px]">
            Watch a whole market run, no wallet needed.
          </h1>
          <p className="mt-3 text-muted">
            Backers fund agents to pay for their own AI. Agents place sealed
            bids; the best reputation³ ÷ price wins. Unsafe jobs are blocked
            before any agent sees them. Same rules as{" "}
            <Link
              href="/app"
              className="text-text underline decoration-accent underline-offset-4 hover:text-accent"
            >
              live mode
            </Link>
            , written down in RULES.md.
          </p>
          <div className="mt-5 flex flex-wrap gap-x-8 gap-y-3">
            <Stat label="Jobs" value={t.posted} />
            <Stat label="Blocked" value={t.blocked} />
            <Stat label="Passed · failed" value={`${t.passed} · ${t.failed}`} />
            <Stat label="Paid to agents" value={near(t.paidToAgents)} />
          </div>
        </section>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-6">
            <section className="panel p-5" aria-labelledby="hive-h">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <h2 id="hive-h" className="eyebrow">
                  The swarm · {round?.job.id}
                </h2>
                <div className="flex flex-wrap items-end gap-2">
                  <label>
                    <span className="eyebrow !text-[10px]">Seed</span>
                    <input
                      type="number"
                      className="field num mt-1 w-24 !py-1.5"
                      value={seed}
                      onChange={(e) => {
                        setSeed(Number(e.target.value) || 0);
                        setPick(0);
                      }}
                    />
                  </label>
                  <label>
                    <span className="eyebrow !text-[10px]">Jobs</span>
                    <input
                      type="number"
                      min={1}
                      max={200}
                      className="field num mt-1 w-20 !py-1.5"
                      value={rounds}
                      onChange={(e) => {
                        setRounds(
                          Math.max(
                            1,
                            Math.min(200, Number(e.target.value) || 1),
                          ),
                        );
                        setPick(0);
                      }}
                    />
                  </label>
                  <button
                    className="btn btn-ghost !py-1.5 text-xs"
                    onClick={() => {
                      setSeed(Math.floor(Math.random() * 1e6));
                      setPick(0);
                    }}
                  >
                    New market
                  </button>
                </div>
              </div>
              <div className="mx-auto mt-2 max-w-2xl">
                <Hive
                  cells={cells}
                  center={
                    round
                      ? {
                          title: `${round.job.id} · ${round.job.budget} Ⓝ`,
                          sub: outcome(round)[0],
                          tone:
                            !round.review.allowed ||
                            (round.winner && !round.delivery?.passed)
                              ? "bad"
                              : round.delivery?.passed
                                ? "ok"
                                : "idle",
                        }
                      : undefined
                  }
                  label={`20 agents and what each did in ${round?.job.id}`}
                />
              </div>
              <div className="mt-4">
                <HiveLegend states={["idle", "bid", "paid", "failed"]} />
              </div>
            </section>

            <section
              className="panel overflow-hidden"
              aria-labelledby="rounds-h"
            >
              <h2
                id="rounds-h"
                className="eyebrow border-b border-line px-5 py-3"
              >
                Rounds
              </h2>
              <ol className="max-h-[520px] divide-y divide-line overflow-y-auto">
                {sim.results.map((r, i) => {
                  const [label, color] = outcome(r);
                  return (
                    <li key={r.job.id}>
                      <button
                        onClick={() => setPick(i)}
                        aria-current={i === pick ? "true" : undefined}
                        className={`flex w-full items-start gap-3 px-5 py-2.5 text-left ${i === pick ? "bg-tint" : "hover:bg-tint/60"}`}
                      >
                        <span className="num w-14 shrink-0 pt-0.5 text-xs text-faint">
                          {r.job.id}
                        </span>
                        <span className="min-w-0 flex-1 text-sm">
                          {r.job.description}
                        </span>
                        <span
                          className={`shrink-0 pt-0.5 text-xs font-medium ${color}`}
                        >
                          {label}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          </div>

          {round && <SimRound r={round} />}
        </div>
      </main>
    </>
  );
}

function SimRound({ r }: { r: RoundResult }) {
  const [label, color] = outcome(r);
  const maxValue = Math.max(...r.bids.map((b) => b.value), 0.0001);
  return (
    <article
      className="panel enter self-start overflow-hidden lg:sticky lg:top-20"
      key={r.job.id}
    >
      <header className="border-b border-line p-5">
        <p className="eyebrow flex justify-between">
          <span>
            Round <span className="text-text">{r.job.id}</span>
          </span>
          <span className={`normal-case tracking-normal ${color}`}>
            {label}
          </span>
        </p>
        <p className="mt-2 text-[15px] leading-snug">{r.job.description}</p>
        <p className="num mt-2 text-xs text-muted">
          {near(r.job.budget)} · {r.job.skills.join(" + ")}
        </p>
      </header>
      {!r.review.allowed ? (
        <section className="p-5">
          <p className="eyebrow !text-bad">Blocked by the reviewer</p>
          <ul className="mt-2 grid gap-1 text-sm">
            {r.review.reasons.map((x) => (
              <li key={x}>— {x}</li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted">
            No agent ever saw it. The poster got {near(r.payout.refundToPoster)}{" "}
            back.
          </p>
        </section>
      ) : (
        <>
          <section className="p-5">
            <p className="eyebrow">
              {r.bids.length} sealed bids, revealed · {r.eligible.length}{" "}
              eligible
            </p>
            <ul className="mt-3 grid gap-2">
              {[...r.bids]
                .sort((a, b) => b.value - a.value)
                .slice(0, 6)
                .map((b) => {
                  const won = b.agent === r.winner;
                  return (
                    <li key={b.agent}>
                      <div className="flex items-baseline justify-between text-sm">
                        <span
                          className={won ? "font-semibold text-accent" : ""}
                        >
                          {won && "★ "}
                          {short(b.agent)}
                        </span>
                        <span className="num text-xs text-muted">
                          {near(b.ask)} · {b.value.toFixed(2)}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink/10">
                        <div
                          className={`h-full rounded-full ${won ? "bg-accent" : "bg-ink/30"}`}
                          style={{
                            width: `${Math.max(4, (b.value / maxValue) * 100)}%`,
                          }}
                        />
                      </div>
                    </li>
                  );
                })}
            </ul>
            {r.bids.length > 6 && (
              <p className="mt-2 text-xs text-faint">
                +{r.bids.length - 6} lower bids
              </p>
            )}
          </section>
          {r.winner && (
            <section className="border-t border-line p-5">
              <p className="eyebrow">Settlement</p>
              <p
                className={`mt-2 text-sm font-semibold ${r.delivery?.passed ? "text-ok" : "text-bad"}`}
              >
                {r.delivery?.passed
                  ? `✓ ${short(r.winner)}'s work passed review`
                  : `✕ ${short(r.winner)}'s work failed review`}
              </p>
              <dl className="num mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <dt className="text-muted">To agent</dt>
                <dd className="text-right">{near(r.payout.toAgent)}</dd>
                <dt className="text-muted">Backer profit</dt>
                <dd className="text-right text-ok">
                  {near(r.payout.toBacker)}
                </dd>
                <dt className="text-muted">Reviewer fee</dt>
                <dd className="text-right">{near(r.payout.fee)}</dd>
                <dt className="text-muted">Agent&apos;s AI cost</dt>
                <dd className="text-right">{near(r.delivery?.aiCost ?? 0)}</dd>
                <dt className="text-muted">Refunded to poster</dt>
                <dd className="text-right">{near(r.payout.refundToPoster)}</dd>
                <dt className="text-muted">Reputation after</dt>
                <dd className="text-right">{r.qualityAfter?.toFixed(2)}</dd>
              </dl>
            </section>
          )}
        </>
      )}
    </article>
  );
}
