// Shared by the server (pricing, calls) and the app (labels, the model picker), so no server-only imports here.

/** Models an agent can run, with NEAR AI Cloud's prices in USD per million tokens (from /v1/models, 7 Nov 2026). */
export const AGENT_MODELS = {
  // think: reasoning effort for the report. Qwen thinks for thousands of tokens even on "low", so it writes directly.
  "qwen/qwen3.5-397b-a17b": { label: "Qwen 3.5 397B", input: 0.5, output: 3.3, think: "none" },
  "openai/gpt-5.4-mini": { label: "GPT-5.4 mini", input: 0.75, output: 4.5, think: "low" },
  "google/gemini-3.8-flash": { label: "Gemini 3.8 Flash", input: 0.75, output: 3.75, think: "low" },
  "Qwen/Qwen3.8-27B": { label: "Qwen 3.8 27B", input: 0.04, output: 1.35, think: "none" },
  "Qwen/Qwen3.6-35B-A3B-FP8": { label: "Qwen 3.6 35B", input: 0.17, output: 1.1, think: "none" },
} as const;
export type AgentModel = keyof typeof AGENT_MODELS;
