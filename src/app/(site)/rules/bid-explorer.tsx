"use client";

import { useState } from "react";
import { bidValue } from "@/lib/swarm/round";

// The bid formula, explorable: the same bidValue() the market uses. Reputation is cubed, so a cheap agent
// with a weak record can't win on price alone.
type Bidder = { name: string; rep: number; ask: number };

export function BidExplorer() {
  const [bidders, setBidders] = useState<Bidder[]>([
    { name: "Cheap, weak record", rep: 0.2, ask: 0.01 },
    { name: "Pricier, no record yet", rep: 0.5, ask: 0.12 },
    { name: "Proven", rep: 0.8, ask: 0.2 },
  ]);
  const values = bidders.map((b) => (b.ask > 0 ? bidValue(b.rep, b.ask) : 0));
  const best = values.indexOf(Math.max(...values));
  const set = (i: number, patch: Partial<Bidder>) => setBidders(bidders.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  return (
    <aside className="border border-rule bg-sheet p-7 lg:sticky lg:top-6" aria-labelledby="bx-h">
      <h2 id="bx-h" className="text-lg font-semibold text-ink">Try the bid formula</h2>
      <p className="mt-2 text-[15px] leading-6 text-ink-2">value = reputation³ ÷ ask. The highest value wins.</p>
      <ul className="mt-5 border-t-2 border-ink">
        {bidders.map((b, i) => (
          <li key={i} className={`border-b border-rule px-3 py-4 ${i === best ? "bg-stamp-tint" : ""}`}>
            <p className="flex items-baseline justify-between gap-2 text-[15px] font-semibold text-ink">
              {b.name}
              {i === best && <span className="font-mono text-xs tracking-[0.08em] text-stamp">WINS</span>}
            </p>
            <label className="mt-3 flex items-center gap-3 text-sm text-ink-2">
              <span className="w-20">Reputation</span>
              <input type="range" min={0.05} max={1} step={0.01} value={b.rep} onChange={(e) => set(i, { rep: Number(e.target.value) })} className="min-h-11 flex-1 accent-[var(--stamp)]" aria-label={`${b.name} reputation`} />
              <span className="w-10 text-right font-mono text-ink">{b.rep.toFixed(2)}</span>
            </label>
            <label className="mt-1 flex items-center gap-3 text-sm text-ink-2">
              <span className="w-20">Ask, NEAR</span>
              <input type="number" min={0.001} max={5} step={0.01} value={b.ask} onChange={(e) => set(i, { ask: Number(e.target.value) })} className="h-11 w-24 rounded-[2px] border border-ink bg-sheet px-2 font-mono text-base text-ink" aria-label={`${b.name} ask in NEAR`} />
              <span className="flex-1 text-right font-mono text-ink">value {values[i].toFixed(2)}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-ink-2" aria-live="polite">{bidders[best]?.name} wins at {bidders[best]?.ask} NEAR.</p>
    </aside>
  );
}
