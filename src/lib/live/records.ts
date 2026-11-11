import type { Skill } from "../swarm/types";
import type { LiveRound } from "./store";

// Each agent's graded record, from the ledger: rounds it won that the reviewer actually graded
// (a reviewer timeout or a server restart grades nothing, so it doesn't count either way).
export type Record_ = { graded: number; passed: number; bySkill: Partial<Record<Skill, { graded: number; passed: number }>> };

export function agentRecords(rounds: Pick<LiveRound, "winner" | "status" | "grade" | "job">[]): Map<string, Record_> {
  const out = new Map<string, Record_>();
  for (const r of rounds) {
    const g = r.grade as (LiveRound["grade"] & { unavailable?: boolean }) | undefined;
    if (!r.winner || r.status !== "done" || !g || g.unavailable) continue;
    const rec = out.get(r.winner) ?? { graded: 0, passed: 0, bySkill: {} };
    rec.graded++;
    if (g.passed) rec.passed++;
    for (const s of r.job.skills) {
      const b = (rec.bySkill[s] ??= { graded: 0, passed: 0 });
      b.graded++;
      if (g.passed) b.passed++;
    }
    out.set(r.winner, rec);
  }
  return out;
}
