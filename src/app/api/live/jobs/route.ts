import { after } from "next/server";
import { z } from "zod";
import { activeRound, createRound, runLiveRound } from "@/lib/live/coordinator";
import { claimDeposit } from "@/lib/live/deposit";
import { currentAccount } from "@/lib/auth/session";
import { LIMITS, liveGuard } from "@/lib/live/guard";

export const maxDuration = 300;

const input = z.object({
  description: z.string().trim().min(10).max(2000),
  skills: z.array(z.enum(["writing", "research", "code", "data", "design", "translation"])).min(1),
  budget: z.coerce.number().min(0.05).max(LIMITS.maxBudget),
  txHash: z.string().min(40).max(50), // the escrow payment from the poster's wallet
});

/** Posts a job and runs its round in the background; the page follows progress through /api/live/state. */
export async function POST(request: Request) {
  const blocked = liveGuard(request);
  if (blocked) return blocked;
  const account = await currentAccount();
  if (!account) return Response.json({ error: "Connect your wallet to post a job." }, { status: 401 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Describe the job (10+ characters), pick at least one skill, set a budget of 0.05–5 NEAR, and pay it from your wallet." }, { status: 400 });
  if (activeRound()) return Response.json({ error: "A round is already running. Wait for it to finish." }, { status: 409 });
  const { txHash, ...job } = parsed.data;
  const paid = await claimDeposit(txHash, account, job.budget, "job");
  if (!paid.ok) return Response.json({ error: paid.error }, { status: 402 });
  const round = createRound(job, account, txHash);
  after(() => runLiveRound(round.id));
  return Response.json({ id: round.id }, { status: 202 });
}
