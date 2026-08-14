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
 * Never throws. Unsupported storage, unreadable rows, and DB/catalog errors
 * are reported as unavailable so callers cannot confuse missing telemetry
 * with a genuine zero-use observation.
 */

import { getDb } from '../database/db';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { resolveMcpServerIdentity } from './mcp_scope_name';

/** Default trailing window for "recently exercised" — 30 days. */
const DEFAULT_TRAILING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

interface ToolPart {
  type?: string;
  tool?: string;
  name?: string;
}

type PartsReadResult =
  | { readable: true; names: string[] }
  | { readable: false };

function extractToolNamesFromPartsJson(partsJson: string | null): PartsReadResult {
  if (!partsJson) return { readable: false };
  try {
    const parts = JSON.parse(partsJson) as unknown;
    if (!Array.isArray(parts)) return { readable: false };
    const names: string[] = [];
    for (const part of parts) {
      if (part && typeof part === 'object' && (part as ToolPart).type === 'tool') {
        const toolPart = part as ToolPart;
        const name = toolPart.tool ?? toolPart.name;
        if (typeof name !== 'string' || !name.trim()) return { readable: false };
        names.push(name);
      }
    }
    return { readable: true, names };
  } catch {
    return { readable: false };
  }
}

export type ExercisedTelemetryUnavailableReason =
  | 'postgres-unsupported'
  | 'invalid-profile'
  | 'database-error'
  | 'unreadable-source'
  | 'catalog-unavailable'
  | 'no-structured-telemetry'
  | 'no-attributable-sessions'
  | 'partial-structured-telemetry';

interface ExercisedToolsTelemetryBase {
  rawCallableNames: Set<string>;
  canonicalServerIds: Set<string>;
  /** Compatibility accessor for legacy callers; safety decisions use the discriminant. */
  has(name: string): boolean;
}

export type ExercisedToolsTelemetry =
  | (ExercisedToolsTelemetryBase & { availability: 'available' })
  | (ExercisedToolsTelemetryBase & {
      availability: 'unavailable';
      reason: ExercisedTelemetryUnavailableReason;
    });

function telemetryResult(
  rawCallableNames: Set<string>,
  knownServerNames: Iterable<string> | undefined,
  unavailableReason?: ExercisedTelemetryUnavailableReason,
): ExercisedToolsTelemetry {
  const catalog = knownServerNames ? [...knownServerNames] : [];
  const canonicalServerIds = new Set<string>();
  if (catalog.length > 0) {
    for (const callableName of rawCallableNames) {
      const serverId = resolveMcpServerIdentity(callableName, catalog);
      if (serverId) canonicalServerIds.add(serverId);
    }
  }
  const has = (name: string) => rawCallableNames.has(name) || canonicalServerIds.has(name);
  return unavailableReason
    ? { availability: 'unavailable', reason: unavailableReason, rawCallableNames, canonicalServerIds, has }
    : { availability: 'available', rawCallableNames, canonicalServerIds, has };
}

/**
 * Resolve the set of tool names ACTUALLY exercised by sessions run under
 * `agentConfigId` within `sinceIso` (defaults to the trailing 30 days). See
 * the module header for the exact signal + its documented approximation.
 *
 * Unavailable under Postgres — this reads local-SQLite-only
 * agent-execution tables (agent_scheduled_tasks / agent_sessions /
 * agent_session_messages), consistent with the rest of the org-optimizer
 * subsystem.
 */
export async function resolveExercisedTools(
  agentConfigId: string,
  sinceIso: string = new Date(Date.now() - DEFAULT_TRAILING_WINDOW_MS).toISOString(),
  knownServerNames?: Iterable<string>,
): Promise<ExercisedToolsTelemetry> {
  const catalog = knownServerNames ? [...knownServerNames] : [];
  const empty = new Set<string>();
  if (env.dbClient === 'postgres') {
    return telemetryResult(empty, catalog, 'postgres-unsupported');
  }
  if (!agentConfigId) return telemetryResult(empty, catalog, 'invalid-profile');

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

    // No session could be attributed to this profile at all — the
    // observation window is empty, not zero-use. Reporting "available,
    // nothing exercised" here would let a prune guard pass on a profile this
    // resolver never actually observed (W2 fail-closed contract).
    if (sessionIdSet.size === 0) {
      return telemetryResult(
        empty,
        catalog,
        catalog.length > 0 ? 'no-attributable-sessions' : 'catalog-unavailable',
      );
    }

    const sessionIds = Array.from(sessionIdSet);
    const sessionPlaceholders = sessionIds.map(() => '?').join(',');

    const messageRows = db
      .prepare(
        `SELECT session_id, parts_json FROM agent_session_messages
          WHERE session_id IN (${sessionPlaceholders})
            AND parts_json IS NOT NULL`,
      )
      .all(...sessionIds) as { session_id: string; parts_json: string | null }[];

    // Track which attributed sessions actually contributed a readable
    // structured row (a Set keyed by session_id — O(rows) to build, O(1) per
    // membership check, no per-session re-scan of the row list).
    const coveredSessionIds = new Set<string>();
    const exercised = new Set<string>();
    for (const row of messageRows) {
      const parsed = extractToolNamesFromPartsJson(row.parts_json);
      if (!parsed.readable) {
        return telemetryResult(exercised, catalog, 'unreadable-source');
      }
      coveredSessionIds.add(row.session_id);
      for (const name of parsed.names) {
        exercised.add(name);
      }
    }

    // Attributed sessions exist, but none of them contributed a readable
    // structured row — structured telemetry never covered this profile's
    // traffic at all. That is missing capture, not proof the profile used
    // nothing (see module header + the W2 fail-closed contract).
    if (coveredSessionIds.size === 0) {
      return telemetryResult(new Set<string>(), catalog, 'no-structured-telemetry');
    }

    // Some, but not all, attributed sessions have readable coverage — the
    // observation window is partial. A profile with an uncovered session
    // could have exercised a tool only in the gap, so partial telemetry can
    // never authorize a prune/keep decision the way full coverage can.
    if (coveredSessionIds.size < sessionIdSet.size) {
      return telemetryResult(new Set<string>(), catalog, 'partial-structured-telemetry');
    }

    return telemetryResult(
      exercised,
      catalog,
      catalog.length > 0 ? undefined : 'catalog-unavailable',
    );
  } catch (err) {
    logger.warn(`[org-exercised-tools-resolver] FAILED (non-fatal, telemetry unavailable): ${String(err)}`);
    return telemetryResult(empty, catalog, 'database-error');
  }
}
