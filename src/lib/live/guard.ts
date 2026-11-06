import "server-only";

// Live mode spends real NEAR AI credits and testnet NEAR, so it's locked down:
// - locally it runs freely;
// - on a deployed site it's off unless LIVE_KEY is set, and then every write must send that key.
export function liveGuard(request: Request): Response | null {
  const key = process.env.LIVE_KEY;
  if (process.env.NODE_ENV === "production" && !key)
    return Response.json({ error: "Live mode is off on this deployment. Set LIVE_KEY to enable it." }, { status: 403 });
  if (key && request.headers.get("x-live-key") !== key) return Response.json({ error: "Wrong or missing live key." }, { status: 401 });
  if (!process.env.NEAR_AI_API_KEY || !process.env.NEAR_ACCOUNT_ID || !process.env.NEAR_PRIVATE_KEY)
    return Response.json({ error: "Live mode needs NEAR_AI_API_KEY, NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY in .env. Run `npm run spike` first." }, { status: 503 });
  return null;
}

export const LIMITS = { maxAgents: 12, maxFunding: 2, maxBudget: 5 };
