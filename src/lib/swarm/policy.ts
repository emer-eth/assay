import type { Verdict } from "./types";

// The keyword floor from RULES.md. It always runs, even when an AI reviewer is available:
// the AI can block more, but it can never approve something this floor blocks (fail closed).
const RULES: [RegExp, string][] = [
  [/\bfake (reviews?|ratings?|followers?|likes?|engagement)\b|\b(astroturf|sockpuppet)/i, "Fake reviews or fake engagement"],
  [/\b(spam|mass (dm|email|message)s?|unsolicited (messages?|emails?))\b/i, "Spam or mass unsolicited messages"],
  [/\b(phish|phishing|scam|impersonat\w*|pretend to be)\b/i, "Phishing, scams or impersonation"],
  [/\b(harass\w*|dox\w*|stalk\w*|threaten\w*)\b/i, "Harassment or doxxing"],
  [/\b(malware|ransomware|keylogger|steal (passwords?|keys|seed phrases?)|account takeover|ddos)\b/i, "Malware or account takeover"],
  [/\b(scrape|harvest|collect) (personal|private) (data|info\w*|emails?|phone numbers?)\b/i, "Collecting personal data without consent"],
];

export function policyCheck(description: string): Verdict {
  const reasons = RULES.filter(([re]) => re.test(description)).map(([, why]) => why);
  return { allowed: reasons.length === 0, reasons, by: "policy" };
}
