"use client";

import { useCallback, useState } from "react";
import { useAuth, type WalletTx } from "./wallet";

// Paying for a job with NEAR Intents from the browser (the server side is lib/live/intents-jobs.ts):
//  1. the server checks the job and returns the intent to sign and what the wallet must do first;
//  2. one wallet approval: top up the NEAR Intents balance (wrap NEAR, deposit it) and, the first time,
//     register the wallet's key with the verifier so it can sign intents;
//  3. the wallet signs the intent "transfer <budget> to the coordinator" (a message, no gas);
//  4. the server executes it on the verifier and the round starts.

export type IntentsStep = "connect" | "prepare" | "deposit" | "sign" | "submit";
export const INTENTS_STEP_LABEL: Record<IntentsStep, string> = {
  connect: "Connecting your wallet…",
  prepare: "Preparing the intent…",
  deposit: "Approve the deposit in your wallet…",
  sign: "Sign the intent in your wallet…",
  submit: "Executing the intent…",
};

const TGAS = (n: number) => `${n}000000000000`;
const registerKeyTx = (verifier: string, key: string): WalletTx => ({ receiverId: verifier, calls: [{ method: "add_public_key", args: { public_key: key }, deposit: "1", gas: TGAS(30) }] });

type Prep = {
  jobId: string;
  sign: { message: string; nonce: string; recipient: string };
  verifier: string;
  wrap: string;
  deposit: string | null;
  wrapRegistered: boolean;
  registerKey: string | null;
  error?: string;
};

export function useIntentsPost(liveKey: string, onPosted: (id: string) => void) {
  const auth = useAuth();
  const [step, setStep] = useState<IntentsStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headers = { "content-type": "application/json", ...(liveKey ? { "x-live-key": liveKey } : {}) };

  const run = useCallback(
    async (job: { description: string; skills: string[]; budget: number }) => {
      setError(null);
      try {
        setStep("connect");
        const account = await auth.ensureSignedIn();
        setStep("prepare");
        const res = await fetch("/api/intents/job", { method: "POST", headers, body: JSON.stringify(job) });
        const prep = (await res.json()) as Prep;
        if (!res.ok) throw new Error(prep.error || "Couldn't prepare the intent.");

        const txs: WalletTx[] = [];
        if (prep.deposit) {
          const calls: WalletTx["calls"] = [];
          if (!prep.wrapRegistered) calls.push({ method: "storage_deposit", args: { account_id: account, registration_only: true }, deposit: "1250000000000000000000", gas: TGAS(10) });
          calls.push({ method: "near_deposit", args: {}, deposit: prep.deposit, gas: TGAS(10) });
          calls.push({ method: "ft_transfer_call", args: { receiver_id: prep.verifier, amount: prep.deposit, msg: "" }, deposit: "1", gas: TGAS(100) });
          txs.push({ receiverId: prep.wrap, calls });
        }
        if (prep.registerKey) txs.push(registerKeyTx(prep.verifier, prep.registerKey));
        if (txs.length) {
          setStep("deposit");
          await auth.sendTransactions(txs);
        }

        setStep("sign");
        const signed = await auth.signMessage(prep.sign);
        setStep("submit");
        // The deposit can take a moment to show on the verifier: retry briefly. A key the wallet signed with that
        // isn't registered yet gets one more approval, then the same signature is submitted again.
        for (let i = 0; i < 6; i++) {
          const r = await fetch("/api/intents/job", { method: "POST", headers, body: JSON.stringify({ step: "submit", jobId: prep.jobId, ...signed }) });
          const d = await r.json().catch(() => ({}));
          if (r.ok && d.id) return onPosted(d.id);
          if (r.status === 409 && d.needKey) {
            setStep("deposit");
            await auth.sendTransactions([registerKeyTx(prep.verifier, d.needKey)]);
            setStep("submit");
            continue;
          }
          if (r.status === 402 && /balance doesn't cover/.test(d.error ?? "") && i < 5) {
            await new Promise((ok) => setTimeout(ok, 2500));
            continue;
          }
          throw new Error(d.error || "The intent couldn't be executed.");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setStep(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [auth, liveKey, onPosted],
  );
  return { run, step, error };
}
