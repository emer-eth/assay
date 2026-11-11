// Paying for a job with NEAR Intents (1Click, mainnet only): the tokens offered, how to check the payer's refund
// address for each chain, the exact 1Click requests, and how to read a swap's status as "paid" or not.
// Pure (no network, no keys), so the tests can run on fixed inputs. intents-pay.ts does the I/O.

export const WNEAR = "nep141:wrap.near";

const EVM = /^0x[0-9a-fA-F]{40}$/;
const SOLANA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BITCOIN = /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/;
const NEAR_ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)+near$|^[0-9a-f]{64}$/;

export type PayAsset = { key: string; label: string; symbol: string; chain: string; assetId: string; address: RegExp; addressHint: string };

/** What a payer can pay with: the common tokens on the chains 1Click serves (asset ids from 1click.chaindefuser.com/v0/tokens, 11 Nov 2026). */
export const PAY_ASSETS: PayAsset[] = [
  { key: "usdc-base", label: "USDC on Base", symbol: "USDC", chain: "Base", assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", address: EVM, addressHint: "0x… address on Base" },
  { key: "usdc-arb", label: "USDC on Arbitrum", symbol: "USDC", chain: "Arbitrum", assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", address: EVM, addressHint: "0x… address on Arbitrum" },
  { key: "usdc-eth", label: "USDC on Ethereum", symbol: "USDC", chain: "Ethereum", assetId: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", address: EVM, addressHint: "0x… address on Ethereum" },
  { key: "usdc-sol", label: "USDC on Solana", symbol: "USDC", chain: "Solana", assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", address: SOLANA, addressHint: "Solana address" },
  { key: "usdt-eth", label: "USDT on Ethereum", symbol: "USDT", chain: "Ethereum", assetId: "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near", address: EVM, addressHint: "0x… address on Ethereum" },
  { key: "eth-base", label: "ETH on Base", symbol: "ETH", chain: "Base", assetId: "nep141:base.omft.near", address: EVM, addressHint: "0x… address on Base" },
  { key: "eth-arb", label: "ETH on Arbitrum", symbol: "ETH", chain: "Arbitrum", assetId: "nep141:arb.omft.near", address: EVM, addressHint: "0x… address on Arbitrum" },
  { key: "eth-eth", label: "ETH on Ethereum", symbol: "ETH", chain: "Ethereum", assetId: "nep141:eth.omft.near", address: EVM, addressHint: "0x… address on Ethereum" },
  { key: "sol", label: "SOL", symbol: "SOL", chain: "Solana", assetId: "nep141:sol.omft.near", address: SOLANA, addressHint: "Solana address" },
  { key: "btc", label: "BTC", symbol: "BTC", chain: "Bitcoin", assetId: "nep141:btc.omft.near", address: BITCOIN, addressHint: "Bitcoin address (bc1…, 1… or 3…)" },
  { key: "usdc-near", label: "USDC on NEAR", symbol: "USDC", chain: "NEAR", assetId: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", address: NEAR_ACCOUNT, addressHint: "NEAR account (….near)" },
];

export const payAsset = (key: string) => PAY_ASSETS.find((a) => a.key === key) ?? null;

/** Is this a refund address the chosen token's chain can receive at? Returns a problem, or null. */
export function refundAddressProblem(asset: PayAsset, address: string): string | null {
  const a = address.trim();
  if (!a) return `Add the ${asset.addressHint} a refund should go to.`;
  if (!asset.address.test(a)) return `That doesn't look like a ${asset.addressHint}. A refund comes back in ${asset.label}, so it has to be an address on ${asset.chain}.`;
  return null;
}

/** NEAR as yoctoNEAR (10^24), without floating-point error. */
export function yoctoOf(near: number): string {
  const [whole, frac = ""] = near.toFixed(6).split(".");
  return (BigInt(whole) * 10n ** 24n + BigInt(frac.padEnd(24, "0"))).toString();
}

/**
 * The quote that pays for a job: the payer sends their token to a fresh deposit address, and exactly the budget
 * arrives as wNEAR at the coordinator, which unwraps it and posts the job into the escrow contract. If the swap
 * can't complete, 1Click refunds the payer at `refundTo` on their own chain.
 */
export function payInQuote(o: { asset: PayAsset; budget: number; refundTo: string; coordinator: string; now?: number }) {
  return {
    dry: false,
    swapType: "EXACT_OUTPUT",
    slippageTolerance: 100,
    originAsset: o.asset.assetId,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: WNEAR,
    amount: yoctoOf(o.budget),
    refundTo: o.refundTo.trim(),
    refundType: "ORIGIN_CHAIN",
    recipient: o.coordinator,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date((o.now ?? Date.now()) + 30 * 60_000).toISOString(),
    referral: "assay",
  };
}

/** The quote that sends a refund back: wNEAR from the coordinator, delivered to the payer in the token they paid with. */
export function refundQuote(o: { asset: PayAsset; yocto: string; recipient: string; coordinator: string; now?: number }) {
  return {
    dry: false,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: WNEAR,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: o.asset.assetId,
    amount: o.yocto,
    refundTo: o.coordinator,
    refundType: "ORIGIN_CHAIN",
    recipient: o.recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date((o.now ?? Date.now()) + 60 * 60_000).toISOString(),
    referral: "assay",
  };
}

type Status = {
  status?: string;
  quoteResponse?: { quoteRequest?: { recipient?: string; destinationAsset?: string; recipientType?: string } };
  swapDetails?: { amountOut?: string };
};

/**
 * Has this swap paid for the job? Only when 1Click says SUCCESS, for a swap to the coordinator in wNEAR on NEAR,
 * that delivered at least the budget. Anything else is still waiting, or failed (1Click refunds the payer itself).
 */
export function readPayIn(s: Status, want: { coordinator: string; yocto: string }): { state: "paid" } | { state: "waiting"; status: string } | { state: "failed"; why: string } {
  const status = s.status ?? "UNKNOWN";
  if (status === "REFUNDED") return { state: "failed", why: "the swap didn't complete, so 1Click refunded you" };
  if (status === "FAILED") return { state: "failed", why: "the swap failed; 1Click returns the deposit to your refund address" };
  if (status !== "SUCCESS") return { state: "waiting", status };
  const req = s.quoteResponse?.quoteRequest ?? {};
  if (req.recipient !== want.coordinator || req.destinationAsset !== WNEAR || (req.recipientType && req.recipientType !== "DESTINATION_CHAIN"))
    return { state: "failed", why: "the swap at that address doesn't pay Assay" };
  const out = s.swapDetails?.amountOut;
  if (!out || !/^\d+$/.test(out) || BigInt(out) < BigInt(want.yocto)) return { state: "failed", why: "less than the budget arrived" };
  return { state: "paid" };
}
