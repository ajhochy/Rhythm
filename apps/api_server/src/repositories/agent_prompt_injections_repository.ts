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
import type Database from 'better-sqlite3';

export function initializeAgentPromptInjectionAuditGuards(db: Database.Database): void {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS agent_prompt_injections_no_update
      BEFORE UPDATE ON agent_prompt_injections BEGIN
        SELECT RAISE(ABORT, 'prompt injection audit history is append-only');
      END;
    CREATE TRIGGER IF NOT EXISTS agent_prompt_injections_no_delete
      BEFORE DELETE ON agent_prompt_injections BEGIN
        SELECT RAISE(ABORT, 'prompt injection audit history is append-only');
      END;
    CREATE TABLE IF NOT EXISTS agent_prompt_injection_outcomes (
      injection_id INTEGER PRIMARY KEY REFERENCES agent_prompt_injections(id),
      accepted INTEGER NOT NULL CHECK (accepted IN (0, 1)),
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TRIGGER IF NOT EXISTS agent_prompt_injection_outcomes_no_update
      BEFORE UPDATE ON agent_prompt_injection_outcomes BEGIN
        SELECT RAISE(ABORT, 'prompt injection outcomes are append-only');
      END;
    CREATE TRIGGER IF NOT EXISTS agent_prompt_injection_outcomes_no_delete
      BEFORE DELETE ON agent_prompt_injection_outcomes BEGIN
        SELECT RAISE(ABORT, 'prompt injection outcomes are append-only');
      END;
  `);
}

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

export type PromptInjectionSettlementResult =
  | { status: 'settled' }
  | { status: 'conflict'; reason: 'legacy_terminal_outcome' };

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
  private readonly db: Database.Database;

  constructor(db: Database.Database = getDb()) {
    this.db = db;
    initializeAgentPromptInjectionAuditGuards(db);
  }

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
    const result = this.db
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
  settle(
    id: number,
    accepted: boolean,
    error: string | null = null,
  ): PromptInjectionSettlementResult {
    const result = this.db
      .prepare(
        `INSERT INTO agent_prompt_injection_outcomes (injection_id, accepted, error)
         SELECT id, ?, ? FROM agent_prompt_injections
          WHERE id = ? AND accepted = 0 AND error IS NULL`,
      )
      .run(accepted ? 1 : 0, error, id);
    if (result.changes === 1) return { status: 'settled' };

    const existing = this.db
      .prepare(
        `SELECT i.accepted, i.error, o.injection_id AS outcome_id
           FROM agent_prompt_injections i
           LEFT JOIN agent_prompt_injection_outcomes o ON o.injection_id = i.id
          WHERE i.id = ?`,
      )
      .get(id) as {
        accepted: number;
        error: string | null;
        outcome_id: number | null;
      } | undefined;
    if (
      existing &&
      existing.outcome_id === null &&
      (existing.accepted === 1 || existing.error !== null)
    ) {
      return { status: 'conflict', reason: 'legacy_terminal_outcome' };
    }
    throw new Error('prompt injection not found or already settled');
  }

  /** Most recent injections into a session, newest first. */
  listForSession(sessionId: string, limit = 50): PromptInjectionRecord[] {
    const rows = this.db
      .prepare(
        `SELECT i.*, COALESCE(o.accepted, i.accepted) AS accepted,
                CASE WHEN o.injection_id IS NOT NULL THEN o.error ELSE i.error END AS error
           FROM agent_prompt_injections i
           LEFT JOIN agent_prompt_injection_outcomes o ON o.injection_id = i.id
          WHERE i.target_session_id = ?
          ORDER BY i.id DESC
          LIMIT ?`,
      )
      .all(sessionId, Math.max(1, Math.min(limit, 500))) as Row[];
    return rows.map(rowToModel);
  }
}
