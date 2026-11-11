import test from "node:test";
import assert from "node:assert/strict";
import { detectCheck } from "../src/lib/live/detect";

// The composer names the check from the text alone; these are the real jobs from the 10 Nov batch.
const cases: [string, string | null][] = [
  ["Before I deposit: who controls v2.ref-finance.near, can its code be changed, and by whom?", "due-diligence"],
  ["Due diligence on intents.near: admin roles, keys, published source and recent activity.", "due-diligence"],
  ["I'm on the council: what will proposal #1059 on ref-finance.sputnik-dao.near actually do?", "proposal-review"],
  ["Check proposal #1058 on marketing.sputnik-dao.near: who gets paid?", "proposal-review"],
  ["My NEAR Intents transfer in transaction 6DhuhcBjTPqFPBRCaZKY3EUz9bjvyPdtXajqQWrGACjg failed. Why?", "tx-forensics"],
  ["My swap on Ref Finance failed in transaction CS1feCGzR95BdKme5AGRhQXxUYVzYi4ZkRSTg4BZXSCr from tinykoala595.near.", "tx-forensics"],
  ["Review https://github.com/near-examples/donation-examples/tree/main/contract-rs for NEAR-specific bugs", "contract-review"],
  ["Is this safe? #[near] impl Contract { pub fn withdraw(&mut self) {} }", "contract-review"],
  ["Write me a poem about the moon", null],
];

for (const [text, skill] of cases) {
  test(`detects ${skill ?? "nothing"}: ${text.slice(0, 50)}…`, () => {
    assert.equal(detectCheck(text)?.skill ?? null, skill);
  });
}

test("names the target it found", () => {
  assert.equal(detectCheck(cases[0][0])?.target, "v2.ref-finance.near");
  assert.equal(detectCheck(cases[2][0])?.target, "proposal #1059 on ref-finance.sputnik-dao.near");
  assert.equal(detectCheck(cases[6][0])?.target, "github.com/near-examples/donation-examples/contract-rs");
});
