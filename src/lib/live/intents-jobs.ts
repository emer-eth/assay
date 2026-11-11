import "server-only";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { coordinator, coordinatorKeyPair, provider } from "../near";
import type { jobInput } from "./actions";
import { createRound } from "./coordinator";
import { base58, executeIntents, hasIntentsKey, INTENTS_ID, intentsBalance, signIntent, simulateIntents, WNEAR_TOKEN, WRAP_ID, type Intent, type SignedIntent } from "./intents-verifier";
import { yoctoOf } from "./pay-assets";
import { load, update, updateRound } from "./store";
import { targetProblem } from "./tools";

// Paying for a job with NEAR Intents, by signing an intent. The payer's NEAR sits in their own balance on the
// verifier contract; they sign one NEP-413 message, "transfer <budget> wNEAR to the coordinator", and the
// coordinator submits it with execute_intents (and pays the gas). Settlement and refunds are intents the
// coordinator signs: the winner is paid in NEAR (native_withdraw), the rest goes back to the payer's balance,
// where they can spend it on the next job or withdraw it to their wallet with one more signed intent.

type Fail = { ok: false; status: number; error: string };
const coord = () => coordinator().accountId;

/** What the payer's wallet has to do before signing: top up its verifier balance, register its key. */
export type IntentsPrep = {
  jobId: string;
  /** The NEP-413 message to sign (recipient is the verifier). */
  sign: { message: string; nonce: string; recipient: string };
  verifier: string;
  wrap: string;
  /** yocto to deposit first (null: the balance already covers the budget). */
  deposit: string | null;
  wrapRegistered: boolean;
  /** false: the key the wallet signed in with isn't registered with the verifier yet; null: unknown. */
  keyRegistered: boolean | null;
  /** The key to register (add_public_key) in the same approval as the deposit, when it isn't yet. */
  registerKey: string | null;
  balance: string;
};

export async function prepareIntentsJob(account: string, publicKey: string | null, job: z.infer<typeof jobInput>): Promise<({ ok: true } & IntentsPrep) | Fail> {
  const problem = await targetProblem(job); // before any money moves: the job must name a real target
  if (problem) return { ok: false, status: 400, error: problem };
  const jobId = `sfh-n-${randomUUID().slice(0, 13)}`;
  const budget = BigInt(yoctoOf(job.budget));
  const intents: Intent[] = [{ intent: "transfer", receiver_id: coord(), tokens: { [WNEAR_TOKEN]: budget.toString() }, memo: `Assay job ${jobId}` }];
  // The deadline gives the payer time to approve a deposit and sign.
  const deadline = new Date(Date.now() + 20 * 60_000).toISOString();
  const message = JSON.stringify({ signer_id: account, deadline, intents });
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
  const [balance, wrapReg, keyReg] = await Promise.all([
    intentsBalance(account).catch(() => 0n),
    provider().callFunction({ contractId: WRAP_ID, method: "storage_balance_of", args: { account_id: account } }).catch(() => null),
    publicKey ? hasIntentsKey(account, publicKey).catch(() => null) : Promise.resolve(null),
  ]);
  update((s) => {
    for (const [k, d] of Object.entries(s.drafts)) if (d.expires < Date.now()) delete s.drafts[k];
    s.drafts[jobId] = { account, job, expires: Date.now() + 20 * 60_000, intent: { message, nonce } };
  });
  return {
    ok: true,
    jobId,
    sign: { message, nonce, recipient: INTENTS_ID },
    verifier: INTENTS_ID,
    wrap: WRAP_ID,
    deposit: balance >= budget ? null : (budget - balance).toString(),
    wrapRegistered: !!wrapReg,
    keyRegistered: keyReg,
    registerKey: keyReg === false ? publicKey : null,
    balance: balance.toString(),
  };
}

