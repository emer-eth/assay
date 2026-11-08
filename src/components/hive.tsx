// The swarm graph: the job in the middle, agents around it, and each agent's line to the job showing
// what it's doing in the selected round (thinking, bid, won, paid, failed).

export type CellState =
  "idle" | "eligible" | "thinking" | "bid" | "winner" | "paid" | "failed";
export type Cell = {
  id: string;
  label: string;
  detail: string;
  state: CellState;
  rep: number;
  tag?: string;
};
export type Center = {
  title: string;
  sub?: string;
  tone?: "idle" | "live" | "ok" | "bad";
};

const WHITE = (a: number) => `rgba(255,255,255,${a})`;
const STYLE: Record<
  CellState,
  {
    node: string;
    edge: string;
    edgeWidth: number;
    dash?: string;
    text: string;
    flow?: boolean;
    halo?: string;
  }
> = {
  idle: {
    node: WHITE(0.12),
    edge: WHITE(0.045),
    edgeWidth: 1,
    text: "var(--faint)",
  },
  eligible: {
    node: WHITE(0.32),
    edge: WHITE(0.14),
    edgeWidth: 1,
    dash: "2 5",
    text: "var(--muted)",
  },
  thinking: {
    node: "var(--accent)",
    edge: "var(--accent)",
    edgeWidth: 1.25,
    dash: "4 6",
    text: "var(--accent)",
    flow: true,
  },
  bid: {
    node: WHITE(0.55),
    edge: WHITE(0.38),
    edgeWidth: 1,
    text: "var(--text)",
  },
  winner: {
    node: "var(--accent)",
    edge: "var(--accent)",
    edgeWidth: 1.75,
    text: "var(--text)",
    halo: "var(--accent)",
  },
  paid: {
    node: "var(--ok)",
    edge: "var(--ok)",
    edgeWidth: 1.75,
    text: "var(--text)",
    halo: "var(--ok)",
  },
  failed: {
    node: "var(--bad)",
    edge: "var(--bad)",
    edgeWidth: 1.5,
    dash: "3 4",
    text: "var(--text)",
  },
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

const TONE: Record<NonNullable<Center["tone"]>, string> = {
  idle: WHITE(0.35),
  live: "var(--accent)",
  ok: "var(--ok)",
  bad: "var(--bad)",
};

const initials = (name: string) => {
  const parts = name
    .replace(/[^\p{L}\p{N} -]/gu, "")
    .split(/[\s-]+/)
    .filter(Boolean);
  return (
    (parts[0]?.[0] || "") + (parts[1]?.[0] || parts[0]?.[1] || "")
  ).toUpperCase();
};
const short = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

export function Hive({
  cells,
  center,
  selected,
  onSelect,
  label,
}: {
  cells: Cell[];
  center?: Center;
  size?: number;
  selected?: string | null;
  onSelect?: (id: string) => void;
  label: string;
}) {
  const compact = cells.length > 12;
  const W = 640;
  const H = compact ? 400 : 390;
  const cx = W / 2;
  const cy = H / 2;
  const rx = W / 2 - (compact ? 40 : 70);
  const ry = H / 2 - (compact ? 34 : 64);
  const r = cells.length <= 8 ? 22 : compact ? 15 : 19;
  const pos = cells.map((_, i) => {
    const a = -Math.PI / 2 + (i / Math.max(1, cells.length)) * Math.PI * 2;
    return { x: Math.round((cx + rx * Math.cos(a)) * 100) / 100, y: Math.round((cy + ry * Math.sin(a)) * 100) / 100 };
  });
  const tone = TONE[center?.tone ?? "idle"];

  if (!cells.length)
    return (
      <p className="py-10 text-center text-sm text-muted">No agents yet.</p>
    );
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label={label}
    >
      {/* edges first, so nodes sit on top */}
      {cells.map((c, i) => {
        const s = STYLE[c.state];
        return (
          <line
            key={`e-${c.id}`}
            x1={pos[i].x}
            y1={pos[i].y}
            x2={cx}
            y2={cy}
            stroke={s.edge}
            strokeWidth={s.edgeWidth}
            strokeDasharray={s.dash}
            className={s.flow ? "edge-flow" : undefined}
            style={{ transition: "stroke 300ms, stroke-width 300ms" }}
          />
        );
      })}

      {/* the job */}
      <g>
        <rect
          x={cx - 74}
          y={cy - 30}
          width={148}
          height={60}
          rx={12}
          fill="var(--panel-2)"
          stroke={WHITE(0.14)}
        />
        <circle
          cx={cx - 56}
          cy={cy - 12}
          r={3}
          fill={tone}
          className={center?.tone === "live" ? "hex-thinking" : undefined}
        />
        <text
          x={cx - 48}
          y={cy - 8}
          fontSize={11}
          fill="var(--muted)"
          style={{ fontFamily: "var(--font-code)" }}
        >
          {short(center?.title ?? "No job yet", 18)}
        </text>
        <text
          x={cx - 60}
          y={cy + 15}
          fontSize={13}
          fontWeight={500}
          fill="var(--text)"
        >
          {short(center?.sub ?? "Waiting for a job", 19)}
        </text>
      </g>

      {/* agents */}
      {cells.map((c, i) => {
        const s = STYLE[c.state];
        const { x, y } = pos[i];
        const isSel = selected === c.id;
        const below = y >= cy;
        return (
          <g
            key={c.id}
            className={`${c.state === "thinking" ? "hex-thinking" : ""} ${onSelect ? "cursor-pointer" : ""}`}
            onClick={onSelect ? () => onSelect(c.id) : undefined}
          >
            <title>{`${c.label} · ${STATE_LABEL[c.state]} · reputation ${c.rep.toFixed(2)} · ${c.detail}`}</title>
            {s.halo && (
              <circle
                cx={x}
                cy={y}
                r={r + 5}
                fill="none"
                stroke={s.halo}
                strokeOpacity={0.25}
              />
            )}
            <circle
              cx={x}
              cy={y}
              r={r}
              fill="var(--panel)"
              stroke={isSel ? "var(--text)" : s.node}
              strokeWidth={isSel ? 1.75 : 1.25}
              style={{ transition: "stroke 300ms" }}
            />
            <text
              x={x}
              y={y + (compact ? 4 : 4.5)} className="graph-initials"
              textAnchor="middle"
              fontSize={compact ? 11 : 12.5}
              fontWeight={600}
              fill={s.text}
              style={{ fontFamily: "var(--font-code)" }}
            >
              {c.tag ?? initials(c.label)}
            </text>
            {!compact && (
              <g className="graph-label">
                <text
                  x={x}
                  y={below ? y + r + 16 : y - r - 18}
                  textAnchor="middle"
                  fontSize={11.5}
                  fill={c.state === "idle" ? "var(--faint)" : "var(--text)"}
                >
                  {short(c.label, 16)}
                </text>
                <text
                  x={x}
                  y={below ? y + r + 29 : y - r - 6}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--faint)"
                  style={{ fontFamily: "var(--font-code)" }}
                >
                  rep {c.rep.toFixed(2)}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function HiveLegend({ states }: { states: CellState[] }) {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted">
      {states.map((st) => {
        const s = STYLE[st];
        return (
          <li key={st} className="flex items-center gap-2">
            <svg width="26" height="10" viewBox="0 0 26 10" aria-hidden>
              <line
                x1="0"
                y1="5"
                x2="16"
                y2="5"
                stroke={s.edge}
                strokeWidth={s.edgeWidth}
                strokeDasharray={s.dash}
              />
              <circle
                cx="21"
                cy="5"
                r="4"
                fill="var(--panel)"
                stroke={s.node}
                strokeWidth="1.25"
              />
            </svg>
            {STATE_LABEL[st]}
          </li>
        );
      })}
    </ul>
  );
}
