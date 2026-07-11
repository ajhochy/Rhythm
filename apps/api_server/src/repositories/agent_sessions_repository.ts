import { getDb } from '../database/db';
import type {
  AgentSession,
  AgentSessionStatus,
  CreateAgentSessionDto,
  PermissionMode,
  SessionScope,
} from '../models/agent_session';

interface AgentSessionRow {
  id: string;
  task_id: string | null;
  task_title: string | null;
  agent_kind: string;
  status: string;
  status_message: string | null;
  session_token: string | null;
  /** OPC-M1-5: Opencode SDK session id for resume re-attachment. */
  sdk_session_id: string | null;
  cwd: string;
  name: string;
  project_id: string | null;
  provider_id: string | null;
  model_id: string | null;
  agent_mode: string | null;
  permission_mode: string | null;
  thinking_budget: number | null;
  fast_mode: number;
  last_preview: string | null;
  last_activity_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  /** C1 — MCP role slug (e.g. "church-admin"). Null when no role was requested. */
  mcp_role: string | null;
  /** C1 — JSON Record<serverName, string[]> of resolved per-server allowedTools. */
  mcp_allowed_tools_json: string | null;
  /** Agent-loop tracking: FK to agent_scheduled_tasks.id. Null for interactive sessions. */
  scheduled_task_id: string | null;
  /** #743 — Local id of the parent agent_sessions row (for delegated subagent sessions). */
  parent_session_id: string | null;
  /** #747 — 1 when this is a background/system session (curator, scheduler, memory). */
  is_system: number;
  /** Task D — Anthropic account id this session is routed to. Null = engine default. */
  anthropic_account_id: string | null;
  owner_user_id: number | null;
  delegation_depth: number | null;
  /** USO B1 (#1028) — session classification. Legacy rows coalesce to a derived value. */
  category: string | null;
}

function rowToModel(row: AgentSessionRow): AgentSession {
  return {
    id: row.id,
    taskId: row.task_id,
    taskTitle: row.task_title ?? null,
    agentKind: row.agent_kind as AgentSession['agentKind'],
    status: row.status as AgentSessionStatus,
    statusMessage: row.status_message ?? null,
    sessionToken: row.session_token,
    sdkSessionId: row.sdk_session_id ?? null,
    cwd: row.cwd,
    name: row.name,
    projectId: row.project_id ?? null,
    providerId: row.provider_id ?? null,
    modelId: row.model_id ?? null,
    agentMode: row.agent_mode ?? null,
    permissionMode: (row.permission_mode ?? 'default') as PermissionMode,
    thinkingBudget: row.thinking_budget ?? null,
    fastMode: row.fast_mode === 1,
    lastPreview: row.last_preview,
    lastActivityAt: row.last_activity_at,
    archivedAt: row.archived_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    mcpRole: row.mcp_role ?? null,
    mcpAllowedToolsJson: row.mcp_allowed_tools_json ?? null,
    scheduledTaskId: row.scheduled_task_id ?? null,
    parentSessionId: row.parent_session_id ?? null,
    isSystem: row.is_system === 1,
    anthropicAccountId: row.anthropic_account_id ?? null,
    ownerUserId: row.owner_user_id ?? null,
    delegationDepth: row.delegation_depth ?? 0,
    // USO B1 (#1028): read-time coalesce for any row the migration backfill
    // missed (defensive — the migration sets a NOT NULL default + backfill).
    category: (row.category as AgentSession['category']) ??
      (row.scheduled_task_id ? 'scheduled' : 'chat'),
  };
}

