import "server-only";
import { NETWORK } from "../network";
import { AGENT_MODELS, PRIVACY_LABEL, privacyOf, type AgentModel } from "../models";
import { availableNear, escrowId, provider, RPC_URLS } from "../near";
import { models, nearAI } from "../near-ai";
import { ACTIVE } from "./status";
import { INTENTS_ID, intentsBalance } from "./intents-verifier";
import { load } from "./store";
import { DAILY_ROUNDS, DAILY_ROUNDS_PER_ACCOUNT, minutesToReset, usedToday } from "./budget";

// The live status page: every part Assay depends on, checked for real (an RPC call, a contract view, a one-token
// completion from each model). The models are called rather than looked up in NEAR AI's list, because a listed
// model can still be unavailable: that is how two agents stopped bidding unnoticed on 11 Nov 2026.
// Results are kept for five minutes, so the page can't be used to run up AI calls.

export type Check = { group: string; name: string; state: "ok" | "warn" | "down"; detail: string; ms?: number };
export type Health = { at: string; checks: Check[] };

const G = globalThis as typeof globalThis & { __assayHealth?: { at: number; data: Promise<Health> } };
const TTL = 5 * 60_000;

async function timed<T>(fn: () => Promise<T>, ms = 20_000): Promise<{ v?: T; e?: string; ms: number }> {
  const t = Date.now();
  try {
    const v = await Promise.race([fn(), new Promise<never>((_, r) => setTimeout(() => r(new Error(`no answer in ${ms / 1000} s`)), ms))]);
    return { v, ms: Date.now() - t };
  } catch (e) {
    return { e: (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 140), ms: Date.now() - t };
  }
}

/** One short completion: the model answered, or why not. */
async function ping(model: string) {
  return timed(async () => {
    const r = await nearAI().chat.completions.create({ model, max_tokens: 400, messages: [{ role: "user", content: "Reply with: ok" }] }, { timeout: 25_000, maxRetries: 0 });
    if (!r.choices?.length) throw new Error("empty reply");
    return true;
  }, 30_000);
}

