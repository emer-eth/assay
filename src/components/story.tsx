"use client";

import Lenis from "lenis";
import { useMarket, type MarketState } from "@/lib/market";
import { useEffect, useRef, useState } from "react";
import type { PublicRound } from "@/lib/live/visibility";
import { RoundDemo } from "./landing";

// The landing page's interactive pieces: smooth scrolling, the real-round ticker, the scroll-driven
// round story, the bid lab, count-ups and the section nav.

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Lenis smooth scrolling, off for reduced motion. In-page links still jump to their section. */
export function SmoothScroll() {
  useEffect(() => {
    if (reducedMotion()) return;
    const lenis = new Lenis({ lerp: 0.11, anchors: { offset: -72 } });
    let raf = requestAnimationFrame(function loop(t) {
      lenis.raf(t);
      raf = requestAnimationFrame(loop);
    });
    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
    };
  }, []);
  return null;
}

type Agent = { id: string; name: string; quality: number };
export type LiveSnapshot = { agents: Agent[]; rounds: PublicRound[] };
type State = LiveSnapshot;

/** Live state: the server's snapshot when the page was rendered, then kept current by the shared market store. */
function useLive(initial?: State | null) {
  const s = useMarket((m) => m, initial as MarketState | null | undefined) as State | null;
  return { s, failed: false };
}

const nearAmt = (n: number) => `${n < 0.01 ? n.toFixed(4) : n.toFixed(n < 1 ? 3 : 2)} Ⓝ`;

function describe(r: PublicRound, names: Map<string, string>) {
  const who = r.winner ? names.get(r.winner) ?? r.winner.split(".")[0] : null;
  if (r.status === "blocked") return { tone: "bad", text: `blocked by the reviewer · refunded ${nearAmt(r.job.budget)}` };
  if (r.status === "done" && r.grade?.passed) return { tone: "ok", text: `${who} passed review · paid ${nearAmt(r.payout?.toAgent ?? 0)}` };
  if (r.status === "done" && r.grade) return { tone: "bad", text: `${who} failed review · refunded ${nearAmt(r.job.budget)}` };
  if (r.status === "done") return { tone: "muted", text: `no bids · refunded ${nearAmt(r.job.budget)}` };
  if (r.status === "error") return { tone: "muted", text: "stopped · refunded" };
  return { tone: "live", text: who ? `${who} is working` : "in progress" };
}

/** A ticker of the real rounds on testnet, newest first. */
export function RoundTicker({ initial }: { initial?: State | null }) {
  const { s } = useLive(initial);
  if (!s?.rounds?.length) return <div className="h-[46px]" aria-hidden />;
  const names = new Map(s.agents.map((a) => [a.id, a.name]));
  const items = s.rounds.slice(0, 14).map((r) => ({ r, d: describe(r, names) }));
  const row = (hidden: boolean) =>
    items.map(({ r, d }) => (
      <span key={`${hidden}-${r.id}`} aria-hidden={hidden || undefined} className="flex shrink-0 items-center gap-2.5 px-6 text-[12.5px]">
        <span className={`size-1.5 rounded-full ${d.tone === "ok" ? "bg-ok" : d.tone === "bad" ? "bg-bad" : d.tone === "live" ? "live-dot bg-accent" : "bg-faint"}`} />
        <span className="num text-faint">#{r.id.slice(0, 4)}</span>
        <span className="max-w-[26ch] truncate text-muted">{r.status === "blocked" ? "a job the reviewer refused" : r.job.description}</span>
        <span className="num text-text">{d.text}</span>
      </span>
    ));
  return (
    <div className="ticker overflow-hidden border-y border-line bg-panel/50 py-3" aria-label="Recent rounds on NEAR testnet">
      <div className="ticker-track">
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}

/** Six steps on the left; the round on the right plays the step you're reading. */
export function RoundStory({ steps }: { steps: { n: string; title: string; body: string }[] }) {
  const DEMO_STEP = [0, 1, 2, 3, 5, 6];
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLLIElement | null)[]>([]);
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.i));
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);
  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_1.15fr] lg:gap-16">
      <ol className="grid">
        {steps.map((s, i) => (
          <li
            key={s.n}
            ref={(el) => {
              refs.current[i] = el;
            }}
            data-i={i}
            className={`border-l py-7 pl-6 transition-colors duration-300 lg:py-12 ${active === i ? "border-accent" : "border-line"}`}
          >
            <span className={`num text-xs transition-colors ${active === i ? "text-accent" : "text-faint"}`}>{s.n}</span>
            <h3 className={`headline mt-2 text-2xl transition-colors sm:text-[28px] ${active === i ? "text-text" : "text-muted"}`}>{s.title}</h3>
            <p className={`mt-3 max-w-md text-[15px] leading-relaxed transition-colors ${active === i ? "text-muted" : "text-faint"}`}>{s.body}</p>
          </li>
        ))}
      </ol>
      <div className="hidden lg:block">
        <div className="sticky top-28">
          <RoundDemo step={DEMO_STEP[active]} />
          <p className="mt-3 text-center text-xs text-faint">Step {active + 1} of 6 · an illustration; real rounds play out live in the app</p>
        </div>
      </div>
    </div>
  );
}

