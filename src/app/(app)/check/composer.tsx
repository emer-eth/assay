"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { useEscrowPost } from "@/components/escrow-post";
import { PAY_STEP_LABEL, useAuth } from "@/components/wallet";
import { detectCheck } from "@/lib/live/detect";
import { duration, type StageTimes } from "@/lib/live/timeline";
import { BETA_SKILLS, SKILLS, type Skill } from "@/lib/swarm/types";
import { Button, CONTAINER, Field, Footer, Label, Tag, explorerTx } from "@/ui";

// The composer (build spec, New check): the target and your question, a budget, then pay into escrow.
// The check type is detected from the text as you type; the server confirms the target exists, then the
// existing escrow flow (components/escrow-post.ts) takes the payment and the page moves to the new round.

const CHECK_NAME: Record<Skill, string> = { "due-diligence": "Due diligence", "contract-review": "Code review", "proposal-review": "Proposal review", "tx-forensics": "Tx forensics" };
const EXAMPLES: { label: string; text: string }[] = [
  { label: "Ref Finance", text: "Before I deposit: who controls v2.ref-finance.near, can its code be changed, and by whom?" },
  { label: "DAO proposal", text: "I'm on the council: what will proposal #1059 on ref-finance.sputnik-dao.near actually do, and does it match its description?" },
  { label: "Failed transaction", text: "My NEAR Intents transfer in transaction 6DhuhcBjTPqFPBRCaZKY3EUz9bjvyPdtXajqQWrGACjg failed. Why, who actually signed it, and where's my money?" },
  { label: "Contract repo", text: "Review https://github.com/near-examples/guest-book-examples/tree/main/contract-rs for storage and payable-method issues, with fixes." },
];
const MIN = 0.05;
const MAX = 5;

type Times = { [K in keyof StageTimes]: number | null } | null;
type Target = { state: "idle" | "checking" | "ok" | "problem"; problem?: string };

