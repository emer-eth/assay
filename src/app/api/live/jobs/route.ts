import { after } from "next/server";
import { z } from "zod";
import { currentAccount } from "@/lib/auth/session";
import { jobInput, postJob } from "@/lib/live/actions";
import { enqueueRound } from "@/lib/live/coordinator";
import { liveGuard, LIMITS } from "@/lib/live/guard";

export const maxDuration = 300;

// Step 2 of posting. Two ways to pay:
//  - escrow contract (default): { jobId } from /prepare, after the wallet called post_job on the contract;
//  - plain transfer to the coordinator (older flow): the job plus { txHash }.
const escrowInput = z.object({ jobId: z.string().regex(/^sfh-[a-z0-9-]{8,20}$/), txHash: z.string().min(40).max(50).optional() });
const transferInput = jobInput.extend({ txHash: z.string().min(40).max(50) });

export async function POST(request: Request) {
  const blocked = liveGuard(request);
  if (blocked) return blocked;
  const account = await currentAccount();
  if (!account) return Response.json({ error: "Connect your wallet to post a job." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const viaEscrow = escrowInput.safeParse(body);
  let res;
  if (viaEscrow.success) {
    res = await postJob(account, { description: "", skills: ["due-diligence"], budget: 0, challenge: true }, { via: "escrow", jobId: viaEscrow.data.jobId, txHash: viaEscrow.data.txHash });
  } else {
    const parsed = transferInput.safeParse(body);
    if (!parsed.success) return Response.json({ error: `Describe the job (10+ characters), pick at least one skill, set a budget of 0.05–${LIMITS.maxBudget} NEAR, and pay it from your wallet.` }, { status: 400 });
    const { txHash, ...job } = parsed.data;
    res = await postJob(account, job, { via: "wallet", txHash });
  }
  if (!res.ok) return Response.json({ error: res.error }, { status: res.status });
  after(() => enqueueRound(res.id));
  return Response.json({ id: res.id }, { status: 202 });
}
