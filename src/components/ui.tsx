import Link from "next/link";
import type { ReactNode } from "react";
import { WalletButton } from "./wallet";

export const SKILLS = ["writing", "research", "code", "data", "design", "translation"] as const;

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="Swarm-for-Hire home">
      <svg width="26" height="28" viewBox="0 0 26 28" aria-hidden>
        <polygon points="13,1 25,7.75 25,20.25 13,27 1,20.25 1,7.75" fill="var(--honey)" />
        <polygon points="13,8 19,11.5 19,16.5 13,20 7,16.5 7,11.5" fill="var(--honey-ink)" />
      </svg>
      <span className="text-[15px] font-bold tracking-tight">
        SWARM<span className="text-honey">-FOR-</span>HIRE
      </span>
    </Link>
  );
}

export function TopBar({ mode, children }: { mode: "live" | "sim"; children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-4">
          <Logo />
          <nav className="flex rounded-lg border border-line p-0.5 text-xs font-medium" aria-label="Mode">
            <Link href="/live" aria-current={mode === "live" ? "page" : undefined} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 ${mode === "live" ? "bg-panel-2 text-text" : "text-muted hover:text-text"}`}>
              <span className={`size-1.5 rounded-full ${mode === "live" ? "live-dot bg-honey" : "bg-faint"}`} /> Live
            </Link>
            <Link href="/" aria-current={mode === "sim" ? "page" : undefined} className={`rounded-md px-2.5 py-1 ${mode === "sim" ? "bg-panel-2 text-text" : "text-muted hover:text-text"}`}>
              Simulation
            </Link>
          </nav>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {children}
          <WalletButton />
        </div>
      </div>
    </header>
  );
}

export function Stat({ label, value, href }: { label: string; value: ReactNode; href?: string }) {
  const body = (
    <>
      <span className="eyebrow block !text-[10px]">{label}</span>
      <span className="num text-sm text-text">{value}</span>
    </>
  );
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className="leading-tight hover:opacity-80">
      {body}
    </a>
  ) : (
    <span className="leading-tight">{body}</span>
  );
}

export function SkillPicker({ value, onChange, label }: { value: string[]; onChange: (v: string[]) => void; label: string }) {
  return (
    <fieldset>
      <legend className="eyebrow mb-1.5">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {SKILLS.map((s) => {
          const on = value.includes(s);
          return (
            <button
              type="button"
              key={s}
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((x) => x !== s) : [...value, s])}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${on ? "border-honey bg-honey/12 text-honey" : "border-line-strong text-muted hover:text-text"}`}
            >
              {s}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export const near = (n: number, digits?: number) => `${n.toFixed(digits ?? (n !== 0 && Math.abs(n) < 0.01 ? 4 : n < 1 ? 3 : 2))} Ⓝ`;