export function Composer({ initialText, winning, needsKey, times, codeGrade }: { initialText: string; winning: Partial<Record<Skill, { min: number; max: number; n: number }>>; needsKey: boolean; times: Times; codeGrade: number | null }) {
  const router = useRouter();
  const { account } = useAuth();
  const [text, setText] = useState(initialText);
  const [override, setOverride] = useState<Skill | null>(null);
  const [changing, setChanging] = useState(false);
  const [budget, setBudget] = useState("0.30");
  const [liveKey, setLiveKey] = useState("");
  const [result, setResult] = useState<{ key: string; ok: boolean; problem?: string } | null>(null);

  useEffect(() => {
    try {
      // Read after mount so the server render and the first browser render match.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLiveKey(localStorage.getItem("swarm-live-key") || "");
    } catch {}
  }, []);

  const detected = useMemo(() => detectCheck(text), [text]);
  const skill: Skill | null = override ?? detected?.skill ?? null;
  const amount = Number(budget);
  const budgetError = budget && (!Number.isFinite(amount) || amount < MIN || amount > MAX) ? `Set a budget from ${MIN} to ${MAX} NEAR.` : undefined;

  // Does the target exist? Asked once the text settles, the same check the server repeats at posting.
  // "Checking" is derived: the answer on hand belongs to different text.
  const key = skill && text.trim().length >= 10 ? `${skill}|${text}` : null;
  const target: Target = !key ? { state: "idle" } : result?.key !== key ? { state: "checking" } : result.ok ? { state: "ok" } : { state: "problem", problem: result.problem };
  useEffect(() => {
    if (!key || !skill) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/check/target", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q: text, skill }), signal: ctl.signal });
        const data = await res.json();
        setResult({ key, ok: !!data.ok, problem: data.problem });
      } catch {
        // Couldn't ask (offline, aborted): don't block posting; the server checks again when it's posted.
        if (!ctl.signal.aborted) setResult({ key, ok: true });
      }
    }, 700);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [key, skill, text]);

  // Once the server confirms the payment, say so and keep the button locked while the round page opens
  // (it takes a few seconds). Without this the form looked untouched and invited a second payment.
  const [posted, setPosted] = useState<string | null>(null);
  const post = useEscrowPost(liveKey, (data) => {
    if (!data.id) return;
    setPosted(data.id);
    router.push(`/rounds/${data.id}?new`);
  });
  const ready = !posted && !!skill && text.trim().length >= 10 && !budgetError && target.state !== "problem" && target.state !== "checking";
  const payLabel = `${account ? "Pay" : "Connect wallet and pay"} ${Number.isFinite(amount) ? amount.toFixed(2) : "—"} NEAR`;
  const win = skill ? winning[skill] : undefined;
  const t = (ms: number | null | undefined, fallback: string) => (ms == null ? fallback : duration(ms));

  return (
    <>
      <AppHeader />
      <main id="main" className={`${CONTAINER} pt-12`}>
        <Label>New check</Label>
        <h1 className="mt-3 font-archivo text-[40px] leading-[1.05] font-extrabold text-ink sm:text-[58px]">What should be checked?</h1>

        <div className="mt-12 grid grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-[minmax(0,1fr)_380px]">
          <form
            className="space-y-12"
            onSubmit={(e) => {
              e.preventDefault();
              if (ready && skill) void post.run({ description: text.trim(), skills: [skill], budget: amount });
            }}
          >
            <section aria-labelledby="s1">
              <h2 id="s1" className="flex items-baseline gap-3 border-b-2 border-ink pb-3 text-lg font-semibold"><span className="font-mono text-sm">1</span> The target and your question</h2>
              <div className="mt-5">
                <Field
                  multiline
                  label="Name the account, proposal, transaction or repo. Say what you need to know."
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setOverride(null);
                  }}
                  placeholder="Before I deposit: who controls v2.ref-finance.near, and can its code be changed?"
                  maxLength={4000}
                />
              </div>
              <div role="status" aria-live="polite" className={`mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-[15px] ${skill ? "bg-stamp-tint" : "bg-tint"}`}>
                {skill ? (
                  <>
                    <span className="font-mono text-sm font-semibold tracking-[0.08em] text-stamp uppercase">{CHECK_NAME[skill]}</span>
                    {BETA_SKILLS.includes(skill) && <Tag tone="refund">Beta</Tag>}
                    <span className="min-w-0 flex-1 text-ink">
                      {target.state === "problem" ? (
                        <span className="text-refund">{target.problem}</span>
                      ) : (
                        <>
                          {detected && !override ? <>Found <span className="font-mono">{detected.target}</span>{target.state === "checking" ? " (checking it exists…)" : ""}. {detected.reads}</> : <>You chose {CHECK_NAME[skill].toLowerCase()}.</>}
                        </>
                      )}
                    </span>
                    <button type="button" className="min-h-11 text-stamp underline underline-offset-2" onClick={() => setChanging((v) => !v)} aria-expanded={changing}>Change type</button>
                  </>
                ) : (
                  <span className="text-ink-2">{text.trim() ? "Name an account (name.near), a DAO proposal number, a transaction hash or a GitHub repo." : "The check type appears here as you type."}</span>
                )}
              </div>
              {changing && (
                <fieldset className="mt-3 flex flex-wrap gap-2">
                  <legend className="sr-only">Check type</legend>
                  {SKILLS.map((s) => (
                    <button key={s} type="button" aria-pressed={skill === s} onClick={() => { setOverride(s); setChanging(false); }} className={`min-h-11 rounded-[2px] border px-4 text-[15px] ${skill === s ? "border-ink bg-ink text-on-ink" : "border-ink text-ink hover:bg-tint"}`}>
                      {CHECK_NAME[s]}
                    </button>
                  ))}
                </fieldset>
              )}
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <span className="text-[15px] text-ink-2">Start from an example</span>
                {EXAMPLES.map((ex) => (
                  <button key={ex.label} type="button" onClick={() => { setText(ex.text); setOverride(null); }} className="min-h-11 rounded-[2px] border border-ink px-4 text-[15px] text-ink hover:bg-tint">{ex.label}</button>
                ))}
              </div>
            </section>

            <section aria-labelledby="s2">
              <h2 id="s2" className="flex items-baseline gap-3 border-b-2 border-ink pb-3 text-lg font-semibold"><span className="font-mono text-sm">2</span> Budget</h2>
              <div className="mt-5 grid items-end gap-6 sm:grid-cols-[220px_1fr]">
                <Field label="The most you will pay" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} suffix="NEAR" error={budgetError} />
                <p className="pb-3 text-[15px] text-ink-2">
                  {win ? <>Winning bids for {CHECK_NAME[skill!].toLowerCase()} have been <span className="font-mono text-ink">{win.min === win.max ? win.min : `${win.min}–${win.max}`} NEAR</span> lately. </> : null}
                  You pay the winning bid. The rest comes back in the same transaction.
                </p>
              </div>
            </section>

            <section aria-labelledby="s3">
              <h2 id="s3" className="flex items-baseline gap-3 border-b-2 border-ink pb-3 text-lg font-semibold"><span className="font-mono text-sm">3</span> Pay into escrow</h2>
              <dl className="mt-5 grid gap-5 sm:grid-cols-3">
                <div><dt className="text-sm text-ink-2">Held by the contract</dt><dd className="mt-1 font-mono text-lg text-ink">{Number.isFinite(amount) ? amount.toFixed(2) : "—"} NEAR</dd></div>
                <div><dt className="text-sm text-ink-2">If a report passes</dt><dd className="mt-1 text-[16px] text-ink">You pay the winning bid</dd></div>
                <div><dt className="text-sm text-ink-2">If nothing passes</dt><dd className="mt-1 text-[16px] text-ink">You pay nothing</dd></div>
              </dl>
              {needsKey && (
                <div className="mt-6 max-w-sm">
                  <Field label="Access key for this demo" type="password" value={liveKey} onChange={(e) => { setLiveKey(e.target.value); try { localStorage.setItem("swarm-live-key", e.target.value); } catch {} }} />
                </div>
              )}
              <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
                <Button type="submit" variant="pay" size="lg" disabled={!ready} busy={posted ? "Opening your round…" : post.step ? PAY_STEP_LABEL[post.step] : undefined}>{payLabel}</Button>
                <p className="text-[15px] text-ink-2">Testnet NEAR is free. No account yet? <a href="https://testnet.mynearwallet.com/" target="_blank" rel="noreferrer" className="text-stamp underline underline-offset-2">Create one in a minute</a>.</p>
              </div>
              {posted && (
                <p role="status" className="mt-5 border-l-4 border-stamp bg-stamp-tint px-4 py-3 text-[15px] text-ink">
                  Payment confirmed. Round <a href={`/rounds/${posted}?new`} className="font-mono text-stamp underline underline-offset-2">{posted}</a> is starting, and the page is opening it now.
                </p>
              )}
              {post.error && (
                <div role="alert" className="mt-5 border-l-4 border-refund bg-sheet px-4 py-3 text-[15px]">
                  <p className="text-refund">{post.error}</p>
                  {post.pending && (
                    <p className="mt-2 flex flex-wrap items-center gap-3 text-ink-2">
                      Your payment went through (<a className="font-mono text-stamp underline" href={explorerTx(post.pending.txHash)} target="_blank" rel="noreferrer">{post.pending.txHash.slice(0, 8)}…</a>), so you won&apos;t pay twice.
                      <Button variant="secondary" onClick={() => void post.retry()}>Try again with this payment</Button>
                    </p>
                  )}
                </div>
              )}
            </section>
          </form>

          <aside className="h-fit border border-rule bg-sheet p-7" aria-labelledby="next">
            <h2 id="next" className="text-lg font-semibold">What happens next</h2>
            <ol className="mt-5 border-t border-rule">
              {[
                ["A reviewer checks the job is real and safe", t(times?.review, "a few seconds")],
                ["Tools read the target on chain", t(times?.tools, "a few seconds")],
                ["Agents send sealed bids", t(times?.bids, "under a minute")],
                ["The winner writes the report", t(times?.work, "under a minute")],
                ["The reviewer grades it and the contract settles", skill === "contract-review" ? `${t(codeGrade, "a few minutes")}, up to 10 min` : t(times?.grade, "a minute or two")],
              ].map(([what, when], i) => (
                <li key={i} className="flex gap-4 border-b border-rule py-4 text-[15px]">
                  <span className="font-mono text-sm text-ink-2">{String(i + 1).padStart(2, "0")}</span>
                  <span className="flex-1 text-ink">{what}</span>
                  <span className="font-mono text-sm whitespace-nowrap text-ink-2">{when}</span>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-xs text-ink-2">Typical times, measured from recent rounds.</p>
            <ul className="mt-5 list-disc space-y-2 pl-5 text-[15px] text-ink">
              <li>Only you can read the report.</li>
              <li>If a round stalls, you can reclaim your budget after 60 minutes.</li>
              <li>You can close this page. The round keeps running at its own link.</li>
            </ul>
          </aside>
        </div>
      </main>
      <Footer />
    </>
  );
}
