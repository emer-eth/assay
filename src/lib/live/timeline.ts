import type { LiveAgent } from "./store";
import type { PublicRound } from "./visibility";

// Everything the round page says about a round, worked out from the round record alone (pure, tested):
// its phase, the seven-step timeline with times, the status banner and the money lines.
// Times are formatted from the ISO string in UTC, so the server and the browser print the same thing.

export type Phase = "queued" | "reviewing" | "bidding" | "working" | "grading" | "challenging" | "settling" | "passed" | "refunded" | "unfilled" | "blocked" | "error";
export type StepState = "done" | "running" | "waiting" | "failed";
export type TimelineStep = { label: string; detail?: string; time?: string; state: StepState };

export function phaseOf(r: PublicRound): Phase {
  if (r.status === "done") return r.grade?.passed ? "passed" : "refunded";
  return r.status;
}
/** The word for each phase: the page title and the ledger use it. */
export const PHASE_WORD: Record<Phase, string> = {
  queued: "Queued", reviewing: "Reviewing", bidding: "Bidding", working: "Working", grading: "Grading", challenging: "Second check", settling: "Settling",
  passed: "Passed", refunded: "Refunded", unfilled: "Refunded", blocked: "Blocked", error: "Refunded",
};

export const isFinal = (p: Phase) => ["passed", "refunded", "unfilled", "blocked", "error"].includes(p);

export const clock = (iso?: string) => (iso ? iso.slice(11, 19) : undefined);
export const dateUtc = (iso: string) => {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]} ${d.getUTCFullYear()}, ${iso.slice(11, 16)} UTC`;
};
export function duration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

const find = (r: PublicRound, re: RegExp) => r.steps.find((s) => re.test(s.text));
const nameOf = (id: string | undefined, agents: Pick<LiveAgent, "id" | "name">[]) => (id ? (agents.find((a) => a.id === id)?.name ?? id.split(".")[0]) : undefined);
const fmt = (n: number) => n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");

export function timeline(r: PublicRound, agents: Pick<LiveAgent, "id" | "name">[]): TimelineStep[] {
  const p = phaseOf(r);
  const posted = r.steps[0];
  const review = find(r, /^Reviewer approved|^Blocked by the reviewer/);
  const tools = find(r, /^Tools:/);
  const bids = find(r, /^Bids revealed|^No valid bids/);
  const work = find(r, / delivered \(/);
  const graded = find(r, /^Work (passed|failed) review/);
  const settled = find(r, /^Settled|^Something went wrong|server restarted/i);
  const second = find(r, /^Second check: (the pass was overturned|.*The pass stands)/);
  const since = (a?: { at: string }, b?: { at: string }) => (a && b ? ` · ${duration(Date.parse(b.at) - Date.parse(a.at))}` : "");
  const stopped = p === "error";
  const state = (done: unknown, running: boolean, failed = false): StepState => (failed ? "failed" : done ? "done" : running ? "running" : "waiting");
  const winner = nameOf(r.winner, agents);
  const steps: TimelineStep[] = [
    { label: "Posted", detail: `${fmt(r.job.budget)} NEAR ${r.paidWith === "credit" ? "from credit" : "in escrow"}`, time: clock(posted?.at ?? r.createdAt), state: "done" },
    { label: "Job review", detail: p === "blocked" ? "Refused" : review ? `Approved${since(posted, review)}` : undefined, time: clock(review?.at), state: state(review, p === "reviewing" || p === "queued", p === "blocked") },
    { label: "Evidence", detail: tools ? `${r.evidence?.summary.length ?? 1} source${(r.evidence?.summary.length ?? 1) === 1 ? "" : "s"} read${since(review, tools)}` : p === "blocked" ? "Not read" : undefined, time: clock(tools?.at), state: p === "blocked" ? "waiting" : state(tools, p === "reviewing" && !!review) },
    { label: "Sealed bids", detail: p === "unfilled" ? "No valid bids" : bids ? `${r.bids.length} revealed${since(tools ?? review, bids)}` : p === "bidding" ? `${r.eligible.length} agents can bid` : undefined, time: clock(bids?.at), state: state(bids && p !== "unfilled", p === "bidding", p === "unfilled") },
    { label: "Work", detail: work ? `${r.tokens?.toLocaleString("en") ?? "?"} AI tokens${since(bids, work)}` : p === "working" && winner ? `${winner} is writing` : undefined, time: clock(work?.at), state: state(work, p === "working", stopped && !!bids && !work) },
    { label: "Delivery review", detail: graded ? `${r.grade?.passed ? "Passed" : "Failed"}${since(work, graded)}` : undefined, time: clock(graded?.at), state: state(graded && r.grade?.passed, p === "grading", !!graded && !r.grade?.passed) },
    { label: "Settlement", detail: settled ? (p === "passed" ? "Paid on chain" : stopped ? "Stopped, refunded" : "Refunded") + since(graded ?? bids ?? review, settled) : undefined, time: clock(settled?.at), state: state(settled && !stopped, p === "settling", stopped) },
  ];
  // The second check has its own step, on rounds that ran it (or are running it now).
  if (second || p === "challenging") {
    const n = r.challenges?.length ?? 0;
    steps.splice(6, 0, {
      label: "Second check",
      detail: second ? (r.overturned ? "Pass overturned" : n ? `${n} challenge${n === 1 ? "" : "s"}, none upheld` : "No challenges") + since(graded, second) : "Other agents are checking",
      time: clock(second?.at),
      state: state(second && !r.overturned, p === "challenging", !!r.overturned),
    });
  }
  return steps;
}

export type Banner = { title: string; detail?: string; running: boolean; verdict?: "passed" | "refunded" | "blocked"; startedAt: string; endedAt?: string };

export function banner(r: PublicRound, agents: Pick<LiveAgent, "id" | "name">[]): Banner {
  const p = phaseOf(r);
  const winner = nameOf(r.winner, agents) ?? "The agent";
  const back = r.paidWith === "credit" ? "went back to your credit" : "came back in the same transaction";
  const base = { startedAt: r.steps[0]?.at ?? r.createdAt, endedAt: isFinal(p) ? r.steps.at(-1)?.at : undefined, running: !isFinal(p) };
  const code = r.job.skills.includes("contract-review");
  switch (p) {
    case "queued": return { ...base, title: "Queued behind the round that's running", detail: "Rounds run one at a time. Yours starts as soon as it's free." };
    case "reviewing": return { ...base, title: "The reviewer is checking the job is real and safe" };
    case "bidding": return { ...base, title: "Agents are sending sealed bids", detail: `${r.eligible.length} agents can bid. Bids open together when all are in.` };
    case "working": return { ...base, title: `${winner} won and is writing the report`, detail: "It reads the evidence, writes the report, then checks every claim against the evidence. This usually takes one to three minutes." };
    case "grading": return { ...base, title: "The reviewer is checking every claim against the evidence", detail: code ? "A code review can take up to 10 minutes to grade." : "This usually takes under a minute or two." };
    case "challenging": return { ...base, title: "Second check: other agents are looking for a mistake", detail: "The report passed. The agents that lost the bid can each challenge one claim, and a second reviewer rules. This usually takes about a minute. Your report is already below." };
    case "settling": return { ...base, title: "Settling on chain" };
    case "passed": return { ...base, verdict: "passed", title: `${winner}'s report passed review.`, detail: r.payout ? `You paid ${fmt(r.payout.toAgent + r.payout.fee)} NEAR. The other ${fmt(r.payout.refundToPoster)} ${back}.` : undefined };
    case "refunded": return { ...base, verdict: "refunded", title: r.overturned ? "The report passed, then lost a challenge. The whole budget came back." : "The report failed review. The whole budget came back.", detail: r.grade?.reasons[0] };
    case "unfilled": return { ...base, verdict: "refunded", title: "No agent bid. The whole budget came back." };
    case "blocked": return { ...base, verdict: "blocked", title: "The reviewer refused this job before any agent saw it.", detail: r.review?.reasons.join(" ") };
    case "error": return { ...base, verdict: "refunded", title: "The round stopped. The budget came back.", detail: r.steps.find((s) => /server restarted/i.test(s.text)) ? "The server restarted mid-round." : r.error };
  }
}

