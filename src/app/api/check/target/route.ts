import { z } from "zod";
import { detectCheck } from "@/lib/live/detect";
import { targetProblem } from "@/lib/live/tools";
import { SKILLS } from "@/lib/swarm/types";

// Before anyone pays: does the named target exist? The composer asks while the poster types (debounced),
// with the same check the server runs again when the job is posted (actions.ts).
const query = z.object({ q: z.string().min(3).max(4000), skill: z.enum(SKILLS).optional() });

export async function POST(request: Request) {
  const parsed = query.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, problem: "Say what to check." }, { status: 400 });
  const skill = parsed.data.skill ?? detectCheck(parsed.data.q)?.skill;
  if (!skill) return Response.json({ ok: false, problem: "Name an account, a DAO proposal, a transaction hash or a GitHub repo." });
  const problem = await targetProblem({ description: parsed.data.q, skills: [skill] }).catch(() => null);
  return Response.json({ ok: !problem, skill, problem }, { headers: { "cache-control": "no-store" } });
}
