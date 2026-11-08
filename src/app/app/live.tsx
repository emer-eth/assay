"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Hive,
  HiveLegend,
  type Cell,
  type CellState,
  type Center,
} from "@/components/hive";
import { near, SkillPicker, TopBar } from "@/components/ui";
import { PAY_STEP_LABEL, useAuth, type PayStep } from "@/components/wallet";
import type { LiveAgent, LiveRound } from "@/lib/live/store";
import type { PublicRound } from "@/lib/live/visibility";
import { SKILL_LABEL, type Skill } from "@/lib/swarm/types";
import { AGENT_MODELS, type AgentModel } from "@/lib/models";

// Live mode: real agents on NEAR AI Cloud, real testnet accounts and transfers.

type State = {
  configured: boolean;
  needsKey: boolean;
  coordinator: { id: string | null; near: number | null };
  viewer: string | null;
  agents: LiveAgent[];
  rounds: PublicRound[];
  busy: boolean;
};
const txUrl = (h: string) => `https://testnet.nearblocks.io/txns/${h}`;
const acctUrl = (id: string) => `https://testnet.nearblocks.io/address/${id}`;
const ACTIVE: LiveRound["status"][] = [
  "queued",
  "reviewing",
  "bidding",
  "working",
  "grading",
  "settling",
];

function cellState(agentId: string, r?: LiveRound): CellState {
  if (!r) return "idle";
  if (r.winner === agentId) {
    if (r.grade) return r.grade.passed ? "paid" : "failed";
    return "winner";
  }
  if (r.status === "bidding" && r.eligible.includes(agentId)) return "thinking";
  if (r.bids.some((b) => b.agent === agentId)) return "bid";
  if (r.eligible.includes(agentId)) return "eligible";
  return "idle";
}

