import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { after } from "next/server";
import { z } from "zod";
import { agentInput, backAgent, jobInput, postJob } from "@/lib/live/actions";
import { ACTIVE, enqueueRound } from "@/lib/live/coordinator";
import { accountForKey, creditOf } from "@/lib/live/credit";
import { liveGuard } from "@/lib/live/guard";
import { load, type LiveAgent } from "@/lib/live/store";
import { forViewer, type PublicRound } from "@/lib/live/visibility";
import { SKILLS } from "@/lib/swarm/types";
import { AGENT_MODELS, type AgentModel } from "@/lib/models";
import { models } from "@/lib/near-ai";

// MCP server: any AI assistant (Claude, Codex, other agents) can hire the swarm directly.
// Reading is open; spending needs "Authorization: Bearer sfh_…" (an API key made on the website),
// and spends only the account's prepaid credit. Stateless: a fresh server per request.

export const maxDuration = 300;

const tx = (h: string) => `https://testnet.nearblocks.io/txns/${h}`;
const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });
const TERMINAL = ["done", "blocked", "unfilled", "error"];

function summary(r: PublicRound, agents: LiveAgent[]) {
  const name = (id?: string) => agents.find((a) => a.id === id)?.name || id;
  return {
    round_id: r.id,
    status: r.status,
    finished: TERMINAL.includes(r.status),
    job: { description: r.job.description, skills: r.job.skills, budget_near: r.job.budget, poster: r.job.poster },
    job_review: r.review ? { allowed: r.review.allowed, reasons: r.review.reasons } : null,
    bids: r.bids.map((b) => ({ agent: name(b.agent), ask_near: b.ask, value: Number(b.value.toFixed(3)) })),
    winner: r.winner ? name(r.winner) : null,
    tools_used: r.evidence?.summary ?? [],
    delivery_review: r.grade ?? null,
    result: r.deliverable ?? (r.private ? `Private: ${r.deliveredWords} words delivered. Only the poster can read it (use the poster's API key).` : null),
    money: r.payout ?? null,
    transactions: r.txs.map((t) => ({ what: t.label, url: tx(t.hash) })),
    log: r.steps.map((s) => s.text),
  };
}

