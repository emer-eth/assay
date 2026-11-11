// NEAR Intents: what the signed intents inside an execute_intents (or simulate_intents) call actually say.
// Pure: the caller passes in how to write a token amount (tools.ts reads the token's metadata on chain),
// so this decodes and describes, and the tests can run without the chain.
// Intent types and fields follow docs.near-intents.org/integration/verifier-contract/intent-types-and-execution.

export type SignedIntent = {
  standard: string;
  signer: string | null;
  deadline: string | null;
  intents: Record<string, unknown>[];
  /** the NEP-413 recipient, when the payload has one (normally intents.near) */
  recipient: string | null;
};

const asObject = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const parse = (v: unknown): unknown => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};

/** Every signed payload in an execute_intents / simulate_intents argument object, decoded. */
export function decodeSignedIntents(args: unknown): SignedIntent[] {
  const signed = asObject(args)?.signed;
  if (!Array.isArray(signed)) return [];
  return signed.flatMap((s) => {
    const o = asObject(s);
    if (!o) return [];
    const payload = parse(o.payload);
    // NEP-413 wraps the message in { message, nonce, recipient }; other standards sign the message directly.
    const p = asObject(payload);
    const message = asObject(parse(p && "message" in p ? p.message : payload));
    if (!message) return [];
    return [{
      standard: String(o.standard ?? "unknown"),
      signer: typeof message.signer_id === "string" ? message.signer_id : null,
      deadline: typeof message.deadline === "string" ? message.deadline : null,
      intents: Array.isArray(message.intents) ? message.intents.filter((i): i is Record<string, unknown> => !!asObject(i)) : [],
      recipient: p && typeof p.recipient === "string" ? p.recipient : null,
    }];
  });
}

/** "nep141:wrap.near" -> the token contract wrap.near; multi-token and NFT ids keep their kind in words. */
export function tokenContract(id: string): { contract: string | null; label: string } {
  const [kind, ...rest] = id.split(":");
  const tail = rest.join(":");
  if (kind === "nep141") return { contract: tail, label: tail };
  if (kind === "nep245") return { contract: null, label: `multi-token ${tail}` };
  if (kind === "nep171") return { contract: null, label: `NFT ${tail}` };
  return { contract: null, label: id };
}

export const isImplicit = (id: string) => /^[0-9a-f]{64}$/.test(id) || /^0x[0-9a-f]{40}$/.test(id);
const who = (id: unknown) => (typeof id === "string" ? (isImplicit(id) ? `${id.slice(0, 8)}… (implicit account)` : id) : "an unnamed account");

type Amount = (tokenId: string, raw: string) => Promise<string>;

async function amounts(tokens: unknown, amount: Amount) {
  const o = asObject(tokens) ?? {};
  return (await Promise.all(Object.entries(o).map(([id, raw]) => {
    const r = String(raw);
    const neg = r.startsWith("-");
    return amount(id, neg ? r.slice(1) : r).then((s) => (neg ? `−${s}` : s));
  }))).join(", ") || "nothing";
}

