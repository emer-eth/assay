import "server-only";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { wrapNear, sendWnear } from "../near";
import { IS_MAINNET } from "../network";
import type { jobInput } from "./actions";
import { createRound, enqueueRound } from "./coordinator";
import { payAsset, payInQuote, readPayIn, refundAddressProblem, refundQuote, yoctoOf } from "./pay-assets";
import { load, update, updateRound, type IntentPayment } from "./store";
import { targetProblem } from "./tools";

// Paying for a job with NEAR Intents (mainnet only). The payer picks a token on any chain 1Click serves and gets a
// fresh deposit address. Once 1Click delivers exactly the budget as wNEAR to the coordinator, the coordinator
// unwraps it and posts the job into the same escrow contract a wallet payment uses, so the round runs and settles
// exactly like every other one. Refunds go back the same way: wNEAR into 1Click, out to the payer's own address in
// the token they paid with. pay-assets.ts holds the pure parts (requests and status reading) and their tests.

const ONECLICK = "https://1click.chaindefuser.com";
type Fail = { ok: false; status: number; error: string };

function oneclickHeaders() {
  const key = process.env.ONECLICK_API_KEY;
  return { "content-type": "application/json", accept: "application/json", ...(key ? { "x-api-key": key } : {}) };
}

async function oneclick<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${ONECLICK}${path}`, {
    method: body ? "POST" : "GET",
    headers: oneclickHeaders(),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(data.message && data.message !== "Internal server error" ? data.message : `1Click answered ${res.status}${process.env.ONECLICK_API_KEY ? "" : " (no ONECLICK_API_KEY is set: 1Click needs a partner key for quotes)"}`);
  return data;
}

const coordinatorId = () => process.env.NEAR_ACCOUNT_ID ?? "";

/** What the payer's page shows. The payment id is in the URL the payer holds; nothing here is secret beyond it. */
export function paymentView(p: IntentPayment) {
  return {
    id: p.id,
    status: p.status,
    asset: p.assetLabel,
    depositAddress: p.depositAddress,
    depositMemo: p.depositMemo ?? null,
    amountIn: p.amountInFormatted,
    deadline: p.deadline,
    budget: p.job.budget,
    description: p.job.description,
    refundTo: p.refundTo,
    roundId: p.roundId ?? null,
    note: p.note ?? null,
    swapStatus: p.swapStatus ?? null,
  };
}
export type PaymentView = ReturnType<typeof paymentView>;

/** Step 1: check the job and the refund address, get a 1Click quote, and keep the payment. */
export async function startPayIn(job: z.infer<typeof jobInput>, assetKey: string, refundTo: string): Promise<{ ok: true; payment: PaymentView } | Fail> {
  if (!IS_MAINNET) return { ok: false, status: 400, error: "Paying with NEAR Intents works on Assay mainnet only: NEAR Intents runs on mainnet." };
  const asset = payAsset(assetKey);
  if (!asset) return { ok: false, status: 400, error: "Pick a token to pay with." };
  const bad = refundAddressProblem(asset, refundTo);
  if (bad) return { ok: false, status: 400, error: bad };
  const problem = await targetProblem(job); // before any money moves, the job must name a real target
  if (problem) return { ok: false, status: 400, error: problem };
  let quote;
  try {
    quote = await oneclick<{ quote: { depositAddress?: string; depositMemo?: string; amountInFormatted: string; deadline?: string } }>(
      "/v0/quote",
      payInQuote({ asset, budget: job.budget, refundTo, coordinator: coordinatorId() }),
    );
  } catch (e) {
    return { ok: false, status: 502, error: `Couldn't get a NEAR Intents quote: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!quote.quote.depositAddress) return { ok: false, status: 502, error: "1Click didn't return a deposit address. Try again." };
  const p: IntentPayment = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    deadline: quote.quote.deadline ?? new Date(Date.now() + 30 * 60_000).toISOString(),
    asset: asset.key,
    assetLabel: asset.label,
    refundTo: refundTo.trim(),
    depositAddress: quote.quote.depositAddress,
    depositMemo: quote.quote.depositMemo,
    amountInFormatted: quote.quote.amountInFormatted,
    job,
    status: "waiting",
  };
  update((s) => {
    s.intentPayments.unshift(p);
    s.intentPayments = s.intentPayments.slice(0, 500);
  });
  startSweep();
  return { ok: true, payment: paymentView(p) };
}

