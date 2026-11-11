import "server-only";

// A small in-memory rate limit (one process runs the market, so memory is enough). It protects the things a
// request makes Assay spend: chain and NearBlocks lookups on the open target check, and the gas the
// coordinator pays to relay signed intents.

const G = globalThis as typeof globalThis & { __assayHits?: Map<string, number[]> };
const hits = (G.__assayHits ??= new Map<string, number[]>());

/** Counts one hit for `key`; returns how many seconds to wait if that's more than `max` in the window, else 0. */
export function overLimit(key: string, max: number, windowMs: number, now = Date.now()): number {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000));
  }
  recent.push(now);
  hits.set(key, recent);
  // Keep the map from growing without bound: drop keys with nothing recent, now and then.
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < 3600_000)) hits.delete(k);
  return 0;
}

/** The caller's address as the host's proxy reports it (Railway sets x-real-ip). */
export function clientIp(request: Request) {
  return request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** A 429 if `key` is over its limit, else null. */
export function rateLimit(key: string, max: number, windowMs: number): Response | null {
  const wait = overLimit(key, max, windowMs);
  return wait ? Response.json({ error: `Too many requests. Try again in ${wait < 90 ? `${wait} seconds` : `${Math.ceil(wait / 60)} minutes`}.` }, { status: 429, headers: { "retry-after": String(wait) } }) : null;
}
