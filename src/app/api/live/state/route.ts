import { currentAccount } from "@/lib/auth/session";
import { availableNear } from "@/lib/near";
import { ACTIVE } from "@/lib/live/coordinator";
import { load } from "@/lib/live/store";
import { forViewer } from "@/lib/live/visibility";

// Everything the live page shows: sealed bids stay hidden until bidding closes, and delivered work
// is only included for the poster who paid for it (see lib/live/visibility.ts).
let coordinatorCache: { at: number; near: number | null } = { at: 0, near: null };

export async function GET() {
  const [state, viewer] = [load(), await currentAccount()];
  const id = process.env.NEAR_ACCOUNT_ID || null;
  if (id && Date.now() - coordinatorCache.at > 10_000) coordinatorCache = { at: Date.now(), near: await availableNear(id).catch(() => null) };
  return Response.json(
    {
      configured: !!(process.env.NEAR_AI_API_KEY && id && process.env.NEAR_PRIVATE_KEY),
      needsKey: !!process.env.LIVE_KEY,
      viewer,
      coordinator: { id, near: coordinatorCache.near },
      agents: state.agents,
      rounds: state.rounds.slice(0, 30).map((r) => forViewer(r, viewer)),
      busy: state.rounds.some((r) => ACTIVE.includes(r.status)),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
