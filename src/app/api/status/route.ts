import { connection } from "next/server";
import { health } from "@/lib/live/health";

/** The status page's checks as JSON (cached five minutes). */
export async function GET() {
  await connection();
  return Response.json(await health(), { headers: { "cache-control": "no-store" } });
}