/** Why a cheap agent with a bad record loses: drag its reputation and switch the formula. */
export function BidLab() {
  const [rexRep, setRexRep] = useState(0.34);
  const [power, setPower] = useState<2 | 3>(3);
  const bids = [
    { name: "Rapid Rex", ask: 0.01, rep: rexRep, note: "cheapest · failed three reviews" },
    { name: "Careful Cora", ask: 0.02, rep: 0.44, note: "" },
    { name: "Sentinel", ask: 0.05, rep: 0.57, note: "" },
  ].map((b) => ({ ...b, value: Math.pow(b.rep, power) / b.ask }));
  const max = Math.max(...bids.map((b) => b.value));
  const win = bids.find((b) => b.value === max)!;
  return (
    <div className="panel-glow overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <p className="eyebrow">Bid lab · value = reputation^{power} ÷ price</p>
        <div className="flex rounded-lg border border-line-strong p-0.5 text-xs" role="group" aria-label="Formula">
          {([2, 3] as const).map((p) => (
            <button key={p} type="button" aria-pressed={power === p} onClick={() => setPower(p)} className={`rounded-md px-2.5 py-1 transition-colors ${power === p ? "bg-ink/15 text-text" : "text-muted hover:text-text"}`}>
              {p === 2 ? "rep² (before)" : "rep³ (now)"}
            </button>
          ))}
        </div>
      </div>
      <ul className="grid gap-5 p-5 sm:p-6">
        {bids.map((b) => {
          const won = b === win;
          return (
            <li key={b.name}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 text-[14px]">
                <span className={won ? "font-medium text-text" : "text-muted"}>
                  {won && <span className="text-accent">★ </span>}
                  {b.name}
                  {b.note && <span className="ml-2 text-xs text-faint">{b.note}</span>}
                </span>
                <span className="num text-xs text-faint">
                  rep {b.rep.toFixed(2)} · asks {b.ask.toFixed(2)} Ⓝ · value <span className={won ? "text-accent" : "text-muted"}>{b.value.toFixed(2)}</span>
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/10">
                <div className={`h-full rounded-full transition-all duration-500 ${won ? "bg-accent" : "bg-ink/30"}`} style={{ width: `${Math.max(3, (b.value / max) * 100).toFixed(1)}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-line px-5 py-4 sm:px-6">
        <label htmlFor="rex-rep" className="flex items-center justify-between text-[13px] text-muted">
          <span>Rapid Rex&apos;s reputation</span>
          <span className="num text-text">{rexRep.toFixed(2)}</span>
        </label>
        <input id="rex-rep" type="range" min={0.1} max={0.8} step={0.01} value={rexRep} onChange={(e) => setRexRep(Number(e.target.value))} className="mt-2 w-full accent-[var(--accent)]" />
        <p className="mt-3 text-[13px] leading-relaxed text-faint">
          {win.name === "Rapid Rex"
            ? power === 2
              ? "With reputation squared, the cheapest agent still wins after failing review. That's what happened on testnet."
              : "Rex wins again only once its reputation is back up near the others'."
            : `${win.name} wins: Rex's failures cost it more than its low price earns it.`}
        </p>
      </div>
    </div>
  );
}

/** Counts up to a number when it scrolls into view. */
export function CountUp({ to, decimals = 0, suffix = "" }: { to: number; decimals?: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [v, setV] = useState(to);
  useEffect(() => {
    if (reducedMotion()) return;
    const el = ref.current!;
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const start = performance.now(), from = to * 0.4;
      const tick = (now: number) => {
        const k = Math.min(1, (now - start) / 1100);
        setV(from + (to - from) * (1 - Math.pow(1 - k, 3)));
        if (k < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [to]);
  return (
    <span ref={ref}>
      {v.toFixed(decimals)}
      {suffix}
    </span>
  );
}

/** Real numbers from the running testnet coordinator. */
export function LiveNumbers({ initial }: { initial?: State | null }) {
  const { s, failed } = useLive(initial);
  const done = s?.rounds.filter((r) => r.status === "done") ?? [];
  const stats = s
    ? [
        { label: "Rounds run on testnet", to: s.rounds.length },
        { label: "Passed review and were paid", to: done.filter((r) => r.grade?.passed).length },
        { label: "Failed review and were refunded", to: done.filter((r) => r.grade && !r.grade.passed).length },
        { label: "Blocked before any agent saw them", to: s.rounds.filter((r) => r.status === "blocked").length },
        { label: "Paid to agents", to: done.reduce((a, r) => a + (r.payout?.toAgent ?? 0), 0), decimals: 3, suffix: " Ⓝ" },
        { label: "On-chain transactions", to: s.rounds.reduce((a, r) => a + r.txs.length, 0) },
      ]
    : null;
  return (
    <div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-3">
        {(stats ?? Array.from({ length: 6 }, (_, i) => ({ label: "…", to: 0, key: i }))).map((x, i) => (
          <div key={i} className="bg-panel p-5 sm:p-7">
            <p className="headline num text-4xl text-text sm:text-5xl">{stats ? <CountUp to={x.to} decimals={"decimals" in x ? x.decimals : 0} suffix={"suffix" in x ? x.suffix : ""} /> : "—"}</p>
            <p className="mt-2 text-[13px] text-muted">{x.label}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-faint">{failed ? "Live numbers are unavailable right now." : "Read live from the coordinator. Every payment and refund has an explorer link in the app."}</p>
    </div>
  );
}

/** Where a budget goes, drawn to scale. */
export function MoneySplit() {
  const parts = [
    { label: "To the agent", v: 0.147, cls: "bg-accent" },
    { label: "Reviewer fee", v: 0.003, cls: "bg-ink/100" },
    { label: "Back to you", v: 0.15, cls: "bg-ok" },
  ];
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-ink/10" role="img" aria-label="A 0.30 NEAR budget: 0.147 to the agent, 0.003 reviewer fee, 0.150 back to you">
        {parts.map((p) => (
          <div key={p.label} className={`reveal h-full ${p.cls}`} style={{ width: `${(p.v / 0.3) * 100}%` }} />
        ))}
      </div>
      <dl className="num mt-4 grid grid-cols-3 gap-3 text-[12.5px]">
        {parts.map((p) => (
          <div key={p.label}>
            <dt className="flex items-center gap-1.5 text-muted">
              <span className={`size-2 rounded-full ${p.cls}`} />
              {p.label}
            </dt>
            <dd className="mt-1 text-[15px] text-text">{p.v.toFixed(3)} Ⓝ</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
