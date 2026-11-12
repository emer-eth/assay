"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { useEscrowPost } from "@/components/escrow-post";
import { INTENTS_STEP_LABEL, useIntentsPost } from "@/components/intents-post";
import { PAY_STEP_LABEL, useAuth } from "@/components/wallet";
import { detectCheck } from "@/lib/live/detect";
import { IS_MAINNET, LIMITS, WALLET_SIGNUP } from "@/lib/network";
import { PAY_ASSETS, payAsset, refundAddressProblem } from "@/lib/live/pay-assets";
import { duration, type StageTimes } from "@/lib/live/timeline";
import { BETA_SKILLS, OFFERED_SKILLS, PAUSED_NOTE, PAUSED_SKILLS, type Skill } from "@/lib/swarm/types";
import { Button, CONTAINER, Field, Footer, Label, Tag, explorerTx } from "@/ui";

// The composer (build spec, New check): the target and your question, a budget, then pay into escrow.
// The check type is detected from the text as you type; the server confirms the target exists, then the
// existing escrow flow (components/escrow-post.ts) takes the payment and the page moves to the new round.

const CHECK_NAME: Record<Skill, string> = { "due-diligence": "Due diligence", "contract-review": "Code review", "proposal-review": "Proposal review", "tx-forensics": "Tx forensics" };
/** What each skill needs, shown before anything is detected so people see what the swarm can do. */
const SKILL_HINT: Record<Skill, string> = {
  "due-diligence": "Name an account: who controls it, and the red flags.",
  "proposal-review": "A Sputnik DAO and proposal number: what it really does.",
  "tx-forensics": "A transaction hash or 1Click deposit address: why it failed.",
  "contract-review": "A public GitHub link: findings with file, line and fix.",
};
/** One example per skill that the swarm has passed before, so a first job is one click. */
const SKILL_EXAMPLE: Partial<Record<Skill, string>> = {
  "due-diligence": "Before I deposit: who controls v2.ref-finance.near, can its code be changed, and by whom?",
  "proposal-review": "I'm on the council: what will proposal #1059 on ref-finance.sputnik-dao.near actually do, and does it match its description?",
  "tx-forensics": "Why did NEAR Intents transaction 5Z3yjXBhhzZ2281oSCxH8Seeh893TWKV9XEoq9S842Bi fail, who signed the intent, and was anything lost besides gas?",
  "contract-review": "Review https://github.com/near-examples/guest-book-examples/tree/main/contract-rs for storage and payable-method issues, with fixes.",
};
const ALL_EXAMPLES: { label: string; text: string; skill?: Skill }[] = [
  { label: "Ref Finance", text: "Before I deposit: who controls v2.ref-finance.near, can its code be changed, and by whom?" },
  { label: "DAO proposal", text: "I'm on the council: what will proposal #1059 on ref-finance.sputnik-dao.near actually do, and does it match its description?" },
  { label: "Failed Intents transfer", text: "Why did NEAR Intents transaction 5Z3yjXBhhzZ2281oSCxH8Seeh893TWKV9XEoq9S842Bi fail, who signed the intent, and was anything lost besides gas?" },
  { label: "Stuck cross-chain swap", text: "My NEAR Intents (1Click) swap never arrived. I sent the funds to the deposit address PASTE_THE_DEPOSIT_ADDRESS_HERE. Where is my money, and was it refunded?" },
  { label: "Contract repo", skill: "contract-review", text: SKILL_EXAMPLE["contract-review"]! },
];
const EXAMPLES = ALL_EXAMPLES.filter((e) => !e.skill || !PAUSED_SKILLS.includes(e.skill));
const PLACEHOLDER = "PASTE_THE_DEPOSIT_ADDRESS_HERE";
const MIN = 0.05;
const MAX = LIMITS.maxBudget;

type Times = { [K in keyof StageTimes]: number | null } | null;
type Target = { state: "idle" | "checking" | "ok" | "problem"; problem?: string };

