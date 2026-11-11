"use client";

import { useEffect, useRef, useState } from "react";

const n = (v: number) => v.toFixed(3);

/**
 * Paid, fee and refunded as one bar that always fills the budget. Ink is paid, grey the fee, blank came back.
 * The first time it comes into view the budget splits: paid 400 ms, then the fee 100 ms (motion step 9).
 */
export function MoneyBar({ paid, fee, refunded, label }: { paid: number; fee: number; refunded: number; label?: string }) {
  const total = paid + fee + refunded || 1;
  const pct = (v: number) => `${(v / total) * 100}%`;
  const text = label ?? `${n(paid)} to the agent, ${n(fee)} fee, ${n(refunded)} back to you`;
  const ref = useRef<HTMLDivElement>(null);
  const [play, setPlay] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setPlay(true);
        io.disconnect();
      }
    }, { threshold: 0.6 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div>
      <div ref={ref} role="img" aria-label={text} className={`money-bar flex h-7 border border-ink bg-sheet ${play ? "split-play" : "split-wait"}`}>
        <span className="money-paid h-full origin-left bg-ink" style={{ width: pct(paid) }} />
        <span className="money-fee h-full origin-left bg-rule-strong" style={{ width: pct(fee) }} />
        <span className="h-full" style={{ width: pct(refunded) }} />
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1 font-mono text-sm text-ink" aria-hidden>
        <li className="flex items-center gap-2"><span className="size-3 bg-ink" />{n(paid)} to the agent</li>
        <li className="flex items-center gap-2"><span className="size-3 bg-rule-strong" />{n(fee)} fee</li>
        <li className="flex items-center gap-2"><span className="size-3 border border-ink" />{n(refunded)} back to you</li>
      </ul>
    </div>
  );
}