export function Live({ initial }: { initial: State | null }) {
  const [state, setState] = useState<State | null>(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState("");

  const refresh = useCallback(async () => {
    try {
      setState(
        (await (
          await fetch("/api/live/state", { cache: "no-store" })
        ).json()) as State,
      );
    } catch {
      setError("Can't reach the coordinator. Is the server running?");
    }
  }, []);
  useEffect(() => {
    try {
      // Read after mount so the server render and the first browser render match.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setKey(localStorage.getItem("swarm-live-key") || "");
    } catch {}
    refresh();
  }, [refresh]);
  useEffect(() => {
    const t = setInterval(refresh, state?.busy ? 1200 : 6000);
    return () => clearInterval(t);
  }, [refresh, state?.busy]);

  // Tell posters when their job finishes, even if they're looking at another round; show progress in the tab title.
  const [notice, setNotice] = useState<{
    id: string;
    text: string;
    ok: boolean;
  } | null>(null);
  const seen = useRef(new Map<string, LiveRound["status"]>());
  useEffect(() => {
    if (!state) return;
    for (const r of state.rounds.filter((x) => x.mine)) {
      const before = seen.current.get(r.id);
      if (before && ACTIVE.includes(before) && !ACTIVE.includes(r.status)) {
        const ok = r.status === "done" && !!r.grade?.passed;

        setNotice({
          id: r.id,
          ok,
          text: ok
            ? `Your job is done: the work passed review. ${r.payout?.refundToPoster ? `${r.payout.refundToPoster} Ⓝ of unused budget is on its way back to your wallet.` : ""}`
            : r.status === "error"
              ? "Your job hit an error. Whatever was left of your budget is being refunded."
              : `Your job ended without a passing delivery, so your ${r.job.budget} Ⓝ is being refunded.`,
        });
      }
      seen.current.set(r.id, r.status);
    }
    const mineRunning = state.rounds.some(
      (r) => r.mine && ACTIVE.includes(r.status),
    );
    document.title = mineRunning
      ? "● Your job is running · Swarm-for-Hire"
      : notice
        ? "✓ Job finished · Swarm-for-Hire"
        : "Swarm-for-Hire";
  }, [state, notice]);

  const round = useMemo(
    () => state?.rounds.find((r) => r.id === selected) ?? state?.rounds[0],
    [state, selected],
  );
  const cells: Cell[] = useMemo(
    () =>
      (state?.agents ?? []).map((a) => ({
        id: a.id,
        label: a.name,
        rep: a.quality,
        detail: `${a.skills.map((s) => SKILL_LABEL[s]).join(", ")} · ${AGENT_MODELS[a.model as AgentModel]?.label ?? "Qwen 3.6 35B"} · ${a.balance.toFixed(3)} Ⓝ`,
        state: cellState(a.id, round),
      })),
    [state?.agents, round],
  );

  const running = state?.rounds.find((r) => ACTIVE.includes(r.status));

  return (
    <>
      <TopBar mode="app" />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <div className="relative mb-8 flex flex-wrap items-end justify-between gap-6 border-b border-line pb-8">
          <div className="honeycomb pointer-events-none absolute inset-0 -top-8 [mask-image:radial-gradient(ellipse_45%_90%_at_85%_30%,#000_15%,transparent_70%)]" aria-hidden />
          <div className="relative">
            <p className="eyebrow flex items-center gap-2">
              <span
                className={`size-1.5 rounded-full ${running ? "live-dot bg-accent" : "bg-ok"}`}
              />
              {running ? "Round running" : "Market open"} · NEAR testnet
            </p>
            <h1 className="display mt-4 text-[44px] text-text sm:text-[64px]">
              Live <span className="text-accent">market</span>
            </h1>
            <p className="mt-2 max-w-xl text-[15px] text-muted">
              Post a job and watch the swarm review it, bid, do the work and
              settle it on chain. You pay only for work that passes.
            </p>
          </div>
          <div className="relative grid justify-items-start gap-4 sm:justify-items-end">
            {state && <MarketSummary rounds={state.rounds} agents={state.agents.length} />}
            <span className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted sm:justify-end">
              {state?.coordinator.id && (
                <a href={acctUrl(state.coordinator.id)} target="_blank" rel="noreferrer" className="hover:text-text">
                  Coordinator <span className="num text-text">{state.coordinator.near !== null ? near(state.coordinator.near) : "…"}</span> ↗
                </a>
              )}
              <Link href="/#mcp" className="hover:text-text">
                Using an AI assistant? Connect over MCP →
              </Link>
            </span>
          </div>
        </div>
        {state && !state.configured && (
          <p className="panel mb-6 border-accent/40 p-4 text-sm">
            Live mode isn&apos;t set up yet. Fill in{" "}
            <code className="num text-accent">.env</code> (see{" "}
            <code className="num">.env.example</code>) and run{" "}
            <code className="num">npm run spike</code>.
          </p>
        )}
        {state?.needsKey && (
          <label className="mb-6 block max-w-xs">
            <span className="eyebrow">Live key</span>
            <input
              type="password"
              className="field mt-1.5"
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                try {
                  localStorage.setItem("swarm-live-key", e.target.value);
                } catch {}
              }}
            />
          </label>
        )}
        {error && (
          <p
            role="alert"
            className="panel mb-6 border-bad/50 p-4 text-sm text-bad"
          >
            {error}
          </p>
        )}

        {notice && (
          <div
            role="status"
            className={`panel enter mb-6 flex flex-wrap items-center justify-between gap-3 p-4 text-sm ${notice.ok ? "border-ok/50" : "border-accent/50"}`}
          >
            <span className={notice.ok ? "text-ok" : "text-accent"}>
              {notice.text}
            </span>
            <span className="flex gap-2">
              <button
                className="btn btn-ghost !px-3 !py-1.5 text-xs"
                onClick={() => setSelected(notice.id)}
              >
                See the result
              </button>
              <button
                className="btn btn-ghost !px-3 !py-1.5 text-xs"
                onClick={() => setNotice(null)}
                aria-label="Dismiss"
              >
                ✕
              </button>
            </span>
          </div>
        )}

        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-6">
            <section className="panel relative overflow-hidden p-5" aria-labelledby="hive-h">
              <div className="honeycomb pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_60%_60%_at_50%_50%,#000_10%,transparent_75%)]" aria-hidden />
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="hive-h" className="headline text-[19px] text-text">
                  The swarm
                </h2>
                <span className="text-xs text-muted">
                  {round
                    ? `Showing round ${round.id}`
                    : "Post a job to wake it up"}
                </span>
              </div>
              <div className="relative mx-auto mt-2 max-w-2xl">
                <Hive
                  cells={cells}
                  center={roundCenter(round)}
                  label="The swarm: each agent's line to the job shows what it's doing in the selected round"
                />
              </div>
              <div className="mt-4">
                <HiveLegend
                  states={[
                    "idle",
                    "eligible",
                    "thinking",
                    "bid",
                    "winner",
                    "paid",
                    "failed",
                  ]}
                />
              </div>
            </section>

            <PostJob
              busy={!!running}
              liveKey={key}
              onPosted={(id) => {
                setSelected(id);
                refresh();
              }}
            />
            <Agents
              agents={state?.agents ?? []}
              round={round}
              escrow={state?.coordinator.id ?? null}
              liveKey={key}
              onAdded={refresh}
            />
            <UseFromAI escrow={state?.coordinator.id ?? null} liveKey={key} />
          </div>

          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4 lg:sticky lg:top-20 lg:self-start">
            {!!state?.rounds.some((r) => r.mine) && (
              <nav
                aria-label="Your jobs"
                className="flex items-center gap-1.5 overflow-x-auto pb-1"
              >
                <span className="eyebrow mr-1 shrink-0 !text-accent">
                  Your jobs
                </span>
                {state.rounds
                  .filter((r) => r.mine)
                  .slice(0, 10)
                  .map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setSelected(r.id)}
                      aria-current={round?.id === r.id ? "true" : undefined}
                      className={`num flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs ${round?.id === r.id ? "border-accent bg-accent/12 text-accent" : "border-accent/30 text-accent/80 hover:text-accent"}`}
                    >
                      <span className={`size-1.5 rounded-full ${dot(r)}`} />#
                      {r.id.slice(0, 4)}
                    </button>
                  ))}
              </nav>
            )}
            {!!state?.rounds.length && (
              <nav
                aria-label="Rounds"
                className="flex gap-1.5 overflow-x-auto pb-1"
              >
                {state.rounds.slice(0, 12).map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setSelected(r.id)}
                    aria-current={round?.id === r.id ? "true" : undefined}
                    className={`num flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs ${round?.id === r.id ? "border-white/30 bg-panel-2 text-text" : "border-line text-muted hover:text-text"}`}
                  >
                    <span className={`size-1.5 rounded-full ${dot(r)}`} />#
                    {r.id.slice(0, 4)}
                  </button>
                ))}
              </nav>
            )}
            {round ? (
              <RoundDetail r={round} agents={state?.agents ?? []} />
            ) : (
              <EmptyFeed />
            )}
          </div>
        </div>
      </main>
    </>
  );
}

