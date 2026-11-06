import { mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { coordinator, createAgentAccount, sendNear } from "@/lib/near";
import { currentAccount } from "@/lib/auth/session";
import { claimDeposit } from "@/lib/live/deposit";
import { LIMITS, liveGuard } from "@/lib/live/guard";
import { load, update } from "@/lib/live/store";

const input = z.object({
  name: z.string().trim().min(2).max(40),
  prompt: z.string().trim().min(10).max(2000),
  skills: z.array(z.enum(["writing", "research", "code", "data", "design", "translation"])).min(1),
  funding: z.coerce.number().min(0.1).max(LIMITS.maxFunding),
  txHash: z.string().min(40).max(50), // the backer's funding payment from their wallet
});

/** A backer adds an agent: a new testnet sub-account funded with NEAR for its AI usage. */
export async function POST(request: Request) {
  const blocked = liveGuard(request);
  if (blocked) return blocked;
  const account = await currentAccount();
  if (!account) return Response.json({ error: "Connect your wallet to back an agent." }, { status: 401 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Check the agent's name, prompt, skills and funding (0.1–2 NEAR)." }, { status: 400 });
  const { agents } = load();
  if (agents.length >= LIMITS.maxAgents) return Response.json({ error: `The swarm is full (${LIMITS.maxAgents} agents).` }, { status: 409 });

  const paid = await claimDeposit(parsed.data.txHash, account, parsed.data.funding, "agent funding");
  if (!paid.ok) return Response.json({ error: paid.error }, { status: 402 });
  const n = Math.max(0, ...agents.map((a) => Number(a.id.match(/^agent-(\d+)\./)?.[1] || 0))) + 1;
  try {
    const created = await createAgentAccount(n, parsed.data.funding);
    mkdirSync(".keys", { recursive: true });
    writeFileSync(`.keys/${created.accountId}.json`, JSON.stringify(created, null, 2), { mode: 0o600 });
    const agent = update((s) => {
      const a = {
        id: created.accountId,
        name: parsed.data.name,
        backer: account,
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
    // The backer already paid: send the funding back rather than keep it.
    const refunded = await sendNear(coordinator(), account, parsed.data.funding).then(() => true, () => false);
    return Response.json(
      { error: `Couldn't create the agent account (${e instanceof Error ? e.message : e}). ${refunded ? `Your ${parsed.data.funding} NEAR was sent back.` : `Your ${parsed.data.funding} NEAR couldn't be sent back automatically; it's owed to you.`}` },
      { status: 502 },
    );
  }
}
