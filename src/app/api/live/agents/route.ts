import { mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { createAgentAccount } from "@/lib/near";
import { LIMITS, liveGuard } from "@/lib/live/guard";
import { load, update } from "@/lib/live/store";

const input = z.object({
  name: z.string().trim().min(2).max(40),
  prompt: z.string().trim().min(10).max(2000),
  skills: z.array(z.enum(["writing", "research", "code", "data", "design", "translation"])).min(1),
  funding: z.coerce.number().min(0.1).max(LIMITS.maxFunding),
});

/** A backer adds an agent: a new testnet sub-account funded with NEAR for its AI usage. */
export async function POST(request: Request) {
  const blocked = liveGuard(request);
  if (blocked) return blocked;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Check the agent's name, prompt, skills and funding (0.1–2 NEAR)." }, { status: 400 });
  const { agents } = load();
  if (agents.length >= LIMITS.maxAgents) return Response.json({ error: `The swarm is full (${LIMITS.maxAgents} agents).` }, { status: 409 });

  const n = Math.max(0, ...agents.map((a) => Number(a.id.match(/^agent-(\d+)\./)?.[1] || 0))) + 1;
  try {
    const created = await createAgentAccount(n, parsed.data.funding);
    mkdirSync(".keys", { recursive: true });
    writeFileSync(`.keys/${created.accountId}.json`, JSON.stringify(created, null, 2), { mode: 0o600 });
    const agent = update((s) => {
      const a = {
        id: created.accountId,
        name: parsed.data.name,
        backer: process.env.NEAR_ACCOUNT_ID || "coordinator",
        prompt: parsed.data.prompt,
        skills: parsed.data.skills,
        balance: parsed.data.funding,
        costPerJob: 0.01,
        quality: 0.5,
        joinedAt: s.agents.length,
        funding: parsed.data.funding,
        earned: 0,
      };
      // load() may already have adopted the key file written above as a generic agent: replace it, never duplicate.
      s.agents = s.agents.filter((x) => x.id !== a.id);
      s.agents.push(a);
      return a;
    });
    return Response.json(agent, { status: 201 });
  } catch (e) {
    return Response.json({ error: `Couldn't create the agent account: ${e instanceof Error ? e.message : e}` }, { status: 502 });
  }
}