async function run(): Promise<Health> {
  const s = load();
  const coord = process.env.NEAR_ACCOUNT_ID ?? "";
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  const [block, bal, escrow, verifier, nb] = await Promise.all([
    timed(() => provider().viewBlock({ finality: "final" })),
    timed(() => availableNear(coord)),
    timed(() => provider().callFunction({ contractId: escrowId(), method: "get_config", args: {} })),
    timed(() => intentsBalance(coord)),
    timed(async () => {
      const host = NETWORK === "mainnet" ? "https://api.nearblocks.io" : "https://api-testnet.nearblocks.io";
      const key = process.env.NEARBLOCKS_API_KEY;
      const r = await fetch(`${host}/v3/accounts/${NETWORK === "mainnet" ? "wrap.near" : "wrap.testnet"}`, { headers: key ? { authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return true;
    }),
  ]);
  const height = (block.v as { header?: { height?: number } } | undefined)?.header?.height;
  add({ group: "Chain", name: `NEAR ${NETWORK} RPC`, state: block.e ? "down" : "ok", detail: block.e ?? `block ${height?.toLocaleString("en")} via ${new URL(RPC_URLS[0]).host}`, ms: block.ms });
  add({ group: "Chain", name: "Escrow contract", state: escrow.e ? "down" : "ok", detail: escrow.e ?? `${escrowId()} answers get_config`, ms: escrow.ms });
  add({ group: "Chain", name: "NEAR Intents verifier", state: verifier.e ? "down" : "ok", detail: verifier.e ?? `${INTENTS_ID} answers mt_balance_of`, ms: verifier.ms });
  const near = bal.v as number | undefined;
  add({ group: "Chain", name: "Coordinator balance", state: bal.e ? "down" : (near ?? 0) < 1 ? "warn" : "ok", detail: bal.e ?? `${near?.toFixed(2)} NEAR available to pay gas and settle${(near ?? 0) < 1 ? " (low)" : ""}`, ms: bal.ms });
  add({ group: "Chain", name: "NearBlocks API (v3)", state: nb.e ? "warn" : "ok", detail: nb.e ? `${nb.e}; forensics and activity read less` : "answers", ms: nb.ms });

  // Every model in use: the two reviewers, the private second reviewer, and each agent's.
  const agentModels = [...new Set(s.agents.map((a) => (a.model && a.model in AGENT_MODELS ? a.model : models.agent)))];
  const roles: [string, string][] = [
    ["Reviewer (jobs and reports)", models.reviewer],
    ["Second reviewer", models.secondReviewer],
    ["Second reviewer, private jobs", models.secondReviewerPrivate],
    ...agentModels.map((m) => [`Agent model · ${AGENT_MODELS[m as AgentModel]?.label ?? m}`, m] as [string, string]),
  ];
  const pings = await Promise.all(roles.map(([, m]) => ping(m)));
  const modelUp = new Map<string, boolean>();
  roles.forEach(([name, m], i) => {
    const p = pings[i];
    modelUp.set(m, !p.e);
    const who = m in AGENT_MODELS ? ` · ${PRIVACY_LABEL[privacyOf(m)].toLowerCase()}` : "";
    // Out of credit shows up as a payment error on every model at once: say so plainly.
    const broke = p.e && /402|insufficient|credit|balance|quota|payment/i.test(p.e);
    add({ group: "NEAR AI Cloud", name, state: p.e ? "down" : "ok", detail: p.e ? `${m}: ${broke ? "NEAR AI credits look used up (" + p.e + ")" : p.e}` : `${m} answered${who}`, ms: p.ms });
  });

  // Each agent: can it pay for a job's AI, and is its model answering? Either failing means it can't bid.
  for (const a of s.agents) {
    const m = a.model && a.model in AGENT_MODELS ? a.model : models.agent;
    const broke = a.balance < a.costPerJob;
    const down = modelUp.get(m) === false;
    add({ group: "Agents", name: a.name, state: down || broke ? "down" : a.balance < 0.1 ? "warn" : "ok", detail: down ? "its model isn't answering, so it can't bid" : broke ? `${a.balance.toFixed(3)} NEAR: too little to pay for its AI` : `${a.balance.toFixed(3)} NEAR for its AI${a.balance < 0.1 ? " (running low)" : ""} · ${a.skills.length} skill${a.skills.length === 1 ? "" : "s"}` });
  }

  // The market itself.
  const last = s.rounds[0];
  const day = s.rounds.filter((r) => Date.now() - Date.parse(r.createdAt) < 86_400_000).length;
  const active = s.rounds.filter((r) => ACTIVE.includes(r.status));
  const stuck = active.filter((r) => Date.now() - Date.parse(r.createdAt) > 30 * 60_000);
  add({ group: "Market", name: "Rounds", state: stuck.length ? "warn" : "ok", detail: `${active.length ? `${active.length} running now` : "none running now"} · ${day} in the last 24 hours${last ? ` · last one ${Math.round((Date.now() - Date.parse(last.createdAt)) / 60_000)} min ago` : ""}${stuck.length ? ` · ${stuck.length} running over 30 min` : ""}` });
  const used = usedToday(s.rounds, null);
  add({ group: "Market", name: "Today's rounds", state: used.total >= DAILY_ROUNDS ? "warn" : "ok", detail: `${used.total} of ${DAILY_ROUNDS} today (at most ${DAILY_ROUNDS_PER_ACCOUNT} per account), because each round uses paid AI · resets in ${Math.floor(minutesToReset() / 60)} h ${minutesToReset() % 60} min` });
  const bidders = s.agents.filter((a) => a.balance >= a.costPerJob && modelUp.get(a.model && a.model in AGENT_MODELS ? a.model : models.agent) !== false).length;
  add({ group: "Market", name: "Agents able to bid", state: bidders >= 2 ? "ok" : bidders === 1 ? "warn" : "down", detail: `${bidders} of ${s.agents.length}${bidders < 2 ? " (a job needs two for a contest and a second check)" : ""}` });
  return { at: new Date().toISOString(), checks };
}

export function health(): Promise<Health> {
  if (!G.__assayHealth || Date.now() - G.__assayHealth.at > TTL) G.__assayHealth = { at: Date.now(), data: run() };
  return G.__assayHealth.data;
}
