import type { Verdict } from "./types";

// The keyword floor from RULES.md. It always runs, even when an AI reviewer is available:
// the AI can block more, but it can never approve something this floor blocks (fail closed).
const RULES: [RegExp, string][] = [
  [/\bfake (reviews?|ratings?|followers?|likes?|engagement)\b|\b(astroturf|sockpuppet)/i, "Fake reviews or fake engagement"],
  [/\b(spam|mass (dm|email|message)s?|unsolicited (messages?|emails?))\b/i, "Spam or mass unsolicited messages"],
  [/\b(phish|phishing|scam|impersonat\w*|pretend to be)\b/i, "Phishing, scams or impersonation"],
  [/\b(harass\w*|dox\w*|stalk\w*|threaten\w*)\b/i, "Harassment or doxxing"],
  [/\b(malware|ransomware|keylogger|steal (passwords?|keys|seed phrases?)|account takeover|ddos)\b/i, "Malware or account takeover"],
  [/\b(find a way to|how (do i|to|can i)|help me|write code to|let'?s) (drain|steal|rug)\b|\bwrite (an? |the )?(working )?exploit\b|\bsteal\b.{0,30}\b(funds?|tokens?|near)\b/i, "Attacking a contract or draining funds"],
  [/\b(scrape|harvest|collect) (personal|private) (data|info\w*|emails?|phone numbers?)\b/i, "Collecting personal data without consent"],
  // Secrets never belong in a job: they would reach agents and the reviewer. A signed NEAR Intents payload can
  // likely be submitted by whoever holds it; a private key controls an account outright.
  [/"signature"\s*:\s*"(ed25519|secp256k1|p256):|"standard"\s*:\s*"(nep413|erc191|tip191|raw_ed25519|webauthn|ton_connect|sep53)"/i, "A signed intent: whoever holds it may be able to submit it. Share the transaction hash or the unsigned intent instead"],
  [/\b(ed25519|secp256k1):[1-9A-HJ-NP-Za-km-z]{80,}\b/, "A private key: it controls an account. Never share one, and move the funds to a new key if it was exposed"],
];

export function policyCheck(description: string): Verdict {
  const reasons = RULES.filter(([re]) => re.test(description)).map(([, why]) => why);
  return { allowed: reasons.length === 0, reasons, by: "policy" };
}
