import "server-only";

// Live mode spends NEAR AI credits and NEAR (test NEAR on testnet, real NEAR on mainnet). Every job and every agent is now paid for from the
// user's own wallet (checked on chain), so the public can use it. LIVE_KEY optionally locks it down further:
// when set, every write must also send that key.
export function liveGuard(request: Request): Response | null {
  const key = process.env.LIVE_KEY;
  if (key && request.headers.get("x-live-key") !== key) return Response.json({ error: "Wrong or missing live key." }, { status: 401 });
  if (!process.env.NEAR_AI_API_KEY || !process.env.NEAR_ACCOUNT_ID || !process.env.NEAR_PRIVATE_KEY)
    return Response.json({ error: "Live mode needs NEAR_AI_API_KEY, NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY in .env. Run `npm run spike` first." }, { status: 503 });
  return null;
}

export { LIMITS } from "../network";
