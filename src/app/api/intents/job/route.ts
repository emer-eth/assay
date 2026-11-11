import { after } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import { currentSession } from "@/lib/auth/session";
import { jobInput } from "@/lib/live/actions";
import { enqueueRound } from "@/lib/live/coordinator";
import { liveGuard } from "@/lib/live/guard";
import { prepareIntentsJob, submitIntentsJob } from "@/lib/live/intents-jobs";

export const maxDuration = 120;

// Post a job paid with a signed NEAR Intents transfer, in two steps:
//  prepare: the job -> the message to sign, and what the wallet must do first (deposit, register its key);
//  submit:  the wallet's signature -> the coordinator executes the intent and the round starts.
const submitInput = z.object({ step: z.literal("submit"), jobId: z.string().regex(/^sfh-n-[a-z0-9-]{8,20}$/), publicKey: z.string().max(80), signature: z.string().max(200) });

export async function POST(request: Request) {
  const blocked = liveGuard(request);
  if (blocked) return blocked;
  const session = await currentSession();
  if (!session) return Response.json({ error: "Connect your wallet to pay with NEAR Intents." }, { status: 401 });
  const limited = rateLimit(`intents-job:${session.accountId}`, 30, 10 * 60_000);
  if (limited) return limited;
  const body = await request.json().catch(() => null);
  const submit = submitInput.safeParse(body);
  if (submit.success) {
    const res = await submitIntentsJob(session.accountId, submit.data.jobId, submit.data.publicKey, submit.data.signature);
    if (!res.ok) return Response.json({ error: res.error, needKey: "needKey" in res ? res.needKey : undefined }, { status: res.status });
    after(() => enqueueRound(res.id));
    return Response.json({ id: res.id, tx: res.tx }, { status: 202 });
  }
  const job = jobInput.safeParse(body);
  if (!job.success) return Response.json({ error: "Describe the job (10+ characters), pick a check and set a budget." }, { status: 400 });
  const res = await prepareIntentsJob(session.accountId, session.publicKey, job.data);
  if (!res.ok) return Response.json({ error: res.error }, { status: res.status });
  return Response.json(res);
}
