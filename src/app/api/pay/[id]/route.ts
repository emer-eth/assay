import { rememberPayment } from "@/lib/auth/session";
import { checkPayIn, paymentView } from "@/lib/live/intents-pay";

// The payer's page asks this every few seconds: has 1Click delivered, and which round did it become?
// Knowing the id is what makes someone the payer, so this also remembers it in their browser (session.ts).
export async function GET(_request: Request, ctx: RouteContext<"/api/pay/[id]">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json({ error: "No such payment." }, { status: 404 });
  const p = await checkPayIn(id);
  if (!p) return Response.json({ error: "No such payment." }, { status: 404 });
  await rememberPayment(id);
  return Response.json(paymentView(p), { headers: { "cache-control": "no-store" } });
}
