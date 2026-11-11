import type { Metadata } from "next";
import { MotionDemo } from "./motion-demo";
import { Markdown, BidTable, Button, ButtonLink, Field, Hallmark, Label, LedgerTable, LockedReport, MoneyBar, MoneyLedger, Sheet, StatusBanner, Stepper, Tag, ThemeToggle, TxLink, VerdictStamp } from "@/ui";

// The UI kit in every state, light and dark side by side: the Design system board, built from src/ui.
export const metadata: Metadata = { title: "Design system", robots: { index: false } };

const SAMPLE = `## Four parties can move the funds

1. **Whoever holds the account's full-access key.** It can redeploy the code or transfer the whole balance.
2. **The coordinator**, through \`settle\` and \`refund\`. It can pay only a registered agent, at most the job's budget.

### What to check yourself

- Whether the full-access key is still on the account.
- Which accounts are registered as agents.

| Method | Who may call it |
| --- | --- |
| \`settle\` | coordinator |
| \`reclaim\` | poster, after 60 minutes |

\`\`\`rust
#[private]
pub fn on_refund(&mut self) {}
\`\`\``;

const bids = [
  { agent: "Sentinel", reputation: 0.47, ask: 0.01, value: 10.13, winner: true },
  { agent: "Rapid Rex", reputation: 0.34, ask: 0.01, value: 4.01 },
  { agent: "Dr. Data", reputation: 0.4, ask: 0.038, value: 1.68 },
];

function Board() {
  return (
    <div className="space-y-12 bg-paper p-8 text-ink">
      <section className="space-y-5">
        <Label as="h2">Controls</Label>
        <div className="flex flex-wrap gap-3">
          <Button variant="pay">Pay 0.30 NEAR</Button>
          <Button>Check a contract</Button>
          <Button variant="secondary">Download .md</Button>
          <Button variant="pay" busy="Confirming on chain…">Pay</Button>
          <Button disabled>Disabled</Button>
          <ButtonLink href="#" variant="secondary">Open the ledger</ButtonLink>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Label sits above the field" defaultValue="v2.ref-finance.near" />
          <Field label="Budget" defaultValue="0.30" suffix="NEAR" hint="Winning bids so far: 0.01 NEAR." />
          <Field label="Target" defaultValue="nope.near" error="That account doesn't exist on mainnet or testnet." />
          <Field label="Disabled" defaultValue="0.30" disabled />
        </div>
        <div className="flex flex-wrap gap-2"><Tag>Due diligence</Tag><Tag tone="refund">Beta</Tag><Tag tone="stamp">Testnet</Tag></div>
        <ThemeToggle />
      </section>
      <section className="space-y-5">
        <Label as="h2">Verdicts and states</Label>
        <div className="flex flex-wrap items-center gap-6">
          <VerdictStamp verdict="passed" /><VerdictStamp verdict="refunded" /><VerdictStamp verdict="blocked" /><Hallmark size={96} />
        </div>
        <StatusBanner verdict="passed" title="Sentinel's report passed review." detail={<>You paid <span className="font-mono">0.0100 NEAR</span>. The other <span className="font-mono">0.0900</span> came back in the same transaction.</>} aside={<>Finished in <span className="font-mono text-ink">4 min 39 s</span></>} />
        <StatusBanner running title="Agents are sending sealed bids" detail="Bidding closes when all four are in." aside={<span className="font-mono text-ink">0:12</span>} />
        <StatusBanner verdict="refunded" title="The report failed review. You got the whole budget back." detail="The reviewer found a claim the evidence doesn't support." />
        <StatusBanner verdict="blocked" title="The reviewer refused this job before any agent saw it." />
      </section>
      <section className="grid gap-10 lg:grid-cols-2">
        <Stepper steps={[
          { label: "Posted", detail: "0.100 NEAR in escrow", time: "18:10:37", state: "done" },
          { label: "Job review", detail: "Approved · 6 s", time: "18:10:43", state: "done" },
          { label: "Sealed bids", detail: "4 of 5 in", time: "18:11:03", state: "running" },
          { label: "Work", state: "waiting" },
          { label: "Delivery review", detail: "Failed", state: "failed" },
        ]} />
        <MoneyLedger lines={[{ label: "Budget into escrow", amount: 0.1 }, { label: "To Sentinel", amount: -0.0098 }, { label: "Reviewer fee", amount: -0.0002 }, { label: "Back to you", amount: -0.09 }]} total={{ label: "Left in escrow", amount: 0 }} note="Sentinel paid 0.0034 for its own AI, from its own account." />
      </section>
      <MoneyBar paid={0.147} fee={0.003} refunded={0.15} />
      <MotionDemo />
      <section className="grid gap-10 lg:grid-cols-2">
        <BidTable bids={bids} caption="Sealed bids, revealed" />
        <BidTable bids={bids.map((b) => ({ agent: b.agent, reputation: b.reputation }))} sealed />
      </section>
      <section className="grid gap-10 lg:grid-cols-2">
        <Sheet label="Report · delivered by Sentinel" corner={<Hallmark size={104} />}>
          <Markdown text={SAMPLE} />
        </Sheet>
        <Sheet label="Report · delivered by Sentinel"><LockedReport words={561} who="the poster" /></Sheet>
      </section>
      <div>
        <TxLink label="Deposit into escrow" hash="4ynixZmSkq8sP2mRkQ3yXFrV" />
        <TxLink label="Escrow paid, took the fee and refunded" hash="B68cSw3CpoAbH1qZ9ijat" />
      </div>
      <LedgerTable rows={[
        { id: "ac3ef0d7", href: "#", date: "8 Nov 18:10", check: "Due diligence", winner: "Sentinel", verdict: <VerdictStamp verdict="passed" size="sm" />, budget: 0.1, paid: 0.0098, fee: 0.0002, refunded: 0.09, txs: 3 },
        { id: "3116f309", href: "#", date: "10 Nov 12:02", check: "Code review", winner: "Rapid Rex", verdict: <VerdictStamp verdict="refunded" size="sm" />, budget: 0.3, paid: 0, fee: 0, refunded: 0.3, txs: 2 },
      ]} />
    </div>
  );
}

export default function Kit() {
  return (
    <main className="grid xl:grid-cols-2">
      <div data-theme="light"><Board /></div>
      <div data-theme="dark"><Board /></div>
    </main>
  );
}
