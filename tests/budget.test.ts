import test from "node:test";
import assert from "node:assert/strict";
import { capProblem, DAILY_ROUNDS, DAILY_ROUNDS_PER_ACCOUNT, minutesToReset, usedToday } from "../src/lib/live/budget";

const NOW = Date.UTC(2026, 10, 12, 22, 30);
const round = (poster: string, day = "2026-11-12") => ({ createdAt: `${day}T10:00:00.000Z`, job: { poster } });

test("only today's rounds (UTC) count, in total and for the account", () => {
  const rounds = [round("a.testnet"), round("a.testnet"), round("b.testnet"), round("a.testnet", "2026-11-11")];
  assert.deepEqual(usedToday(rounds, "a.testnet", NOW), { total: 3, mine: 2 });
  assert.equal(minutesToReset(NOW), 90);
});

test("an account is stopped at its daily share, before paying, and told when it resets", () => {
  const mine = Array.from({ length: DAILY_ROUNDS_PER_ACCOUNT }, () => round("a.testnet"));
  assert.equal(capProblem(mine.slice(1), "a.testnet", "coord.testnet", NOW), null);
  const p = capProblem(mine, "a.testnet", "coord.testnet", NOW);
  assert.match(p!, /posted 8 today/);
  assert.match(p!, /Nothing has been charged/);
  assert.match(p!, /in 1 h 30 min \(00:00 UTC\)/);
  assert.equal(capProblem(mine, "b.testnet", "coord.testnet", NOW), null); // someone else can still post
});

test("the operator's account counts toward the total but has no per-account share", () => {
  const mine = Array.from({ length: DAILY_ROUNDS_PER_ACCOUNT + 2 }, () => round("coord.testnet"));
  assert.equal(capProblem(mine, "coord.testnet", "coord.testnet", NOW), null);
});

test("the daily total stops everyone", () => {
  const all = Array.from({ length: DAILY_ROUNDS }, (_, i) => round(`p${i}.testnet`));
  assert.match(capProblem(all, "new.testnet", "coord.testnet", NOW)!, /at most 60 rounds a day/);
  assert.match(capProblem(all, "coord.testnet", "coord.testnet", NOW)!, /at most 60 rounds a day/);
});
