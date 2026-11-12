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
  // PRIVATE_ONLY=1: only private-inference agents may bid. CHALLENGE=0: skip the second check.
  const prep = await api("/api/intents/job", { description, skills: [skill], budget, privateOnly: process.env.PRIVATE_ONLY === "1", challenge: process.env.CHALLENGE !== "0" });
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

/** Watches a round until it ends, printing each phase and the money. */
async function watch(id: string) {
  for (let last = ""; ; ) {
    await new Promise((r) => setTimeout(r, 5000));
    const round = (await api(`/api/rounds/${id}`)).data;
    if (round.status !== last) console.log(`   ${(last = round.status)}`);
    if (["done", "blocked", "unfilled", "error"].includes(round.status)) {
      console.log(round.status === "done" ? (round.grade?.passed ? `✅ passed; paid ${round.payout?.toAgent}, refunded ${round.payout?.refundToPoster}` : `↩️  failed review; refunded ${round.payout?.refundToPoster}`) : `↩️  ${round.status}; refunded`);
      return;
    }
  }
}

/** Pays through the escrow contract from the wallet, as the "NEAR wallet to escrow" option does: reserve a job id,
 *  call post_job on the contract with the budget attached, then confirm it. */
async function escrowJob(description: string, skill: string, budget: number) {
  const prep = await api("/api/live/jobs/prepare", { description, skills: [skill], budget, challenge: process.env.CHALLENGE !== "0", privateOnly: process.env.PRIVATE_ONLY === "1" });
  if (prep.status !== 200) throw new Error(`prepare: ${prep.data.error}`);
  const tx = await me.callFunctionRaw({ contractId: prep.data.contractId, methodName: "post_job", args: { job_id: prep.data.jobId }, deposit: nearToYocto(budget), gas: GAS });
  const txHash = (tx as { transaction: { hash: string } }).transaction.hash;
  console.log(`✅ ${budget} NEAR deposited into the escrow contract ${prep.data.contractId} (tx ${txHash})`);
  const res = await api("/api/live/jobs", { jobId: prep.data.jobId, txHash });
  if (res.status !== 202) throw new Error(`post: ${res.data.error}`);
  console.log(`✅ round ${BASE}/rounds/${res.data.id}`);
  await watch(res.data.id);
}

/** Uses Assay the way an AI assistant does: top up prepaid credit from the wallet, make an API key, post the job
 *  over MCP with the key, wait for it over MCP, then revoke the key and withdraw the unused credit. */
async function mcpJob(description: string, skill: string, budget: number) {
  const coordinator = (await api("/api/live/state")).data.coordinator?.id;
  const top = Math.max(0.1, budget);
  const t = await me.transfer({ receiverId: coordinator, amount: nearToYocto(top) });
  const credit = await api("/api/live/credit", { amount: top, txHash: (t as { transaction: { hash: string } }).transaction.hash });
  if (credit.status !== 200) throw new Error(`top-up: ${credit.data.error}`);
  console.log(`✅ topped up ${top} NEAR of credit`);
  const k = await api("/api/live/keys", { label: "demo: MCP client" });
  if (k.status !== 201) throw new Error(`key: ${k.data.error}`);
  const mcp = async (name: string, args: object) => {
    const res = await fetch(`${BASE}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${k.data.key}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
    const text = await res.text();
    const line = text.split("\n").find((l) => l.startsWith("data:")) ?? text;
    const msg = JSON.parse(line.replace(/^data:\s*/, ""));
    const out = msg.result?.content?.[0]?.text ?? JSON.stringify(msg.error ?? msg);
    if (msg.result?.isError) throw new Error(`${name}: ${out}`);
    try { return JSON.parse(out); } catch { return out; }
  };
  try {
    const posted = await mcp("post_job", { description, skills: [skill], budget });
    console.log(`✅ posted over MCP with an API key: round ${BASE}/rounds/${posted.round_id ?? posted.id}`);
    let r = posted;
    for (let i = 0; i < 6 && !r.finished; i++) {
      r = await mcp("wait_for_round", { round_id: posted.round_id ?? posted.id, max_wait_seconds: 240 });
      console.log(`   ${r.status}`);
    }
    console.log(r.delivery_review?.passed ? `✅ passed over MCP; the report came back in the tool result (${String(r.result).length} characters)` : `↩️  ${r.status}: ${JSON.stringify(r.delivery_review ?? "")}`);
  } finally {
    await fetch(`${BASE}/api/live/keys?id=${k.data.id}`, { method: "DELETE", headers: { cookie } });
    const w = await api("/api/live/credit/withdraw", {});
    console.log(`✅ revoked the key; withdrew ${w.data.amount ?? 0} NEAR of unused credit`);
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
  else if (cmd === "escrow") await escrowJob(a[0], a[1] || "due-diligence", Number(a[2] || 0.3));
  else if (cmd === "mcp") await mcpJob(a[0], a[1] || "due-diligence", Number(a[2] || 0.3));
  else if (cmd === "agent") await agent(a[0], a[1], (a[2] || "due-diligence").split(","), Number(a[3] || 0.5));
  else if (cmd === "withdraw") await withdraw();
  else if (cmd === "balance") console.log((await api("/api/account/balance")).data);
  else throw new Error('usage: job "<text>" <skill> [budget] | agent "<name>" "<prompt>" <skills> [funding] | escrow "<text>" <skill> [budget] | mcp "<text>" <skill> [budget] | withdraw | balance');
}
main().catch((e) => {
  console.error("❌", e instanceof Error ? e.message : e);
  process.exit(1);
});
