import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { recoverInterrupted } from "@/lib/live/coordinator";
import { toRow } from "@/lib/live/rows";
import { load } from "@/lib/live/store";
import { LedgerView } from "./ledger-view";

export const metadata: Metadata = { title: "Ledger", description: "Every round on Assay, including the ones that failed: one balanced line each, with the on-chain payments and refunds." };

// Every round as one balanced line (build spec, Ledger), read on the server so first paint needs no fetch.
export default function Page() {
  return (
    <Suspense fallback={<LedgerView rows={[]} aiSpend={0} loading />}>
      <WithRows />
    </Suspense>
  );
}

async function WithRows() {
  await connection();
  recoverInterrupted();
  const s = load();
  const rows = s.rounds.map((r) => toRow(r, s.agents));
  const aiSpend = s.rounds.reduce((sum, r) => sum + (r.payout?.aiCost ?? 0), 0);
  return <LedgerView rows={rows} aiSpend={Math.round(aiSpend * 1e4) / 1e4} />;
}
