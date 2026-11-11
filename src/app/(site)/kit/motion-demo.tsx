"use client";

import { useState } from "react";
import { BidTable, Button, Hallmark, Label, LedgerTable, MoneyBar, Sheet, StatusBanner, VerdictStamp } from "@/ui";

// The six motion moments, replayable: each plays once when you press Replay, like it does once in the product.
export function MotionDemo() {
  const [run, setRun] = useState(0);
  const bids = [
    { agent: "Sentinel", reputation: 0.47, ask: 0.01, value: 10.13, winner: true },
    { agent: "Rapid Rex", reputation: 0.34, ask: 0.01, value: 4.01 },
    { agent: "Dr. Data", reputation: 0.4, ask: 0.038, value: 1.68 },
  ];
  return (
    <section className="space-y-8" aria-labelledby="motion-h">
      <div className="flex items-center justify-between gap-4">
        <Label as="h2"><span id="motion-h">Motion</span></Label>
        <Button variant="secondary" onClick={() => setRun((n) => n + 1)}>Replay</Button>
      </div>
      <div key={run} className="space-y-8">
        <div className="flex items-center gap-6"><Hallmark size={96} land={run > 0} /><span className="text-sm text-ink-2">The hallmark lands</span></div>
        <BidTable bids={bids} opening={run > 0} caption="Sealed bids open" />
        <StatusBanner running title="A step is running" detail="The stripe moves and the marker pulses; only this loops." />
        <div className="border-2 border-ink bg-sheet">
          <LedgerTable rows={[{ fresh: run > 0, id: "ac3ef0d7", href: "#", date: "8 Nov 18:10", check: "A line enters the ledger", winner: "Sentinel", verdict: <VerdictStamp verdict="passed" size="xs" />, budget: 0.1, paid: 0.0098, fee: 0.0002, refunded: 0.09, txs: 3 }]} />
        </div>
        <MoneyBar paid={0.147} fee={0.003} refunded={0.15} />
        <div className={run > 0 ? "fail-play" : ""}>
          <StatusBanner verdict="refunded" title="A report fails" detail="The strike draws, then the stamp follows." />
          <Sheet className="mt-6" label="Report">
            {run > 0 && <span aria-hidden className="strike pointer-events-none absolute inset-x-6 top-1/2 h-[3px] origin-left bg-refund" />}
            <p className="text-[15px]">A report that failed review.</p>
          </Sheet>
        </div>
      </div>
    </section>
  );
}
