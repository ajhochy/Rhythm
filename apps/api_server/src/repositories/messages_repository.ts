import { getDb } from '../database/db';
import { AppError } from '../errors/app_error';
import type {
  CreateMessageDto,
  CreateThreadDto,
  Message,
  MessageThread,
} from '../models/message';

interface ThreadRow {
  id: number;
  title: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: number;
  thread_id: number;
  sender_id: number | null;
  sender_name: string;
  body: string;
  created_at: string;
}

function rowToThread(row: ThreadRow & { last_message?: string | null }): MessageThread {
  return {
    id: row.id,
    title: row.title,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessage: row.last_message ?? null,
  };
}

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    threadId: row.thread_id,
    senderId: row.sender_id,
    senderName: row.sender_name,
    body: row.body,
    createdAt: row.created_at,
  };
}

export class MessagesRepository {
  findAllThreads(): MessageThread[] {
    const rows = getDb()
      .prepare(
        `SELECT t.*, (
          SELECT m.body FROM messages m
          WHERE m.thread_id = t.id
          ORDER BY m.created_at DESC
          LIMIT 1
        ) AS last_message
        FROM message_threads t
        ORDER BY t.updated_at DESC`,
      )
      .all() as Array<ThreadRow & { last_message?: string | null }>;
    return rows.map(rowToThread);
  }

  findThreadById(id: number): MessageThread {
    const row = getDb()
      .prepare('SELECT * FROM message_threads WHERE id = ?')
      .get(id) as ThreadRow | undefined;
    if (!row) throw AppError.notFound('MessageThread');
    return rowToThread(row);
  }

  createThread(data: CreateThreadDto): MessageThread {
    const result = getDb()
      .prepare(
        `INSERT INTO message_threads (title, created_by) VALUES (?, ?)`,
      )
      .run(data.title, data.created_by ?? null);
    return this.findThreadById(result.lastInsertRowid as number);
  }

  findMessagesByThread(threadId: number): Message[] {
    // Ensure thread exists
    this.findThreadById(threadId);
    const rows = getDb()
      .prepare(
        'SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC',
      )
      .all(threadId) as MessageRow[];
    return rows.map(rowToMessage);
  }

  createMessage(threadId: number, data: CreateMessageDto): Message {
    // Ensure thread exists
    this.findThreadById(threadId);
    const now = new Date().toISOString();
    const result = getDb()
      .prepare(
        `INSERT INTO messages (thread_id, sender_id, sender_name, body) VALUES (?, ?, ?, ?)`,
      )
      .run(threadId, data.sender_id ?? null, data.sender_name, data.body);
    // Update thread updated_at
    getDb()
      .prepare(`UPDATE message_threads SET updated_at = ? WHERE id = ?`)
      .run(now, threadId);
    const row = getDb()
      .prepare('SELECT * FROM messages WHERE id = ?')
      .get(result.lastInsertRowid as number) as MessageRow;
    return rowToMessage(row);
  }
}
