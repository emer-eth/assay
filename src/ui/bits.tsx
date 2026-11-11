"use client";

import { useEffect, useState, type ReactNode } from "react";

import { explorerTx } from "./layout";
const shortHash = (h: string) => (h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h);

/** Label, short hash and an arrow, opening the explorer. */
export function TxLink({ label, hash }: { label: ReactNode; hash: string }) {
  return (
    <div className="border-b border-rule py-3 last:border-b-0">
      <p className="text-[15px] text-ink [overflow-wrap:anywhere]">{label}</p>
      <a href={explorerTx(hash)} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 font-mono text-sm text-stamp hover:underline">
        {shortHash(hash)} <span aria-hidden>↗</span>
        <span className="sr-only">(opens the explorer)</span>
      </a>
    </div>
  );
}

/** One at a time, bottom left: "Your round finished", with a link to it. */
export function Toast({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 8000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div role="status" aria-live="polite" className="toast fixed bottom-5 left-5 z-50 flex max-w-[calc(100vw-40px)] items-center gap-4 border border-ink bg-sheet px-5 py-4 text-ink">
      <div className="text-[15px]">{children}</div>
      <button type="button" onClick={onClose} aria-label="Dismiss" className="grid size-11 place-items-center text-ink-2 hover:text-ink">✕</button>
    </div>
  );
}

type Theme = "system" | "light" | "dark";
/** Follows the device until someone picks Light or Dark. Saved per device; applied before paint by the layout. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    try {
      const t = localStorage.getItem("assay-theme");
      // Read after mount so the server render and the first browser render match.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (t === "light" || t === "dark") setTheme(t);
    } catch {}
  }, []);
  const pick = (t: Theme) => {
    setTheme(t);
    try {
      if (t === "system") localStorage.removeItem("assay-theme");
      else localStorage.setItem("assay-theme", t);
    } catch {}
    const root = document.documentElement;
    if (t === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", t);
  };
  return (
    <div role="group" aria-label="Theme" className="flex items-center gap-2 text-sm">
      <span className="text-ink-2">Theme</span>
      {(["system", "light", "dark"] as const).map((t) => (
        <button key={t} type="button" aria-pressed={theme === t} onClick={() => pick(t)} className={`min-h-11 rounded-[2px] border px-3 capitalize ${theme === t ? "border-ink bg-ink text-on-ink" : "border-rule-strong text-ink hover:border-ink"}`}>
          {t}
        </button>
      ))}
    </div>
  );
}
