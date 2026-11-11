import test from "node:test";
import assert from "node:assert/strict";
import { OFFERED_SKILLS, PAUSED_SKILLS, SKILLS } from "../src/lib/swarm/types";
import { toRow } from "../src/lib/live/rows";
import type { LiveRound } from "../src/lib/live/store";

test("a paused skill isn't offered on the job form, but still exists for agents, old rounds and MCP", () => {
  for (const s of PAUSED_SKILLS) {
    assert.ok(!OFFERED_SKILLS.includes(s));
    assert.ok(SKILLS.includes(s));
  }
  assert.equal(OFFERED_SKILLS.length + PAUSED_SKILLS.length, SKILLS.length);
});

test("a ledger row says how its budget was paid", () => {
  const r = { id: "r", createdAt: "", status: "done", steps: [], eligible: [], bids: [], txs: [], paidWith: "intents", job: { id: "j", poster: "p.testnet", description: "d", skills: ["due-diligence"], budget: 0.3 } } as LiveRound;
  assert.equal(toRow(r, []).paidWith, "intents");
});
