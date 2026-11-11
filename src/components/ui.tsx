import Link from "next/link";
import type { ReactNode } from "react";
import { HeaderShell, MarketPill, PageNav, SectionNav } from "./header";
import { WalletButton } from "./wallet";

import { BETA_SKILLS, SKILL_LABEL, SKILLS, type Skill } from "@/lib/swarm/types";

export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M12 1.6 21 6.8v10.4L12 22.4 3 17.2V6.8z" fill="var(--sheet)" stroke="currentColor" strokeOpacity=".9" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M12 7.4 15.4 9.4v3.9L12 15.3 8.6 13.3V9.4z" fill="var(--accent)" />
      <path d="M12 15.3v3.6M15.4 13.3l3.1 1.8M8.6 13.3l-3.1 1.8" stroke="var(--accent)" strokeOpacity=".45" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

export function Logo() {
  return (
    <Link
      href="/"
      className="flex items-center gap-2 text-text"
      aria-label="Assay home"
    >
      <Mark size={24} />
      <span className="headline text-[17px] tracking-[-0.025em]">Assay</span>
      <span className="num hidden rounded border border-accent/30 px-1.5 py-px text-[9px] tracking-[0.16em] text-accent uppercase sm:inline">Testnet</span>
    </Link>
  );
}

/** One header for every page: brand, a capsule of links, live state, and the main action. */
export function TopBar({ mode }: { mode: "home" | "app" | "sim" | "record" }) {
  return (
    <HeaderShell>
      <div className="mx-auto grid h-16 w-full max-w-6xl grid-cols-[auto_1fr_auto] items-center gap-4 px-4 sm:px-6">
        <Logo />
        <div className="hidden justify-center lg:flex">{mode === "home" ? <SectionNav /> : <PageNav mode={mode} />}</div>
        <div className="flex items-center justify-end gap-3 lg:col-auto">
          {mode === "home" ? (
            <>
              <MarketPill />
              <Link href="/classic/app" className="btn btn-primary !rounded-full !px-4 !py-1.5 text-[13px]">
                Launch app <span aria-hidden>→</span>
              </Link>
            </>
          ) : (
            <WalletButton />
          )}
        </div>
      </div>
      {/* below the large breakpoint the links move to a scrollable row */}
      <div className="border-t border-line px-3 py-1.5 lg:hidden">
        <PageNav mode={mode} compact />
      </div>
    </HeaderShell>
  );
}

export function Stat({
  label,
  value,
  href,
}: {
  label: string;
  value: ReactNode;
  href?: string;
}) {
  const body = (
    <>
      <span className="block text-[10px] tracking-[0.08em] text-faint uppercase">
        {label}
      </span>
      <span className="num text-[13px] text-text">{value}</span>
    </>
  );
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="leading-tight hover:opacity-80"
    >
      {body}
    </a>
  ) : (
    <span className="leading-tight">{body}</span>
  );
}

export function SkillPicker({
  value,
  onChange,
  label,
}: {
  value: Skill[];
  onChange: (v: Skill[]) => void;
  label: string;
}) {
  return (
    <fieldset>
      <legend className="eyebrow mb-2">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {SKILLS.map((s) => {
          const on = value.includes(s);
          return (
            <button
              type="button"
              key={s}
              aria-pressed={on}
              onClick={() =>
                onChange(on ? value.filter((x) => x !== s) : [...value, s])
              }
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${on ? "border-ink bg-tint text-text" : "border-line-strong text-muted hover:text-text"}`}
            >
              {SKILL_LABEL[s]}
              {BETA_SKILLS.includes(s) && <span className="ml-1.5 text-[10px] uppercase tracking-wider text-accent" title="Its reports fail review more often than they pass. A failed report is refunded.">beta</span>}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function Footer() {
  return (
    <footer className="mt-auto border-t border-line">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-5 text-[14px] text-muted sm:px-6">
        <span className="flex items-center gap-2">
          <Mark size={16} /> Assay · built at the NEAR Hackathon ·
          testnet
        </span>
        <span className="flex flex-wrap gap-x-5">
          <Link href="/classic/app" className="inline-block py-3 hover:text-text">
            App
          </Link>
          <Link href="/simulation" className="inline-block py-3 hover:text-text">
            Simulation
          </Link>
          <Link href="/record" className="inline-block py-3 hover:text-text">
            Track record
          </Link>
          <Link href="/#mcp" className="inline-block py-3 hover:text-text">
            MCP
          </Link>
          <a
            href="https://github.com/emer-eth/assay"
            className="inline-block py-3 hover:text-text"
          >
            GitHub
          </a>
        </span>
      </div>
    </footer>
  );
}

export const near = (n: number, digits?: number) =>
  `${n.toFixed(digits ?? (n !== 0 && Math.abs(n) < 0.01 ? 4 : n < 1 ? 3 : 2))} Ⓝ`;
