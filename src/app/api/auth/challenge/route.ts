import { newChallenge } from "@/lib/auth/session";

/** A one-time message for the wallet to sign (NEP-413). */
export async function GET() {
  return Response.json(newChallenge(), { headers: { "cache-control": "no-store" } });
}
