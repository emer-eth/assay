import { z } from "zod";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { rememberPayment } from "@/lib/auth/session";
import { jobInput } from "@/lib/live/actions";
import { liveGuard } from "@/lib/live/guard";
import { startPayIn } from "@/lib/live/intents-pay";
import { load } from "@/lib/live/store";
import { LIMITS } from "@/lib/network";

// Pay for a job with NEAR Intents (mainnet): a 1Click quote for the budget, paid in any supported token.
// No wallet or sign-in: the payment id this returns (also kept in a sealed cookie) is the payer's key to the round.
const input = jobInput.extend({ asset: z.string().max(20), refundTo: z.string().trim().min(10).max(100) });
const MAX_OPEN = 30; // quotes waiting for a deposit at once, so nobody can flood 1Click through us

export async function POST(request: Request) {
  const blocked = liveGuard(request);
  if (blocked) return blocked;
  const limited = rateLimit(`pay:${clientIp(request)}`, 10, 10 * 60_000);
  if (limited) return limited;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: `Describe the job (10+ characters), pick a check, set a budget of 0.05–${LIMITS.maxBudget} NEAR, a token and your refund address.` }, { status: 400 });
  if (load().intentPayments.filter((p) => p.status === "waiting").length >= MAX_OPEN) return Response.json({ error: "Too many payments are waiting for a deposit right now. Try again in a few minutes." }, { status: 429 });
  const { asset, refundTo, ...job } = parsed.data;
  const res = await startPayIn(job, asset, refundTo);
  if (!res.ok) return Response.json({ error: res.error }, { status: res.status });
  await rememberPayment(res.payment.id);
  return Response.json(res.payment, { status: 201 });
}
