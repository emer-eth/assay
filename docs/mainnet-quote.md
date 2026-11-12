# Mainnet payment path, checked without money

On 2026-11-12 07:41 UTC, `npm run quote:mainnet` (`scripts/mainnet-quote.ts`) asked NEAR Intents' 1Click API on **mainnet** to price paying a 0.3 NEAR Assay job in three tokens, using Assay's own request (`payInQuote` in `src/lib/live/pay-assets.ts`) with `dry: true`. A dry quote returns the price but no deposit address, so nothing can be sent. The recipient is the mainnet coordinator account configured for Assay mainnet.

| Pay with | You'd send | Arrives as | Estimated time | Deposit address |
|---|---|---|---|---|
| USDC on NEAR | 1.066152 USDC | 0.3 wNEAR | 22 s | none (dry) |
| USDC on Base | 1.066152 USDC | 0.3 wNEAR | 37 s | none (dry) |
| SOL | 0.012892414 SOL | 0.3 wNEAR | 22 s | none (dry) |

What this shows: the mainnet request is accepted by 1Click as written, with the partner key, for tokens on three chains. What it doesn't show: a real swap settling into Assay on mainnet. That needs a funded mainnet coordinator, which is why mainnet is "coming soon".
