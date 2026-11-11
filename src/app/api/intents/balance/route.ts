import { currentAccount } from "@/lib/auth/session";
import { INTENTS_ID, intentsBalance } from "@/lib/live/intents-verifier";

/** The signed-in account's wNEAR balance on the NEAR Intents verifier (refunds land here). */
export async function GET() {
  const account = await currentAccount();
  if (!account) return Response.json({ error: "Not signed in." }, { status: 401 });
  const yocto = await intentsBalance(account).catch(() => 0n);
  return Response.json({ verifier: INTENTS_ID, yocto: yocto.toString(), near: Number(yocto / 10n ** 18n) / 1e6 }, { headers: { "cache-control": "no-store" } });
}
