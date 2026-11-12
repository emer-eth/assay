// Shared by the server (pricing, calls) and the app (labels, the model picker), so no server-only imports here.

/** Models an agent can run, with NEAR AI Cloud's prices in USD per million tokens (from /v1/models, 7 Nov 2026). */
export const AGENT_MODELS = {
  // think: reasoning effort for the report. Qwen thinks for thousands of tokens even on "low", so it writes directly.
  // Qwen 3.5 397B was retired by NEAR AI Cloud (gone by 11 Nov 2026); agents that ran it moved to DeepSeek V3.2 (store.ts).
  // privacy: who runs the model, from the owned_by field of NEAR AI Cloud's /v1/models (checked 11 Nov 2026).
  "deepseek/deepseek-v3.2": { label: "DeepSeek V3.2", input: 1.1, output: 1.1, think: "none", privacy: "attested" },
  "openai/gpt-5.4-mini": { label: "GPT-5.4 mini", input: 0.75, output: 4.5, think: "low", privacy: "third-party" },
  "google/gemini-3.8-flash": { label: "Gemini 3.8 Flash", input: 0.75, output: 3.75, think: "low", privacy: "third-party" },
  "Qwen/Qwen3.8-27B": { label: "Qwen 3.8 27B", input: 0.04, output: 1.35, think: "none", privacy: "private" },
  "Qwen/Qwen3.6-35B-A3B-FP8": { label: "Qwen 3.6 35B", input: 0.17, output: 1.1, think: "none", privacy: "private" },
} as const;
export type AgentModel = keyof typeof AGENT_MODELS;

/**
 * Who sees a job when an agent works on it, by its model:
 *  private: run by NEAR AI itself on its private inference (TEE hardware; this app doesn't verify the attestation);
 *  attested: run by another host NEAR AI lists as attested;
 *  third-party: NEAR AI passes the request to the model's maker (OpenAI, Google), so the job and evidence reach them.
 */
export type ModelPrivacy = "private" | "attested" | "third-party";
export const PRIVACY_LABEL: Record<ModelPrivacy, string> = { private: "Private inference", attested: "Attested host", "third-party": "Third-party API" };
export const PRIVACY_NOTE: Record<ModelPrivacy, string> = {
  private: "Runs on NEAR AI's own private inference.",
  attested: "Runs on a host NEAR AI lists as attested, not on NEAR AI's own hardware.",
  "third-party": "NEAR AI sends the request to the model's maker, so the job and the evidence reach them.",
};
/** The agent default (store.ts falls back to it): Qwen 3.6 35B. */
export const DEFAULT_AGENT_MODEL: AgentModel = "Qwen/Qwen3.6-35B-A3B-FP8";
export const privacyOf = (model?: string | null): ModelPrivacy => AGENT_MODELS[(model && model in AGENT_MODELS ? model : DEFAULT_AGENT_MODEL) as AgentModel].privacy;
