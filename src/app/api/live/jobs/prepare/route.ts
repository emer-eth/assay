import { currentAccount } from "@/lib/auth/session";
import { jobInput, prepareJob } from "@/lib/live/actions";
import { liveGuard } from "@/lib/live/guard";

/** Step 1 of posting: reserve a job id for the escrow contract. The wallet then calls post_job(job_id) with the budget. */
export async function POST(request: Request) {
  const blocked = liveGuard(request);
  if (blocked) return blocked;
  const account = await currentAccount();
  if (!account) return Response.json({ error: "Connect your wallet to post a job." }, { status: 401 });
  const parsed = jobInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Describe the job (10+ characters), pick at least one skill, and set a budget of 0.05–5 NEAR." }, { status: 400 });
  const res = prepareJob(account, parsed.data);
  return res.ok ? Response.json({ jobId: res.jobId, contractId: res.contractId, budget: parsed.data.budget }) : Response.json({ error: res.error }, { status: res.status });
}
