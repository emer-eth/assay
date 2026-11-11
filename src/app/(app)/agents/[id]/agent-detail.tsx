"use client";

import { explorerAccount } from "@/lib/network";
import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { AgentWithdraw, withdrawable } from "@/components/account-tools";
import { useMarket } from "@/lib/market";
import type { Record_ } from "@/lib/live/records";
import type { RoundRow } from "@/lib/live/rows";
import { AGENT_MODELS, type AgentModel } from "@/lib/models";
import { START_QUALITY } from "@/lib/swarm/round";
import { SKILLS, type Skill } from "@/lib/swarm/types";
import { CONTAINER, Footer, Label, LedgerTable, Sheet, Tag, TxLink, VerdictStamp } from "@/ui";
import { RepBar, recordText } from "../agents-view";

type Agent = { id: string; name: string; model?: string; skills: Skill[]; quality: number; skillQuality?: Partial<Record<Skill, number>>; balance: number; backer: string; prompt: string; earned: number; funding: number; createdTx?: string };
const CHECK: Record<Skill, string> = { "due-diligence": "Due diligence", "contract-review": "Code review", "proposal-review": "Proposal review", "tx-forensics": "Tx forensics" };
const date = (iso: string) => `${Number(iso.slice(8, 10))} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(iso.slice(5, 7)) - 1]} ${iso.slice(11, 16)}`;

export function AgentDetail({ agent: initial, record, rounds, mine }: { agent: Agent; record: Record_; rounds: RoundRow[]; mine: boolean }) {
  const live = useMarket((s) => s?.agents.find((a) => a.id === initial.id));
  const a = live ? { ...initial, quality: live.quality, skillQuality: live.skillQuality, balance: live.balance, earned: live.earned } : initial;
  const model = a.model && a.model in AGENT_MODELS ? AGENT_MODELS[a.model as AgentModel] : AGENT_MODELS["Qwen/Qwen3.6-35B-A3B-FP8"];

  return (
    <>
      <AppHeader />
      <main id="main" className={`${CONTAINER} pt-10`}>
        <nav aria-label="Breadcrumb" className="font-mono text-sm text-ink-2">
          <Link href="/agents" className="inline-flex min-h-11 items-center text-stamp underline underline-offset-2">Agents</Link> <span aria-hidden>/</span> {a.name}
        </nav>
        <h1 className="mt-5 font-archivo text-[40px] leading-[1.05] font-extrabold text-ink sm:text-[52px]">{a.name}</h1>
        <p className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[15px] text-ink-2">
          <span className="font-mono text-ink">{model.label}</span>
          <span>Backed by {mine ? "you" : <span className="font-mono">{a.backer}</span>}</span>
          <a href={explorerAccount(a.id)} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center font-mono text-stamp underline underline-offset-2">{a.id} ↗</a>
        </p>

        <div className="mt-10 grid grid-cols-[minmax(0,1fr)] items-start gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-12">
            <section aria-labelledby="rep-h">
              <Label as="h2" className="mb-3"><span id="rep-h">Record by check</span></Label>
              <table className="w-full border-collapse text-[15px]">
                <caption className="sr-only">Reputation and graded work for each check this agent takes</caption>
                <thead className="border-y-2 border-t-ink border-b-rule text-sm text-ink-2">
                  <tr><th scope="col" className="py-3 text-left font-normal">Check</th><th scope="col" className="py-3 text-left font-normal">Reputation</th><th scope="col" className="py-3 text-right font-normal">Graded work</th></tr>
                </thead>
                <tbody>
                  {SKILLS.filter((s) => a.skills.includes(s)).map((s) => {
                    const r = record.bySkill[s] ?? { graded: 0, passed: 0 };
                    return (
                      <tr key={s} className="border-b border-rule">
                        <th scope="row" className="py-4 text-left font-semibold">{CHECK[s]}</th>
                        <td className="py-4"><RepBar value={a.skillQuality?.[s] ?? START_QUALITY} /></td>
                        <td className={`py-4 text-right ${r.graded && !r.passed ? "text-refund" : ""}`}>{recordText({ ...r, bySkill: {} })}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-3 text-sm text-ink-2">Each round is won on the reputation in its own check. Overall: <span className="font-mono text-ink">{a.quality.toFixed(2)}</span>, {recordText(record).toLowerCase()}.</p>
            </section>

            <Sheet label="How it works, in its backer's words">
              <p className="text-[16px] leading-[26px] whitespace-pre-wrap text-ink">{a.prompt}</p>
            </Sheet>

          </div>

          <aside className="space-y-6 border border-rule bg-sheet p-7" aria-label="Money">
            <div>
              <Label as="h2">Checks it takes</Label>
              <p className="mt-3 flex flex-wrap gap-2">{a.skills.map((s) => <Tag key={s}>{CHECK[s]}</Tag>)}</p>
            </div>
            <dl className="border-t-2 border-ink">
              {[["Balance for its AI", a.balance], ["Funded with", a.funding], ["Earned for its backer", a.earned]].map(([k, v]) => (
                <div key={k as string} className="flex justify-between border-b border-rule py-3 text-[15px]"><dt>{k}</dt><dd className="font-mono">{(v as number).toFixed(4)}</dd></div>
              ))}
            </dl>
            {a.createdTx && <TxLink label="Created and funded" hash={a.createdTx} />}
            {mine && <AgentWithdraw id={a.id} amount={withdrawable(a.earned, a.balance)} />}
          </aside>
        </div>
        <section aria-labelledby="won-h" className="mt-14">
          <Label as="h2" className="mb-3"><span id="won-h">Rounds it won</span></Label>
          <div className="border-2 border-ink bg-sheet">
            <LedgerTable
              empty="It hasn't won a round yet."
              rows={rounds.map((r) => ({
                id: r.id, href: `/rounds/${r.id}`, date: date(r.createdAt),
                check: <span className="line-clamp-1" title={r.title}>{r.title}</span>,
                winner: a.name,
                verdict: r.phase === "passed" ? <VerdictStamp verdict="passed" size="xs" /> : r.phase === "blocked" ? <VerdictStamp verdict="blocked" size="xs" /> : ["refunded", "unfilled", "error"].includes(r.phase) ? <VerdictStamp verdict="refunded" size="xs" /> : <span className="font-mono text-xs text-stamp uppercase">Running</span>,
                budget: r.budget, paid: r.paid, fee: r.fee, refunded: r.refunded, txs: r.txs,
              }))}
            />
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
