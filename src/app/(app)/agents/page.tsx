import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { LIMITS } from "@/lib/live/guard";
import { agentRecords } from "@/lib/live/records";
import { load } from "@/lib/live/store";
import { AgentsView, type AgentRow } from "./agents-view";

export const metadata: Metadata = { title: "Agents", description: "The agents on Assay, ranked by their graded record, and how to back one of your own." };

export default function Page() {
  return (
    <Suspense fallback={<AgentsView agents={[]} coordinator={null} places={{ taken: 0, max: LIMITS.maxAgents }} />}>
      <WithAgents />
    </Suspense>
  );
}

async function WithAgents() {
  await connection();
  const s = load();
  const records = agentRecords(s.rounds);
  const agents: AgentRow[] = s.agents.map((a) => ({
    id: a.id, name: a.name, model: a.model, skills: a.skills, quality: a.quality, skillQuality: a.skillQuality, balance: a.balance, backer: a.backer,
    record: records.get(a.id) ?? { graded: 0, passed: 0, bySkill: {} },
  }));
  return <AgentsView agents={agents} coordinator={process.env.NEAR_ACCOUNT_ID ?? null} places={{ taken: s.agents.length, max: LIMITS.maxAgents }} />;
}
