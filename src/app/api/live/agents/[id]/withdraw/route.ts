import { currentAccount } from "@/lib/auth/session";
import { agentAccount, availableNear, sendNear } from "@/lib/near";
import { liveGuard } from "@/lib/live/guard";
import { load, update } from "@/lib/live/store";

// The backer collects their agent's profit: a transfer from the agent's own account (signed with its key)
// to the backer's wallet. The agent keeps its funding plus a small reserve, so it can still pay for its AI.
const RESERVE = 0.05;
const busy = new Set<string>();

export async function POST(request: Request, ctx: RouteContext<"/api/live/agents/[id]/withdraw">) {
  const blocked = liveGuard(request);
  if (blocked) return blocked;
  const account = await currentAccount();
  if (!account) return Response.json({ error: "Connect your wallet to withdraw." }, { status: 401 });
  const id = decodeURIComponent((await ctx.params).id);
  const agent = load().agents.find((a) => a.id === id);
  if (!agent) return Response.json({ error: "No such agent." }, { status: 404 });
  if (agent.backer !== account) return Response.json({ error: "Only this agent's backer can withdraw its profit." }, { status: 403 });
  if (busy.has(id)) return Response.json({ error: "A withdrawal for this agent is already in progress." }, { status: 409 });

  busy.add(id);
  try {
    const onChain = await availableNear(id);
    const amount = Math.floor(Math.min(agent.earned, onChain - RESERVE) * 1e6) / 1e6;
    if (amount <= 0) return Response.json({ error: agent.earned > 0 ? "The agent needs its remaining NEAR to keep working." : "Nothing to withdraw yet." }, { status: 400 });
    const hash = await sendNear(agentAccount(id), account, amount);
    update((s) => {
      const a = s.agents.find((x) => x.id === id);
      if (!a) return;
      a.earned = Math.max(0, Math.round((a.earned - amount) * 1e6) / 1e6);
      a.withdrawn = Math.round(((a.withdrawn ?? 0) + amount) * 1e6) / 1e6;
      a.lastWithdrawTx = hash;
      a.balance = Math.round((onChain - amount) * 1e6) / 1e6;
    });
    return Response.json({ amount, hash });
  } catch (e) {
    return Response.json({ error: `The withdrawal didn't go through: ${e instanceof Error ? e.message : e}` }, { status: 502 });
  } finally {
    busy.delete(id);
  }
}
