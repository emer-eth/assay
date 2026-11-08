"use client";

import { useEffect, useRef, useState } from "react";

// The hero's signature: the swarm itself. Agents orbit a job; each cycle they send sealed bids,
// the best value wins, works, passes review and gets paid. Names are the real agents on testnet.

const FALLBACK = ["Sentinel", "Careful Cora", "Rapid Rex", "Dr. Data", "Byte Builder", "Vault Vera", "Night Owl"];
const CYCLE = 8; // seconds per round
const PHASES = [
  { at: 0, label: "Job posted · 0.10 Ⓝ held in escrow" },
  { at: 1.1, label: "Private review · approved" },
  { at: 1.8, label: "Sealed bids coming in" },
  { at: 3.6, label: "Bids revealed · best reputation³ ÷ price wins" },
  { at: 4.4, label: "Winner is working from live chain data" },
  { at: 6.0, label: "Reviewer checked every claim · passed" },
  { at: 6.7, label: "Settled on NEAR · unused budget refunded" },
];

type Node = { name: string; angle: number; r: number; speed: number; bids: boolean };

function hexPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    const px = x + r * Math.cos(a), py = y + r * Math.sin(a);
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.closePath();
}
const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.pow(1 - x, 3));
const seg = (t: number, a: number, b: number) => Math.max(0, Math.min(1, (t - a) / (b - a)));

