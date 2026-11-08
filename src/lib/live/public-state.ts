import "server-only";
import { availableNear } from "../near";
import { ACTIVE, recoverInterrupted } from "./coordinator";
import { load } from "./store";
import { forViewer } from "./visibility";

// Everything the live page shows: sealed bids stay hidden until bidding closes, and delivered work
// is only included for the poster who paid for it (see visibility.ts). Shared by the API route and
// the server render, so the first HTML already carries the real agents and rounds.
let coordinatorCache: { at: number; near: number | null } = { at: 0, near: null };

export async function publicState(viewer: string | null, opts: { balance?: boolean } = {}) {
  recoverInterrupted();
  const state = load();
  const id = process.env.NEAR_ACCOUNT_ID || null;
  // The coordinator balance is a chain call; pages that don't show it skip it.
  if (opts.balance !== false && id && Date.now() - coordinatorCache.at > 10_000) coordinatorCache = { at: Date.now(), near: await availableNear(id).catch(() => null) };
  return {
    configured: !!(process.env.NEAR_AI_API_KEY && id && process.env.NEAR_PRIVATE_KEY),
    needsKey: !!process.env.LIVE_KEY,
    viewer,
    coordinator: { id, near: coordinatorCache.near },
    agents: state.agents,
    rounds: state.rounds.slice(0, 30).map((r) => forViewer(r, viewer)),
    busy: state.rounds.some((r) => ACTIVE.includes(r.status)),
  };
}
export type PublicState = Awaited<ReturnType<typeof publicState>>;
