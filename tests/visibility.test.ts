import test from "node:test";
import assert from "node:assert/strict";
import { forViewer } from "../src/lib/live/visibility";
import type { LiveRound } from "../src/lib/live/store";

const round = (over: Partial<LiveRound> = {}): LiveRound => ({
  id: "r1", createdAt: "", status: "done", steps: [], eligible: [], bids: [{ agent: "a", ask: 0.1, value: 1 }], txs: [],
  job: { id: "j", poster: "alice.testnet", description: "d", skills: ["writing"], budget: 1 },
  deliverable: "three words here", deposit: "TxHash", ...over,
});

test("the poster sees their delivered work; nobody else does", () => {
  assert.equal(forViewer(round(), "alice.testnet").deliverable, "three words here");
  assert.equal(forViewer(round(), "alice.testnet").mine, true);
  const other = forViewer(round(), "bob.testnet");
  assert.equal(other.deliverable, undefined);
  assert.equal(other.private, true);
  assert.equal(other.deliveredWords, 3);
  assert.equal(forViewer(round(), null).deliverable, undefined);
});

test("older demo rounds without a wallet payment stay public", () => {
  assert.equal(forViewer(round({ deposit: undefined }), null).deliverable, "three words here");
});

test("sealed bids stay hidden while bidding", () => {
  assert.deepEqual(forViewer(round({ status: "bidding" }), "alice.testnet").bids, []);
});
