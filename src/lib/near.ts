import { existsSync, readFileSync } from "node:fs";
import { KEYS_DIR } from "./paths";
import { isNetworkAccount, NETWORK, PUBLIC_RPCS } from "./network";
import { join } from "node:path";
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, KeyPairSigner, nearToYocto, yoctoToNear, type KeyPairString } from "near-api-js";

// One network per deployment (lib/network.ts). The coordinator account is the parent of every agent sub-account
// (agent-1.<coordinator>), so each agent's actions trace back to it on chain.
export { explorerAccount, explorerTx, NETWORK } from "./network";
// rpc.*.near.org is deprecated and rate-limits (Nov 2026); FastNEAR runs the public RPCs now.
// Two FastNEAR endpoints, so one being busy doesn't stop a round. NEAR_RPC_URL overrides both.
export const RPC_URLS = process.env.NEAR_RPC_URL ? [process.env.NEAR_RPC_URL] : PUBLIC_RPCS[NETWORK];

export const provider = () =>
  RPC_URLS.length > 1 ? new FailoverRpcProvider(RPC_URLS.map((url) => new JsonRpcProvider({ url }))) : new JsonRpcProvider({ url: RPC_URLS[0] });

export function coordinator() {
  const id = process.env.NEAR_ACCOUNT_ID;
  const key = process.env.NEAR_PRIVATE_KEY as KeyPairString | undefined;
  if (!id || !key) throw new Error(`NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY (a ${NETWORK} account) must be set in .env.`);
  // The account must belong to this deployment's network: a mainnet key on a testnet deployment (or the reverse)
  // would sign on the wrong chain. Mainnet is chosen explicitly with NEXT_PUBLIC_NEAR_NETWORK=mainnet.
  if (!isNetworkAccount(id) || /^[0-9a-f]{64}$/.test(id))
    throw new Error(`Refusing to run on ${id}: this deployment runs on NEAR ${NETWORK}, so the coordinator must be a named ${NETWORK} account (ending in .${NETWORK === "mainnet" ? "near" : "testnet"}).`);
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

/**
 * An agent's own account, signed with its own key (so its spending is traceable on chain).
 * The key comes from KEYS_DIR, or on a fresh host from AGENT_KEYS, a JSON map of account id to secret key.
 */
export function agentAccount(accountId: string) {
  const file = join(KEYS_DIR, `${accountId}.json`);
  const secretKey = (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).secretKey : JSON.parse(process.env.AGENT_KEYS || "{}")[accountId]) as KeyPairString | undefined;
  if (!secretKey) throw new Error(`No key for ${accountId}: add it to ${KEYS_DIR} or AGENT_KEYS.`);
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


// ---------- escrow contract ----------

export const escrowId = () => process.env.ESCROW_CONTRACT_ID || `escrow.${process.env.NEAR_ACCOUNT_ID}`;
const GAS = 50_000_000_000_000n;
const yocto = (near: number) => nearToYocto(Number(near.toFixed(6))).toString();

export type EscrowJob = { poster: string; budget: string; created_at: number; status: "Open" | "Settled" | "Refunded" | "Reclaimed"; winner: string | null; paid_to_agent: string; fee: string; refunded: string };

/** The contract's own record of a job: the source of truth for escrow deposits. */
export async function escrowJob(jobId: string) {
  return (await provider().callFunction({ contractId: escrowId(), method: "get_job", args: { job_id: jobId } })) as EscrowJob | null;
}

/** Pays the winner and the fee, and refunds the rest to the poster, in one contract call. */
export async function escrowSettle(jobId: string, winner: string, pay: number, fee: number) {
  const res = await coordinator().callFunctionRaw({ contractId: escrowId(), methodName: "settle", args: { job_id: jobId, winner, pay: yocto(pay), fee: yocto(fee) }, gas: GAS });
  return res.transaction.hash as string;
}

/** Returns the whole budget to the poster. */
export async function escrowRefund(jobId: string) {
  const res = await coordinator().callFunctionRaw({ contractId: escrowId(), methodName: "refund", args: { job_id: jobId }, gas: GAS });
  return res.transaction.hash as string;
}

/** Makes sure the contract will accept this account as a winner. */
export async function ensureEscrowAgent(agentId: string) {
  const known = await provider().callFunction({ contractId: escrowId(), method: "is_agent", args: { account: agentId } });
  if (known) return null;
  const res = await coordinator().callFunctionRaw({ contractId: escrowId(), methodName: "register_agent", args: { agent: agentId }, gas: GAS });
  return res.transaction.hash as string;
}

/** The coordinator deposits a budget into the escrow contract itself (jobs paid through NEAR Intents, where the
 *  payer has no NEAR wallet). The contract then holds it exactly as it holds a wallet deposit. */
export async function escrowPost(jobId: string, near: number) {
  const res = await coordinator().callFunctionRaw({ contractId: escrowId(), methodName: "post_job", args: { job_id: jobId }, deposit: BigInt(yocto(near)), gas: GAS });
  return res.transaction.hash as string;
}

// ---------- wNEAR (wrap.near), the token NEAR Intents delivers and takes ----------

const WRAP = "wrap.near";
const ONE_YOCTO = 1n;

export async function wnearBalance(accountId: string) {
  return BigInt((await provider().callFunction({ contractId: WRAP, method: "ft_balance_of", args: { account_id: accountId } })) as string);
}

/** wNEAR back to NEAR on the coordinator (after a 1Click swap delivered it). */
export async function unwrapNear(yoctoAmount: bigint) {
  const res = await coordinator().callFunctionRaw({ contractId: WRAP, methodName: "near_withdraw", args: { amount: yoctoAmount.toString() }, deposit: ONE_YOCTO, gas: GAS });
  return res.transaction.hash as string;
}

/** NEAR to wNEAR on the coordinator (before sending a refund through 1Click). */
export async function wrapNear(yoctoAmount: bigint) {
  const res = await coordinator().callFunctionRaw({ contractId: WRAP, methodName: "near_deposit", args: {}, deposit: yoctoAmount, gas: GAS });
  return res.transaction.hash as string;
}

/** Sends wNEAR, registering the receiver with the token contract first if it isn't (a fresh 1Click deposit address isn't). */
export async function sendWnear(to: string, yoctoAmount: bigint) {
  const c = coordinator();
  const registered = await provider().callFunction({ contractId: WRAP, method: "storage_balance_of", args: { account_id: to } });
  if (!registered) await c.callFunctionRaw({ contractId: WRAP, methodName: "storage_deposit", args: { account_id: to, registration_only: true }, deposit: 1_250_000_000_000_000_000_000n, gas: GAS });
  const res = await c.callFunctionRaw({ contractId: WRAP, methodName: "ft_transfer", args: { receiver_id: to, amount: yoctoAmount.toString() }, deposit: ONE_YOCTO, gas: GAS });
  return res.transaction.hash as string;
}
