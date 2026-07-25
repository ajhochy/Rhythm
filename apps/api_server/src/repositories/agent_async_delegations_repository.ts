import { getDb } from '../database/db';

export type AsyncDelegationStatus =
  | 'dispatched'
  | 'completed'
  | 'waking'
  | 'notified'
  | 'failed';

export interface AgentAsyncDelegation {
  id: string;
  parentSessionId: string;
  childSessionId: string;
  targetAgentConfigId: string;
  status: AsyncDelegationStatus;
  completionText: string | null;
  errorText: string | null;
  completedAt: string | null;
  notifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AgentAsyncDelegationRow {
  id: string;
  parent_session_id: string;
  child_session_id: string;
  target_agent_config_id: string;
  status: AsyncDelegationStatus;
  completion_text: string | null;
  error_text: string | null;
  completed_at: string | null;
  notified_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToModel(row: AgentAsyncDelegationRow): AgentAsyncDelegation {
  return {
    id: row.id,
    parentSessionId: row.parent_session_id,
    childSessionId: row.child_session_id,
    targetAgentConfigId: row.target_agent_config_id,
    status: row.status,
    completionText: row.completion_text ?? null,
    errorText: row.error_text ?? null,
    completedAt: row.completed_at ?? null,
    notifiedAt: row.notified_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class AgentAsyncDelegationsRepository {
  create(input: {
    parentSessionId: string;
    childSessionId: string;
    targetAgentConfigId: string;
  }): AgentAsyncDelegation {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO agent_async_delegations
          (id, parent_session_id, child_session_id, target_agent_config_id,
           status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'dispatched', ?, ?)`,
      )
      .run(
        id,
        input.parentSessionId,
        input.childSessionId,
        input.targetAgentConfigId,
        now,
        now,
      );
    return this.findByChildSessionId(input.childSessionId)!;
  }

  findByChildSessionId(childSessionId: string): AgentAsyncDelegation | null {
    const row = getDb()
      .prepare(
        `SELECT * FROM agent_async_delegations WHERE child_session_id = ? LIMIT 1`,
      )
      .get(childSessionId) as AgentAsyncDelegationRow | undefined;
    return row ? rowToModel(row) : null;
  }

  markCompleted(
    childSessionId: string,
    completionText: string,
    errorText: string | null = null,
  ): AgentAsyncDelegation | null {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE agent_async_delegations
            SET status = 'completed',
                completion_text = ?,
                error_text = ?,
                completed_at = COALESCE(completed_at, ?),
                updated_at = ?
          WHERE child_session_id = ?
            AND status = 'dispatched'`,
      )
      .run(completionText, errorText, now, now, childSessionId);
    return this.findByChildSessionId(childSessionId);
  }

  markFailed(childSessionId: string, errorText: string): AgentAsyncDelegation | null {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE agent_async_delegations
            SET status = 'completed',
                completion_text = '',
                error_text = ?,
                completed_at = COALESCE(completed_at, ?),
                updated_at = ?
          WHERE child_session_id = ?
            AND status = 'dispatched'`,
      )
      .run(errorText, now, now, childSessionId);
    return this.findByChildSessionId(childSessionId);
  }

  markDispatchFailed(childSessionId: string, errorText: string): void {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE agent_async_delegations
            SET status = 'failed', error_text = ?, updated_at = ?
          WHERE child_session_id = ?
            AND status = 'dispatched'`,
      )
      .run(errorText, now, childSessionId);
  }

  /**
   * Atomically claim every completed callback currently queued for one parent.
   * SQLite serializes this transaction, so concurrent child idle events cannot
   * double-claim or split the same result across two parent prompts.
   */
  claimCompletedForParent(parentSessionId: string): AgentAsyncDelegation[] {
    return getDb().transaction(() => {
      const rows = getDb()
        .prepare(
          `SELECT * FROM agent_async_delegations
            WHERE parent_session_id = ? AND status = 'completed'
            ORDER BY created_at ASC, id ASC`,
        )
        .all(parentSessionId) as AgentAsyncDelegationRow[];
      if (rows.length === 0) return [];
      const now = new Date().toISOString();
      const mark = getDb().prepare(
        `UPDATE agent_async_delegations
            SET status = 'waking', updated_at = ?
          WHERE id = ? AND status = 'completed'`,
      );
      const claimed: AgentAsyncDelegation[] = [];
      for (const row of rows) {
        const result = mark.run(now, row.id);
        if (result.changes === 1) claimed.push(rowToModel({ ...row, status: 'waking', updated_at: now }));
      }
      return claimed;
    })();
  }

  markNotified(ids: string[]): void {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    const mark = getDb().prepare(
      `UPDATE agent_async_delegations
          SET status = 'notified', notified_at = ?, updated_at = ?
        WHERE id = ? AND status = 'waking'`,
    );
    getDb().transaction(() => {
      for (const id of ids) mark.run(now, now, id);
    })();
  }

  releaseClaims(ids: string[]): void {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    const release = getDb().prepare(
      `UPDATE agent_async_delegations
          SET status = 'completed', updated_at = ?
        WHERE id = ? AND status = 'waking'`,
    );
    getDb().transaction(() => {
      for (const id of ids) release.run(now, id);
    })();
  }
}
