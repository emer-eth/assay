import test from "node:test";
import assert from "node:assert/strict";
import { policyCheck } from "../src/lib/swarm/policy";
import { eligibleAgents, FEE, nextQuality, pickWinner, runRound } from "../src/lib/swarm/round";
import { makeAgents, simulate } from "../src/lib/swarm/sim";
import type { Agent, Job } from "../src/lib/swarm/types";

const agent = (over: Partial<Agent>): Agent => ({
  id: "agent-1.swarm.testnet", backer: "b.testnet", prompt: "", skills: ["writing"], strategy: "steady",
  balance: 1, costPerJob: 0.1, quality: 0.5, skill: 0.9, joinedAt: 0, ...over,
});
const job: Job = { id: "j", poster: "p.testnet", description: "Write a post", skills: ["writing"], budget: 2 };

test("policy blocks harmful jobs and allows normal ones", () => {
  assert.equal(policyCheck("Write 50 fake reviews for our app").allowed, false);
  assert.equal(policyCheck("Send mass DMs to 10,000 users").allowed, false);
  assert.equal(policyCheck("Summarise governance proposals").allowed, true);
});

test("blocked job refunds the poster in full and reaches no agent", () => {
  const { result } = runRound(job, [agent({})], { allowed: false, reasons: ["x"], by: "policy" }, () => 1, () => ({ passed: true, aiCost: 0.1 }));
  assert.equal(result.winner, null);
  assert.equal(result.payout.refundToPoster, 2);
  assert.deepEqual(result.bids, []);
});

test("agents need every skill and enough balance to bid", () => {
  const list = [agent({ id: "a" }), agent({ id: "b", skills: ["code"] }), agent({ id: "c", balance: 0.05 })];
  assert.deepEqual(eligibleAgents(job, list).map((a) => a.id), ["a"]);
});

test("best quality per NEAR wins; ties go to the lower ask, then the earlier agent", () => {
  const agents = [agent({ id: "a", joinedAt: 0 }), agent({ id: "b", joinedAt: 1 })];
  assert.equal(pickWinner([{ agent: "a", ask: 1, value: 0.5 }, { agent: "b", ask: 0.5, value: 1 }], agents)?.agent, "b");
  assert.equal(pickWinner([{ agent: "a", ask: 1, value: 1 }, { agent: "b", ask: 0.8, value: 1 }], agents)?.agent, "b");
  assert.equal(pickWinner([{ agent: "b", ask: 1, value: 1 }, { agent: "a", ask: 1, value: 1 }], agents)?.agent, "a");
});

test("a passed delivery pays the ask minus the fee, repays AI cost, refunds the rest", () => {
  const { result, agents } = runRound(job, [agent({})], { allowed: true, reasons: [], by: "policy" }, () => 1, () => ({ passed: true, aiCost: 0.1 }));
  assert.equal(result.payout.fee, 1 * FEE);
  assert.equal(result.payout.toAgent, 0.98);
  assert.equal(result.payout.toBacker, 0.88);
  assert.equal(result.payout.refundToPoster, 1);
  assert.equal(agents[0].balance, 1); // AI cost charged, then repaid
  assert.ok(Math.abs(agents[0].quality - nextQuality(0.5, true)) < 1e-9);
});

test("a failed delivery refunds the poster in full and the agent eats its AI cost", () => {
  const { result, agents } = runRound(job, [agent({})], { allowed: true, reasons: [], by: "policy" }, () => 1, () => ({ passed: false, aiCost: 0.1 }));
  assert.equal(result.payout.toAgent, 0);
  assert.equal(result.payout.refundToPoster, 2);
  assert.equal(agents[0].balance, 0.9);
  assert.ok(agents[0].quality < 0.5);
});

test("money is conserved in every round of the simulation", () => {
  for (const r of simulate(7, 30).results) {
    const paidOut = r.payout.toAgent + r.payout.fee + r.payout.refundToPoster;
    assert.ok(Math.abs(paidOut - r.job.budget) < 1e-3, `${r.job.id}: ${paidOut} vs ${r.job.budget}`);
  }
});

test("the simulation is reproducible from its seed and has 20 agents", () => {
  assert.deepEqual(simulate(42, 20).totals, simulate(42, 20).totals);
  assert.equal(makeAgents(1).length, 20);
  assert.ok(simulate(7, 30).totals.blocked > 0, "bad jobs in the sample get blocked");
});

test("quality counts more than price: a reliable agent beats a cheap unreliable one", async () => {
  const { decide } = await import("../src/lib/swarm/round");
  const agents = [agent({ id: "cheap", quality: 0.3 }), agent({ id: "solid", quality: 0.8, joinedAt: 1 })];
  const { winner } = decide(job, agents, new Map([["cheap", 0.5], ["solid", 1.2]]));
  assert.equal(winner?.agent, "solid"); // 0.64/1.2 = 0.53 beats 0.09/0.5 = 0.18
});
