import { z } from "zod";
import { currentAccount } from "@/lib/auth/session";
import { createApiKey, listApiKeys, revokeApiKey } from "@/lib/live/credit";

// API keys for MCP clients and scripts. A key acts as your account but can only spend your prepaid credit.

export async function GET() {
  const account = await currentAccount();
  if (!account) return Response.json({ error: "Connect your wallet." }, { status: 401 });
  return Response.json({ keys: listApiKeys(account) });
}

export async function POST(request: Request) {
  const account = await currentAccount();
  if (!account) return Response.json({ error: "Connect your wallet to create a key." }, { status: 401 });
  const parsed = z.object({ label: z.string().trim().max(60).default("") }).safeParse(await request.json().catch(() => ({})));
  if (listApiKeys(account).length >= 5) return Response.json({ error: "You already have 5 keys. Revoke one first." }, { status: 409 });
  const { key, entry } = createApiKey(account, parsed.success ? parsed.data.label : "");
  return Response.json({ key, id: entry.id, prefix: entry.prefix, label: entry.label }, { status: 201 });
}

export async function DELETE(request: Request) {
  const account = await currentAccount();
  if (!account) return Response.json({ error: "Connect your wallet." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") || "";
  return revokeApiKey(account, id) ? Response.json({ ok: true }) : Response.json({ error: "No such key." }, { status: 404 });
}