export class AgentSessionsRepository {
  insert(dto: CreateAgentSessionDto): AgentSession {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    // USO B1 (#1028): stamp category at creation. Explicit category wins
    // (e.g. 'self_improvement' from a curator run); otherwise derive
    // 'scheduled' when a scheduled task drives the run, else 'chat'.
    const category = dto.category ?? (dto.scheduledTaskId ? 'scheduled' : 'chat');
    getDb()
      .prepare(
        `INSERT INTO agent_sessions
           (id, task_id, task_title, agent_kind, status, cwd, name, project_id,
            mcp_role, mcp_allowed_tools_json, scheduled_task_id, is_system,
            anthropic_account_id, owner_user_id, delegation_depth, category, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'starting', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        dto.taskId ?? null,
        dto.taskTitle ?? null,
        dto.agentKind,
        dto.cwd,
        dto.name,
        dto.projectId ?? null,
        dto.mcpRole ?? null,
        dto.mcpAllowedToolsJson ?? null,
        dto.scheduledTaskId ?? null,
        dto.isSystem ? 1 : 0,
        dto.anthropicAccountId ?? null,
        dto.ownerUserId ?? null,
        dto.delegationDepth ?? 0,
        category,
        now,
        now,
      );
    return this.findById(id)!;
  }

  listByProject(
    projectId: string | null,
    limit = 100,
    opts: { includeArchived?: boolean; archivedOnly?: boolean } = {},
  ): AgentSession[] {
    const archiveClause = opts.archivedOnly
      ? ' AND archived_at IS NOT NULL'
      : opts.includeArchived
        ? ''
        : ' AND archived_at IS NULL';
    // #747: exclude background/system sessions from the normal session list.
    const sql = projectId === null
      ? `SELECT * FROM agent_sessions WHERE project_id IS NULL AND is_system = 0${archiveClause} ORDER BY created_at DESC LIMIT ?`
      : `SELECT * FROM agent_sessions WHERE project_id = ? AND is_system = 0${archiveClause} ORDER BY created_at DESC LIMIT ?`;
    const rows = projectId === null
      ? (getDb().prepare(sql).all(limit) as AgentSessionRow[])
      : (getDb().prepare(sql).all(projectId, limit) as AgentSessionRow[]);
    return rows.map(rowToModel);
  }

  /**
   * #904 — every run of a scheduled task, most recent first. Scheduled runs
   * are recorded with is_system=1 (hidden from the normal chat list) so this
   * intentionally does NOT apply the is_system=0 filter listAll/listByProject
   * use — this is the one place background-loop runs are meant to surface.
   */
  listByScheduledTaskId(scheduledTaskId: string, limit = 20): AgentSession[] {
    const rows = getDb()
      .prepare(
        `SELECT * FROM agent_sessions WHERE scheduled_task_id = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(scheduledTaskId, limit) as AgentSessionRow[];
    return rows.map(rowToModel);
  }

  findById(id: string): AgentSession | null {
    const row = getDb()
      .prepare(`SELECT * FROM agent_sessions WHERE id = ?`)
      .get(id) as AgentSessionRow | undefined;
    return row ? rowToModel(row) : null;
  }

  /**
   * #751 — Resolve a local session by its Opencode SDK session id.
   *
   * `sdk_session_id` is the durable counterpart to the ephemeral in-memory
   * `opencodeSessionMap`: it is persisted at session-create / resume time and
   * survives api_server restarts. The stream bridge uses this as a fallback so
   * engine events are never orphaned when the in-memory map misses (a wiped or
   * unpopulated map would otherwise drop status/parts/child events, leaving the
   * session stuck on the 'starting' badge).
   */
  findBySdkSessionId(sdkSessionId: string): AgentSession | null {
    if (!sdkSessionId) return null;
    const row = getDb()
      .prepare(`SELECT * FROM agent_sessions WHERE sdk_session_id = ? LIMIT 1`)
      .get(sdkSessionId) as AgentSessionRow | undefined;
    return row ? rowToModel(row) : null;
  }

  listAll(
    limit = 100,
    opts: { includeArchived?: boolean; archivedOnly?: boolean; scope?: SessionScope } = {},
  ): AgentSession[] {
    // USO B1 (#1028): the `scope` selects which slice of sessions to return,
    // filtered on the persisted `category` column (upgraded from A1's
    // is_system/scheduled_task_id placeholder).
    //   - 'chats' (default) → category = 'chat' AND is_system = 0. The is_system
    //     guard is retained so a stray is_system=1 row can never leak into the
    //     default Chats view even if its category were 'chat'.
    //   - 'scheduled' → category = 'scheduled'.
    //   - 'self_improvement' → category = 'self_improvement'.
    const scope = opts.scope ?? 'chats';
    const scopeClause =
      scope === 'scheduled'
        ? "category = 'scheduled'"
        : scope === 'self_improvement'
          ? "category = 'self_improvement'"
          : "category = 'chat' AND is_system = 0";
    const archiveClause = opts.archivedOnly
      ? ' AND archived_at IS NOT NULL'
      : opts.includeArchived
        ? ''
        : ' AND archived_at IS NULL';
    const rows = getDb()
      .prepare(`SELECT * FROM agent_sessions WHERE ${scopeClause}${archiveClause} ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as AgentSessionRow[];
    return rows.map(rowToModel);
  }

  listActive(): AgentSession[] {
    const rows = getDb()
      .prepare(
        `SELECT * FROM agent_sessions WHERE status IN ('starting','working','idle') ORDER BY created_at DESC`,
      )
      .all() as AgentSessionRow[];
    return rows.map(rowToModel);
  }

  listResumable(): AgentSession[] {
    const rows = getDb()
      .prepare(
        `SELECT * FROM agent_sessions WHERE status = 'resumable' AND session_token IS NOT NULL ORDER BY created_at DESC`,
      )
      .all() as AgentSessionRow[];
    return rows.map(rowToModel);
  }

  findByTaskId(taskId: string): AgentSession[] {
    const rows = getDb()
      .prepare(
        `SELECT * FROM agent_sessions WHERE task_id = ? ORDER BY created_at DESC`,
      )
      .all(taskId) as AgentSessionRow[];
    return rows.map(rowToModel);
  }

  updateStatus(id: string, status: AgentSessionStatus): void {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE agent_sessions SET status = ?, updated_at = ? WHERE id = ?`,
      )
      .run(status, now, id);
  }

  updateToken(id: string, token: string): void {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE agent_sessions SET session_token = ?, updated_at = ? WHERE id = ?`,
      )
      .run(token, now, id);
  }

  /**
   * OPC-M1-5 — Store the Opencode SDK session id for resume re-attachment.
   * Called at session create time so resume() can look up the SDK session
   * without calling createSession() again.
   */
  setSdkSessionId(id: string, sdkSessionId: string): void {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE agent_sessions SET sdk_session_id = ?, updated_at = ? WHERE id = ?`,
      )
      .run(sdkSessionId, now, id);
  }

