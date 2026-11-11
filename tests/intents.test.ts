import test from "node:test";
import assert from "node:assert/strict";
import { decodeSignedIntents, describeIntent, intentEvidence, tokenContract } from "../src/lib/live/intents";

// The signed payloads inside two real failed execute_intents calls on mainnet (6Dhuhc… and 5Z3yj…).
const nep413 = (message: object) => ({ standard: "nep413", public_key: "ed25519:x", signature: "ed25519:y", payload: { message: JSON.stringify(message), nonce: "n", recipient: "intents.near" } });
const SELF = "5cdaee04aeec7abf076fd197411ffab6b08cf7aaefba14b57f6fc5fbececc3c8";
const selfTransfer = { signed: [nep413({ deadline: "2026-11-07T09:08:42.827563Z", signer_id: SELF, intents: [{ intent: "transfer", receiver_id: SELF, tokens: { "nep141:wrap.near": "1141510000000000000000000000" } }] })] };
const zeroUsdc = { signed: [nep413({ deadline: "2026-11-10T14:41:12Z", signer_id: "escrow.ai.near", intents: [{ intent: "transfer", receiver_id: "af32c76c" + "0".repeat(56), tokens: { "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1": "0" } }] })] };
const amount = async (id: string, raw: string) => `${raw} of ${tokenContract(id).label}`;

test("decodes a NEP-413 signed intent: signer, deadline, recipient, intents", () => {
  const [s] = decodeSignedIntents(selfTransfer);
  assert.equal(s.signer, SELF);
  assert.equal(s.deadline, "2026-11-07T09:08:42.827563Z");
  assert.equal(s.recipient, "intents.near");
  assert.equal(s.intents[0].intent, "transfer");
  assert.deepEqual(decodeSignedIntents({ not: "intents" }), []);
});

test("flags a transfer to oneself, a zero amount, and a new key; reads token ids", async () => {
  const [a] = decodeSignedIntents(selfTransfer);
  assert.match((await describeIntent(a.intents[0], a.signer, amount)).flags.join(), /signer's own account/);
  const [b] = decodeSignedIntents(zeroUsdc);
  assert.match((await describeIntent(b.intents[0], b.signer, amount)).flags.join(), /zero amount/);
  const key = await describeIntent({ intent: "add_public_key", public_key: "ed25519:abc" }, "alice.near", amount);
  assert.match(key.flags.join(), /ADDS A KEY/);
  assert.deepEqual(tokenContract("nep141:wrap.near"), { contract: "wrap.near", label: "wrap.near" });
  assert.equal(tokenContract("nep245:v2_1.omni.hot.tg:56_x").contract, null);
});

test("a swap reads as what it gives and what it wants", async () => {
  const d = await describeIntent({ intent: "token_diff", diff: { "nep141:usdc.near": "-100", "nep141:usdt.near": "99" } }, "a.near", amount);
  assert.equal(d.text, "swap (token_diff): gives −100 of usdc.near, wants 99 of usdt.near");
});

test("the deadline is checked against the time the call ran", async () => {
  const valid = (await intentEvidence(selfTransfer, new Date("2026-11-07T09:06:42Z"), amount)).join("\n");
  assert.match(valid, /2 min after the call ran/);
  const late = (await intentEvidence(selfTransfer, new Date("2026-11-07T09:20:00Z"), amount)).join("\n");
  assert.match(late, /EXPIRED 11 min before/);
  assert.match(late, /deadline had passed/);
});

test("a zero-amount flag names the token by its symbol when the metadata is known", async () => {
  const withSymbol = async (_id: string, raw: string) => `${raw} USDC (raw ${raw}, token x)`;
  const [b] = decodeSignedIntents(zeroUsdc);
  assert.match((await describeIntent(b.intents[0], b.signer, withSymbol)).flags.join(), /zero amount of USDC$/);
});
