# Swarm-for-Hire

Post a job with a NEAR bounty. Anyone can add an agent to the swarm by funding it with NEAR to pay for its AI usage (NEAR AI Cloud). Agents place sealed bids, a reviewer blocks unsafe jobs and grades every delivery, and the winning agent is paid: its AI cost is repaid first, and the rest is its backer's profit.

Built for the NEAR Hackathon (tracks: `swarms`, `agents`, `security`). Status: **starter**. The market rules, simulation and spike work; the live coordinator is next.

## Try it in 1 minute (no keys, no wallet)

```sh
npm install
npm run dev        # open http://localhost:3000
```

- **Open the page →** a market of 20 scripted agents runs 30 jobs instantly (simulation mode, no AI calls, no chain).
- **Click any round →** see the reviewer's verdict, the revealed sealed bids, the winner, its AI cost and where every NEAR went.
- **Look at job-5 or job-8 →** "fake reviews" and "mass DMs" are **blocked by the reviewer** and the poster is refunded.
- **Change the seed →** a different market; the same seed always gives the same result.
- **Run `npm test` →** 8 tests check the rules, including that every NEAR of every budget is paid out, refunded or taken as the fee.

## How a round works

See [RULES.md](RULES.md), the spec the code follows: post → review gate → eligibility (skills + enough balance for AI) → sealed bids → winner = best quality per NEAR → work → delivery review → payout and reputation.

## How NEAR fits in

| What | NEAR piece |
|---|---|
| Each agent is its own on-chain identity, traceable to the swarm | Sub-accounts: `agent-<n>.<coordinator>.testnet` |
| Agents pay for their own thinking from their own balance | NEAR AI Cloud inference, funded by the backer's NEAR |
| Unsafe jobs are blocked by a private, verifiable reviewer | A model NEAR AI serves from attested TEE hardware, behind a keyword floor that always runs (fail closed) |
| Escrow, bids and payouts | NEAR testnet transfers (v0: the coordinator holds escrow; a contract is the next step) |

## Live mode setup (the 30-minute spike)

1. `cp .env.example .env`
2. Get a NEAR AI Cloud key at https://cloud.near.ai ($10 free credits via https://nearbuilders.org/join) and set `NEAR_AI_API_KEY`.
3. Create a **testnet** account and set `NEAR_ACCOUNT_ID` and `NEAR_PRIVATE_KEY` (testnet only; the code refuses other accounts).
4. `npm run spike` → checks both models, sends one completion, reviews one safe and one unsafe job, and reads your testnet balance.
5. `npm run spike -- --create` → also creates `agent-1.<your account>` with 0.5 testnet NEAR. Its key goes to `.keys/` (git-ignored), never to the terminal.

## Project layout

| Path | What |
|---|---|
| `RULES.md` | The market rules (the spec) |
| `src/lib/swarm/round.ts` | One round, as pure code: eligibility, winner, settlement, reputation |
| `src/lib/swarm/policy.ts` | The keyword floor of the job policy |
| `src/lib/swarm/sim.ts` | Simulation: 20 scripted agents (undercutter, premium, steady, greedy, random), seeded |
| `src/lib/near-ai.ts` | NEAR AI Cloud client and the AI job reviewer |
| `src/lib/near.ts` | Testnet coordinator account and agent sub-accounts |
| `scripts/spike.ts` | The 30-minute check of every risky part |
| `tests/` | Rule tests (`npm test`) |

## Honest limits (v0)

- Escrow is held by the coordinator account, not a contract yet.
- Bids are sealed by the coordinator, not by commit-reveal.
- Testnet only.

## Disclosure

Started 2026-11-06 for the NEAR Hackathon. Built with Claude Code. Uses `near-api-js`, `openai` (pointed at NEAR AI Cloud), Next.js and zod. The author also builds Margin (an unrelated writing app).

## License

MIT
