import { jobQuality } from "../swarm/round";
import type { Skill } from "../swarm/types";
import { ACTIVE } from "./status";
import type { LiveAgent, LiveRound } from "./store";
import { phaseOf, type Phase } from "./timeline";

// What the home page's swarm panel shows: the round in progress if there is one, else the latest round whose
// sealed bids were revealed. Pure, so the server renders it and the browser recomputes it from the live store.

export type SwarmBid = { agent: string; reputation: number; ask?: number; value?: number; winner?: boolean };
export type SwarmSnapshot = {
  agents: number;
  round: { id: string; title: string; skills: Skill[]; phase: Phase; live: boolean; budget: number; paid: number | null } | null;
  bids: SwarmBid[];
  sealed: boolean;
};

type R = Pick<LiveRound, "id" | "status" | "job" | "bids" | "eligible" | "winner" | "grade" | "payout">;
type A = Pick<LiveAgent, "id" | "name" | "quality" | "skillQuality">;

export function swarmSnapshot(rounds: R[], agents: A[]): SwarmSnapshot {
  const name = (id: string) => agents.find((a) => a.id === id)?.name ?? id.split(".")[0];
  // A live round past review (agents are looking at it), else the newest round with at least two revealed bids.
  const r =
    rounds.find((x) => ACTIVE.includes(x.status) && x.status !== "queued" && x.status !== "reviewing" && x.eligible.length > 0) ??
    rounds.find((x) => x.bids.length >= 2 && x.status === "done") ??
    rounds.find((x) => x.bids.length > 0);
  if (!r) return { agents: agents.length, round: null, bids: [], sealed: false };
  const sealed = r.bids.length === 0;
  const bids: SwarmBid[] = sealed
    ? r.eligible.map((id) => {
        const a = agents.find((x) => x.id === id);
        return { agent: name(id), reputation: a ? jobQuality(a, r.job) : 0.5 };
      })
    : [...r.bids]
        .sort((a, b) => b.value - a.value)
        .map((b) => ({ agent: name(b.agent), reputation: Math.cbrt(b.value * b.ask), ask: b.ask, value: b.value, winner: b.agent === r.winner }));
  return {
    agents: agents.length,
    round: {
      id: r.id,
      title: r.job.description,
      skills: r.job.skills,
      phase: phaseOf(r as LiveRound),
      live: ACTIVE.includes(r.status),
      budget: r.job.budget,
      paid: r.payout ? r.payout.toAgent : null,
    },
    bids: bids.slice(0, 5),
    sealed,
  };
}
