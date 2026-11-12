import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { health, type Check } from "@/lib/live/health";
import { CheckButton, CONTAINER, Footer, Label, TopBar } from "@/ui";

export const metadata: Metadata = { title: "Status", description: "Every part Assay depends on, checked live: the NEAR RPC, the escrow contract, the NEAR Intents verifier, each AI model in use, and every agent." };

export default function Status() {
  return (
    <>
      <TopBar site right={<CheckButton />} />
      <main id="main" className={`${CONTAINER} pt-12`}>
        <Label>Status</Label>
        <h1 className="mt-3 max-w-[760px] font-archivo text-[40px] leading-[1.05] font-extrabold text-ink [text-wrap:balance] sm:text-[52px]">Is everything working?</h1>
        <p className="mt-5 max-w-[640px] text-[18px] leading-7 text-ink-2">Each line is a real check, not a stored flag: an RPC call, a contract view, a one-token answer from every AI model in use, and every agent&apos;s balance. Checked at most every five minutes.</p>
        <Suspense fallback={<p className="mt-12 font-mono text-sm text-ink-2">Checking every part… (this takes up to 30 seconds the first time)</p>}>
          <Results />
        </Suspense>
      </main>
      <Footer />
    </>
  );
}

const DOT: Record<Check["state"], string> = { ok: "bg-stamp", warn: "bg-rule-strong", down: "bg-refund" };
const WORD: Record<Check["state"], string> = { ok: "Working", warn: "Degraded", down: "Down" };

async function Results() {
  await connection();
  const h = await health();
  const groups = [...new Set(h.checks.map((c) => c.group))];
  const down = h.checks.filter((c) => c.state === "down").length;
  const warn = h.checks.filter((c) => c.state === "warn").length;
  return (
    <>
      <p className={`mt-10 border-l-4 px-4 py-3 text-[16px] ${down ? "border-refund" : "border-stamp"} bg-sheet`}>
        <span className="font-semibold text-ink">{down ? `${down} part${down === 1 ? "" : "s"} down` : warn ? "Working, with warnings" : "Everything is working"}</span>
        <span className="text-ink-2"> · {h.checks.length} checks · {down} down, {warn} degraded · checked {h.at.slice(11, 16)} UTC</span>
      </p>
      {groups.map((g) => (
        <section key={g} className="mt-10" aria-labelledby={`g-${g}`}>
          <Label as="h2">{g}</Label>
          <ul id={`g-${g}`} className="mt-3 border-t-2 border-ink">
            {h.checks.filter((c) => c.group === g).map((c) => (
              <li key={c.name} className="grid gap-1 border-b border-rule py-3 text-[15px] sm:grid-cols-[260px_110px_1fr_auto] sm:items-center sm:gap-4">
                <span className="font-semibold text-ink">{c.name}</span>
                <span className="flex items-center gap-2 font-mono text-xs uppercase">
                  <span className={`size-2.5 rounded-full ${DOT[c.state]}`} aria-hidden />
                  {WORD[c.state]}
                </span>
                <span className="min-w-0 text-ink-2">{c.detail}</span>
                <span className="font-mono text-xs text-ink-2">{c.ms !== undefined ? `${(c.ms / 1000).toFixed(1)} s` : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="mt-8 text-sm text-ink-2">The same checks as JSON: <a className="text-stamp underline underline-offset-2" href="/api/status">/api/status</a>.</p>
    </>
  );
}