function roundCenter(r?: PublicRound): Center {
  if (!r)
    return { title: "No job yet", sub: "Post a job to start", tone: "idle" };
  const title = `job #${r.id.slice(0, 4)} · ${r.job.budget} Ⓝ`;
  const live: Partial<Record<LiveRound["status"], string>> = {
    queued: "Queued · starts next",
    reviewing: "Reviewing the job",
    bidding: "Sealed bidding…",
    working: "Agent working…",
    grading: "Grading the work",
    settling: "Paying out…",
  };
  if (live[r.status]) return { title, sub: live[r.status], tone: "live" };
  if (r.status === "done" && r.grade?.passed)
    return { title, sub: `Paid ${near(r.payout?.toAgent ?? 0)}`, tone: "ok" };
  if (r.status === "done")
    return { title, sub: "Failed · refunded", tone: "bad" };
  if (r.status === "blocked")
    return { title, sub: "Blocked · refunded", tone: "bad" };
  if (r.status === "unfilled")
    return { title, sub: "No bids · refunded", tone: "idle" };
  return { title, sub: "Error · refunding", tone: "bad" };
}

const dot = (r: PublicRound) =>
  ACTIVE.includes(r.status)
    ? "live-dot bg-accent"
    : r.status === "done" && r.grade?.passed
      ? "bg-ok"
      : r.status === "blocked" || r.status === "error"
        ? "bg-bad"
        : "bg-muted";

function EmptyFeed() {
  return (
    <section className="panel p-6 text-sm text-muted">
      <p className="eyebrow mb-2">Round feed</p>
      Post a job and its round plays out here: the review, the sealed bids, the
      work, the grade and every payment on chain.
    </section>
  );
}

/**
 * Pay-then-submit, kept in one place: connect and sign in if needed, send the payment from the user's
 * wallet, then hand the transaction hash to the server, which checks it on chain. If the server says no
 * after the payment went through (e.g. a round is running), the hash is kept so it can be retried, never lost.
 */
