import "server-only";
import { nearToYocto } from "near-api-js";
import { provider } from "../near";
import { load, update } from "./store";

// Escrow deposits: the user's wallet sends NEAR to the coordinator, and the server checks the
// transaction on chain before anything starts. A deposit can be used once.

export type DepositCheck = { ok: true; from: string; amountYocto: bigint } | { ok: false; error: string };

type ActionView = Record<string, unknown> | string;

/** Pure part: does this transaction (as the RPC returns it) prove `from` paid `amountNear` to `to`? */
export function checkTransfer(tx: { transaction: { signer_id: string; receiver_id: string; actions: ActionView[] }; status: unknown }, from: string, to: string, amountNear: number): DepositCheck {
  const t = tx.transaction;
  if (t.signer_id !== from) return { ok: false, error: "That payment was sent from a different account than the one you're signed in with." };
  if (t.receiver_id !== to) return { ok: false, error: "That payment didn't go to the escrow account." };
  const transfers = t.actions.filter((a): a is { Transfer: { deposit: string } } => typeof a === "object" && a !== null && "Transfer" in a);
  if (transfers.length !== 1 || t.actions.length !== 1) return { ok: false, error: "That transaction isn't a single NEAR transfer." };
  const want = nearToYocto(Number(amountNear.toFixed(6)));
  if (BigInt(transfers[0].Transfer.deposit) !== want) return { ok: false, error: "The amount paid doesn't match the budget." };
  const status = tx.status as Record<string, unknown> | string;
  if (typeof status !== "object" || !status || !("SuccessValue" in status || "SuccessReceiptId" in status)) return { ok: false, error: "That payment didn't succeed on chain." };
  return { ok: true, from, amountYocto: want };
}

/** Looks the transaction up on chain, checks it, and marks it used so it can't fund anything twice. */
export async function claimDeposit(txHash: string, from: string, amountNear: number, purpose: string): Promise<DepositCheck> {
  const to = process.env.NEAR_ACCOUNT_ID!;
  if (!/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(txHash)) return { ok: false, error: "That doesn't look like a transaction hash." };
  if (load().deposits.some((d) => d.txHash === txHash)) return { ok: false, error: "That payment has already been used." };
  let tx;
  try {
    // The RPC waits for transactions it hasn't seen, so a made-up hash would hang: give up after 15 seconds.
    tx = await Promise.race([
      provider().viewTransactionStatus({ txHash, accountId: from, waitUntil: "FINAL" }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 15_000)),
    ]);
  } catch {
    return { ok: false, error: "Couldn't find that payment on chain yet. Wait a few seconds and try again." };
  }
  const check = checkTransfer(tx as never, from, to, amountNear);
  if (!check.ok) return check;
  // Claim atomically: re-check inside the write so two requests can't both use the same payment.
  const claimed = update((s) => {
    if (s.deposits.some((d) => d.txHash === txHash)) return false;
    s.deposits.push({ txHash, from, near: amountNear, purpose, at: new Date().toISOString() });
    return true;
  });
  return claimed ? check : { ok: false, error: "That payment has already been used." };
}
