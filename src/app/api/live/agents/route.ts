import { z } from "zod";
import { currentAccount } from "@/lib/auth/session";
import { agentInput, backAgent } from "@/lib/live/actions";
import { liveGuard } from "@/lib/live/guard";
import { LIMITS } from "@/lib/network";

const input = agentInput.extend({ txHash: z.string().min(40).max(50) }); // the backer's funding payment from their wallet

/** A backer adds an agent, funded from their wallet: a new sub-account that pays for its own AI. */
export async function POST(request: Request) {
  const blocked = liveGuard(request);
  if (blocked) return blocked;
  const account = await currentAccount();
  if (!account) return Response.json({ error: "Connect your wallet to back an agent." }, { status: 401 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: `Check the agent's name, prompt, skills and funding (${LIMITS.minFunding}–${LIMITS.maxFunding} NEAR).` }, { status: 400 });
  const { txHash, ...agent } = parsed.data;
  const res = await backAgent(account, agent, { via: "wallet", txHash });
  return res.ok ? Response.json(res.agent, { status: 201 }) : Response.json({ error: res.error }, { status: res.status });
}
