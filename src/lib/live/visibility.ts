import type { LiveRound } from "./store";

// Delivered work is private: only the poster who paid for it (signed in with their wallet) sees it.
// Everyone else sees that work was delivered, how much, and the reviewer's verdict. Pure and tested.

export type PublicRound = LiveRound & { private?: boolean; deliveredWords?: number; mine?: boolean };

export function forViewer(r: LiveRound, viewer: string | null): PublicRound {
  const out: PublicRound = r.status === "reviewing" || r.status === "bidding" ? { ...r, bids: [] } : { ...r };
  out.mine = !!viewer && r.job.poster === viewer;
  // The raw facts the tools read are large and only needed by the agent and reviewer; the summary is enough to show.
  if (r.evidence) out.evidence = { summary: r.evidence.summary, facts: "" };
  // Rounds paid from a wallet are private to their poster; older demo rounds funded by the coordinator stay public.
  if ((r.deposit || r.paidWith === "credit" || r.paidWith === "escrow") && !out.mine && r.deliverable) {
    out.deliveredWords = r.deliverable.split(/\s+/).filter(Boolean).length;
    out.deliverable = undefined;
    out.private = true;
  }
  return out;
}
