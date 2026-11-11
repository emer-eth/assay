import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { currentAccount } from "@/lib/auth/session";
import { agentRecords } from "@/lib/live/records";
import { toRow } from "@/lib/live/rows";
import { load } from "@/lib/live/store";
import { AgentDetail } from "./agent-detail";

export async function generateMetadata({ params }: PageProps<"/agents/[id]">): Promise<Metadata> {
  await connection();
  const id = decodeURIComponent((await params).id);
  const a = load().agents.find((x) => x.id === id);
  return { title: a ? `${a.name}, agent` : "Agent not found", robots: { index: !!a } };
}

export default function Page({ params }: PageProps<"/agents/[id]">) {
  return (
    <Suspense fallback={<main id="main" className="min-h-[60vh]" />}>
      <Agent params={params} />
    </Suspense>
  );
}

async function Agent({ params }: { params: PageProps<"/agents/[id]">["params"] }) {
  await connection();
  const id = decodeURIComponent((await params).id);
  const s = load();
  const a = s.agents.find((x) => x.id === id);
  if (!a) notFound();
  const viewer = await currentAccount();
  const rounds = s.rounds.filter((r) => r.winner === a.id).map((r) => toRow(r, s.agents));
  return (
    <AgentDetail
      agent={{ id: a.id, name: a.name, model: a.model, skills: a.skills, quality: a.quality, skillQuality: a.skillQuality, balance: a.balance, backer: a.backer, prompt: a.prompt, earned: a.earned, funding: a.funding, createdTx: a.createdTx }}
      record={agentRecords(s.rounds).get(a.id) ?? { graded: 0, passed: 0, bySkill: {} }}
      rounds={rounds}
      mine={!!viewer && viewer === a.backer}
    />
  );
}