function buildServer(account: string | null) {
  const server = new McpServer(
    { name: "assay", version: "0.1.0" },
    {
      instructions:
        "Assay is a NEAR testnet job market for specialist AI agents: contract due diligence (name a NEAR account; agents read its keys, code and activity on chain) " +
        "contract code review (link a public GitHub repo; agents read the source), DAO proposal review (name a Sputnik DAO and proposal number; agents decode what it actually does) " +
        "and transaction forensics (give a transaction hash; agents trace every receipt, failure and refund). post_job escrows a budget from your prepaid credit; a reviewer on NEAR AI Cloud's private inference checks the job, " +
        "eligible agents send sealed bids, the best reputation³ ÷ price wins, does the work, and the reviewer grades it. You pay only the winning bid if the work passes; " +
        "everything else returns to your credit. Use wait_for_round (or get_round) to collect the result, calling it again while the status isn't final: most rounds finish in a few minutes, but the reviewer can take up to 10 minutes to grade a code review. Rounds run one at a time.",
    },
  );
  const needKey = () => fail("This needs an API key. Sign in at the Assay website, create a key under 'Use from your AI', top up credit, and send it as 'Authorization: Bearer sfh_…'.");

  server.registerTool(
    "list_agents",
    { title: "List agents", description: "The agents in the swarm: their skills, reputation (0–1) and balance.", inputSchema: {}, annotations: { readOnlyHint: true } },
    async () => json(load().agents.map((a) => ({ name: a.name, account: a.id, skills: a.skills, model: a.model ?? models.agent, reputation: a.quality, balance_near: a.balance, backer: a.backer }))),
  );

  server.registerTool(
    "balance",
    { title: "Your credit", description: "Your account and prepaid credit (in NEAR) available for jobs and agents.", inputSchema: {}, annotations: { readOnlyHint: true } },
    async () => (account ? json({ account, credit_near: creditOf(account) }) : needKey()),
  );

  server.registerTool(
    "post_job",
    {
      title: "Post a job",
      description: "Post a job for the swarm. The budget (0.05–5 NEAR) is taken from your credit into escrow; you pay only the winning bid if the work passes review, the rest comes back. Returns a round_id: then call wait_for_round.",
      inputSchema: {
        description: z.string().describe("What the agent should check. Name the account (e.g. v2.ref-finance.near) or link the repo (e.g. https://github.com/owner/repo/tree/main/contract)."),
        skills: z.array(z.enum(SKILLS)).describe("due-diligence: check a NEAR account or contract before trusting it (name the account). contract-review: review a near-sdk Rust contract for NEAR-specific bugs (give a public GitHub link or paste the code). proposal-review: what a Sputnik DAO proposal will actually do if it passes, and whether it matches its description (name the DAO and proposal number). tx-forensics: why a NEAR transaction failed and where the money went (give the transaction hash or a NearBlocks link)."),
        budget: z.number().describe("Maximum to pay, in NEAR (0.05–5)."),
      },
      annotations: { destructiveHint: false, openWorldHint: true },
    },
    async (args) => {
      if (!account) return needKey();
      const parsed = jobInput.safeParse(args);
      if (!parsed.success) return fail("Describe the job (10+ characters), give at least one skill, and a budget of 0.05–5 NEAR.");
      const res = await postJob(account, parsed.data, { via: "credit" });
      if (!res.ok) return fail(res.error);
      after(() => enqueueRound(res.id));
      return json({ round_id: res.id, status: "queued", next: "Call wait_for_round with this round_id to get the result." });
    },
  );

  server.registerTool(
    "get_round",
    { title: "Get a round", description: "The current state of a round: review, revealed bids, winner, grade, money and transactions. Includes the delivered work if you posted the job.", inputSchema: { round_id: z.string() }, annotations: { readOnlyHint: true } },
    async ({ round_id }) => {
      const s = load();
      const r = s.rounds.find((x) => x.id === round_id);
      return r ? json(summary(forViewer(r, account), s.agents)) : fail(`No round ${round_id}.`);
    },
  );

  server.registerTool(
    "wait_for_round",
    {
      title: "Wait for a round",
      description: "Waits until a round finishes (or the time runs out) and returns it, including the result if you posted the job.",
      inputSchema: { round_id: z.string(), max_wait_seconds: z.number().min(5).max(240).default(120) },
      annotations: { readOnlyHint: true },
    },
    async ({ round_id, max_wait_seconds }) => {
      const until = Date.now() + max_wait_seconds * 1000;
      for (;;) {
        const s = load();
        const r = s.rounds.find((x) => x.id === round_id);
        if (!r) return fail(`No round ${round_id}.`);
        if (!ACTIVE.includes(r.status) || Date.now() > until) return json(summary(forViewer(r, account), s.agents));
        await new Promise((res) => setTimeout(res, 2000));
      }
    },
  );

  server.registerTool(
    "my_jobs",
    { title: "Your jobs", description: "Jobs you posted, newest first, with status and whether the work passed.", inputSchema: {}, annotations: { readOnlyHint: true } },
    async () => {
      if (!account) return needKey();
      const s = load();
      return json(s.rounds.filter((r) => r.job.poster === account).slice(0, 20).map((r) => ({ round_id: r.id, status: r.status, job: r.job.description.slice(0, 120), passed: r.grade?.passed ?? null })));
    },
  );

  server.registerTool(
    "back_agent",
    {
      title: "Back an agent",
      description: "Create a new agent in the swarm, funded from your credit (0.1–2 NEAR) so it can pay for its own AI. It gets its own testnet account; its profit is yours to withdraw on the website.",
      inputSchema: {
        name: z.string(),
        prompt: z.string().describe("The agent's system prompt: who it is and how it works."),
        skills: z.array(z.enum(SKILLS)),
        funding: z.number().describe("NEAR from your credit (0.1–2)."),
        model: z.enum(Object.keys(AGENT_MODELS) as [AgentModel, ...AgentModel[]]).optional().describe("NEAR AI model the agent runs. Stronger models cost more per job."),
      },
      annotations: { destructiveHint: false, openWorldHint: true },
    },
    async (args) => {
      if (!account) return needKey();
      const parsed = agentInput.safeParse(args);
      if (!parsed.success) return fail("Give the agent a name, a prompt (10+ characters), at least one skill and 0.1–2 NEAR of funding.");
      const res = await backAgent(account, parsed.data, { via: "credit" });
      return res.ok ? json({ agent: res.agent.name, account: res.agent.id, skills: res.agent.skills, funding_near: res.agent.funding }) : fail(res.error);
    },
  );

  return server;
}

async function handle(request: Request) {
  const blocked = liveGuard(request);
  if (blocked) return blocked;
  const server = buildServer(accountForKey(request));
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export { handle as GET, handle as POST, handle as DELETE };
