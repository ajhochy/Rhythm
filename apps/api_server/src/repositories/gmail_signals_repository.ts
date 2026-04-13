import { env } from '../config/env';
import { v4 as uuidv4 } from 'uuid';
import { getDb, getPostgresPool } from '../database/db';
import type { GmailSignal } from '../models/gmail_signal';

interface GmailSignalRow {
  id: string;
  owner_id: number | null;
  external_id: string;
  thread_id: string;
  from_name: string | null;
  from_email: string | null;
  subject: string | null;
  snippet: string | null;
  received_at: string | null;
  is_unread: number | boolean;
  created_at: string;
  updated_at: string;
}

interface GmailSignalInput {
  ownerId: number;
  externalId: string;
  threadId: string;
  fromName: string | null;
  fromEmail: string | null;
  subject: string | null;
  snippet: string | null;
  receivedAt: string | null;
  isUnread: boolean;
}

function rowToSignal(row: GmailSignalRow): GmailSignal {
  const isUnread =
    typeof row.is_unread === 'boolean' ? row.is_unread : row.is_unread === 1;

  return {
    id: row.id,
    ownerId: row.owner_id,
    externalId: row.external_id,
    threadId: row.thread_id,
    fromName: row.from_name,
    fromEmail: row.from_email,
    subject: row.subject,
    snippet: row.snippet,
    receivedAt: row.received_at,
    isUnread,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class GmailSignalsRepository {
  async replaceForOwnerAsync(
    ownerId: number,
    signals: GmailSignalInput[],
  ): Promise<GmailSignal[]> {
    if (env.dbClient === 'postgres') {
      const now = new Date().toISOString();
      await getPostgresPool().query(
        'DELETE FROM gmail_signals WHERE owner_id = $1',
        [ownerId],
      );
      for (const item of signals) {
        await getPostgresPool().query(
          `INSERT INTO gmail_signals (
            id, owner_id, external_id, thread_id, from_name, from_email, subject, snippet,
            received_at, is_unread, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            uuidv4(),
            ownerId,
            item.externalId,
            item.threadId,
            item.fromName,
            item.fromEmail,
            item.subject,
            item.snippet,
            item.receivedAt,
            item.isUnread,
            now,
            now,
          ],
        );
      }
      return this.listRecentAsync(ownerId);
    }
    return this.replaceForOwner(ownerId, signals);
  }

  replaceForOwner(ownerId: number, signals: GmailSignalInput[]): GmailSignal[] {
    const now = new Date().toISOString();
    const deleteStmt = getDb().prepare(
      'DELETE FROM gmail_signals WHERE owner_id = ?',
    );
    const insertStmt = getDb().prepare(
      `INSERT INTO gmail_signals (
        id, owner_id, external_id, thread_id, from_name, from_email, subject, snippet,
        received_at, is_unread, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const transaction = getDb().transaction((items: GmailSignalInput[]) => {
      deleteStmt.run(ownerId);
      for (const item of items) {
        insertStmt.run(
          uuidv4(),
          ownerId,
          item.externalId,
          item.threadId,
          item.fromName,
          item.fromEmail,
          item.subject,
          item.snippet,
          item.receivedAt,
          item.isUnread ? 1 : 0,
          now,
          now,
        );
      }
    });

    transaction(signals);
    return this.listRecent(ownerId);
  }

  async listRecentAsync(ownerId: number, limit = 12): Promise<GmailSignal[]> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<GmailSignalRow>(
        `SELECT * FROM gmail_signals
         WHERE owner_id = $1
         ORDER BY COALESCE(received_at, created_at) DESC, updated_at DESC
         LIMIT $2`,
        [ownerId, limit],
      );
      return result.rows.map(rowToSignal);
    }
    return this.listRecent(ownerId, limit);
  }

  listRecent(ownerId: number, limit = 12): GmailSignal[] {
    const rows = getDb()
      .prepare(
        `SELECT * FROM gmail_signals
         WHERE owner_id = ?
         ORDER BY COALESCE(received_at, created_at) DESC, updated_at DESC
         LIMIT ?`,
      )
      .all(ownerId, limit) as GmailSignalRow[];
    return rows.map(rowToSignal);
  }
}
