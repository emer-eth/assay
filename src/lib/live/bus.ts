import "server-only";
import { EventEmitter } from "node:events";
import type { LiveAgent, LiveRound } from "./store";

// The live event bus. Every write to the market goes through store.save(), which hands the new state here;
// the bus compares it with the last save and emits only what changed: round.created, round.updated and
// agent.updated, each with the raw record (the events route filters it for the viewer). One process runs the
// market, so an in-memory emitter reaches every open stream. Kept on globalThis so dev reloads share one bus.

export type MarketEvent =
  | { type: "round.created"; round: LiveRound }
  | { type: "round.updated"; round: LiveRound }
  | { type: "agent.updated"; agent: LiveAgent };

type Bus = { emitter: EventEmitter; rounds: Map<string, string> | null; agents: Map<string, string> | null };
const g = globalThis as typeof globalThis & { __assayBus?: Bus };
const bus: Bus = (g.__assayBus ??= { emitter: new EventEmitter().setMaxListeners(0), rounds: null, agents: null });

// A cheap fingerprint: every change to a round moves at least one of these (a step, a status, a payment, the work).
const roundSig = (r: LiveRound) =>
  [r.status, r.steps.length, r.txs.length, r.bids.length, r.winner ?? "", r.deliverable?.length ?? 0, r.grade ? String(r.grade.passed) : "", r.payout?.refundToPoster ?? "", r.evidence ? 1 : 0, r.escrowJobId ?? "", r.error ?? ""].join("|");
const agentSig = (a: LiveAgent) => JSON.stringify(a);

export function publishChanges(state: { rounds: LiveRound[]; agents: LiveAgent[] }) {
  const first = bus.rounds === null;
  const rounds = new Map(state.rounds.map((r) => [r.id, roundSig(r)]));
  const agents = new Map(state.agents.map((a) => [a.id, agentSig(a)]));
  if (!first && bus.emitter.listenerCount("event") > 0) {
    for (const r of state.rounds) {
      const before = bus.rounds!.get(r.id);
      if (before === undefined) bus.emitter.emit("event", { type: "round.created", round: r } satisfies MarketEvent);
      else if (before !== rounds.get(r.id)) bus.emitter.emit("event", { type: "round.updated", round: r } satisfies MarketEvent);
    }
    for (const a of state.agents) if (bus.agents!.get(a.id) !== agents.get(a.id)) bus.emitter.emit("event", { type: "agent.updated", agent: a } satisfies MarketEvent);
  }
  bus.rounds = rounds;
  bus.agents = agents;
}

export function subscribe(fn: (e: MarketEvent) => void) {
  bus.emitter.on("event", fn);
  return () => void bus.emitter.off("event", fn);
}
