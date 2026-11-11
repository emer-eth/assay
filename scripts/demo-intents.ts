// Posts jobs paid with a signed NEAR Intent, and backs an agent, from a second testnet account: the same steps
// a browser wallet takes, scripted, so the flow can be shown and re-checked from the command line.
//   npm run demo:intents -- job "<what to check>" <skill> [budget]      sign in, deposit if needed, sign the intent, wait for the round
//   npm run demo:intents -- agent "<name>" "<prompt>" <skill,skill> [funding]   fund a new agent from this account
//   npm run demo:intents -- withdraw                                    take the NEAR Intents balance back to the wallet
// DEMO_BASE is the Assay to talk to (default http://localhost:3000). The account is DEMO_ACCOUNT (default
// assay-payer-test.testnet, a faucet account) with its key in .contract-keys/<account>.json (git-ignored).
import { readFileSync } from "node:fs";
import { Account, KeyPair, KeyPairSigner, nearToYocto, type KeyPairString } from "near-api-js";
import { nep413Hash } from "../src/lib/auth/nep413";
import { provider } from "../src/lib/near";

const BASE = (process.env.DEMO_BASE || "http://localhost:3000").replace(/\/$/, "");
const ID = process.env.DEMO_ACCOUNT || "assay-payer-test.testnet";
const GAS = 100_000_000_000_000n;
const { secretKey } = JSON.parse(readFileSync(`.contract-keys/${ID}.json`, "utf8")) as { secretKey: KeyPairString };
const key = KeyPair.fromString(secretKey);
const publicKey = key.getPublicKey().toString();
const me = new Account(ID, provider(), KeyPairSigner.fromSecretKey(secretKey));
// API replies are read loosely here: this is a command-line demo, not app code.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Data = Record<string, any>;
let cookie = "";

async function api(path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.getSetCookie?.().map((c) => c.split(";")[0]).join("; ");
  if (set) cookie = [cookie, set].filter(Boolean).join("; ");
  return { status: res.status, data: (await res.json().catch(() => ({}))) as Data };
}
/** A NEP-413 signature, as a wallet returns it (base64). */
const sign = (m: { message: string; nonce: string; recipient: string }) => Buffer.from(key.sign(nep413Hash({ message: m.message, nonce: new Uint8Array(Buffer.from(m.nonce, "base64")), recipient: m.recipient })).signature).toString("base64");

async function signIn() {
  const ch = (await api("/api/auth/challenge")).data;
  const res = await api("/api/auth/verify", { token: ch.token, accountId: ID, publicKey, signature: sign(ch as never) });
  if (res.status !== 200) throw new Error(`sign-in failed: ${res.data.error}`);
  console.log(`✅ signed in as ${ID} (NEP-413, key checked on chain)`);
}

async function job(description: string, skill: string, budget: number) {
  const prep = await api("/api/intents/job", { description, skills: [skill], budget });
  if (prep.status !== 200) throw new Error(`prepare: ${prep.data.error}`);
  const p = prep.data;
  if (p.registerKey) {
    await me.callFunction({ contractId: p.verifier, methodName: "add_public_key", args: { public_key: p.registerKey }, deposit: 1n, gas: GAS });
    console.log("✅ registered this wallet's key with the NEAR Intents verifier");
  }
  if (p.deposit) {
    if (!p.wrapRegistered) await me.callFunction({ contractId: p.wrap, methodName: "storage_deposit", args: { account_id: ID, registration_only: true }, deposit: nearToYocto(0.00125), gas: GAS });
    await me.callFunction({ contractId: p.wrap, methodName: "near_deposit", args: {}, deposit: BigInt(p.deposit), gas: GAS });
    await me.callFunction({ contractId: p.wrap, methodName: "ft_transfer_call", args: { receiver_id: p.verifier, amount: p.deposit, msg: "" }, deposit: 1n, gas: GAS });
    console.log(`✅ deposited ${Number(BigInt(p.deposit) / 10n ** 18n) / 1e6} NEAR into the NEAR Intents balance`);
  } else console.log("✅ NEAR Intents balance already covers the budget (a refund from an earlier job)");
  let sub = { status: 0, data: {} as Data };
  for (let i = 0; i < 6; i++) {
    sub = await api("/api/intents/job", { step: "submit", jobId: p.jobId, publicKey, signature: sign(p.sign) });
    if (sub.status === 202) break;
    await new Promise((r) => setTimeout(r, 3000)); // a fresh deposit takes a moment to be visible
  }
  if (sub.status !== 202) throw new Error(`submit: ${sub.data.error}`);
  console.log(`✅ intent signed and executed: ${BASE}/rounds/${sub.data.id}  (tx ${sub.data.tx || "confirmed from the verifier"})`);
  for (let last = ""; ; ) {
    await new Promise((r) => setTimeout(r, 5000));
    const r = (await api(`/api/rounds/${sub.data.id}`)).data;
    const round = r.round ?? r;
    if (round.status !== last) console.log(`   ${(last = round.status)}`);
    if (["done", "blocked", "unfilled", "error"].includes(round.status)) {
      console.log(round.status === "done" ? (round.grade?.passed ? `✅ passed; paid ${round.payout?.toAgent}, refunded ${round.payout?.refundToPoster}` : `↩️  failed review; refunded ${round.payout?.refundToPoster}`) : `↩️  ${round.status}; refunded`);
      for (const t of round.txs ?? []) console.log(`   · ${t.label.slice(0, 110)}`);
      return;
    }
  }
}

async function agent(name: string, prompt: string, skills: string[], funding: number) {
  const coordinator = (await api("/api/live/state")).data.coordinator?.id;
  if (!coordinator) throw new Error("couldn't read the coordinator's account");
  const tx = await me.transfer({ receiverId: coordinator, amount: nearToYocto(funding) });
  const txHash = (tx as { transaction: { hash: string } }).transaction.hash;
  const res = await api("/api/live/agents", { name, prompt, skills, funding, txHash });
  if (res.status !== 201) throw new Error(`back agent: ${res.data.error} (funding tx ${txHash})`);
  console.log(`✅ ${name} is live as ${res.data.id}, backed by ${ID} with ${funding} NEAR`);
}

async function withdraw() {
  const prep = await api("/api/intents/withdraw", {});
  if (prep.status !== 200) throw new Error(prep.data.error);
  const res = await api("/api/intents/withdraw", { sign: { message: prep.data.sign.message, nonce: prep.data.sign.nonce }, publicKey, signature: sign(prep.data.sign) });
  if (res.status !== 200) throw new Error(res.data.error);
  console.log(`✅ withdrew the NEAR Intents balance to ${ID}: tx ${res.data.tx}`);
}

async function main() {
  const [cmd, ...a] = process.argv.slice(2);
  await signIn();
  if (cmd === "job") await job(a[0], a[1] || "due-diligence", Number(a[2] || 0.3));
  else if (cmd === "agent") await agent(a[0], a[1], (a[2] || "due-diligence").split(","), Number(a[3] || 0.5));
  else if (cmd === "withdraw") await withdraw();
  else throw new Error('usage: job "<text>" <skill> [budget] | agent "<name>" "<prompt>" <skills> [funding] | withdraw');
}
main().catch((e) => {
  console.error("❌", e instanceof Error ? e.message : e);
  process.exit(1);
});