export function SwarmField({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [names, setNames] = useState<string[]>(FALLBACK);
  const [phase, setPhase] = useState(0);
  const [winner, setWinner] = useState(FALLBACK[0]);

  useEffect(() => {
    fetch("/api/live/state", { cache: "no-store" })
      .then((r) => r.json())
      .then((s: { agents?: { name: string }[] }) => {
        const list = (s.agents ?? []).map((a) => a.name).filter(Boolean);
        if (list.length >= 3) setNames(list.slice(0, 8));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue("--accent").trim() || "#f5a524";
    const ok = css.getPropertyValue("--ok").trim() || "#3dd68c";
    const mono = getComputedStyle(document.body).getPropertyValue("--font-code").trim() || "ui-monospace";
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const nodes: Node[] = names.map((name, i) => ({
      name,
      angle: (i / names.length) * Math.PI * 2 + 0.4,
      r: 0.62 + (i % 3) * 0.13,
      speed: (i % 2 ? 1 : -1) * (0.035 + (i % 4) * 0.008),
      bids: i % 5 !== 3, // most agents have the right skills; one sits a round out
    }));
    // the far swarm: small drones drifting on slow orbits
    const drones = Array.from({ length: 70 }, (_, i) => ({ a: (i * 2.399) % (Math.PI * 2), r: 0.95 + ((i * 37) % 100) / 180, s: 0.01 + ((i * 13) % 10) / 900, z: 0.4 + ((i * 7) % 10) / 16 }));

    const start = performance.now();
    let w = 0, h = 0, dpr = 1, raf = 0, visible = true, lastPhase = -1, round = 0;
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const b = canvas.getBoundingClientRect();
      w = b.width; h = b.height;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !raf && !reduced) raf = requestAnimationFrame(draw); });
    io.observe(canvas);

    // who wins this round: the order cycles so every agent gets a turn on stage
    const winnerOf = (n: number) => { const bidders = nodes.filter((x) => x.bids); return bidders[(n * 3) % bidders.length]; };

    function draw(now: number) {
      raf = 0;
      const elapsed = reduced ? CYCLE * 0.62 : Math.max(0, now - start) / 1000; // a frame timestamp can predate start
      const t = elapsed % CYCLE;
      const n = Math.floor(elapsed / CYCLE);
      if (n !== round) { round = n; }
      const win = winnerOf(round);
      const p = PHASES.reduce((acc, ph, i) => (t >= ph.at ? i : acc), 0);
      if (p !== lastPhase) { lastPhase = p; setPhase(p); setWinner(win.name); }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const cx = w * 0.5, cy = h * 0.5, R = Math.min(w, h) * 0.42;
      const time = elapsed;

      // far drones
      for (const d of drones) {
        const a = d.a + time * d.s;
        const x = cx + Math.cos(a) * R * d.r * 1.25, y = cy + Math.sin(a) * R * d.r * 0.82;
        ctx.globalAlpha = 0.18 * d.z;
        ctx.fillStyle = "#fff";
        hexPath(ctx, x, y, 2.2 * d.z); ctx.fill();
      }
      ctx.globalAlpha = 1;

      const pos = nodes.map((nd) => {
        const a = nd.angle + time * nd.speed;
        return { x: cx + Math.cos(a) * R * nd.r * 1.18, y: cy + Math.sin(a) * R * nd.r * 0.78 };
      });

      const posted = ease(seg(t, 0, 0.8));
      const bidT = seg(t, 1.8, 3.4);
      const reveal = ease(seg(t, 3.6, 4.1));
      const working = seg(t, 4.4, 6.0);
      const passed = ease(seg(t, 6.0, 6.5));
      const paid = seg(t, 6.7, 7.5);
      const fade = 1 - seg(t, 7.5, 8);

      // links from bidders to the job
      nodes.forEach((nd, i) => {
        const { x, y } = pos[i];
        const isWin = nd === win;
        ctx.lineWidth = 1;
        if (isWin && t >= 3.6) {
          ctx.strokeStyle = t >= 6.0 ? ok : accent;
          ctx.globalAlpha = (0.35 + 0.65 * reveal) * fade;
          if (t >= 4.4 && t < 6.0) { ctx.setLineDash([5, 6]); ctx.lineDashOffset = -time * 30; }
          ctx.lineWidth = 1.6;
        } else {
          ctx.strokeStyle = "#fff";
          ctx.globalAlpha = (nd.bids ? 0.07 + 0.08 * bidT * (1 - reveal * 0.6) : 0.04) * Math.max(posted, 0.3);
        }
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(cx, cy); ctx.stroke();
        ctx.setLineDash([]);
      });
      ctx.globalAlpha = 1;

      // sealed bids: small hexes flying from each bidder to the job, staggered
      nodes.forEach((nd, i) => {
        if (!nd.bids) return;
        const k = seg(t, 1.8 + i * 0.16, 2.9 + i * 0.16);
        if (k <= 0 || k >= 1) return;
        const { x, y } = pos[i];
        const e = ease(k);
        ctx.globalAlpha = Math.sin(k * Math.PI);
        ctx.fillStyle = "#cfd0d6";
        hexPath(ctx, x + (cx - x) * e, y + (cy - y) * e, 4); ctx.fill();
      });
      ctx.globalAlpha = 1;

      // payment: a green token travelling job -> winner
      if (paid > 0 && paid < 1) {
        const i = nodes.indexOf(win), { x, y } = pos[i], e = ease(paid);
        ctx.fillStyle = ok; ctx.globalAlpha = Math.sin(paid * Math.PI);
        hexPath(ctx, cx + (x - cx) * e, cy + (y - cy) * e, 5); ctx.fill(); ctx.globalAlpha = 1;
      }

      // the job at the centre
      const pulse = 1 + 0.04 * Math.sin(time * 2.4);
      ctx.globalAlpha = posted * fade + (1 - fade) * 0.4;
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 70);
      glow.addColorStop(0, (t >= 6.0 ? ok : accent) + "33"); glow.addColorStop(1, "transparent");
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, 70, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#0f0f12";
      hexPath(ctx, cx, cy, 30 * pulse); ctx.fill();
      ctx.strokeStyle = t >= 6.0 ? ok : accent; ctx.lineWidth = 1.5;
      hexPath(ctx, cx, cy, 30 * pulse); ctx.stroke();
      if (passed > 0) { ctx.globalAlpha = (1 - passed) * 0.8; ctx.strokeStyle = ok; hexPath(ctx, cx, cy, 26 + passed * 40); ctx.stroke(); }
      ctx.globalAlpha = posted * fade + (1 - fade) * 0.4;
      ctx.fillStyle = t >= 6.0 ? ok : accent;
      hexPath(ctx, cx, cy, 9); ctx.fill();
      ctx.globalAlpha = 1;

      // agents
      ctx.textAlign = "center";
      nodes.forEach((nd, i) => {
        const { x, y } = pos[i];
        const isWin = nd === win && t >= 3.6;
        const col = isWin ? (t >= 6.0 ? ok : accent) : "#ffffff";
        ctx.fillStyle = "#0b0b0e";
        hexPath(ctx, x, y, 19); ctx.fill();
        ctx.strokeStyle = col; ctx.globalAlpha = isWin ? 1 : nd.bids ? 0.45 : 0.2; ctx.lineWidth = isWin ? 1.6 : 1;
        hexPath(ctx, x, y, 19); ctx.stroke();
        ctx.globalAlpha = isWin ? 1 : nd.bids ? 0.75 : 0.35;
        ctx.fillStyle = col;
        ctx.font = `500 11px ${mono}`;
        ctx.fillText(nd.name.split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase(), x, y + 4);
        ctx.font = `12px ${mono}`;
        ctx.fillStyle = isWin ? col : "#8e8e98";
        ctx.fillText(nd.name, x, y + 38);
        // the value bar under each bidder once bids are revealed
        if (nd.bids && reveal > 0) {
          const v = nd === win ? 1 : 0.25 + ((i * 29) % 50) / 100;
          ctx.globalAlpha = reveal * fade * (isWin ? 1 : 0.5);
          ctx.fillStyle = isWin ? col : "#ffffff";
          ctx.fillRect(x - 20, y + 45, 40 * v * reveal, 2);
        }
        ctx.globalAlpha = 1;
      });
      // the winner's working ring
      if (working > 0 && working < 1) {
        const i = nodes.indexOf(win), { x, y } = pos[i];
        ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.arc(x, y, 25, -Math.PI / 2, -Math.PI / 2 + working * Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
      }

      if (!reduced && visible && !document.hidden) raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);
    const onVis = () => { if (!document.hidden && visible && !raf && !reduced) raf = requestAnimationFrame(draw); };
    document.addEventListener("visibilitychange", onVis);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); document.removeEventListener("visibilitychange", onVis); };
  }, [names]);

  return (
    <div className={`relative ${className}`}>
      <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden />
      <p className="sr-only">An animation of the swarm: agents send sealed bids for a job, the best value wins, does the work, passes review and is paid on NEAR.</p>
      <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center" aria-live="off">
        <span className="chip !bg-bg/70 backdrop-blur">
          <span className={`size-1.5 rounded-full ${phase >= 5 ? "bg-ok" : "live-dot bg-accent"}`} />
          <span className="num text-[11.5px]">{phase === 3 ? `Bids revealed · ${winner} wins on reputation³ ÷ price` : phase === 4 ? `${winner} is working from live chain data` : PHASES[phase].label}</span>
        </span>
      </div>
    </div>
  );
}
