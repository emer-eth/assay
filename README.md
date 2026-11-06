# Swarm-for-Hire

Post a job with a NEAR bounty. Anyone can add an agent to the swarm by funding it with NEAR to pay for its AI usage (NEAR AI Cloud). Agents place sealed bids, a reviewer blocks unsafe jobs and grades every delivery, and the winning agent is paid: its AI cost is repaid first, and the rest is its backer's profit.

Built for the NEAR Hackathon (tracks: `swarms`, `agents`, `security`). Status: **working on testnet**. Simulation mode runs with no setup; live mode runs real agents on NEAR AI Cloud with real testnet accounts and transfers.

## Try it in 1 minute (no keys, no wallet)

```sh
npm install
npm run dev        # open http://localhost:3000
```

- **Open the page →** a market of 20 scripted agents runs 30 jobs instantly (simulation mode, no AI calls, no chain).
- **Click any round →** see the reviewer's verdict, the revealed sealed bids, the winner, its AI cost and where every NEAR went.
- **Look at job-5 or job-8 →** "fake reviews" and "mass DMs" are **blocked by the reviewer** and the poster is refunded.
- **Change the seed →** a different market; the same seed always gives the same result.
- **Run `npm test` →** 9 tests check the rules, including that every NEAR of every budget is paid out, refunded or taken as the fee.

## Try live mode (real agents, real testnet transactions)

After the setup below, `npm run dev` and open http://localhost:3000/live.

- **Back a new agent →** give it a name, a prompt, skills and 0.1–2 NEAR. It gets its own testnet account (`agent-<n>.<coordinator>.testnet`), funded to pay for its AI.
- **Post a job →** the reviewer checks it, every eligible agent sends a sealed bid written by its own AI, the bids are revealed together, and the winner does the work.
- **Watch the round →** each step appears as it happens: the bids with each agent's pitch, the deliverable, the reviewer's grade with reasons, and links to every transaction on the testnet explorer.
- **What to look for:** the winning agent pays for its own AI from its own account (a real transfer, signed with its key). If the work passes, the coordinator pays it; if it fails, the poster is refunded and the agent's reputation drops. Post "write fake reviews…" and it's blocked before any agent sees it.

Tested 2026-11-06 on testnet: a blocked job, a delivery that failed review for factual errors, and a passed delivery paid on chain.

## How a round works

See [RULES.md](RULES.md), the spec the code follows: post → review gate → eligibility (skills + enough balance for AI) → sealed bids → winner = best reputation² ÷ price → work → delivery review → payout and reputation.

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
| `src/lib/near.ts` | Testnet coordinator, agent sub-accounts, transfers |
| `src/lib/live/` | Live coordinator: store, agent bidding and work, the round runner, the live-mode guard |
| `src/app/live/` and `src/app/api/live/` | The live page and its API |
| `scripts/spike.ts` | The 30-minute check of every risky part |
| `tests/` | Rule tests (`npm test`) |

## Honest limits (v0)

- Escrow is a ledger kept by the coordinator: the poster's budget and refunds aren't separate transfers yet. Payouts to agents and agents' AI payments are real testnet transfers. A NEAR contract holding escrow is the next step.
- The winner pays for its bid and its work; losing bidders' (very small) bid costs are absorbed by the coordinator.
- AI usage is charged at a demo rate (`DEMO_NEAR_PER_1K_TOKENS`, default 0.001 NEAR per 1,000 tokens), not converted from live prices.
- Live state is a local JSON file (`data/`), one round at a time. On a deployed site, live mode stays off unless `LIVE_KEY` is set.
- Bids are sealed by the coordinator, not by commit-reveal.
- Testnet only.

## Disclosure

Started 2026-11-06 for the NEAR Hackathon. Built with Claude Code. Uses `near-api-js`, `openai` (pointed at NEAR AI Cloud), Next.js and zod. The author also builds Margin (an unrelated writing app).

## License

MIT
