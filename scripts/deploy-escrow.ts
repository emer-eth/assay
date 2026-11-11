// Deploys the escrow contract to escrow.<coordinator> and initialises it, on the network in the env file.
//   npm run deploy:escrow              testnet (.env): creates the account, deploys, calls new()
//   npm run deploy:escrow:mainnet      mainnet (.env.mainnet, with NEXT_PUBLIC_NEAR_NETWORK=mainnet): the same wasm
//   ... -- --update                    redeploys the code only (state is kept)
// The wasm is the one already built from contract/ (its source is unchanged), so both networks run the same code.
// The contract account's key goes to .contract-keys/ (git-ignored), never to the terminal.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Account, KeyPair, KeyPairSigner, nearToYocto, type KeyPairString } from "near-api-js";
import { coordinator, explorerAccount, NETWORK, provider } from "../src/lib/near";

const parent = process.env.NEAR_ACCOUNT_ID!;
const escrowId = `escrow.${parent}`;
const keyFile = `.contract-keys/${escrowId}.json`;
const wasm = readFileSync("contract/target/near/swarm_escrow.wasm");
const update = process.argv.includes("--update");

async function main() {
  if (!update) {
    if (existsSync(keyFile)) throw new Error(`${keyFile} already exists: use --update to redeploy`);
    const kp = KeyPair.fromRandom("ed25519");
    // Contract storage costs 1 NEAR per 100 KB. Testnet NEAR is free, so it gets room to spare; mainnet gets the
    // code's size plus 0.3 NEAR for the jobs it will hold.
    const fund = NETWORK === "mainnet" ? Math.ceil((wasm.length / 100_000 + 0.3) * 100) / 100 : 3;
    console.log(`network: ${NETWORK} · creating ${escrowId} with ${fund} NEAR for storage`);
    await coordinator().createSubAccount({ accountOrPrefix: "escrow", publicKey: kp.getPublicKey(), nearToTransfer: nearToYocto(fund) });
    mkdirSync(".contract-keys", { recursive: true });
    writeFileSync(keyFile, JSON.stringify({ accountId: escrowId, secretKey: kp.toString() }, null, 2), { mode: 0o600 });
    console.log(`✅ created ${escrowId} (key saved to ${keyFile})`);
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
  console.log(explorerAccount(escrowId));
}
main().catch((e) => {
  console.error("❌", e instanceof Error ? e.message : e);
  process.exit(1);
});