/** Readable reason from a failed simulate/execute (the contract's panic message). */
function reason(e: unknown) {
  const m = e instanceof Error ? e.message : String(e);
  if (/insufficient balance|BalanceOverflow|Insufficient/i.test(m)) return "Your NEAR Intents balance doesn't cover the budget yet. If you just deposited, wait a few seconds and try again.";
  if (/public key .* doesn't exist|PublicKeyNotExist/i.test(m)) return "Your wallet's key isn't registered with NEAR Intents yet.";
  if (/deadline|expired/i.test(m)) return "The signed intent expired. Start again from the form.";
  if (/nonce/i.test(m)) return "That signed intent was already used.";
  return `The NEAR Intents contract refused it: ${m.slice(0, 200)}`;
}

/** Checks the payer's signature and balance, executes the transfer, and creates the round. */
export async function submitIntentsJob(account: string, jobId: string, publicKey: string, signature: string): Promise<{ ok: true; id: string; tx: string } | ({ ok: false; needKey?: string } & Fail)> {
  const draft = load().drafts[jobId];
  if (!draft || draft.account !== account || !draft.intent) return { ok: false, status: 404, error: "Unknown job id. Start again from the form." };
  if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,50}$/.test(publicKey)) return { ok: false, status: 400, error: "The wallet returned an unexpected key." };
  // Wallets return the signature as base64 or base58; the verifier wants "ed25519:<base58>".
  const sig = signature.startsWith("ed25519:") ? signature : `ed25519:${base58(Buffer.from(signature, "base64"))}`;
  const signed: SignedIntent = { standard: "nep413", payload: { message: draft.intent.message, nonce: draft.intent.nonce, recipient: INTENTS_ID }, public_key: publicKey, signature: sig };
  if (!(await hasIntentsKey(account, publicKey).catch(() => false))) return { ok: false, status: 409, error: "Register your key with NEAR Intents first.", needKey: publicKey };
  try {
    await simulateIntents([signed]);
  } catch (e) {
    return { ok: false, status: 402, error: reason(e) };
  }
  // Claim the draft once, so a double click can't create two rounds (the verifier would refuse the reused nonce anyway).
  const claimed = update((s) => (s.drafts[jobId] ? (delete s.drafts[jobId], true) : false));
  if (!claimed) return { ok: false, status: 409, error: "This job was already posted." };
  let tx: string;
  try {
    tx = await executeIntents([signed]);
  } catch (e) {
    return { ok: false, status: 402, error: reason(e) };
  }
  const round = createRound(draft.job, account, { via: "intents", jobId, tx });
  return { ok: true, id: round.id, tx };
}

/** Settles an Intents-paid round in one signed intent: the winner's pay in NEAR, the rest back to the payer's balance. */
export async function settleThroughIntents(roundId: string, winner: string | null, toAgent: number, refund: number, why: string) {
  const r = load().rounds.find((x) => x.id === roundId);
  if (!r || r.txs.some((t) => t.label.startsWith("NEAR Intents settlement"))) return; // never settle twice
  const intents: Intent[] = [];
  if (winner && toAgent > 0) intents.push({ intent: "native_withdraw", receiver_id: winner, amount: yoctoOf(toAgent) });
  if (refund > 0) intents.push({ intent: "transfer", receiver_id: r.job.poster, tokens: { [WNEAR_TOKEN]: yoctoOf(refund) }, memo: `Assay refund, round ${r.id} (${why})` });
  if (!intents.length) return;
  const tx = await executeIntents([signIntent(coord(), coordinatorKeyPair(), intents)]);
  const parts = [winner && toAgent > 0 ? `${toAgent} NEAR to the winner` : "", refund > 0 ? `${refund} NEAR back to ${r.job.poster}'s NEAR Intents balance (${why})` : ""].filter(Boolean);
  updateRound(roundId, (x) => x.txs.push({ label: `NEAR Intents settlement, signed by the coordinator: ${parts.join(", ")}`, hash: tx }));
}

/** The payer's own NEAR Intents balance, and a withdrawal of it to their wallet (they sign; the coordinator submits). */
export async function prepareWithdraw(account: string) {
  const balance = await intentsBalance(account).catch(() => 0n);
  if (balance <= 0n) return { ok: false as const, status: 400, error: "Nothing to withdraw." };
  const message = JSON.stringify({ signer_id: account, deadline: new Date(Date.now() + 10 * 60_000).toISOString(), intents: [{ intent: "native_withdraw", receiver_id: account, amount: balance.toString() }] });
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
  return { ok: true as const, balance: balance.toString(), sign: { message, nonce, recipient: INTENTS_ID } };
}

export async function submitWithdraw(account: string, sign: { message: string; nonce: string }, publicKey: string, signature: string) {
  // Only a withdrawal of the signer's own balance to the signer's own account is relayed.
  let parsed: { signer_id?: string; intents?: { intent: string; receiver_id: string }[] };
  try {
    parsed = JSON.parse(sign.message);
  } catch {
    return { ok: false as const, status: 400, error: "Bad message." };
  }
  if (parsed.signer_id !== account || !parsed.intents?.every((i) => i.intent === "native_withdraw" && i.receiver_id === account)) return { ok: false as const, status: 400, error: "Only a withdrawal to your own wallet can be sent here." };
  const sig = signature.startsWith("ed25519:") ? signature : `ed25519:${base58(Buffer.from(signature, "base64"))}`;
  const signed: SignedIntent = { standard: "nep413", payload: { message: sign.message, nonce: sign.nonce, recipient: INTENTS_ID }, public_key: publicKey, signature: sig };
  try {
    await simulateIntents([signed]);
    return { ok: true as const, tx: await executeIntents([signed]) };
  } catch (e) {
    return { ok: false as const, status: 402, error: reason(e) };
  }
}

