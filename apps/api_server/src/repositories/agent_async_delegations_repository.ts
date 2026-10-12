import { getDb } from '../database/db';

export type AsyncDelegationStatus =
  | 'dispatched'
  | 'completed'
  | 'waking'
  | 'notified'
  | 'failed'
  | 'cancelled';

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

  /** Every delegation this parent has dispatched, newest first. */
  listForParent(parentSessionId: string, limit = 50): AgentAsyncDelegation[] {
    const rows = getDb()
      .prepare(
        `SELECT * FROM agent_async_delegations
          WHERE parent_session_id = ?
          ORDER BY created_at DESC
          LIMIT ?`,
      )
      .all(parentSessionId, limit) as AgentAsyncDelegationRow[];
    return rows.map(rowToModel);
  }

  /**
   * Mark a delegation cancelled. Terminal states are left alone so a cancel that
   * races a completion cannot rewrite a result the parent may already have been
   * woken with. Returns the row when it actually transitioned, else null.
   */
  markCancelled(id: string): AgentAsyncDelegation | null {
    const db = getDb();
    db.prepare(
      `UPDATE agent_async_delegations
          SET status = 'cancelled', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = ? AND status IN ('dispatched', 'waking')`,
    ).run(id);
    const row = db
      .prepare(`SELECT * FROM agent_async_delegations WHERE id = ?`)
      .get(id) as AgentAsyncDelegationRow | undefined;
    if (!row) return null;
    return row.status === 'cancelled' ? rowToModel(row) : null;
  }

  findById(id: string): AgentAsyncDelegation | null {
    const row = getDb()
      .prepare(`SELECT * FROM agent_async_delegations WHERE id = ?`)
      .get(id) as AgentAsyncDelegationRow | undefined;
    return row ? rowToModel(row) : null;
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
            -- A cancelled delegation must never be resurrected, and must never
            -- wake the parent with a result its owner explicitly stopped.
            AND status != 'cancelled'
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
            -- A cancelled delegation must never be resurrected, and must never
            -- wake the parent with a result its owner explicitly stopped.
            AND status != 'cancelled'
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
            -- A cancelled delegation must never be resurrected, and must never
            -- wake the parent with a result its owner explicitly stopped.
            AND status != 'cancelled'
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

  /**
   * Return the durable claims left behind for one parent. A healthy process
   * keeps these mirrored in AsyncDelegationCompletionService.wakeInFlight;
   * finding them without that in-memory marker means the process restarted or
   * an enqueue attempt threw before the claim could be released.
   */
  listWakingForParent(parentSessionId: string): AgentAsyncDelegation[] {
    const rows = getDb()
      .prepare(
        `SELECT * FROM agent_async_delegations
          WHERE parent_session_id = ? AND status = 'waking'
          ORDER BY created_at ASC, id ASC`,
      )
      .all(parentSessionId) as AgentAsyncDelegationRow[];
    return rows.map(rowToModel);
  }

  /**
   * Bounded restart scan. The service expands each selected parent to its full
   * batch so one logical wake is never split across two prompts.
   */
  listWakingParentIds(limit = 100, afterParentSessionId: string | null = null): string[] {
    const bounded = Math.max(1, Math.min(100, Math.floor(limit)));
    const rows = getDb()
      .prepare(
        `SELECT parent_session_id
           FROM agent_async_delegations
          WHERE status = 'waking'
            AND (? IS NULL OR parent_session_id > ?)
          GROUP BY parent_session_id
          ORDER BY parent_session_id ASC
          LIMIT ?`,
      )
      .all(afterParentSessionId, afterParentSessionId, bounded) as Array<{
      parent_session_id: string;
    }>;
    return rows.map((row) => row.parent_session_id);
  }

  countWakingClaims(): number {
    const row = getDb()
      .prepare(
        `SELECT COUNT(*) AS count
           FROM agent_async_delegations
          WHERE status = 'waking'`,
      )
      .get() as { count: number };
    return row.count;
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
