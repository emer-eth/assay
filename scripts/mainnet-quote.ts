// Proves the mainnet payment path without moving money: asks NEAR Intents' 1Click API for a real mainnet quote to
// pay a job in each of a few tokens, with dry: true (a dry quote returns the price but no deposit address, so nothing
// can be sent). It is the exact request Assay mainnet makes (payInQuote in pay-assets.ts), only dry.
// Run: npm run quote:mainnet   (reads ONECLICK_API_KEY and NEAR_ACCOUNT_ID from .env.mainnet; writes docs/mainnet-quote.md)
import { writeFileSync } from "node:fs";
import { payAsset, payInQuote, type PayAsset } from "../src/lib/live/pay-assets";

const BUDGET = 0.3;
const coordinator = process.env.NEAR_ACCOUNT_ID ?? "";
if (!coordinator.endsWith(".near")) throw new Error("NEAR_ACCOUNT_ID in .env.mainnet must be a mainnet account");
// A refund address of the right kind for each chain. Dry quotes never send anything, so these are only checked for format.
const CASES: [string, string][] = [["usdc-near", coordinator], ["usdc-base", "0x5a0b54d5dc17e0aadc383d2db43b0a0d3e029c4c"], ["sol", "So11111111111111111111111111111111111111112"]];

async function quote(asset: PayAsset, refundTo: string) {
  const body = { ...payInQuote({ asset, budget: BUDGET, refundTo, coordinator }), dry: true };
  const res = await fetch("https://1click.chaindefuser.com/v0/quote", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...(process.env.ONECLICK_API_KEY ? { "x-api-key": process.env.ONECLICK_API_KEY } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as { quote?: { amountInFormatted?: string; amountOutFormatted?: string; timeEstimate?: number; depositAddress?: string }; message?: string };
  return { status: res.status, data };
}

async function main() {
const rows: string[] = [];
for (const [key, refundTo] of CASES) {
  const asset = payAsset(key)!;
  const { status, data } = await quote(asset, refundTo);
  const q = data.quote;
  const line = status >= 200 && status < 300 && q ? `| ${asset.label} | ${q.amountInFormatted} ${asset.symbol} | ${q.amountOutFormatted} wNEAR | ${q.timeEstimate ?? "?"} s | ${q.depositAddress ? "yes (unexpected)" : "none (dry)"} |` : `| ${asset.label} | 1Click answered ${status}: ${data.message ?? "?"} | | | |`;
  rows.push(line);
  console.log(line);
}
const date = new Date().toISOString().slice(0, 16).replace("T", " ");
writeFileSync(
  "docs/mainnet-quote.md",
  [
    "# Mainnet payment path, checked without money",
    "",
    `On ${date} UTC, \`npm run quote:mainnet\` (\`scripts/mainnet-quote.ts\`) asked NEAR Intents' 1Click API on **mainnet** to price paying a ${BUDGET} NEAR Assay job in three tokens, using Assay's own request (\`payInQuote\` in \`src/lib/live/pay-assets.ts\`) with \`dry: true\`. A dry quote returns the price but no deposit address, so nothing can be sent. The recipient is the mainnet coordinator account configured for Assay mainnet.`,
    "",
    "| Pay with | You'd send | Arrives as | Estimated time | Deposit address |",
    "|---|---|---|---|---|",
    ...rows,
    "",
    "What this shows: the mainnet request is accepted by 1Click as written, with the partner key, for tokens on three chains. What it doesn't show: a real swap settling into Assay on mainnet. That needs a funded mainnet coordinator, which is why mainnet is \"coming soon\".",
    "",
  ].join("\n"),
);
}
main().catch((e) => {
  console.error("❌", e instanceof Error ? e.message : e);
  process.exit(1);
});
