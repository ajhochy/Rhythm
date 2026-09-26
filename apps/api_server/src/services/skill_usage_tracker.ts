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
 *
 * 2026-09-17 disconnect triage — the scan is CHUNKED by message id and yields
 * to the event loop between chunks. One synchronous pass over a 4 GB
 * production history is a 14–30 s pread-bound stall of the Node main thread
 * (native sample: StatementIterator::Next → sqlite3_step → pread) during
 * which /health cannot answer, so the desktop HealthPoller declared the local
 * agent server lost ~70 s after every turn. Total work is unchanged; only the
 * blocking shape is.
 */

import { getDb } from '../database/db';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { evaluateLearningSessionEligibility, toLearningEligibilitySessionInput } from './learning_session_eligibility';

interface SkillUsageRow {
  skill_name: unknown;
  is_system: unknown;
  category: unknown;
  mcp_role: unknown;
}

/**
 * Count every completed `skill` tool invocation across ALL eligible sessions,
 * keyed by the invoked skill's `name`. Each call scans current SQLite history
 * joined to `agent_sessions`, so edits and deletes are reflected immediately.
 * No-op (empty map) under Postgres; NEVER throws. SQLite projects only the
 * small metadata fields needed for counting, so unrelated transcript bodies
 * never enter V8.
 */
/** Messages scanned per event-loop turn. */
// ponytail: fixed chunk; make it adaptive (by bytes) if a single chunk of
// 129 MB rows still shows up in /health latency.
const SCAN_CHUNK_ROWS = 100;

const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

export async function countSkillToolUses(): Promise<Map<string, number>> {
  if (env.dbClient === 'postgres') return new Map();

  try {
    const db = getDb();
    const bounds = db
      .prepare('SELECT MIN(id) AS lo, MAX(id) AS hi FROM agent_session_messages')
      .get() as { lo: number | null; hi: number | null };
    const counts = new Map<string, number>();
    if (bounds.lo === null || bounds.hi === null) return counts;

    const chunk = db
      .prepare(
        `WITH skill_parts AS (
           SELECT part.value AS part_json,
                  s.is_system AS is_system,
                  s.category AS category,
                  s.mcp_role AS mcp_role
             FROM agent_session_messages m
             JOIN agent_sessions s ON s.id = m.session_id
             JOIN json_each(
               CASE
                 WHEN json_valid(m.parts_json) THEN
                   CASE WHEN json_type(m.parts_json) = 'array' THEN m.parts_json ELSE '[]' END
                 ELSE '[]'
               END
             ) AS part
            WHERE m.id BETWEEN @lo AND @hi
              AND part.type = 'object'
              AND (
                SELECT field.value
                  FROM json_each(CASE WHEN part.type = 'object' THEN part.value ELSE '{}' END) AS field
                 WHERE field.key = 'type'
                 ORDER BY field.id DESC
                 LIMIT 1
              ) = 'tool'
              AND (
                SELECT field.value
                  FROM json_each(CASE WHEN part.type = 'object' THEN part.value ELSE '{}' END) AS field
                 WHERE field.key = 'tool'
                 ORDER BY field.id DESC
                 LIMIT 1
              ) = 'skill'
         ), states AS (
           SELECT part_json,
                  is_system,
                  category,
                  mcp_role,
                  (
                    SELECT field.value
                      FROM json_each(part_json) AS field
                     WHERE field.key = 'state'
                     ORDER BY field.id DESC
                     LIMIT 1
                  ) AS state_json,
                  (
                    SELECT field.type
                      FROM json_each(part_json) AS field
                     WHERE field.key = 'state'
                     ORDER BY field.id DESC
                     LIMIT 1
                  ) AS state_type
             FROM skill_parts
         ), completed_states AS (
           SELECT is_system,
                  category,
                  mcp_role,
                  (
                    SELECT field.value
                      FROM json_each(CASE WHEN state_type = 'object' THEN state_json ELSE '{}' END) AS field
                     WHERE field.key = 'input'
                     ORDER BY field.id DESC
                     LIMIT 1
                  ) AS input_json,
                  (
                    SELECT field.type
                      FROM json_each(CASE WHEN state_type = 'object' THEN state_json ELSE '{}' END) AS field
                     WHERE field.key = 'input'
                     ORDER BY field.id DESC
                     LIMIT 1
                  ) AS input_type
             FROM states
            WHERE state_type = 'object'
              AND (
                SELECT field.value
                  FROM json_each(CASE WHEN state_type = 'object' THEN state_json ELSE '{}' END) AS field
                 WHERE field.key = 'status'
                 ORDER BY field.id DESC
                 LIMIT 1
              ) = 'completed'
         )
         SELECT (
                  SELECT field.value
                    FROM json_each(CASE WHEN input_type = 'object' THEN input_json ELSE '{}' END) AS field
                   WHERE field.key = 'name'
                   ORDER BY field.id DESC
                   LIMIT 1
                ) AS skill_name,
                is_system,
                category,
                mcp_role
           FROM completed_states
          WHERE input_type = 'object'
            AND (
              SELECT field.type
                FROM json_each(CASE WHEN input_type = 'object' THEN input_json ELSE '{}' END) AS field
               WHERE field.key = 'name'
               ORDER BY field.id DESC
               LIMIT 1
            ) = 'text'`,
      );

    for (let lo = bounds.lo; lo <= bounds.hi; lo += SCAN_CHUNK_ROWS) {
      await yieldToEventLoop();
      const rows = chunk.all({ lo, hi: lo + SCAN_CHUNK_ROWS - 1 }) as SkillUsageRow[];
      for (const row of rows) {
        const eligibility = evaluateLearningSessionEligibility(
          toLearningEligibilitySessionInput({
            is_system: row.is_system,
            category: row.category,
            mcp_role: row.mcp_role,
          }),
        );
        if (!eligibility.eligible) continue;

        const name = typeof row.skill_name === 'string' ? row.skill_name.trim() : '';
        if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    return counts;
  } catch (err) {
    logger.warn(`[skill-usage-tracker] FAILED (non-fatal, returning empty map): ${String(err)}`);
    return new Map();
  }
}
