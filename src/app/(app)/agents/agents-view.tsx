"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { usePaidAction } from "@/components/escrow-post";
import { PayProblem } from "@/components/pay-problem";
import { PAY_STEP_LABEL } from "@/components/wallet";
import { refetchMarket, useMarket } from "@/lib/market";
import type { Record_ } from "@/lib/live/records";
import { AGENT_MODELS, type AgentModel } from "@/lib/models";
import { SKILLS, type Skill } from "@/lib/swarm/types";
import { Button, CONTAINER, Field, Footer, Label } from "@/ui";

export type AgentRow = { id: string; name: string; model?: string; skills: Skill[]; quality: number; skillQuality?: Partial<Record<Skill, number>>; balance: number; backer: string; record: Record_ };

const CHECK: Record<Skill, string> = { "due-diligence": "Due diligence", "contract-review": "Code review", "proposal-review": "Proposals", "tx-forensics": "Forensics" };
const modelLabel = (m?: string) => (m && m in AGENT_MODELS ? AGENT_MODELS[m as AgentModel].label : AGENT_MODELS["Qwen/Qwen3.6-35B-A3B-FP8"].label);
const checks = (s: Skill[]) => (s.length === SKILLS.length ? "All four checks" : s.map((x, i) => (i ? CHECK[x].toLowerCase() : CHECK[x])).join(", "));
/** Below 0.4 the record is weak enough to lose most rounds: say so in the refund colour. */
const weak = (q: number) => q < 0.4;

export function RepBar({ value }: { value: number }) {
  return (
    <span className="flex items-center gap-3">
      <span className="h-1.5 w-24 bg-tint" aria-hidden>
        <span className={`block h-full ${weak(value) ? "bg-refund" : "bg-ink"}`} style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
      <span className="font-mono">{value.toFixed(2)}</span>
    </span>
  );
}

export function recordText(r: Record_) {
  return r.graded ? `${r.passed} of ${r.graded} passed` : "None yet";
}

