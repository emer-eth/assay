// Deploys the escrow contract to escrow.<coordinator>.testnet and initialises it.
//   npm run deploy:escrow             first deploy: creates the account (3 NEAR for storage), deploys, calls new()
//   npm run deploy:escrow -- --update redeploys the code only (state is kept)
// The contract account's key goes to .contract-keys/ (git-ignored), never to the terminal.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Account, KeyPair, KeyPairSigner, nearToYocto, type KeyPairString } from "near-api-js";
import { coordinator, provider } from "../src/lib/near";

const parent = process.env.NEAR_ACCOUNT_ID!;
const escrowId = `escrow.${parent}`;
const keyFile = `.contract-keys/${escrowId}.json`;
const wasm = readFileSync("contract/target/near/swarm_escrow.wasm");
const update = process.argv.includes("--update");

async function main() {
  if (!update) {
    if (existsSync(keyFile)) throw new Error(`${keyFile} already exists: use --update to redeploy`);
    const kp = KeyPair.fromRandom("ed25519");
    await coordinator().createSubAccount({ accountOrPrefix: "escrow", publicKey: kp.getPublicKey(), nearToTransfer: nearToYocto(3) });
    mkdirSync(".contract-keys", { recursive: true });
    writeFileSync(keyFile, JSON.stringify({ accountId: escrowId, secretKey: kp.toString() }, null, 2), { mode: 0o600 });
    console.log(`✅ created ${escrowId} with 3 NEAR (key saved to ${keyFile})`);
  }
  const { secretKey } = JSON.parse(readFileSync(keyFile, "utf8")) as { secretKey: KeyPairString };
  const escrow = new Account(escrowId, provider(), KeyPairSigner.fromSecretKey(secretKey));
  await escrow.deployContract(new Uint8Array(wasm));
  console.log(`✅ deployed ${(wasm.length / 1024).toFixed(0)} KB of code`);
  if (!update) {
    await escrow.callFunction({ contractId: escrowId, methodName: "new", args: { coordinator: parent, fee_account: parent, reclaim_after_minutes: 60 }, gas: 30_000_000_000_000n });
    console.log("✅ initialised: coordinator and fee account =", parent, "· reclaim after 60 minutes");
  }
  const config = await provider().callFunction({ contractId: escrowId, method: "get_config", args: {} });
  console.log("config:", JSON.stringify(config));
  console.log(`https://testnet.nearblocks.io/address/${escrowId}`);
}
main().catch((e) => {
  console.error("❌", e instanceof Error ? e.message : e);
  process.exit(1);
});
