// The hive: one hexagon per agent, lit by what it's doing in the selected round.

export type CellState = "idle" | "eligible" | "thinking" | "bid" | "winner" | "paid" | "failed";
export type Cell = { id: string; label: string; detail: string; state: CellState; rep: number; tag?: string };

const STYLE: Record<CellState, { fill: string; stroke: string; text: string; className?: string }> = {
  idle: { fill: "var(--panel)", stroke: "var(--line-strong)", text: "var(--faint)" },
  eligible: { fill: "var(--panel-2)", stroke: "var(--muted)", text: "var(--muted)" },
  thinking: { fill: "color-mix(in srgb, var(--honey) 22%, var(--panel))", stroke: "var(--honey)", text: "var(--honey)", className: "hex-thinking" },
  bid: { fill: "color-mix(in srgb, var(--honey) 12%, var(--panel))", stroke: "color-mix(in srgb, var(--honey) 70%, transparent)", text: "var(--text)" },
  winner: { fill: "var(--honey)", stroke: "var(--honey)", text: "var(--honey-ink)" },
  paid: { fill: "var(--ok)", stroke: "var(--ok)", text: "#06210f" },
  failed: { fill: "color-mix(in srgb, var(--bad) 75%, var(--panel))", stroke: "var(--bad)", text: "#2a0703" },
};

export const STATE_LABEL: Record<CellState, string> = {
  idle: "Idle",
  eligible: "Can bid",
  thinking: "Writing a sealed bid",
  bid: "Bid",
  winner: "Won, working",
  paid: "Paid",
  failed: "Failed review",
};

const initials = (name: string) => {
  const parts = name.replace(/[^\p{L}\p{N} -]/gu, "").split(/[\s-]+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || parts[0]?.[1] || "")).toUpperCase();
};

export function Hive({ cells, size = 30, selected, onSelect, label }: { cells: Cell[]; size?: number; selected?: string | null; onSelect?: (id: string) => void; label: string }) {
  const r = size;
  const w = Math.sqrt(3) * r;
  const cols = Math.max(3, Math.ceil(Math.sqrt(cells.length * 1.4)));
  const pad = 4;
  const pos = cells.map((_, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    return { x: pad + w / 2 + col * w + (row % 2 ? w / 2 : 0), y: pad + r + row * 1.5 * r };
  });
  const rows = Math.max(1, Math.ceil(cells.length / cols));
  const width = pad * 2 + cols * w + (rows > 1 ? w / 2 : 0);
  const height = pad * 2 + 2 * r + (rows - 1) * 1.5 * r;
  const hex = (cx: number, cy: number, rr: number) =>
    Array.from({ length: 6 }, (_, k) => {
      const a = (Math.PI / 180) * (60 * k - 30);
      return `${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`;
    }).join(" ");

  if (!cells.length) return <p className="text-sm text-muted">No agents yet.</p>;
  return (
    <svg viewBox={`0 0 ${width.toFixed(1)} ${height.toFixed(1)}`} className="h-auto w-full max-w-full" role="img" aria-label={label}>
      {cells.map((c, i) => {
        const s = STYLE[c.state];
        const { x, y } = pos[i];
        const isSel = selected === c.id;
        return (
          <g
            key={c.id}
            className={`${s.className ?? ""} ${onSelect ? "cursor-pointer" : ""}`}
            onClick={onSelect ? () => onSelect(c.id) : undefined}
            style={{ transition: "opacity 200ms" }}
          >
            <title>{`${c.label} · ${STATE_LABEL[c.state]} · ${c.detail}`}</title>
            <polygon points={hex(x, y, r - 2.5)} fill={s.fill} stroke={isSel ? "var(--text)" : s.stroke} strokeWidth={isSel ? 2 : 1.25} style={{ transition: "fill 300ms, stroke 300ms" }} />
            {c.state === "winner" && <polygon points={hex(x, y, r + 1)} fill="none" stroke="var(--honey)" strokeOpacity={0.35} strokeWidth={3} />}
            <text x={x} y={y - 1} textAnchor="middle" fontSize={r * 0.42} fontWeight={700} fill={s.text} style={{ fontFamily: "var(--font-code)" }}>
              {c.tag ?? initials(c.label)}
            </text>
            <text x={x} y={y + r * 0.42} textAnchor="middle" fontSize={r * 0.27} fill={s.text} opacity={0.8} style={{ fontFamily: "var(--font-code)" }}>
              {c.rep.toFixed(2)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function HiveLegend({ states }: { states: CellState[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">
      {states.map((st) => (
        <li key={st} className="flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <polygon points="6,0.5 11,3.25 11,8.75 6,11.5 1,8.75 1,3.25" fill={STYLE[st].fill} stroke={STYLE[st].stroke} />
          </svg>
          {STATE_LABEL[st]}
        </li>
      ))}
      <li className="text-faint">number = reputation</li>
    </ul>
  );
}
