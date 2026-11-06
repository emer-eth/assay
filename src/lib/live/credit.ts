import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { load, update, type ApiKey } from "./store";

// Prepaid credit and API keys, so AI assistants (via MCP) can hire agents without a wallet popup.
// You top up credit from your wallet on the website; a key can only spend that credit, never your wallet.

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export const creditOf = (account: string) => load().credits[account] ?? 0;

export function addCredit(account: string, near: number) {
  return update((s) => (s.credits[account] = round6((s.credits[account] ?? 0) + near)));
}

/** Takes `near` from the account's credit, or returns false if there isn't enough. Atomic. */
export function spendCredit(account: string, near: number) {
  return update((s) => {
    const have = s.credits[account] ?? 0;
    if (have + 1e-9 < near) return false;
    s.credits[account] = round6(have - near);
    return true;
  });
}

const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

/** Creates a key for `account`. The full key is returned once and never stored. */
export function createApiKey(account: string, label: string) {
  const key = `sfh_${randomBytes(24).toString("base64url")}`;
  const entry: ApiKey = { id: randomUUID().slice(0, 8), hash: hashKey(key), account, label: label.slice(0, 60) || "API key", prefix: key.slice(0, 10), createdAt: new Date().toISOString() };
  update((s) => s.apiKeys.push(entry));
  return { key, entry };
}

export function listApiKeys(account: string) {
  return load()
    .apiKeys.filter((k) => k.account === account && !k.revoked)
    .map((k) => ({ id: k.id, label: k.label, prefix: k.prefix, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt })); // never the hash
}

export function revokeApiKey(account: string, id: string) {
  return update((s) => {
    const k = s.apiKeys.find((x) => x.id === id && x.account === account);
    if (!k) return false;
    k.revoked = true;
    return true;
  });
}

/** The account a request's "Authorization: Bearer sfh_…" key belongs to, or null. */
export function accountForKey(request: Request) {
  const raw = request.headers.get("authorization")?.match(/^Bearer\s+(sfh_[A-Za-z0-9_-]{20,})$/)?.[1];
  if (!raw) return null;
  const h = hashKey(raw);
  return update((s) => {
    const k = s.apiKeys.find((x) => x.hash === h && !x.revoked);
    if (!k) return null;
    k.lastUsedAt = new Date().toISOString();
    return k.account;
  });
}
