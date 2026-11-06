import { createHash } from "node:crypto";
import { PublicKey } from "near-api-js";

// NEP-413 (https://github.com/near/NEPs/blob/master/neps/nep-0413.md): a wallet signs an off-chain message
// to prove who it is, with no transaction and no gas. The signed bytes are
//   sha256( u32le(2^31 + 413) ++ borsh({ message: string, nonce: [u8; 32], recipient: string, callbackUrl: Option<string> }) )
// Pure and unit-tested against near-api-js's own signer.

export type Nep413Payload = { message: string; nonce: Uint8Array; recipient: string; callbackUrl?: string };

const TAG = 2 ** 31 + 413;

function borshString(s: string) {
  const bytes = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length);
  return Buffer.concat([len, bytes]);
}

export function nep413Hash(p: Nep413Payload) {
  if (p.nonce.length !== 32) throw new Error("NEP-413 nonce must be 32 bytes");
  const tag = Buffer.alloc(4);
  tag.writeUInt32LE(TAG);
  const callback = p.callbackUrl === undefined ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), borshString(p.callbackUrl)]);
  const body = Buffer.concat([borshString(p.message), Buffer.from(p.nonce), borshString(p.recipient), callback]);
  return new Uint8Array(createHash("sha256").update(Buffer.concat([tag, body])).digest());
}

/** Wallets send the signature as base64 (some as base58 with an "ed25519:" prefix); near-api-js returns bytes. */
export function signatureBytes(sig: string | Uint8Array) {
  if (sig instanceof Uint8Array) return sig;
  const raw = sig.startsWith("ed25519:") ? sig.slice(8) : sig;
  const b64 = Buffer.from(raw, "base64");
  if (b64.length === 64) return new Uint8Array(b64);
  // base58 fallback
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const c of raw) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) return new Uint8Array();
    n = n * 58n + BigInt(i);
  }
  const out: number[] = [];
  while (n > 0n) {
    out.unshift(Number(n % 256n));
    n /= 256n;
  }
  return new Uint8Array(out);
}

export function verifyNep413(publicKey: string, signature: string | Uint8Array, payload: Nep413Payload) {
  try {
    return PublicKey.fromString(publicKey).verify(nep413Hash(payload), signatureBytes(signature));
  } catch {
    return false;
  }
}
