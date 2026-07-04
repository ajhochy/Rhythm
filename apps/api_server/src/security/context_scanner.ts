/**
 * context_scanner.ts — Issue #873
 *
 * Scans agent context files (AGENTS.md-like docs, skill bodies, agent-profile
 * role/system-prompt text) for prompt-injection markers BEFORE they are
 * loaded into a model-facing prompt or written to a location the opencode
 * engine reads as a system prompt (e.g. `writeManagedSkill`,
 * `writeAgentProfileFile`).
 *
 * Behavior (per the issue's acceptance criteria):
 *   - A match on any pattern class is treated as high-confidence (see
 *     `HIGH_CONFIDENCE_CLASSES` in injection_patterns.ts) → BLOCK. The scanner
 *     never silently loads a flagged file.
 *   - Clean files pass through with an empty `matches` array and no warning.
 *   - The scanner is READ-ONLY: it never mutates, deletes, or moves the
 *     scanned file. Blocking here means "the caller must not use this
 *     content," not "the file disappears" — the file stays exactly as-is on
 *     disk so a user can inspect it manually.
 *   - NEVER logs file contents (even the blocked portion) — only the pattern
 *     id/class/description and the source label supplied by the caller.
 *   - Fast: a single pass over `INJECTION_PATTERNS` per file, each pattern a
 *     single regex `.exec()` — comfortably under the 50ms/50KB budget.
 */

import { logger } from '../utils/logger';
import {
  HIGH_CONFIDENCE_CLASSES,
  INJECTION_PATTERNS,
  type InjectionPatternClass,
} from './injection_patterns';

export interface InjectionMatch {
  patternId: string;
  class: InjectionPatternClass;
  description: string;
}

export interface ContextScanResult {
  /** True when the file must NOT be loaded into the agent's context. */
  blocked: boolean;
  /** Every pattern that matched (empty when clean). */
  matches: InjectionMatch[];
  /**
   * Human-readable warning line, e.g.
   * "[BLOCKED: AGENTS.md contained potential prompt injection. Content not loaded.]"
   * `null` when the file is clean.
   */
  warning: string | null;
}

/**
 * Scan `content` (already-read file text) for prompt-injection markers.
 *
 * @param content    raw file text (never mutated).
 * @param sourceLabel a short, log-safe label identifying the file — e.g. a
 *                     filename or skill name — used ONLY in the warning
 *                     message and log line, never the content itself.
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

  // Log the pattern names/classes only — never the scanned content.
  for (const m of matches) {
    logger.warn(
      `[context_scanner] BLOCKED "${sourceLabel}" — pattern "${m.patternId}" (${m.class}): ${m.description}`,
    );
  }

  return { blocked: true, matches, warning };
}

/**
 * Convenience wrapper: read `filePath` from disk and scan it. Read-only —
 * never writes, deletes, or renames the file. Returns a scan result the
 * caller uses to decide whether to proceed with loading; the file itself is
 * left completely untouched either way.
 */
export function scanContextFile(filePath: string, content: string): ContextScanResult {
  return scanContextContent(content, filePath);
}
