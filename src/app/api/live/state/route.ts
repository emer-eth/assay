import { availableNear } from "@/lib/near";
import { ACTIVE } from "@/lib/live/coordinator";
import { load } from "@/lib/live/store";

// Everything the live page shows. Sealed bids stay hidden until bidding has closed.
let coordinatorCache: { at: number; near: number | null } = { at: 0, near: null };

export async function GET() {
  const state = load();
  const id = process.env.NEAR_ACCOUNT_ID || null;
  if (id && Date.now() - coordinatorCache.at > 10_000) coordinatorCache = { at: Date.now(), near: await availableNear(id).catch(() => null) };
  return Response.json({
    configured: !!(process.env.NEAR_AI_API_KEY && id && process.env.NEAR_PRIVATE_KEY),
    needsKey: !!process.env.LIVE_KEY,
    coordinator: { id, near: coordinatorCache.near },
    agents: state.agents,
    rounds: state.rounds.slice(0, 30).map((r) => (r.status === "reviewing" || r.status === "bidding" ? { ...r, bids: [] } : r)),
    busy: state.rounds.some((r) => ACTIVE.includes(r.status)),
  });
}
