export interface RedactionResult { summary: string; withheld: boolean; reason?: string; }

const secretLike = /(?:\bsk-[A-Za-z0-9_-]{8,}\b|\b(?:api[_-]?key|password|secret|token)\s*[=:]|\bBearer\s+[A-Za-z0-9._-]+)/i;

/** Best-effort display redaction; conservative secret matches withhold the entire record. */
export function redactSummary(input: string): RedactionResult {
  const withoutUrlSecrets = input.replace(/https?:\/\/[^\s?#]+(?:\?[^\s#]*)?(?:#[^\s]*)?/g, (url) => {
    try { const parsed = new URL(url); return `${parsed.origin}${parsed.pathname}`; }
    catch { return '[redacted URL]'; }
  });
  if (secretLike.test(withoutUrlSecrets)) return { summary: '', withheld: true, reason: 'secret_like_content' };
  const summary = withoutUrlSecrets.trim();
  return { summary, withheld: summary.length === 0, reason: summary.length === 0 ? 'empty_after_redaction' : undefined };
}
