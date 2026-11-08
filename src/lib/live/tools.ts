import "server-only";
import { RPC_URLS } from "../near";
import type { Job } from "../swarm/types";

// Agent tools: what makes a hired agent worth paying instead of asking a chatbot.
// Before it works, the winner reads real inputs, and the same evidence goes to the reviewer,
// so every claim in the report can be checked against it:
//  - due-diligence:   the account's on-chain state (keys, code, its public methods, published source, activity)
//  - contract-review: the contract's source from a public GitHub repo (or code pasted into the job),
//                     plus a NEAR-specific pattern scan with file:line references.
//  - proposal-review: a Sputnik DAO proposal decoded from its payload (not its description), the DAO's voting
//                     rule, and whether the accounts and methods it touches exist.
//  - tx-forensics:    a transaction's receipts in order, with failures, refunds, token events and fees.

type Net = "mainnet" | "testnet";
const RPC: Record<Net, string[]> = {
  mainnet: ["https://rpc.mainnet.fastnear.com", "https://free.rpc.fastnear.com"],
  testnet: RPC_URLS,
};
const NO_CODE = "11111111111111111111111111111111";
const TIMEOUT = 10_000;

// ---------- finding the target in a job ----------

const URL_RE = /https?:\/\/\S+/g;
const ACCOUNT_RE = /\b(?:[a-z0-9]+[-_])*[a-z0-9]+(?:\.(?:[a-z0-9]+[-_])*[a-z0-9]+)*\.(?:near|testnet)\b|\b[0-9a-f]{64}\b/g;
const GITHUB_RE = /github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(tree|blob)\/([^/\s)]+)(?:\/([^\s)]*))?)?(?=[\s)>"'\],]|$)/;

export function findAccounts(text: string) {
  return [...new Set(text.toLowerCase().replace(URL_RE, " ").match(ACCOUNT_RE) ?? [])].slice(0, 3);
}
export function findRepo(text: string) {
  const m = text.match(GITHUB_RE);
  return m ? { owner: m[1], repo: m[2], kind: m[3] as "tree" | "blob" | undefined, ref: m[4], path: m[5]?.replace(/\/$/, "") } : null;
}
export const hasPastedCode = (text: string) => /near_sdk|#\[near|near_bindgen|pub fn \w+\s*\(/.test(text);
const netOf = (id: string): Net => (id.endsWith(".testnet") ? "testnet" : "mainnet");

/** Checked before anyone pays: the job must name what to check, and it must exist. Returns a problem, or null. */
export async function targetProblem(job: Pick<Job, "description" | "skills">): Promise<string | null> {
  if (job.skills.includes("due-diligence")) {
    const accounts = findAccounts(job.description);
    if (!accounts.length) return "Due diligence needs an account to check. Name it in the job, e.g. v2.ref-finance.near.";
    for (const id of accounts) {
      const state = await viewAccount(id).catch(() => undefined);
      if (state === null) return `${id} doesn't exist on NEAR ${netOf(id)}. Check the spelling.`;
    }
  }
  if (job.skills.includes("contract-review")) {
    const repo = findRepo(job.description);
    if (!repo && !hasPastedCode(job.description)) return "Contract review needs the code: add a public GitHub link or paste the contract.";
    if (repo) {
      const res = await gh(`https://api.github.com/repos/${repo.owner}/${repo.repo}`).catch(() => null);
      if (res && res.status === 404) return `Couldn't open github.com/${repo.owner}/${repo.repo}. Is the repo public?`;
    }
  }
  if (job.skills.includes("proposal-review")) {
    const prop = findProposal(job.description);
    if (!prop) return "Proposal review needs the DAO and the proposal number, e.g. proposal #1059 on ref-finance.sputnik-dao.near.";
    const p = await viewCallArgs(prop.dao, "get_proposal", { id: prop.id }).catch(() => undefined);
    if (p === null) return `Couldn't find proposal #${prop.id} on ${prop.dao}. Check the DAO account and the number.`;
  }
  if (job.skills.includes("tx-forensics")) {
    const hash = findTxHash(job.description);
    if (!hash) return "Transaction forensics needs the transaction hash (or a NearBlocks link to it).";
    const tx = await findTx(hash, job.description).catch(() => undefined);
    if (tx === null) return "Couldn't find that transaction on NEAR mainnet or testnet. For a testnet transaction, also name the account that sent it.";
  }
  return null;
}

// ---------- NEAR RPC ----------

async function rpc(net: Net, params: Record<string, unknown>) {
  let last: unknown;
  for (const url of RPC[net]) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { finality: "final", ...params } }),
        signal: AbortSignal.timeout(TIMEOUT),
      });
      const json = await res.json();
      if (json.error) {
        const name = json.error.cause?.name || json.error.name;
        if (name === "UNKNOWN_ACCOUNT" || name === "NO_CONTRACT_CODE") return { missing: true as const };
        throw new Error(json.error.data || json.error.message || name);
      }
      return json.result;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

type AccountView = { amount: string; locked: string; code_hash: string; storage_usage: number; global_contract_hash?: string; global_contract_account_id?: string };
/** True if the account runs code: its own, or a shared global contract (NEP-591), where code_hash stays empty. */
const runsCode = (a: AccountView) => a.code_hash !== NO_CODE || !!a.global_contract_hash || !!a.global_contract_account_id;
const codeLabel = (a: AccountView) => (a.code_hash !== NO_CODE ? `code hash ${a.code_hash}` : `shared global contract ${a.global_contract_account_id ?? a.global_contract_hash}`);
/** The account's state, or null if it doesn't exist. */
async function viewAccount(id: string): Promise<AccountView | null> {
  const r = await rpc(netOf(id), { request_type: "view_account", account_id: id });
  return r?.missing ? null : r;
}

async function viewCall(id: string, method: string) {
  const r = await rpc(netOf(id), { request_type: "call_function", account_id: id, method_name: method, args_base64: "" }).catch(() => null);
  if (!r || r.missing || r.error || !Array.isArray(r.result)) return null;
  try {
    return JSON.parse(Buffer.from(r.result).toString());
  } catch {
    return null;
  }
}

