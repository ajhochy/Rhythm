/**
 * injection_patterns.ts — Issue #873
 *
 * Maintainable, data-driven pattern list for the prompt-injection context
 * scanner (`context_scanner.ts`). Kept separate from the scanner logic so the
 * patterns can be extended/reviewed without touching scan control flow.
 *
 * Each pattern belongs to a named CLASS. A class is "high-confidence" when a
 * single match should BLOCK the file outright (per #873's "low false-positive
 * bar (warn, don't block, except on high-confidence markers)"). All five
 * classes named in the issue body are high-confidence blocking classes:
 * override-instruction, hidden HTML comment, secrets-reference,
 * exfiltration, and invisible-unicode.
 */

export type InjectionPatternClass =
  | 'override-instruction'
  | 'hidden-html-comment'
  | 'secrets-reference'
  | 'exfiltration'
  | 'invisible-unicode';

export interface InjectionPattern {
  /** Stable id for logging (never logs matched content, only this id + class). */
  id: string;
  class: InjectionPatternClass;
  /** Human-readable description, safe to surface in warnings/logs. */
  description: string;
  /** RegExp tested against the raw file text. Must not use the 'g' flag with .test() misuse — each pattern gets a fresh instance at test time. */
  regex: RegExp;
}

/**
 * Instructions to ignore/override prior context. Case-insensitive; tolerant of
 * common phrasing variants ("ignore all previous", "disregard prior", "new
 * instructions:", "ignore the above", etc).
 */
const OVERRIDE_INSTRUCTION_PATTERNS: InjectionPattern[] = [
  {
    id: 'override-ignore-previous',
    class: 'override-instruction',
    description: 'instruction to ignore previous/prior instructions',
    regex: /ignore\s+(all\s+|the\s+)?(previous|prior|above|earlier)\s+(instructions?|context|prompts?)/i,
  },
  {
    id: 'override-disregard-prior',
    class: 'override-instruction',
    description: 'instruction to disregard prior/all context',
    regex: /disregard\s+(all\s+|the\s+)?(prior|previous|above)\s+(instructions?|context|prompts?)/i,
  },
  {
    id: 'override-new-instructions',
    class: 'override-instruction',
    description: '"new instructions:" override lure',
    regex: /new\s+instructions?\s*:/i,
  },
  {
    id: 'override-forget-instructions',
    class: 'override-instruction',
    description: 'instruction to forget/discard prior instructions',
    regex: /forget\s+(all\s+|the\s+)?(previous|prior|above)\s+(instructions?|context|prompts?)/i,
  },
  {
    id: 'override-system-prompt-reveal',
    class: 'override-instruction',
    description: 'instruction to override or reveal the system prompt',
    regex: /(override|bypass)\s+(your\s+|the\s+)?(system\s+prompt|instructions?|guardrails?|rules)/i,
  },
];

/** Hidden HTML comments carrying instructions. */
const HIDDEN_HTML_COMMENT_PATTERNS: InjectionPattern[] = [
  {
    id: 'hidden-comment-instruction',
    class: 'hidden-html-comment',
    description: 'HTML comment containing instruction-like directives',
    // Matches an HTML comment whose body contains imperative/agent-directed
    // language — deliberately narrower than "any HTML comment" to avoid
    // false-positiving on legitimate markdown comments (e.g. editor notes).
    // The body class `[^-]|-(?!->)` matches any char that isn't the start of
    // "-->", so the pattern cannot cross into a SUBSEQUENT unrelated comment
    // the way a bare `[\s\S]*?` would when no keyword appears before the
    // first comment's own close (e.g. two short, keyword-free comments with
    // ordinary prose between them that happens to contain these words).
    regex: /<!--(?:[^-]|-(?!->))*?\b(ignore|disregard|instead|you must|execute|run|assistant|agent|do not tell|secretly)\b(?:[^-]|-(?!->))*?-->/i,
  },
];