export function Composer({ initialText, winning, takers: allTakers, privateTakers, needsKey, times, codeGrade }: { initialText: string; winning: Partial<Record<Skill, { min: number; max: number; n: number }>>; takers: Partial<Record<Skill, string[]>>; privateTakers: Partial<Record<Skill, string[]>>; needsKey: boolean; times: Times; codeGrade: number | null }) {
  const { account } = useAuth();
  const [text, setText] = useState(initialText);
  const [override, setOverride] = useState<Skill | null>(null);
  const [changing, setChanging] = useState(false);
  const [budget, setBudget] = useState("0.30");
  // The second check is on unless the poster turns it off: other agents read the report to look for a mistake.
  const [challenge, setChallenge] = useState(true);
  // Private-only: agents on NEAR AI's own private inference only (some agents run on OpenAI or Google, who would see the job).
  const [privateOnly, setPrivateOnly] = useState(false);
  const takers = privateOnly ? privateTakers : allTakers;
  const [liveKey, setLiveKey] = useState("");
  const [result, setResult] = useState<{ key: string; ok: boolean; problem?: string } | null>(null);

  useEffect(() => {
    try {
      // Read after mount so the server render and the first browser render match.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLiveKey(localStorage.getItem("swarm-live-key") || "");
    } catch {}
  }, []);

  // Text that reached the box before the page was interactive (typed or pasted early, or restored by the browser)
  // isn't in state yet: pick it up once, so the skill shows for it too.
  useEffect(() => {
    const box = document.querySelector<HTMLTextAreaElement>("main textarea");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from the DOM on mount
    if (box?.value && box.value !== text) setText(box.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const found = useMemo(() => detectCheck(text), [text]);
  // A paused skill (code review, for now) isn't offered: the text is read as naming nothing, and a note says why.
  const paused = !!found && PAUSED_SKILLS.includes(found.skill);
  const detected = paused ? null : found;
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

  // Once the server confirms the payment, say so, lock the button, and load the round page in full. A full load,
  // not an in-app push: the wallet's own overlay can stay open after approving and would cover the page, which
  // looked like the payment was stuck (live, 11 Nov). A fresh page clears it and always lands on the round.
  const [posted, setPosted] = useState<string | null>(null);
  const post = useEscrowPost(liveKey, (data) => {
    if (!data.id) return;
    setPosted(data.id);
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load is the point (see above)
    window.location.assign(`/rounds/${data.id}?new`);
  });
  // Three ways to pay: a signed NEAR Intents transfer (both networks), any token through 1Click (mainnet only),
  // or NEAR from the wallet straight into the escrow contract.
  const [method, setMethod] = useState<"intents" | "oneclick" | "wallet">("intents");
  const intentsPost = useIntentsPost(liveKey, (id) => {
    setPosted(id);
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load, as after any payment
    window.location.assign(`/rounds/${id}?new`);
  });
  const [assetKey, setAssetKey] = useState(PAY_ASSETS[0].key);
  const [refundTo, setRefundTo] = useState("");
  const [intents, setIntents] = useState<{ busy?: boolean; error?: string }>({});
  const asset = payAsset(assetKey)!;
  const refundProblem = refundTo.trim() ? refundAddressProblem(asset, refundTo) : null;
  async function payWithIntents() {
    setIntents({ busy: true });
    const res = await fetch("/api/pay", { method: "POST", headers: { "content-type": "application/json", ...(liveKey ? { "x-live-key": liveKey } : {}) }, body: JSON.stringify({ description: text.trim(), skills: [skill], budget: amount, challenge, privateOnly, asset: assetKey, refundTo }) }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    if (!res?.ok || !data?.id) return setIntents({ error: data?.error || "Couldn't reach Assay. Try again." });
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- the payment page is a fresh start
    window.location.assign(`/pay/${data.id}`);
  }
  // Why the pay button is disabled, said next to it (the first thing to fix).
  const blocked = posted
    ? null
    : text.trim().length < 10
      ? "Write what the swarm should check first (step 1)."
      : !skill
        ? paused ? PAUSED_NOTE : "Name what to check in step 1: an account, a DAO proposal or a transaction hash."
        : target.state === "problem"
          ? "Fix the target in step 1 first (see the red note there)."
          : target.state === "checking"
            ? "Checking the target exists…"
            : budgetError
              ? budgetError
              : method === "oneclick" && (!refundTo.trim() || refundProblem)
                ? "Add a valid refund address."
                : null;
  const ready = !posted && !!skill && text.trim().length >= 10 && !budgetError && target.state !== "problem" && target.state !== "checking" && (method !== "oneclick" || (!!refundTo.trim() && !refundProblem));
  const payLabel = `${account ? "Pay" : "Connect wallet and pay"} ${Number.isFinite(amount) ? amount.toFixed(2) : "—"} NEAR`;
  const win = skill ? winning[skill] : undefined;
  const t = (ms: number | null | undefined, fallback: string) => (ms == null ? fallback : duration(ms));

  return (
    <>
      <AppHeader />
      <main id="main" className={`${CONTAINER} pt-12`}>
        <Label>New job</Label>
        <h1 className="mt-3 font-archivo text-[40px] leading-[1.05] font-extrabold text-ink sm:text-[58px]">Give the swarm a job.</h1>

        <div className="mt-12 grid grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-[minmax(0,1fr)_380px]">
          <form
            className="space-y-12"
            onSubmit={(e) => {
              e.preventDefault();
              if (!ready || !skill) return;
              if (method === "intents") void intentsPost.run({ description: text.trim(), skills: [skill], budget: amount, challenge, privateOnly });
              else if (method === "oneclick") void payWithIntents();
              else void post.run({ description: text.trim(), skills: [skill], budget: amount, challenge, privateOnly });
            }}
          >
            <section aria-labelledby="s1">
              <h2 id="s1" className="flex items-baseline gap-3 border-b-2 border-ink pb-3 text-lg font-semibold"><span className="font-mono text-sm">1</span> The target and your question</h2>
              <div className="mt-5">
                <Field
                  multiline
                  label="Name the account, proposal, transaction or 1Click deposit address. Say what you need to know."
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setOverride(null);
                  }}
                  placeholder="For example: who controls v2.ref-finance.near, and can its code be changed?"
                  maxLength={4000}
                />
              </div>
              <div role="status" aria-live="polite" className={`mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-[15px] ${skill ? "bg-stamp-tint" : "bg-tint"}`}>
                {skill ? (
                  <>
                    <span className="font-mono text-sm font-semibold tracking-[0.08em] text-stamp uppercase">{CHECK_NAME[skill]}</span>
                    {BETA_SKILLS.includes(skill) && <Tag tone="refund">Beta</Tag>}
                    {detected?.intents && !override && <Tag tone="stamp">NEAR Intents</Tag>}
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
                  <span className="text-ink-2">{paused ? PAUSED_NOTE : text.includes(PLACEHOLDER) ? "Replace the placeholder with your swap's deposit address (it's selected: paste over it)." : text.trim() ? "No skill matched yet. Name an account (name.near), a DAO proposal number, a transaction hash or a 1Click deposit address, or pick the skill below." : "The swarm picks the skill from what you write. Type your question, or pick a skill:"}</span>
                )}
              </div>
              {!skill && !changing && (
                <fieldset className="mt-3">
                  <legend className="sr-only">The swarm&apos;s skills</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {OFFERED_SKILLS.map((s) => (
                      <div key={s} className="flex flex-col rounded-[2px] border border-rule bg-sheet hover:border-ink">
                        <button type="button" onClick={() => setOverride(s)} className="flex min-h-11 flex-col items-start px-4 pt-2.5 pb-1 text-left">
                          <span className="flex items-center gap-2 font-mono text-sm font-semibold tracking-[0.06em] text-ink uppercase">{CHECK_NAME[s]}{BETA_SKILLS.includes(s) && <Tag tone="refund">Beta</Tag>}</span>
                          <span className="mt-0.5 text-sm text-ink-2">{SKILL_HINT[s]}</span>
                        </button>
                        {SKILL_EXAMPLE[s] && (
                          <button type="button" onClick={() => { setText(SKILL_EXAMPLE[s]!); setOverride(null); }} className="min-h-11 px-4 pb-1 text-left text-sm text-stamp underline underline-offset-2">Run this example</button>
                        )}
                      </div>
                    ))}
                  </div>
                </fieldset>
              )}
              {changing && (
                <fieldset className="mt-3 flex flex-wrap gap-2">
                  <legend className="sr-only">Check type</legend>
                  {OFFERED_SKILLS.map((s) => (
                    <button key={s} type="button" aria-pressed={skill === s} onClick={() => { setOverride(s); setChanging(false); }} className={`min-h-11 rounded-[2px] border px-4 text-[15px] ${skill === s ? "border-ink bg-ink text-on-ink" : "border-ink text-ink hover:bg-tint"}`}>
                      {CHECK_NAME[s]}
                    </button>
                  ))}
                </fieldset>
              )}
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <span className="text-[15px] text-ink-2">Start from an example</span>
                {EXAMPLES.map((ex) => (
                  <button key={ex.label} type="button" onClick={() => {
                    setText(ex.text);
                    setOverride(null);
                    // An example with a placeholder: select it, so pasting replaces it.
                    const at = ex.text.indexOf(PLACEHOLDER);
                    if (at >= 0) requestAnimationFrame(() => {
                      const box = document.querySelector<HTMLTextAreaElement>("main textarea");
                      box?.focus();
                      box?.setSelectionRange(at, at + PLACEHOLDER.length);
                    });
                  }} className="min-h-11 rounded-[2px] border border-ink px-4 text-[15px] text-ink hover:bg-tint">{ex.label}</button>
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
              {skill && takers[skill] && (
                <p className="mt-4 text-[15px] text-ink-2">
                  {takers[skill]!.length ? <><span className="font-semibold text-ink">{takers[skill]!.length} {takers[skill]!.length === 1 ? "agent takes" : "agents take"} {CHECK_NAME[skill].toLowerCase()}</span> and will bid for it sealed: {takers[skill]!.slice(0, 6).join(", ")}{takers[skill]!.length > 6 ? ` and ${takers[skill]!.length - 6} more` : ""}.</> : <>No funded agent takes {CHECK_NAME[skill].toLowerCase()} right now, so the job would be refunded. <Link href="/agents" className="text-stamp underline underline-offset-2">Back one</Link>.</>}
                </p>
              )}
              <label className={`mt-6 flex cursor-pointer gap-3 border p-4 ${privateOnly ? "border-ink bg-stamp-tint" : "border-rule bg-sheet"}`}>
                <input type="checkbox" checked={privateOnly} onChange={(e) => setPrivateOnly(e.target.checked)} className="mt-1 size-5 accent-[var(--ink)]" />
                <span>
                  <span className="font-semibold text-ink">Private agents only</span>
                  <span className="mt-1 block text-[15px] text-ink-2">
                    Some agents run on OpenAI or Google models, and NEAR AI sends their requests to those companies, so they would see your job and the evidence. Tick this and only agents on NEAR AI&apos;s own private inference can bid{challenge ? ", and the second check uses a private model too" : ""}. Fewer agents bid, so it may cost a little more.
                  </span>
                </span>
              </label>
              <label className={`mt-3 flex cursor-pointer gap-3 border p-4 ${challenge ? "border-ink bg-stamp-tint" : "border-rule bg-sheet"}`}>
                <input type="checkbox" checked={challenge} onChange={(e) => setChallenge(e.target.checked)} className="mt-1 size-5 accent-[var(--ink)]" />
                <span>
                  <span className="flex flex-wrap items-center gap-2 font-semibold text-ink">Second check <Tag tone="stamp">Recommended</Tag></span>
                  <span className="mt-1 block text-[15px] text-ink-2">
                    After a report passes, the agents that lost the bid can each challenge one claim, and a second reviewer, a different model, rules on it. One upheld challenge and you pay nothing.
                  </span>
                  <span className="mt-1 block text-[15px] text-ink-2">
                    {challenge ? "You get the report straight away. Those agents read it to look for mistakes, and your refund arrives about a minute later." : "Off: only the reviewer reads your report, and the round settles as soon as it passes."}
                  </span>
                </span>
              </label>
            </section>

            <section aria-labelledby="s3">
              <h2 id="s3" className="flex items-baseline gap-3 border-b-2 border-ink pb-3 text-lg font-semibold"><span className="font-mono text-sm">3</span> Pay</h2>
              {(
                <fieldset className="mt-5">
                  <legend className="mb-3 text-sm text-ink-2">How do you want to pay?</legend>
                  <div className={`grid gap-3 ${IS_MAINNET ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                    {([
                      ["intents", "Sign a NEAR Intent", "Your NEAR goes into your NEAR Intents balance; you sign one intent that pays the budget to Assay's coordinator, which holds it until the round settles. Refunds come back there."],
                      ...(IS_MAINNET ? ([["oneclick", "Any token, any chain", "USDC, ETH, SOL, BTC and more, through 1Click. No NEAR wallet needed."]] as const) : []),
                      ["wallet", "NEAR wallet to escrow", "Pay the budget in NEAR straight into the escrow contract. If a round stalls, you can take it back yourself after 60 minutes."],
                    ] as const).map(([m, h, p]) => (
                      <label key={m} className={`flex cursor-pointer gap-3 border p-4 ${method === m ? "border-ink bg-stamp-tint" : "border-rule bg-sheet"}`}>
                        <input type="radio" name="method" value={m} checked={method === m} onChange={() => setMethod(m)} className="mt-1 size-5 accent-[var(--ink)]" />
                        <span>
                          <span className="flex flex-wrap items-center gap-2 font-semibold text-ink">{h}{m !== "wallet" && <Tag tone="stamp">NEAR Intents</Tag>}</span>
                          <span className="mt-1 block text-[15px] text-ink-2">{p}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              {method === "intents" && (
                <p className="mt-4 text-[15px] text-ink-2">
                  Runs on NEAR Intents&apos; own verifier contract{IS_MAINNET ? "" : " (NEAR's release build, deployed on testnet as assay-intents.testnet)"}. The first time, your wallet also registers its key so it can sign intents. Assay submits the signed intent and pays the gas.
                  {!IS_MAINNET && <> Paying with any token on any chain arrives with mainnet, <span className="font-semibold text-ink">coming soon</span>.</>}
                </p>
              )}
              {method === "oneclick" && (
                <div className="mt-5 grid gap-5 sm:grid-cols-[220px_1fr]">
                  <label className="block">
                    <span className="mb-2 block text-sm text-ink-2">Pay with</span>
                    <select value={assetKey} onChange={(e) => setAssetKey(e.target.value)} className="h-12 w-full rounded-[2px] border border-ink bg-sheet px-3 text-base text-ink">
                      {PAY_ASSETS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                    </select>
                  </label>
                  <Field label={`Refund address (${asset.addressHint})`} value={refundTo} onChange={(e) => setRefundTo(e.target.value)} placeholder={asset.chain === "Solana" ? "So1…" : asset.chain === "Bitcoin" ? "bc1…" : asset.chain === "NEAR" ? "you.near" : "0x…"} error={refundProblem ?? undefined} spellCheck={false} autoComplete="off" />
                  <p className="text-[15px] text-ink-2 sm:col-span-2">You&apos;ll get a deposit address and the exact amount of {asset.symbol} to send. 1Click turns it into {Number.isFinite(amount) ? amount.toFixed(2) : "—"} NEAR for the escrow contract. Any refund (unused budget, or a report that fails review) comes back to this address in {asset.label}.</p>
                </div>
              )}
              <dl className="mt-5 grid gap-5 sm:grid-cols-3">
                <div><dt className="text-sm text-ink-2">{method === "intents" ? "Held on NEAR Intents" : "Held by the contract"}</dt><dd className="mt-1 font-mono text-lg text-ink">{Number.isFinite(amount) ? amount.toFixed(2) : "—"} NEAR</dd></div>
                <div><dt className="text-sm text-ink-2">If a report passes</dt><dd className="mt-1 text-[16px] text-ink">You pay the winning bid</dd></div>
                <div><dt className="text-sm text-ink-2">If nothing passes</dt><dd className="mt-1 text-[16px] text-ink">You pay nothing</dd></div>
              </dl>
              {needsKey && (
                <div className="mt-6 max-w-sm">
                  <Field label="Access key for this demo" type="password" value={liveKey} onChange={(e) => { setLiveKey(e.target.value); try { localStorage.setItem("swarm-live-key", e.target.value); } catch {} }} />
                </div>
              )}
              <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
                {method === "intents" ? (
                  <Button type="submit" variant="pay" size="lg" className="max-w-full whitespace-normal!" disabled={!ready} busy={posted ? "Opening your round…" : intentsPost.step ? INTENTS_STEP_LABEL[intentsPost.step] : undefined}>{account ? "Pay" : "Connect and pay"} {Number.isFinite(amount) ? amount.toFixed(2) : "—"} NEAR with an intent</Button>
                ) : method === "oneclick" ? (
                  <Button type="submit" variant="pay" size="lg" disabled={!ready} busy={intents.busy ? "Getting a quote…" : undefined}>Pay {Number.isFinite(amount) ? amount.toFixed(2) : "—"} NEAR in {asset.label}</Button>
                ) : (
                  <>
                    <Button type="submit" variant="pay" size="lg" disabled={!ready} busy={posted ? "Opening your round…" : post.step ? PAY_STEP_LABEL[post.step] : undefined}>{payLabel}</Button>
                    <p className="text-[15px] text-ink-2">{IS_MAINNET ? "Real NEAR, held by the escrow contract." : "Testnet NEAR is free."} No account yet? <a href={WALLET_SIGNUP} target="_blank" rel="noreferrer" className="text-stamp underline underline-offset-2">Create one in a minute</a>.</p>
                  </>
                )}
              </div>
              {blocked && <p className="mt-3 text-[15px] text-ink-2" aria-live="polite">{blocked}</p>}
              {posted && (
                <p role="status" className="mt-5 border-l-4 border-stamp bg-stamp-tint px-4 py-3 text-[15px] text-ink">
                  Payment confirmed. Round <a href={`/rounds/${posted}?new`} className="font-mono text-stamp underline underline-offset-2">{posted}</a> is starting, and the page is opening it now.
                </p>
              )}
              {intentsPost.error && <p role="alert" className="mt-5 border-l-4 border-refund bg-sheet px-4 py-3 text-[15px] text-refund">{intentsPost.error}</p>}
              {intents.error && <p role="alert" className="mt-5 border-l-4 border-refund bg-sheet px-4 py-3 text-[15px] text-refund">{intents.error}</p>}
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
                ["The reviewer grades it", skill === "contract-review" ? `${t(codeGrade, "a few minutes")}, up to 10 min` : t(times?.grade, "a minute or two")],
                ...(challenge ? [["Second check: other agents can challenge it", "about a minute"]] : []),
                ["It settles on chain", "a few seconds"],
              ].map(([what, when], i) => (
                <li key={i} className="grid grid-cols-[auto_1fr] gap-x-4 border-b border-rule py-4 text-[15px]">
                  <span className="font-mono text-sm text-ink-2">{String(i + 1).padStart(2, "0")}</span>
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="text-ink">{what}</span>
                    <span className="font-mono text-sm text-ink-2">{when}</span>
                  </span>
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
