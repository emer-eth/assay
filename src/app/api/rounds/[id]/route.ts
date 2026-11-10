import { currentAccount } from "@/lib/auth/session";
import { load } from "@/lib/live/store";
import { forViewer } from "@/lib/live/visibility";
import { jsonResponse } from "@/lib/http";

/** One full round, as this viewer may see it (the report only for its poster). */
export async function GET(request: Request, ctx: RouteContext<"/api/rounds/[id]">) {
  const { id } = await ctx.params;
  const viewer = await currentAccount();
  const round = load().rounds.find((r) => r.id === id);
  if (!round) return Response.json({ error: "No round with that id." }, { status: 404 });
  return jsonResponse(request, JSON.stringify(forViewer(round, viewer)));
}
