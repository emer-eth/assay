import { currentAccount } from "@/lib/auth/session";
import { publicState } from "@/lib/live/public-state";

export async function GET() {
  return Response.json(await publicState(await currentAccount()), { headers: { "cache-control": "no-store" } });
}
