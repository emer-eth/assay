import { createHash } from "node:crypto";
import { currentAccount } from "@/lib/auth/session";
import { jsonResponse } from "@/lib/http";
import { publicState } from "@/lib/live/public-state";

// The full snapshot: the first load, a catch-up after a tab comes back, and the poll fallback when the event
// stream can't connect. An ETag lets that fallback get a 304 instead of the whole state when nothing changed.
export async function GET(request: Request) {
  const body = JSON.stringify(await publicState(await currentAccount()));
  return jsonResponse(request, body, { etag: `"${createHash("sha1").update(body).digest("base64url")}"` });
}
