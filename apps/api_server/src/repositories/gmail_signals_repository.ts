import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../database/db';
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
  is_unread: number;
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
    isUnread: row.is_unread === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class GmailSignalsRepository {
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
