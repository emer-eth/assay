import { currentAccount } from "@/lib/auth/session";
import { intentsBalance } from "@/lib/live/intents-verifier";
import { availableNear } from "@/lib/near";
import { rateLimit } from "@/lib/rate-limit";

/** The signed-in account's NEAR: what its wallet can spend, and what it holds on NEAR Intents (refunds land there). */
export async function GET() {
  const account = await currentAccount();
  if (!account) return Response.json({ error: "Not signed in." }, { status: 401 });
  const limited = rateLimit(`balance:${account}`, 30, 60_000); // two chain reads per call
  if (limited) return limited;
  const [near, yocto] = await Promise.all([availableNear(account).catch(() => null), intentsBalance(account).catch(() => null)]);
  return Response.json({ account, near, intents: yocto === null ? null : Number(yocto / 10n ** 18n) / 1e6 }, { headers: { "cache-control": "no-store" } });
}
