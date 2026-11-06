import { after } from "next/server";
import { z } from "zod";
import { currentAccount } from "@/lib/auth/session";
import { jobInput, postJob } from "@/lib/live/actions";
import { runLiveRound } from "@/lib/live/coordinator";
import { liveGuard } from "@/lib/live/guard";

export const maxDuration = 300;

const input = jobInput.extend({ txHash: z.string().min(40).max(50) }); // the escrow payment from the poster's wallet

/** Posts a job paid from the poster's wallet and runs its round in the background. */
export async function POST(request: Request) {
  const blocked = liveGuard(request);
  if (blocked) return blocked;
  const account = await currentAccount();
  if (!account) return Response.json({ error: "Connect your wallet to post a job." }, { status: 401 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Describe the job (10+ characters), pick at least one skill, set a budget of 0.05–5 NEAR, and pay it from your wallet." }, { status: 400 });
  const { txHash, ...job } = parsed.data;
  const res = await postJob(account, job, { via: "wallet", txHash });
  if (!res.ok) return Response.json({ error: res.error }, { status: res.status });
  after(() => runLiveRound(res.id));
  return Response.json({ id: res.id }, { status: 202 });
}
