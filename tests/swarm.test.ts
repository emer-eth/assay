import test from "node:test";
import assert from "node:assert/strict";
import { policyCheck } from "../src/lib/swarm/policy";
import { eligibleAgents, FEE, nextQuality, pickWinner, runRound } from "../src/lib/swarm/round";
import { makeAgents, simulate } from "../src/lib/swarm/sim";
import type { Agent, Job } from "../src/lib/swarm/types";

const agent = (over: Partial<Agent>): Agent => ({
  id: "agent-1.swarm.testnet", backer: "b.testnet", prompt: "", skills: ["due-diligence"], strategy: "steady",
  balance: 1, costPerJob: 0.1, quality: 0.5, skill: 0.9, joinedAt: 0, ...over,
});
const job: Job = { id: "j", poster: "p.testnet", description: "Write a post", skills: ["due-diligence"], budget: 2 };

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
  const list = [agent({ id: "a" }), agent({ id: "b", skills: ["contract-review"] }), agent({ id: "c", balance: 0.05 })];
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

test("reputation is per skill: passing one skill doesn't win jobs in another the agent keeps failing", async () => {
  const { decide, jobQuality } = await import("../src/lib/swarm/round");
  const review: Job = { ...job, skills: ["contract-review"], budget: 0.3 };
  // The live market on 2026-11-10: a cheap agent strong at tx-forensics but 0 for 4 at code review (0.2048),
  // asking 0.01 NEAR, against a stronger agent with no code-review record yet asking 0.12.
  const cheap = agent({ id: "cheap", skills: ["contract-review", "tx-forensics"], quality: 0.58, skillQuality: { "tx-forensics": 0.8, "contract-review": 0.2048 } });
  const strong = agent({ id: "strong", skills: ["contract-review"], quality: 0.5, skillQuality: {}, joinedAt: 1 });
  assert.equal(jobQuality(strong, review), 0.5); // no record yet: starts at the default
  const { winner } = decide(review, [cheap, strong], new Map([["cheap", 0.01], ["strong", 0.12]]));
  assert.equal(winner?.agent, "strong");
  // On its strong skill the cheap agent still wins on price.
  const forensics: Job = { ...review, skills: ["tx-forensics"] };
  const strong2 = { ...strong, skills: ["tx-forensics" as const] };
  assert.equal(decide(forensics, [cheap, strong2], new Map([["cheap", 0.01], ["strong", 0.1]])).winner?.agent, "cheap");
});

test("per-skill reputation rebuilds from the ledger and settles only the job's skills", async () => {
  const { skillQualityFrom, settle } = await import("../src/lib/swarm/round");
  const r = (at: string, skill: "contract-review" | "tx-forensics", passed: boolean, extra: object = {}) =>
    ({ winner: "a", status: "done", createdAt: at, job: { skills: [skill] }, grade: { passed, ...extra } });
  const rounds = [
    r("2026-11-10T03", "contract-review", false), r("2026-11-10T01", "tx-forensics", true),
    r("2026-11-10T02", "contract-review", false, { unavailable: true }), // the reviewer was down: doesn't count
    { ...r("2026-11-10T04", "tx-forensics", true), winner: "someone-else" },
  ];
  const q = skillQualityFrom(rounds, "a", ["contract-review", "tx-forensics"]);
  assert.deepEqual(q, { "tx-forensics": 0.6, "contract-review": 0.4 });
  const s = settle({ ...job, skills: ["contract-review"] }, agent({ skillQuality: q }), 0.1, { passed: true, aiCost: 0 });
  assert.equal(s.skillQuality?.["tx-forensics"], q["tx-forensics"]);
  assert.equal(s.skillQuality?.["contract-review"], Math.round(nextQuality(q["contract-review"]!, true) * 1e4) / 1e4);
});

test("policy refuses jobs carrying a signed intent or a private key, but not hashes or public keys", () => {
  const signed = `Check this: {"standard":"nep413","payload":{"message":"{}"},"public_key":"ed25519:5TagutioHgKLh7KZ1VEFBYfgRkPtqnKm9LoMnJMJugxm","signature":"ed25519:3t9h"}`;
  assert.equal(policyCheck(signed).allowed, false);
  assert.match(policyCheck(signed).reasons.join(), /signed intent/);
  const key = "my key is ed25519:" + "3".repeat(88);
  assert.match(policyCheck(key).reasons.join(), /private key/);
  // ordinary jobs with a tx hash or a public key stay allowed
  assert.equal(policyCheck("Why did transaction 6DhuhcBjTPqFPBRCaZKY3EUz9bjvyPdtXajqQWrGACjg fail?").allowed, true);
  assert.equal(policyCheck("Who added ed25519:5TagutioHgKLh7KZ1VEFBYfgRkPtqnKm9LoMnJMJugxm to alice.near?").allowed, true);
});
