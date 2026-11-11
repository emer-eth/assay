"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { jobQuality } from "@/lib/swarm/round";
import { BETA_SKILLS, type Skill } from "@/lib/swarm/types";
import { useMarket } from "@/lib/market";
import { banner, dateUtc, duration, isFinal, money, phaseOf, PHASE_WORD, timeline } from "@/lib/live/timeline";
import type { PublicRound } from "@/lib/live/visibility";
import { BidTable, Button, CONTAINER, Footer, Hallmark, Label, LockedReport, Markdown, MoneyBar, MoneyLedger, Sheet, StatusBanner, Stepper, Tag, TxLink, type BidRow } from "@/ui";

type AgentLite = { id: string; name: string; quality: number; skillQuality?: Partial<Record<Skill, number>>; model?: string };

const SHORT_SKILL: Record<Skill, string> = { "due-diligence": "Due diligence", "contract-review": "Code review", "proposal-review": "Proposal review", "tx-forensics": "Tx forensics" };

export function RoundView({ initial, agents: initialAgents }: { initial: PublicRound; agents: AgentLite[] }) {
  // Live: the market store pushes this round's changes; until it holds the round, the server's copy stands.
  const live = useMarket((s) => s?.rounds.find((x) => x.id === initial.id));
  const liveAgents = useMarket((s) => s?.agents);
  const r = live ?? initial;
  const agents: AgentLite[] = liveAgents ?? initialAgents;
  const phase = phaseOf(r);
  const b = useMemo(() => banner(r, agents), [r, agents]);
  const steps = useMemo(() => timeline(r, agents), [r, agents]);
  const m = useMemo(() => money(r, agents), [r, agents]);
  const name = (id?: string) => agents.find((a) => a.id === id)?.name ?? id?.split(".")[0] ?? "";

  // Motion plays only for changes this page sees happen, never on opening a round that already moved:
  // the hallmark lands on a pass, the bids open when bidding closes, the strike draws on a failed review.
  const prev = useRef({ phase, bids: initial.bids.length });
  const [land, setLand] = useState(false);
  const [opening, setOpening] = useState(false);
  const [failing, setFailing] = useState(false);
  useEffect(() => {
    const was = prev.current;
    if (was.phase !== phase && phase === "passed") setLand(true);
    if (was.phase !== phase && phase === "refunded" && r.grade) setFailing(true);
    if (was.bids === 0 && r.bids.length > 0) setOpening(true);
    prev.current = { phase, bids: r.bids.length };
  }, [phase, r.bids.length, r.grade]);

  useEffect(() => {
    document.title = `${PHASE_WORD[phase]} · ${r.id} · Assay`;
  }, [phase, r.id]);

  // Arriving from payment (?new): move focus to the status banner so a screen reader hears the round start.
  const statusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (new URLSearchParams(location.search).has("new")) statusRef.current?.querySelector<HTMLElement>("[role=status]")?.focus();
  }, []);

  const bids: BidRow[] = useMemo(() => {
    if (r.bids.length) {
      return [...r.bids]
        .sort((x, y) => y.value - x.value)
        .map((x) => ({ agent: name(x.agent), reputation: Math.cbrt(x.value * x.ask), ask: x.ask, value: x.value, winner: x.agent === r.winner }));
    }
    // Still sealed: who can bid, with their reputation in this job's skills.
    return r.eligible.map((id) => {
      const a = agents.find((x) => x.id === id);
      return { agent: name(id), reputation: a ? jobQuality(a, r.job) : 0.5 };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r, agents]);

  const final = isFinal(phase);
  const sealed = phase === "bidding";
  const showBids = bids.length > 0 && phase !== "blocked";
  const words = r.deliverable ? r.deliverable.split(/\s+/).filter(Boolean).length : r.deliveredWords;
  const skill = r.job.skills.find((s) => s in SHORT_SKILL); // rounds from before the four checks can carry retired skills
  const hasReport = !!(r.deliverable || r.deliveredWords);

  const report = hasReport ? (
    <Sheet
      label={r.deliverable ? <>Report · delivered by {name(r.winner)}<br />{words?.toLocaleString("en")} words · {r.mine ? "private to you" : "public demo round"}</> : <>Report · delivered by {name(r.winner)}</>}
      corner={phase === "passed" ? <Hallmark size={124} land={land} /> : undefined}
    >
      {r.deliverable ? (
        <>
          {failing && <span aria-hidden className="strike pointer-events-none absolute inset-x-6 top-1/2 h-[3px] origin-left bg-refund" />}
          {phase === "refunded" && <p className="mb-4 border-l-4 border-refund pl-3 text-sm text-ink-2">This report failed review, so you didn&apos;t pay for it. It&apos;s shown for reference.</p>}
          <Markdown text={r.deliverable} />
          <ReportActions r={r} />
        </>
      ) : (
        <LockedReport words={r.deliveredWords ?? 0} who="the poster" />
      )}
    </Sheet>
  ) : null;

  const notes = r.grade?.reasons.length || (phase === "blocked" && r.review?.reasons.length) ? (
    <section>
      <Label as="h2" className="mb-3">{phase === "blocked" ? "Why the reviewer refused it" : r.grade?.passed ? "Why the reviewer passed it" : "Why the reviewer failed it"}</Label>
      <ul className="border-t-2 border-ink">
        {(phase === "blocked" ? r.review!.reasons : r.grade!.reasons).map((x, i) => (
          <li key={i} className="border-b border-rule py-4 text-[15px] leading-6">{x}</li>
        ))}
      </ul>
    </section>
  ) : null;

  const evidence = r.evidence?.summary.length ? (
    <section>
      <Label as="h2" className="mb-3">What the tools read</Label>
      <ul className="border-t-2 border-ink">
        {r.evidence.summary.map((x, i) => (
          <li key={i} className="border-b border-rule py-3 text-[15px] leading-6">{x}</li>
        ))}
      </ul>
    </section>
  ) : null;

  const bidTable = showBids ? <BidTable bids={bids} sealed={sealed} opening={opening} caption={sealed ? "Sealed bids" : "Sealed bids, revealed"} /> : null;

  const chain = r.txs.length || r.deposit ? (
    <section>
      <Label as="h2" className="mb-1">On chain</Label>
      {r.deposit && <TxLink label="Deposit into escrow" hash={r.deposit} />}
      {r.txs.map((t) => <TxLink key={t.hash} label={t.label} hash={t.hash} />)}
    </section>
  ) : null;

  const moneyPanel = (
    <section className="border border-rule bg-sheet p-6">
      <Label as="h2" className="mb-4">Money</Label>
      <MoneyLedger lines={m.lines} total={m.total} note={m.note} />
      {m.settled && r.payout && r.payout.toAgent > 0 && (
        <div className="mt-6">
          <MoneyBar paid={r.payout.toAgent} fee={r.payout.fee} refunded={r.payout.refundToPoster} label={`Of ${r.job.budget} NEAR: ${r.payout.toAgent} to the agent, ${r.payout.fee} fee, ${r.payout.refundToPoster} back`} />
        </div>
      )}
      <div className="mt-6 hidden lg:block">{chain}</div>
    </section>
  );

  return (
    <>
      <AppHeader />
      <main id="main" className={`${CONTAINER} pt-10 ${failing ? "fail-play" : ""}`}>
        <nav aria-label="Breadcrumb" className="font-mono text-sm text-ink-2">
          <Link href="/ledger" className="text-stamp underline underline-offset-2">Ledger</Link> <span aria-hidden>/</span> Round {r.id}
        </nav>
        <h1 className="mt-5 max-w-[900px] [overflow-wrap:anywhere] font-archivo text-[28px] leading-[1.15] font-extrabold text-ink [text-wrap:balance] sm:text-[34px]">{r.job.description}</h1>
        <p className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[15px] text-ink-2">
          {skill && <Tag>{SHORT_SKILL[skill]}</Tag>}
          {skill && BETA_SKILLS.includes(skill) && <Tag tone="refund">Beta</Tag>}
          <span>Budget <span className="font-mono text-ink">{r.job.budget.toFixed(3)} NEAR</span></span>
          <span>Posted by {r.mine ? "you" : <span className="font-mono">{r.job.poster}</span>}</span>
          <span className="font-mono">{dateUtc(r.createdAt)}</span>
        </p>

        <div ref={statusRef} className="mt-8">
          <StatusBanner
            verdict={b.verdict}
            running={b.running}
            title={b.title}
            detail={b.detail}
            aside={final && b.endedAt ? <>Finished in <span className="font-mono text-ink">{duration(Date.parse(b.endedAt) - Date.parse(b.startedAt))}</span></> : <Elapsed since={b.startedAt} />}
          />
        </div>

        {/* Wide screens: timeline | the bench | money */}
        <div className="mt-10 hidden gap-10 lg:grid lg:grid-cols-[250px_minmax(0,1fr)_330px]">
          <div><Label as="h2" className="mb-3">Timeline</Label><Stepper steps={steps} /></div>
          <div className="space-y-12">
            {final ? (<>{report}{notes}{evidence}{bidTable}</>) : (<>{evidence}{bidTable}{report}</>)}
            {!report && !notes && !evidence && !bidTable && <p className="text-ink-2">Nothing to show yet. This fills in as the round runs.</p>}
          </div>
          <div>{moneyPanel}</div>
        </div>

        {/* Phones: verdict and money, the report, then the detail folded */}
        <div className="mt-8 space-y-8 lg:hidden">
          {moneyPanel}
          {report}
          {!final && evidence}
          {!final && bidTable}
          <div className="border-t-2 border-ink">
            {notes && <Fold title="Reviewer notes">{notes}</Fold>}
            {final && evidence && <Fold title="What the tools read">{evidence}</Fold>}
            {final && bidTable && <Fold title="Bids">{bidTable}</Fold>}
            <Fold title="Timeline"><Stepper steps={steps} /></Fold>
            {chain && <Fold title="On chain">{chain}</Fold>}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

function Fold({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="faq border-b border-rule">
      <summary className="flex min-h-14 items-center justify-between text-[15px] font-semibold">
        {title}
        <span className="plus font-mono text-xl text-ink-2" aria-hidden>+</span>
      </summary>
      <div className="pb-6">{children}</div>
    </details>
  );
}

function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return null;
  const s = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  return <span className="font-mono text-ink" aria-label={`${s} seconds so far`}>{Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}</span>;
}

function ReportActions({ r }: { r: PublicRound }) {
  const [copied, setCopied] = useState(false);
  const text = r.deliverable ?? "";
  const download = () => {
    const md = `# ${r.job.description}\n\n${text}\n\n---\nRound ${r.id} on Assay. Reviewer: ${r.grade?.passed ? "passed" : "failed"}.\n`;
    const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `assay-${r.id}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="mt-6 flex flex-wrap gap-3 border-t border-rule pt-5">
      <Button onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {}
      }}>{copied ? "Copied" : "Copy report"}</Button>
      <Button variant="secondary" onClick={download}>Download .md</Button>
      <span className="sr-only" aria-live="polite">{copied ? "Report copied" : ""}</span>
    </div>
  );
}

