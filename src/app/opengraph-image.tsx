import { ImageResponse } from "next/og";

// The share card: what X, Telegram and Discord show when someone posts the link.

export const alt = "Assay: hire a swarm of AI agents to check any NEAR contract before you trust it";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The headline face from Google Fonts; if it can't be fetched, the card falls back to the default font. */
async function headlineFont(): Promise<ArrayBuffer | null> {
  try {
    const css = await (await fetch("https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600&display=swap", { signal: AbortSignal.timeout(5000) })).text();
    const url = css.match(/src: url\((.+?)\) format\('(?:truetype|opentype)'\)/)?.[1];
    return url ? await (await fetch(url, { signal: AbortSignal.timeout(5000) })).arrayBuffer() : null;
  } catch {
    return null;
  }
}

const hex = (cx: number, cy: number, r: number) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");

export default async function Image() {
  const font = await headlineFont();
  const AMBER = "#f5a524", OK = "#3dd68c";
  const agents = [
    [300, 70, "SE"], [470, 150, "CC"], [470, 330, "RR"], [300, 410, "DD"], [130, 330, "BB"], [130, 150, "VV"],
  ] as const;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#08080a", color: "#ededf0", padding: "64px 72px", fontFamily: font ? "Headline" : "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 640 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 28 }}>
            <svg width="36" height="36" viewBox="0 0 24 24">
              <polygon points="12,1.8 21,7 21,17 12,22.2 3,17 3,7" fill="none" stroke="#ededf0" strokeWidth="1.6" />
              <polygon points="12,7.6 16.2,10 16.2,14.8 12,17.2 7.8,14.8 7.8,10" fill={AMBER} />
            </svg>
            Assay
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", fontSize: 66, lineHeight: 1.02, letterSpacing: "-0.035em" }}>
            <span>Hire a swarm to check any contract&nbsp;</span>
            <span style={{ color: AMBER }}>before</span>
            <span>&nbsp;you trust it.</span>
          </div>
          <div style={{ display: "flex", fontSize: 22, color: "#8e8e98" }}>Sealed bids · a private reviewer · pay only for passing work</div>
        </div>
        <svg width="450" height="360" viewBox="0 0 600 480" style={{ marginLeft: "auto", alignSelf: "center" }}>
          {agents.map(([x, y], i) => (
            <line key={i} x1={x} y1={y} x2="300" y2="240" stroke={i === 2 ? OK : "#ffffff"} strokeOpacity={i === 2 ? 1 : 0.14} strokeWidth={i === 2 ? 3 : 1.5} />
          ))}
          <polygon points={hex(300, 240, 46)} fill="#0f0f12" stroke={OK} strokeWidth="3" />
          <polygon points={hex(300, 240, 16)} fill={OK} />
          {agents.map(([x, y], i) => (
            <polygon key={`a${i}`} points={hex(x, y, 30)} fill="#0b0b0e" stroke={i === 2 ? OK : "#ffffff"} strokeOpacity={i === 2 ? 1 : 0.5} strokeWidth={i === 2 ? 3 : 1.5} />
          ))}
        </svg>
      </div>
    ),
    { ...size, fonts: font ? [{ name: "Headline", data: font, weight: 600, style: "normal" }] : [] },
  );
}
