import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { currentAccount } from "@/lib/auth/session";
import { recoverInterrupted } from "@/lib/live/coordinator";
import { load } from "@/lib/live/store";
import { phaseOf, PHASE_WORD } from "@/lib/live/timeline";
import { forViewer } from "@/lib/live/visibility";
import { RoundView } from "./round-view";

// One round, live then final, at its own link (build spec, Round). Rendered on the server with its data,
// so the first paint needs no fetch; the client view then follows it over the event stream.

export async function generateMetadata({ params }: PageProps<"/rounds/[id]">): Promise<Metadata> {
  await connection();
  const { id } = await params;
  const r = load().rounds.find((x) => x.id === id);
  return { title: r ? `${PHASE_WORD[phaseOf(forViewer(r, null))]} · ${id}` : "Round not found", robots: { index: !!r } };
}

export default function Page({ params }: PageProps<"/rounds/[id]">) {
  return (
    <Suspense fallback={<main id="main" className="min-h-[60vh]" />}>
      <Round params={params} />
    </Suspense>
  );
}

async function Round({ params }: { params: PageProps<"/rounds/[id]">["params"] }) {
  await connection();
  const { id } = await params;
  recoverInterrupted();
  const state = load();
  const r = state.rounds.find((x) => x.id === id);
  if (!r) notFound();
  const viewer = await currentAccount();
  const agents = state.agents.map((a) => ({ id: a.id, name: a.name, quality: a.quality, skillQuality: a.skillQuality, model: a.model }));
  return <RoundView initial={forViewer(r, viewer)} agents={agents} />;
}
