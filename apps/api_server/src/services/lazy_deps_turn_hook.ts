/**
 * lazy_deps_turn_hook.ts — #876 (setup-06): "on first use" integration point.
 *
 * The model's real skill invocation happens inside the vendored opencode
 * fork's `skill` tool (apps/opencode_fork/.../tool/skill.ts) — out of reach
 * without touching vendored code. The only api_server-observable signal that
 * a specific named skill was invoked in a turn is the persisted tool-call
 * PART: OpencodeStreamBridge already persists every `message.part.updated`
 * part into `agent_session_messages.parts_json` via `upsertPart` (see
 * opencode_stream_bridge.ts). A `type: 'tool'` part for the `skill` tool
 * carries the invoked skill's name in its `input` (or `state.input`) —
 * `{ name: <skillName> }`, per the fork's `SkillTool` parameters schema.
 *
 * This module is deliberately decoupled from the exact call site so it can be
 * invoked from the turn-completion hook (mirroring `queueSkillExtraction`'s
 * fire-and-forget, non-fatal pattern) without entangling stream-bridge
 * internals with lazy-install logic.
 */

import { opencodeClient } from './opencode_engine';
import { parseSkillFrontmatter } from './skill_frontmatter';
import { ensurePythonDependencies, type EnsurePythonDependenciesResult } from './lazy_deps';
import { readSkillContentAtLocation } from './rhythm_managed_skills';
import type { PythonDependency } from './skill_frontmatter';
import { logger } from '../utils/logger';

/**
 * Parse a turn's persisted message parts for `skill` tool-call invocations,
 * returning the distinct skill names invoked (first-seen order). Never
 * throws — malformed/unexpected part shapes are silently skipped.
 */
export function extractInvokedSkillNamesFromParts(parts: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const part of parts) {
    try {
      if (!part || typeof part !== 'object') continue;
      const p = part as Record<string, unknown>;
      if (p.type !== 'tool') continue;

      const toolId = (p.tool as string | undefined) ?? (p.name as string | undefined);
      if (toolId !== 'skill') continue;

      const state = (p.state as Record<string, unknown> | undefined) ?? undefined;
      const input =
        (state?.input as Record<string, unknown> | undefined) ??
        (p.input as Record<string, unknown> | undefined);
      const skillName = input?.name;
      if (typeof skillName === 'string' && skillName.trim() !== '' && !seen.has(skillName)) {
        seen.add(skillName);
        out.push(skillName);
      }
    } catch {
      continue;
    }
  }

  return out;
}

export interface EnsureLazyDepsForTurnDeps {
  /** Injectable engine content reader (defaults to opencodeClient.listSkillsWithContent). */
  listSkillsWithContent?: (
    directory?: string,
  ) => Promise<Array<{ name: string; location: string; content: string }>>;
  /** Injectable dependency installer (defaults to ensurePythonDependencies). */
  ensureDeps?: (
    skillName: string,
    deps: PythonDependency[],
  ) => Promise<EnsurePythonDependenciesResult>;
}

/**
 * For every skill name invoked in a completed turn, resolve its live SKILL.md
 * frontmatter and — if it declares `python_dependencies` — ensure they're
 * installed (subject to lazy_deps.ts's allowlist/opt-out/audit-log
 * contract). Fire-and-forget: never throws, so a lookup or install failure
 * can never break the turn that triggered it (mirrors queueSkillExtraction's
 * posture in opencode_stream_bridge.ts).
 */
export async function ensureLazyDepsForTurn(
  invokedSkillNames: string[],
  deps: EnsureLazyDepsForTurnDeps = {},
): Promise<void> {
  if (invokedSkillNames.length === 0) return;

  const listSkillsWithContent =
    deps.listSkillsWithContent ?? ((dir?: string) => opencodeClient.listSkillsWithContent(dir));
  const ensureDeps = deps.ensureDeps ?? ensurePythonDependencies;

  try {
    const live = await listSkillsWithContent();
    const byName = new Map(live.map((s) => [s.name, s]));

    for (const name of invokedSkillNames) {
      const skill = byName.get(name);
      if (!skill) continue; // invoked-but-not-found — nothing to install for

      const fm = parseSkillFrontmatter(readSkillContentAtLocation(skill.location) ?? '');
      if (fm.pythonDependencies.length === 0) continue;

      try {
        const result = await ensureDeps(name, fm.pythonDependencies);
        if (result.unavailable.length > 0) {
          for (const u of result.unavailable) {
            logger.warn(`[lazy-deps] skill "${name}": ${u.message}`);
          }
        }
      } catch (err) {
        logger.warn(`[lazy-deps] ensurePythonDependencies failed for skill "${name}" (non-fatal): ${String(err)}`);
      }
    }
  } catch (err) {
    logger.warn(`[lazy-deps] listSkillsWithContent failed (non-fatal): ${String(err)}`);
  }
}