/** The names a WASM contract exports: its public methods. Read straight from the deployed code. */
export function wasmExports(wasm: Uint8Array): string[] {
  let p = 8; // magic + version
  const leb = () => {
    let out = 0, shift = 0, b;
    do {
      b = wasm[p++];
      out |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);
    return out >>> 0;
  };
  while (p < wasm.length) {
    const id = wasm[p++];
    const size = leb();
    const end = p + size;
    if (id === 7) {
      const names: string[] = [];
      for (let n = leb(); n > 0; n--) {
        const len = leb();
        const name = Buffer.from(wasm.subarray(p, p + len)).toString();
        p += len;
        const kind = wasm[p++];
        leb();
        if (kind === 0) names.push(name);
      }
      return names;
    }
    p = end;
  }
  return [];
}

const near = (yocto: string) => (Number(BigInt(yocto) / 10n ** 20n) / 1e4).toLocaleString("en-US", { maximumFractionDigits: 4 });
const date = (ns: string | number) => new Date(Number(BigInt(String(ns).split(".")[0]) / 1_000_000n)).toISOString().slice(0, 10);
const ROLE_VIEW_RE = /^(get_)?(owner(_id)?|admins?|super_admins?|guardians?|operators?|managers?|dao(_id)?|governance|council|acl_get_super_admins|acl_get_admins|config|settings|agents)$/;
// withdraw/storage_withdraw are left out on purpose: on most contracts they're how users take their own funds out.
const ADMIN_RE = /upgrade|migrate|deploy|set_code|update_contract|owner|admin|pause|guardian|manager|set_fee|modify_.*fee|blacklist|frozen|freeze|mint|force_|add_full_access_key|add_public_key|delete_key/i;

/** Everything public about one account, as plain facts. */
export async function accountReport(id: string): Promise<{ facts: string; summary: string }> {
  const net = netOf(id);
  const acct = await viewAccount(id);
  if (!acct) return { facts: `ACCOUNT ${id} (NEAR ${net}): does not exist.`, summary: `${id} doesn't exist` };
  const lines = [`ACCOUNT ${id} on NEAR ${net}`, `- Balance: ${near(acct.amount)} NEAR (staked/locked: ${near(acct.locked)} NEAR); storage used: ${acct.storage_usage.toLocaleString("en-US")} bytes`];
  const summary: string[] = [];

  // Who can act as this account
  const keys = await rpc(net, { request_type: "view_access_key_list", account_id: id }).catch(() => null);
  const list: { public_key: string; access_key: { permission: "FullAccess" | { FunctionCall: { receiver_id: string; method_names: string[]; allowance: string | null } } } }[] = keys?.keys ?? [];
  const full = list.filter((k) => k.access_key.permission === "FullAccess");
  const fc = list.filter((k) => k.access_key.permission !== "FullAccess");
  lines.push(
    `- Full-access keys: ${full.length}${full.length ? ` (${full.slice(0, 5).map((k) => k.public_key).join(", ")}${full.length > 5 ? ", …" : ""}). Whoever holds one can deploy new code, move all funds or delete the account.` : ". Nobody can sign as this account with a key: it is locked, so its code changes only through its own methods."}`,
    `- Function-call keys: ${fc.length}${fc.length ? ` (limited to: ${[...new Set(fc.map((k) => (k.access_key.permission as { FunctionCall: { receiver_id: string } }).FunctionCall.receiver_id))].slice(0, 5).join(", ")})` : ""}`,
  );
  summary.push(full.length ? `${full.length} full-access key${full.length > 1 ? "s" : ""}` : "locked (no full-access keys)");

  // Its contract
  const hasCode = runsCode(acct);
  if (!hasCode) {
    lines.push("- Contract: none deployed (a plain account).");
    summary.push("no contract");
  } else {
    const [code, meta, ft, nft] = await Promise.all([
      rpc(net, { request_type: "view_code", account_id: id }).catch(() => null),
      viewCall(id, "contract_source_metadata"),
      viewCall(id, "ft_metadata"),
      viewCall(id, "nft_metadata"),
    ]);
    let roles: string[] = [];
    const methods = code?.code_base64 ? wasmExports(Buffer.from(code.code_base64, "base64")) : [];
    const admin = methods.filter((m) => ADMIN_RE.test(m));
    lines.push(`- Contract: deployed, ${codeLabel(acct)}${acct.code_hash !== NO_CODE ? "" : acct.global_contract_account_id ? ` (a global contract published by ${acct.global_contract_account_id}: that account can update the code for every account using it)` : " (a global contract pinned by its hash: shared by other accounts, and the code can't be changed upstream)"}${code?.code_base64 ? `, ${Math.round((code.code_base64.length * 0.75) / 1024)} KB` : ""}`);
    if (methods.length) {
      lines.push(`- Public methods (${methods.length}, read from the deployed code): ${methods.slice(0, 120).join(", ")}${methods.length > 120 ? ", …" : ""}`);
      lines.push(`- Methods that look privileged (by name only; check who may call them): ${admin.length ? admin.join(", ") : "none"}`);
      // Who holds those powers: ask the contract itself through its no-argument owner/admin views.
      const views = methods.filter((m) => ROLE_VIEW_RE.test(m)).slice(0, 8);
      const answers = await Promise.all(views.map(async (m) => [m, await viewCall(id, m)] as const));
      const found = answers.filter(([, v]) => v !== null && v !== undefined);
      lines.push(
        found.length
          ? `- Roles, as the contract reports them: ${found.map(([m, v]) => `${m}() = ${JSON.stringify(v).slice(0, 300)}`).join("; ")}`
          : "- Roles: the contract has no no-argument owner/admin view that answered, so who holds the privileged methods isn't visible from here.",
      );
      roles = found.map(([m, v]) => `${m.replace(/^get_/, "")}: ${typeof v === "string" ? v : Array.isArray(v) ? v.slice(0, 3).join(", ") + (v.length > 3 ? "…" : "") : "set"}`);
      // One hop further: if an owner is a Sputnik DAO, who votes in it and how many votes it takes.
      const daos = [...new Set(found.flatMap(([, v]) => (Array.isArray(v) ? v : [v])).filter((v): v is string => typeof v === "string" && /\.sputnik-?(dao|v2)\.(near|testnet)$/.test(v)))].slice(0, 2);
      for (const dao of daos) {
        const d = await daoPolicy(dao);
        if (d) {
          lines.push(`- ${d.line}`);
          roles.push(d.short);
        }
      }
    }
    lines.push(
      meta
        ? `- Published source (NEP-330): version ${meta.version ?? "?"}, link ${meta.link ?? "none"}, standards ${(meta.standards ?? []).map((s: { standard: string; version: string }) => `${s.standard} ${s.version}`).join(", ") || "none"}`
        : "- Published source (NEP-330): not published, so the deployed code can't be matched to a public repo from the chain.",
    );
    if (ft) lines.push(`- Fungible token: ${ft.name} (${ft.symbol}), ${ft.decimals} decimals`);
    if (nft) lines.push(`- NFT collection: ${nft.name} (${nft.symbol})`);
    summary.push(`contract with ${methods.length || "?"} methods`, meta ? "source published" : "source not published");
    if (roles.length) summary.push(roles.join("; "));
  }

  // Activity (mainnet only: the public indexer dropped testnet)
  if (net === "mainnet") {
    const [info, txs] = await Promise.all([
      fetchJson(`https://api.nearblocks.io/v1/account/${id}`),
      fetchJson(`https://api.nearblocks.io/v1/account/${id}/txns-only?per_page=25`),
    ]);
    const created = info?.account?.[0]?.created?.block_timestamp;
    if (created) lines.push(`- Created: ${date(created)}`);
    const t: { signer_account_id: string; receiver_account_id: string; block_timestamp: string; actions?: { action: string; method?: string }[] }[] = txs?.txns ?? [];
    if (t.length) {
      const signers = new Set(t.map((x) => x.signer_account_id));
      const methods = new Map<string, number>();
      for (const x of t) for (const a of x.actions ?? []) methods.set(a.method || a.action, (methods.get(a.method || a.action) ?? 0) + 1);
      lines.push(
        `- Latest ${t.length} transactions: ${date(t.at(-1)!.block_timestamp)} to ${date(t[0].block_timestamp)}, from ${signers.size} different signers`,
        `- Most called: ${[...methods].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([m, n]) => `${m} ×${n}`).join(", ")}`,
      );
    } else if (txs) lines.push("- Transactions: none found");
    else lines.push("- Transactions: indexer unavailable right now");
  }
  return { facts: lines.join("\n"), summary: `${id}: ${summary.join(", ")}` };
}

