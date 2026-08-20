import { randomUUID } from 'node:crypto';
import { env } from '../config/env';
import { getDb, getPostgresPool } from '../database/db';
import {
  deriveTranscriptShareReview,
  type SourceTranscriptMessage,
  type TranscriptShareReview,
} from '../services/transcript_share_sanitizer';

export type ShareAuditAction = 'share' | 'view' | 'revoke' | 'delete';

export interface SharedTranscript {
  id: string;
  snapshot: TranscriptShareReview;
  ownerUserId: number;
  recipientUserIds: number[];
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  sourceSessionId: string;
}

interface SharedTranscriptRow {
  id: string;
  snapshot_json: string | TranscriptShareReview;
  owner_user_id: number;
  recipient_user_ids_json: string | number[];
  created_at: string | Date;
  expires_at: string | Date;
  revoked_at: string | Date | null;
  source_session_id: string;
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function parseJson<T>(value: string | T): T {
  return typeof value === 'string' ? JSON.parse(value) as T : value;
}

function rowToShare(row: SharedTranscriptRow): SharedTranscript {
  return {
    id: row.id,
    snapshot: parseJson(row.snapshot_json),
    ownerUserId: row.owner_user_id,
    recipientUserIds: parseJson(row.recipient_user_ids_json),
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    revokedAt: row.revoked_at ? iso(row.revoked_at) : null,
    sourceSessionId: row.source_session_id,
  };
}

export class SharedTranscriptsRepository {
  static readonly defaultExpirationMs = 90 * 24 * 60 * 60 * 1000;
  static readonly purgeRetentionMs = 30 * 24 * 60 * 60 * 1000;

