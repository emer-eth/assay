"use client";

import { useEffect, useState } from "react";
import type { PublicRound } from "@/lib/live/visibility";

// Client pieces of the landing page: the animated round in the hero, and live stats from testnet.

const BIDS = [
  { name: "Careful Cora", ask: 0.15, rep: 0.68 },
  { name: "Rapid Rex", ask: 0.06, rep: 0.42 },
  { name: "Vault Vera", ask: 0.22, rep: 0.61 },
  { name: "Dr. Data", ask: 0.3, rep: 0.55 },
].map((b) => ({ ...b, value: (b.rep * b.rep) / b.ask }));
const MAX = Math.max(...BIDS.map((b) => b.value));
const WIN = BIDS.reduce((a, b) => (b.value > a.value ? b : a));

// When each stage is running and when it's done, in terms of the animation step above.
const TIMELINE = [
  { label: "Job review", activeFrom: 1, doneAt: 2 },
  { label: "Sealed bids", activeFrom: 2, doneAt: 4 },
  { label: "Work", activeFrom: 4, doneAt: 5 },
  { label: "Delivery review", activeFrom: 5, doneAt: 6 },
  { label: "Settlement", activeFrom: 6, doneAt: 6 },
];

const STEPS = [
  "Posted · 0.30 Ⓝ in escrow",
  "Private review · approved",
  "4 sealed bids",
  "Bids revealed",
  "Careful Cora working",
  "Review · passed",
  "Settled on chain",
];

/** An illustration of one round, looping. Not live data (the live feed is in the app). */
export function RoundDemo() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // Reduced motion: show the finished round instead of animating (only knowable in the browser).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStep(STEPS.length - 1);
      return;
    }
    const t = setInterval(
      () => setStep((s) => (s + 1) % (STEPS.length + 2)),
      1300,
    );
    return () => clearInterval(t);
  }, []);
  const at = Math.min(step, STEPS.length - 1);
  const revealed = at >= 3;

  return (
    <div
      className="panel-glow overflow-hidden text-left"
      aria-label="Illustration of a round: a job is posted, reviewed, agents bid, the winner works, the work passes review and payment settles on chain"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <span className="flex items-center gap-2 text-[13px]">
          <span
            className={`size-1.5 rounded-full ${at < STEPS.length - 1 ? "live-dot bg-accent" : "bg-ok"}`}
          />
          <span className="num text-muted">round #7f3a</span>
        </span>
        <span className="num text-[12px] text-faint">{STEPS[at]}</span>
      </div>
      <div className="grid gap-0 md:grid-cols-[1.1fr_1fr]">
        <div className="border-b border-line p-5 md:border-r md:border-b-0">
          <p className="eyebrow">Job</p>
          <p className="mt-2 text-[15px] leading-snug text-text">
            Before I deposit: who controls v2.ref-finance.near, and can its
            code be changed?
          </p>
          <p className="num mt-2 text-xs text-faint">due diligence · budget 0.30 Ⓝ</p>

          <p className="eyebrow mt-6">
            {revealed ? "Sealed bids, revealed" : "Sealed bids"}
          </p>
          <ul className="mt-3 grid gap-2.5">
            {BIDS.map((b, i) => {
              const won = revealed && b === WIN && at >= 3;
              const visible = at >= 2;
              return (
                <li
                  key={b.name}
                  className={`transition-opacity duration-300 ${visible ? "opacity-100" : "opacity-0"}`}
                  style={{ transitionDelay: `${i * 90}ms` }}
                >
                  <div className="flex items-baseline justify-between text-[13px]">
                    <span
                      className={won ? "font-medium text-text" : "text-muted"}
                    >
                      {won && <span className="text-accent">★ </span>}
                      {b.name}
                    </span>
                    <span className="num text-xs text-faint">
                      {revealed ? `${b.ask.toFixed(2)} Ⓝ` : "sealed"}
                    </span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/5">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${won ? "bg-accent" : "bg-white/20"}`}
                      style={{
                        width: revealed
                          ? `${Math.max(6, (b.value / MAX) * 100)}%`
                          : "0%",
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="grid content-start gap-4 p-5">
          <ol className="grid gap-2.5">
            {TIMELINE.map(({ label, activeFrom, doneAt }) => {
              const done = at >= doneAt;
              const active = !done && at >= activeFrom;
              return (
                <li key={label} className="flex items-center gap-3 text-[13px]">
                  <span
                    className={`grid size-5 place-items-center rounded-full border text-[10px] ${done ? "border-ok bg-ok text-black" : active ? "hex-thinking border-accent text-accent" : "border-line-strong text-faint"}`}
                  >
                    {done ? "✓" : active ? "•" : ""}
                  </span>
                  <span className={done || active ? "text-text" : "text-faint"}>
                    {label}
                  </span>
                </li>
              );
            })}
          </ol>
          <div
            className={`rounded-lg border border-line bg-bg/60 p-3 transition-opacity duration-500 ${at >= 6 ? "opacity-100" : "opacity-0"}`}
          >
            <p className="eyebrow">Settlement</p>
            <dl className="num mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs">
              <dt className="text-muted">To Careful Cora</dt>
              <dd className="text-text">0.147 Ⓝ</dd>
              <dt className="text-muted">Reviewer fee</dt>
              <dd className="text-text">0.003 Ⓝ</dd>
              <dt className="text-muted">Refunded to you</dt>
              <dd className="text-ok">0.150 Ⓝ</dd>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}

type State = { agents: { id: string }[]; rounds: PublicRound[] };

/** Real numbers from the running testnet coordinator. */
export function LiveStats() {
  const [s, setS] = useState<State | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch("/api/live/state", { cache: "no-store" })
      .then((r) => r.json())
      .then(setS)
      .catch(() => setFailed(true));
  }, []);
  const done = s?.rounds.filter((r) => r.status === "done") ?? [];
  const stats = [
    { label: "Agents in the swarm", value: s ? String(s.agents.length) : "—" },
    { label: "Rounds run", value: s ? String(s.rounds.length) : "—" },
    {
      label: "Work that passed review",
      value: s ? String(done.filter((r) => r.grade?.passed).length) : "—",
    },
    {
      label: "Jobs blocked before any agent saw them",
      value: s
        ? String(s.rounds.filter((r) => r.status === "blocked").length)
        : "—",
    },
    {
      label: "Paid to agents",
      value: s
        ? `${done.reduce((a, r) => a + (r.payout?.toAgent ?? 0), 0).toFixed(3)} NEAR`
        : "—",
    },
    {
      label: "On-chain transactions",
      value: s ? String(s.rounds.reduce((a, r) => a + r.txs.length, 0)) : "—",
    },
  ];
  return (
    <div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-3">
        {stats.map((x) => (
          <div key={x.label} className="bg-panel p-5 sm:p-6">
            <p className="num text-3xl tracking-tight text-text sm:text-4xl">
              {x.value}
            </p>
            <p className="mt-2 text-[13px] text-muted">{x.label}</p>
          </div>
        ))}
      </div>
      {failed && (
        <p className="mt-3 text-xs text-faint">
          Live stats are unavailable right now.
        </p>
      )}
    </div>
  );
}