type DaoRole = { name: string; kind: "Everyone" | { Group: string[] } | { Member: string }; permissions: string[] };
/** A Sputnik DAO's members and voting rule, read from its own get_policy view. */
async function daoPolicy(dao: string) {
  const p: { roles: DaoRole[]; default_vote_policy: { threshold: [number, number] | string }; proposal_period: string } | null = await viewCall(dao, "get_policy");
  if (!p?.roles) return null;
  const days = Math.round(Number(BigInt(p.proposal_period) / 1_000_000_000n) / 86400);
  const membersOf = (r: DaoRole) => (r.kind === "Everyone" ? null : "Group" in r.kind ? r.kind.Group : [r.kind.Member]);
  const votes = (r: DaoRole) => r.permissions.some((x) => /VoteApprove|\*:\*/.test(x));
  const parts = p.roles.map((r) => {
    const members = membersOf(r);
    const t = p.default_vote_policy.threshold;
    const need = Array.isArray(t) && members ? `${Math.min(members.length, Math.floor((members.length * t[0]) / t[1]) + 1)} of ${members.length} votes to pass` : `threshold ${JSON.stringify(t)}`;
    const can = votes(r) ? "can vote" : r.permissions.some((x) => /AddProposal/.test(x)) ? "can propose" : r.permissions.join(", ");
    return `role "${r.name}" (${members ? `${members.length}: ${members.slice(0, 8).join(", ")}${members.length > 8 ? ", …" : ""}` : "anyone"}; ${can}; ${need})`;
  });
  const council = p.roles.find((r) => membersOf(r) && votes(r));
  return {
    line: `Owner DAO ${dao} (Sputnik, read from get_policy): ${parts.join("; ")}. Proposals run ${days} days.`,
    short: `DAO ${dao.split(".")[0]}: ${council ? `${membersOf(council)!.length}-member ${council.name}` : "open voting"}`,
  };
}

async function fetchJson(url: string) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// ---------- GitHub source ----------

const gh = (url: string) =>
  fetch(url, {
    headers: { "user-agent": "swarm-for-hire", accept: "application/vnd.github+json", ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) },
    signal: AbortSignal.timeout(TIMEOUT),
  });

const MAX_CHARS = 40_000;
const MAX_FILES = 14;

type SourceFile = { path: string; text: string };