/** Step 2, asked by the payer's page and by the sweep: has 1Click delivered? If so, the round starts. */
export async function checkPayIn(id: string): Promise<IntentPayment | null> {
  const p = load().intentPayments.find((x) => x.id === id);
  if (!p || p.status !== "waiting") return p ?? null;
  let s;
  try {
    s = await oneclick<Parameters<typeof readPayIn>[0]>(`/v0/status?depositAddress=${encodeURIComponent(p.depositAddress)}`);
  } catch {
    return p; // 1Click unreachable or doesn't know it yet: ask again later
  }
  const read = readPayIn(s, { coordinator: coordinatorId(), yocto: yoctoOf(p.job.budget) });
  const swapStatus = s.status ?? "UNKNOWN";
  if (swapStatus !== p.swapStatus) setPayment(id, { swapStatus });
  if (read.state === "waiting") {
    // Nothing sent and the quote is dead: stop watching. A deposit sent late is refunded by 1Click itself.
    if (read.status === "PENDING_DEPOSIT" && Date.now() > Date.parse(p.deadline) + 10 * 60_000) setPayment(id, { status: "expired", note: "No deposit arrived before the quote expired. Anything sent late is refunded by 1Click to your refund address." });
    return load().intentPayments.find((x) => x.id === id) ?? null;
  }
  if (read.state === "failed") {
    setPayment(id, { status: "failed", note: `Not paid: ${read.why}.` });
    return load().intentPayments.find((x) => x.id === id) ?? null;
  }
  // Paid. Claim it once, then create the round; the money moves into escrow when the round's turn comes.
  const claimed = update((st) => {
    const x = st.intentPayments.find((y) => y.id === id);
    if (!x || x.status !== "waiting") return false;
    x.status = "posting";
    return true;
  });
  if (claimed) postPaidJob(p);
  return load().intentPayments.find((x) => x.id === id) ?? null;
}

function setPayment(id: string, patch: Partial<IntentPayment>) {
  update((s) => {
    const x = s.intentPayments.find((y) => y.id === id);
    if (x) Object.assign(x, patch);
  });
}

function postPaidJob(p: IntentPayment) {
  const jobId = `sfh-i-${p.id.slice(0, 13)}`;
  const asset = payAsset(p.asset)!;
  const round = createRound(p.job, p.refundTo, { via: "intents", payment: p.id, jobId, assetLabel: asset.label });
  updateRound(round.id, { payer: { payment: p.id, asset: asset.key, assetLabel: asset.label, refundTo: p.refundTo, depositAddress: p.depositAddress } });
  setPayment(p.id, { status: "posted", roundId: round.id });
  // The round's first step (coordinator.ts) unwraps the wNEAR and deposits it into the escrow contract.
  void enqueueRound(round.id);
}

/**
 * Sends NEAR back to an Intents payer, in the token they paid with, to their refund address. The quote comes first,
 * so if 1Click won't take it (too small to cover the other chain's fees, say) nothing moves and the round says so.
 */
export async function refundThroughIntents(roundId: string, near: number, why: string) {
  const r = load().rounds.find((x) => x.id === roundId);
  const asset = r?.payer ? payAsset(r.payer.asset) : null;
  if (!r?.payer || !asset || near <= 0) return;
  const yocto = yoctoOf(near);
  let quote;
  try {
    quote = await oneclick<{ quote: { depositAddress?: string; amountOutFormatted?: string } }>("/v0/quote", refundQuote({ asset, yocto, recipient: r.payer.refundTo, coordinator: coordinatorId() }));
  } catch (e) {
    updateRound(roundId, {}, `Refund of ${near} NEAR (${why}) is held by the coordinator: 1Click wouldn't quote it back to ${asset.label} (${e instanceof Error ? e.message : String(e)}).`);
    return;
  }
  const to = quote.quote.depositAddress;
  if (!to) return void updateRound(roundId, {}, `Refund of ${near} NEAR (${why}) is held by the coordinator: 1Click returned no deposit address.`);
  const wrap = await wrapNear(BigInt(yocto));
  const send = await sendWnear(to, BigInt(yocto));
  await oneclick("/v0/deposit/submit", { txHash: send, depositAddress: to, nearSenderAccount: coordinatorId() }).catch(() => {}); // only speeds it up
  updateRound(roundId, (x) => {
    x.txs.push({ label: `Wrapped ${near} NEAR to send the refund through NEAR Intents`, hash: wrap });
    x.txs.push({ label: `Refund of ${near} NEAR (${why}) sent through NEAR Intents: about ${quote.quote.amountOutFormatted ?? "?"} ${asset.symbol} to ${r.payer!.refundTo} on ${asset.chain}`, hash: send });
    x.refundSwaps = [...(x.refundSwaps ?? []), { depositAddress: to, near, txHash: send, at: new Date().toISOString() }];
  });
}

// The payer may close the tab, so a sweep keeps checking open payments while the server runs.
const G = globalThis as unknown as { __assayPaySweep?: ReturnType<typeof setInterval> };
export function startSweep() {
  if (G.__assayPaySweep || !IS_MAINNET) return;
  G.__assayPaySweep = setInterval(() => {
    const open = load().intentPayments.filter((p) => p.status === "waiting");
    if (!open.length) return;
    for (const p of open) void checkPayIn(p.id).catch(() => {});
  }, 20_000);
  G.__assayPaySweep.unref?.();
}
