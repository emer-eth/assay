import { after } from "next/server";
import { z } from "zod";
import { activeRound, createRound, runLiveRound } from "@/lib/live/coordinator";
import { LIMITS, liveGuard } from "@/lib/live/guard";

export const maxDuration = 300;

const input = z.object({
  description: z.string().trim().min(10).max(2000),
  skills: z.array(z.enum(["writing", "research", "code", "data", "design", "translation"])).min(1),
  budget: z.coerce.number().min(0.05).max(LIMITS.maxBudget),
});

/** Posts a job and runs its round in the background; the page follows progress through /api/live/state. */
export async function POST(request: Request) {
  const blocked = liveGuard(request);
  if (blocked) return blocked;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Describe the job (10+ characters), pick at least one skill, and set a budget of 0.05–5 NEAR." }, { status: 400 });
  if (activeRound()) return Response.json({ error: "A round is already running. Wait for it to finish." }, { status: 409 });
  const round = createRound(parsed.data);
  after(() => runLiveRound(round.id));
  return Response.json({ id: round.id }, { status: 202 });
}
