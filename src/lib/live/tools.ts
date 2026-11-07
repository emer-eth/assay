import "server-only";
import { RPC_URLS } from "../near";
import type { Job } from "../swarm/types";

// Agent tools: what makes a hired agent worth paying instead of asking a chatbot.
// Before it works, the winner reads real inputs, and the same evidence goes to the reviewer,
// so every claim in the report can be checked against it:
//  - due-diligence:   the account's on-chain state (keys, code, its public methods, published source, activity)
//  - contract-review: the contract's source from a public GitHub repo (or code pasted into the job),
//                     plus a NEAR-specific pattern scan with file:line references.

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

type AccountView = { amount: string; locked: string; code_hash: string; storage_usage: number };
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
const ROLE_VIEW_RE = /^(get_)?(owner(_id)?|admins?|super_admins?|guardians?|operators?|managers?|dao(_id)?|governance|council|acl_get_super_admins|acl_get_admins)$/;
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
  const hasCode = acct.code_hash !== NO_CODE;
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
    lines.push(`- Contract: deployed, code hash ${acct.code_hash}${code?.code_base64 ? `, ${Math.round((code.code_base64.length * 0.75) / 1024)} KB` : ""}`);
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

// ---------- the evidence an agent works from ----------

export type Evidence = { facts: string; summary: string[] };

/** Runs the tools a job's skills call for. Returns null if the job needs no tools. */
export async function gatherEvidence(job: Pick<Job, "description" | "skills">): Promise<Evidence | null> {
  const parts: string[] = [];
  const summary: string[] = [];
  if (job.skills.includes("due-diligence")) {
    for (const id of findAccounts(job.description)) {
      const r = await accountReport(id).catch((e) => ({ facts: `ACCOUNT ${id}: couldn't be read (${e instanceof Error ? e.message : e}).`, summary: `${id}: couldn't be read` }));
      parts.push(r.facts);
      summary.push(`Read ${r.summary}`);
    }
  }
  if (job.skills.includes("contract-review")) {
    try {
      const src = await repoSource(job.description);
      const scan = scanNear(src.files);
      const code = src.files.map((f) => `=== ${f.path} ===\n${f.text.split("\n").map((l, i) => `${String(i + 1).padStart(4)}| ${l}`).join("\n")}`).join("\n\n");
      parts.push(
        `SOURCE: ${src.label}. Files read: ${src.files.map((f) => f.path).join(", ") || "none"}${src.skipped ? ` (${src.skipped} more skipped to stay within budget)` : ""}`,
        `STATIC SCAN (pattern matches to verify, not verdicts):\n${scan.map((s) => `- ${s}`).join("\n")}`,
        `CODE (with line numbers):\n${code}`,
      );
      summary.push(`Read ${src.files.length} file${src.files.length === 1 ? "" : "s"} from ${src.label}; the scan flagged ${scan.length} pattern${scan.length === 1 ? "" : "s"}`);
    } catch (e) {
      parts.push(`SOURCE: couldn't be fetched (${e instanceof Error ? e.message : e}).`);
      summary.push("Couldn't fetch the source");
    }
  }
  return parts.length ? { facts: parts.join("\n\n"), summary } : null;
}
