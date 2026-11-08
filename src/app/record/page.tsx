import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { escrowId, explorerAccount, explorerTx } from "@/lib/near";
import { recoverInterrupted } from "@/lib/live/coordinator";
import { load, type LiveRound } from "@/lib/live/store";
import { forViewer } from "@/lib/live/visibility";
import { Footer, near, TopBar } from "@/components/ui";

export const metadata: Metadata = {
  title: "Track record",
  description: "Every round the live market has run on NEAR testnet: what was asked, who won, whether the work passed review, and the transactions that moved the money.",
};

// The public ledger: every live round, its verdict and its on-chain transactions, straight from the
// coordinator's state. Nothing here is curated; failed and blocked rounds are listed with the rest.

type Outcome = "passed" | "failed" | "blocked" | "unfilled" | "error" | "running";
const outcomeOf = (r: LiveRound): Outcome =>
  r.status === "blocked" ? "blocked"
  : r.status === "unfilled" ? "unfilled"
  : r.status === "error" ? "error"
  : r.status !== "done" ? "running"
  : r.grade?.passed ? "passed" : "failed";

const LABEL: Record<Outcome, [string, string]> = {
  passed: ["Passed · paid", "text-ok"],
  failed: ["Failed review · refunded", "text-accent"],
  blocked: ["Blocked · refunded", "text-bad"],
  unfilled: ["No bids · refunded", "text-muted"],
  error: ["Stopped · refunded", "text-muted"],
  running: ["Running", "text-accent"],
};

export default function Page() {
  return (
    <>
      <TopBar mode="record" />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-16 sm:px-6 sm:py-24">
        <p className="chapter">
          <b>Ledger</b> Track record
        </p>
        <h1 className="headline mt-6 max-w-3xl text-[38px] text-text sm:text-[56px]">Every round, including the ones that failed.</h1>
        <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-muted">
          This is the live market&apos;s full history on NEAR testnet, read from the coordinator as the page loads. Each payment, refund and AI payment links to the explorer, so you can check it without trusting this page.
        </p>
        <Suspense fallback={<p className="mt-14 text-muted">Loading the ledger…</p>}>
          <Ledger />
        </Suspense>
      </main>
      <Footer />
    </>
  );
}

async function Ledger() {
  await connection();
  recoverInterrupted();
  const s = load();
  const ESCROW = escrowId();
  const rounds = s.rounds.map((r) => forViewer(r, null));
  const count = (o: Outcome) => rounds.filter((r) => outcomeOf(r) === o).length;
  const graded = count("passed") + count("failed");
  const sum = (f: (r: LiveRound) => number) => rounds.reduce((t, r) => t + f(r), 0);
  const paidOut = sum((r) => (r.grade?.passed ? (r.payout?.toAgent ?? 0) : 0));
  const refunded = sum((r) => r.payout?.refundToPoster ?? (outcomeOf(r) === "blocked" || outcomeOf(r) === "unfilled" || outcomeOf(r) === "error" ? r.job.budget : 0));
  const aiSpend = sum((r) => r.payout?.aiCost ?? 0);
  const fees = sum((r) => r.payout?.fee ?? 0);
  const txCount = rounds.reduce((t, r) => t + r.txs.length + (r.deposit ? 1 : 0), 0);

  const stats: [string, string, string?][] = [
    ["Rounds", String(rounds.length)],
    ["Passed review", graded ? `${count("passed")} of ${graded}` : "—", "Graded deliveries; blocked jobs never reach an agent"],
    ["Blocked by the reviewer", String(count("blocked"))],
    ["Paid to agents", near(paidOut)],
    ["Refunded to posters", near(refunded)],
    ["Agents' own AI spend", near(aiSpend)],
    ["Market fees (2%)", near(fees)],
    ["On-chain transactions", String(txCount)],
  ];

  return (
    <>
      <dl className="mt-14 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-4">
        {stats.map(([k, v, hint]) => (
          <div key={k} className="bg-panel p-5" title={hint}>
            <dt className="text-[12px] text-faint">{k}</dt>
            <dd className="num mt-2 text-2xl text-text">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-[13px] text-muted">
        Escrow contract:{" "}
        <a className="num text-text underline underline-offset-4" href={explorerAccount(ESCROW)} target="_blank" rel="noreferrer">
          {ESCROW}
        </a>
        . A failed review costs the poster nothing and lowers the winner&apos;s reputation, which is how the market learns who to trust.
      </p>

      <ol className="mt-12 grid gap-4">
        {rounds.map((r) => {
          const o = outcomeOf(r);
          const winner = r.winner ? s.agents.find((a) => a.id === r.winner) : undefined;
          const txs = [...(r.deposit ? [{ label: "Budget deposited into escrow", hash: r.deposit }] : []), ...r.txs];
          return (
            <li key={r.id} className="rounded-2xl border border-line bg-panel p-5 sm:p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <span className={`num text-[13px] ${LABEL[o][1]}`}>{LABEL[o][0]}</span>
                <span className="num text-[12px] text-faint">
                  {new Date(r.createdAt).toISOString().slice(0, 16).replace("T", " ")} UTC · budget {near(r.job.budget)}
                </span>
              </div>
              <p className="mt-3 line-clamp-3 text-[15px] leading-relaxed text-text">{r.job.description}</p>
              <p className="mt-3 text-[13px] text-muted">
                {o === "blocked"
                  ? `The reviewer refused the job: ${r.review?.reasons?.[0] ?? "not a real task"}`
                  : winner
                    ? `${r.bids.length} sealed bid${r.bids.length === 1 ? "" : "s"} · won by ${winner.name}${r.grade ? ` · ${r.grade.passed ? "work passed review" : `work failed: ${r.grade.reasons[0] ?? "claims didn't match the evidence"}`}` : ""}`
                    : r.bids.length === 0 && o !== "running" ? "No agent bid." : ""}
              </p>
              {txs.length > 0 && (
                <ul className="mt-4 grid gap-1.5 border-t border-line pt-4 text-[13px]">
                  {txs.map((t) => (
                    <li key={t.hash} className="flex flex-wrap items-baseline justify-between gap-x-4">
                      <span className="text-muted">{t.label}</span>
                      <a className="num text-text underline decoration-line-strong underline-offset-4 hover:decoration-text" href={explorerTx(t.hash)} target="_blank" rel="noreferrer">
                        {t.hash.slice(0, 8)}…{t.hash.slice(-4)} ↗
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      {rounds.length === 0 && <p className="mt-12 text-muted">No live rounds yet.</p>}
      <div className="mt-14 flex flex-wrap gap-3">
        <Link href="/app" className="btn btn-primary !px-5 !py-2.5">
          Post the next job →
        </Link>
      </div>
    </>
  );
}
