import test from "node:test";
import assert from "node:assert/strict";
import { overLimit } from "../src/lib/rate-limit";

test("a key is allowed up to its limit in the window, then told how long to wait", () => {
  const t0 = 1_000_000;
  for (let i = 0; i < 3; i++) assert.equal(overLimit("k1", 3, 60_000, t0 + i * 1000), 0);
  assert.equal(overLimit("k1", 3, 60_000, t0 + 5000), 55); // the first hit leaves the window in 55 s
  assert.equal(overLimit("k1", 3, 60_000, t0 + 60_001), 0); // and then there's room again
});

test("limits are per key", () => {
  assert.equal(overLimit("a", 1, 60_000, 0), 0);
  assert.equal(overLimit("b", 1, 60_000, 0), 0);
  assert.ok(overLimit("a", 1, 60_000, 1) > 0);
});
