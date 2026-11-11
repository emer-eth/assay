import assert from "node:assert/strict";
import { test } from "node:test";
import { PAY_ASSETS, payAsset, payInQuote, readPayIn, refundAddressProblem, refundQuote, WNEAR, yoctoOf } from "../src/lib/live/pay-assets";

const base = payAsset("usdc-base")!;
const coordinator = "assay.near";

test("yoctoOf is exact", () => {
  assert.equal(yoctoOf(0.3), "300000000000000000000000");
  assert.equal(yoctoOf(0.05), "50000000000000000000000");
  assert.equal(yoctoOf(1), "1000000000000000000000000");
});

test("every token has a 1Click asset id and a refund address check", () => {
  for (const a of PAY_ASSETS) assert.match(a.assetId, /^nep141:/, a.key);
  assert.equal(refundAddressProblem(base, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"), null);
  assert.match(refundAddressProblem(base, "alice.near") ?? "", /address on Base/);
  assert.match(refundAddressProblem(base, "") ?? "", /Add the/);
  assert.equal(refundAddressProblem(payAsset("sol")!, "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"), null);
  assert.equal(refundAddressProblem(payAsset("btc")!, "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"), null);
  assert.equal(refundAddressProblem(payAsset("usdc-near")!, "alice.near"), null);
  assert.ok(refundAddressProblem(payAsset("usdc-near")!, "alice.testnet"));
});

test("the pay-in quote asks for exactly the budget in wNEAR, delivered to the coordinator, refunds to the payer", () => {
  const q = payInQuote({ asset: base, budget: 0.3, refundTo: " 0xabc0000000000000000000000000000000000001 ", coordinator, now: 0 });
  assert.equal(q.swapType, "EXACT_OUTPUT");
  assert.equal(q.destinationAsset, WNEAR);
  assert.equal(q.amount, "300000000000000000000000");
  assert.equal(q.recipient, coordinator);
  assert.equal(q.recipientType, "DESTINATION_CHAIN");
  assert.equal(q.refundTo, "0xabc0000000000000000000000000000000000001");
  assert.equal(q.refundType, "ORIGIN_CHAIN");
  assert.equal(q.originAsset, base.assetId);
  assert.equal(q.deadline, new Date(30 * 60_000).toISOString());
});

test("the refund quote sends wNEAR from the coordinator to the payer's token", () => {
  const q = refundQuote({ asset: base, yocto: "100", recipient: "0xabc", coordinator, now: 0 });
  assert.equal(q.swapType, "EXACT_INPUT");
  assert.equal(q.originAsset, WNEAR);
  assert.equal(q.destinationAsset, base.assetId);
  assert.equal(q.recipient, "0xabc");
  assert.equal(q.refundTo, coordinator);
});

test("only a successful swap to the coordinator, in wNEAR, for at least the budget, counts as paid", () => {
  const want = { coordinator, yocto: "300000000000000000000000" };
  const ok = { status: "SUCCESS", quoteResponse: { quoteRequest: { recipient: coordinator, destinationAsset: WNEAR, recipientType: "DESTINATION_CHAIN" } }, swapDetails: { amountOut: "300000000000000000000001" } };
  assert.deepEqual(readPayIn(ok, want), { state: "paid" });
  assert.deepEqual(readPayIn({ status: "PROCESSING" }, want), { state: "waiting", status: "PROCESSING" });
  assert.equal(readPayIn({ status: "REFUNDED" }, want).state, "failed");
  assert.equal(readPayIn({ ...ok, swapDetails: { amountOut: "1" } }, want).state, "failed");
  assert.equal(readPayIn({ ...ok, quoteResponse: { quoteRequest: { recipient: "someone.near", destinationAsset: WNEAR } } }, want).state, "failed");
  assert.equal(readPayIn({ ...ok, quoteResponse: { quoteRequest: { recipient: coordinator, destinationAsset: "nep141:usdt.tether-token.near" } } }, want).state, "failed");
});
