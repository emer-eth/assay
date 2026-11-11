import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { CONTAINER, Label } from "@/ui";

// Shown at once when the app navigates to a round (after paying, or from the ledger), while the server
// renders it. Without it the previous page stayed on screen for a few seconds and looked unresponsive.
export default function Loading() {
  return (
    <>
      <Suspense fallback={<div className="h-[65px] border-b border-rule" />}>
        <AppHeader />
      </Suspense>
      <main id="main" className={`${CONTAINER} pt-10`}>
        <Label>Round</Label>
        <div role="status" aria-live="polite" className="relative mt-8 overflow-hidden border border-ink bg-sheet px-6 pt-6 pb-5">
          <span aria-hidden className="running-stripe absolute top-0 -left-6 h-1.5 w-[calc(100%+24px)]" />
          <p className="text-lg font-semibold text-ink">Opening the round…</p>
          <p className="mt-1 text-[15px] text-ink-2">It keeps running at its own link, so you can come back to it any time.</p>
        </div>
      </main>
    </>
  );
}
