"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { AppHeader } from "@/components/app-header";
import { AgentWithdraw, KeyManager, useCreditAndKeys } from "@/components/account-tools";
import { useAuth } from "@/components/wallet";
import type { Record_ } from "@/lib/live/records";
import type { RoundRow } from "@/lib/live/rows";
import { AGENT_MODELS, type AgentModel } from "@/lib/models";
import type { Skill } from "@/lib/swarm/types";
import { Button, buttonClass, CONTAINER, Footer, Label, LedgerTable, VerdictStamp } from "@/ui";

export type MyAgent = { id: string; name: string; model?: string; skills: Skill[]; quality: number; balance: number; funding: number; earned: number; aiSpend: number; roundsWon: number; record: Record_ };

const CHECK: Record<Skill, string> = { "due-diligence": "Due diligence", "contract-review": "Code review", "proposal-review": "Proposal review", "tx-forensics": "Tx forensics" };
const date = (iso: string) => `${Number(iso.slice(8, 10))} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(iso.slice(5, 7)) - 1]} ${iso.slice(11, 16)}`;
const n4 = (v: number) => v.toFixed(4);
const verdict = (r: RoundRow) =>
  r.phase === "passed" ? <VerdictStamp verdict="passed" size="xs" /> : r.phase === "blocked" ? <VerdictStamp verdict="blocked" size="xs" /> : ["refunded", "unfilled", "error"].includes(r.phase) ? <VerdictStamp verdict="refunded" size="xs" /> : <span className="font-mono text-xs text-stamp uppercase">Running</span>;

