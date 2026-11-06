import { z } from "zod";
import { currentAccount } from "@/lib/auth/session";
import { coordinator, sendNear } from "@/lib/near";
import { addCredit, creditOf, spendCredit } from "@/lib/live/credit";
import { liveGuard } from "@/lib/live/guard";

const input = z.object({ amount: z.coerce.number().positive().optional() });

/** Sends unused credit back to the user's wallet (all of it, unless an amount is given). */
export async function POST(request: Request) {
  const blocked = liveGuard(request);
  if (blocked) return blocked;
  const account = await currentAccount();
  if (!account) return Response.json({ error: "Connect your wallet to withdraw." }, { status: 401 });
  const parsed = input.safeParse(await request.json().catch(() => ({})));
  const amount = Math.floor((parsed.success && parsed.data.amount ? parsed.data.amount : creditOf(account)) * 1e6) / 1e6;
  if (amount <= 0) return Response.json({ error: "No credit to withdraw." }, { status: 400 });
  if (!spendCredit(account, amount)) return Response.json({ error: "You don't have that much credit." }, { status: 400 });
  try {
    const hash = await sendNear(coordinator(), account, amount);
    return Response.json({ amount, hash, credit: creditOf(account) });
  } catch (e) {
    addCredit(account, amount); // the transfer didn't happen: put the credit back
    return Response.json({ error: `The withdrawal didn't go through: ${e instanceof Error ? e.message : e}` }, { status: 502 });
  }
}
