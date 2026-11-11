import test from "node:test";
import assert from "node:assert/strict";
import { challengeQuality, MAX_CHALLENGERS } from "../src/lib/swarm/round";
import { banner, phaseOf, timeline } from "../src/lib/live/timeline";
import { forViewer } from "../src/lib/live/visibility";
import type { LiveRound } from "../src/lib/live/store";

const at = (s: number) => new Date(Date.UTC(2026, 10, 11, 12, 0, s)).toISOString();
const round = (over: Partial<LiveRound> = {}): LiveRound => ({
  id: "r1", createdAt: at(0), status: "done", eligible: ["a", "b"], bids: [{ agent: "a", ask: 0.01, value: 1 }, { agent: "b", ask: 0.02, value: 0.5 }], txs: [], winner: "a",
  job: { id: "j", poster: "alice.testnet", description: "Who controls x.near?", skills: ["due-diligence"], budget: 0.3, challenge: true },
  deliverable: "x.near has 2 keys", paidWith: "escrow",
  steps: [{ at: at(0), text: "posted" }, { at: at(5), text: "Reviewer approved the job" }, { at: at(60), text: "Work passed review" }],
  ...over,
});

test("an upheld challenge raises the challenger's reputation, a rejected one costs a little, an unruled one changes nothing", () => {
  assert.ok(challengeQuality(0.5, true) > 0.5);
  assert.ok(challengeQuality(0.5, false) < 0.5);
  assert.ok(0.5 - challengeQuality(0.5, false) < challengeQuality(0.5, true) - 0.5); // a wrong challenge costs less than a right one earns
  assert.equal(challengeQuality(0.5, null), 0.5);
  assert.ok(MAX_CHALLENGERS >= 1);
});

test("a pass overturned on challenge reads as refunded, and the timeline shows the second check as failed", () => {
  const r = round({
    grade: { passed: false, reasons: ["Overturned on challenge by B: the evidence shows 0 keys."] }, overturned: true,
    challenges: [{ agent: "b", claim: "The report says '2 keys'. The evidence says '0'.", upheld: true, reason: "the evidence shows 0 keys", at: at(90) }],
    steps: [...round().steps, { at: at(95), text: "Second check: the pass was overturned on B's challenge. Nothing is paid; the poster is refunded in full." }],
  });
  const v = forViewer(r, "alice.testnet");
  assert.equal(phaseOf(v), "refunded");
  assert.match(banner(v, []).title, /lost a challenge/);
  const step = timeline(v, []).find((s) => s.label === "Second check");
  assert.equal(step?.state, "failed");
  assert.equal(step?.detail?.startsWith("Pass overturned"), true);
});

test("a pass that survives the second check stays passed, with the step done", () => {
  const r = round({ grade: { passed: true, reasons: ["ok"] }, challenges: [], steps: [...round().steps, { at: at(80), text: "Second check: no agent challenged the report. The pass stands." }] });
  const step = timeline(forViewer(r, "alice.testnet"), []).find((s) => s.label === "Second check");
  assert.equal(step?.state, "done");
  assert.equal(phaseOf(forViewer(r, null)), "passed");
});

test("rounds without the second check have no such step", () => {
  assert.equal(timeline(forViewer(round({ grade: { passed: true, reasons: [] } }), null), []).some((s) => s.label === "Second check"), false);
});

test("a challenge quotes the private report, so only the poster reads its text; the ruling stays public", () => {
  const r = round({ grade: { passed: true, reasons: ["ok"] }, challenges: [{ agent: "b", claim: "The report says '2 keys'.", upheld: false, reason: "the evidence shows 2 keys", at: at(90) }] });
  assert.equal(forViewer(r, "alice.testnet").challenges![0].claim, "The report says '2 keys'.");
  const pub = forViewer(r, null).challenges![0];
  assert.equal(pub.claim, "");
  assert.equal(pub.reason, "the evidence shows 2 keys");
  assert.equal(pub.upheld, false);
});
