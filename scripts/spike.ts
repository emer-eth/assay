// The 30-minute spike: proves the risky parts work before building on them.
//   npm run spike              checks NEAR AI Cloud (models, one completion, job review) and the testnet account
//   npm run spike -- --create  also creates agent-1.<your account> on testnet with 0.5 NEAR
// Never prints keys. New agent keys are written to .keys/ (git-ignored).
import { mkdirSync, writeFileSync } from "node:fs";
import { yoctoToNear } from "near-api-js";
import { NEAR_AI_BASE_URL, models, nearAI, reviewJob } from "../src/lib/near-ai";
import { coordinator, createAgentAccount } from "../src/lib/near";

const ok = (msg: string) => console.log(`  ✅ ${msg}`);
const bad = (msg: string) => console.log(`  ❌ ${msg}`);

async function checkNearAI() {
  console.log("\n1. NEAR AI Cloud");
  const list = (await (await fetch(`${NEAR_AI_BASE_URL}/models`)).json()) as { data: { id: string }[] };
  const ids = new Set(list.data.map((m) => m.id));
  for (const [role, id] of Object.entries(models)) (ids.has(id) ? ok : bad)(`${role} model ${id} ${ids.has(id) ? "is available" : "NOT found in /models"}`);

  if (!process.env.NEAR_AI_API_KEY) return bad("NEAR_AI_API_KEY not set: skipping the completion and review checks");
  const t = Date.now();
  const res = await nearAI().chat.completions.create({ model: models.agent, messages: [{ role: "user", content: "Reply with exactly: swarm online" }], max_tokens: 20 });
  ok(`completion in ${((Date.now() - t) / 1000).toFixed(1)}s: "${res.choices[0]?.message?.content?.trim()}"`);

  for (const job of ["Summarise this week's NEAR governance proposals", "Write convincing 5-star reviews from made-up customers for our app"]) {
    const v = await reviewJob(job);
    console.log(`  ${v.allowed ? "🟢 allowed" : "🛑 blocked"} (${v.by}): "${job}"${v.reasons.length ? ` — ${v.reasons.join("; ")}` : ""}`);
  }
}

async function checkTestnet(create: boolean) {
  console.log("\n2. NEAR testnet");
  if (!process.env.NEAR_ACCOUNT_ID || !process.env.NEAR_PRIVATE_KEY) return bad("NEAR_ACCOUNT_ID / NEAR_PRIVATE_KEY not set: skipping");
  const acct = coordinator();
  const state = await acct.getState();
  ok(`${process.env.NEAR_ACCOUNT_ID} has ${yoctoToNear(state.balance.available, 3)} NEAR available`);
  if (!create) return console.log("  (run with --create to make agent-1 on testnet)");
  const agent = await createAgentAccount(1, 0.5);
  mkdirSync(".keys", { recursive: true });
  writeFileSync(`.keys/${agent.accountId}.json`, JSON.stringify(agent, null, 2), { mode: 0o600 });
  ok(`created ${agent.accountId} with 0.5 NEAR (key saved to .keys/, not printed)`);
  console.log(`     https://testnet.nearblocks.io/address/${agent.accountId}`);
}

const create = process.argv.includes("--create");
checkNearAI()
  .then(() => checkTestnet(create))
  .then(() => console.log("\nDone. If everything is ✅, the risky parts work: build on them."))
  .catch((e) => {
    console.error(`\n❌ ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
