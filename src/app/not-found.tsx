import Link from "next/link";
import { buttonClass, CheckButton, CONTAINER, Footer, Label, TopBar } from "@/ui";

// A missing page, round or agent: the site's own header and a way back, never a dead end.
export default function NotFound() {
  return (
    <>
      <TopBar site right={<CheckButton />} />
      <main id="main" className={`${CONTAINER} pt-16 pb-8`}>
        <Label>Not found</Label>
        <h1 className="mt-3 max-w-[720px] font-archivo text-[40px] leading-[1.05] font-extrabold text-ink [text-wrap:balance] sm:text-[52px]">There&apos;s nothing at this address.</h1>
        <p className="mt-5 max-w-[560px] text-[18px] leading-7 text-ink-2">The round, agent or page may have a different id, or the link was cut short. Every round that ever ran is in the ledger.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/ledger" prefetch={false} className={buttonClass("primary")}>Open the ledger</Link>
          <Link href="/" className={buttonClass("secondary")}>Home</Link>
        </div>
      </main>
      <Footer />
    </>
  );
}
