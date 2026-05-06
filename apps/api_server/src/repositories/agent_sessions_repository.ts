import { getDb } from '../database/db';
import type {
  AgentSession,
  AgentSessionStatus,
  CreateAgentSessionDto,
} from '../models/agent_session';

interface AgentSessionRow {
  id: string;
  task_id: string | null;
  task_title: string | null;
  agent_kind: string;
  status: string;
  session_token: string | null;
  cwd: string;
  name: string;
  last_preview: string | null;
  last_activity_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToModel(row: AgentSessionRow): AgentSession {
  return {
    id: row.id,
    taskId: row.task_id,
    taskTitle: row.task_title ?? null,
    agentKind: row.agent_kind as AgentSession['agentKind'],
    status: row.status as AgentSessionStatus,
    sessionToken: row.session_token,
    cwd: row.cwd,
    name: row.name,
    lastPreview: row.last_preview,
    lastActivityAt: row.last_activity_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class AgentSessionsRepository {
  insert(dto: CreateAgentSessionDto): AgentSession {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO agent_sessions (id, task_id, task_title, agent_kind, status, cwd, name, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'starting', ?, ?, ?, ?)`,
      )
      .run(id, dto.taskId ?? null, dto.taskTitle ?? null, dto.agentKind, dto.cwd, dto.name, now, now);
    return this.findById(id)!;
  }

  findById(id: string): AgentSession | null {
    const row = getDb()
      .prepare(`SELECT * FROM agent_sessions WHERE id = ?`)
      .get(id) as AgentSessionRow | undefined;
    return row ? rowToModel(row) : null;
  }

  listAll(limit = 100): AgentSession[] {
    const rows = getDb()
      .prepare(`SELECT * FROM agent_sessions ORDER BY created_at DESC LIMIT ?`)
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

  deleteOlderThan(cutoffIso: string): number {
    const result = getDb()
      .prepare(`DELETE FROM agent_sessions WHERE status = 'closed' AND created_at < ?`)
      .run(cutoffIso);
    return result.changes;
  }
}
