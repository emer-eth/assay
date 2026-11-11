import assert from "node:assert/strict";
import { test } from "node:test";
import { swarmSnapshot } from "../src/lib/live/swarm-snapshot";

const agents = [
  { id: "a.testnet", name: "Alpha", quality: 0.8, skillQuality: { "tx-forensics": 0.9 } },
  { id: "b.testnet", name: "Beta", quality: 0.5 },
];
const job = { id: "j", poster: "p", description: "Why did tx X fail?", skills: ["tx-forensics" as const], budget: 0.3 };
const done = { id: "r1", status: "done" as const, job, eligible: ["a.testnet", "b.testnet"], bids: [{ agent: "b.testnet", ask: 0.1, value: 1.25 }, { agent: "a.testnet", ask: 0.2, value: 3.645 }], winner: "a.testnet", grade: { passed: true, reasons: [] }, payout: { toAgent: 0.196, toBacker: 0.1, fee: 0.004, refundToPoster: 0.1, aiCost: 0.01 } };

test("shows the latest revealed round, best value first, with the winner and reputation recovered from the bid", () => {
  const s = swarmSnapshot([done], agents);
  assert.equal(s.round?.phase, "passed");
  assert.equal(s.sealed, false);
  assert.deepEqual(s.bids.map((b) => b.agent), ["Alpha", "Beta"]);
  assert.equal(s.bids[0].winner, true);
  assert.equal(s.bids[0].reputation.toFixed(2), "0.90");
  assert.equal(s.round?.paid, 0.196);
});

test("a round agents are bidding on comes first, sealed, with each agent's reputation in the job's skill", () => {
  const live = { ...done, id: "r2", status: "bidding" as const, bids: [], winner: undefined, grade: undefined, payout: undefined };
  const s = swarmSnapshot([live, done], agents);
  assert.equal(s.round?.id, "r2");
  assert.equal(s.round?.live, true);
  assert.equal(s.sealed, true);
  assert.deepEqual(s.bids.map((b) => [b.agent, b.reputation, b.ask]), [["Alpha", 0.9, undefined], ["Beta", 0.5, undefined]]);
});

test("rounds still in review are skipped, and no rounds at all still counts the agents", () => {
  const reviewing = { ...done, id: "r3", status: "reviewing" as const, bids: [] };
  assert.equal(swarmSnapshot([reviewing, done], agents).round?.id, "r1");
  assert.deepEqual(swarmSnapshot([], agents), { agents: 2, round: null, bids: [], sealed: false });
});