/** The contract's Rust source and Cargo.toml from a public repo, most relevant files first, within a size budget. */
export async function repoSource(text: string): Promise<{ files: SourceFile[]; label: string; skipped: number }> {
  const repo = findRepo(text);
  if (!repo) return { files: [{ path: "pasted-in-job.rs", text }], label: "code pasted in the job", skipped: 0 };
  const base = `https://api.github.com/repos/${repo.owner}/${repo.repo}`;
  const meta = await (await gh(base)).json();
  if (!meta?.default_branch) throw new Error(`couldn't open github.com/${repo.owner}/${repo.repo}`);
  const ref = repo.ref || meta.default_branch;
  const raw = (path: string) => fetch(`https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${ref}/${path}`, { signal: AbortSignal.timeout(TIMEOUT) }).then((r) => (r.ok ? r.text() : ""));
  const label = `github.com/${repo.owner}/${repo.repo}${repo.path ? `/${repo.path}` : ""} @ ${ref}`;
  if (repo.kind === "blob" && repo.path) return { files: [{ path: repo.path, text: await raw(repo.path) }], label, skipped: 0 };

  const tree = await (await gh(`${base}/git/trees/${encodeURIComponent(ref)}?recursive=1`)).json();
  const under = repo.path ? `${repo.path}/` : "";
  const candidates: { path: string; size: number }[] = (tree?.tree ?? []).filter(
    (f: { path: string; type: string }) =>
      f.type === "blob" &&
      f.path.startsWith(under) &&
      (f.path.endsWith(".rs") || f.path.endsWith("Cargo.toml")) &&
      !/(^|\/)(target|tests?|integration-tests|sandbox|examples?|benches|node_modules)\//.test(f.path),
  );
  const score = (p: string) => (p.endsWith("Cargo.toml") ? 0 : /(^|\/)lib\.rs$/.test(p) ? 1 : /contract/i.test(p) ? 2 : 3);
  candidates.sort((a, b) => score(a.path) - score(b.path) || a.size - b.size);
  const files: SourceFile[] = [];
  let total = 0;
  for (const f of candidates) {
    if (files.length >= MAX_FILES || total + f.size > MAX_CHARS) continue;
    const body = await raw(f.path);
    if (!body) continue;
    files.push({ path: f.path, text: body });
    total += body.length;
  }
  return { files, label, skipped: candidates.length - files.length };
}

