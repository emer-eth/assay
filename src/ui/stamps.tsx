// A verdict is a word. Colour only repeats it: blue outline for a pass, orange outline for a refund, solid ink for a block.

export type Verdict = "passed" | "refunded" | "blocked";
const STYLE: Record<Verdict, string> = {
  passed: "border-stamp text-stamp",
  refunded: "border-refund text-refund",
  blocked: "border-ink bg-ink text-on-ink",
};

export function VerdictStamp({ verdict, size = "md", className = "" }: { verdict: Verdict; size?: "xs" | "sm" | "md"; className?: string }) {
  // xs: the flat badge for tables (no tilt, so rows stay aligned).
  if (size === "xs") return <span className={`stamp-word inline-block border-[1.5px] px-1.5 py-px font-archivo text-[11px] font-extrabold uppercase ${STYLE[verdict]} ${className}`}>{verdict}</span>;
  return (
    <span
      className={`stamp-word inline-block border-[3px] font-archivo font-extrabold uppercase ${size === "sm" ? "px-2.5 py-0.5 text-sm" : "px-3.5 py-[3px] text-[22px] leading-[30px]"} ${STYLE[verdict]} ${className}`}
      style={{ transform: `rotate(${verdict === "refunded" ? 2 : -3}deg)` }}
    >
      {verdict}
    </span>
  );
}

/** The round hallmark. Shown once, on a report that passed review; never decoration. */
export function Hallmark({ size = 112, className = "", land = false }: { size?: number; className?: string; /** play the landing animation (motion step) */ land?: boolean }) {
  const arc = "hallmark-arc"; // identical path wherever it appears, so a shared id is safe
  return (
    <svg width={size} height={size} viewBox="0 0 124 124" role="img" aria-label="Hallmark: passed review" className={`hallmark ${land ? "hallmark-land" : ""} ${className}`} style={{ transform: "rotate(-8deg)" }}>
      <defs>
        <path id={arc} d="M 62 62 m -46 0 a 46 46 0 1 1 92 0 a 46 46 0 1 1 -92 0" />
      </defs>
      <circle cx="62" cy="62" r="59" fill="var(--sheet)" stroke="var(--stamp)" strokeWidth="3" />
      <circle cx="62" cy="62" r="33" fill="none" stroke="var(--stamp)" strokeWidth="1.5" />
      <text fill="var(--stamp)" fontFamily="var(--font-code), ui-monospace, monospace" fontSize="10" fontWeight="600" letterSpacing="1.3">
        <textPath href={`#${arc}`}>ASSAY OFFICE · NEAR TESTNET · PASSED ·</textPath>
      </text>
      <path d="M 48 63 L 58 73 L 78 50" fill="none" stroke="var(--stamp)" strokeWidth="5" strokeLinecap="square" />
    </svg>
  );
}
