// "Why not just ask a chatbot?" Asks the same models the same question two ways: plainly (no tools, the way a chatbot
// answers), and the way an Assay agent does (with the evidence the tools read from the chain). The same reviewer then
// grades every answer against that evidence. Writes docs/chatbot-comparison.md. Run: npm run compare
import { writeFileSync } from "node:fs";
import { gradeDelivery, nearAI } from "../src/lib/near-ai";
import { agentWork } from "../src/lib/live/agent-ai";
import { gatherEvidence } from "../src/lib/live/tools";
import type { LiveAgent } from "../src/lib/live/store";
import { AGENT_MODELS, type AgentModel } from "../src/lib/models";

const QUESTION = process.env.QUESTION || "Before I deposit: who controls v2.ref-finance.near, can its code be changed, and by whom?";
const MODELS: AgentModel[] = ["openai/gpt-5.4-mini", "google/gemini-3.8-flash", "Qwen/Qwen3.8-27B"];
const job = { id: "compare", poster: "compare", description: QUESTION, skills: ["due-diligence" as const], budget: 0.3 };

async function plain(model: AgentModel) {
  const res = await nearAI().chat.completions.create({
    model,
    // The same thinking setting the model gets as an agent, so the only difference is the tools.
    reasoning_effort: AGENT_MODELS[model].think,
    ...(model.startsWith("openai/") ? {} : { temperature: 0.3 }),
    max_tokens: 6000,
    messages: [{ role: "user", content: QUESTION }],
  }, { timeout: 150_000, maxRetries: 1 });
  return (res.choices[0]?.message?.content || "").replace(/^[\s\S]*<\/think>/, "").trim();
}

async function main() {
  const evidence = await gatherEvidence(job);
  if (!evidence) throw new Error("the tools read nothing");
  const rows = await Promise.all(
    MODELS.map(async (model) => {
      const agent: LiveAgent = { id: "compare", name: "compare", backer: "compare", prompt: "You are a careful NEAR analyst.", skills: ["due-diligence"], model, balance: 1, costPerJob: 0.01, quality: 0.5, joinedAt: 0, funding: 1, earned: 0 };
      const [a, b] = await Promise.all([plain(model).catch((e) => `(error: ${e.message})`), agentWork(agent, job, evidence).then((w) => w.text).catch((e) => `(error: ${e.message})`)]);
      const [ga, gb] = await Promise.all([gradeDelivery(QUESTION, a, evidence.facts), gradeDelivery(QUESTION, b, evidence.facts)]);
      return { model, plain: { text: a, grade: ga }, tools: { text: b, grade: gb } };
    }),
  );
  const verdict = (g: { passed: boolean; unavailable?: boolean }) => (g.unavailable ? "no verdict" : g.passed ? "**passed**" : "failed");
  const date = new Date().toISOString().slice(0, 10);
  const md = [
    "# Why not just ask a chatbot?",
    "",
    `Run on ${date} with \`npm run compare\` (\`scripts/compare-chatbot.ts\`). The question:`,
    "",
    `> ${QUESTION}`,
    "",
    "Each model answered it twice: **plainly**, the way a chatbot does, from what it remembers; and **with tools**, the way an Assay agent does, from the evidence its tools read from NEAR mainnet a moment earlier. The same reviewer then graded all six answers against that evidence, with the rule it applies to every report: fail any claim the evidence contradicts or doesn't contain.",
    "",
    "| Model | Plain (no tools) | With Assay's tools |",
    "|---|---|---|",
    ...rows.map((r) => `| ${AGENT_MODELS[r.model].label} | ${verdict(r.plain.grade)} | ${verdict(r.tools.grade)} |`),
    "",
    "## What the tools read",
    "",
    ...evidence.summary.map((s) => `- ${s}`),
    "",
    "## Why each plain answer was graded as it was",
    "",
    ...rows.flatMap((r) => [`**${AGENT_MODELS[r.model].label}, plain:** ${verdict(r.plain.grade)}.`, ...r.plain.grade.reasons.map((x) => `- ${x}`), "", `**${AGENT_MODELS[r.model].label}, with tools:** ${verdict(r.tools.grade)}.`, ...r.tools.grade.reasons.map((x) => `- ${x}`), ""]),
    "## Caveats",
    "",
    "- One question, three models, one run. Plain models are not always wrong, and agents with tools are not always right: on the live ledger about half of graded reports fail.",
    "- The grader holds the plain answers to the same standard as agents: a claim the evidence doesn't show fails, even if it happens to be true. That is the point of the comparison: a plain answer gives you no way to tell which of its claims are checked.",
    "",
    "<details><summary>The plain answers, in full</summary>",
    "",
    ...rows.flatMap((r) => [`### ${AGENT_MODELS[r.model].label}`, "", r.plain.text, ""]),
    "</details>",
    "",
  ].join("\n");
  writeFileSync("docs/chatbot-comparison.md", md);
  for (const r of rows) console.log(`${AGENT_MODELS[r.model].label.padEnd(18)} plain: ${verdict(r.plain.grade).padEnd(12)} tools: ${verdict(r.tools.grade)}\n   plain: ${r.plain.grade.reasons[0]?.slice(0, 160) ?? ""}`);
}
main().catch((e) => {
  console.error("❌", e instanceof Error ? e.message : e);
  process.exit(1);
});