/** References to secret material a hijacked agent might be steered to read. */
const SECRETS_REFERENCE_PATTERNS: InjectionPattern[] = [
  {
    id: 'secrets-dotenv',
    class: 'secrets-reference',
    description: 'reference to a .env file',
    regex: /\.env\b/,
  },
  {
    id: 'secrets-credentials-file',
    class: 'secrets-reference',
    description: 'reference to a credentials file',
    regex: /\bcredentials\.(json|yml|yaml|txt)\b/i,
  },
  {
    id: 'secrets-netrc',
    class: 'secrets-reference',
    description: 'reference to .netrc',
    regex: /\.netrc\b/,
  },
  {
    id: 'secrets-ssh-key',
    class: 'secrets-reference',
    description: 'reference to an SSH private key file',
    regex: /\bid_rsa\b|\bid_ed25519\b/,
  },
  {
    id: 'secrets-read-and-send',
    class: 'secrets-reference',
    description: 'instruction to read a secret and send/paste/output it',
    regex: /(read|cat|open|print)\s+[^\n]{0,40}(secret|api[_-]?key|password|token)[^\n]{0,40}(and\s+(send|paste|output|reveal|share))/i,
  },
];

/** Credential-exfiltration patterns: fetch tools piped through shell substitution. */
const EXFILTRATION_PATTERNS: InjectionPattern[] = [
  {
    id: 'exfil-curl-pipe-shell',
    class: 'exfiltration',
    description: 'curl piped into a shell interpreter',
    regex: /curl\s+[^\n|]*https?:\/\/[^\n|]*\|\s*(sh|bash|zsh)\b/i,
  },
  {
    id: 'exfil-wget-pipe-shell',
    class: 'exfiltration',
    description: 'wget piped into a shell interpreter',
    regex: /wget\s+[^\n|]*https?:\/\/[^\n|]*\|\s*(sh|bash|zsh)\b/i,
  },
  {
    id: 'exfil-shell-substitution',
    class: 'exfiltration',
    description: 'curl/wget invoked inside a shell command substitution',
    // Deliberately limited to `$(...)` POSIX command substitution. A bare
    // backtick-wrapped curl/wget is indistinguishable from an ordinary
    // markdown inline-code span documenting a curl command (see
    // docs/ai/testing-guide.md's manual-smoke checklist) and would be a
    // false positive; genuine backtick shell substitution combined with a
    // remote fetch is vanishingly rare compared to that legitimate usage.
    regex: /\$\((curl|wget)\s+[^)]*https?:\/\/[^)]*\)/i,
  },
];

/**
 * Invisible/steganographic Unicode: zero-width spaces, bidi overrides, and
 * soft hyphens can hide instructions from a human reviewer while still being
 * tokenized/read by the model.
 *   - U+200B          zero-width space
 *   - U+200C, U+200D  zero-width non-joiner / joiner
 *   - U+202A-U+202E   bidi embedding/override controls
 *   - U+2066-U+2069   bidi isolate controls
 *   - U+00AD          soft hyphen
 *   - U+FEFF          zero-width no-break space (BOM used mid-text)
 */
const INVISIBLE_UNICODE_PATTERNS: InjectionPattern[] = [
  {
    id: 'invisible-zero-width',
    class: 'invisible-unicode',
    description: 'zero-width space/joiner characters',
    regex: /[​‌‍]/,
  },
  {
    id: 'invisible-bidi-override',
    class: 'invisible-unicode',
    description: 'bidirectional text override/isolate control characters',
    regex: /[‪-‮⁦-⁩]/,
  },
  {
    id: 'invisible-soft-hyphen',
    class: 'invisible-unicode',
    description: 'soft hyphen characters',
    regex: /­/,
  },
  {
    id: 'invisible-bom-mid-text',
    class: 'invisible-unicode',
    description: 'zero-width no-break space (BOM) character',
    regex: /﻿/,
  },
];

/** All patterns, in the order they should be evaluated. */
export const INJECTION_PATTERNS: InjectionPattern[] = [
  ...OVERRIDE_INSTRUCTION_PATTERNS,
  ...HIDDEN_HTML_COMMENT_PATTERNS,
  ...SECRETS_REFERENCE_PATTERNS,
  ...EXFILTRATION_PATTERNS,
  ...INVISIBLE_UNICODE_PATTERNS,
];

/**
 * All five pattern classes are high-confidence per #873 ("low false-positive
 * bar (warn, don't block, except on high-confidence markers)" — the issue's
 * acceptance criteria treat every listed class as block-worthy). Kept as an
 * explicit set (rather than "all classes are high-confidence") so a future
 * lower-confidence class can be added without silently becoming blocking.
 */
export const HIGH_CONFIDENCE_CLASSES: ReadonlySet<InjectionPatternClass> = new Set([
  'override-instruction',
  'hidden-html-comment',
  'secrets-reference',
  'exfiltration',
  'invisible-unicode',
]);
