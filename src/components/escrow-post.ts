"use client";

import { useState } from "react";
import { useAuth, type PayStep } from "./wallet";

// Moved here unchanged from the live app, so the new pages and the classic app share one payment path:
// useEscrowPost posts a job through the escrow contract; usePaidAction pays NEAR to the coordinator for an
// action (backing an agent, topping up credit) and has the server confirm the payment on chain.

/**
 * Posting through the escrow contract: sign in if needed, reserve a job id, have the wallet call
 * post_job(job_id) on the contract with the budget attached, then let the server confirm it from the contract.
 * If confirming fails after the deposit, the job id is kept for a retry (and the poster can reclaim on chain).
 */
export function useEscrowPost(
  liveKey: string,
  onDone: (data: { id?: string }) => void,
) {
  const { ensureSignedIn, callWithDeposit } = useAuth();
  const [step, setStep] = useState<PayStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    jobId: string;
    txHash: string;
  } | null>(null);
  const headers = {
    "content-type": "application/json",
    ...(liveKey ? { "x-live-key": liveKey } : {}),
  };

  const submit = async (jobId: string, txHash: string) => {
    setStep("confirm");
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch("/api/live/jobs", {
        method: "POST",
        headers,
        body: JSON.stringify({ jobId, txHash }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setPending(null);
        setStep(null);
        onDone(data);
        return true;
      }
      if (
        res.status === 402 &&
        /no deposit/i.test(data.error || "") &&
        attempt < 4
      ) {
        await new Promise((r) => setTimeout(r, 2500));
        continue;
      }
      setPending({ jobId, txHash });
      setError(data.error || `Request failed (${res.status})`);
      setStep(null);
      return false;
    }
    return false;
  };

  const run = async (job: {
    description: string;
    skills: string[];
    budget: number;
    challenge?: boolean;
  }) => {
    setError(null);
    try {
      await ensureSignedIn(setStep);
      const prep = await fetch("/api/live/jobs/prepare", {
        method: "POST",
        headers,
        body: JSON.stringify(job),
      });
      const p = await prep.json().catch(() => ({}));
      if (!prep.ok) throw new Error(p.error || "Couldn't start the job.");
      const txHash = await callWithDeposit(
        p.contractId,
        "post_job",
        { job_id: p.jobId },
        job.budget,
        setStep,
      );
      return await submit(p.jobId, txHash);
    } catch (e) {
      setStep(null);
      setError(e instanceof Error ? e.message : "The payment was cancelled.");
      return false;
    }
  };

  const retry = async () =>
    pending ? (setError(null), submit(pending.jobId, pending.txHash)) : false;
  return { run, retry, step, error, pending };
}


/** Pay `amount` NEAR from the wallet, then POST the body with the tx hash to `path` (the server checks it on chain). */
export function usePaidAction(
  path: string,
  escrow: string | null,
  liveKey: string,
  onDone: (data: { id?: string }) => void,
) {
  const { pay } = useAuth();
  const [step, setStep] = useState<PayStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    body: Record<string, unknown>;
    txHash: string;
  } | null>(null);

  const submit = async (body: Record<string, unknown>, txHash: string) => {
    setStep("confirm");
    // The chain can take a few seconds to show a fresh payment as final: retry briefly before giving up.
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch(path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(liveKey ? { "x-live-key": liveKey } : {}),
        },
        body: JSON.stringify({ ...body, txHash }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setPending(null);
        setStep(null);
        onDone(data);
        return true;
      }
      if (
        res.status === 402 &&
        /find that payment/i.test(data.error || "") &&
        attempt < 4
      ) {
        await new Promise((r) => setTimeout(r, 2500));
        continue;
      }
      setPending({ body, txHash });
      setError(data.error || `Request failed (${res.status})`);
      setStep(null);
      return false;
    }
    return false;
  };

  const run = async (body: Record<string, unknown>, amount: number) => {
    setError(null);
    if (!escrow) return (setError("The coordinator isn't set up yet."), false);
    try {
      const txHash = await pay(amount, escrow, setStep);
      return await submit(body, txHash);
    } catch (e) {
      setStep(null);
      setError(e instanceof Error ? e.message : "The payment was cancelled.");
      return false;
    }
  };

  const retry = async () => {
    if (!pending) return false;
    setError(null);
    return submit(pending.body, pending.txHash);
  };

  return { run, retry, step, error, pending };
}

