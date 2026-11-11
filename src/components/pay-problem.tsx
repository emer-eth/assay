"use client";

import { explorerTx } from "@/ui";

/** A payment error, with a retry that reuses the same payment when the money already went through. */
export function PayProblem({ error, pending, retry }: { error: string | null; pending: { txHash: string } | null; retry: () => void }) {
  if (!error) return null;
  return (
    <div role="alert" className="mt-4 border-l-4 border-refund bg-sheet px-4 py-3 text-[15px]">
      <p className="text-refund">{error}</p>
      {pending && (
        <p className="mt-2 flex flex-wrap items-center gap-3 text-ink-2">
          Your payment went through (<a className="font-mono text-stamp underline" href={explorerTx(pending.txHash)} target="_blank" rel="noreferrer">{pending.txHash.slice(0, 8)}…</a>), so you won&apos;t pay twice.
          <button type="button" onClick={retry} className="min-h-11 rounded-[2px] border border-ink px-4 text-ink hover:bg-tint">Try again with this payment</button>
        </p>
      )}
    </div>
  );
}
