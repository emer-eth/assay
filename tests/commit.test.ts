import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { bidCommitment, newSalt } from "../src/lib/live/commit-server";
import { commitmentText } from "../src/lib/live/commit";
import { privacyOf } from "../src/lib/models";

test("a bid commitment is sha256 of round:agent:ask:salt, with the ask at 4 decimals", () => {
  assert.equal(commitmentText("r1", "a.testnet", 0.01, "ab"), "r1:a.testnet:0.0100:ab");
  const c = bidCommitment("r1", "a.testnet", 0.01, "ab");
  assert.equal(c, createHash("sha256").update("r1:a.testnet:0.0100:ab").digest("hex"));
  assert.notEqual(c, bidCommitment("r1", "a.testnet", 0.0101, "ab")); // a changed ask no longer matches
  assert.equal(newSalt().length, 32);
});

test("agent models are labelled by who runs them", () => {
  assert.equal(privacyOf("Qwen/Qwen3.8-27B"), "private");
  assert.equal(privacyOf("openai/gpt-5.4-mini"), "third-party");
  assert.equal(privacyOf("deepseek/deepseek-v3.2"), "attested");
  assert.equal(privacyOf(undefined), "private"); // the default agent model, Qwen 3.6 35B
});
