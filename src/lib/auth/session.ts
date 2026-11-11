import "server-only";
import { isNetworkAccount, NETWORK, OTHER_NETWORK } from "../network";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { provider } from "../near";
import { verifyNep413 } from "./nep413";

// Wallet sign-in: the server hands out a one-time challenge, the wallet signs it (NEP-413, no gas),
// the server checks the signature AND that the key is a full-access key of that account on chain,
// then sets a signed, httpOnly session cookie. The browser's claim alone is never trusted.

export const SIGN_IN_MESSAGE = "Sign in to Assay";
export const RECIPIENT = "assay";
const COOKIE = "sfh_session";
const CHALLENGE_TTL = 5 * 60_000;
const SESSION_TTL = 7 * 24 * 3600_000;

function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  // Local fallback: derived from the coordinator key, which is already secret. Set SESSION_SECRET to deploy.
  const base = process.env.NEAR_PRIVATE_KEY;
  if (!base || process.env.NODE_ENV === "production") throw new Error("Set SESSION_SECRET to enable sign-in.");
  return createHash("sha256").update(`sfh-session:${base}`).digest("hex");
}

const sign = (data: string) => createHmac("sha256", secret()).update(data).digest("base64url");
function seal(obj: object) {
  const data = Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${data}.${sign(data)}`;
}
function open<T>(token: string | undefined): T | null {
  if (!token) return null;
  const [data, mac] = token.split(".");
  if (!data || !mac) return null;
  const want = Buffer.from(sign(data));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    return JSON.parse(Buffer.from(data, "base64url").toString()) as T;
  } catch {
    return null;
  }
}

const used = new Map<string, number>(); // nonces already used to sign in (replay guard)

export function newChallenge() {
  const nonce = randomBytes(32).toString("base64");
  return { message: SIGN_IN_MESSAGE, recipient: RECIPIENT, nonce, token: seal({ nonce, exp: Date.now() + CHALLENGE_TTL }) };
}

export async function verifySignIn(input: { token: string; accountId: string; publicKey: string; signature: string }) {
  const ch = open<{ nonce: string; exp: number }>(input.token);
  if (!ch || ch.exp < Date.now()) return { ok: false as const, error: "The sign-in request expired. Try again." };
  if (used.has(ch.nonce)) return { ok: false as const, error: "This sign-in was already used. Try again." };
  const validName = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(input.accountId);
  // A named account on this deployment's network, or an implicit (64-hex) one.
  if (!validName || !isNetworkAccount(input.accountId))
    return { ok: false as const, error: `That's a ${OTHER_NETWORK} account. This Assay runs on NEAR ${NETWORK}: connect an account ending in .${NETWORK === "mainnet" ? "near" : "testnet"}.` };

  const nonce = new Uint8Array(Buffer.from(ch.nonce, "base64"));
  if (!verifyNep413(input.publicKey, input.signature, { message: SIGN_IN_MESSAGE, nonce, recipient: RECIPIENT }))
    return { ok: false as const, error: "The wallet's signature didn't check out." };

  // The key must belong to the account, with full access (NEP-413 requires it).
  try {
    const key = await provider().viewAccessKey({ accountId: input.accountId, publicKey: input.publicKey, finalityQuery: { finality: "final" } });
    if (key.permission !== "FullAccess") return { ok: false as const, error: "That key can't sign in for this account." };
  } catch {
    return { ok: false as const, error: "That key doesn't belong to this account." };
  }

  used.set(ch.nonce, ch.exp);
  for (const [n, exp] of used) if (exp < Date.now()) used.delete(n);
  (await cookies()).set(COOKIE, seal({ accountId: input.accountId, exp: Date.now() + SESSION_TTL }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL / 1000,
  });
  return { ok: true as const, accountId: input.accountId };
}

/** The signed-in account, or null. */
export async function currentAccount() {
  const s = open<{ accountId: string; exp: number }>((await cookies()).get(COOKIE)?.value);
  return s && s.exp > Date.now() ? s.accountId : null;
}

export async function signOut() {
  (await cookies()).delete(COOKIE);
}

// Paying with NEAR Intents needs no NEAR wallet, so there's no account to sign in with. Instead the browser holds
// the ids of the payments it made, sealed in a cookie. A payment id is a random UUID that only the payer is given,
// so knowing it is what lets someone read that round's private report.
const PAY_COOKIE = "assay_pay";
const PAY_TTL = 30 * 24 * 3600_000;

/** Ids of the NEAR Intents payments this browser made (newest first). */
export async function paidIds(): Promise<string[]> {
  const s = open<{ ids: string[] }>((await cookies()).get(PAY_COOKIE)?.value);
  return Array.isArray(s?.ids) ? s.ids.filter((x) => typeof x === "string").slice(0, 20) : [];
}

/** Remembers a payment in this browser (call from a route handler or server action). */
export async function rememberPayment(id: string) {
  const ids = [id, ...(await paidIds()).filter((x) => x !== id)].slice(0, 20);
  (await cookies()).set(PAY_COOKIE, seal({ ids }), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: PAY_TTL / 1000 });
}

/** Everyone this browser is: the signed-in account, and the Intents payments it made. */
export async function currentViewer() {
  return { account: await currentAccount(), payments: await paidIds() };
}