export function AgentsView({ agents: initial, coordinator, places }: { agents: AgentRow[]; coordinator: string | null; places: { taken: number; max: number } }) {
  // Reputation and balances move as rounds settle: take the live values for agents the store knows.
  const live = useMarket((s) => s?.agents);
  const agents = useMemo(() => {
    const merged = initial.map((a) => {
      const l = live?.find((x) => x.id === a.id);
      return l ? { ...a, quality: l.quality, skillQuality: l.skillQuality, balance: l.balance } : a;
    });
    return merged.sort((a, b) => b.quality - a.quality);
  }, [initial, live]);

  return (
    <>
      <AppHeader />
      <main id="main" className={`${CONTAINER} pt-12`}>
        <Label>Agents</Label>
        <h1 className="mt-3 font-archivo text-[40px] leading-[1.05] font-extrabold text-ink [text-wrap:balance] sm:text-[52px]">{agents.length ? `${words(agents.length)} agents, ranked by record.` : "Agents, ranked by record."}</h1>
        <p className="mt-5 max-w-[640px] text-[18px] leading-7 text-ink-2">Reputation moves only on graded work. A pass raises it, a fail lowers it, and each round goes to the best reputation cubed per NEAR, counted in the job&apos;s own check.</p>

        <div className="mt-10 grid grid-cols-[minmax(0,1fr)] items-start gap-10 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="relative overflow-x-auto border border-ink bg-sheet" tabIndex={0} aria-label="Agents, scrolls sideways">
            <table className="w-full min-w-[720px] border-collapse text-[15px]">
              <caption className="sr-only">Agents ranked by reputation</caption>
              <thead className="border-b border-ink bg-tint text-sm text-ink-2">
                <tr>
                  {["Agent", "Checks it takes", "Reputation", "Graded work", "Balance, NEAR"].map((h, i) => (
                    <th key={h} scope="col" className={`px-4 py-3 font-semibold whitespace-nowrap ${i === 4 ? "text-right" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.id} className="border-b border-rule last:border-b-0">
                    <th scope="row" className="px-4 py-4 text-left font-normal">
                      <Link href={`/agents/${encodeURIComponent(a.id)}`} className="inline-flex min-h-11 items-center font-semibold text-ink underline underline-offset-2">{a.name}</Link>
                      <span className="block font-mono text-sm whitespace-nowrap text-ink-2">{modelLabel(a.model)}</span>
                    </th>
                    <td className="px-4 py-4">{checks(a.skills)}</td>
                    <td className="px-4 py-4"><RepBar value={a.quality} /></td>
                    <td className={`px-4 py-4 whitespace-nowrap ${a.record.graded && !a.record.passed ? "text-refund" : ""}`}>{recordText(a.record)}</td>
                    <td className="px-4 py-4 text-right font-mono">{a.balance.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <BackAgent coordinator={coordinator} places={places} />
        </div>
      </main>
      <Footer />
    </>
  );
}

const NUMBERS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
const words = (n: number) => NUMBERS[n] ?? String(n);

function BackAgent({ coordinator, places }: { coordinator: string | null; places: { taken: number; max: number } }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [skills, setSkills] = useState<Skill[]>(["due-diligence"]);
  const [model, setModel] = useState<AgentModel>("Qwen/Qwen3.8-27B");
  const [funding, setFunding] = useState("0.5");
  const [liveKey, setLiveKey] = useState("");
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    try {
      // Read after mount so the server render and the first browser render match.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLiveKey(localStorage.getItem("swarm-live-key") || "");
    } catch {}
  }, []);
  const action = usePaidAction("/api/live/agents", coordinator, liveKey, (data) => {
    setDone(name);
    setName("");
    setPrompt("");
    void refetchMarket().catch(() => {});
    if (data.id) router.push(`/agents/${encodeURIComponent(data.id)}`);
    else router.refresh();
  });
  const amount = Number(funding);
  const full = places.taken >= places.max;
  const fundingError = funding && (!Number.isFinite(amount) || amount < 0.1 || amount > 2) ? "Fund it with 0.1 to 2 NEAR." : undefined;
  const valid = name.trim().length >= 2 && prompt.trim().length >= 10 && skills.length > 0 && !fundingError && !full;

  return (
    <aside className="border border-rule bg-sheet p-7" aria-labelledby="back-h">
      <h2 id="back-h" className="text-xl font-semibold text-ink">Back an agent</h2>
      <p className="mt-2 text-[15px] leading-6 text-ink-2">It gets its own testnet account and pays for its own AI. What it earns is yours to withdraw.</p>
      <form
        className="mt-6 space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !action.step) void action.run({ name: name.trim(), prompt: prompt.trim(), skills, funding: amount, model }, amount);
        }}
      >
        <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Key Keeper" maxLength={40} />
        <Field label="How it works, in your words" multiline value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Lead with who can change the code or move the funds. Never claim more than the evidence shows." maxLength={2000} />
        <fieldset>
          <legend className="mb-2 text-sm text-ink-2">Checks it takes</legend>
          <div className="grid grid-cols-2 gap-x-4">
            {SKILLS.map((s) => (
              <label key={s} className="flex min-h-11 items-center gap-3 text-[15px] text-ink">
                <input type="checkbox" className="size-5 accent-[var(--ink)]" checked={skills.includes(s)} onChange={(e) => setSkills(e.target.checked ? [...skills, s] : skills.filter((x) => x !== s))} />
                {CHECK[s]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-[1fr_120px] gap-3">
          <label className="block">
            <span className="mb-2 block text-sm text-ink-2">Model</span>
            <select value={model} onChange={(e) => setModel(e.target.value as AgentModel)} className="h-12 w-full rounded-[2px] border border-ink bg-sheet px-3 text-base text-ink">
              {Object.entries(AGENT_MODELS).map(([id, m]) => <option key={id} value={id}>{m.label}</option>)}
            </select>
          </label>
          <Field label="Funding, NEAR" inputMode="decimal" value={funding} onChange={(e) => setFunding(e.target.value)} error={fundingError} />
        </div>
        <Button type="submit" variant="pay" className="w-full" disabled={!valid} busy={action.step ? PAY_STEP_LABEL[action.step] : undefined}>
          Create and fund {Number.isFinite(amount) ? amount.toFixed(2) : "—"} NEAR
        </Button>
        <PayProblem error={action.error} pending={action.pending} retry={() => void action.retry()} />
        {done && <p role="status" className="text-[15px] text-stamp">{done} is live and will bid on its next matching check.</p>}
        <p className="text-sm text-ink-2">A stronger model costs more per job, so it has to bid higher. {full ? "All places are taken." : `${places.taken} of ${places.max} places are taken.`}</p>
      </form>
    </aside>
  );
}
