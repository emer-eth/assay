// Runs a fixed batch of real jobs against the live market over MCP, one skill at a time, so the
// public track record shows every skill working (or failing honestly). Reads ASSAY_KEY from .env;
// the key is never printed. Usage: npm run jobs [-- --dry] [-- --only=tx-forensics]

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const SITE = process.env.SITE_URL ?? "https://web-production-a10bc.up.railway.app";
const BUDGET = 0.3;

const JOBS: { skill: string; description: string }[] = [
  // Contract due diligence
  { skill: "due-diligence", description: "Before I deposit: who controls v2.ref-finance.near, can its code be changed, and by whom?" },
  { skill: "due-diligence", description: "Due diligence on intents.near: admin roles, keys, published source and recent activity." },
  { skill: "due-diligence", description: "Is wrap.near safe to hold wNEAR in? Who holds full-access keys, and can anyone upgrade or pause it?" },
  // DAO proposal review
  { skill: "proposal-review", description: "I'm on the council: what will proposal #1059 on ref-finance.sputnik-dao.near actually do, and does it match its description?" },
  { skill: "proposal-review", description: "What does proposal #1060 on ref-finance.sputnik-dao.near do if it passes: who receives what, and is anything unusual about it?" },
  { skill: "proposal-review", description: "Check proposal #1058 on marketing.sputnik-dao.near: who gets paid, how much in real units, and does it match the description?" },
  // Transaction forensics (two failed NEAR Intents calls, one failed Ref Finance swap)
  { skill: "tx-forensics", description: "My NEAR Intents transfer in transaction 6DhuhcBjTPqFPBRCaZKY3EUz9bjvyPdtXajqQWrGACjg failed. Why, who actually signed it, and where's my money?" },
  { skill: "tx-forensics", description: "Why did NEAR Intents transaction 5Z3yjXBhhzZ2281oSCxH8Seeh893TWKV9XEoq9S842Bi fail, who signed the intent, and was anything lost besides gas?" },
  { skill: "tx-forensics", description: "My swap on Ref Finance failed in transaction CS1feCGzR95BdKme5AGRhQXxUYVzYi4ZkRSTg4BZXSCr. What went wrong, and did I get my tokens back?" },
  // Contract code review (beta)
  { skill: "contract-review", description: "Review https://github.com/near-examples/donation-examples/tree/main/contract-rs for NEAR-specific bugs and give fixes." },
  { skill: "contract-review", description: "Review https://github.com/near-examples/cross-contract-calls/tree/main/contract-simple-rs for callback and promise bugs, with file:line and fixes." },
  { skill: "contract-review", description: "Review https://github.com/near-examples/guest-book-examples/tree/main/contract-rs for storage and payable-method issues, with fixes." },
];

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const only = args.find((a) => a.startsWith("--only="))?.slice(7);
const jobs = JOBS.filter((j) => !only || j.skill === only);

type Out = { content?: { type: string; text?: string }[]; isError?: boolean };
const text = (r: Out) => r.content?.map((c) => c.text ?? "").join("\n") ?? "";

async function main() {
  const key = process.env.ASSAY_KEY;
  if (!key?.startsWith("sfh_")) throw new Error("Put ASSAY_KEY=sfh_… in .env (create it in the app under 'Use from your AI').");
  const client = new Client({ name: "assay-batch", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${SITE}/api/mcp`), { requestInit: { headers: { authorization: `Bearer ${key}` } } }));
  try {
    const bal = JSON.parse(text((await client.callTool({ name: "balance", arguments: {} })) as Out));
    const need = jobs.length * BUDGET;
    console.log(`Credit: ${bal.credit_near} NEAR. ${jobs.length} jobs × ${BUDGET} = ${need.toFixed(2)} NEAR held at most (unused comes back).`);
    if (dry) return;
    if (typeof bal.credit_near === "number" && bal.credit_near < BUDGET) throw new Error("Not enough credit for even one job. Top up in the app.");

    const results: string[] = [];
    for (const [i, job] of jobs.entries()) {
      const posted = (await client.callTool({ name: "post_job", arguments: { description: job.description, skills: [job.skill], budget: BUDGET } })) as Out;
      if (posted.isError) {
        results.push(`${i + 1}. ${job.skill}: not posted: ${text(posted)}`);
        console.log(results.at(-1));
        if (/credit/i.test(text(posted))) break;
        continue;
      }
      const { round_id } = JSON.parse(text(posted));
      console.log(`${i + 1}/${jobs.length} ${job.skill}: round ${round_id} queued`);
      let round: Record<string, unknown> = {};
      for (let tries = 0; tries < 8; tries++) {
        round = JSON.parse(text((await client.callTool({ name: "wait_for_round", arguments: { round_id, max_wait_seconds: 240 } }, undefined, { timeout: 260_000 })) as Out));
        if (!["queued", "reviewing", "bidding", "working", "grading", "settling"].includes(String(round.status))) break;
      }
      const grade = round.grade as { passed?: boolean; reasons?: string[] } | undefined;
      const verdict = round.status === "done" ? (grade?.passed ? "PASSED" : `FAILED: ${grade?.reasons?.[0] ?? ""}`) : String(round.status).toUpperCase();
      results.push(`${i + 1}. ${job.skill} · ${round_id} · ${verdict}`);
      console.log(`   → ${verdict}`);
    }
    console.log(`\nSummary\n${results.join("\n")}`);
    console.log(`\nCredit left: ${text((await client.callTool({ name: "balance", arguments: {} })) as Out)}`);
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
