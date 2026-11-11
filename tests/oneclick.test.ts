import test from "node:test";
import assert from "node:assert/strict";
import { detectCheck } from "../src/lib/live/detect";
import { depositAddressCandidates, fetchSwapStatus, swapEvidence, type SwapStatus } from "../src/lib/live/oneclick";

const EVM = "0x76b4c56085ED136a8744D52bE956396624a730E8";

test("finds deposit addresses in a job, an explicit one first", () => {
  const text = `My swap from Base failed. I sent USDC from 0x1111111111111111111111111111111111111111 to the deposit address ${EVM}.`;
  assert.equal(depositAddressCandidates(text)[0], EVM);
  assert.deepEqual(depositAddressCandidates("no addresses here"), []);
});

test("a 1Click swap is detected as transaction forensics; a NEAR tx stays a tx", () => {
  assert.equal(detectCheck(`My 1Click swap to deposit address ${EVM} never arrived. Where is my money?`)?.skill, "tx-forensics");
  assert.match(detectCheck(`My 1Click swap to deposit address ${EVM} never arrived.`)!.target, /1Click swap/);
  assert.match(detectCheck("My NEAR Intents transfer in transaction 6DhuhcBjTPqFPBRCaZKY3EUz9bjvyPdtXajqQWrGACjg failed.")!.target, /^transaction/);
});

// The shape from the documented status response (docs.near-intents.org, check-swap-execution-status).
const refunded: SwapStatus = {
  status: "REFUNDED",
  updatedAt: "2026-11-10T12:00:00Z",
  quoteResponse: {
    quoteRequest: { originAsset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", destinationAsset: "nep141:wrap.near", recipient: "alice.near", refundTo: "0x2222222222222222222222222222222222222222", swapType: "EXACT_INPUT" },
    quote: { depositAddress: EVM, amountInFormatted: "25.0", amountOutFormatted: "8.1" },
  },
  swapDetails: { refundedAmountFormatted: "25.0", refundReason: "Quote expired before the deposit arrived", originChainTxHashes: [{ hash: "0xabc", explorerUrl: "https://basescan.org/tx/0xabc" }], nearTxHashes: [] },
};

test("a refunded swap reads as what was asked, what came back, why, and the transactions", () => {
  const e = swapEvidence(EVM, refunded);
  assert.match(e.facts, /Status: REFUNDED \(the swap did not complete and the deposit was sent back/);
  assert.match(e.facts, /swap 25.0 of base-0x833589fc.* for 8.1 of wrap.near/);
  assert.match(e.facts, /Refunded: 25.0 .* to 0x2222.*Reason given: Quote expired/);
  assert.match(e.facts, /basescan.org\/tx\/0xabc/);
  assert.match(e.summary, /REFUNDED \(Quote expired/);
});

test("an unknown address (404) or an unreachable API is simply not a swap", async () => {
  const notFound = (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch;
  const down = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
  const ok = (async () => new Response(JSON.stringify(refunded), { status: 200 })) as unknown as typeof fetch;
  assert.equal(await fetchSwapStatus(EVM, notFound), null);
  assert.equal(await fetchSwapStatus(EVM, down), null);
  assert.equal((await fetchSwapStatus(EVM, ok))?.status, "REFUNDED");
});
