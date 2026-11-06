import { z } from "zod";
import { currentAccount } from "@/lib/auth/session";
import { addCredit, creditOf, listApiKeys } from "@/lib/live/credit";
import { claimDeposit } from "@/lib/live/deposit";
import { liveGuard } from "@/lib/live/guard";

/** Your prepaid credit and API keys (for using Swarm-for-Hire from an AI assistant over MCP). */
export async function GET() {
  const account = await currentAccount();
  if (!account) return Response.json({ error: "Connect your wallet." }, { status: 401 });
  return Response.json({ account, credit: creditOf(account), keys: listApiKeys(account) }, { headers: { "cache-control": "no-store" } });
}

const topUp = z.object({ amount: z.coerce.number().min(0.1).max(10), txHash: z.string().min(40).max(50) });

/** Top up: the user's wallet sends NEAR to escrow, checked on chain, then it's added to their credit. */
export async function POST(request: Request) {
  const blocked = liveGuard(request);
  if (blocked) return blocked;
  const account = await currentAccount();
  if (!account) return Response.json({ error: "Connect your wallet to top up." }, { status: 401 });
  const parsed = topUp.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Top up 0.1–10 NEAR, paid from your wallet." }, { status: 400 });
  const paid = await claimDeposit(parsed.data.txHash, account, parsed.data.amount, "credit top-up");
  if (!paid.ok) return Response.json({ error: paid.error }, { status: 402 });
  return Response.json({ credit: addCredit(account, parsed.data.amount) });
}
