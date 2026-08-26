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

interface OutputRowScanResult {
  defectCount: number;
  names: string[];
}

interface SessionOutputScanResult {
  outputRowCount: number;
  readableOutputRowCount: number;
  names: Set<string>;
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isValidProducerId(v: unknown, prefix: 'prt' | 'ses' | 'msg'): v is string {
  return typeof v === 'string' && v.startsWith(prefix) && v.length > prefix.length;
}

/** `time.start` (and, when `requireEnd`, `time.end >= time.start`) per the producer's ToolState time shape. */
function isValidTimeWindow(time: unknown, requireEnd: boolean): boolean {
  if (!isPlainRecord(time)) return false;
  if (!isNonNegativeInt(time.start)) return false;
  if (!requireEnd) return true;
  return isNonNegativeInt(time.end) && (time.end as number) >= (time.start as number);
}

type ToolPartEvaluation = { readable: false } | { readable: true; tool: string; successful: boolean };

function isValidRange(range: unknown): boolean {
  if (!isPlainRecord(range) || !isPlainRecord(range.start) || !isPlainRecord(range.end)) {
    return false;
  }
  return (
    isNonNegativeInt(range.start.line) &&
    isNonNegativeInt(range.start.character) &&
    isNonNegativeInt(range.end.line) &&
    isNonNegativeInt(range.end.character)
  );
}

function isValidFileSourceText(text: unknown): boolean {
  return (
    isPlainRecord(text) &&
    typeof text.value === 'string' &&
    isFiniteNumber(text.start) &&
    isFiniteNumber(text.end)
  );
}

function isValidFilePartSource(source: unknown): boolean {
  if (!isPlainRecord(source) || !isValidFileSourceText(source.text)) return false;
  switch (source.type) {
    case 'file':
      return typeof source.path === 'string';
    case 'symbol':
      return (
        typeof source.path === 'string' &&
        typeof source.name === 'string' &&
        isNonNegativeInt(source.kind) &&
        isValidRange(source.range)
      );
    case 'resource':
      return typeof source.clientName === 'string' && typeof source.uri === 'string';
    default:
      return false;
  }
}

function isValidFilePart(part: unknown): boolean {
  if (!isPlainRecord(part)) return false;
  if (!isValidProducerId(part.id, 'prt')) return false;
  if (!isValidProducerId(part.sessionID, 'ses')) return false;
  if (!isValidProducerId(part.messageID, 'msg')) return false;
  if (part.type !== 'file') return false;
  if (typeof part.mime !== 'string' || typeof part.url !== 'string') return false;
  if (part.filename !== undefined && typeof part.filename !== 'string') return false;
  return part.source === undefined || isValidFilePartSource(part.source);
}

function hasValidAttachments(attachments: unknown): boolean {
  return attachments === undefined || (Array.isArray(attachments) && attachments.every(isValidFilePart));
}

function hasValidMcpResult(mcpResult: unknown): boolean {
  if (mcpResult === undefined) return true;
  if (!isPlainRecord(mcpResult)) return false;
  if (mcpResult._meta !== undefined && !isPlainRecord(mcpResult._meta)) return false;
  return mcpResult.isError === undefined || typeof mcpResult.isError === 'boolean';
}

function hasValidMcpAppResource(resource: unknown): boolean {
  if (resource === undefined) return true;
  if (!isPlainRecord(resource)) return false;
  return [
    'sessionID',
    'callID',
    'serverName',
    'cwd',
    'resourceUri',
    'advertisedAt',
    'expiresAt',
  ].every((field) => typeof resource[field] === 'string');
}

/**
 * Validate a single `type:'tool'` part against the producer schema
 * (opencode_fork's session/message-v2.ts ToolPart/ToolState) closely enough
 * to fail closed — a shape the producer could never actually emit makes the
 * whole row unreadable rather than being silently ignored or (worse) counted
 * as a successful call. `state.input` is only ever type-checked, never read
 * or logged — it is untrusted tool-call payload, not telemetry.
 */
function evaluateToolPart(
  part: Record<string, unknown>,
  rowSdkMessageId: string | null,
): ToolPartEvaluation {
  const { id, sessionID, messageID, callID, tool, state } = part;
  if (
    !isValidProducerId(id, 'prt') ||
    !isValidProducerId(sessionID, 'ses') ||
    !isValidProducerId(messageID, 'msg') ||
    rowSdkMessageId === null ||
    messageID !== rowSdkMessageId ||
    !isNonEmptyString(callID) ||
    !isNonEmptyString(tool) ||
    (part.metadata !== undefined && !isPlainRecord(part.metadata))
  ) {
    return { readable: false };
  }
  if (!isPlainRecord(state) || !isPlainRecord(state.input)) {
    return { readable: false };
  }

  switch (state.status) {
    case 'pending':
      if (typeof state.raw !== 'string') return { readable: false };
      return { readable: true, tool, successful: false };

    case 'running':
      if (!isValidTimeWindow(state.time, false)) return { readable: false };
      if (state.title !== undefined && typeof state.title !== 'string') return { readable: false };
      if (state.metadata !== undefined && !isPlainRecord(state.metadata)) return { readable: false };
      return { readable: true, tool, successful: false };

    case 'error':
      if (typeof state.error !== 'string') return { readable: false };
      if (state.metadata !== undefined && !isPlainRecord(state.metadata)) return { readable: false };
      if (!isValidTimeWindow(state.time, true)) return { readable: false };
      return { readable: true, tool, successful: false };

    case 'completed': {
      if (typeof state.output !== 'string') return { readable: false };
      if (typeof state.title !== 'string') return { readable: false };
      if (!isPlainRecord(state.metadata)) return { readable: false };
      if (!isValidTimeWindow(state.time, true)) return { readable: false };
      if (isPlainRecord(state.time) && state.time.compacted !== undefined && !isNonNegativeInt(state.time.compacted)) {
        return { readable: false };
      }
      if (!hasValidMcpResult(state.mcpResult)) return { readable: false };
      if (!hasValidMcpAppResource(state.mcpAppResource)) return { readable: false };
      if (!hasValidAttachments(state.attachments)) return { readable: false };
      let isError = false;
      if (state.mcpResult !== undefined) {
        // Shape was validated above. Never inspect state.input beyond the
        // record guard; successful telemetry needs only terminal status.
        if (!isPlainRecord(state.mcpResult)) return { readable: false };
        isError = state.mcpResult.isError === true;
      }
      return { readable: true, tool, successful: !isError };
    }

    default:
      return { readable: false };
  }
}

function scanOutputRow(partsJson: string | null, sdkMessageId: string | null): OutputRowScanResult {
  if (partsJson === null) return { defectCount: 1, names: [] };
  try {
    const parts = JSON.parse(partsJson) as unknown;
    if (!Array.isArray(parts)) return { defectCount: 1, names: [] };
    const names: string[] = [];
    let defectCount = 0;
    for (const part of parts) {
      if (!isPlainRecord(part) || typeof part.type !== 'string') {
        defectCount += 1;
        continue;
      }
      // A well-shaped non-tool part proves the structured container is
      // readable but contributes no tool evidence.
      if (part.type !== 'tool') continue;
      const outcome = evaluateToolPart(part, sdkMessageId);
      if (!outcome.readable) {
        defectCount += 1;
        continue;
      }
      if (outcome.successful) names.push(outcome.tool);
    }
    return { defectCount, names };
  } catch {
    return { defectCount: 1, names: [] };
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
  /**
   * The live MCP server catalog captured at resolution time — the SAME
   * catalog `canonicalServerIds` was resolved against. Lets a downstream
   * caller (org_proposal_measure's functional guard) canonicalize a raw
   * scope-removal name — which may be in an alias form (`nfl-mcp` vs the
   * live `nfl_mcp`) — against the identical live identity space before
   * comparing it to `canonicalServerIds`, instead of comparing raw strings.
   */
  knownServerIds: Set<string>;
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
  const knownServerIds = new Set(catalog);
  const canonicalServerIds = new Set<string>();
  if (catalog.length > 0) {
    for (const callableName of rawCallableNames) {
      const serverId = resolveMcpServerIdentity(callableName, catalog);
      if (serverId) canonicalServerIds.add(serverId);
    }
  }
  const has = (name: string) => rawCallableNames.has(name) || canonicalServerIds.has(name);
  return unavailableReason
    ? { availability: 'unavailable', reason: unavailableReason, rawCallableNames, canonicalServerIds, knownServerIds, has }
    : { availability: 'available', rawCallableNames, canonicalServerIds, knownServerIds, has };
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
  attributedSessionIds?: Iterable<string>,
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

    // #1482: the audit passes the exact session population it used for the
    // activity floor, so usage evidence cannot silently judge a smaller set.
    if (attributedSessionIds) {
      for (const sessionId of attributedSessionIds) sessionIdSet.add(sessionId);
    }

    // Join 1 (#830) — scheduled-task attribution: agent_scheduled_tasks.agent_config_id
    // -> agent_sessions.scheduled_task_id.
    const taskRows = attributedSessionIds ? [] : db
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
    //
    // W2: `scheduled_task_id IS NULL` is REQUIRED here — scheduled ownership
    // (Join 1) is the strongest signal and always wins. A session actually
    // triggered by a scheduled task belongs ONLY to that task's owner, even if
    // its `mcp_role` column (stale, or a legacy write path) happens to name a
    // different profile; without this bound that conflicting session would be
    // double-attributed to the wrong profile via this join alone.
    if (configRow && !attributedSessionIds) {
      const mcpRoleSessionRows = db
        .prepare(
          `SELECT id FROM agent_sessions
            WHERE mcp_role = ?
              AND scheduled_task_id IS NULL
              AND created_at >= ?`,
        )
        .all(agentConfigId, sinceIso) as { id: string }[];
      for (const row of mcpRoleSessionRows) sessionIdSet.add(row.id);

      // #1482 legacy/delegated attribution: mirror the audit floor's final
      // fallback. A valid scheduled owner or valid mcp_role remains stronger;
      // agent_kind is used only when neither exists.
      const agentKindSessionRows = db
        .prepare(
          `SELECT s.id FROM agent_sessions s
            WHERE s.agent_kind = ?
              AND s.scheduled_task_id IS NULL
              AND (s.mcp_role IS NULL OR NOT EXISTS (
                SELECT 1 FROM agent_configs owner WHERE owner.id = s.mcp_role
              ))
              AND s.created_at >= ?`,
        )
        .all(agentConfigId, sinceIso) as { id: string }[];
      for (const row of agentKindSessionRows) sessionIdSet.add(row.id);
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
        `SELECT session_id, sdk_message_id, parts_json FROM agent_session_messages
          WHERE session_id IN (${sessionPlaceholders})
            AND role = 'output'`,
      )
      .all(...sessionIds) as {
      session_id: string;
      sdk_message_id: string | null;
      parts_json: string | null;
    }[];

    const scansBySession = new Map<string, SessionOutputScanResult>(
      sessionIds.map((sessionId) => [
        sessionId,
        { outputRowCount: 0, readableOutputRowCount: 0, names: new Set<string>() },
      ]),
    );
    for (const row of messageRows) {
      const sessionScan = scansBySession.get(row.session_id);
      if (!sessionScan) continue;
      sessionScan.outputRowCount += 1;
      const rowScan = scanOutputRow(row.parts_json, row.sdk_message_id);
      if (rowScan.defectCount === 0) sessionScan.readableOutputRowCount += 1;
      for (const name of rowScan.names) {
        sessionScan.names.add(name);
      }
    }

    const sessionScans = [...scansBySession.values()];
    const exercised = new Set(sessionScans.flatMap((scan) => [...scan.names]));
    if (sessionScans.some((scan) => scan.readableOutputRowCount < scan.outputRowCount)) {
      return telemetryResult(exercised, catalog, 'unreadable-source');
    }

    if (sessionScans.every((scan) => scan.outputRowCount === 0)) {
      return telemetryResult(exercised, catalog, 'no-structured-telemetry');
    }

    if (sessionScans.some((scan) => scan.outputRowCount === 0)) {
      return telemetryResult(exercised, catalog, 'partial-structured-telemetry');
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
