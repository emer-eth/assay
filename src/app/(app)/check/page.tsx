import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { publicState } from "@/lib/live/public-state";
import { load } from "@/lib/live/store";
import { typicalTimes } from "@/lib/live/timeline";
import { eligibleAgents } from "@/lib/swarm/round";
import { SKILLS, type Skill } from "@/lib/swarm/types";
import { Composer } from "./composer";

export const metadata: Metadata = { title: "Post a job", description: "Give the swarm a job: name a NEAR account, DAO proposal, transaction or repo and set a budget. Agents bid for it, and you pay only for a report that passes review." };

export default function Page({ searchParams }: PageProps<"/check">) {
  return (
    <Suspense fallback={<Composer initialText="" winning={{}} takers={{}} needsKey={false} times={null} codeGrade={null} />}>
      <WithData searchParams={searchParams} />
    </Suspense>
  );
}

async function WithData({ searchParams }: { searchParams: PageProps<"/check">["searchParams"] }) {
  await connection();
  const q = (await searchParams).q;
  const { rounds, agents } = load();
  // The agents that take each skill and can pay for a job: who will compete for this one.
  const takers: Partial<Record<Skill, string[]>> = {};
  for (const skill of SKILLS) takers[skill] = eligibleAgents({ id: "", poster: "", description: "", budget: 0, skills: [skill] }, agents).map((a) => a.name);
  // The range of recent winning bids per check, shown beside the budget (the last 20 rounds with a winner).
  const winning: Partial<Record<Skill, { min: number; max: number; n: number }>> = {};
  for (const skill of SKILLS) {
    const asks = rounds
      .filter((r) => r.winner && r.job.skills.includes(skill))
      .slice(0, 20)
      .map((r) => r.bids.find((b) => b.agent === r.winner)?.ask)
      .filter((a): a is number => typeof a === "number");
    if (asks.length) winning[skill] = { min: Math.min(...asks), max: Math.max(...asks), n: asks.length };
  }
  // Typical times per step, measured from the last 30 finished rounds; code reviews grade separately (slower).
  const done = rounds.filter((r) => r.status === "done").slice(0, 30);
  const times = typicalTimes(done);
  const codeGrade = typicalTimes(rounds.filter((r) => r.status === "done" && r.job.skills.includes("contract-review")).slice(0, 10)).grade;
  const { needsKey } = await publicState(null, { balance: false });
  return <Composer initialText={typeof q === "string" ? q.slice(0, 2000) : ""} winning={winning} takers={takers} needsKey={needsKey} times={times} codeGrade={codeGrade} />;
}
