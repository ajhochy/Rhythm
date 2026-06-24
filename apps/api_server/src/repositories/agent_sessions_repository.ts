import { getDb } from '../database/db';
import type {
  AgentSession,
  AgentSessionStatus,
  CreateAgentSessionDto,
  PermissionMode,
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
  };
}

export class AgentSessionsRepository {
  insert(dto: CreateAgentSessionDto): AgentSession {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO agent_sessions
           (id, task_id, task_title, agent_kind, status, cwd, name, project_id,
            mcp_role, mcp_allowed_tools_json, scheduled_task_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'starting', ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    const sql = projectId === null
      ? `SELECT * FROM agent_sessions WHERE project_id IS NULL${archiveClause} ORDER BY created_at DESC LIMIT ?`
      : `SELECT * FROM agent_sessions WHERE project_id = ?${archiveClause} ORDER BY created_at DESC LIMIT ?`;
    const rows = projectId === null
      ? (getDb().prepare(sql).all(limit) as AgentSessionRow[])
      : (getDb().prepare(sql).all(projectId, limit) as AgentSessionRow[]);
    return rows.map(rowToModel);
  }

  findById(id: string): AgentSession | null {
    const row = getDb()
      .prepare(`SELECT * FROM agent_sessions WHERE id = ?`)
      .get(id) as AgentSessionRow | undefined;
    return row ? rowToModel(row) : null;
  }

  listAll(
    limit = 100,
    opts: { includeArchived?: boolean; archivedOnly?: boolean } = {},
  ): AgentSession[] {
    const archiveClause = opts.archivedOnly
      ? ' WHERE archived_at IS NOT NULL'
      : opts.includeArchived
        ? ''
        : ' WHERE archived_at IS NULL';
    const rows = getDb()
      .prepare(`SELECT * FROM agent_sessions${archiveClause} ORDER BY created_at DESC LIMIT ?`)
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
    const now = new Date().toISOString();
    const result = getDb()
      .prepare(
        `UPDATE agent_sessions
         SET status = 'error', status_message = ?, updated_at = ?
         WHERE status = 'running'`,
      )
      .run(message, now);
    return result.changes;
  }
}
