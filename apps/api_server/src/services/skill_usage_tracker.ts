/**
 * skill_usage_tracker.ts — #929 (skill-self-regulation Unit 2).
 *
 * Harvested skills (#949) are written directly as draft SKILL.md files, never
 * as `agent_skills` DB rows — see docs/ai/decisions/2026-07-08-harvest-to-file
 * -autobind.md. The legacy "uses" counter (`AgentSkillsRepository.incrementUses`,
 * bumped from ws_gateway.ts/agent_runner.ts) only ever touches DB rows, so it
 * cannot see a file-only draft at all: there is no row to increment.
 *
 * This module provides the REAL usage signal instead of reintroducing a DB
 * row: every time the model actually invokes the `skill` tool, the opencode
 * stream bridge persists a `{ type: 'tool', tool: 'skill', state: { input:
 * { name }, status } }` part into `agent_session_messages.parts_json` (see
 * `opencode_stream_bridge.ts`'s `message.part.updated` handler — this is the
 * exact same telemetry `org_exercised_tools_resolver.ts` already mines for a
 * different purpose). `countSkillToolUses` does a single pass over that
 * telemetry (joined to the owning `agent_sessions` row) and returns a name ->
 * count map for every skill actually invoked, counting only `status:
 * 'completed'` calls (a `'not found'`/`'not permitted'` error state is not a
 * genuine use).
 *
 * W3 late-review corrective package — a completed skill call only counts when
 * its OWNING SESSION is eligible per `evaluateLearningSessionEligibility` (the
 * SAME shared predicate learning_session_eligibility.ts uses to gate skill
 * harvesting). Without this, an internal optimizer/scheduled/curator session
 * invoking the `skill` tool on a draft could advance that draft's
 * harvested-eval usage threshold (harvested_skill_evaluator.ts) purely from
 * the learner's own background activity. There is deliberately no second,
 * ad-hoc eligibility filter here — the join carries each row's raw
 * classification columns through `toLearningEligibilitySessionInput` and
 * hands them to the one shared predicate.
 *
 * Skills are shared instance-wide (no owner scoping — mirrors
 * skill_retrieval.ts), so this intentionally scans ALL eligible sessions, not
 * one profile's sessions (unlike org_exercised_tools_resolver, which is
 * profile-scoped by design).
 *
 * Never throws — DB errors resolve to an empty map (fail toward "nothing
 * used yet"). No-op under Postgres (agent-execution tables are local-SQLite
 * only, same posture as org_exercised_tools_resolver.ts).
 */

import { getDb } from '../database/db';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { evaluateLearningSessionEligibility, toLearningEligibilitySessionInput } from './learning_session_eligibility';

interface ToolCallPart {
  type?: string;
  tool?: string;
  state?: {
    status?: string;
    input?: { name?: unknown };
  };
}

function extractSkillNamesFromPartsJson(partsJson: string | null): string[] {
  if (!partsJson) return [];
  try {
    const parts = JSON.parse(partsJson) as ToolCallPart[];
    if (!Array.isArray(parts)) return [];
    const names: string[] = [];
    for (const part of parts) {
      if (!part || part.type !== 'tool' || part.tool !== 'skill') continue;
      if (part.state?.status !== 'completed') continue;
      const name = part.state?.input?.name;
      if (typeof name === 'string' && name.trim()) names.push(name.trim());
    }
    return names;
  } catch {
    return [];
  }
}

interface SkillUsageRow {
  parts_json: string | null;
  is_system: unknown;
  category: unknown;
  mcp_role: unknown;
}

/**
 * Count every completed `skill` tool invocation across ALL eligible sessions,
 * keyed by the invoked skill's `name`. A single join pass over
 * `agent_session_messages` + `agent_sessions` — cheap at this app's scale
 * (mirrors the perf posture documented in skill_retrieval.ts). No-op (empty
 * map) under Postgres; NEVER throws.
 */
export function countSkillToolUses(): Map<string, number> {
  if (env.dbClient === 'postgres') return new Map();

  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT m.parts_json AS parts_json,
                s.is_system AS is_system,
                s.category AS category,
                s.mcp_role AS mcp_role
           FROM agent_session_messages m
           JOIN agent_sessions s ON s.id = m.session_id
          WHERE m.parts_json IS NOT NULL`,
      )
      .all() as SkillUsageRow[];

    const counts = new Map<string, number>();
    for (const row of rows) {
      const eligibility = evaluateLearningSessionEligibility(
        toLearningEligibilitySessionInput({
          is_system: row.is_system,
          category: row.category,
          mcp_role: row.mcp_role,
        }),
      );
      if (!eligibility.eligible) continue;

      for (const name of extractSkillNamesFromPartsJson(row.parts_json)) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    return counts;
  } catch (err) {
    logger.warn(`[skill-usage-tracker] FAILED (non-fatal, returning empty map): ${String(err)}`);
    return new Map();
  }
}
