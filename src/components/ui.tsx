import Link from "next/link";
import type { ReactNode } from "react";
import { WalletButton } from "./wallet";

import { SKILL_LABEL, SKILLS, type Skill } from "@/lib/swarm/types";

export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 1.8 21 7v10l-9 5.2L3 17V7z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M12 7.6 16.2 10v4.8L12 17.2 7.8 14.8V10z" fill="var(--accent)" />
    </svg>
  );
}

export function Logo() {
  return (
    <Link
      href="/"
      className="flex items-center gap-2 text-text"
      aria-label="Swarm-for-Hire home"
    >
      <Mark />
      <span className="text-[15px] font-semibold tracking-[-0.02em]">
        Swarm-for-Hire
      </span>
    </Link>
  );
}

const NAV = [
  { href: "/", label: "Overview", key: "home" },
  { href: "/app", label: "App", key: "app" },
  { href: "/simulation", label: "Simulation", key: "sim" },
  { href: "/#mcp", label: "MCP", key: "mcp" },
] as const;

/** One header for every page: brand, navigation, optional live stats, wallet. */
export function TopBar({
  mode,
  children,
}: {
  mode: "home" | "app" | "sim";
  children?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/75 backdrop-blur-xl">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-6">
          <Logo />
          <nav
            className="hidden items-center gap-1 text-[13px] md:flex"
            aria-label="Main"
          >
            {NAV.map((n) => (
              <Link
                key={n.key}
                href={n.href}
                aria-current={mode === n.key ? "page" : undefined}
                className={`rounded-md px-2.5 py-1.5 transition-colors ${mode === n.key ? "text-text" : "text-muted hover:text-text"}`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden items-center gap-5 lg:flex">{children}</div>
          {mode === "home" ? (
            <Link
              href="/app"
              className="btn btn-primary !px-3.5 !py-1.5 text-[13px]"
            >
              Launch app
            </Link>
          ) : (
            <WalletButton />
          )}
        </div>
      </div>
      {/* phone navigation */}
      <nav
        className="flex gap-1 overflow-x-auto border-t border-line px-3 py-1.5 text-[13px] md:hidden"
        aria-label="Main"
      >
        {NAV.map((n) => (
          <Link
            key={n.key}
            href={n.href}
            aria-current={mode === n.key ? "page" : undefined}
            className={`shrink-0 rounded-md px-2.5 py-1 ${mode === n.key ? "bg-panel-2 text-text" : "text-muted"}`}
          >
            {n.label}
          </Link>
        ))}
      </nav>
    </header>
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
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${on ? "border-white/40 bg-white/10 text-text" : "border-line-strong text-muted hover:text-text"}`}
            >
              {SKILL_LABEL[s]}
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
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-[13px] text-muted sm:px-6">
        <span className="flex items-center gap-2">
          <Mark size={16} /> Swarm-for-Hire · built at the NEAR Hackathon ·
          testnet
        </span>
        <span className="flex flex-wrap gap-5">
          <Link href="/app" className="hover:text-text">
            App
          </Link>
          <Link href="/simulation" className="hover:text-text">
            Simulation
          </Link>
          <Link href="/#mcp" className="hover:text-text">
            MCP
          </Link>
          <a
            href="https://github.com/emer-eth/swarm-for-hire"
            className="hover:text-text"
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
