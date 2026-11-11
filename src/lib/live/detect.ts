import type { Skill } from "../swarm/types";
import { depositAddressCandidates } from "./oneclick";

// Finding what a job names: an account, a GitHub repo or pasted code, a DAO proposal, a transaction hash.
// Pure, so the server (tools.ts) and the browser (the /check composer) read the text the same way.

const URL_RE = /https?:\/\/\S+/g;
const ACCOUNT_RE = /\b(?:[a-z0-9]+[-_])*[a-z0-9]+(?:\.(?:[a-z0-9]+[-_])*[a-z0-9]+)*\.(?:near|testnet)\b|\b[0-9a-f]{64}\b/g;
const GITHUB_RE = /github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(tree|blob)\/([^/\s)]+)(?:\/([^\s)]*))?)?(?=[\s)>"'\],]|$)/;
const PROPOSAL_NUM_RE = /(?:proposals?\s*(?:#|no\.?|number|id)?\s*|#|[?&]id=|proposals\/[a-z0-9._-]+?-)(\d{1,7})\b/i;
const TX_HASH_RE = /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{43,44}(?![1-9A-HJ-NP-Za-km-z])/;

export function findAccounts(text: string) {
  return [...new Set(text.toLowerCase().replace(URL_RE, " ").match(ACCOUNT_RE) ?? [])].slice(0, 3);
}
export function findRepo(text: string) {
  const m = text.match(GITHUB_RE);
  return m ? { owner: m[1], repo: m[2], kind: m[3] as "tree" | "blob" | undefined, ref: m[4], path: m[5]?.replace(/\/$/, "") } : null;
}
export const hasPastedCode = (text: string) => /near_sdk|#\[near|near_bindgen|pub fn \w+\s*\(/.test(text);
export function findProposal(text: string): { dao: string; id: number } | null {
  const accounts = [...new Set(text.toLowerCase().match(ACCOUNT_RE) ?? [])];
  const dao = accounts.find((a) => /sputnik|dao/.test(a)) ?? accounts[0];
  const num = text.match(PROPOSAL_NUM_RE)?.[1];
  return dao && num ? { dao, id: Number(num) } : null;
}
export const findTxHash = (text: string) => text.match(TX_HASH_RE)?.[0] ?? null;

export type Detected = { skill: Skill; target: string; reads: string } | null;

/** The check a job asks for, from what it names. Most specific first: code, then a proposal, a transaction, an account. */
export function detectCheck(text: string): Detected {
  const repo = findRepo(text);
  if (repo) return { skill: "contract-review", target: `github.com/${repo.owner}/${repo.repo}${repo.path ? `/${repo.path}` : ""}`, reads: "Tools will read the Rust source and scan it for NEAR-specific patterns." };
  if (hasPastedCode(text)) return { skill: "contract-review", target: "the pasted contract", reads: "Tools will scan the pasted code for NEAR-specific patterns." };
  const prop = /proposal|#\d/i.test(text) ? findProposal(text) : null;
  if (prop) return { skill: "proposal-review", target: `proposal #${prop.id} on ${prop.dao}`, reads: "Tools will decode what it executes, who it pays, and the votes so far." };
  // A cross-chain swap through NEAR Intents (1Click) is named by its deposit address.
  const deposit = /1click|swap|deposit address|bridge|cross-chain|intents/i.test(text) ? depositAddressCandidates(text).find((a) => a.startsWith("0x") || /deposit/i.test(text)) : undefined;
  if (deposit) return { skill: "tx-forensics", target: `the 1Click swap at ${deposit.slice(0, 8)}…${deposit.slice(-4)}`, reads: "Tools will ask 1Click for the swap's status, refund and transactions on every chain, then read its NEAR settlement." };
  const tx = findTxHash(text);
  if (tx) return { skill: "tx-forensics", target: `transaction ${tx.slice(0, 8)}…${tx.slice(-4)}`, reads: "Tools will read every receipt in order and where each token went." };
  const acct = findAccounts(text)[0];
  if (acct) return { skill: "due-diligence", target: acct, reads: "Tools will read its keys, code, owner and recent activity." };
  return null;
}
