"use client";

import { useState } from "react";
import { useAuth, type PayStep } from "./wallet";

// Moved here unchanged from the live app so the /check composer and the live app share one payment path.

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

