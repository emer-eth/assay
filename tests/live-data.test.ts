import test from "node:test";
import assert from "node:assert/strict";
import { publishChanges, subscribe, type MarketEvent } from "../src/lib/live/bus";
import { pageRows, toRow } from "../src/lib/live/rows";
import type { LiveAgent, LiveRound } from "../src/lib/live/store";

const round = (id: string, over: Partial<LiveRound> = {}): LiveRound => ({
  id, createdAt: id, status: "done", steps: [], eligible: [], bids: [], txs: [{ label: "x", hash: "h" }],
  job: { id: "j", poster: "alice.testnet", description: "d", skills: ["due-diligence"], budget: 0.3 }, ...over,
});
const agent = (id: string, quality = 0.5) => ({ id, name: id.toUpperCase(), quality }) as unknown as LiveAgent;

test("every ledger row balances: budget = paid + fee + refunded once settled", () => {
  const settled = toRow(round("a", { winner: "w", grade: { passed: true, reasons: [] }, payout: { toAgent: 0.0098, toBacker: 0, fee: 0.0002, refundToPoster: 0.29, aiCost: 0 } }), [agent("w")]);
  assert.equal(Math.round((settled.paid + settled.fee + settled.refunded) * 1e4) / 1e4, settled.budget);
  assert.equal(settled.winner, "W");
  assert.equal(settled.passed, true);
  const running = toRow(round("b", { status: "working" }), []);
  assert.deepEqual([running.paid, running.fee, running.refunded, running.passed], [0, 0, 0, null]); // all still in escrow
});

test("ledger pages run newest first and the cursor continues after the last id", () => {
  const rounds = ["r5", "r4", "r3", "r2", "r1"].map((id) => round(id));
  const p1 = pageRows(rounds, [], null, 2);
  assert.deepEqual(p1.rows.map((r) => r.id), ["r5", "r4"]);
  const p2 = pageRows(rounds, [], p1.next, 2);
  assert.deepEqual(p2.rows.map((r) => r.id), ["r3", "r2"]);
  const p3 = pageRows(rounds, [], p2.next, 2);
  assert.deepEqual([p3.rows.map((r) => r.id), p3.next], [["r1"], null]);
  assert.deepEqual(pageRows(rounds, [], "gone", 2).rows, []); // an unknown cursor returns nothing, not page one again
});

test("the bus emits only what changed: a new round, a moved round, a changed agent", () => {
  const events: MarketEvent[] = [];
  const off = subscribe((e) => events.push(e));
  const a = round("a"), b = round("b", { status: "bidding" });
  publishChanges({ rounds: [a], agents: [agent("x")] }); // first save: the baseline, nothing emitted
  assert.equal(events.length, 0);
  publishChanges({ rounds: [b, a], agents: [agent("x")] });
  assert.deepEqual(events.map((e) => e.type), ["round.created"]);
  publishChanges({ rounds: [{ ...b, status: "working", steps: [{ at: "", text: "won" }] }, a], agents: [agent("x", 0.6)] });
  assert.deepEqual(events.slice(1).map((e) => e.type), ["round.updated", "agent.updated"]);
  publishChanges({ rounds: [{ ...b, status: "working", steps: [{ at: "", text: "won" }] }, a], agents: [agent("x", 0.6)] });
  assert.equal(events.length, 3); // a save that changes nothing (credit, a session) emits nothing
  off();
});

test("an agent's record counts only graded rounds it won, per skill", async () => {
  const { agentRecords } = await import("../src/lib/live/records");
  const won = (skill: "contract-review" | "tx-forensics", passed: boolean, extra: object = {}) =>
    ({ winner: "rex", status: "done" as const, grade: { passed, reasons: [], ...extra }, job: { id: "j", poster: "p", description: "d", skills: [skill], budget: 0.3 } });
  const rec = agentRecords([won("tx-forensics", true), won("contract-review", false), won("contract-review", false, { unavailable: true }), { ...won("tx-forensics", true), winner: "cora" }])
    .get("rex")!;
  assert.deepEqual([rec.graded, rec.passed], [2, 1]); // the reviewer timeout doesn't count
  assert.deepEqual(rec.bySkill["contract-review"], { graded: 1, passed: 0 });
});
