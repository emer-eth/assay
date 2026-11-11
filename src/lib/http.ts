import "server-only";

/**
 * A JSON response with an optional ETag: a matching If-None-Match gets a 304, so an unchanged snapshot costs nothing.
 * Not compressed here: Railway's proxy passed our gzipped bytes through but dropped the content-encoding header
 * (found on the live site, 11 Nov 2026), which left clients holding bytes they couldn't read. Compression is the
 * platform's job.
 */
export function jsonResponse(request: Request, body: string, opts: { etag?: string; status?: number; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "cache-control": "no-store", ...opts.headers };
  if (opts.etag) {
    headers.etag = opts.etag;
    if (request.headers.get("if-none-match") === opts.etag) return new Response(null, { status: 304, headers });
  }
  return new Response(body, { status: opts.status ?? 200, headers });
}