/** NEAR-specific patterns worth a reviewer's attention, with file:line. Pattern matches, not verdicts. */
export function scanNear(files: SourceFile[]): string[] {
  const notes: string[] = [];
  let unwraps = 0;
  let sdk: string | null = null;
  let isNearContract = false;
  let hasOneYocto = false;
  const transferFns: string[] = [];
  for (const f of files) {
    if (f.path.endsWith("Cargo.toml")) {
      sdk ??= f.text.match(/near-sdk\s*=\s*(?:\{[^}]*?version\s*=\s*)?"([^"]+)"/)?.[1] ?? null;
      continue;
    }
    const lines = f.text.split("\n");
    let attrs: string[] = [];
    lines.forEach((line, i) => {
      const at = `${f.path}:${i + 1}`;
      const t = line.trim();
      if (/#\[near(_bindgen|\(contract_state)?/.test(t)) isNearContract = true;
      if (t.startsWith("#[")) {
        attrs.push(t);
        return;
      }
      if (t.startsWith("//") || !t) return;
      unwraps += (line.match(/\.unwrap\(\)/g) ?? []).length;
      if (/assert_one_yocto/.test(line)) hasOneYocto = true;
      if (/signer_account_id\(\)/.test(line)) notes.push(`${at}: uses env::signer_account_id(). Any contract the user calls can forward that identity; predecessor_account_id() is usually what's meant.`);
      if (/\.transfer\(/.test(line)) notes.push(`${at}: sends NEAR. Check state is updated before the transfer and restored if it fails.`);
      if (/env::promise_result\(|#\[callback_(result|unwrap)\]|is_promise_success/.test(line)) notes.push(`${at}: reads a cross-contract call's result. Check the failure path rolls back what was changed before the call.`);
      const fn = t.match(/^pub fn (\w+)\s*\(/);
      if (fn) {
        const name = fn[1];
        const priv = attrs.some((a) => a.includes("private"));
        if (/^(on_|resolve|callback)|_callback$|_resolve$|^internal_resolve/.test(name) && !priv) notes.push(`${at}: pub fn ${name} looks like a callback but has no #[private], so anyone can call it directly.`);
        if (attrs.some((a) => /init\(\s*ignore_state/.test(a)) && !priv) notes.push(`${at}: #[init(ignore_state)] without #[private]: anyone may be able to re-initialise the contract.`);
        if (attrs.some((a) => a.includes("payable"))) notes.push(`${at}: pub fn ${name} is #[payable]. Check the attached deposit is checked and refunded when unused.`);
        if (/^(ft|nft)_transfer(_call)?$/.test(name)) transferFns.push(at);
      }
      attrs = [];
    });
  }
  const head: string[] = [];
  head.push(sdk ? `near-sdk version: ${sdk}` : "near-sdk version: not found in Cargo.toml");
  if (!isNearContract) head.push("No #[near] / #[near_bindgen] attribute found: this may not be a near-sdk contract.");
  if (transferFns.length && !hasOneYocto) head.push(`Token transfer methods (${transferFns.join(", ")}) but no assert_one_yocto() anywhere: NEP-141/171 require it.`);
  if (unwraps) head.push(`${unwraps} .unwrap() calls: each one panics without a clear error message.`);
  return [...head, ...notes.slice(0, 40)];
}

// ---------- shared helpers for proposals and transactions ----------

/** Any JSON-RPC method (not just "query"), tried on each endpoint in turn. */
async function rpcMethod(urls: string[], method: string, params: unknown) {
  let last: unknown;
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(TIMEOUT),
      });
      const json = await res.json();
      if (json.error) {
        const name = json.error.cause?.name || json.error.name;
        if (name === "UNKNOWN_TRANSACTION" || name === "UNKNOWN_ACCOUNT") return null;
        throw new Error(json.error.data || json.error.message || name);
      }
      return json.result;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

async function viewCallArgs(id: string, method: string, args: unknown) {
  const r = await rpc(netOf(id), { request_type: "call_function", account_id: id, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") }).catch(() => null);
  if (!r || r.missing || r.error || !Array.isArray(r.result)) return null;
  try {
    return JSON.parse(Buffer.from(r.result).toString());
  } catch {
    return null;
  }
}

type TokenInfo = { symbol: string; decimals: number } | null;
const tokenCache = new Map<string, Promise<TokenInfo>>();
/** A token contract's symbol and decimals, so raw amounts can be written in human units. */
function tokenInfo(id: string): Promise<TokenInfo> {
  if (!tokenCache.has(id)) tokenCache.set(id, viewCall(id, "ft_metadata").then((m) => (m?.symbol ? { symbol: m.symbol, decimals: Number(m.decimals) } : null)).catch(() => null));
  return tokenCache.get(id)!;
}
function units(raw: string, decimals: number) {
  try {
    const n = BigInt(raw);
    const base = 10n ** BigInt(decimals);
    const whole = n / base;
    const frac = (n % base).toString().padStart(decimals, "0").slice(0, 6).replace(/0+$/, "");
    return `${whole.toLocaleString("en-US")}${frac ? `.${frac}` : ""}`;
  } catch {
    return raw;
  }
}
/** "1,234.5 USDT (raw 1234500000)" when the token is known, otherwise the raw amount. */
async function tokenAmount(token: string, raw: string) {
  const t = await tokenInfo(token);
  return t ? `${units(raw, t.decimals)} ${t.symbol} (raw ${raw}, token ${token})` : `${raw} raw units of ${token} (token decimals unknown)`;
}
const nearExact = (yocto: string) => `${units(yocto, 24)} NEAR`;
function decodeArgs(b64: string): unknown {
  try {
    const text = Buffer.from(b64, "base64").toString();
    try {
      return JSON.parse(text);
    } catch {
      return text.length > 200 ? `${text.slice(0, 200)}…` : text;
    }
  } catch {
    return b64;
  }
}
const clip = (v: unknown, n = 600) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > n ? `${s.slice(0, n)}…` : s;
};
/** Account names that appear as values inside a call's arguments (receivers, owners, new members...). */
function accountsIn(v: unknown, out = new Set<string>()): Set<string> {
  if (typeof v === "string") {
    if (/^[a-z0-9._-]+\.(near|testnet)$|^[0-9a-f]{64}$/.test(v)) out.add(v);
  } else if (v && typeof v === "object") for (const x of Object.values(v)) accountsIn(x, out);
  return out;
}
async function accountLine(id: string) {
  const a = await viewAccount(id).catch(() => undefined);
  if (a === undefined) return `${id}: couldn't be read`;
  if (a === null) return `${id}: DOES NOT EXIST on NEAR ${netOf(id)}`;
  return `${id}: exists, ${near(a.amount)} NEAR, ${runsCode(a) ? `has a contract (${codeLabel(a)})` : "plain account (no contract)"}`;
}

/** What a function call moves, in words: NEAR deposit, and token amounts for the standard token methods. */
async function describeCall(receiver: string, method: string, args: unknown, deposit: string) {
  const parts = [`${method}(${clip(args, 500)}) on ${receiver}`];
  if (deposit && deposit !== "0") parts.push(`attaches ${nearExact(deposit)}`);
  const a = (args ?? {}) as Record<string, string>;
  if (/^ft_transfer(_call)?$/.test(method) && a.amount) parts.push(`moves ${await tokenAmount(receiver, a.amount)} to ${a.receiver_id}`);
  if (method === "storage_deposit") parts.push(`registers ${a.account_id ?? "the caller"} for storage on ${receiver}`);
  if (/^(mint|ft_mint)$/.test(method) && a.amount) parts.push(`mints ${await tokenAmount(receiver, a.amount)}`);
  return parts.join("; ");
}

// ---------- DAO proposal review ----------

const PROPOSAL_NUM_RE = /(?:proposals?\s*(?:#|no\.?|number|id)?\s*|#|[?&]id=|proposals\/[a-z0-9._-]+?-)(\d{1,7})\b/i;

/** The DAO and proposal number a job names, e.g. "proposal #1059 on ref-finance.sputnik-dao.near" or an Astro / NEAR Treasury link. */
export function findProposal(text: string): { dao: string; id: number } | null {
  const accounts = [...new Set(text.toLowerCase().match(ACCOUNT_RE) ?? [])];
  const dao = accounts.find((a) => /sputnik|dao/.test(a)) ?? accounts[0];
  const num = text.match(PROPOSAL_NUM_RE)?.[1];
  return dao && num ? { dao, id: Number(num) } : null;
}

type Proposal = {
  id: number;
  proposer: string;
  description: string;
  kind: Record<string, unknown> | string;
  status: string;
  vote_counts: Record<string, [number, number, number]>;
  votes: Record<string, string>;
  submission_time: string;
};

export async function proposalReport(dao: string, id: number): Promise<{ facts: string; summary: string }> {
  const p: Proposal | null = await viewCallArgs(dao, "get_proposal", { id });
  if (!p) return { facts: `PROPOSAL ${id} on ${dao}: not found (the DAO doesn't exist, isn't a Sputnik DAO, or has no proposal with that number).`, summary: `proposal ${id} on ${dao} not found` };
  const policy = await viewCall(dao, "get_policy");
  const lines = [
    `PROPOSAL #${p.id} on ${dao} (Sputnik DAO, NEAR ${netOf(dao)}), read with get_proposal`,
    `- Proposer: ${p.proposer}`,
    `- Description, as written by the proposer (unverified claim): ${clip(p.description, 1200)}`,
    `- Status: ${p.status}${p.status === "InProgress" ? " (voting is open)" : p.status === "Approved" ? " (voting is over: it passed and its actions have already run)" : p.status === "Failed" ? " (it passed but its actions failed when they ran)" : " (voting is over)"}`,
    `- Submitted: ${date(p.submission_time)}${policy?.proposal_period ? (p.status === "InProgress" ? `; voting closes ${date((BigInt(p.submission_time) + BigInt(policy.proposal_period)).toString())}` : `; its voting window ran to ${date((BigInt(p.submission_time) + BigInt(policy.proposal_period)).toString())}, but it was decided as soon as enough votes came in`) : ""}`,
    `- Votes so far: ${Object.entries(p.votes).map(([who, v]) => `${who} ${v}`).join(", ") || "none"} (counts by role [approve, reject, remove]: ${JSON.stringify(p.vote_counts)})`,
  ];
  const d = await daoPolicy(dao);
  if (d) lines.push(`- ${d.line.replace(/^Owner DAO/, "DAO")}`);

  // What the proposal actually does if it passes: decoded from its payload, not from the description.
  const kindName = typeof p.kind === "string" ? p.kind : Object.keys(p.kind)[0];
  const body = typeof p.kind === "string" ? null : (p.kind as Record<string, Record<string, unknown>>)[kindName];
  lines.push(`- Kind: ${kindName}`);
  const named = new Set<string>();
  const recipients = new Set<string>();
  let moves = "";
  if (kindName === "FunctionCall" && body) {
    const receiver = body.receiver_id as string;
    named.add(receiver);
    const actions = (body.actions as { method_name: string; args: string; deposit: string; gas: string }[]) ?? [];
    const acct = await viewAccount(receiver).catch(() => undefined);
    let methods: string[] = [];
    if (acct && runsCode(acct)) {
      const code = await rpc(netOf(receiver), { request_type: "view_code", account_id: receiver }).catch(() => null);
      methods = code?.code_base64 ? wasmExports(Buffer.from(code.code_base64, "base64")) : [];
    }
    lines.push(`- If it passes, the DAO calls ${receiver} with ${actions.length} action${actions.length === 1 ? "" : "s"}, in order:`);
    for (const [i, a] of actions.entries()) {
      const args = decodeArgs(a.args);
      accountsIn(args, named);
      const exists = methods.length ? (methods.includes(a.method_name) ? "method exists in the deployed code" : "METHOD NOT FOUND in the deployed code: this action would fail") : acct === null ? "receiver doesn't exist" : acct && !runsCode(acct) ? "receiver has no contract: this action would fail" : "couldn't read the receiver's code";
      const privileged = ADMIN_RE.test(a.method_name) ? "; privileged-looking method (by name)" : "";
      lines.push(`  ${i + 1}. ${await describeCall(receiver, a.method_name, args, a.deposit)}; gas ${Number(BigInt(a.gas) / 10n ** 12n)} Tgas; ${exists}${privileged}`);
      const ta = args as Record<string, string> | null;
      if (/^ft_transfer(_call)?$/.test(a.method_name) && ta?.amount) {
        recipients.add(ta.receiver_id);
        // Only useful before the vote: after it, today's balance says nothing about the balance when it ran.
        if (p.status === "InProgress") {
          const bal: string | null = await viewCallArgs(receiver, "ft_balance_of", { account_id: dao });
          if (bal !== null) lines.push(`     The DAO's balance of this token right now: ${await tokenAmount(receiver, bal)}${BigInt(bal) < BigInt(ta.amount) ? " (LESS than this transfer: it would fail if executed now)" : " (enough for this transfer)"}`);
        }
      }
      if (i === 0) moves = `${a.method_name} on ${receiver}`;
    }
  } else if (kindName === "Transfer" && body) {
    const token = (body.token_id as string) || "";
    const amount = String(body.amount);
    named.add(body.receiver_id as string);
    const what = token ? await tokenAmount(token, amount) : nearExact(amount);
    lines.push(`- If it passes, the DAO pays ${what} to ${body.receiver_id}${body.msg ? ` with ft_transfer_call message ${clip(body.msg, 200)}` : ""}.`);
    moves = `pays ${what.split(" (")[0]} to ${body.receiver_id}`;
    recipients.add(body.receiver_id as string);
  } else if (/MemberToRole|MemberFromRole/.test(kindName) && body) {
    named.add(body.member_id as string);
    lines.push(`- If it passes: ${kindName === "AddMemberToRole" ? "adds" : "removes"} ${body.member_id} ${kindName === "AddMemberToRole" ? "to" : "from"} role "${body.role}". This changes who votes on everything after it.`);
    moves = `${kindName} ${body.member_id}`;
  } else if (/ChangePolicy/.test(kindName) && body) {
    lines.push(`- If it passes, the DAO's voting rules change to: ${clip(body, 2500)}`, "- Compare with the current policy above: who gains or loses votes, and whether the threshold drops.");
    accountsIn(body, named);
    moves = "rewrites the DAO's voting policy";
  } else if (/Upgrade/.test(kindName) && body) {
    lines.push(`- If it passes: ${kindName === "UpgradeSelf" ? "replaces the DAO's own code" : `deploys new code to ${body.receiver_id} via ${body.method_name}`} with the blob whose hash is ${body.hash}. The new code can do anything the DAO can, including moving its funds. Its source isn't visible from the chain.`);
    if (body.receiver_id) named.add(body.receiver_id as string);
    moves = `${kindName} to blob ${body.hash}`;
  } else {
    lines.push(`- Payload: ${clip(body ?? p.kind, 2000)}`);
    if (body) accountsIn(body, named);
    moves = kindName;
  }
  if (recipients.size) lines.push(`- Who receives funds: ${recipients.size} account${recipients.size === 1 ? "" : "s"} (${[...recipients].join(", ")})`);
  if (named.size) {
    lines.push("- Accounts this proposal touches:");
    for (const a of [...named].slice(0, 6)) lines.push(`  - ${await accountLine(a)}`);
  }
  // Context: what this proposer and this DAO usually do, so an odd one stands out.
  const last: number | null = await viewCall(dao, "get_last_proposal_id");
  if (last) {
    const from = Math.max(0, Math.min(p.id, last) - 6);
    const recent: Proposal[] = (await viewCallArgs(dao, "get_proposals", { from_index: from, limit: 6 })) ?? [];
    const others = recent.filter((x) => x.id !== p.id);
    if (others.length)
      lines.push(`- Neighbouring proposals for context (voters not read): ${others.map((x) => `#${x.id} by ${x.proposer}, ${typeof x.kind === "string" ? x.kind : Object.keys(x.kind)[0]}, ${x.status}: "${clip(x.description, 80)}"`).join("; ")}`);
  }
  return { facts: lines.join("\n"), summary: `proposal #${p.id} on ${dao}: ${kindName} (${moves}), ${p.status}` };
}

// ---------- transaction forensics ----------

const TX_HASH_RE = /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{43,44}(?![1-9A-HJ-NP-Za-km-z])/;
export const findTxHash = (text: string) => text.match(TX_HASH_RE)?.[0] ?? null;
const ARCHIVE: Record<Net, string[]> = {
  mainnet: ["https://archival-rpc.mainnet.fastnear.com", "https://rpc.mainnet.fastnear.com"],
  testnet: ["https://archival-rpc.testnet.fastnear.com", ...RPC_URLS],
};

type Outcome = { executor_id: string; logs: string[]; status: Record<string, unknown>; gas_burnt: number; tokens_burnt: string; receipt_ids: string[] };
type TxStatus = {
  status: Record<string, unknown>;
  transaction: { hash: string; signer_id: string; receiver_id: string; actions: (Record<string, Record<string, string>> | string)[] };
  transaction_outcome: { outcome: Outcome };
  receipts_outcome: { id: string; outcome: Outcome }[];
  receipts: { receipt_id: string; predecessor_id: string; receiver_id: string; receipt: { Action?: { actions: (Record<string, Record<string, string>> | string)[] } } }[];
};

/** Finds the transaction on mainnet or testnet. The RPC needs the sender: from the job, or from NearBlocks. */
export async function findTx(hash: string, text: string): Promise<{ tx: TxStatus; net: Net } | null> {
  const senders = findAccounts(text);
  if (!senders.length) {
    const nb = await fetchJson(`https://api.nearblocks.io/v1/txns/${hash}`);
    const s = nb?.txns?.[0]?.signer_account_id;
    if (s) senders.push(s);
  }
  for (const sender of senders) {
    const tx = await rpcMethod(ARCHIVE[netOf(sender)], "EXPERIMENTAL_tx_status", { tx_hash: hash, sender_account_id: sender, wait_until: "NONE" }).catch(() => null);
    if (tx?.transaction) return { tx, net: netOf(sender) };
  }
  return null;
}

const errorText = (status: Record<string, unknown>) => {
  const f = status.Failure as Record<string, unknown> | undefined;
  if (!f) return null;
  const s = JSON.stringify(f);
  return s.match(/"ExecutionError":"([^"]+)"/)?.[1] ?? s.slice(0, 400);
};

async function describeActions(receiver: string, actions: (Record<string, Record<string, string>> | string)[]) {
  return Promise.all(
    actions.map(async (a) => {
      if (typeof a === "string") return a;
      const [kind, v] = Object.entries(a)[0];
      if (kind === "FunctionCall") return describeCall(receiver, v.method_name, decodeArgs(v.args), v.deposit);
      if (kind === "Transfer") return `Transfer ${nearExact(v.deposit)} to ${receiver}`;
      if (kind === "AddKey") return `AddKey ${v.public_key} (${clip(v.access_key, 200)})`;
      if (kind === "DeleteKey") return `DeleteKey ${v.public_key}`;
      if (kind === "DeployContract") return "DeployContract (new code)";
      return `${kind} ${clip(v, 200)}`;
    }),
  );
}

/** Token and NEP-297 events in a receipt's logs, in words. */
async function describeLogs(logs: string[]) {
  const out: string[] = [];
  for (const log of logs.slice(0, 8)) {
    if (!log.startsWith("EVENT_JSON:")) {
      out.push(`log: ${clip(log, 200)}`);
      continue;
    }
    try {
      const e = JSON.parse(log.slice(11));
      out.push(`event ${e.standard}/${e.event}: ${clip(e.data, 300)}`);
    } catch {
      out.push(`log: ${clip(log, 200)}`);
    }
  }
  return out;
}

export async function txReport(hash: string, text: string): Promise<{ facts: string; summary: string }> {
  const found = await findTx(hash, text);
  if (!found) return { facts: `TRANSACTION ${hash}: not found on NEAR mainnet or testnet (if it's on testnet, name the account that sent it).`, summary: `transaction ${hash} not found` };
  const { tx, net } = found;
  const t = tx.transaction;
  const err = errorText(tx.status);
  const byId = new Map(tx.receipts.map((r) => [r.receipt_id, r]));
  const failed = tx.receipts_outcome.filter((r) => r.outcome.status.Failure);
  const lines = [
    `TRANSACTION ${t.hash} on NEAR ${net}, read with EXPERIMENTAL_tx_status`,
    `- Signed by ${t.signer_id}, sent to ${t.receiver_id}`,
    `- Overall result: ${err ? `FAILED: ${err}` : "succeeded"}${failed.length ? ` (${failed.length} of ${tx.receipts_outcome.length} receipts failed)` : ""}`,
    `- What the signer asked for: ${(await describeActions(t.receiver_id, t.actions)).join(" | ")}`,
  ];
  let fees = BigInt(tx.transaction_outcome.outcome.tokens_burnt);
  // NEAR attached anywhere in the transaction. With none attached, every system refund is unused gas coming back.
  const attached = t.actions.reduce((sum, a) => {
    const v = typeof a === "string" ? null : Object.values(a)[0];
    return sum + BigInt(v?.deposit ?? 0);
  }, 0n);
  lines.push(`- NEAR attached by the signer: ${nearExact(attached.toString())}`);
  // Relayed messages (NEAR Intents, meta-transactions): the account that signed the message isn't the one that sent the transaction.
  const inner = [...new Set([...JSON.stringify(t.actions.map((x) => (typeof x === "string" ? x : decodeArgs(Object.values(x)[0]?.args ?? "")))).matchAll(/signer_id\\*":\\*"([a-z0-9._-]+)/g)].map((m) => m[1]))].filter((x) => x !== t.signer_id);
  if (inner.length) lines.push(`- Inside the call, a message signed by ${inner.join(", ")} (signer_id in the arguments). ${t.signer_id} only submitted it, like a relayer; the user behind this is most likely ${inner[0]}, and fees were paid by ${t.signer_id}.`);
  lines.push("- Receipts, in the order they ran (each runs on its own; a failure does NOT undo receipts that already succeeded, and a failed receipt's attached NEAR is refunded):");
  for (const [i, r] of tx.receipts_outcome.slice(0, 30).entries()) {
    const rc = byId.get(r.id);
    const o = r.outcome;
    fees += BigInt(o.tokens_burnt);
    const from = rc?.predecessor_id ?? "?";
    const acts = rc?.receipt.Action ? await describeActions(o.executor_id, rc.receipt.Action.actions) : ["data receipt"];
    const refund = from === "system" ? (attached === 0n ? " [system refund of unused gas prepayment, not a deposit]" : " [system refund: unused gas, and/or the deposit of a failed receipt]") : "";
    const status = o.status.Failure ? `FAILED: ${errorText(o.status)}` : "ok";
    lines.push(`  ${i + 1}. ${from} -> ${o.executor_id}${refund}: ${acts.join(" | ")} => ${status}`);
    for (const l of await describeLogs(o.logs)) lines.push(`     ${l}`);
  }
  if (tx.receipts_outcome.length > 30) lines.push(`  … ${tx.receipts_outcome.length - 30} more receipts not shown`);
  lines.push(`- Total gas fees burnt: ${nearExact(fees.toString())}`);
  const nb = net === "mainnet" ? await fetchJson(`https://api.nearblocks.io/v1/txns/${hash}`) : null;
  const ts = nb?.txns?.[0]?.block_timestamp;
  if (ts) lines.push(`- Time: ${new Date(Number(BigInt(ts) / 1_000_000n)).toISOString().replace("T", " ").slice(0, 19)} UTC`);
  return { facts: lines.join("\n"), summary: `transaction ${hash.slice(0, 8)}… from ${t.signer_id} to ${t.receiver_id}: ${err ? `failed (${err.slice(0, 80)})` : "succeeded"}, ${tx.receipts_outcome.length} receipts` };
}

// ---------- the evidence an agent works from ----------

type Source = Awaited<ReturnType<typeof repoSource>>;
const sourceParts = (src: Source) => {
  const scan = scanNear(src.files);
  const code = src.files.map((f) => `=== ${f.path} ===\n${f.text.split("\n").map((l, i) => `${String(i + 1).padStart(4)}| ${l}`).join("\n")}`).join("\n\n");
  return [
    `SOURCE: ${src.label}. Files read: ${src.files.map((f) => f.path).join(", ") || "none"}${src.skipped ? ` (${src.skipped} more skipped to stay within budget)` : ""}`,
    `STATIC SCAN (pattern matches to verify, not verdicts):\n${scan.map((s) => `- ${s}`).join("\n")}`,
    `CODE (with line numbers):\n${code}`,
  ];
};
const sourceSummary = (src: Source) => {
  const n = scanNear(src.files).length;
  return `Read ${src.files.length} file${src.files.length === 1 ? "" : "s"} from ${src.label}; the scan flagged ${n} pattern${n === 1 ? "" : "s"}`;
};

export type Evidence = { facts: string; summary: string[] };

/** Runs the tools a job's skills call for. Returns null if the job needs no tools. */
export async function gatherEvidence(job: Pick<Job, "description" | "skills">): Promise<Evidence | null> {
  const parts: string[] = [];
  const summary: string[] = [];
  let sourceRead = false;
  if (job.skills.includes("due-diligence")) {
    for (const id of findAccounts(job.description)) {
      const r = await accountReport(id).catch((e) => ({ facts: `ACCOUNT ${id}: couldn't be read (${e instanceof Error ? e.message : e}).`, summary: `${id}: couldn't be read` }));
      parts.push(r.facts);
      summary.push(`Read ${r.summary}`);
      // Due diligence on a contract needs its code: if the contract publishes a GitHub link (NEP-330), read that source too.
      const link = r.facts.match(/Published source \(NEP-330\):[^\n]*?link (https:\/\/github\.com\/\S+?),/)?.[1];
      if (link && !job.skills.includes("contract-review") && !sourceRead) {
        try {
          const src = await repoSource(link);
          parts.push(...sourceParts(src));
          summary.push(sourceSummary(src));
          sourceRead = true;
        } catch (e) {
          parts.push(`SOURCE: the contract links ${link}, but it couldn't be read (${e instanceof Error ? e.message : e}). Is the repo public?`);
          summary.push(`Couldn't read the linked source (${link.replace("https://", "")})`);
        }
      }
    }
  }
  if (job.skills.includes("contract-review")) {
    try {
      const src = await repoSource(job.description);
      parts.push(...sourceParts(src));
      summary.push(sourceSummary(src));
    } catch (e) {
      parts.push(`SOURCE: couldn't be fetched (${e instanceof Error ? e.message : e}).`);
      summary.push("Couldn't fetch the source");
    }
  }
  if (job.skills.includes("proposal-review")) {
    const prop = findProposal(job.description);
    if (prop) {
      const r = await proposalReport(prop.dao, prop.id).catch((e) => ({ facts: `PROPOSAL ${prop.id} on ${prop.dao}: couldn't be read (${e instanceof Error ? e.message : e}).`, summary: "couldn't read the proposal" }));
      parts.push(r.facts);
      summary.push(`Read ${r.summary}`);
    }
  }
  if (job.skills.includes("tx-forensics")) {
    const hash = findTxHash(job.description);
    if (hash) {
      const r = await txReport(hash, job.description).catch((e) => ({ facts: `TRANSACTION ${hash}: couldn't be read (${e instanceof Error ? e.message : e}).`, summary: "couldn't read the transaction" }));
      parts.push(r.facts);
      summary.push(`Read ${r.summary}`);
    }
  }
  return parts.length ? { facts: parts.join("\n\n"), summary } : null;
}
