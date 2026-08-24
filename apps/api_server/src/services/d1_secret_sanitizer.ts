/**
 * D1.1 (#1426) — the dedicated, deterministic secret sanitizer for the D1
 * tool-vetting write boundary ({@link ToolSafetyReportsRepository}).
 *
 * `redactSecrets` (run_outcome_service.ts) only matches a handful of known
 * TOKEN SHAPES (Bearer/sk-/ghp_/JWT/xox/AKIA) inside free text — it says
 * nothing about a `password=`/`token:` ASSIGNMENT whose value doesn't look
 * like one of those shapes, a private-key block, a cookie header, a
 * database connection string with embedded userinfo, or a JSON value sitting
 * under a secret-SHAPED KEY (e.g. `{"apiKey": "myplaintextvalue"}`) where the
 * key name is the only signal that the value is sensitive. This module
 * covers all of those, in addition to every shape `redactSecrets` already
 * catches, and is applied to EVERY caller-controlled text field this track
 * persists — not only the JSON blob columns.
 *
 * Two entry points:
 *  - {@link sanitizeD1PlainText} — for plain scalar fields (toolName,
 *    toolVersion, packageSource, installMethod, reason): scrubs secret
 *    SHAPES out of the raw string. These fields are supposed to be short
 *    identifiers, not prose, so there is no key/value structure to walk.
 *  - {@link sanitizeD1Json} — for JSON blob columns (the three observation
 *    arrays and evidenceJson): parses the JSON, walks every nested
 *    value, redacts the WHOLE value when its key looks secret-shaped
 *    (regardless of what the value itself looks like), and otherwise
 *    scrubs secret shapes out of string leaves. Falls back to plain-text
 *    scrubbing if the input does not parse as JSON, so a malformed blob is
 *    still never persisted with a live secret shape intact.
 *
 * Deterministic and fail-closed: never throws, never logs a rejected or
 * scrubbed value (a value that couldn't be sanitized safely is simply
 * replaced with the fixed `[redacted]` marker, never written to a log line
 * or re-thrown with its own content attached).
 */

const REDACTED = '[redacted]';

/** Shape-matching secret patterns — token/credential formats this product actually handles. */
const SECRET_SHAPE_PATTERNS: RegExp[] = [
  // Bearer / generic Authorization-header-shaped tokens.
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi,
  // Named provider token prefixes.
  /\bsk-[A-Za-z0-9._-]{12,}/gi,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{8,}/g,
  /\bAKIA[0-9A-Z]{12,}/g,
  // JWTs (three base64url segments separated by dots).
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g,
  // `key = value` / `key: value` assignments where the key names a secret.
  /\b(api[_-]?key|access[_-]?key|secret[_-]?key|client[_-]?secret|password|passwd|pwd|token|private[_-]?key)\s*[:=]\s*['"]?[^\s'",;]+['"]?/gi,
  // PEM-style private key blocks (any variant).
  /-----BEGIN\s+[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END\s+[A-Z ]*PRIVATE KEY-----/g,
  // Cookie / Set-Cookie header lines.
  /\b(Set-)?Cookie:\s*[^\r\n]+/gi,
  // postgres/mysql/mongodb connection strings carrying userinfo (user:pass@host).
  /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^:/\s@]+:[^@/\s]+@[^\s'"]+/gi,
];

/** Object keys whose VALUE is redacted unconditionally, regardless of the value's own shape. */
const SECRET_KEY_PATTERN =
  /(password|passwd|pwd|token|secret|api[_-]?key|access[_-]?key|private[_-]?key|credential|authoriz(?:e|ation)|cookie|jwt|dsn|connection[_-]?string|client[_-]?secret)/i;

/** Scrub every known secret shape out of a plain string. Never throws. */
export function sanitizeD1PlainText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  let out = String(value);
  for (const pattern of SECRET_SHAPE_PATTERNS) out = out.replace(pattern, REDACTED);
  return out;
}

function isSecretShapedKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

function sanitizeJsonValue(value: unknown, keyHint: string | null): unknown {
  if (keyHint !== null && isSecretShapedKey(keyHint)) {
    return REDACTED;
  }
  if (typeof value === 'string') {
    return sanitizeD1PlainText(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeJsonValue(entry, null));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeJsonValue(v, k);
    }
    return out;
  }
  return value;
}

/**
 * Sanitize a JSON-blob column value. Recursively redacts secret-shaped keys
 * (whole value replaced) and scrubs secret shapes out of every string leaf.
 * Falls back to plain-text scrubbing (never a throw) if `raw` does not parse
 * as JSON — a malformed blob still cannot carry a live secret shape through.
 */
export function sanitizeD1Json(raw: string | null | undefined): string {
  if (raw === null || raw === undefined || raw.length === 0) return raw ?? '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return sanitizeD1PlainText(raw) ?? '';
  }
  const sanitized = sanitizeJsonValue(parsed, null);
  return JSON.stringify(sanitized);
}