  /**
   * Task D — Update the Anthropic account a session is routed to. Called by
   * the spillover intake when the engine plugin fails over in place.
   */
  setAnthropicAccountId(id: string, accountId: string | null): void {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE agent_sessions SET anthropic_account_id = ?, updated_at = ? WHERE id = ?`,
      )
      .run(accountId, now, id);
  }

  /**
   * #765 — Persist the resolved MCP scope (role slug + per-server allowed-tools
   * map JSON) onto the session row. Used by the interactive (ws_gateway) path,
   * where the session is created agent-less and the actual profile (e.g.
   * "secretary") is chosen per-turn in the composer; the scope must be recorded
   * on the row so it is auditable and survives a later resume.
   *
   * Both args may be null to clear the scope (unrestricted profile / no profile).
   */
  setMcpScope(id: string, mcpRole: string | null, mcpAllowedToolsJson: string | null): void {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE agent_sessions SET mcp_role = ?, mcp_allowed_tools_json = ?, updated_at = ? WHERE id = ?`,
      )
      .run(mcpRole, mcpAllowedToolsJson, now, id);
  }

  updatePreview(id: string, preview: string, lastActivityAt: string): void {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE agent_sessions SET last_preview = ?, last_activity_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(preview, lastActivityAt, now, id);
  }

  markClosed(id: string): void {
    this.updateStatus(id, 'closed');
  }

  /**
   * Persist the actual provider/model a session ran with — but ONLY when the
   * row has none yet. Sessions created without an explicit model pick (e.g.
   * instant "+ New") leave provider_id/model_id empty; opencode still runs a
   * default model (the bridged account), and the assistant message reports it.
   * Backfilling lets the context panel + the model-derived session icon show
   * the real model. Never overrides an explicit user selection.
   * Returns the updated row when a write happened, else null.
   */
  backfillModel(id: string, providerId: string, modelId: string): AgentSession | null {
    if (!providerId || !modelId) return null;
    const now = new Date().toISOString();
    const result = getDb()
      .prepare(
        `UPDATE agent_sessions
           SET provider_id = ?, model_id = ?, updated_at = ?
         WHERE id = ? AND (provider_id IS NULL OR provider_id = '')`,
      )
      .run(providerId, modelId, now, id);
    return result.changes > 0 ? this.findById(id) : null;
  }

  /**
   * OPC-M1-4 — Persist error state on the session row.
   * Replaces the in-memory setTimeout sentinel: error is now durable and
   * survives bridge restarts. Clearing happens only on an explicit user action.
   */
  setErrorStatus(id: string, message: string): void {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE agent_sessions SET status = 'error', status_message = ?, updated_at = ? WHERE id = ?`,
      )
      .run(message, now, id);
  }

  /**
   * OPC-M1-4 — Clear error state on explicit user action (new prompt / resume).
   * Transitions status to 'working' and nulls out status_message.
   * No-op if the session is not in status='error'.
   */
  clearErrorStatus(id: string): void {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE agent_sessions SET status = 'working', status_message = NULL, updated_at = ? WHERE id = ? AND status = 'error'`,
      )
      .run(now, id);
  }

  /** Hard-delete a single session row. Foreign-key cascade removes messages. */
  deleteById(id: string): number {
    const result = getDb()
      .prepare(`DELETE FROM agent_sessions WHERE id = ?`)
      .run(id);
    return result.changes;
  }

  /** #602 — update agent_kind for agent-less sessions on first model pick. */
  updateAgentKind(id: string, agentKind: string): void {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE agent_sessions SET agent_kind = ?, updated_at = ? WHERE id = ?`,
      )
      .run(agentKind, now, id);
  }

  updatePermissionMode(id: string, mode: PermissionMode): void {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE agent_sessions SET permission_mode = ?, updated_at = ? WHERE id = ?`,
      )
      .run(mode, now, id);
  }

  updateFields(
    id: string,
    fields: {
      name?: string;
      providerId?: string | null;
      modelId?: string | null;
      agentMode?: string | null;
      permissionMode?: PermissionMode;
      thinkingBudget?: number | null;
      fastMode?: boolean;
    },
  ): void {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (fields.name !== undefined) {
      sets.push('name = ?');
      values.push(fields.name);
    }
    if (fields.providerId !== undefined) {
      sets.push('provider_id = ?');
      values.push(fields.providerId);
    }
    if (fields.modelId !== undefined) {
      sets.push('model_id = ?');
      values.push(fields.modelId);
    }
    if (fields.agentMode !== undefined) {
      sets.push('agent_mode = ?');
      values.push(fields.agentMode);
    }
    if (fields.permissionMode !== undefined) {
      sets.push('permission_mode = ?');
      values.push(fields.permissionMode);
    }
    if (fields.thinkingBudget !== undefined) {
      sets.push('thinking_budget = ?');
      values.push(fields.thinkingBudget);
    }
    if (fields.fastMode !== undefined) {
      sets.push('fast_mode = ?');
      values.push(fields.fastMode ? 1 : 0);
    }
    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);
    getDb()
      .prepare(`UPDATE agent_sessions SET ${sets.join(', ')} WHERE id = ?`)
      .run(...values);
  }

  /** Set or clear archived_at. Returns the updated row or null if not found. */
  setArchived(id: string, archived: boolean): AgentSession | null {
    const now = new Date().toISOString();
    const archivedAt = archived ? now : null;
    getDb()
      .prepare(
        `UPDATE agent_sessions SET archived_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(archivedAt, now, id);
    return this.findById(id);
  }

  /**
   * #743 — Upsert a local row for a delegated child (subagent) session.
   *
   * Called by the stream bridge when a `session.created` event arrives with
   * a non-null parentID in `properties.info`. The parent is identified by its
   * SDK session id; we look up the local parent row and store its local id as
   * `parent_session_id` on the child row.
   *
   * The upsert key is the child's SDK session id (`sdk_session_id`). If a row
   * already exists for that SDK id, it is a no-op (idempotent). Returns the
   * (possibly existing) local row, or null when the parent cannot be resolved.
   */
  upsertChildSession(
    childSdkSessionId: string,
    parentSdkSessionId: string,
    title: string,
    cwd: string,
  ): AgentSession | null {
    // Look up the local parent row by its SDK session id.
    const parentRow = getDb()
      .prepare(
        `SELECT id, agent_kind FROM agent_sessions WHERE sdk_session_id = ? LIMIT 1`,
      )
      .get(parentSdkSessionId) as { id: string; agent_kind: string } | undefined;
    if (!parentRow) return null;
    const parentLocalId = parentRow.id;
    // #867 smoke fix: the engine's task tool composes the child title as
    // "<description> (@<agentName> subagent)" (fork tool/task.ts) and there
    // is no dedicated agent field on Session.Info — the title is the only
    // carrier of the child's REAL specialist identity. Parse it out;
    // otherwise every delegated child was persisted under the parent's
    // (usually 'claude-code') kind, so the UI showed the wrong agent and a
    // reply was sent under the default binding.
    const specialistMatch = /\(@([^)\s]+) subagent\)\s*$/.exec(title ?? '');
    const inheritedAgentKind =
      specialistMatch?.[1] ?? parentRow.agent_kind ?? 'claude-code';

    // Check whether the child row already exists (idempotent).
    const existingRow = getDb()
      .prepare(
        `SELECT id FROM agent_sessions WHERE sdk_session_id = ? LIMIT 1`,
      )
      .get(childSdkSessionId) as { id: string } | undefined;
    if (existingRow) {
      return this.findById(existingRow.id);
    }

    // Insert a new row for the child session.
    const childLocalId = crypto.randomUUID();
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO agent_sessions
           (id, task_id, task_title, agent_kind, status, cwd, name, project_id,
            sdk_session_id, parent_session_id, created_at, updated_at)
         VALUES (?, NULL, NULL, ?, 'starting', ?, ?, NULL, ?, ?, ?, ?)`,
      )
      .run(
        childLocalId,
        inheritedAgentKind,
        cwd,
        title || 'Subagent task',
        childSdkSessionId,
        parentLocalId,
        now,
        now,
      );
    return this.findById(childLocalId);
  }

  deleteOlderThan(cutoffIso: string): number {
    const result = getDb()
      .prepare(`DELETE FROM agent_sessions WHERE status = 'closed' AND created_at < ?`)
      .run(cutoffIso);
    return result.changes;
  }

  /**
   * #738-fix — Return the most-recently-used {providerID, modelID} pair from
   * any agent session that has both columns populated.
   *
   * Source: agent_sessions.provider_id + model_id, ordered by created_at DESC.
   * Used by AgentRunner.resolveRunModel() when the agent config has no preferred
   * model set and no hardcoded default has been provided by the caller.
   */
  findMostRecentlyUsedModel(): { providerID: string; modelID: string } | null {
    const row = getDb()
      .prepare(
        `SELECT provider_id, model_id FROM agent_sessions
         WHERE provider_id IS NOT NULL AND model_id IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get() as { provider_id: string; model_id: string } | undefined;
    if (!row) return null;
    return { providerID: row.provider_id, modelID: row.model_id };
  }

  /**
   * #738-fix — Reset orphaned 'running' sessions to 'error' on server restart.
   * Sessions left in status='running' from a previous crash would stay stuck
   * forever. Called by the scheduler on boot.
   */
  resetStaleRunning(message = 'Server restarted — run interrupted'): number {
    // #738-fix / #1002 — Reset orphaned in-flight sessions to 'error' on boot.
    // A headless run that dies BEFORE it enters 'running' stays stuck at
    // 'starting' forever (resetStaleRunning historically only freed 'running').
    // This runs boot-only (startAgentSchedulerJob), when nothing is genuinely
    // in-flight, so both 'running' and 'starting' orphans are safe to recover.
    const now = new Date().toISOString();
    const result = getDb()
      .prepare(
        `UPDATE agent_sessions
         SET status = 'error', status_message = ?, updated_at = ?
         WHERE status IN ('running', 'starting')`,
      )
      .run(message, now);
    return result.changes;
  }
}
