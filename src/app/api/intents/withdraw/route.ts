import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import { currentAccount } from "@/lib/auth/session";
import { liveGuard } from "@/lib/live/guard";
import { prepareWithdraw, submitWithdraw } from "@/lib/live/intents-jobs";

// Take your NEAR Intents balance back to your wallet: sign a native_withdraw intent; the coordinator submits it.
const submitInput = z.object({ sign: z.object({ message: z.string().max(2000), nonce: z.string().max(60) }), publicKey: z.string().max(80), signature: z.string().max(200) });

export async function POST(request: Request) {
  const blocked = liveGuard(request);
  if (blocked) return blocked;
  const account = await currentAccount();
  if (!account) return Response.json({ error: "Connect your wallet first." }, { status: 401 });
  // The coordinator pays the gas for every relayed withdrawal.
  const limited = rateLimit(`withdraw:${account}`, 10, 10 * 60_000);
  if (limited) return limited;
  const body = await request.json().catch(() => null);
  const submit = submitInput.safeParse(body);
  const res = submit.success ? await submitWithdraw(account, submit.data.sign, submit.data.publicKey, submit.data.signature) : await prepareWithdraw(account);
  if (!res.ok) return Response.json({ error: res.error }, { status: res.status });
  return Response.json(res);
}
