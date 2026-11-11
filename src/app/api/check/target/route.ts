import { z } from "zod";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { detectCheck } from "@/lib/live/detect";
import { targetProblem } from "@/lib/live/tools";
import { policyCheck } from "@/lib/swarm/policy";
import { PAUSED_NOTE, PAUSED_SKILLS, SKILLS } from "@/lib/swarm/types";

// Before anyone pays: does the named target exist? The composer asks while the poster types (debounced),
// with the same check the server runs again when the job is posted (actions.ts).
const query = z.object({ q: z.string().min(3).max(4000), skill: z.enum(SKILLS).optional() });

export async function POST(request: Request) {
  // Open to anyone and each call reads the chain: 40 a minute is plenty for someone typing.
  const limited = rateLimit(`target:${clientIp(request)}`, 40, 60_000);
  if (limited) return limited;
  const parsed = query.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, problem: "Say what to check." }, { status: 400 });
  // The job policy, before anyone pays: a job the reviewer would refuse (a signed intent, a key) never gets paid for.
  const policy = policyCheck(parsed.data.q);
  if (!policy.allowed) return Response.json({ ok: false, problem: `This can't be posted. ${policy.reasons.join(". ")}.` });
  const skill = parsed.data.skill ?? detectCheck(parsed.data.q)?.skill;
  if (!skill) return Response.json({ ok: false, problem: "Name an account, a DAO proposal or a transaction hash." });
  if (PAUSED_SKILLS.includes(skill)) return Response.json({ ok: false, skill, problem: PAUSED_NOTE });
  const problem = await targetProblem({ description: parsed.data.q, skills: [skill] }).catch(() => null);
  return Response.json({ ok: !problem, skill, problem }, { headers: { "cache-control": "no-store" } });
}