  async sourceOwnerUserId(sourceSessionId: string): Promise<number | null | undefined> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<{ owner_user_id: number | null }>(
        'SELECT owner_user_id FROM agent_sessions WHERE id = $1',
        [sourceSessionId],
      );
      return result.rows[0]?.owner_user_id;
    }
    const row = getDb()
      .prepare('SELECT owner_user_id FROM agent_sessions WHERE id = ?')
      .get(sourceSessionId) as { owner_user_id: number | null } | undefined;
    return row?.owner_user_id;
  }

  async usersExist(userIds: readonly number[]): Promise<boolean> {
    if (userIds.length === 0) return false;
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM users WHERE id = ANY($1::int[])',
        [userIds],
      );
      return Number(result.rows[0]?.count ?? 0) === userIds.length;
    }
    const placeholders = userIds.map(() => '?').join(',');
    const row = getDb()
      .prepare(`SELECT COUNT(*) AS count FROM users WHERE id IN (${placeholders})`)
      .get(...userIds) as { count: number };
    return row.count === userIds.length;
  }

  async recipientsShareWorkspace(
    ownerUserId: number,
    recipientUserIds: readonly number[],
  ): Promise<boolean> {
    if (recipientUserIds.length === 0) return false;
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<{ count: string }>(
        `SELECT COUNT(DISTINCT recipient.user_id)::text AS count
           FROM workspace_members owner
           JOIN workspace_members recipient
             ON recipient.workspace_id = owner.workspace_id
          WHERE owner.user_id = $1
            AND recipient.user_id = ANY($2::int[])`,
        [ownerUserId, recipientUserIds],
      );
      return Number(result.rows[0]?.count ?? 0) === recipientUserIds.length;
    }
    const placeholders = recipientUserIds.map(() => '?').join(',');
    const row = getDb().prepare(
      `SELECT COUNT(DISTINCT recipient.user_id) AS count
         FROM workspace_members owner
         JOIN workspace_members recipient
           ON recipient.workspace_id = owner.workspace_id
        WHERE owner.user_id = ?
          AND recipient.user_id IN (${placeholders})`,
    ).get(ownerUserId, ...recipientUserIds) as { count: number };
    return row.count === recipientUserIds.length;
  }

  async sourceTranscriptReview(
    sourceSessionId: string,
  ): Promise<TranscriptShareReview> {
    type MessageRow = {
      id: number | string;
      role: string;
      raw_text: string;
      parts_json: string | unknown[] | null;
    };
    const rows = env.dbClient === 'postgres'
      ? (await getPostgresPool().query<MessageRow>(
        `SELECT id, role, raw_text, parts_json
           FROM agent_session_messages
          WHERE session_id = $1
          ORDER BY created_at ASC, id ASC`,
        [sourceSessionId],
      )).rows
      : getDb().prepare(
        `SELECT id, role, raw_text, parts_json
           FROM agent_session_messages
          WHERE session_id = ?
          ORDER BY created_at ASC, id ASC`,
      ).all(sourceSessionId) as MessageRow[];
    const messages: SourceTranscriptMessage[] = rows.map((row) => {
      let parts: unknown[] = [];
      if (Array.isArray(row.parts_json)) {
        parts = row.parts_json;
      } else if (typeof row.parts_json === 'string') {
        try {
          const parsed = JSON.parse(row.parts_json) as unknown;
          if (Array.isArray(parsed)) parts = parsed;
        } catch {
          parts = [];
        }
      }
      return {
        id: row.id,
        role: row.role,
        rawText: row.raw_text,
        parts,
      };
    });
    return deriveTranscriptShareReview(messages);
  }

  async create(input: {
    snapshot: TranscriptShareReview;
    ownerUserId: number;
    recipientUserIds: number[];
    sourceSessionId: string;
    expiresAt?: string;
  }): Promise<SharedTranscript> {
    const id = randomUUID();
    const auditId = randomUUID();
    const createdAt = new Date().toISOString();
    const expiresAt = input.expiresAt ?? new Date(
      Date.now() + SharedTranscriptsRepository.defaultExpirationMs,
    ).toISOString();
    const snapshotJson = JSON.stringify(input.snapshot);
    const recipientsJson = JSON.stringify(input.recipientUserIds);
    if (env.dbClient === 'postgres') {
      const pool = getPostgresPool();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query<SharedTranscriptRow>(
          `INSERT INTO shared_transcripts
             (id, snapshot_json, owner_user_id, recipient_user_ids_json,
              created_at, expires_at, source_session_id)
           VALUES ($1, $2::jsonb, $3, $4::jsonb, $5, $6, $7)
           RETURNING *`,
          [id, snapshotJson, input.ownerUserId, recipientsJson, createdAt,
            expiresAt, input.sourceSessionId],
        );
        await client.query(
          `INSERT INTO share_audit_log
             (id, share_id, actor_user_id, action, timestamp)
           VALUES ($1, $2, $3, 'share', $4)`,
          [auditId, id, input.ownerUserId, createdAt],
        );
        await client.query('COMMIT');
        return rowToShare(result.rows[0]);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
    const db = getDb();
    return db.transaction(() => {
      db.prepare(
        `INSERT INTO shared_transcripts
           (id, snapshot_json, owner_user_id, recipient_user_ids_json,
            created_at, expires_at, source_session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, snapshotJson, input.ownerUserId, recipientsJson, createdAt,
        expiresAt, input.sourceSessionId);
      db.prepare(
        `INSERT INTO share_audit_log
           (id, share_id, actor_user_id, action, timestamp)
         VALUES (?, ?, ?, 'share', ?)`,
      ).run(auditId, id, input.ownerUserId, createdAt);
      return rowToShare(db.prepare('SELECT * FROM shared_transcripts WHERE id = ?')
        .get(id) as SharedTranscriptRow);
    })();
  }

  async listForUser(userId: number): Promise<SharedTranscript[]> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<SharedTranscriptRow>(
        `SELECT st.* FROM shared_transcripts st
         WHERE st.owner_user_id = $1
            OR st.recipient_user_ids_json @> $2::jsonb
         ORDER BY st.created_at DESC`,
        [userId, JSON.stringify([userId])],
      );
      return result.rows.map(rowToShare);
    }
    const rows = getDb().prepare(
      `SELECT st.* FROM shared_transcripts st
       WHERE st.owner_user_id = ?
          OR EXISTS (
            SELECT 1 FROM json_each(st.recipient_user_ids_json)
            WHERE CAST(value AS INTEGER) = ?
          )
       ORDER BY st.created_at DESC`,
    ).all(userId, userId) as SharedTranscriptRow[];
    return rows.map(rowToShare);
  }

  async findWithLiveSource(id: string): Promise<SharedTranscript | null> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<SharedTranscriptRow>(
        `SELECT st.* FROM shared_transcripts st
         INNER JOIN agent_sessions source ON source.id = st.source_session_id
         WHERE st.id = $1`,
        [id],
      );
      return result.rows[0] ? rowToShare(result.rows[0]) : null;
    }
    const row = getDb().prepare(
      `SELECT st.* FROM shared_transcripts st
       INNER JOIN agent_sessions source ON source.id = st.source_session_id
       WHERE st.id = ?`,
    ).get(id) as SharedTranscriptRow | undefined;
    return row ? rowToShare(row) : null;
  }

  async audit(shareId: string, actorUserId: number, action: ShareAuditAction): Promise<void> {
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        `INSERT INTO share_audit_log
           (id, share_id, actor_user_id, action, timestamp)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, shareId, actorUserId, action, timestamp],
      );
      return;
    }
    getDb().prepare(
      `INSERT INTO share_audit_log
         (id, share_id, actor_user_id, action, timestamp)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(id, shareId, actorUserId, action, timestamp);
  }

  async listAudit(shareId: string): Promise<Array<{
    actorUserId: number;
    action: ShareAuditAction;
    timestamp: string;
  }>> {
    const sql = `SELECT actor_user_id, action, timestamp
                 FROM share_audit_log WHERE share_id =`;
    const rows = env.dbClient === 'postgres'
      ? (await getPostgresPool().query(`${sql} $1 ORDER BY timestamp`, [shareId])).rows
      : getDb().prepare(`${sql} ? ORDER BY timestamp`).all(shareId);
    return (rows as Array<{
      actor_user_id: number;
      action: ShareAuditAction;
      timestamp: string | Date;
    }>).map((row) => ({
      actorUserId: row.actor_user_id,
      action: row.action,
      timestamp: iso(row.timestamp),
    }));
  }

  async revoke(id: string, actorUserId: number): Promise<boolean> {
    const timestamp = new Date().toISOString();
    const auditId = randomUUID();
    if (env.dbClient === 'postgres') {
      const pool = getPostgresPool();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query(
          `UPDATE shared_transcripts SET revoked_at = COALESCE(revoked_at, $1)
           WHERE id = $2 AND revoked_at IS NULL`,
          [timestamp, id],
        );
        if ((result.rowCount ?? 0) === 0) {
          await client.query('ROLLBACK');
          return false;
        }
        await client.query(
          `INSERT INTO share_audit_log
             (id, share_id, actor_user_id, action, timestamp)
           VALUES ($1, $2, $3, 'revoke', $4)`,
          [auditId, id, actorUserId, timestamp],
        );
        await client.query('COMMIT');
        return true;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
    return getDb().transaction(() => {
      const result = getDb().prepare(
        `UPDATE shared_transcripts SET revoked_at = COALESCE(revoked_at, ?)
         WHERE id = ? AND revoked_at IS NULL`,
      ).run(timestamp, id);
      if (result.changes === 0) return false;
      getDb().prepare(
        `INSERT INTO share_audit_log
           (id, share_id, actor_user_id, action, timestamp)
         VALUES (?, ?, ?, 'revoke', ?)`,
      ).run(auditId, id, actorUserId, timestamp);
      return true;
    })();
  }

  /** Permanently removes only frozen share rows after their retention window. */
  async purgeDueSnapshots(now = new Date()): Promise<number> {
    const cutoff = new Date(
      now.getTime() - SharedTranscriptsRepository.purgeRetentionMs,
    ).toISOString();
    if (env.dbClient === 'postgres') {
      const client = await getPostgresPool().connect();
      try {
        await client.query('BEGIN');
        const due = await client.query<{ id: string; owner_user_id: number }>(
          `SELECT id, owner_user_id FROM shared_transcripts
           WHERE expires_at <= $1 OR revoked_at <= $1
           FOR UPDATE`,
          [cutoff],
        );
        for (const share of due.rows) {
          await client.query(
            `INSERT INTO share_audit_log
               (id, share_id, actor_user_id, action, timestamp)
             VALUES ($1, $2, $3, 'delete', $4)`,
            [randomUUID(), share.id, share.owner_user_id, now.toISOString()],
          );
          await client.query('DELETE FROM shared_transcripts WHERE id = $1', [share.id]);
        }
        await client.query('COMMIT');
        return due.rows.length;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }

    return getDb().transaction(() => {
      const due = getDb().prepare(
        `SELECT id, owner_user_id FROM shared_transcripts
         WHERE expires_at <= ? OR revoked_at <= ?`,
      ).all(cutoff, cutoff) as Array<{ id: string; owner_user_id: number }>;
      const audit = getDb().prepare(
        `INSERT INTO share_audit_log
           (id, share_id, actor_user_id, action, timestamp)
         VALUES (?, ?, ?, 'delete', ?)`,
      );
      const remove = getDb().prepare('DELETE FROM shared_transcripts WHERE id = ?');
      for (const share of due) {
        audit.run(randomUUID(), share.id, share.owner_user_id, now.toISOString());
        remove.run(share.id);
      }
      return due.length;
    })();
  }
}
