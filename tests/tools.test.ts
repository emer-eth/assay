import assert from "node:assert/strict";
import test from "node:test";
import { findAccounts, findProposal, findRepo, findTxHash, hasPastedCode, scanNear } from "../src/lib/live/tools";

test("finds the DAO and proposal number, in words or an Astro link", () => {
  assert.deepEqual(findProposal("What will proposal #1059 on ref-finance.sputnik-dao.near do?"), { dao: "ref-finance.sputnik-dao.near", id: 1059 });
  assert.deepEqual(findProposal("Review proposal 12 for mydao.sputnik-dao.near"), { dao: "mydao.sputnik-dao.near", id: 12 });
  assert.deepEqual(findProposal("https://app.astrodao.com/dao/ref-finance.sputnik-dao.near/proposals/ref-finance.sputnik-dao.near-1059"), { dao: "ref-finance.sputnik-dao.near", id: 1059 });
  assert.equal(findProposal("Check ref-finance.sputnik-dao.near"), null);
});

test("finds a transaction hash, bare or in a NearBlocks link, but not an account", () => {
  const h = "6DhuhcBjTPqFPBRCaZKY3EUz9bjvyPdtXajqQWrGACjg";
  assert.equal(findTxHash(`Why did ${h} fail?`), h);
  assert.equal(findTxHash(`https://nearblocks.io/txns/${h}`), h);
  assert.equal(findTxHash("5cdaee04aeec7abf076fd197411ffab6b08cf7aaefba14b57f6fc5fbececc3c8 sent it"), null);
  assert.equal(findTxHash("Why did my tx fail?"), null);
});

test("finds NEAR accounts in a job, ignoring URLs", () => {
  assert.deepEqual(findAccounts("Who controls v2.ref-finance.near? Also see https://app.ref.near.page and alice.testnet"), ["v2.ref-finance.near", "alice.testnet"]);
  assert.deepEqual(findAccounts("Review my contract"), []);
});

test("parses GitHub links, including a folder or a single file", () => {
  assert.deepEqual(findRepo("Review https://github.com/near/intents"), { owner: "near", repo: "intents", kind: undefined, ref: undefined, path: undefined });
  assert.deepEqual(findRepo("see github.com/a/b/tree/main/contract-rs/ please"), { owner: "a", repo: "b", kind: "tree", ref: "main", path: "contract-rs" });
  assert.equal(findRepo("https://github.com/a/b/blob/dev/src/lib.rs")?.path, "src/lib.rs");
  assert.ok(hasPastedCode("use near_sdk::near;\n#[near(contract_state)]"));
});

test("the scan flags NEAR-specific patterns with file:line", () => {
  const code = [
    "#[near(contract_state)]",
    "pub struct C {}",
    "#[near]",
    "impl C {",
    "    pub fn on_transfer_done(&mut self) {}",
    "    #[private]",
    "    pub fn on_ok(&mut self) {}",
    "    #[payable]",
    "    pub fn deposit(&mut self) { let who = env::signer_account_id(); }",
    "    pub fn ft_transfer(&mut self) { Promise::new(a).transfer(b); }",
    "}",
  ].join("\n");
  const notes = scanNear([{ path: "Cargo.toml", text: 'near-sdk = "5.30.0"' }, { path: "src/lib.rs", text: code }]);
  const has = (s: string) => assert.ok(notes.some((n) => n.includes(s)), `expected a note containing "${s}" in:\n${notes.join("\n")}`);
  has("near-sdk version: 5.30.0");
  has("src/lib.rs:5: pub fn on_transfer_done looks like a callback but has no #[private]");
  has("src/lib.rs:9: pub fn deposit is #[payable]");
  has("src/lib.rs:9: uses env::signer_account_id()");
  has("src/lib.rs:10: sends NEAR");
  has("no assert_one_yocto()");
  assert.ok(!notes.some((n) => n.includes("on_ok")), "a #[private] callback isn't flagged");
});
