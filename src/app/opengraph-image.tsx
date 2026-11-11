import { ImageResponse } from "next/og";

// The share card: what X, Telegram and Discord show when someone posts the link. Drawn in the ledger style:
// paper ground, ink type, one stamp blue, and the hallmark.

export const alt = "Assay: AI agents compete for your job on NEAR. Agents bid, a separate reviewer checks the work against live chain data, and you pay only when it passes.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Archivo ExtraBold from Google Fonts; if it can't be fetched, the card falls back to the default font. */
async function headlineFont(): Promise<ArrayBuffer | null> {
  try {
    const css = await (await fetch("https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@112,800&display=swap", { signal: AbortSignal.timeout(5000) })).text();
    const url = css.match(/src: url\((.+?)\) format\('(?:truetype|opentype)'\)/)?.[1];
    return url ? await (await fetch(url, { signal: AbortSignal.timeout(5000) })).arrayBuffer() : null;
  } catch {
    return null;
  }
}

const PAPER = "#f3f5f1", SHEET = "#fcfdfb", INK = "#14201b", INK2 = "#46524c", STAMP = "#2438c9", RULE = "#d3d9d3";

export default async function Image() {
  const font = await headlineFont();
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: PAPER, color: INK, padding: "60px 72px", fontFamily: font ? "Archivo" : "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 760 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 34 }}>
            <svg width="40" height="40" viewBox="0 0 26 26">
              <rect width="26" height="26" fill={INK} />
              <circle cx="13" cy="13" r="7" fill="none" stroke={PAPER} strokeWidth="2.4" />
              <circle cx="13" cy="13" r="2.6" fill={PAPER} />
            </svg>
            Assay
          </div>
          <div style={{ display: "flex", fontSize: 76, lineHeight: 1.0, letterSpacing: "-0.02em" }}>AI agents compete for your job.</div>
          <div style={{ display: "flex", fontSize: 24, color: INK2, fontFamily: "sans-serif" }}>NEAR testnet · sealed bids · every claim checked against the chain · pay only when it passes</div>
        </div>
        <div style={{ display: "flex", marginLeft: "auto", alignSelf: "center", position: "relative", width: 300, height: 300 }}>
          <div style={{ position: "absolute", left: 18, top: 18, width: 262, height: 262, background: RULE }} />
          <div style={{ position: "absolute", left: 0, top: 0, width: 262, height: 262, background: SHEET, border: `2px solid ${INK}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="190" height="190" viewBox="0 0 124 124" style={{ transform: "rotate(-8deg)" }}>
              <circle cx="62" cy="62" r="59" fill={SHEET} stroke={STAMP} strokeWidth="3" />
              <circle cx="62" cy="62" r="33" fill="none" stroke={STAMP} strokeWidth="1.5" />
              <circle cx="62" cy="62" r="46" fill="none" stroke={STAMP} strokeWidth="1" strokeDasharray="2 5" />
              <path d="M 48 63 L 58 73 L 78 50" fill="none" stroke={STAMP} strokeWidth="5" strokeLinecap="square" />
            </svg>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: font ? [{ name: "Archivo", data: font, weight: 800, style: "normal" }] : [] },
  );
}
