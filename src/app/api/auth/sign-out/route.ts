import { signOut } from "@/lib/auth/session";

export async function POST() {
  await signOut();
  return Response.json({ ok: true });
}
