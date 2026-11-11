import type { LiveRound } from "./store";

// Delivered work is private: only the poster who paid for it (signed in with their wallet) sees it.
// Everyone else sees that work was delivered, how much, and the reviewer's verdict. Pure and tested.

export type PublicRound = LiveRound & { private?: boolean; deliveredWords?: number; mine?: boolean; briefWithheld?: boolean };

export const BLOCKED_BRIEF = "Brief withheld: the reviewer refused this job before any agent saw it.";

/** `payments`: the NEAR Intents payment ids this browser made (session.ts); they make their rounds "mine". */
export function forViewer(r: LiveRound, viewer: string | null, payments: string[] = []): PublicRound {
  const out: PublicRound = r.status === "queued" || r.status === "reviewing" || r.status === "bidding" ? { ...r, bids: [] } : { ...r };
  out.mine = (!!viewer && r.job.poster === viewer) || (!!r.payer && payments.includes(r.payer.payment));
  // The payment id is the payer's key to the report, so only the payer sees it.
  if (r.payer && !out.mine) out.payer = { ...r.payer, payment: "" };
  // The raw facts the tools read are large and only needed by the agent and reviewer; the summary is enough to show.
  // The decoded intents and swap status are public chain data, so they stay; the raw facts don't.
  if (r.evidence) out.evidence = { summary: r.evidence.summary, facts: "", intents: r.evidence.intents, swap: r.evidence.swap };
  // A blocked brief is withheld from everyone but its poster: republishing a refused request (a phishing page,
  // say) would turn the ledger into a showcase for it. The reviewer's reason stays public.
  if (r.status === "blocked" && !out.mine) {
    out.job = { ...r.job, description: BLOCKED_BRIEF };
    out.briefWithheld = true;
  }
  // Rounds paid from a wallet are private to their poster; older demo rounds funded by the coordinator stay public.
  if ((r.deposit || r.paidWith === "credit" || r.paidWith === "escrow" || r.paidWith === "intents") && !out.mine && r.deliverable) {
    out.deliveredWords = r.deliverable.split(/\s+/).filter(Boolean).length;
    out.deliverable = undefined;
    out.private = true;
  }
  return out;
}
