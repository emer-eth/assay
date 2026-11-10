import type { ReactNode } from "react";
import { Label } from "./controls";

/**
 * The report container: ink border and the only hard shadow in the system (10px 10px 0, rule colour).
 * The public view shows the word count and a lock line in place of the text.
 */
export function Sheet({ children, label, corner, className = "" }: { children: ReactNode; label?: ReactNode; /** e.g. the hallmark, pinned to the bottom-right corner */ corner?: ReactNode; className?: string }) {
  return (
    <section className={`sheet relative border border-ink bg-sheet p-6 sm:p-8 ${className}`}>
      {label && <Label className="mb-5">{label}</Label>}
      {children}
      {corner && <div className="absolute -right-5 -bottom-6 sm:-right-6">{corner}</div>}
    </section>
  );
}

export function LockedReport({ words, who }: { words: number; who: string }) {
  return (
    <div className="py-6">
      <p className="font-mono text-2xl text-ink">{words.toLocaleString("en")} words</p>
      <p className="mt-2 text-sm text-ink-2">
        <span aria-hidden>🔒 </span>The report is private to {who}. The verdict, the reviewer&apos;s notes and the money are public.
      </p>
    </div>
  );
}
