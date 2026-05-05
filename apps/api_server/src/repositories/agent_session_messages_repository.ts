import { getDb } from '../database/db';
import type { AgentSessionMessage } from '../models/agent_session';

interface AgentSessionMessageRow {
  id: number;
  session_id: string;
  role: string;
  raw_text: string;
  stripped_text: string;
  created_at: string;
}

function rowToModel(row: AgentSessionMessageRow): AgentSessionMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role as AgentSessionMessage['role'],
    rawText: row.raw_text,
    strippedText: row.stripped_text,
    createdAt: row.created_at,
  };
}

export class AgentSessionMessagesRepository {
  append(
    sessionId: string,
    role: 'output' | 'input' | 'system',
    rawText: string,
    strippedText: string,
  ): AgentSessionMessage {
    const result = getDb()
      .prepare(
        `INSERT INTO agent_session_messages (session_id, role, raw_text, stripped_text)
         VALUES (?, ?, ?, ?)`,
      )
      .run(sessionId, role, rawText, strippedText);
    const row = getDb()
      .prepare(`SELECT * FROM agent_session_messages WHERE id = ?`)
      .get(result.lastInsertRowid) as AgentSessionMessageRow;
    return rowToModel(row);
  }

  listBySession(sessionId: string, limit = 200): AgentSessionMessage[] {
    const rows = getDb()
      .prepare(
        `SELECT * FROM agent_session_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?`,
      )
      .all(sessionId, limit) as AgentSessionMessageRow[];
    return rows.map(rowToModel);
  }

  deleteBySession(sessionId: string): number {
    const result = getDb()
      .prepare(`DELETE FROM agent_session_messages WHERE session_id = ?`)
      .run(sessionId);
    return result.changes;
  }
}
