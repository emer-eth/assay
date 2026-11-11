"use client";

import { useCallback, useEffect, useState } from "react";
import { refetchMarket } from "@/lib/market";
import { Button, explorerTx, Field } from "@/ui";

// Account pieces shared by /connect and /account: prepaid credit and API keys, and an agent's withdraw.
// The API calls are the ones the classic "Use from your AI" panel made.

export type KeyRow = { id: string; label: string; prefix: string; createdAt: string; lastUsedAt?: string };
export type CreditData = { credit: number; keys: KeyRow[] };

/** The signed-in account's credit and keys (null until loaded, or when nobody is signed in). */
export function useCreditAndKeys(account: string | null) {
  const [data, setData] = useState<CreditData | null>(null);
  const load = useCallback(async () => {
    const res = await fetch("/api/live/credit", { cache: "no-store" });
    if (res.ok) setData(await res.json());
  }, []);
  useEffect(() => {
    // Credit and keys belong to whoever is signed in, so they're read in the browser once the account is known.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (account) void load();
    else setData(null);
  }, [account, load]);
  return { data, load };
}

/** Create, show once, list and revoke API keys. `onFresh` hears the new key (Connect puts it in the command). */
export function KeyManager({ account, data, load, onFresh }: { account: string | null; data: CreditData | null; load: () => Promise<void>; onFresh?: (key: string) => void }) {
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div>
      <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={async (e) => {
        e.preventDefault();
        setMsg(null);
        const res = await fetch("/api/live/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label }) });
        const d = await res.json().catch(() => ({}));
        if (res.ok) {
          setFresh(d.key);
          onFresh?.(d.key);
          setLabel("");
          void load();
        } else setMsg(d.error || "Couldn't create a key.");
      }}>
        <Field className="flex-1" label="Label, so you know which client uses it" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Claude on my laptop" disabled={!account} maxLength={60} />
        <Button type="submit" variant="secondary" disabled={!account}>Create key</Button>
      </form>
      <p className="mt-3 text-[15px] text-ink-2">The key is shown once and stored only as a hash. You can hold 5 keys and revoke any of them.</p>
      {msg && <p role="alert" className="mt-3 text-[15px] text-refund">{msg}</p>}
      {fresh && (
        <div role="status" className="mt-4 border-l-4 border-stamp bg-stamp-tint px-4 py-3">
          <p className="font-semibold text-ink">Copy this key now. It won&apos;t be shown again.</p>
          <code className="mt-1 block font-mono text-sm break-all text-ink">{fresh}</code>
        </div>
      )}
      {!!data?.keys.length && (
        <ul className="mt-5 border-t border-rule">
          {data.keys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-rule py-3 text-[15px]">
              <span><span className="font-mono">{k.prefix}…</span> {k.label} <span className="block text-sm text-ink-2">{k.lastUsedAt ? `Last used ${k.lastUsedAt.slice(0, 16).replace("T", " ")} UTC` : "Never used"}</span></span>
              <button type="button" className="min-h-11 text-refund underline underline-offset-2" onClick={async () => { await fetch(`/api/live/keys?id=${k.id}`, { method: "DELETE" }); void load(); }}>Revoke<span className="sr-only"> {k.label}</span></button>
            </li>
          ))}
        </ul>
      )}
      {data && !data.keys.length && <p className="mt-4 text-[15px] text-ink-2">No keys yet.</p>}
    </div>
  );
}

/** The agent profit a backer can take now, as the withdraw endpoint computes it: what it earned, keeping 0.05 NEAR for its AI. */
export const withdrawable = (earned: number, balance: number) => Math.max(0, Math.floor(Math.min(earned, balance - 0.05) * 1e4) / 1e4);

/** The backer takes an agent's profit back to their wallet (the existing withdraw endpoint). With `amount`
 *  known up front, an agent with nothing to take says so instead of offering a button that would fail. */
export function AgentWithdraw({ id, label = "Withdraw its profit", amount, compact }: { id: string; label?: string; amount?: number; compact?: boolean }) {
  const [s, setS] = useState<{ busy?: boolean; error?: string; hash?: string; sent?: number }>({});
  if (s.hash) return <a className="inline-flex min-h-11 items-center text-[15px] whitespace-nowrap text-stamp underline" href={explorerTx(s.hash)} target="_blank" rel="noreferrer">Sent {s.sent?.toFixed(4)} ↗</a>;
  if (amount !== undefined && amount <= 0) return <span className="text-sm whitespace-nowrap text-ink-2">Nothing to withdraw yet</span>;
  return (
    <div>
      <Button variant="secondary" className={compact ? "min-h-11 px-3 text-sm" : ""} busy={s.busy ? "Sending…" : undefined} onClick={async () => {
        setS({ busy: true });
        const res = await fetch(`/api/live/agents/${encodeURIComponent(id)}/withdraw`, { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setS({ hash: data.hash, sent: data.amount });
          void refetchMarket().catch(() => {});
        } else setS({ error: data.error || "Withdrawal failed." });
      }}>{amount !== undefined ? `Withdraw ${amount.toFixed(4)}` : label}</Button>
      {s.error && <p role="alert" className="mt-2 text-sm text-refund">{s.error}</p>}
    </div>
  );
}
