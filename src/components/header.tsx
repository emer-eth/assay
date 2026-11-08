"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

// The header's moving parts: it floats clear at the top and turns solid once you scroll, a capsule
// of links that tracks where you are, and a live pill that says whether the market is working.

export function HeaderShell({ children }: { children: ReactNode }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={`sticky top-0 z-30 transition-[background-color,border-color,backdrop-filter] duration-300 ${scrolled ? "border-b border-line bg-bg/80 backdrop-blur-xl" : "border-b border-transparent bg-transparent"}`}>
      {children}
    </header>
  );
}

const capsule = "flex items-center gap-0.5 rounded-full border border-line bg-panel/60 p-1 text-[13px] backdrop-blur";
const link = (on: boolean) => `rounded-full px-3.5 py-1.5 transition-colors ${on ? "bg-white/[0.08] text-text" : "text-muted hover:text-text"}`;

const SECTIONS = [
  ["how", "How it works"],
  ["fair", "Fair bidding"],
  ["live", "Live"],
  ["mcp", "MCP"],
  ["faq", "FAQ"],
] as const;

/** The landing page's sections, highlighting the one you're reading. */
export function SectionNav() {
  const [at, setAt] = useState<string | null>(null);
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setAt(e.target.id);
      },
      { rootMargin: "-40% 0px -55% 0px" },
    );
    SECTIONS.forEach(([id]) => {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    });
    const top = () => window.scrollY < 300 && setAt(null);
    window.addEventListener("scroll", top, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", top);
    };
  }, []);
  return (
    <nav className={capsule} aria-label="Sections">
      {SECTIONS.map(([id, label]) => (
        <Link key={id} href={`/#${id}`} aria-current={at === id ? "true" : undefined} className={link(at === id)}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

const PAGES = [
  { href: "/", label: "Overview", key: "home" },
  { href: "/app", label: "App", key: "app" },
  { href: "/record", label: "Track record", key: "record" },
  { href: "/simulation", label: "Simulation", key: "sim" },
  { href: "/#mcp", label: "MCP", key: "mcp" },
] as const;

/** The app's pages, in the same capsule. */
export function PageNav({ mode, compact = false }: { mode: string; compact?: boolean }) {
  return (
    <nav className={compact ? "flex gap-1 overflow-x-auto text-[13px]" : capsule} aria-label="Main">
      {PAGES.map((p) => (
        <Link key={p.key} href={p.href} aria-current={mode === p.key ? "page" : undefined} className={`shrink-0 ${link(mode === p.key)}`}>
          {p.label}
        </Link>
      ))}
    </nav>
  );
}

/** Whether the market is working right now, from the live coordinator. */
export function MarketPill() {
  const [s, setS] = useState<{ agents: number; busy: boolean } | null>(null);
  useEffect(() => {
    let stop = false;
    const get = () =>
      fetch("/api/live/state", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => !stop && setS({ agents: d.agents?.length ?? 0, busy: !!d.busy }))
        .catch(() => {});
    get();
    const t = setInterval(get, 20_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);
  return (
    <Link href="/app" className="group hidden items-center gap-2 rounded-full border border-line px-3 py-1.5 text-[12px] text-muted transition-colors hover:border-line-strong hover:text-text sm:flex">
      <span className={`size-1.5 rounded-full ${s?.busy ? "live-dot bg-accent" : "bg-ok"}`} />
      <span className="num">{!s ? "Market" : s.busy ? "Round running" : "Market open"}</span>
      {s && <span className="num text-faint group-hover:text-muted">· {s.agents} agents</span>}
    </Link>
  );
}