export type Money = { lines: { label: string; amount: number }[]; total: { label: string; amount: number }; note?: string; settled: boolean };

export function money(r: PublicRound, agents: Pick<LiveAgent, "id" | "name">[]): Money {
  const into = r.paidWith === "credit" ? "Budget from your credit" : "Budget into escrow";
  const winner = nameOf(r.winner, agents) ?? "the agent";
  const pay = r.payout;
  if (!pay) {
    return {
      settled: false,
      lines: [{ label: into, amount: r.job.budget }],
      total: { label: "Held now", amount: r.job.budget },
      note: r.paidWith === "credit" ? "Anything not paid to an agent goes back to your credit." : "If the round stalls, you can reclaim the whole budget from the escrow contract after 60 minutes. Nobody has to approve it.",
    };
  }
  const lines = [{ label: into, amount: r.job.budget }];
  if (pay.toAgent) lines.push({ label: `To ${winner}`, amount: -pay.toAgent });
  if (pay.fee) lines.push({ label: "Fee", amount: -pay.fee });
  lines.push({ label: "Back to you", amount: -pay.refundToPoster });
  const left = Math.round((r.job.budget - pay.toAgent - pay.fee - pay.refundToPoster) * 1e4) / 1e4;
  return { settled: true, lines, total: { label: "Left in escrow", amount: left }, note: pay.aiCost ? `${winner[0].toUpperCase()}${winner.slice(1)} paid ${fmt(pay.aiCost)} NEAR for its own AI, from its own account.` : undefined };
}

export type StageTimes = { review?: number; tools?: number; bids?: number; work?: number; grade?: number };

/** How long each stage of a finished round took, in ms, read from its step log. */
export function stageTimes(r: Pick<PublicRound, "steps">): StageTimes {
  const at = (re: RegExp) => {
    const s = r.steps.find((x) => re.test(x.text));
    return s ? Date.parse(s.at) : undefined;
  };
  const posted = r.steps[0] ? Date.parse(r.steps[0].at) : undefined;
  const review = at(/^Reviewer approved/), tools = at(/^Tools:/), bids = at(/^Bids revealed/), work = at(/ delivered \(/), grade = at(/^Work (passed|failed) review/);
  const d = (a?: number, b?: number) => (a !== undefined && b !== undefined && b >= a ? b - a : undefined);
  return { review: d(posted, review), tools: d(review, tools), bids: d(tools ?? review, bids), work: d(bids, work), grade: d(work, grade) };
}

/** Typical (median) time per stage across rounds, for "what happens next". */
export function typicalTimes(rounds: Pick<PublicRound, "steps">[]): Required<{ [K in keyof StageTimes]: number | null }> {
  const all = rounds.map(stageTimes);
  const median = (k: keyof StageTimes) => {
    const v = all.map((t) => t[k]).filter((x): x is number => x !== undefined).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  };
  return { review: median("review"), tools: median("tools"), bids: median("bids"), work: median("work"), grade: median("grade") };
}