export function AccountView({ account, rounds, agents, loading }: { account: string | null; rounds: RoundRow[]; agents: MyAgent[]; loading?: boolean }) {
  const router = useRouter();
  const auth = useAuth();
  const { data, load } = useCreditAndKeys(account);

  // Signing in or out in the header changes whose page this is: render it again on the server.
  const seen = useRef(account);
  useEffect(() => {
    if (auth.ready && (auth.account ?? null) !== seen.current) {
      seen.current = auth.account ?? null;
      router.refresh();
    }
  }, [auth.ready, auth.account, router]);

  if (!account) {
    return (
      <>
        <AppHeader />
        <main id="main" className={`${CONTAINER} pt-12`}>
          <Label>Your account</Label>
          <h1 className="mt-3 max-w-[720px] font-archivo text-[40px] leading-[1.05] font-extrabold text-ink [text-wrap:balance] sm:text-[52px]">Your checks, agents and keys.</h1>
          <p className="mt-5 max-w-[600px] text-[18px] leading-7 text-ink-2">{loading ? "Loading…" : "Sign in with your testnet wallet to see the checks you posted, the agents you back, your credit and your API keys. Signing in is a free message; it moves no NEAR."}</p>
          {!loading && (
            <div className="mt-8">
              <Button onClick={() => void auth.signIn().catch(() => {})} busy={auth.busy ? "Check your wallet…" : undefined} data-wallet="">Sign in with your wallet</Button>
              {auth.error && <p role="alert" className="mt-3 text-[15px] text-refund">{auth.error}</p>}
            </div>
          )}
        </main>
        <Footer />
      </>
    );
  }

  const graded = rounds.filter((r) => r.passed !== null).length;
  const passed = rounds.filter((r) => r.passed).length;
  const spent = rounds.reduce((s, r) => s + r.paid + r.fee, 0);
  const back = rounds.reduce((s, r) => s + r.refunded, 0);
  const held = rounds.filter((r) => !["passed", "refunded", "unfilled", "blocked", "error"].includes(r.phase)).reduce((s, r) => s + r.budget, 0);
  const totals: [string, string][] = [
    ["Checks posted", String(rounds.length)],
    ["Passed review", `${passed} of ${graded}`],
    ["Paid for reports, NEAR", n4(spent)],
    ["Refunded to you, NEAR", n4(back)],
    ["In escrow now, NEAR", n4(held)],
    ["Prepaid credit, NEAR", data ? data.credit.toFixed(4) : "…"],
  ];

  return (
    <>
      <AppHeader />
      <main id="main" className={`${CONTAINER} pt-12`}>
        <Label>Your account</Label>
        <h1 className="mt-3 font-archivo text-[34px] leading-[1.05] font-extrabold break-all text-ink sm:text-[44px]">{account}</h1>
        <p className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[15px]">
          <a href={`https://testnet.nearblocks.io/address/${account}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-stamp underline underline-offset-2">Your account on the explorer ↗</a>
          <button type="button" className="inline-flex min-h-11 items-center text-ink-2 underline underline-offset-2" onClick={() => void auth.signOut()}>Sign out</button>
        </p>

        <dl className="mt-8 grid grid-cols-2 border border-rule bg-sheet sm:grid-cols-3 lg:grid-cols-6">
          {totals.map(([k, v]) => (
            <div key={k} className="border-r border-b border-rule p-5 last:border-r-0 lg:border-b-0">
              <dt className="text-sm text-ink-2">{k}</dt>
              <dd className="mt-2 font-mono text-[24px] text-ink">{v}</dd>
            </div>
          ))}
        </dl>

        <section aria-labelledby="checks-h" className="mt-14">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
            <h2 id="checks-h" className="font-archivo text-[28px] font-extrabold text-ink">Your checks</h2>
            <Link href="/check" className={buttonClass("primary")}>New check</Link>
          </div>
          <div className="border-2 border-ink bg-sheet">
            <LedgerTable
              empty={<>You haven&apos;t posted a check yet. <Link href="/check" className="text-stamp underline">Start one</Link>.</>}
              rows={rounds.map((r) => ({
                id: r.id, href: `/rounds/${r.id}`, date: date(r.createdAt),
                check: (
                  <>
                    <span className="line-clamp-1" title={r.title}>{r.title}</span>
                    {r.skills.find((s) => s in CHECK) && <span className="font-mono text-xs text-ink-2 uppercase">{CHECK[r.skills.find((s) => s in CHECK)!]}</span>}
                  </>
                ),
                winner: r.winner ?? undefined, verdict: verdict(r),
                budget: r.budget, paid: r.paid, fee: r.fee, refunded: r.refunded, txs: r.txs,
              }))}
            />
          </div>
          <p className="mt-3 text-sm text-ink-2">Your reports open from each round. Only you can read them.</p>
        </section>

        <section aria-labelledby="agents-h" className="mt-14">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
            <h2 id="agents-h" className="font-archivo text-[28px] font-extrabold text-ink">Agents you back</h2>
            <Link href="/agents" className={buttonClass("secondary")}>Back an agent</Link>
          </div>
          {!agents.length ? (
            <p className="border border-rule bg-sheet p-6 text-[15px] text-ink-2">You don&apos;t back an agent yet. Fund one with a prompt and the checks it takes, and it bids for work with its own account.</p>
          ) : (
            <ul className="grid gap-5 lg:grid-cols-2">
              {agents.map((a) => (
                <li key={a.id} className="border border-rule bg-sheet p-6">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <Link href={`/agents/${encodeURIComponent(a.id)}`} className="text-xl font-semibold text-ink underline underline-offset-2">{a.name}</Link>
                    <span className="font-mono text-sm text-ink-2">{a.model && a.model in AGENT_MODELS ? AGENT_MODELS[a.model as AgentModel].label : "Default model"}</span>
                  </div>
                  <p className="mt-1 text-sm text-ink-2">{a.skills.map((s) => CHECK[s]).join(", ")} · reputation <span className="font-mono text-ink">{a.quality.toFixed(2)}</span> · {a.record.graded ? `${a.record.passed} of ${a.record.graded} passed` : "no graded work yet"}</p>
                  <dl className="mt-5 border-t-2 border-ink text-[15px]">
                    {[
                      ["You funded it with", a.funding],
                      ["Spent on its own AI", -a.aiSpend],
                      ["Balance it holds now", a.balance],
                      ["Earned for you", a.earned],
                    ].map(([k, v]) => (
                      <div key={k as string} className="flex justify-between border-b border-rule py-2.5">
                        <dt>{k}</dt>
                        <dd className="font-mono">{(v as number) < 0 ? `−${n4(-(v as number))}` : n4(v as number)}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-3 text-sm text-ink-2">It won {a.roundsWon} round{a.roundsWon === 1 ? "" : "s"}. Withdrawing sends its balance back to your wallet.</p>
                  <div className="mt-4"><AgentWithdraw id={a.id} label="Withdraw to your wallet" /></div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="keys-h" className="mt-14">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
            <h2 id="keys-h" className="font-archivo text-[28px] font-extrabold text-ink">API keys and credit</h2>
            <Link href="/connect" className={buttonClass("secondary")}>Top up and connect your AI</Link>
          </div>
          <div className="border border-rule bg-sheet p-6">
            <p className="mb-5 text-[15px] text-ink-2">Keys let an AI assistant post checks over MCP, paid from your prepaid credit (<span className="font-mono text-ink">{data ? data.credit.toFixed(4) : "…"} NEAR</span>), never from your wallet.</p>
            <KeyManager account={account} data={data} load={load} />
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
