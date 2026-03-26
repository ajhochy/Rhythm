import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../database/db';
import type { GmailSignal } from '../models/gmail_signal';

interface GmailSignalRow {
  id: string;
  external_id: string;
  thread_id: string;
  from_name: string | null;
  from_email: string | null;
  subject: string | null;
  snippet: string | null;
  received_at: string | null;
  is_unread: number;
  created_at: string;
  updated_at: string;
}

interface GmailSignalInput {
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
  return {
    id: row.id,
    externalId: row.external_id,
    threadId: row.thread_id,
    fromName: row.from_name,
    fromEmail: row.from_email,
    subject: row.subject,
    snippet: row.snippet,
    receivedAt: row.received_at,
    isUnread: row.is_unread === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class GmailSignalsRepository {
  upsertMany(signals: GmailSignalInput[]): GmailSignal[] {
    const now = new Date().toISOString();
    const selectStmt = getDb().prepare(
      'SELECT * FROM gmail_signals WHERE external_id = ? LIMIT 1',
    );
    const insertStmt = getDb().prepare(
      `INSERT INTO gmail_signals (
        id, external_id, thread_id, from_name, from_email, subject, snippet,
        received_at, is_unread, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const updateStmt = getDb().prepare(
      `UPDATE gmail_signals
       SET thread_id = ?, from_name = ?, from_email = ?, subject = ?, snippet = ?,
           received_at = ?, is_unread = ?, updated_at = ?
       WHERE id = ?`,
    );

    const transaction = getDb().transaction((items: GmailSignalInput[]) => {
      for (const item of items) {
        const existing = selectStmt.get(item.externalId) as
          | GmailSignalRow
          | undefined;
        if (existing) {
          updateStmt.run(
            item.threadId,
            item.fromName,
            item.fromEmail,
            item.subject,
            item.snippet,
            item.receivedAt,
            item.isUnread ? 1 : 0,
            now,
            existing.id,
          );
        } else {
          insertStmt.run(
            uuidv4(),
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
      }
    });

    transaction(signals);
    return this.listRecent();
  }

  listRecent(limit = 12): GmailSignal[] {
    const rows = getDb()
      .prepare(
        `SELECT * FROM gmail_signals
         ORDER BY COALESCE(received_at, created_at) DESC, updated_at DESC
         LIMIT ?`,
      )
      .all(limit) as GmailSignalRow[];
    return rows.map(rowToSignal);
  }
}
