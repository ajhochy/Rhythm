/**
 * org_exercised_tools_resolver.ts — Issue #830 (org-optimizer-14 wiring round),
 * broadened by Issue #853 (org-optimizer-19) to also cover interactive
 * sessions.
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
 * This resolver attributes sessions to the profile being measured via TWO
 * independent joins, unioned together:
 *
 *   1. Scheduled-task join: every `agent_scheduled_tasks` row whose
 *      `agent_config_id` matches the profile, then every `agent_sessions`
 *      row whose `scheduled_task_id` points at one of those tasks. This is
 *      the strongest signal — a durable FK all the way back to the profile.
 *   2. mcp_role join (#853): every `agent_sessions` row whose `mcp_role`
 *      equals the profile's `agent_configs.id` DIRECTLY. This covers ad hoc
 *      interactive sessions a human ran under the profile without going
 *      through a scheduled task — see `_resolveDeniedAgentConfigId` in
 *      `opencode_stream_bridge.ts` for the precedent: on the #765 interactive
 *      path, `agent_profile_scope` persists the ENFORCING profile's
 *      `agent_configs.id` into `mcp_role`, but legacy paths (POST
 *      /agent-sessions C1, agent_runner role-slug) may instead store a
 *      `.mcp-roles/<slug>` role NAME that is NOT a profile id. `mcp_role` is
 *      therefore only trusted as an attribution signal when it is validated
 *      as an EXACT match against the `agentConfigId` argument (the caller
 *      already knows which profile it is measuring, so this is a simple
 *      equality check, not a general "is this a real agent_configs row"
 *      lookup) — a legacy slug value will simply never equal a real
 *      `agent_configs.id` and is silently excluded, matching the fail-safe
 *      posture of the rest of this module.
 *
 * Sessions matched by EITHER join are deduped (a session found via both
 * joins is scanned once) before their `agent_session_messages.parts_json`
 * rows are scanned for `type === 'tool'` parts to collect the distinct tool
 * names.
 *
 * ── Why this closes the prior gap ────────────────────────────────────────
 *
 * Before #853, a tool used ONLY in an interactive (non-scheduled) session
 * was invisible to this resolver — `resolveExercisedTools` would report it
 * as "never exercised", so `scope_hygiene_generator`'s drift signal could
 * propose pruning it, and `org_proposal_measure`'s functional guard (which
 * only ever sees what this resolver reports) had nothing to veto the prune
 * with. The mcp_role join makes that usage visible without touching the
 * generator or the measure guard themselves — both already consume whatever
 * this resolver returns.
 *
 * Never throws — DB errors resolve to an empty set (fail toward "nothing
 * exercised", the same posture the original stub had).
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

    // #853: validate agentConfigId against a real agent_configs row before
    // trusting an mcp_role equality match — mcp_role is only a reliable
    // profile-id signal when the id it is being compared against is itself a
    // real profile (see module header: legacy `.mcp-roles/<slug>` values
    // stored in mcp_role must never be conflated with a genuine
    // agent_configs.id, and this guards the comparison from the other side).
    const configRow = db
      .prepare(`SELECT id FROM agent_configs WHERE id = ?`)
      .get(agentConfigId) as { id: string } | undefined;

    const sessionIdSet = new Set<string>();

    // Join 1 (#830) — scheduled-task attribution: agent_scheduled_tasks.agent_config_id
    // -> agent_sessions.scheduled_task_id.
    const taskRows = db
      .prepare(`SELECT id FROM agent_scheduled_tasks WHERE agent_config_id = ?`)
      .all(agentConfigId) as { id: string }[];
    if (taskRows.length > 0) {
      const taskIds = taskRows.map((r) => r.id);
      const taskPlaceholders = taskIds.map(() => '?').join(',');
      const scheduledSessionRows = db
        .prepare(
          `SELECT id FROM agent_sessions
            WHERE scheduled_task_id IN (${taskPlaceholders})
              AND created_at >= ?`,
        )
        .all(...taskIds, sinceIso) as { id: string }[];
      for (const row of scheduledSessionRows) sessionIdSet.add(row.id);
    }

    // Join 2 (#853) — interactive attribution: agent_sessions.mcp_role
    // matched DIRECTLY against agent_configs.id, only when agentConfigId is a
    // real profile row. This is what makes tool usage from ad hoc
    // interactive sessions (no scheduled_task_id) visible to the functional
    // guard, closing the prior "interactive-only usage looks unexercised" gap.
    if (configRow) {
      const mcpRoleSessionRows = db
        .prepare(
          `SELECT id FROM agent_sessions
            WHERE mcp_role = ?
              AND created_at >= ?`,
        )
        .all(agentConfigId, sinceIso) as { id: string }[];
      for (const row of mcpRoleSessionRows) sessionIdSet.add(row.id);
    }

    if (sessionIdSet.size === 0) return new Set<string>();

    const sessionIds = Array.from(sessionIdSet);
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
