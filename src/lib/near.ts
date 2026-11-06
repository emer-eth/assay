import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, nearToYocto, type KeyPairString } from "near-api-js";

// Testnet only. The coordinator account is the parent of every agent sub-account
// (agent-1.<coordinator>), so each agent's actions trace back to it on chain.
export const NETWORK = "testnet";
export const RPC_URL = process.env.NEAR_RPC_URL || "https://rpc.testnet.near.org";

export const provider = () => new JsonRpcProvider({ url: RPC_URL });

export function coordinator() {
  const id = process.env.NEAR_ACCOUNT_ID;
  const key = process.env.NEAR_PRIVATE_KEY as KeyPairString | undefined;
  if (!id || !key) throw new Error("NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY (a TESTNET account) must be set in .env.");
  if (!id.endsWith(".testnet")) throw new Error(`Refusing to run on ${id}: use a .testnet account.`);
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
