// NEAR Intents 1Click swaps: "why did my swap fail, and where is my money?", answered from the 1Click status
// endpoint (docs.near-intents.org/api-reference/oneclick/check-swap-execution-status). It takes the deposit
// address the user sent funds to and returns the swap's state, amounts, refund and the transactions on every
// chain. Read-only and keyless; the formatter is pure so the tests can run on a fixed response.

export const ONECLICK_STATUS = "https://1click.chaindefuser.com/v0/status";

/** What a deposit address can look like: EVM, a NEAR implicit account, or base58 (Solana and similar). */
const ADDRESS_RE = /\b0x[0-9a-fA-F]{40}\b|\b[0-9a-f]{64}\b|(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![1-9A-HJ-NP-Za-km-z])/g;

/** Strings in a job that could be a 1Click deposit address, most likely first (at most three). */
export function depositAddressCandidates(text: string): string[] {
  const all = [...new Set(text.replace(/https?:\/\/\S+/g, " ").match(ADDRESS_RE) ?? [])];
  // An explicit "deposit address" mention ranks first; EVM addresses next (they can't be NEAR tx hashes).
  const near = (s: string) => new RegExp(`deposit(?:\\s+address)?\\W{0,3}${s}`, "i").test(text);
  return all.sort((a, b) => Number(near(b)) - Number(near(a)) || Number(b.startsWith("0x")) - Number(a.startsWith("0x"))).slice(0, 3);
}

export type SwapStatus = {
  status?: string;
  updatedAt?: string;
  quoteResponse?: {
    quoteRequest?: { originAsset?: string; destinationAsset?: string; recipient?: string; refundTo?: string; swapType?: string; amount?: string; deadline?: string };
    quote?: { depositAddress?: string; amountInFormatted?: string; amountOutFormatted?: string; deadline?: string };
  };
  swapDetails?: {
    amountInFormatted?: string;
    amountOutFormatted?: string;
    refundedAmountFormatted?: string;
    refundedAmount?: string;
    refundReason?: string;
    nearTxHashes?: string[];
    intentHashes?: string[];
    originChainTxHashes?: { hash: string; explorerUrl?: string }[];
    destinationChainTxHashes?: { hash: string; explorerUrl?: string }[];
  };
};

/** What each status means, so the agent explains it rather than repeats it. */
const MEANING: Record<string, string> = {
  PENDING_DEPOSIT: "no deposit has arrived at the address yet",
  KNOWN_DEPOSIT_TX: "the deposit transaction is known and waiting to be confirmed",
  INCOMPLETE_DEPOSIT: "less than the quoted amount arrived; the swap waits for the rest or refunds",
  PROCESSING: "the deposit arrived and the swap is being executed",
  SUCCESS: "the swap finished and the output was delivered to the recipient",
  REFUNDED: "the swap did not complete and the deposit was sent back to the refund address",
  FAILED: "the swap failed",
};

/** "nep141:eth-0x….omft.near" -> a shorter readable asset id. */
const asset = (id?: string) => (id ? id.replace(/^nep141:/, "") : "?");

/** A 1Click swap, ready to show. Public: anyone with the deposit address can read it from 1Click. */
export type SwapView = { address: string; status: string; meaning: string; requested: string; refunded: string | null; reason: string | null };

export function viewSwap(address: string, s: SwapStatus): SwapView {
  const req = s.quoteResponse?.quoteRequest ?? {};
  const quote = s.quoteResponse?.quote ?? {};
  const d = s.swapDetails ?? {};
  const status = s.status ?? "UNKNOWN";
  return {
    address,
    status,
    meaning: MEANING[status] ?? "",
    requested: `${quote.amountInFormatted ?? "?"} ${asset(req.originAsset)} for ${quote.amountOutFormatted ?? "?"} ${asset(req.destinationAsset)}`,
    refunded: d.refundedAmountFormatted ?? (d.refundedAmount && d.refundedAmount !== "0" ? d.refundedAmount : null),
    reason: d.refundReason ?? null,
  };
}

export function swapEvidence(address: string, s: SwapStatus): { facts: string; summary: string } {
  const req = s.quoteResponse?.quoteRequest ?? {};
  const quote = s.quoteResponse?.quote ?? {};
  const d = s.swapDetails ?? {};
  const status = s.status ?? "UNKNOWN";
  const lines = [
    `1CLICK SWAP (NEAR Intents) for deposit address ${address}, read from ${ONECLICK_STATUS}`,
    `- Status: ${status}${MEANING[status] ? ` (${MEANING[status]})` : ""}${s.updatedAt ? `, last updated ${s.updatedAt.replace("T", " ").slice(0, 19)} UTC` : ""}`,
    `- Requested: swap ${quote.amountInFormatted ?? "?"} of ${asset(req.originAsset)} for ${quote.amountOutFormatted ?? "?"} of ${asset(req.destinationAsset)} (${req.swapType ?? "?"} quote), to recipient ${req.recipient ?? "?"}; refunds go to ${req.refundTo ?? "?"}${quote.deadline ?? req.deadline ? `; quote deadline ${String(quote.deadline ?? req.deadline).replace("T", " ").slice(0, 19)} UTC` : ""}`,
  ];
  if (d.amountInFormatted || d.amountOutFormatted) lines.push(`- Settled: ${d.amountInFormatted ?? "?"} in, ${d.amountOutFormatted ?? "?"} out`);
  if (d.refundedAmountFormatted || (d.refundedAmount && d.refundedAmount !== "0")) {
    lines.push(`- Refunded: ${d.refundedAmountFormatted ?? d.refundedAmount} of ${asset(req.originAsset)} to ${req.refundTo ?? "the refund address"}${d.refundReason ? `. Reason given: ${d.refundReason}` : ""}`);
  } else if (d.refundReason) lines.push(`- Refund reason given: ${d.refundReason}`);
  const hashes = (label: string, xs?: { hash: string; explorerUrl?: string }[]) => {
    if (xs?.length) lines.push(`- ${label}: ${xs.map((x) => x.explorerUrl ?? x.hash).join(", ")}`);
  };
  hashes("Origin chain transactions (the deposit)", d.originChainTxHashes);
  if (d.nearTxHashes?.length) lines.push(`- NEAR transactions: ${d.nearTxHashes.join(", ")}`);
  hashes("Destination chain transactions (the delivery)", d.destinationChainTxHashes);
  lines.push("- Amounts are as 1Click reports them. A refund goes to the refund address, not necessarily to the account that sent the deposit.");
  return { facts: lines.join("\n"), summary: `1Click swap at ${address.slice(0, 10)}…: ${status}${d.refundReason ? ` (${d.refundReason.slice(0, 60)})` : ""}` };
}

/** Looks the address up; null when 1Click doesn't know it (404) or can't be reached. */
export async function fetchSwapStatus(address: string, fetcher: typeof fetch = fetch): Promise<SwapStatus | null> {
  try {
    const res = await fetcher(`${ONECLICK_STATUS}?depositAddress=${encodeURIComponent(address)}`, { signal: AbortSignal.timeout(10_000), headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const body = (await res.json()) as SwapStatus;
    return body && typeof body.status === "string" ? body : null;
  } catch {
    return null;
  }
}
