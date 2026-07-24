/**
 * context_scanner.ts — Issue #1134
 *
 * VENDORED MIRROR — adapted from
 * `apps/api_server/src/security/context_scanner.ts` (Issue #873). Same
 * scan/block contract; the only change from the source is the logging sink
 * (mcp_server has no `utils/logger`, and stdout is the MCP stdio transport —
 * logging must go to stderr only, never stdout). See
 * docs/ai/current-plan.md #1134 for why this is copied, not imported.
 *
 * Scans tool-result content (Gmail search/read results in this PR) for
 * prompt-injection markers BEFORE the raw content reaches the model.
 *
 * Behavior (per #873's acceptance criteria, reused here):
 *   - A match on any pattern class is treated as high-confidence (see
 *     `HIGH_CONFIDENCE_CLASSES` in injection_patterns.ts) → BLOCK. The scanner
 *     never silently forwards flagged content.
 *   - Clean content passes through with an empty `matches` array and no
 *     warning.
 *   - The scanner is READ-ONLY: it never mutates the input.
 *   - NEVER logs scanned content — only the pattern id/class/description and
 *     the source label supplied by the caller.
 *   - Fast: a single pass over `INJECTION_PATTERNS`, each pattern a single
 *     regex `.exec()`.
 */

import {
  HIGH_CONFIDENCE_CLASSES,
  INJECTION_PATTERNS,
  type InjectionPatternClass,
} from './injection_patterns.js';

export interface InjectionMatch {
  patternId: string;
  class: InjectionPatternClass;
  description: string;
}

export interface ContextScanResult {
  /** True when the content must NOT be forwarded to the model. */
  blocked: boolean;
  /** Every pattern that matched (empty when clean). */
  matches: InjectionMatch[];
  /**
   * Human-readable warning line, e.g.
   * "[BLOCKED: gmail message contained potential prompt injection. Content not loaded.]"
   * `null` when the content is clean.
   */
  warning: string | null;
}

/**
 * Scan `content` for prompt-injection markers.
 *
 * @param content    raw text (never mutated).
 * @param sourceLabel a short, log-safe label identifying the source — e.g.
 *                     "gmail message" — used ONLY in the warning message and
 *                     log line, never the content itself.
 */
export function scanContextContent(
  content: string,
  sourceLabel: string,
): ContextScanResult {
  const matches: InjectionMatch[] = [];

  for (const pattern of INJECTION_PATTERNS) {
    // Fresh RegExp per test to avoid `lastIndex` state leaking across calls
    // for any pattern that were ever authored with a 'g'/'y' flag.
    const re = new RegExp(pattern.regex.source, pattern.regex.flags);
    if (re.test(content)) {
      matches.push({
        patternId: pattern.id,
        class: pattern.class,
        description: pattern.description,
      });
    }
  }

  const blocked = matches.some((m) => HIGH_CONFIDENCE_CLASSES.has(m.class));

  if (!blocked) {
    return { blocked: false, matches, warning: null };
  }

  const warning = `[BLOCKED: ${sourceLabel} contained potential prompt injection. Content not loaded.]`;

  // Log the pattern names/classes only — never the scanned content. stderr
  // only: stdout is the MCP stdio transport in this process.
  for (const m of matches) {
    process.stderr.write(
      `[context_scanner] BLOCKED "${sourceLabel}" — pattern "${m.patternId}" (${m.class}): ${m.description}\n`,
    );
  }

  return { blocked: true, matches, warning };
}
