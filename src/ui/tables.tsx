import type { ReactNode } from "react";
import { Label } from "./controls";

const n = (v: number, d = 3) => v.toFixed(d);

export type BidRow = { agent: string; reputation: number; ask?: number; value?: number; winner?: boolean; struck?: boolean };

/** Sealed until bidding closes (hatched cells), then revealed with the winner tinted. */
/** A tint behind a whole row, as a layer per cell, so it can fade with opacity alone (motion rule). */
const Tint = ({ cls = "", delay }: { cls?: string; delay?: number }) => <span aria-hidden className={`tint-layer ${cls}`} style={delay !== undefined ? { animationDelay: `${delay}ms` } : undefined} />;

/** Sealed until bidding closes (hatched cells), then revealed with the winner tinted. `opening` plays the reveal once. */
export function BidTable({ bids, sealed, caption = "Sealed bids", opening }: { bids: BidRow[]; sealed?: boolean; caption?: string; opening?: boolean }) {
  const last = bids.length * 80 + 180; // the winner's tint lands after the last row opens
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[420px] border-collapse text-[15px]">
        <caption className="mb-3 text-left">
          <span className="flex flex-wrap items-baseline justify-between gap-2">
            <Label as="span">{caption}</Label>
            <span className="text-sm text-ink-2">value = reputation cubed ÷ price</span>
          </span>
        </caption>
        <thead className="border-y-2 border-t-ink border-b-rule text-sm text-ink-2">
          <tr>
            <th scope="col" className="py-3 text-left font-normal">Agent</th>
            <th scope="col" className="py-3 text-right font-normal">Reputation</th>
            <th scope="col" className="py-3 text-right font-normal">Ask, NEAR</th>
            <th scope="col" className="py-3 text-right font-normal">Value</th>
          </tr>
        </thead>
        <tbody>
          {bids.map((b, i) => (
            <tr key={b.agent} className={`border-b border-rule [&>*]:relative [&>*]:isolate ${b.struck ? "text-ink-2 line-through" : ""}`}>
              <th scope="row" className={`py-4 text-left font-semibold ${b.winner ? "pl-3" : ""}`}>
                {b.winner && <Tint cls={opening ? "tint-in" : ""} delay={opening ? last : undefined} />}
                {b.agent}
                {b.winner && <span className="ml-2 font-mono text-xs font-medium tracking-[0.08em] text-stamp">WINNER</span>}
              </th>
              <td className="py-4 text-right font-mono">{b.winner && <Tint cls={opening ? "tint-in" : ""} delay={opening ? last : undefined} />}{n(b.reputation, 2)}</td>
              {sealed ? (
                <td colSpan={2} className="py-4 text-right">
                  {b.winner && <Tint />}
                  <span className="sealed-cell inline-block h-4 w-28 align-middle" />
                  <span className="sr-only">sealed</span>
                </td>
              ) : (
                <>
                  <td className="py-4 text-right font-mono">{b.winner && <Tint cls={opening ? "tint-in" : ""} delay={opening ? last : undefined} />}<span className={opening ? "bid-open" : ""} style={opening ? { animationDelay: `${i * 80}ms` } : undefined}>{b.ask !== undefined ? n(b.ask) : "—"}</span></td>
                  <td className={`py-4 text-right font-mono ${b.winner ? "pr-3 font-semibold" : ""}`}>{b.winner && <Tint cls={opening ? "tint-in" : ""} delay={opening ? last : undefined} />}<span className={opening ? "bid-open" : ""} style={opening ? { animationDelay: `${i * 80}ms` } : undefined}>{b.value !== undefined ? b.value.toFixed(2) : "—"}</span></td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type MoneyLine = { label: ReactNode; amount: number };

/** Lines in and out of escrow, closed by a double-ruled balance. Amounts out are shown negative. */
export function MoneyLedger({ lines, total, note }: { lines: MoneyLine[]; total: { label: ReactNode; amount: number }; note?: ReactNode }) {
  return (
    <div>
      <table className="w-full border-collapse text-[15px]">
        <caption className="sr-only">Money for this round, in NEAR</caption>
        <tbody className="border-t-2 border-ink">
          {lines.map((l, i) => (
            <tr key={i} className="border-b border-rule">
              <th scope="row" className="py-3 text-left font-normal">{l.label}</th>
              <td className="py-3 text-right font-mono">{l.amount < 0 ? `−${n(-l.amount, 4)}` : n(l.amount, 4)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="double-rule">
            <th scope="row" className="py-3 text-left font-semibold">{total.label}</th>
            <td className="py-3 text-right font-mono font-semibold">{n(total.amount, 4)}</td>
          </tr>
        </tfoot>
      </table>
      {note && <p className="mt-4 text-sm text-ink-2">{note}</p>}
    </div>
  );
}

export type LedgerRow = { /** finished while the ledger was open: plays the entry once */ fresh?: boolean; id: string; href: string; date: string; check: ReactNode; winner?: string; verdict: ReactNode; budget: number; paid: number; fee: number; refunded: number; txs: number };

/** One balanced line per round, totals in the foot under a double rule. Scrolls sideways in its own box on a phone. */
export function LedgerTable({ rows, empty, loading }: { rows: LedgerRow[]; empty?: ReactNode; loading?: boolean }) {
  const sum = (k: "budget" | "paid" | "fee" | "refunded" | "txs") => rows.reduce((s, r) => s + r[k], 0);
  return (
    <div className="ledger-scroll relative overflow-x-auto" tabIndex={0} aria-label="Ledger, scrolls sideways">
      <table className="w-full min-w-[980px] border-collapse text-[15px]" aria-busy={loading || undefined}>
        <caption className="sr-only">Every round, one balanced line each, in NEAR</caption>
        <thead className="border-y-2 border-t-ink border-b-rule bg-tint text-sm text-ink-2">
          <tr>
            {["Date, UTC", "Round", "Check", "Winner", "Verdict", "Budget", "Paid", "Fee", "Refunded", "On chain"].map((h, i) => (
              <th key={h} scope="col" className={`px-3 py-3 font-normal whitespace-nowrap ${i >= 5 ? "text-right" : "text-left"}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={10} className="px-3 py-8 text-center text-ink-2">Loading the ledger…</td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={10} className="px-3 py-8 text-center text-ink-2">{empty ?? "No rounds match."}</td></tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id} className={`ledger-row border-b border-rule [&>*]:relative [&>*]:isolate ${r.fresh ? "ledger-enter" : ""}`}>
                <td className="px-3 py-3 font-mono text-sm whitespace-nowrap text-ink-2">{r.fresh && <Tint cls="tint-out" />}{r.date}</td>
                <th scope="row" className="px-3 py-3 text-left font-normal"><a href={r.href} className="font-mono text-stamp underline underline-offset-2">{r.id}</a></th>
                <td className="max-w-[340px] px-3 py-3">{r.check}</td>
                <td className="px-3 py-3 whitespace-nowrap">{r.winner ?? "No agent saw it"}</td>
                <td className="px-3 py-3">{r.verdict}</td>
                {(["budget", "paid", "fee", "refunded"] as const).map((k) => (
                  <td key={k} className="px-3 py-3 text-right font-mono">{n(r[k], 4)}</td>
                ))}
                <td className="px-3 py-3 text-right font-mono whitespace-nowrap">{r.txs ? <a href={r.href} className="text-stamp underline underline-offset-2">{r.txs} tx<span className="sr-only"> for round {r.id}</span></a> : "—"}</td>
              </tr>
            ))
          )}
        </tbody>
        {!loading && rows.length > 0 && (
          <tfoot>
            <tr className="double-rule font-semibold">
              <th scope="row" colSpan={5} className="px-3 py-3 text-left">Totals, {rows.length} rounds</th>
              {(["budget", "paid", "fee", "refunded"] as const).map((k) => (
                <td key={k} className="px-3 py-3 text-right font-mono">{n(sum(k), 4)}</td>
              ))}
              <td className="px-3 py-3 text-right font-mono whitespace-nowrap">{sum("txs")} tx</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
