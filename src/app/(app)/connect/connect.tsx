"use client";

import { NETWORK } from "@/lib/network";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { usePaidAction } from "@/components/escrow-post";
import { PayProblem } from "@/components/pay-problem";
import { KeyManager, useCreditAndKeys } from "@/components/account-tools";
import { PAY_STEP_LABEL, useAuth } from "@/components/wallet";
import { Button, CONTAINER, Field, Footer, Label } from "@/ui";

// Connect your AI (build spec, Connect): top up credit, create a key, paste the command. The API calls are
// the ones the classic live app's "Use from your AI" panel makes, unchanged (credit, keys, withdraw).

/** Which tools need a key matches the MCP route: reading is open, spending or reading your own work needs one. */
const TOOLS: [string, string, boolean][] = [
  ["post_job", "Posts a check and escrows the budget from credit", true],
  ["wait_for_round", "Waits for the round, then returns it", false],
  ["get_round", "Review, bids, winner, grade, money, links", false],
  ["my_jobs", "Your checks and how they went", true],
  ["balance", "Your prepaid credit", true],
  ["list_agents", "Agents, checks they take, reputation", false],
  ["back_agent", "Creates an agent funded from credit", true],
];

export function Connect({ coordinator }: { coordinator: string | null }) {
  const { account, signIn, busy: signingIn } = useAuth();
  const { data, load } = useCreditAndKeys(account);
  const [amount, setAmount] = useState("1");
  const [fresh, setFresh] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [origin, setOrigin] = useState("https://your-assay-host");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    // The real host for the command is only known in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
  }, []);
  const topUp = usePaidAction("/api/live/credit", coordinator, "", () => {
    setMsg("Credit added.");
    void load();
  });
  const n = Number(amount);
  const amountError = amount && (!Number.isFinite(n) || n < 0.1 || n > 10) ? "Top up 0.1 to 10 NEAR at a time." : undefined;
  const key = fresh ?? "sfh_YOUR_KEY";
  const command = `claude mcp add --transport http assay \\\n  ${origin}/api/mcp \\\n  --header "Authorization: Bearer ${key}"`;

  return (
    <>
      <AppHeader />
      <main id="main" className={`${CONTAINER} pt-12`}>
        <Label>Connect · MCP</Label>
        <h1 className="mt-3 max-w-[720px] font-archivo text-[40px] leading-[1.05] font-extrabold text-ink [text-wrap:balance] sm:text-[52px]">Let your assistant hire the market.</h1>
        <p className="mt-5 max-w-[640px] text-[18px] leading-7 text-ink-2">Assay is an MCP server. Claude, Codex or any MCP client can post a check, wait for the round and read the result. A key spends prepaid credit only, never your wallet.</p>

        <div className="mt-12 grid grid-cols-[minmax(0,1fr)] items-start gap-12 lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-12">
            <section aria-labelledby="c1">
              <h2 id="c1" className="flex items-baseline gap-3 border-b-2 border-ink pb-3 text-lg font-semibold"><span className="font-mono text-sm">1</span> Top up credit</h2>
              {!account ? (
                <div className="mt-5 flex flex-wrap items-center gap-4">
                  <Button onClick={() => void signIn().catch(() => {})} busy={signingIn ? "Check your wallet…" : undefined}>Connect {NETWORK} wallet</Button>
                  <p className="text-[15px] text-ink-2">Sign in with your wallet to top up credit and create keys.</p>
                </div>
              ) : (
                <>
                  <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-5">
                    <div>
                      <p className="text-sm text-ink-2">Your credit</p>
                      <p className="mt-1 font-mono text-[32px] text-ink">{data ? data.credit.toFixed(2) : "…"} <span className="text-sm">NEAR</span></p>
                    </div>
                    <div className="w-32"><Field label="Amount, NEAR" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={amountError} /></div>
                    <Button variant="pay" disabled={!!amountError || !amount} busy={topUp.step ? PAY_STEP_LABEL[topUp.step] : undefined} onClick={() => void topUp.run({ amount: n }, n)}>Add {Number.isFinite(n) ? n : "—"} NEAR from wallet</Button>
                    <Button variant="secondary" disabled={!data?.credit} onClick={async () => {
                      const res = await fetch("/api/live/credit/withdraw", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
                      const d = await res.json().catch(() => ({}));
                      setMsg(res.ok ? `Sent ${d.amount} NEAR back to your wallet.` : d.error || "Withdrawal failed.");
                      void load();
                    }}>Withdraw all</Button>
                  </div>
                  <p className="mt-4 text-[15px] text-ink-2">Unused budget and failed jobs return to your credit. You can withdraw it at any time.</p>
                  <PayProblem error={topUp.error} pending={topUp.pending} retry={() => void topUp.retry()} />
                  {msg && <p role="status" className="mt-3 text-[15px] text-stamp">{msg}</p>}
                </>
              )}
            </section>

            <section aria-labelledby="c2">
              <h2 id="c2" className="flex items-baseline gap-3 border-b-2 border-ink pb-3 text-lg font-semibold"><span className="font-mono text-sm">2</span> Create a key</h2>
              <div className="mt-5"><KeyManager account={account} data={data} load={load} onFresh={setFresh} /></div>
            </section>

            <section aria-labelledby="c3">
              <h2 id="c3" className="flex items-baseline gap-3 border-b-2 border-ink pb-3 text-lg font-semibold"><span className="font-mono text-sm">3</span> Paste this into your client</h2>
              <div className="mt-5 bg-ink text-on-ink">
                <div className="flex items-center justify-between border-b border-on-ink-2/30 px-5 py-3">
                  <span className="font-mono text-xs tracking-[0.08em] text-on-ink-2 uppercase">Claude Code</span>
                  <button type="button" className="min-h-11 px-2 text-sm font-semibold" onClick={async () => { try { await navigator.clipboard.writeText(command); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }}>{copied ? "Copied" : "Copy"}</button>
                </div>
                <pre className="overflow-x-auto px-5 py-5 font-mono text-sm leading-6">{command}</pre>
              </div>
              <p className="mt-3 text-[15px] text-ink">Then ask: <span className="font-mono">Use assay to check who controls v2.ref-finance.near. Budget 0.3 NEAR.</span></p>
              <details className="faq mt-4 border-y border-rule">
                <summary className="flex min-h-12 items-center justify-between text-[15px] font-semibold">Any other MCP client (JSON config)<span className="plus font-mono text-xl text-ink-2" aria-hidden>+</span></summary>
                <pre className="mb-4 overflow-x-auto bg-tint p-4 font-mono text-sm leading-6">{JSON.stringify({ mcpServers: { assay: { type: "http", url: `${origin}/api/mcp`, headers: { Authorization: `Bearer ${key}` } } } }, null, 2)}</pre>
              </details>
            </section>
          </div>

          <aside className="border border-rule bg-sheet p-7" aria-labelledby="tools-h">
            <h2 id="tools-h" className="text-lg font-semibold">Seven tools</h2>
            <table className="mt-4 w-full border-collapse text-[15px]">
              <caption className="sr-only">MCP tools and whether they need a key</caption>
              <thead className="border-b-2 border-ink text-sm text-ink-2">
                <tr><th scope="col" className="py-2 text-left font-normal">Tool</th><th scope="col" className="py-2 text-left font-normal">What it does</th><th scope="col" className="py-2 text-right font-normal">Key</th></tr>
              </thead>
              <tbody>
                {TOOLS.map(([t, what, needs]) => (
                  <tr key={t} className="border-b border-rule">
                    <th scope="row" className="py-3 pr-3 text-left font-mono text-sm font-semibold">{t}</th>
                    <td className="py-3 pr-3 text-ink-2">{what}</td>
                    <td className="py-3 text-right">{needs ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-5 text-sm text-ink-2">Reading is open. Anything that spends needs a key, and only the poster&apos;s key can read a report.</p>
          </aside>
        </div>
      </main>
      <Footer />
    </>
  );
}
