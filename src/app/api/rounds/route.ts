import { connection } from "next/server";
import { load } from "@/lib/live/store";
import { pageRows } from "@/lib/live/rows";
import { jsonResponse } from "@/lib/http";

/** Slim ledger rows, newest first: GET /api/rounds?cursor=<last id you have>&limit=50 */
export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 50));
  const s = load();
  return jsonResponse(request, JSON.stringify(pageRows(s.rounds, s.agents, url.searchParams.get("cursor"), limit)));
}