/** One intent in plain words, plus any flags it raises. */
export async function describeIntent(i: Record<string, unknown>, signer: string | null, amount: Amount): Promise<{ text: string; flags: string[] }> {
  const kind = String(i.intent ?? "unknown");
  const flags: string[] = [];
  switch (kind) {
    case "transfer": {
      if (signer && i.receiver_id === signer) flags.push("transfers to the signer's own account: no tokens change hands");
      const zero = Object.entries(asObject(i.tokens) ?? {}).filter(([, v]) => /^-?0+$/.test(String(v))).map(([k]) => tokenContract(k).label);
      if (zero.length) flags.push(`transfers a zero amount of ${zero.join(", ")}`);
      return { text: `transfer ${await amounts(i.tokens, amount)} to ${who(i.receiver_id)}${i.memo ? ` (memo "${String(i.memo).slice(0, 80)}")` : ""}`, flags };
    }
    case "token_diff": {
      const diff = asObject(i.diff) ?? {};
      const out = Object.fromEntries(Object.entries(diff).filter(([, v]) => String(v).startsWith("-")));
      const inn = Object.fromEntries(Object.entries(diff).filter(([, v]) => !String(v).startsWith("-")));
      return { text: `swap (token_diff): gives ${await amounts(out, amount)}, wants ${await amounts(inn, amount)}`, flags };
    }
    case "ft_withdraw":
    case "nft_withdraw":
    case "mt_withdraw": {
      const token = String(i.token ?? "?");
      const what = kind === "ft_withdraw" ? await amount(`nep141:${token}`, String(i.amount ?? "0")) : `${kind === "nft_withdraw" ? "NFT" : "multi-token"} ${token} ${i.token_id ?? i.token_ids ?? ""}`.trim();
      if (i.msg) flags.push("the withdrawal calls the receiver with a message: the receiving contract decides what happens next");
      if (kind === "ft_withdraw" && /^0+$/.test(String(i.amount ?? ""))) flags.push("withdraws a zero amount");
      return { text: `withdraw ${what} out of NEAR Intents to ${who(i.receiver_id)}${i.memo ? ` (memo "${String(i.memo).slice(0, 80)}")` : ""}`, flags };
    }
    case "native_withdraw":
      return { text: `withdraw ${await amount("nep141:wrap.near", String(i.amount ?? "0"))} as native NEAR to ${who(i.receiver_id)}`, flags };
    case "storage_deposit":
      return { text: `pay storage for ${who(i.account_id)} on ${i.contract_id ?? "a token contract"} (${await amount("nep141:wrap.near", String(i.amount ?? "0"))})`, flags };
    case "add_public_key":
      flags.push(`ADDS A KEY (${String(i.public_key ?? "?").slice(0, 20)}…): whoever holds it can sign intents for this account, including adding more keys`);
      return { text: `add the public key ${i.public_key ?? "?"} to the account`, flags };
    case "remove_public_key":
      return { text: `remove the public key ${i.public_key ?? "?"} from the account`, flags };
    default:
      return { text: `${kind} ${JSON.stringify(i).slice(0, 200)}`, flags };
  }
}

/** The evidence lines for every signed intent in a call, given when the call ran (for the deadline check). */
export async function intentEvidence(args: unknown, executedAt: Date | null, amount: Amount): Promise<string[]> {
  const signed = decodeSignedIntents(args);
  if (!signed.length) return [];
  const lines = [`- NEAR Intents: ${signed.length} signed payload${signed.length === 1 ? "" : "s"} in the call, decoded:`];
  for (const [n, s] of signed.entries()) {
    const flags: string[] = [];
    let deadline = s.deadline ?? "none given";
    if (s.deadline && executedAt) {
      const d = Date.parse(s.deadline);
      if (Number.isFinite(d)) {
        const mins = Math.round((d - executedAt.getTime()) / 60_000);
        deadline += d < executedAt.getTime() ? ` (EXPIRED ${-mins} min before the call ran)` : ` (${mins} min after the call ran, so still valid then)`;
        if (d < executedAt.getTime()) flags.push("the deadline had passed when the call ran");
      }
    }
    lines.push(`  ${n + 1}. signed by ${who(s.signer)} (${s.standard}${s.recipient ? `, for ${s.recipient}` : ""}), deadline ${deadline}`);
    if (!s.intents.length) lines.push("     no intents in the message");
    for (const i of s.intents) {
      const d = await describeIntent(i, s.signer, amount);
      lines.push(`     - ${d.text}`);
      flags.push(...d.flags);
    }
    for (const f of flags) lines.push(`     ! ${f}`);
  }
  lines.push("  (Decoded from the call's own arguments. A flag is a fact about the intent, not the confirmed cause of a failure: compare it with the error.)");
  return lines;
}
