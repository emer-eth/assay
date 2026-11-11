"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useMarket } from "@/lib/market";
import { swarmSnapshot, type SwarmSnapshot } from "@/lib/live/swarm-snapshot";
import { PHASE_WORD } from "@/lib/live/timeline";
import { SKILL_LABEL } from "@/lib/swarm/types";
import { BidTable, Label } from "@/ui";

// The home page's view of the swarm at work: the round agents are bidding on or working now, else the latest
// round whose sealed bids were revealed, with every bid, its reputation and the winner. The server renders it;
// the live store keeps it moving while the page is open.

export function SwarmPanel({ initial }: { initial: SwarmSnapshot }) {
  const rounds = useMarket((s) => s?.rounds);
  const agents = useMarket((s) => s?.agents);
  const snap = useMemo(() => (rounds && agents ? swarmSnapshot(rounds, agents) : initial), [rounds, agents, initial]);
  const r = snap.round;
  const winner = snap.bids.find((b) => b.winner)?.agent;

  return (
    <section className="border border-ink bg-sheet p-5 sm:p-6" aria-labelledby="swarm-h">
      <div className="flex items-center justify-between gap-3">
        <h2 id="swarm-h" className="flex items-center gap-2.5 font-mono text-xs font-medium tracking-[0.08em] text-ink-2 uppercase">
          {r?.live && <span aria-hidden className="live-dot size-2 rounded-full bg-stamp" />}
          {r?.live ? "The swarm, working now" : "The swarm's last round"}
        </h2>
        {r && <span className={`font-mono text-xs font-medium tracking-[0.08em] uppercase ${r.phase === "passed" ? "text-stamp" : r.live ? "text-ink" : "text-refund"}`}>{PHASE_WORD[r.phase]}</span>}
      </div>

      {r ? (
        <>
          <p className="mt-4 line-clamp-2 text-[17px] leading-6 font-semibold text-ink [overflow-wrap:anywhere]">{r.title}</p>
          <p className="mt-1 text-sm text-ink-2">{r.skills.map((s) => SKILL_LABEL[s]).join(", ")} · budget <span className="font-mono">{r.budget.toFixed(2)}</span> NEAR</p>
          <div className="mt-5" aria-live="polite">
            <BidTable bids={snap.bids} sealed={snap.sealed} caption={snap.sealed ? `${snap.bids.length} agents bidding, sealed` : `${snap.bids.length} sealed bids, revealed`} />
          </div>
          <p className="mt-4 text-[15px] leading-6 text-ink">
            {r.phase === "passed" && winner && <>{winner} won on value, passed review and was paid <span className="font-mono">{r.paid?.toFixed(3)}</span> NEAR.</>}
            {r.phase === "refunded" && winner && <>{winner} won but its report failed review, so the poster got the whole budget back.</>}
            {r.live && (snap.sealed ? "Each agent prices the job without seeing the others." : winner ? `${winner} won and is on the job.` : "")}
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-4 text-[15px]">
            <Link href={`/rounds/${r.id}`} prefetch={false} className="inline-flex min-h-11 items-center text-stamp underline underline-offset-2">{r.live ? "Watch it live" : "Open the round"}</Link>
            <Link href="/agents" prefetch={false} className="inline-flex min-h-11 items-center text-ink-2 underline underline-offset-2">{snap.agents} agents in the swarm</Link>
          </div>
        </>
      ) : (
        <>
          <Label as="p" className="mt-4">No rounds yet</Label>
          <p className="mt-2 text-[15px] text-ink-2">{snap.agents} agents are waiting for the first job.</p>
        </>
      )}
    </section>
  );
}
