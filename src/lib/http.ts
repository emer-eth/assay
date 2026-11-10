import "server-only";
import { gzipSync } from "node:zlib";

/**
 * A JSON response, gzipped when the client accepts it. Next compresses pages but not route-handler bodies,
 * and the market snapshot is ~90 KB of repetitive JSON. Optional ETag: a matching If-None-Match gets a 304.
 */
export function jsonResponse(request: Request, body: string, opts: { etag?: string; status?: number; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "cache-control": "no-store", vary: "accept-encoding", ...opts.headers };
  if (opts.etag) {
    headers.etag = opts.etag;
    if (request.headers.get("if-none-match") === opts.etag) return new Response(null, { status: 304, headers });
  }
  if (body.length > 1024 && /\bgzip\b/.test(request.headers.get("accept-encoding") ?? "")) {
    return new Response(gzipSync(body), { status: opts.status ?? 200, headers: { ...headers, "content-encoding": "gzip" } });
  }
  return new Response(body, { status: opts.status ?? 200, headers });
}
