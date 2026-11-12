import type { Skill } from "../swarm/types";
import type { LiveRound } from "./store";

// Each agent's graded record, from the ledger: rounds it won that the reviewer actually graded
// (a reviewer timeout or a server restart grades nothing, so it doesn't count either way).
export type Record_ = {
  graded: number;
  passed: number;
  bySkill: Partial<Record<Skill, { graded: number; passed: number }>>;
  /** The second check: challenges this agent filed against others' passes, how many were upheld, and how many of its own passes were overturned. */
  challenges?: { filed: number; upheld: number; overturned: number };
};

export function agentRecords(rounds: (Pick<LiveRound, "winner" | "status" | "grade" | "job"> & Partial<Pick<LiveRound, "challenges" | "overturned">>)[]): Map<string, Record_> {
  const out = new Map<string, Record_>();
  const ch = (id: string) => ((out.get(id) ?? out.set(id, { graded: 0, passed: 0, bySkill: {} }).get(id)!).challenges ??= { filed: 0, upheld: 0, overturned: 0 });
  for (const r of rounds) {
    for (const c of r.challenges ?? []) {
      const x = ch(c.agent);
      x.filed++;
      if (c.upheld) x.upheld++;
    }
    if (r.overturned && r.winner) ch(r.winner).overturned++;
  }
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

/** "1 filed, 0 upheld" (and any passes of its own that were overturned), or null if it has no second-check record. */
export function challengeText(r: Record_) {
  const c = r.challenges;
  if (!c || (!c.filed && !c.overturned)) return null;
  return [c.filed ? `${c.filed} challenge${c.filed === 1 ? "" : "s"} filed, ${c.upheld} upheld` : "", c.overturned ? `${c.overturned} of its passes overturned` : ""].filter(Boolean).join(" · ");
}
