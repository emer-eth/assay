import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, KeyPairSigner, nearToYocto, yoctoToNear, type KeyPairString } from "near-api-js";

// Testnet only. The coordinator account is the parent of every agent sub-account
// (agent-1.<coordinator>), so each agent's actions trace back to it on chain.
export const NETWORK = "testnet";
// rpc.testnet.near.org is deprecated and rate-limits (Nov 2026); FastNEAR runs the public testnet RPC now.
// Two FastNEAR endpoints, so one being busy doesn't stop a round. NEAR_RPC_URL overrides both.
export const RPC_URLS = process.env.NEAR_RPC_URL ? [process.env.NEAR_RPC_URL] : ["https://rpc.testnet.fastnear.com", "https://test.rpc.fastnear.com"];

export const provider = () =>
  RPC_URLS.length > 1 ? new FailoverRpcProvider(RPC_URLS.map((url) => new JsonRpcProvider({ url }))) : new JsonRpcProvider({ url: RPC_URLS[0] });

export function coordinator() {
  const id = process.env.NEAR_ACCOUNT_ID;
  const key = process.env.NEAR_PRIVATE_KEY as KeyPairString | undefined;
  if (!id || !key) throw new Error("NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY (a TESTNET account) must be set in .env.");
  if (!id.endsWith(".testnet"))
    throw new Error(`Refusing to run on ${id}: that's not a testnet account, so its key can move real money. Remove its key from .env and use an account ending in .testnet (free at https://testnet.mynearwallet.com).`);
  return new Account(id, provider(), KeyPairSigner.fromSecretKey(key));
}

export const agentAccountId = (n: number) => `agent-${n}.${process.env.NEAR_ACCOUNT_ID}`;

/** Creates agent-<n>.<coordinator> with a fresh key and some NEAR for its AI usage. Returns the new key: store it, never log it. */
export async function createAgentAccount(n: number, near: number) {
  const parent = coordinator();
  const keyPair = KeyPair.fromRandom("ed25519");
  await parent.createSubAccount({ accountOrPrefix: `agent-${n}`, publicKey: keyPair.getPublicKey(), nearToTransfer: nearToYocto(near) }); // the chain counts in yoctoNEAR (1 NEAR = 10^24)
  return { accountId: agentAccountId(n), secretKey: keyPair.toString() };
}

/** An agent's own account, signed with its own key from .keys/ (so its spending is traceable on chain). */
export function agentAccount(accountId: string) {
  const { secretKey } = JSON.parse(readFileSync(join(process.cwd(), ".keys", `${accountId}.json`), "utf8")) as { secretKey: KeyPairString };
  return new Account(accountId, provider(), KeyPairSigner.fromSecretKey(secretKey));
}

/** Sends NEAR and returns the transaction hash. */
export async function sendNear(from: Account, to: string, near: number) {
  const res = await from.transfer({ receiverId: to, amount: nearToYocto(Number(near.toFixed(6))) });
  return res.transaction.hash as string;
}

/** Spendable NEAR on an account, read from the chain. */
export async function availableNear(accountId: string) {
  const state = await new Account(accountId, provider()).getState();
  return Number(yoctoToNear(state.balance.available, 6));
}

export const explorerTx = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;
export const explorerAccount = (id: string) => `https://testnet.nearblocks.io/address/${id}`;
