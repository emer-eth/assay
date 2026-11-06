import { currentAccount } from "@/lib/auth/session";

export async function GET() {
  return Response.json({ accountId: await currentAccount() }, { headers: { "cache-control": "no-store" } });
}
