// Deploys NEAR Intents' own verifier contract (near/intents, MIT, release defuse/v0.4.2) to testnet, where NEAR
// Intents has no deployment of its own, so Assay's testnet can pay with signed intents exactly as mainnet does on
// intents.near. The wasm is NEAR's official release build, checked against its published SHA-256; nothing is changed.
//   npm run deploy:intents          deploy + init + register wrap.testnet storage + the coordinator's signing key
//   npm run deploy:intents -- --setup   only the setup steps (storage, key), when the code is already there
// The contract account (assay-intents.testnet, made with the testnet faucet) keeps its key in .contract-keys/.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Account, KeyPairSigner, nearToYocto, type KeyPairString } from "near-api-js";
import { coordinator, provider } from "../src/lib/near";

const ID = process.env.INTENTS_CONTRACT_ID || "assay-intents.testnet";
const RELEASE = "https://github.com/near/intents/releases/download/defuse%2Fv0.4.2/defuse.wasm";
const SHA256 = "f67f9559b3b512c52dfa11723a28b9119bcf773ac01780370d6409e5f1fb20e5"; // defuse.sha256 in the same release
const WRAP = "wrap.testnet";
const GAS = 100_000_000_000_000n;

async function main() {
  const { secretKey } = JSON.parse(readFileSync(`.contract-keys/${ID}.json`, "utf8")) as { secretKey: KeyPairString };
  const self = new Account(ID, provider(), KeyPairSigner.fromSecretKey(secretKey));
  const coord = coordinator();

  if (!process.argv.includes("--setup")) {
    const wasm = new Uint8Array(await (await fetch(RELEASE)).arrayBuffer());
    const sha = createHash("sha256").update(wasm).digest("hex");
    if (sha !== SHA256) throw new Error(`downloaded wasm has sha256 ${sha}, expected ${SHA256}`);
    console.log(`✅ downloaded defuse v0.4.2 (${(wasm.length / 1024).toFixed(0)} KB), sha256 matches the release`);
    // Code storage costs 1 NEAR per 100 KB: top the account up from the coordinator if it's short.
    const need = wasm.length / 1e5 + 1;
    const have = Number((await self.getState()).balance.available) / 1e24;
    if (have < need) {
      const send = Math.ceil(need - have);
      await coord.transfer({ receiverId: ID, amount: nearToYocto(send) });
      console.log(`✅ coordinator sent ${send} NEAR for storage`);
    }
    await self.deployContract(wasm);
    console.log("✅ deployed");
    const c = coord.accountId;
    await self.callFunction({
      contractId: ID,
      methodName: "new",
      args: { config: { wnear_id: WRAP, fees: { fee: 0, fee_collector: c }, roles: { super_admins: [c], admins: {}, grantees: {} } } },
      gas: GAS,
    });
    console.log(`✅ initialised: wNEAR ${WRAP}, no fee, super admin ${c}`);
  }

  // The verifier must be registered with wrap.testnet to receive wNEAR deposits.
  const reg = await provider().callFunction({ contractId: WRAP, method: "storage_balance_of", args: { account_id: ID } });
  if (!reg) {
    await coord.callFunction({ contractId: WRAP, methodName: "storage_deposit", args: { account_id: ID, registration_only: true }, deposit: nearToYocto(0.00125), gas: GAS });
    console.log("✅ registered the verifier with wrap.testnet");
  }
  // A named account signs intents only with keys it registered on the verifier: register the coordinator's.
  const pub = (await coord.getSigner()!.getPublicKey()).toString();
  const has = await provider().callFunction({ contractId: ID, method: "has_public_key", args: { account_id: coord.accountId, public_key: pub } });
  if (!has) {
    await coord.callFunction({ contractId: ID, methodName: "add_public_key", args: { public_key: pub }, deposit: 1n, gas: GAS });
    console.log(`✅ registered ${coord.accountId}'s key with the verifier`);
  }
  console.log("config:", JSON.stringify(await provider().callFunction({ contractId: ID, method: "fee", args: {} }).catch(() => "?")));
  console.log(`https://testnet.nearblocks.io/address/${ID}`);
}
main().catch((e) => {
  console.error("❌", e instanceof Error ? e.message : e);
  process.exit(1);
});
