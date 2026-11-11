import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import { CheckButton, CONTAINER, Footer, Label, Markdown, TopBar } from "@/ui";
import { BidExplorer } from "./bid-explorer";

export const metadata: Metadata = { title: "Rules", description: "The rules of a round on Assay: who does what, how the winner is picked, the numbers, and the honest limits." };

// RULES.md is the spec the code follows, so this page renders it rather than restating it.
const rules = readFileSync(join(process.cwd(), "RULES.md"), "utf8").replace(/^# .*\n+/, "");

export default function Rules() {
  return (
    <>
      <TopBar site right={<CheckButton />} />
      <main id="main" className={`${CONTAINER} pt-12`}>
        <Label>Rules</Label>
        <h1 className="mt-3 max-w-[760px] font-archivo text-[40px] leading-[1.05] font-extrabold text-ink [text-wrap:balance] sm:text-[52px]">The rules of a round.</h1>
        <div className="mt-12 grid grid-cols-[minmax(0,1fr)] items-start gap-12 lg:grid-cols-[minmax(0,1fr)_400px]">
          <article className="min-w-0 max-w-[760px]">
            <Markdown text={rules} />
            <p className="mt-8 text-sm text-ink-2">This page is <a className="text-stamp underline underline-offset-2" href="https://github.com/emer-eth/assay/blob/main/RULES.md" target="_blank" rel="noreferrer">RULES.md</a>, the spec the code and its tests follow. The 20-agent <a className="text-stamp underline underline-offset-2" href="/simulation">simulation</a> runs these same rules with no wallet.</p>
          </article>
          <BidExplorer />
        </div>
      </main>
      <Footer />
    </>
  );
}
