"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { buttonClass } from "./controls";
import { ThemeToggle } from "./bits";
import { CONTAINER } from "./layout";

// The top bar and footer from the build spec. This file never imports wallet code: the app routes pass the
// wallet button in through `right` (components/app-header.tsx), the public routes pass "Check a contract".

/** Top-bar destinations. Agents and Connect point at the classic live app's panels until their own pages land (build step 8). */
export const NAV = [
  { href: "/check", label: "Check" },
  { href: "/ledger", label: "Ledger" },
  { href: "/classic/app#agents", label: "Agents", match: "/agents" },
  { href: "/classic/app#mcp", label: "Connect", match: "/connect" },
] as const;


export function Logo() {
  return (
    <Link href="/" className="flex min-h-11 items-center gap-2.5 text-ink" aria-label="Assay, home">
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
        <rect width="26" height="26" fill="var(--ink)" />
        <circle cx="13" cy="13" r="7" fill="none" stroke="var(--paper)" strokeWidth="2.4" />
        <circle cx="13" cy="13" r="2.6" fill="var(--paper)" />
      </svg>
      <span className="font-archivo text-[22px] font-extrabold">Assay</span>
    </Link>
  );
}

/**
 * `site`: on public pages, links into the app don't prefetch, because prefetching an app route downloads
 * its wallet code in the background. The public pages themselves ship none (build spec, step 3).
 */
export function TopBar({ right, site = false }: { right: ReactNode; site?: boolean }) {
  const path = usePathname();
  return (
    <header className="border-b border-rule bg-paper">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-sheet focus:px-4 focus:py-2">Skip to content</a>
      <div className={`${CONTAINER} flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-2.5`}>
        <Logo />
        <nav aria-label="Main" className="order-3 -mx-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:mx-0 sm:w-auto">
          {NAV.map((n) => {
            const on = path === n.href || path.startsWith(("match" in n ? n.match : n.href) + "/") || ("match" in n && path === n.match);
            return (
              <Link key={n.label} href={n.href} prefetch={site ? false : undefined} aria-current={on ? "page" : undefined} className={`flex min-h-11 items-center px-3 text-[15px] font-medium whitespace-nowrap text-ink ${on ? "underline decoration-2 underline-offset-[10px]" : "hover:underline hover:underline-offset-[10px]"}`}>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center">{right}</div>
      </div>
    </header>
  );
}

/** The right side on public pages (home, rules): the one primary action. */
export function CheckButton() {
  return <Link href="/check" prefetch={false} className={buttonClass("primary")}>Check a contract</Link>;
}

export function Footer() {
  return (
    <footer className="mt-24 border-t border-rule bg-paper">
      <div className={`${CONTAINER} flex flex-wrap items-center justify-between gap-6 py-8`}>
        <p className="text-sm text-ink-2">Assay · built at the NEAR Hackathon · testnet</p>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 text-sm">
          {[["/ledger", "Ledger"], ["/rules", "Rules"], ["/simulation", "Simulation"], ["/classic", "Classic site"], ["https://github.com/emer-eth/assay", "GitHub"]].map(([href, label]) => (
            <Link key={href} href={href} prefetch={false} className="inline-flex min-h-11 items-center text-ink underline underline-offset-4">{label}</Link>
          ))}
        </nav>
        <ThemeToggle />
      </div>
    </footer>
  );
}
