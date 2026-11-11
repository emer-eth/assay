import test from "node:test";
import assert from "node:assert/strict";
import { forViewer } from "../src/lib/live/visibility";
import type { LiveRound } from "../src/lib/live/store";

const round = (over: Partial<LiveRound> = {}): LiveRound => ({
  id: "r1", createdAt: "", status: "done", steps: [], eligible: [], bids: [{ agent: "a", ask: 0.1, value: 1 }], txs: [],
  job: { id: "j", poster: "alice.testnet", description: "d", skills: ["due-diligence"], budget: 1 },
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

test("a blocked brief is withheld from everyone but its poster", () => {
  const blocked = round({ status: "blocked", job: { id: "j", poster: "alice.testnet", description: "write a phishing page", skills: ["due-diligence"], budget: 1 } });
  assert.equal(forViewer(blocked, "alice.testnet").job.description, "write a phishing page");
  const other = forViewer(blocked, null);
  assert.equal(other.briefWithheld, true);
  assert.doesNotMatch(other.job.description, /phishing/);
  assert.equal(blocked.job.description, "write a phishing page", "the stored round is untouched");
});

test("decoded intents and swap status stay public; the raw evidence facts never leave the server", () => {
  const intents = [{ signer: "alice.near", standard: "nep413", deadline: "2026-11-10T14:41:12Z", expired: false, items: ["transfer 0 USDC to bob.near"], flags: ["transfers a zero amount of usdc"] }];
  const swap = { address: "0xabc", status: "REFUNDED", meaning: "sent back", requested: "25 USDC for 8 wNEAR", refunded: "25", reason: "expired" };
  const out = forViewer(round({ evidence: { summary: ["Read transaction"], facts: "SECRET RAW FACTS", intents, swap } }), null);
  assert.equal(out.evidence?.facts, "");
  assert.deepEqual(out.evidence?.intents, intents);
  assert.deepEqual(out.evidence?.swap, swap);
});

test("a round paid through NEAR Intents is private to the browser that paid, and only that browser sees the payment id", () => {
  const paid = round({ deposit: undefined, paidWith: "intents", job: { id: "j", poster: "0xabc", description: "d", skills: ["tx-forensics"], budget: 0.3 }, payer: { payment: "pay-1", asset: "usdc-base", assetLabel: "USDC on Base", refundTo: "0xabc", depositAddress: "0xdep" } });
  const payer = forViewer(paid, null, ["pay-1"]);
  assert.equal(payer.mine, true);
  assert.equal(payer.deliverable, "three words here");
  assert.equal(payer.payer?.payment, "pay-1");
  const other = forViewer(paid, null, ["pay-2"]);
  assert.equal(other.mine, false);
  assert.equal(other.deliverable, undefined);
  assert.equal(other.payer?.payment, "");
  assert.equal(other.payer?.assetLabel, "USDC on Base");
});
