import "server-only";
import { randomBytes } from "node:crypto";
import type { Account, KeyPair } from "near-api-js";
import { nep413Hash } from "../auth/nep413";
import { coordinator, provider, RPC_URLS } from "../near";
import { IS_MAINNET } from "../network";

// NEAR Intents' verifier contract: the same code on both networks. On mainnet it's intents.near; on testnet,
// where NEAR Intents has no deployment, Assay runs NEAR's own release build at assay-intents.testnet
// (scripts/deploy-intents.ts). Money held there moves only by intents its owner signed (NEP-413) and anyone
// submits with execute_intents; here the coordinator submits them and pays the gas.

export const INTENTS_ID = process.env.INTENTS_CONTRACT_ID || (IS_MAINNET ? "intents.near" : "assay-intents.testnet");
export const WRAP_ID = IS_MAINNET ? "wrap.near" : "wrap.testnet";
/** wNEAR's token id inside the verifier (NEP-245 multi-token id of a NEP-141 token). */
export const WNEAR_TOKEN = `nep141:${WRAP_ID}`;
const GAS = 300_000_000_000_000n;

export type Intent =
  | { intent: "transfer"; receiver_id: string; tokens: Record<string, string>; memo?: string }
  | { intent: "ft_withdraw"; token: string; receiver_id: string; amount: string; memo?: string }
  | { intent: "native_withdraw"; receiver_id: string; amount: string };

export type SignedIntent = { standard: "nep413"; payload: { message: string; nonce: string; recipient: string }; public_key: string; signature: string };

export const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58(bytes: Uint8Array) {
  let n = BigInt(`0x${Buffer.from(bytes).toString("hex") || "0"}`);
  let s = "";
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    s = "1" + s;
  }
  return s;
}

/** The exact message a signer signs: who, until when, and what. Shared with the browser (the payer's wallet signs it). */
export function intentMessage(signerId: string, intents: Intent[], deadline: Date) {
  return JSON.stringify({ signer_id: signerId, deadline: deadline.toISOString(), intents });
}

/** A fresh NEP-413 payload for the verifier (a random 32-byte nonce, used once). */
export function intentPayload(signerId: string, intents: Intent[], ttlMs = 10 * 60_000) {
  return { message: intentMessage(signerId, intents, new Date(Date.now() + ttlMs)), nonce: randomBytes(32).toString("base64"), recipient: INTENTS_ID };
}

/** Signs an intent with a key Assay holds (the coordinator's, or an agent's). */
export function signIntent(signerId: string, key: KeyPair, intents: Intent[]): SignedIntent {
  const payload = intentPayload(signerId, intents);
  const hash = nep413Hash({ message: payload.message, nonce: new Uint8Array(Buffer.from(payload.nonce, "base64")), recipient: payload.recipient });
  const { signature } = key.sign(hash);
  return { standard: "nep413", payload, public_key: key.getPublicKey().toString(), signature: `ed25519:${base58(signature)}` };
}

/** Submits signed intents; the coordinator pays the gas. Returns the transaction hash. */
export async function executeIntents(signed: SignedIntent[]) {
  const res = await coordinator().callFunctionRaw({ contractId: INTENTS_ID, methodName: "execute_intents", args: { signed }, gas: GAS });
  return res.transaction.hash as string;
}

/** A view call straight to the RPC, so a contract panic comes back as its own message (the failover client
 *  reports any panic as "Exceeded 2 providers"). */
async function view(method: string, args: object) {
  let last = "the RPC didn't answer";
  for (const url of RPC_URLS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "optimistic", account_id: INTENTS_ID, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } }),
        signal: AbortSignal.timeout(15_000),
      });
      const d = (await res.json()) as { result?: { result?: number[]; error?: string }; error?: { data?: string; cause?: { info?: { error_message?: string } } } };
      const err = d.result?.error ?? d.error?.cause?.info?.error_message ?? (typeof d.error?.data === "string" ? d.error.data : undefined);
      if (err) throw new ContractError(String(err).replace(/^.*Smart contract panicked: /s, "").slice(0, 300));
      if (d.result?.result) return JSON.parse(Buffer.from(d.result.result).toString() || "null");
    } catch (e) {
      if (e instanceof ContractError) throw e;
      last = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(last);
}
export class ContractError extends Error {}

/** Checks signed intents without running them (would they succeed?). Throws with the contract's reason if not. */
export async function simulateIntents(signed: SignedIntent[]) {
  return view("simulate_intents", { signed });
}

/** wNEAR (in yocto) an account holds inside the verifier. */
export async function intentsBalance(accountId: string) {
  return BigInt((await provider().callFunction({ contractId: INTENTS_ID, method: "mt_balance_of", args: { account_id: accountId, token_id: WNEAR_TOKEN } })) as string);
}

/** Is this public key registered to sign for this account on the verifier? (Implicit accounts need no registration.) */
export async function hasIntentsKey(accountId: string, publicKey: string) {
  return !!(await provider().callFunction({ contractId: INTENTS_ID, method: "has_public_key", args: { account_id: accountId, public_key: publicKey } }));
}

/** Moves NEAR from an account Assay controls into its own verifier balance: wrap, then deposit with ft_transfer_call. */
export async function depositToIntents(account: Account, yocto: bigint) {
  const reg = await provider().callFunction({ contractId: WRAP_ID, method: "storage_balance_of", args: { account_id: account.accountId } });
  if (!reg) await account.callFunction({ contractId: WRAP_ID, methodName: "storage_deposit", args: { account_id: account.accountId, registration_only: true }, deposit: 1_250_000_000_000_000_000_000n, gas: GAS });
  await account.callFunction({ contractId: WRAP_ID, methodName: "near_deposit", args: {}, deposit: yocto, gas: GAS });
  const res = await account.callFunctionRaw({ contractId: WRAP_ID, methodName: "ft_transfer_call", args: { receiver_id: INTENTS_ID, amount: yocto.toString(), msg: "" }, deposit: 1n, gas: GAS });
  return res.transaction.hash as string;
}
