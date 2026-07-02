/**
 * org_exercised_tools_resolver.ts — Issue #830 (org-optimizer-14 wiring round).
 *
 * Closes the #821 "prune-guard stub": `org_proposal_measure.ts`'s
 * `MeasureDeps.exercisedTools` previously defaulted to
 * `defaultExercisedTools`, which always returns an empty set — the
 * functional guard that must block a prune of an actively-used scope was
 * unwired (see docs/ai/project-state.md's 2026-07-02 #820/#821 run notes:
 * "the guard provides no real protection until a real telemetry source is
 * wired in").
 *
 * ── Signal source (and its approximation) ───────────────────────────────
 *
 * There is no dedicated "successful tool invocation" event log in this
 * codebase today — `denied_tool_events` (#818) only records the DENY path
 * (a tool a session was NOT allowed to call), which is the opposite signal
 * from what the functional guard needs (tools a profile WAS allowed to use
 * and actually did use). The best available signal for "was this tool
 * actually exercised" is the tool-call parts already persisted into
 * `agent_session_messages.parts_json` by the stream bridge
 * (`opencode_stream_bridge.ts`'s `message.part.updated` handler persists
 * every `{ type: 'tool', tool: <name>, ... }` part it forwards).
 *
 * This resolver:
 *   1. Finds every `agent_scheduled_tasks` row whose `agent_config_id`
 *      matches the profile being measured (a profile can back more than one
 *      scheduled task, and/or run interactively — scheduled-task sessions
 *      are the strongest signal because they carry a durable FK back to the
 *      profile; see the approximation note below for the interactive gap).
 *   2. Finds every `agent_sessions` row whose `scheduled_task_id` points at
 *      one of those tasks, within the trailing window.
 *   3. Scans each such session's `agent_session_messages.parts_json` for
 *      `type === 'tool'` parts and collects the distinct tool names.
 *
 * ── Documented approximation ─────────────────────────────────────────────
 *
 * `agent_sessions` has no direct `agent_config_id` column — a session only
 * carries `mcp_role` (a role SLUG string, e.g. "secretary") or
 * `scheduled_task_id` (an FK to the task, which DOES carry
 * `agent_config_id`). This resolver only follows the `scheduled_task_id`
 * path, so it sees tool usage from SCHEDULED runs of a profile but NOT from
 * ad hoc interactive sessions a human ran under the same `mcp_role` slug
 * without going through a scheduled task. This is a conservative
 * under-approximation in the SAFE direction for the functional guard: it can
 * only ever make the resolver report FEWER exercised tools than reality,
 * which means the guard is, if anything, slightly MORE willing to keep a
 * prune than a perfect resolver would be — never less safe. A future
 * enhancement (tracked informally, not blocking this issue) would extend
 * `agent_sessions` with a real `agent_config_id` column resolved from
 * `mcp_role` at session-create time so interactive sessions are covered too.
 *
 * Never throws — DB errors resolve to an empty set (fail toward "nothing
 * exercised", which is the same posture the previous stub had; this module
 * only makes the non-scheduled-task signal REAL where it can, it does not
 * regress the safety direction of the guard on error).
 */

import { getDb } from '../database/db';
import { env } from '../config/env';
import { logger } from '../utils/logger';

/** Default trailing window for "recently exercised" — 30 days. */
const DEFAULT_TRAILING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

interface ToolPart {
  type?: string;
  tool?: string;
  name?: string;
}

function extractToolNamesFromPartsJson(partsJson: string | null): string[] {
  if (!partsJson) return [];
  try {
    const parts = JSON.parse(partsJson) as ToolPart[];
    if (!Array.isArray(parts)) return [];
    const names: string[] = [];
    for (const part of parts) {
      if (part && part.type === 'tool') {
        const name = part.tool ?? part.name;
        if (typeof name === 'string' && name.trim()) names.push(name);
      }
    }
    return names;
  } catch {
    return [];
  }
}

/**
 * Resolve the set of tool names ACTUALLY exercised by sessions run under
 * `agentConfigId` within `sinceIso` (defaults to the trailing 30 days). See
 * the module header for the exact signal + its documented approximation.
 *
 * No-op (returns an empty set) under Postgres — this reads local-SQLite-only
 * agent-execution tables (agent_scheduled_tasks / agent_sessions /
 * agent_session_messages), consistent with the rest of the org-optimizer
 * subsystem.
 */
export async function resolveExercisedTools(
  agentConfigId: string,
  sinceIso: string = new Date(Date.now() - DEFAULT_TRAILING_WINDOW_MS).toISOString(),
): Promise<Set<string>> {
  if (env.dbClient === 'postgres') return new Set<string>();
  if (!agentConfigId) return new Set<string>();

  try {
    const db = getDb();

    const taskRows = db
      .prepare(`SELECT id FROM agent_scheduled_tasks WHERE agent_config_id = ?`)
      .all(agentConfigId) as { id: string }[];
    if (taskRows.length === 0) return new Set<string>();

    const taskIds = taskRows.map((r) => r.id);
    const placeholders = taskIds.map(() => '?').join(',');

    const sessionRows = db
      .prepare(
        `SELECT id FROM agent_sessions
          WHERE scheduled_task_id IN (${placeholders})
            AND created_at >= ?`,
      )
      .all(...taskIds, sinceIso) as { id: string }[];
    if (sessionRows.length === 0) return new Set<string>();

    const sessionIds = sessionRows.map((r) => r.id);
    const sessionPlaceholders = sessionIds.map(() => '?').join(',');

    const messageRows = db
      .prepare(
        `SELECT parts_json FROM agent_session_messages
          WHERE session_id IN (${sessionPlaceholders})
            AND parts_json IS NOT NULL`,
      )
      .all(...sessionIds) as { parts_json: string | null }[];

    const exercised = new Set<string>();
    for (const row of messageRows) {
      for (const name of extractToolNamesFromPartsJson(row.parts_json)) {
        exercised.add(name);
      }
    }
    return exercised;
  } catch (err) {
    logger.warn(`[org-exercised-tools-resolver] FAILED (non-fatal, returning empty set): ${String(err)}`);
    return new Set<string>();
  }
}
