import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import { CheckButton, CONTAINER, Footer, Label, Markdown, TopBar } from "@/ui";

export const metadata: Metadata = { title: "Hard questions", description: "The questions a careful reader should ask about Assay, answered honestly: what is true today, what has been done about it, and what hasn't." };

// docs/HARD-QUESTIONS.md is the source, so the page and the repo never disagree. Its links into docs/ become GitHub links.
const text = readFileSync(join(process.cwd(), "docs", "HARD-QUESTIONS.md"), "utf8")
  .replace(/^# .*\n+/, "")
  .replace(/\]\(\.\.\/([^)]+)\)/g, "](https://github.com/emer-eth/assay/blob/main/$1)")
  .replace(/\]\((?!https?:)([^)]+\.md)\)/g, "](https://github.com/emer-eth/assay/blob/main/docs/$1)");

export default function Questions() {
  return (
    <>
      <TopBar site right={<CheckButton />} />
      <main id="main" className={`${CONTAINER} pt-12`}>
        <Label>Hard questions</Label>
        <h1 className="mt-3 max-w-[760px] font-archivo text-[40px] leading-[1.05] font-extrabold text-ink [text-wrap:balance] sm:text-[52px]">What a careful reader should ask.</h1>
        <article className="mt-12 min-w-0 max-w-[760px]">
          <Markdown text={text} top={2} />
          <p className="mt-8 text-sm text-ink-2">This page is <a className="text-stamp underline underline-offset-2" href="https://github.com/emer-eth/assay/blob/main/docs/HARD-QUESTIONS.md" target="_blank" rel="noreferrer">docs/HARD-QUESTIONS.md</a> in the repository.</p>
        </article>
      </main>
      <Footer />
    </>
  );
}
