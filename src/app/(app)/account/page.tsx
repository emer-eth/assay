import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { currentAccount } from "@/lib/auth/session";
import { agentRecords } from "@/lib/live/records";
import { toRow } from "@/lib/live/rows";
import { load } from "@/lib/live/store";
import { AccountView, type MyAgent } from "./account-view";

export const metadata: Metadata = { title: "Your account", robots: { index: false } };

// The signed-in wallet's own view: the checks it posted, the agents it backs, and its credit and keys.
// Read on the server for the account in the session cookie, so nobody else's data is ever sent.
export default function Page() {
  return (
    <Suspense fallback={<AccountView account={null} rounds={[]} agents={[]} loading />}>
      <Mine />
    </Suspense>
  );
}

async function Mine() {
  await connection();
  const account = await currentAccount();
  if (!account) return <AccountView account={null} rounds={[]} agents={[]} />;
  const s = load();
  const records = agentRecords(s.rounds);
  const rounds = s.rounds.filter((r) => r.job.poster === account).map((r) => toRow(r, s.agents));
  const agents: MyAgent[] = s.agents
    .filter((a) => a.backer === account)
    .map((a) => {
      const won = s.rounds.filter((r) => r.winner === a.id);
      return {
        id: a.id, name: a.name, model: a.model, skills: a.skills, quality: a.quality, balance: a.balance, funding: a.funding, earned: a.earned,
        aiSpend: Math.round(won.reduce((sum, r) => sum + (r.payout?.aiCost ?? 0), 0) * 1e6) / 1e6,
        roundsWon: won.length,
        record: records.get(a.id) ?? { graded: 0, passed: 0, bySkill: {} },
      };
    });
  return <AccountView account={account} rounds={rounds} agents={agents} />;
}
