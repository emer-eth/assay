import assert from "node:assert/strict";
import { test } from "node:test";
import { KeyPair } from "near-api-js";
import { nep413Hash } from "../src/lib/auth/nep413";
import { toSigned } from "../src/lib/live/intents-jobs";
import { base58, INTENTS_ID } from "../src/lib/live/intents-verifier";

test("a wallet signature in any encoding wallets use is verified and normalised to ed25519:<base58>", () => {
  const key = KeyPair.fromRandom("ed25519");
  const m = { message: JSON.stringify({ signer_id: "a.testnet", deadline: "2030-01-01T00:00:00.000Z", intents: [] }), nonce: Buffer.alloc(32, 7).toString("base64") };
  const sig = key.sign(nep413Hash({ message: m.message, nonce: new Uint8Array(Buffer.from(m.nonce, "base64")), recipient: INTENTS_ID })).signature;
  const want = `ed25519:${base58(sig)}`;
  const pub = key.getPublicKey().toString();
  for (const form of [Buffer.from(sig).toString("base64"), base58(sig), `ed25519:${Buffer.from(sig).toString("base64")}`, `ed25519:${base58(sig)}`]) {
    assert.equal(toSigned(m, pub, form)?.signature, want, form.slice(0, 12));
  }
  // a signature over a different message, or by another key, is refused before it reaches the contract
  assert.equal(toSigned({ ...m, message: m.message.replace("a.testnet", "b.testnet") }, pub, base58(sig)), null);
  assert.equal(toSigned(m, KeyPair.fromRandom("ed25519").getPublicKey().toString(), base58(sig)), null);
});
