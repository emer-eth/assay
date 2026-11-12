// The daily cap. Jobs are paid in free test NEAR, but every round costs real NEAR AI credits (the reviewer, every
// bidding agent, the work, the second check). Without a cap, anyone with a few faucet accounts could run rounds
// until the credits are gone, and then every job would fail closed. Checked before any money moves.
// Pure (no I/O), so it is tested on fixed inputs.

export const DAILY_ROUNDS = Number(process.env.DAILY_ROUNDS || 60);
export const DAILY_ROUNDS_PER_ACCOUNT = Number(process.env.DAILY_ROUNDS_PER_ACCOUNT || 8);

const dayOf = (iso: string | number) => new Date(iso).toISOString().slice(0, 10);

/** Rounds posted today (UTC), in total and by this account. */
export function usedToday(rounds: { createdAt: string; job: { poster: string } }[], account: string | null, now = Date.now()) {
  const today = dayOf(now);
  const todays = rounds.filter((r) => dayOf(r.createdAt) === today);
  return { total: todays.length, mine: account ? todays.filter((r) => r.job.poster === account).length : 0 };
}

/** Minutes until the cap resets at 00:00 UTC. */
export function minutesToReset(now = Date.now()) {
  const d = new Date(now);
  return Math.ceil((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now) / 60_000);
}

/**
 * Why this account can't post another job today, or null. The coordinator (the operator's own account) only counts
 * toward the total. The message says when it resets, because a cap that just says "no" looks like a broken app.
 */
export function capProblem(rounds: { createdAt: string; job: { poster: string } }[], account: string | null, coordinator: string | null, now = Date.now()): string | null {
  const used = usedToday(rounds, account, now);
  const m = minutesToReset(now);
  const when = `in ${m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} minutes`} (00:00 UTC)`;
  if (used.total >= DAILY_ROUNDS) return `Assay runs at most ${DAILY_ROUNDS} rounds a day while it's on testnet, because each one uses paid AI. Today's are used up; it resets ${when}. Nothing has been charged. Meanwhile, every past round is on the ledger.`;
  if (account && account !== coordinator && used.mine >= DAILY_ROUNDS_PER_ACCOUNT) return `Each account can post ${DAILY_ROUNDS_PER_ACCOUNT} job${DAILY_ROUNDS_PER_ACCOUNT === 1 ? "" : "s"} a day while Assay is on testnet, because each one uses paid AI. You've posted ${used.mine} today; it resets ${when}. Nothing has been charged.`;
  return null;
}
