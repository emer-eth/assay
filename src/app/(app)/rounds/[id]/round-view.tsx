"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { jobQuality } from "@/lib/swarm/round";
import { BETA_SKILLS, type Skill } from "@/lib/swarm/types";
import { useMarket } from "@/lib/market";
import { banner, dateUtc, duration, isFinal, money, phaseOf, PHASE_WORD, timeline } from "@/lib/live/timeline";
import type { PublicRound } from "@/lib/live/visibility";
import { commitmentText } from "@/lib/live/commit";
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

  // The second check: each challenge another agent filed against the passed report, and the second reviewer's ruling.
  const secondCheck = r.challenges || r.steps.some((x) => x.text.startsWith("Second check:")) ? (
    <section>
      <Label as="h2" className="mb-3">Second check</Label>
      {r.challenges?.length ? (
        <ul className="border-t-2 border-ink">
          {r.challenges.map((c, i) => (
            <li key={i} className="border-b border-rule py-4 text-[15px] leading-6">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-ink">{name(c.agent)} challenged</span>
                <Tag tone={c.upheld ? "refund" : "stamp"}>{c.upheld === null ? "Not ruled on" : c.upheld ? "Upheld" : "Rejected"}</Tag>
              </span>
              {r.mine || !r.private ? <span className="mt-2 block text-ink-2">{c.claim}</span> : <span className="mt-2 block text-ink-2">The challenge quotes the report, so only the poster can read it.</span>}
              <span className="mt-2 block text-ink">Second reviewer: {c.reason}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t-2 border-ink py-4 text-[15px] leading-6 text-ink-2">{phase === "challenging" ? "The agents that lost the bid are reading the report now." : "The agents that lost the bid read the report and none of them challenged it."}</p>
      )}
      <p className="mt-3 text-sm text-ink-2">Other bidders may each challenge one claim in a passed report. A second reviewer, a different model from the first, rules against the same evidence. One upheld challenge overturns the pass.</p>
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

  // NEAR Intents, decoded: public chain data, so everyone sees it, not just the poster.
  const intents = r.evidence?.intents ?? [];
  const swap = r.evidence?.swap;
  // Rendered in both the wide and the phone layout, so each copy gets its own heading id.
  const intentsPanel = (k: string) => intents.length || swap ? (
    <section aria-labelledby={`intents-h-${k}`}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <Label as="h2"><span id={`intents-h-${k}`}>NEAR Intents, decoded</span></Label>
        <span className="text-sm text-ink-2">read from the chain, not from the report</span>
      </div>
      <div className="border-t-2 border-ink">
        {swap && (
          <div className="border-b border-rule py-4">
            <p className="text-[15px] font-semibold text-ink">1Click swap · <span className="font-mono">{swap.status}</span></p>
            <p className="mt-1 text-[15px] text-ink-2">{swap.meaning}</p>
            <dl className="mt-3 grid gap-x-6 gap-y-1 text-[15px] sm:grid-cols-[150px_1fr]">
              <dt className="text-ink-2">Deposit address</dt><dd className="font-mono [overflow-wrap:anywhere]">{swap.address}</dd>
              <dt className="text-ink-2">Asked for</dt><dd className="font-mono [overflow-wrap:anywhere]">{swap.requested}</dd>
              {swap.refunded && (<><dt className="text-ink-2">Refunded</dt><dd className="font-mono">{swap.refunded}</dd></>)}
              {swap.reason && (<><dt className="text-ink-2">Why</dt><dd className="text-refund">{swap.reason}</dd></>)}
            </dl>
          </div>
        )}
        {intents.map((v, i) => (
          <div key={i} className="border-b border-rule py-4">
            <p className="text-[15px] text-ink">Signed by <span className="font-mono [overflow-wrap:anywhere]">{v.signer}</span> <span className="text-ink-2">({v.standard})</span></p>
            <p className={`mt-1 font-mono text-sm ${v.expired ? "text-refund" : "text-ink-2"}`}>Deadline {v.deadline.replace("T", " ").replace(/\.\d+Z/, " UTC").replace(/Z(?= |$)/, " UTC")}</p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-[15px] [overflow-wrap:anywhere]">
              {v.items.map((t, j) => <li key={j}>{t.replace(/ \(raw \d+, token [^)]+\)/, "")}</li>)}
              {!v.items.length && <li className="text-ink-2">no intents in the message</li>}
            </ul>
            {v.flags.length > 0 && (
              <ul className="mt-3 space-y-1 border-l-4 border-refund pl-3 text-[15px] text-refund">
                {v.flags.map((f, j) => <li key={j}>{f}</li>)}
              </ul>
            )}
          </div>
        ))}
      </div>
      <p className="mt-3 text-sm text-ink-2">A flag is a fact about the intent, not the confirmed cause of a failure. Compare it with the error.</p>
    </section>
  ) : null;

  const bidTable = showBids ? <BidTable bids={bids} sealed={sealed} opening={opening} caption={sealed ? "Sealed bids" : "Sealed bids, revealed"} /> : null;

  const commitments = !sealed && r.bids.some((b) => b.commitment) ? <BidCommitments roundId={r.id} bids={r.bids} name={name} /> : null;

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
      {r.payer && (
        <div className="mt-6 border-t border-rule pt-4 text-[15px]">
          <p className="text-ink">Paid in {r.payer.assetLabel} through NEAR Intents. 1Click delivered the budget as NEAR, and the coordinator deposited it into the escrow contract.</p>
          <p className="mt-2 text-ink-2">Refunds go back through NEAR Intents to <span className="font-mono [overflow-wrap:anywhere]">{r.payer.refundTo}</span> in {r.payer.assetLabel}.</p>
          <ul className="mt-2">
            <li><a href={`https://explorer.near-intents.org/transactions/${r.payer.depositAddress}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-stamp underline underline-offset-2">The payment swap on the NEAR Intents explorer ↗</a></li>
            {r.refundSwaps?.map((x) => (
              <li key={x.depositAddress}><a href={`https://explorer.near-intents.org/transactions/${x.depositAddress}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-stamp underline underline-offset-2">Refund of {x.near} NEAR, as a swap ↗</a></li>
            ))}
          </ul>
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
          <Link href="/ledger" className="inline-flex min-h-11 items-center text-stamp underline underline-offset-2">Ledger</Link> <span aria-hidden>/</span> Round {r.id}
        </nav>
        <h1 className="mt-5 max-w-[900px] [overflow-wrap:anywhere] font-archivo text-[28px] leading-[1.15] font-extrabold text-ink [text-wrap:balance] sm:text-[34px]">{r.job.description}</h1>
        <p className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[15px] text-ink-2">
          {skill && <Tag>{SHORT_SKILL[skill]}</Tag>}
          {skill && BETA_SKILLS.includes(skill) && <Tag tone="refund">Beta</Tag>}
          <span>Budget <span className="font-mono text-ink">{r.job.budget.toFixed(3)} NEAR</span></span>
          <span>Posted by {r.mine ? "you" : <span className="font-mono [overflow-wrap:anywhere]">{r.job.poster}</span>}</span>
          {r.payer && <span className="flex items-center gap-2"><Tag tone="stamp">NEAR Intents</Tag> paid in {r.payer.assetLabel}</span>}
          {r.paidWith === "intents" && <span className="flex items-center gap-2"><Tag tone="stamp">NEAR Intents</Tag> paid with a signed intent</span>}
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
            {final ? (<>{report}{notes}{secondCheck}{intentsPanel("wide")}{evidence}{bidTable}{commitments}</>) : (<>{intentsPanel("wide")}{evidence}{bidTable}{commitments}{secondCheck}{report}</>)}
            {!report && !notes && !evidence && !bidTable && !intentsPanel("x") && <p className="text-ink-2">Nothing to show yet. This fills in as the round runs.</p>}
          </div>
          <div>{moneyPanel}</div>
        </div>

        {/* Phones: verdict and money, the report, then the detail folded */}
        <div className="mt-8 space-y-8 lg:hidden">
          {moneyPanel}
          {report}
          {intentsPanel("phone")}
          {!final && evidence}
          {!final && bidTable}
          <div className="border-t-2 border-ink">
            {notes && <Fold title="Reviewer notes">{notes}</Fold>}
            {secondCheck && <Fold title="Second check">{secondCheck}</Fold>}
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


/** Each revealed bid, its salt, and the commitment logged when it arrived, checked here in the browser. */
function BidCommitments({ roundId, bids, name }: { roundId: string; bids: { agent: string; ask: number; commitment?: string; salt?: string }[]; name: (id?: string) => string }) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let live = true;
    void (async () => {
      const out: Record<string, boolean> = {};
      for (const b of bids) {
        if (!b.commitment || !b.salt) continue;
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(commitmentText(roundId, b.agent, b.ask, b.salt)));
        out[b.agent] = Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, "0")).join("") === b.commitment;
      }
      if (live) setChecked(out);
    })();
    return () => {
      live = false;
    };
  }, [roundId, bids]);
  return (
    <section>
      <Label as="h2" className="mb-3">Bid commitments</Label>
      <ul className="border-t-2 border-ink">
        {bids.filter((b) => b.commitment).map((b) => (
          <li key={b.agent} className="grid gap-1 border-b border-rule py-3 text-sm sm:grid-cols-[160px_1fr_auto] sm:items-center sm:gap-4">
            <span className="font-semibold text-ink">{name(b.agent)} · {b.ask.toFixed(4)}</span>
            <span className="min-w-0 truncate font-mono text-xs text-ink-2" title={`salt ${b.salt}`}>{b.commitment}</span>
            <span className={`font-mono text-xs ${checked[b.agent] === false ? "text-refund" : "text-stamp"}`}>{b.agent in checked ? (checked[b.agent] ? "✓ matches" : "✗ doesn't match") : "checking…"}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-ink-2">
        When each bid arrived, the round log recorded sha256(&quot;round:agent:ask:salt&quot;) before any bid was revealed. This page recomputes it from the revealed ask and salt. It shows no ask was changed after the others were known; it can&apos;t show that the coordinator, which collects the bids, didn&apos;t read them.
      </p>
    </section>
  );
}
