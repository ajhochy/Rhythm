/**
 * agent_prompt_injections_repository.ts — #1577.
 *
 * Append-only audit trail for prompts pushed into an EXISTING agent session
 * through POST /agent-sessions/:id/prompt. See the table comment in
 * migrations.ts for why this is a log and not a gate.
 *
 * SQLite-only (mirrors AgentSessionMessagesRepository) — the local agent
 * server on :4001 is the only writer/reader; never added to
 * postgres_bootstrap.ts.
 */
import { getDb } from '../database/db';

/** Where the injection came in from. Not an authorization input — a label. */
export type PromptInjectionSource = 'mcp' | 'http';

export interface PromptInjectionRecord {
  id: number;
  targetSessionId: string;
  /** Rhythm session id of the caller, resolved from its engine session id. */
  callerSessionId: string | null;
  /** Engine session id, from the MCP layer's trusted context (#1322). */
  callerSdkSessionId: string | null;
  callerUserId: number | null;
  source: PromptInjectionSource;
  prompt: string;
  accepted: boolean;
  error: string | null;
  createdAt: string;
}

interface Row {
  id: number;
  target_session_id: string;
  caller_session_id: string | null;
  caller_sdk_session_id: string | null;
  caller_user_id: number | null;
  source: string;
  prompt: string;
  accepted: number;
  error: string | null;
  created_at: string;
}

function rowToModel(row: Row): PromptInjectionRecord {
  return {
    id: row.id,
    targetSessionId: row.target_session_id,
    callerSessionId: row.caller_session_id,
    callerSdkSessionId: row.caller_sdk_session_id,
    callerUserId: row.caller_user_id,
    source: row.source === 'mcp' ? 'mcp' : 'http',
    prompt: row.prompt,
    accepted: row.accepted === 1,
    error: row.error,
    createdAt: row.created_at,
  };
}

export class AgentPromptInjectionsRepository {
  /**
   * Record the attempt BEFORE dispatch and return its id.
   *
   * Written before the prompt is handed to the engine on purpose: an
   * injection that crashes the dispatch path is exactly the one worth having
   * in the log. {@link settle} fills in the outcome afterwards.
   */
  record(entry: {
    targetSessionId: string;
    callerSessionId: string | null;
    callerSdkSessionId: string | null;
    callerUserId: number | null;
    source: PromptInjectionSource;
    prompt: string;
  }): number {
    const result = getDb()
      .prepare(
        `INSERT INTO agent_prompt_injections
           (target_session_id, caller_session_id, caller_sdk_session_id,
            caller_user_id, source, prompt)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.targetSessionId,
        entry.callerSessionId,
        entry.callerSdkSessionId,
        entry.callerUserId,
        entry.source,
        entry.prompt,
      );
    return Number(result.lastInsertRowid);
  }

  /** Record the dispatch outcome for a row created by {@link record}. */
  settle(id: number, accepted: boolean, error: string | null = null): void {
    getDb()
      .prepare(
        `UPDATE agent_prompt_injections SET accepted = ?, error = ? WHERE id = ?`,
      )
      .run(accepted ? 1 : 0, error, id);
  }

  /** Most recent injections into a session, newest first. */
  listForSession(sessionId: string, limit = 50): PromptInjectionRecord[] {
    const rows = getDb()
      .prepare(
        `SELECT * FROM agent_prompt_injections
          WHERE target_session_id = ?
          ORDER BY id DESC
          LIMIT ?`,
      )
      .all(sessionId, Math.max(1, Math.min(limit, 500))) as Row[];
    return rows.map(rowToModel);
  }
}
