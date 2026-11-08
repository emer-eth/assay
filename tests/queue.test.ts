import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Rounds run one at a time, in the order they were posted, and a restart can't leave one stuck.
// No AI key is set here, so the reviewer fails closed and each round ends "blocked" without touching a chain.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "sfh-queue-"));
delete process.env.NEAR_AI_API_KEY;

test("posted rounds queue and run in order", async () => {
  const { createRound, enqueueRound } = await import("../src/lib/live/coordinator");
  const { load } = await import("../src/lib/live/store");
  const job = { description: "Check escrow.example.testnet: who can move the funds?", skills: ["due-diligence" as const], budget: 0.1 };
  const a = createRound(job, "alice.testnet", { via: "credit" }).id;
  const b = createRound(job, "bob.testnet", { via: "credit" }).id;
  assert.equal(load().rounds.find((r) => r.id === b)?.status, "queued");
  enqueueRound(a);
  await enqueueRound(b);
  const ra = load().rounds.find((r) => r.id === a)!, rb = load().rounds.find((r) => r.id === b)!;
  assert.equal(ra.status, "blocked");
  assert.equal(rb.status, "blocked");
  assert.ok(rb.steps.some((s) => s.text.startsWith("Queued behind 1 round")), "the second round says it's queued");
  const aEnded = Date.parse(ra.steps.at(-1)!.at), bStarted = Date.parse(rb.steps.find((s) => s.text.startsWith("Blocked"))!.at);
  assert.ok(bStarted >= aEnded, "the second round only runs after the first has finished");
});
