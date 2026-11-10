import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { KeyPair, KeyPairSigner } from "near-api-js";
import { verifyNep413 } from "../src/lib/auth/nep413";

// Checks our NEP-413 verification against near-api-js's own NEP-413 signer, so it matches what wallets do.
async function signed(message = "Sign in to Assay", recipient = "assay") {
  const kp = KeyPair.fromRandom("ed25519");
  const nonce = new Uint8Array(randomBytes(32));
  const s = await new KeyPairSigner(kp).signNep413Message("alice.testnet", { message, recipient, nonce });
  return { pk: kp.getPublicKey().toString(), sig: s.signature, nonce, message, recipient };
}

test("a real NEP-413 signature verifies (bytes and base64)", async () => {
  const s = await signed();
  assert.equal(verifyNep413(s.pk, s.sig, { message: s.message, nonce: s.nonce, recipient: s.recipient }), true);
  assert.equal(verifyNep413(s.pk, Buffer.from(s.sig).toString("base64"), { message: s.message, nonce: s.nonce, recipient: s.recipient }), true);
});

test("any change to message, nonce, recipient or key fails", async () => {
  const s = await signed();
  const other = KeyPair.fromRandom("ed25519").getPublicKey().toString();
  assert.equal(verifyNep413(s.pk, s.sig, { message: "Sign in to something else", nonce: s.nonce, recipient: s.recipient }), false);
  assert.equal(verifyNep413(s.pk, s.sig, { message: s.message, nonce: new Uint8Array(32), recipient: s.recipient }), false);
  assert.equal(verifyNep413(s.pk, s.sig, { message: s.message, nonce: s.nonce, recipient: "evil-app" }), false);
  assert.equal(verifyNep413(other, s.sig, { message: s.message, nonce: s.nonce, recipient: s.recipient }), false);
  assert.equal(verifyNep413(s.pk, "garbage", { message: s.message, nonce: s.nonce, recipient: s.recipient }), false);
});
