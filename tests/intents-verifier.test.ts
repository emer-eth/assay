import assert from "node:assert/strict";
import { test } from "node:test";
import { KeyPair } from "near-api-js";
import { verifyNep413 } from "../src/lib/auth/nep413";
import { INTENTS_ID, signIntent, WNEAR_TOKEN } from "../src/lib/live/intents-verifier";

test("a signed intent is a NEP-413 message to the verifier that verifies with the signer's key", () => {
  const key = KeyPair.fromRandom("ed25519");
  const s = signIntent("alice.testnet", key, [{ intent: "transfer", receiver_id: "bob.testnet", tokens: { [WNEAR_TOKEN]: "100" }, memo: "m" }]);
  assert.equal(s.standard, "nep413");
  assert.equal(s.payload.recipient, INTENTS_ID);
  assert.equal(INTENTS_ID, "assay-intents.testnet");
  assert.match(s.signature, /^ed25519:[1-9A-HJ-NP-Za-km-z]{80,90}$/);
  const msg = JSON.parse(s.payload.message);
  assert.equal(msg.signer_id, "alice.testnet");
  assert.ok(Date.parse(msg.deadline) > Date.now());
  assert.deepEqual(msg.intents, [{ intent: "transfer", receiver_id: "bob.testnet", tokens: { "nep141:wrap.testnet": "100" }, memo: "m" }]);
  assert.equal(Buffer.from(s.payload.nonce, "base64").length, 32);
  const ok = verifyNep413(s.public_key, s.signature, { message: s.payload.message, nonce: new Uint8Array(Buffer.from(s.payload.nonce, "base64")), recipient: s.payload.recipient });
  assert.equal(ok, true);
  const other = KeyPair.fromRandom("ed25519").getPublicKey().toString();
  assert.equal(verifyNep413(other, s.signature, { message: s.payload.message, nonce: new Uint8Array(Buffer.from(s.payload.nonce, "base64")), recipient: s.payload.recipient }), false);
});
