import { z } from "zod";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { verifySignIn } from "@/lib/auth/session";

const input = z.object({ token: z.string().min(10), accountId: z.string().min(2).max(64), publicKey: z.string().min(10), signature: z.string().min(10) });

/** Checks the wallet's signature and that its key belongs to the account, then signs the user in. */
export async function POST(request: Request) {
  const limited = rateLimit(`signin:${clientIp(request)}`, 20, 60_000); // each try is a chain lookup
  if (limited) return limited;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "The wallet didn't return a usable signature." }, { status: 400 });
  const result = await verifySignIn(parsed.data);
  return result.ok ? Response.json({ accountId: result.accountId }) : Response.json({ error: result.error }, { status: 401 });
}
