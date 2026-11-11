"use client";

import { useEffect, useState } from "react";
import { AppHeader } from "@/components/app-header";
import type { PaymentView } from "@/lib/live/intents-pay";
import { Button, CONTAINER, Footer, Label, Stepper, Tag, type Step } from "@/ui";

// The payer's page for a NEAR Intents payment: what to send and where, then 1Click's progress, then the round.
// It asks the server every 4 s; the server asks 1Click (and keeps watching if this tab closes).

const SWAP_WORD: Record<string, string> = {
  PENDING_DEPOSIT: "Waiting for your deposit",
  KNOWN_DEPOSIT_TX: "Deposit seen, waiting for confirmations",
  INCOMPLETE_DEPOSIT: "Less than the amount arrived: send the rest, or 1Click refunds you",
  PROCESSING: "1Click is swapping it to NEAR",
  SUCCESS: "Swapped and delivered",
  REFUNDED: "Refunded to you by 1Click",
  FAILED: "The swap failed",
};

function Copy({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button variant="secondary" className="min-h-11 px-3 text-sm" onClick={() => void navigator.clipboard?.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}>
      {done ? "Copied" : "Copy"}<span className="sr-only"> {label}</span>
    </Button>
  );
}

export function PayView({ initial }: { initial: PaymentView }) {
  const [p, setP] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (p.status !== "waiting" && p.status !== "posting") return;
    const t = setInterval(async () => {
      setNow(Date.now());
      const res = await fetch(`/api/pay/${p.id}`, { cache: "no-store" }).catch(() => null);
      if (res?.ok) setP(await res.json());
    }, 4000);
    return () => clearInterval(t);
  }, [p.id, p.status]);
  useEffect(() => {
    // Paid: the round has started. Open it (a full load, like after a wallet payment).
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a fresh page for the round
    if (p.roundId) setTimeout(() => window.location.assign(`/rounds/${p.roundId}?new`), 2500);
  }, [p.roundId]);

  const left = Math.max(0, Date.parse(p.deadline) - now);
  const mins = `${Math.floor(left / 60_000)}:${String(Math.floor((left % 60_000) / 1000)).padStart(2, "0")}`;
  const [amount, symbol] = [p.amountIn, p.asset.split(" ")[0]];
  const swap = p.swapStatus ?? "PENDING_DEPOSIT";
  const seen = swap !== "PENDING_DEPOSIT";
  const steps: Step[] = [
    { label: `Send ${amount} ${symbol}`, detail: seen ? "Received" : left > 0 ? `Within ${mins}` : "The quote has expired", state: seen ? "done" : p.status === "expired" ? "failed" : "running" },
    { label: "1Click swaps it to NEAR", detail: SWAP_WORD[swap] ?? swap, state: p.status === "failed" ? "failed" : swap === "SUCCESS" || p.roundId ? "done" : seen ? "running" : "waiting" },
    { label: `${p.budget} NEAR goes into the escrow contract`, detail: p.roundId ? "The round has started" : undefined, state: p.roundId ? "done" : "waiting" },
  ];

  return (
    <>
      <AppHeader />
      <main id="main" className={`${CONTAINER} pt-12`}>
        <Label>Pay with NEAR Intents</Label>
        <h1 className="mt-3 font-archivo text-[36px] leading-[1.05] font-extrabold text-ink [text-wrap:balance] sm:text-[48px]">
          {p.roundId ? "Paid. Your round is starting." : p.status === "failed" || p.status === "expired" ? "This payment didn't go through." : `Send ${amount} ${symbol} to start the job.`}
        </h1>
        <p className="mt-4 max-w-[680px] text-[17px] leading-7 text-ink-2 [overflow-wrap:anywhere]">{p.description}</p>

        <div className="mt-10 grid grid-cols-[minmax(0,1fr)] items-start gap-10 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section className="border border-ink bg-sheet p-6 sm:p-7" aria-labelledby="send-h">
            <h2 id="send-h" className="flex flex-wrap items-center gap-2 text-lg font-semibold text-ink">Send exactly this <Tag tone="stamp">NEAR Intents</Tag></h2>
            <dl className="mt-5 border-t-2 border-ink">
              <div className="grid gap-2 border-b border-rule py-4 sm:grid-cols-[160px_1fr_auto] sm:items-center">
                <dt className="text-sm text-ink-2">Amount</dt>
                <dd className="font-mono text-xl text-ink">{amount} {symbol}</dd>
                <dd><Copy value={amount} label="amount" /></dd>
              </div>
              <div className="grid gap-2 border-b border-rule py-4 sm:grid-cols-[160px_1fr]">
                <dt className="text-sm text-ink-2">Token and chain</dt>
                <dd className="font-semibold text-ink">{p.asset}</dd>
              </div>
              <div className="grid gap-2 border-b border-rule py-4 sm:grid-cols-[160px_1fr_auto] sm:items-center">
                <dt className="text-sm text-ink-2">To this address</dt>
                <dd className="font-mono text-[15px] break-all text-ink">{p.depositAddress}</dd>
                <dd><Copy value={p.depositAddress} label="deposit address" /></dd>
              </div>
              {p.depositMemo && (
                <div className="grid gap-2 border-b border-rule py-4 sm:grid-cols-[160px_1fr_auto] sm:items-center">
                  <dt className="text-sm text-ink-2">Memo (required)</dt>
                  <dd className="font-mono text-[15px] break-all text-ink">{p.depositMemo}</dd>
                  <dd><Copy value={p.depositMemo} label="memo" /></dd>
                </div>
              )}
              <div className="grid gap-2 border-b border-rule py-4 sm:grid-cols-[160px_1fr]">
                <dt className="text-sm text-ink-2">Refunds go to</dt>
                <dd className="font-mono text-[15px] break-all text-ink">{p.refundTo}</dd>
              </div>
            </dl>
            <p className="mt-5 border-l-4 border-refund pl-3 text-[15px] text-ink">Send only {p.asset}. Another token, or the same token on another chain, can&apos;t be swapped and may be lost.</p>
            <p className="mt-3 text-sm text-ink-2">1Click (NEAR Intents) turns it into exactly {p.budget} NEAR for the escrow contract. If the swap can&apos;t finish, 1Click refunds you at the address above. Keep this page&apos;s link: it&apos;s how you read your report later.</p>
            {p.note && <p role="status" className={`mt-5 border-l-4 px-4 py-3 text-[15px] ${p.status === "failed" || p.status === "expired" ? "border-refund text-refund" : "border-stamp text-ink"}`}>{p.note}</p>}
            {p.roundId && (
              <p role="status" className="mt-5 border-l-4 border-stamp bg-stamp-tint px-4 py-3 text-[15px] text-ink">
                Payment received. Round <a href={`/rounds/${p.roundId}?new`} className="font-mono text-stamp underline underline-offset-2">{p.roundId}</a> is starting, and the page is opening it now.
              </p>
            )}
          </section>
          <aside className="border border-rule bg-sheet p-6" aria-labelledby="prog-h">
            <h2 id="prog-h" className="mb-4 text-lg font-semibold text-ink">Progress</h2>
            <Stepper steps={steps} label="Payment progress" />
            <p className="mt-4 text-sm text-ink-2">Status from 1Click, checked every few seconds. You can close this page: Assay keeps watching and starts the round when the money arrives.</p>
          </aside>
        </div>
      </main>
      <Footer />
    </>
  );
}
