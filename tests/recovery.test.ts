import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A redeploy mid-round: the next process closes the stuck round and refunds it exactly once.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "sfh-recover-"));

test("a round cut off by a restart is closed and refunded once", async () => {
  const { update, load } = await import("../src/lib/live/store");
  const { creditOf } = await import("../src/lib/live/credit");
  const before = creditOf("carol.testnet");
  update((s) => {
    s.rounds.unshift({
      id: "stuck001",
      createdAt: new Date(Date.now() - 60_000).toISOString(), // posted before this process started
      job: { id: "job-stuck001", description: "Check escrow.example.testnet", skills: ["due-diligence"], budget: 0.2, poster: "carol.testnet" },
      status: "working",
      paidWith: "credit",
      steps: [],
      bids: [],
      txs: [],
    } as never);
  });
  const { recoverInterrupted } = await import("../src/lib/live/coordinator");
  recoverInterrupted();
  recoverInterrupted(); // a second call (another page load) must not refund again
  await new Promise((r) => setTimeout(r, 50));
  const r = load().rounds.find((x) => x.id === "stuck001")!;
  assert.equal(r.status, "error");
  assert.equal(Math.round((creditOf("carol.testnet") - before) * 1e6) / 1e6, 0.2);
});