function usePaidAction(
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

function PayStatus({
  step,
  error,
  pending,
  retry,
}: {
  step: PayStep | null;
  error: string | null;
  pending: { txHash: string } | null;
  retry: () => void;
}) {
  if (step)
    return (
      <p
        className="mt-3 flex items-center gap-2 text-sm text-accent"
        role="status"
      >
        <span className="live-dot size-1.5 rounded-full bg-accent" />{" "}
        {PAY_STEP_LABEL[step]}
      </p>
    );
  if (!error) return null;
  return (
    <div
      role="alert"
      className="mt-3 rounded-lg border border-bad/40 bg-bad/8 p-3 text-sm"
    >
      <p className="text-bad">{error}</p>
      {pending && (
        <p className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
          Your payment went through (
          <a
            className="num underline underline-offset-2"
            href={txUrl(pending.txHash)}
            target="_blank"
            rel="noreferrer"
          >
            {pending.txHash.slice(0, 8)}…
          </a>
          ), so you won&apos;t pay twice.
          <button
            type="button"
            className="btn btn-ghost !px-2.5 !py-1 text-xs"
            onClick={retry}
          >
            Try again with this payment
          </button>
        </p>
      )}
    </div>
  );
}

/**
 * Posting through the escrow contract: sign in if needed, reserve a job id, have the wallet call
 * post_job(job_id) on the contract with the budget attached, then let the server confirm it from the contract.
 * If confirming fails after the deposit, the job id is kept for a retry (and the poster can reclaim on chain).
 */
function useEscrowPost(
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

const EXAMPLES: { label: string; description: string; skills: Skill[] }[] = [
  {
    label: "Check Ref Finance",
    description:
      "Before I deposit: who controls v2.ref-finance.near, can its code be changed, and by whom?",
    skills: ["due-diligence"],
  },
  {
    label: "Check NEAR Intents",
    description:
      "Due diligence on intents.near: admin roles, keys, published source and recent activity.",
    skills: ["due-diligence"],
  },
  {
    label: "Review DAO proposal",
    description:
      "I'm on the council: what will proposal #1059 on ref-finance.sputnik-dao.near actually do, and does it match its description?",
    skills: ["proposal-review"],
  },
  {
    label: "Explain a failed tx",
    description:
      "Why did transaction 6DhuhcBjTPqFPBRCaZKY3EUz9bjvyPdtXajqQWrGACjg fail, and did I lose any money?",
    skills: ["tx-forensics"],
  },
  {
    label: "Review a contract",
    description:
      "Review https://github.com/near-examples/donation-examples/tree/main/contract-rs for NEAR-specific bugs and give fixes.",
    skills: ["contract-review"],
  },
];

function PostJob({
  busy,
  liveKey,
  onPosted,
}: {
  busy: boolean;
  liveKey: string;
  onPosted: (id: string) => void;
}) {
  const [description, setDescription] = useState("");
  const [skills, setSkills] = useState<Skill[]>(["due-diligence"]);
  const [budget, setBudget] = useState(0.5);
  const action = useEscrowPost(liveKey, (d) => {
    setDescription("");
    if (d.id) onPosted(d.id);
  });
  const valid =
    description.trim().length >= 10 &&
    skills.length > 0 &&
    budget >= 0.05 &&
    budget <= 5;
  return (
    <form
      className="panel p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !action.step)
          action.run({ description, skills, budget });
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="headline text-[19px] text-text">Post a job</h2>
        <span className="text-xs text-faint">
          Your budget is held by the escrow contract. You only pay the winning
          bid.
        </span>
      </div>
      <label className="mt-3 block">
        <span className="sr-only">What should an agent do?</span>
        <textarea
          className="field min-h-24 text-[15px]"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={
            skills.includes("tx-forensics")
              ? "Paste the transaction hash or NearBlocks link, e.g. Why did my transaction 6Dhuhc… fail?"
              : skills.includes("proposal-review")
              ? "Name the DAO and proposal, e.g. What will proposal #1059 on ref-finance.sputnik-dao.near actually do?"
              : skills.includes("contract-review")
              ? "Link a public repo, e.g. Review https://github.com/owner/repo/tree/main/contract for NEAR-specific bugs"
              : "Name the account, e.g. Before I deposit: who controls v2.ref-finance.near, and can its code be changed?"
          }
        />
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-faint">Try:</span>
        {EXAMPLES.map((ex) => (
          <button
            type="button"
            key={ex.label}
            onClick={() => {
              setDescription(ex.description);
              setSkills(ex.skills);
            }}
            className="rounded-full border border-line-strong px-2.5 py-1 text-muted transition-colors hover:text-text"
          >
            {ex.label}
          </button>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <SkillPicker
          label="Skills needed"
          value={skills}
          onChange={setSkills}
        />
        <div className="flex items-end gap-3">
          <label>
            <span className="eyebrow">Budget</span>
            <span className="relative mt-1.5 block">
              <input
                type="number"
                step="0.05"
                min={0.05}
                max={5}
                className="field num w-28 pr-7"
                value={budget}
                onChange={(e) => setBudget(Number(e.target.value))}
              />
              <span className="num pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted">
                Ⓝ
              </span>
            </span>
          </label>
          <button
            disabled={!!action.step || !valid}
            className="btn btn-primary"
          >
            {action.step ? "Working…" : `Post & pay ${budget || 0} Ⓝ`}
          </button>
          {busy && !action.step && <span className="self-center text-xs text-muted">A round is running; yours queues and starts next.</span>}
        </div>
      </div>
      <PayStatus
        step={action.step}
        error={action.error}
        pending={action.pending}
        retry={action.retry}
      />
    </form>
  );
}

/** An agent's hexagon, coloured by what it's doing in the selected round (the same colours as the swarm graph). */
function AgentHex({ name, state }: { name: string; state: CellState }) {
  const tone = state === "paid" ? "var(--ok)" : state === "failed" ? "var(--bad)" : state === "winner" || state === "thinking" ? "var(--accent)" : state === "bid" ? "color-mix(in srgb, var(--accent) 55%, transparent)" : "var(--line-strong)";
  const initials = name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <svg viewBox="0 0 40 44" className="size-10 shrink-0" aria-hidden>
      <path d="M20 2 37 11.5v21L20 42 3 32.5v-21z" fill="var(--bg)" stroke={tone} strokeWidth="1.5" strokeLinejoin="round" />
      <text x="20" y="26" textAnchor="middle" className="num" fontSize="11" fill={state === "idle" ? "var(--muted)" : tone}>
        {initials}
      </text>
    </svg>
  );
}

/** The market at a glance: rounds, how many passed, NEAR paid to agents. */
function MarketSummary({ rounds, agents }: { rounds: PublicRound[]; agents: number }) {
  const done = rounds.filter((r) => r.status === "done");
  const passed = done.filter((r) => r.grade?.passed).length;
  const paid = done.reduce((a, r) => a + (r.payout?.toAgent ?? 0), 0);
  const cells = [
    ["Agents", String(agents)],
    ["Rounds", String(rounds.length)],
    ["Passed", String(passed)],
    ["Paid to agents", near(paid, 3)],
  ];
  return (
    <dl className="flex overflow-hidden rounded-xl border border-line bg-panel/70 backdrop-blur">
      {cells.map(([k, v]) => (
        <div key={k} className="border-r border-line px-4 py-2.5 last:border-r-0">
          <dt className="text-[10px] tracking-[0.08em] text-faint uppercase">{k}</dt>
          <dd className="num mt-0.5 text-[15px] text-text">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Agents({
  agents,
  round,
  escrow,
  liveKey,
  onAdded,
}: {
  agents: LiveAgent[];
  round?: LiveRound;
  escrow: string | null;
  liveKey: string;
  onAdded: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const { account } = useAuth();
  return (
    <section className="panel p-5" aria-labelledby="agents-h">
      <div className="flex items-center justify-between gap-2">
        <h2 id="agents-h" className="headline text-[19px] text-text">
          Agents <span className="num text-sm font-normal text-faint">{agents.length}</span>
        </h2>
        <button
          className="btn btn-ghost !px-3 !py-1.5 text-xs"
          onClick={() => setAdding(!adding)}
          aria-expanded={adding}
        >
          {adding ? "Close" : "+ Back an agent"}
        </button>
      </div>
      {adding && (
        <AddAgent
          escrow={escrow}
          liveKey={liveKey}
          onAdded={() => {
            setAdding(false);
            onAdded();
          }}
        />
      )}
      <ul className="mt-3 divide-y divide-line">
        {agents.map((a) => {
          const st = cellState(a.id, round);
          return (
            <li key={a.id} className="flex items-center gap-4 py-3.5">
              <AgentHex name={a.name} state={st} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <a href={acctUrl(a.id)} target="_blank" rel="noreferrer" className="truncate text-[15px] font-medium hover:text-accent">
                    {a.name}
                  </a>
                  <span className="num text-[11px] text-faint">
                    {a.backer === account ? <span className="text-accent">yours</span> : <>backed by {a.backer}</>}
                  </span>
                </span>
                <span className="mt-1.5 flex flex-wrap gap-1">
                  {a.skills.map((sk) => (
                    <span key={sk} className="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-muted">
                      {SKILL_LABEL[sk]}
                    </span>
                  ))}
                  <span className="px-1 py-0.5 text-[11px] text-faint">{AGENT_MODELS[a.model as AgentModel]?.label ?? "Qwen 3.6 35B"}</span>
                </span>
              </span>
              <span className="num w-32 shrink-0 text-right text-xs leading-tight">
                <span className="flex items-center justify-end gap-2">
                  <span className="h-1 w-12 overflow-hidden rounded-full bg-white/5" aria-hidden>
                    <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.round(a.quality * 100)}%` }} />
                  </span>
                  <span className="text-text">rep {a.quality.toFixed(2)}</span>
                </span>
                <span className="mt-1.5 block text-muted">
                  {near(a.balance, 3)}
                  {a.earned > 0 && <span className="text-ok"> +{a.earned.toFixed(3)}</span>}
                </span>
                {a.backer === account && a.earned > 0 && <Withdraw agent={a} onDone={onAdded} />}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function AddAgent({
  escrow,
  liveKey,
  onAdded,
}: {
  escrow: string | null;
  liveKey: string;
  onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [skills, setSkills] = useState<Skill[]>(["due-diligence"]);
  const [funding, setFunding] = useState(0.5);
  const [model, setModel] = useState<AgentModel>("Qwen/Qwen3.8-27B");
  const action = usePaidAction("/api/live/agents", escrow, liveKey, () =>
    onAdded(),
  );
  const valid =
    name.trim().length >= 2 &&
    prompt.trim().length >= 10 &&
    skills.length > 0 &&
    funding >= 0.1 &&
    funding <= 2;
  return (
    <form
      className="enter mt-4 grid gap-3 rounded-xl border border-line bg-bg/60 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !action.step)
          action.run({ name, prompt, skills, funding, model }, funding);
      }}
    >
      <p className="text-xs text-muted">
        Your agent gets its own testnet account, funded from your wallet to pay
        for its AI. What it earns is yours.
      </p>
      <label>
        <span className="eyebrow">Name</span>
        <input
          className="field mt-1.5"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Key Watcher Kim"
        />
      </label>
      <label>
        <span className="eyebrow">Its prompt</span>
        <textarea
          className="field mt-1.5 min-h-20"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="You are a cautious NEAR security analyst. Lead with who can change the code or move funds, and never claim more than the evidence shows."
        />
      </label>
      <SkillPicker label="Skills" value={skills} onChange={setSkills} />
      <label>
        <span className="eyebrow">Model</span>
        <select
          className="field mt-1.5"
          value={model}
          onChange={(e) => setModel(e.target.value as AgentModel)}
        >
          {Object.entries(AGENT_MODELS).map(([id, m]) => (
            <option key={id} value={id}>
              {m.label} · ${m.input} in / ${m.output} out per M tokens
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-faint">
          Stronger models write better reports but cost your agent more per
          job, so it has to bid higher.
        </span>
      </label>
      <div className="flex items-end justify-between gap-3">
        <label>
          <span className="eyebrow">Funding</span>
          <span className="relative mt-1.5 block">
            <input
              type="number"
              step="0.1"
              min={0.1}
              max={2}
              className="field num w-28 pr-7"
              value={funding}
              onChange={(e) => setFunding(Number(e.target.value))}
            />
            <span className="num pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted">
              Ⓝ
            </span>
          </span>
        </label>
        <button disabled={!!action.step || !valid} className="btn btn-primary">
          {action.step ? "Working…" : `Create & fund ${funding || 0} Ⓝ`}
        </button>
      </div>
      <PayStatus
        step={action.step}
        error={action.error}
        pending={action.pending}
        retry={action.retry}
      />
    </form>
  );
}

type Stage = {
  label: string;
  state: "done" | "active" | "pending" | "failed" | "neutral";
  note?: string;
};

function stages(r: PublicRound): Stage[] {
  const st = r.status;
  const blocked = r.review && !r.review.allowed;
  const after = (s: LiveRound["status"][]) => s.includes(st);
  return [
    { label: "Posted", state: "done", note: `${r.job.budget} Ⓝ in escrow` },
    {
      label: "Job review",
      state:
        st === "reviewing"
          ? "active"
          : blocked
            ? "failed"
            : r.review
              ? "done"
              : "pending",
      note: blocked ? "Blocked" : r.review ? "Approved" : undefined,
    },
    {
      label: "Sealed bids",
      state:
        st === "bidding"
          ? "active"
          : st === "unfilled"
            ? "failed"
            : r.bids.length
              ? "done"
              : blocked
                ? "neutral"
                : "pending",
      note:
        st === "bidding"
          ? `${r.eligible.length} agents thinking`
          : r.bids.length
            ? `${r.bids.length} revealed`
            : undefined,
    },
    {
      label: "Work",
      state:
        st === "working"
          ? "active"
          : r.deliverable || r.deliveredWords
            ? "done"
            : "pending",
      note: r.tokens ? `${r.tokens} tokens` : undefined,
    },
    {
      label: "Delivery review",
      state:
        st === "grading"
          ? "active"
          : r.grade
            ? r.grade.passed
              ? "done"
              : "failed"
            : "pending",
      note: r.grade ? (r.grade.passed ? "Passed" : "Failed") : undefined,
    },
    {
      label: "Settlement",
      state:
        st === "settling"
          ? "active"
          : st === "error"
            ? "failed"
            : after(["done", "blocked", "unfilled"])
              ? r.grade?.passed
                ? "done"
                : "neutral"
              : "pending",
      note: r.payout
        ? r.grade?.passed
          ? `Paid ${near(r.payout.toAgent)}`
          : `Refunded ${near(r.payout.refundToPoster)}`
        : undefined,
    },
  ];
}

const STAGE_STYLE: Record<Stage["state"], string> = {
  done: "border-ok/60 text-ok",
  active: "border-accent text-accent hex-thinking",
  pending: "border-line-strong text-faint",
  failed: "border-bad/60 text-bad",
  neutral: "border-line-strong text-muted",
};
const STAGE_ICON: Record<Stage["state"], string> = {
  done: "✓",
  active: "•",
  pending: "",
  failed: "✕",
  neutral: "–",
};

function RoundDetail({ r, agents }: { r: PublicRound; agents: LiveAgent[] }) {
  const name = (id?: string) =>
    agents.find((a) => a.id === id)?.name || id?.split(".")[0] || "—";
  const maxValue = Math.max(...r.bids.map((b) => b.value), 0.0001);
  const [showLog, setShowLog] = useState(false);
  return (
    <article className="panel enter overflow-hidden" key={r.id}>
      <header className="border-b border-line p-5">
        <p className="eyebrow flex items-center justify-between">
          <span>
            Round <span className="text-text">#{r.id}</span>
          </span>
          <span className="num normal-case tracking-normal">
            {new Date(r.createdAt).toLocaleTimeString()}
          </span>
        </p>
        <p className="mt-2 text-[15px] leading-snug">{r.job.description}</p>
        <p className="num mt-2 text-xs text-muted">
          {near(r.job.budget)} ·{" "}
          {r.job.skills.map((s) => SKILL_LABEL[s]).join(" + ")} · posted by{" "}
          {r.job.poster}
        </p>
      </header>

      <ol className="grid gap-0 p-5">
        {stages(r).map((s, i, all) => (
          <li key={s.label} className="relative flex gap-3 pb-3 last:pb-0">
            {i < all.length - 1 && (
              <span
                className="absolute top-5 left-[8.5px] h-[calc(100%-14px)] w-px bg-line"
                aria-hidden
              />
            )}
            <span
              className={`relative z-10 grid size-[18px] shrink-0 place-items-center rounded-full border bg-panel text-[10px] ${STAGE_STYLE[s.state]}`}
            >
              {STAGE_ICON[s.state]}
            </span>
            <span className="flex min-w-0 flex-1 items-baseline justify-between gap-2 pt-0.5">
              <span
                className={`text-sm ${s.state === "pending" ? "text-faint" : "text-text"}`}
              >
                {s.label}
              </span>
              {s.note && (
                <span
                  className={`num text-xs ${s.state === "failed" ? "text-bad" : s.state === "done" ? "text-ok" : "text-muted"}`}
                >
                  {s.note}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>

      {r.review && !r.review.allowed && (
        <section className="border-t border-line p-5">
          <p className="eyebrow !text-bad">Why it was blocked</p>
          <ul className="mt-2 grid gap-1 text-sm text-text">
            {r.review.reasons.map((x) => (
              <li key={x}>— {x}</li>
            ))}
          </ul>
        </section>
      )}

      {r.evidence && r.evidence.summary.length > 0 && (
        <section className="border-t border-line p-5">
          <p className="eyebrow">What the tools read</p>
          <ul className="mt-2 grid gap-1 text-sm text-text">
            {r.evidence.summary.map((x) => (
              <li key={x} className="flex gap-2">
                <span className="text-ok">✓</span>
                <span className="min-w-0 break-words">{x}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-faint">
            Agents bid and work from these facts, and the reviewer checks the
            report against them.
          </p>
        </section>
      )}

      {r.bids.length > 0 && (
        <section className="border-t border-line p-5">
          <p className="eyebrow">
            Sealed bids, revealed · value = rep³ ÷ price
          </p>
          <ul className="mt-3 grid gap-2.5">
            {[...r.bids]
              .sort((a, b) => b.value - a.value)
              .map((b) => {
                const won = b.agent === r.winner;
                return (
                  <li key={b.agent}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span
                        className={
                          won ? "font-semibold text-accent" : "text-text"
                        }
                      >
                        {won && "★ "}
                        {name(b.agent)}
                      </span>
                      <span className="num text-xs text-muted">
                        {near(b.ask)} · value {b.value.toFixed(2)}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/5">
                      <div
                        className={`h-full rounded-full ${won ? "bg-accent" : "bg-white/20"}`}
                        style={{
                          width: `${Math.max(4, (b.value / maxValue) * 100)}%`,
                          transition: "width 400ms ease-out",
                        }}
                      />
                    </div>
                    {b.pitch && (
                      <p className="mt-1 text-xs text-muted">“{b.pitch}”</p>
                    )}
                  </li>
                );
              })}
          </ul>
        </section>
      )}

      {(r.deliverable || r.private) && (
        <section className="border-t border-line p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="eyebrow">Delivered by {name(r.winner)}</p>
            {r.deliverable && <ResultActions r={r} />}
          </div>
          {r.deliverable ? (
            <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-line bg-bg p-3 text-sm leading-relaxed whitespace-pre-wrap">
              {r.deliverable}
            </div>
          ) : (
            <p className="mt-2 rounded-lg border border-dashed border-line-strong p-3 text-sm text-muted">
              🔒 {r.deliveredWords} words delivered. Only the poster who paid
              for this job can read the result.
            </p>
          )}
          {r.grade && (
            <div
              className={`mt-3 rounded-lg border p-3 text-sm ${r.grade.passed ? "border-ok/25 bg-ok/[0.04]" : "border-bad/25 bg-bad/[0.04]"}`}
            >
              <p
                className={`font-semibold ${r.grade.passed ? "text-ok" : "text-bad"}`}
              >
                {r.grade.passed
                  ? "✓ Reviewer passed it"
                  : "✕ Reviewer failed it"}
              </p>
              <ul className="mt-1 grid gap-0.5 text-muted">
                {r.grade.reasons.map((x) => (
                  <li key={x}>— {x}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {(r.payout || r.txs.length > 0) && (
        <section className="border-t border-line p-5">
          <p className="eyebrow">Money</p>
          {r.payout && (
            <dl className="num mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <dt className="text-muted">To agent</dt>
              <dd className="text-right">{near(r.payout.toAgent)}</dd>
              <dt className="text-muted">Backer profit</dt>
              <dd className="text-right text-ok">{near(r.payout.toBacker)}</dd>
              <dt className="text-muted">Reviewer fee</dt>
              <dd className="text-right">{near(r.payout.fee)}</dd>
              <dt className="text-muted">Agent&apos;s AI cost</dt>
              <dd className="text-right">{near(r.payout.aiCost)}</dd>
              <dt className="text-muted">Refunded to poster</dt>
              <dd className="text-right">{near(r.payout.refundToPoster)}</dd>
            </dl>
          )}
          {r.txs.length > 0 && (
            <ul className="mt-3 grid gap-1.5">
              {r.txs.map((t) => (
                <li key={t.hash}>
                  <a
                    href={txUrl(t.hash)}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-xs hover:border-accent/50"
                  >
                    <span>{t.label}</span>
                    <span className="num shrink-0 text-muted group-hover:text-accent">
                      {t.hash.slice(0, 6)}… ↗
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {r.error && (
        <p className="border-t border-line p-5 text-sm text-bad">{r.error}</p>
      )}

      <footer className="border-t border-line px-5 py-3">
        <button
          className="text-xs text-muted hover:text-text"
          onClick={() => setShowLog(!showLog)}
          aria-expanded={showLog}
        >
          {showLog ? "Hide" : "Show"} coordinator log
        </button>
        {showLog && (
          <ol className="num mt-2 grid gap-1 text-[11px] text-muted">
            {r.steps.map((s, i) => (
              <li key={i}>
                <span className="text-faint">
                  {new Date(s.at).toLocaleTimeString()}
                </span>{" "}
                {s.text}
              </li>
            ))}
          </ol>
        )}
      </footer>
    </article>
  );
}

function ResultActions({ r }: { r: PublicRound }) {
  const [copied, setCopied] = useState(false);
  const text = r.deliverable || "";
  const download = () => {
    const md = `# ${r.job.description}\n\n${text}\n\n---\nDelivered by ${r.winner} for round ${r.id} on Swarm-for-Hire. Reviewer: ${r.grade?.passed ? "passed" : "failed"}.\n`;
    const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `swarm-job-${r.id}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <span className="flex gap-1.5">
      <button
        className="btn btn-ghost !px-2.5 !py-1 text-xs"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {}
        }}
      >
        {copied ? "Copied ✓" : "Copy"}
      </button>
      <button
        className="btn btn-ghost !px-2.5 !py-1 text-xs"
        onClick={download}
      >
        Download .md
      </button>
    </span>
  );
}

function Withdraw({ agent, onDone }: { agent: LiveAgent; onDone: () => void }) {
  const [state, setState] = useState<{
    busy?: boolean;
    error?: string;
    hash?: string;
  }>({});
  if (state.hash)
    return (
      <a
        className="mt-1 block text-ok underline underline-offset-2"
        href={txUrl(state.hash)}
        target="_blank"
        rel="noreferrer"
      >
        Sent to you ↗
      </a>
    );
  return (
    <>
      <button
        className="mt-1 block w-full rounded-md border border-ok/40 px-1.5 py-0.5 text-ok hover:bg-ok/10 disabled:opacity-50"
        disabled={state.busy}
        onClick={async () => {
          setState({ busy: true });
          const res = await fetch(
            `/api/live/agents/${encodeURIComponent(agent.id)}/withdraw`,
            { method: "POST" },
          );
          const data = await res.json().catch(() => ({}));
          if (res.ok) {
            setState({ hash: data.hash });
            onDone();
          } else setState({ error: data.error || "Withdrawal failed." });
        }}
      >
        {state.busy ? "Sending…" : "Withdraw"}
      </button>
      {state.error && (
        <span className="mt-1 block text-bad">{state.error}</span>
      )}
    </>
  );
}

type KeyRow = {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
  lastUsedAt?: string;
};

/** Credit + API keys, so an AI assistant can hire the swarm over MCP without wallet popups. */
function UseFromAI({
  escrow,
  liveKey,
}: {
  escrow: string | null;
  liveKey: string;
}) {
  const { account } = useAuth();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ credit: number; keys: KeyRow[] } | null>(
    null,
  );
  const [amount, setAmount] = useState(1);
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => {
    const res = await fetch("/api/live/credit", { cache: "no-store" });
    if (res.ok) setData(await res.json());
  }, []);
  useEffect(() => {
    // Fetch credit and keys from the server when the panel opens or the user signs in.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open && account) load();
  }, [open, account, load]);
  const topUp = usePaidAction("/api/live/credit", escrow, liveKey, () => {
    setMsg("Credit added.");
    load();
  });
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const url = `${origin}/api/mcp`;
  const keyText = fresh ?? "sfh_YOUR_KEY";

  return (
    <section className="panel p-5" aria-labelledby="ai-h">
      <div className="flex items-center justify-between gap-2">
        <h2 id="ai-h" className="headline text-[19px] text-text">
          Use from your AI{" "}
          <span className="num text-sm font-normal text-faint">· MCP</span>
        </h2>
        <button
          className="btn btn-ghost !px-3 !py-1.5 text-xs"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          {open ? "Close" : "Set up"}
        </button>
      </div>
      <p className="mt-2 text-sm text-muted">
        Let Claude, Codex or any MCP client post jobs and collect results for
        you. It spends prepaid credit you top up from your wallet, never your
        wallet itself.
      </p>
      {open && !account && (
        <p className="mt-3 text-sm text-accent">
          Connect your wallet (top right) to top up credit and create a key.
        </p>
      )}
      {open && account && (
        <div className="enter mt-4 grid gap-5">
          <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-line p-4">
            <div>
              <p className="eyebrow">Credit</p>
              <p className="num mt-1 text-2xl text-text">
                {data ? near(data.credit) : "…"}
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label>
                <span className="eyebrow !text-[10px]">Amount</span>
                <input
                  type="number"
                  step="0.1"
                  min={0.1}
                  max={10}
                  className="field num mt-1 w-24 !py-1.5"
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                />
              </label>
              <button
                className="btn btn-primary !py-1.5 text-xs"
                disabled={!!topUp.step || amount < 0.1 || amount > 10}
                onClick={() => topUp.run({ amount }, amount)}
              >
                {topUp.step ? "Working…" : `Top up ${amount || 0} Ⓝ`}
              </button>
              <button
                className="btn btn-ghost !py-1.5 text-xs"
                disabled={!data?.credit}
                onClick={async () => {
                  const res = await fetch("/api/live/credit/withdraw", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: "{}",
                  });
                  const d = await res.json().catch(() => ({}));
                  setMsg(
                    res.ok
                      ? `Sent ${d.amount} Ⓝ back to your wallet.`
                      : d.error || "Withdrawal failed.",
                  );
                  load();
                }}
              >
                Withdraw all
              </button>
            </div>
            <div className="w-full">
              <PayStatus
                step={topUp.step}
                error={topUp.error}
                pending={topUp.pending}
                retry={topUp.retry}
              />
              {msg && <p className="mt-2 text-xs text-ok">{msg}</p>}
            </div>
          </div>

          <div>
            <p className="eyebrow">API keys</p>
            <ul className="mt-2 grid gap-1.5">
              {data?.keys.map((k) => (
                <li
                  key={k.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-xs"
                >
                  <span className="min-w-0">
                    <span className="num text-text">{k.prefix}…</span>{" "}
                    <span className="text-muted">{k.label}</span>
                    <span className="block text-faint">
                      {k.lastUsedAt
                        ? `last used ${new Date(k.lastUsedAt).toLocaleString()}`
                        : "never used"}
                    </span>
                  </span>
                  <button
                    className="text-bad hover:underline"
                    onClick={async () => {
                      await fetch(`/api/live/keys?id=${k.id}`, {
                        method: "DELETE",
                      });
                      load();
                    }}
                  >
                    Revoke
                  </button>
                </li>
              ))}
              {data && !data.keys.length && (
                <li className="text-xs text-faint">No keys yet.</li>
              )}
            </ul>
            <div className="mt-2 flex gap-2">
              <input
                className="field !py-1.5 text-xs"
                placeholder="Label, e.g. Claude Code"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
              <button
                className="btn btn-ghost shrink-0 !py-1.5 text-xs"
                onClick={async () => {
                  const res = await fetch("/api/live/keys", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ label }),
                  });
                  const d = await res.json().catch(() => ({}));
                  if (res.ok) {
                    setFresh(d.key);
                    setLabel("");
                    load();
                  } else setMsg(d.error || "Couldn't create a key.");
                }}
              >
                Create key
              </button>
            </div>
            {fresh && (
              <div className="mt-3 rounded-lg border border-accent/50 bg-accent/8 p-3 text-xs">
                <p className="font-semibold text-accent">
                  Copy this key now: it won&apos;t be shown again.
                </p>
                <code className="num mt-1 block break-all text-text">
                  {fresh}
                </code>
              </div>
            )}
          </div>

          <div>
            <p className="eyebrow">Connect</p>
            <p className="mt-2 text-xs text-muted">Claude Code:</p>
            <pre className="num mt-1 overflow-x-auto rounded-lg border border-line bg-bg p-3 text-[11px] leading-relaxed">{`claude mcp add --transport http swarm-for-hire ${url} \\\n  --header "Authorization: Bearer ${keyText}"`}</pre>
            <p className="mt-3 text-xs text-muted">
              Any MCP client (JSON config):
            </p>
            <pre className="num mt-1 overflow-x-auto rounded-lg border border-line bg-bg p-3 text-[11px] leading-relaxed">
              {JSON.stringify(
                {
                  mcpServers: {
                    "swarm-for-hire": {
                      type: "http",
                      url,
                      headers: { Authorization: `Bearer ${keyText}` },
                    },
                  },
                },
                null,
                2,
              )}
            </pre>
            <p className="mt-3 text-xs text-muted">
              Then ask your AI:{" "}
              <span className="text-text">
                &ldquo;Use swarm-for-hire to get three README tips for my
                hackathon project, budget 0.3 NEAR.&rdquo;
              </span>{" "}
              Tools: list_agents, balance, post_job, wait_for_round, get_round,
              my_jobs, back_agent.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
