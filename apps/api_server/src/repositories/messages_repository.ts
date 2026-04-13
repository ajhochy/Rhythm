import { env } from '../config/env';
import { getDb, getPostgresPool } from '../database/db';
import { AppError } from '../errors/app_error';
import type {
  CreateMessageDto,
  CreateThreadDto,
  Message,
  MessageThread,
  MessageThreadParticipant,
} from '../models/message';
import { UsersRepository } from './users_repository';

interface ThreadRow {
  id: number;
  title: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

interface ThreadSummaryRow extends ThreadRow {
  last_message?: string | null;
  unread_count?: number | null;
}

interface MessageRow {
  id: number;
  thread_id: number;
  sender_id: number | null;
  sender_name: string;
  body: string;
  created_at: string;
}

function rowToThread(row: ThreadSummaryRow): MessageThread {
  const unreadCount = row.unread_count ?? 0;
  return {
    id: row.id,
    title: row.title,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessage: row.last_message ?? null,
    unreadCount,
    isUnread: unreadCount > 0,
    participants: [],
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
  private readonly usersRepo = new UsersRepository();

  private async getParticipantsForThreadAsync(
    threadId: number,
  ): Promise<MessageThreadParticipant[]> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<MessageThreadParticipant>(
        `SELECT u.id, u.name, u.email
         FROM thread_participants tp
         JOIN users u ON u.id = tp.user_id
         WHERE tp.thread_id = $1
         ORDER BY lower(u.name) ASC, u.id ASC`,
        [threadId],
      );
      return result.rows;
    }
    return this.getParticipantsForThread(threadId);
  }

  private getParticipantsForThread(threadId: number): MessageThreadParticipant[] {
    const rows = getDb()
      .prepare(
        `SELECT u.id, u.name, u.email
         FROM thread_participants tp
         JOIN users u ON u.id = tp.user_id
         WHERE tp.thread_id = ?
         ORDER BY lower(u.name) ASC, u.id ASC`,
      )
      .all(threadId) as MessageThreadParticipant[];
    return rows;
  }

  private withParticipants(thread: MessageThread): MessageThread {
    return {
      ...thread,
      participants: this.getParticipantsForThread(thread.id),
    };
  }

  private async withParticipantsAsync(
    thread: MessageThread,
  ): Promise<MessageThread> {
    return {
      ...thread,
      participants: await this.getParticipantsForThreadAsync(thread.id),
    };
  }

  private async findExistingDirectThreadIdAsync(
    userIds: number[],
  ): Promise<number | null> {
    if (env.dbClient === 'postgres') {
      if (userIds.length != 2) return null;
      const normalized = [...userIds].sort((a, b) => a - b);
      const result = await getPostgresPool().query<{ id: number }>(
        `SELECT tp.thread_id AS id
         FROM thread_participants tp
         GROUP BY tp.thread_id
         HAVING COUNT(*) = 2
            AND SUM(CASE WHEN tp.user_id IN ($1, $2) THEN 1 ELSE 0 END) = 2
         LIMIT 1`,
        [normalized[0], normalized[1]],
      );
      return result.rows[0]?.id ?? null;
    }
    return this.findExistingDirectThreadId(userIds);
  }

  private findExistingDirectThreadId(userIds: number[]): number | null {
    if (userIds.length != 2) return null;
    const normalized = [...userIds].sort((a, b) => a - b);
    const row = getDb()
      .prepare(
        `SELECT tp.thread_id AS id
         FROM thread_participants tp
         GROUP BY tp.thread_id
         HAVING COUNT(*) = 2
            AND SUM(CASE WHEN tp.user_id IN (?, ?) THEN 1 ELSE 0 END) = 2
         LIMIT 1`,
      )
      .get(normalized[0], normalized[1]) as { id: number } | undefined;
    return row?.id ?? null;
  }

  findAllThreadsForUser(userId: number): MessageThread[] {
    const rows = getDb()
      .prepare(
        `SELECT
           t.*,
           (
             SELECT m.body FROM messages m
             WHERE m.thread_id = t.id
             ORDER BY m.created_at DESC
             LIMIT 1
           ) AS last_message,
           (
             SELECT COUNT(*) FROM messages m
             LEFT JOIN thread_reads tr
               ON tr.thread_id = m.thread_id AND tr.user_id = ?
             WHERE m.thread_id = t.id
               AND m.sender_id != ?
               AND (tr.last_read_at IS NULL OR m.created_at > tr.last_read_at)
           ) AS unread_count
         FROM message_threads t
         JOIN thread_participants tp
           ON tp.thread_id = t.id
         WHERE tp.user_id = ?
         ORDER BY t.updated_at DESC`,
      )
      .all(userId, userId, userId) as ThreadSummaryRow[];
    return rows.map((row) => this.withParticipants(rowToThread(row)));
  }

  async findAllThreadsForUserAsync(userId: number): Promise<MessageThread[]> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<ThreadSummaryRow>(
        `SELECT
           t.*,
           (
             SELECT m.body FROM messages m
             WHERE m.thread_id = t.id
             ORDER BY m.created_at DESC
             LIMIT 1
           ) AS last_message,
           (
             SELECT COUNT(*) FROM messages m
             LEFT JOIN thread_reads tr
               ON tr.thread_id = m.thread_id AND tr.user_id = $1
             WHERE m.thread_id = t.id
               AND m.sender_id != $1
               AND (tr.last_read_at IS NULL OR m.created_at > tr.last_read_at)
           ) AS unread_count
         FROM message_threads t
         JOIN thread_participants tp
           ON tp.thread_id = t.id
         WHERE tp.user_id = $1
         ORDER BY t.updated_at DESC`,
        [userId],
      );
      return Promise.all(
        result.rows.map((row) => this.withParticipantsAsync(rowToThread(row))),
      );
    }
    return this.findAllThreadsForUser(userId);
  }

  findThreadByIdForUser(id: number, userId: number): MessageThread {
    const row = getDb()
      .prepare(
        `SELECT t.*,
            (
              SELECT m.body FROM messages m
              WHERE m.thread_id = t.id
              ORDER BY m.created_at DESC
              LIMIT 1
            ) AS last_message,
            (
              SELECT COUNT(*) FROM messages m
              LEFT JOIN thread_reads tr
                ON tr.thread_id = m.thread_id AND tr.user_id = ?
              WHERE m.thread_id = t.id
                AND m.sender_id != ?
                AND (tr.last_read_at IS NULL OR m.created_at > tr.last_read_at)
            ) AS unread_count
         FROM message_threads t
         JOIN thread_participants tp
           ON tp.thread_id = t.id
         WHERE t.id = ? AND tp.user_id = ?`,
      )
      .get(userId, userId, id, userId) as ThreadSummaryRow | undefined;
    if (!row) throw AppError.notFound('MessageThread');
    return this.withParticipants(rowToThread(row));
  }

  async findThreadByIdForUserAsync(
    id: number,
    userId: number,
  ): Promise<MessageThread> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<ThreadSummaryRow>(
        `SELECT t.*,
            (
              SELECT m.body FROM messages m
              WHERE m.thread_id = t.id
              ORDER BY m.created_at DESC
              LIMIT 1
            ) AS last_message,
            (
              SELECT COUNT(*) FROM messages m
              LEFT JOIN thread_reads tr
                ON tr.thread_id = m.thread_id AND tr.user_id = $1
              WHERE m.thread_id = t.id
                AND m.sender_id != $1
                AND (tr.last_read_at IS NULL OR m.created_at > tr.last_read_at)
            ) AS unread_count
         FROM message_threads t
         JOIN thread_participants tp
           ON tp.thread_id = t.id
         WHERE t.id = $2 AND tp.user_id = $1`,
        [userId, id],
      );
      const row = result.rows[0];
      if (!row) throw AppError.notFound('MessageThread');
      return this.withParticipantsAsync(rowToThread(row));
    }
    return this.findThreadByIdForUser(id, userId);
  }

  createThread(data: CreateThreadDto): MessageThread {
    const participantIds = Array.from(
      new Set([data.createdBy, ...data.participantIds]),
    );
    if (participantIds.length !== 2) {
      throw AppError.badRequest(
        'Direct messages must include exactly one other participant',
      );
    }

    const existingThreadId = this.findExistingDirectThreadId(participantIds);
    if (existingThreadId != null) {
      return this.findThreadByIdForUser(existingThreadId, data.createdBy);
    }

    const participantUsers = participantIds.map((id) => this.usersRepo.findById(id));
    const title = participantUsers.map((user) => user.name).join(', ');

    const now = new Date().toISOString();
    const result = getDb()
      .prepare(
        `INSERT INTO message_threads (title, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(title, data.createdBy, now, now);

    const threadId = result.lastInsertRowid as number;
    const insertParticipant = getDb().prepare(
      `INSERT INTO thread_participants (thread_id, user_id) VALUES (?, ?)`,
    );
    const insertRead = getDb().prepare(
      `INSERT INTO thread_reads (thread_id, user_id, last_read_at) VALUES (?, ?, ?)`,
    );

    for (const participantId of participantIds) {
      insertParticipant.run(threadId, participantId);
      insertRead.run(
        threadId,
        participantId,
        participantId === data.createdBy ? now : null,
      );
    }

    return this.findThreadByIdForUser(threadId, data.createdBy);
  }

  async createThreadAsync(data: CreateThreadDto): Promise<MessageThread> {
    if (env.dbClient === 'postgres') {
      const participantIds = Array.from(
        new Set([data.createdBy, ...data.participantIds]),
      );
      if (participantIds.length !== 2) {
        throw AppError.badRequest(
          'Direct messages must include exactly one other participant',
        );
      }

      const existingThreadId = await this.findExistingDirectThreadIdAsync(
        participantIds,
      );
      if (existingThreadId != null) {
        return this.findThreadByIdForUserAsync(existingThreadId, data.createdBy);
      }

      const participantUsers = await Promise.all(
        participantIds.map((id) => this.usersRepo.findByIdAsync(id)),
      );
      const title = participantUsers.map((user) => user.name).join(', ');

      const now = new Date().toISOString();
      const threadResult = await getPostgresPool().query<{ id: number }>(
        `INSERT INTO message_threads (title, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [title, data.createdBy, now, now],
      );
      const threadId = threadResult.rows[0].id;

      for (const participantId of participantIds) {
        await getPostgresPool().query(
          `INSERT INTO thread_participants (thread_id, user_id) VALUES ($1, $2)`,
          [threadId, participantId],
        );
        await getPostgresPool().query(
          `INSERT INTO thread_reads (thread_id, user_id, last_read_at)
           VALUES ($1, $2, $3)`,
          [threadId, participantId, participantId === data.createdBy ? now : null],
        );
      }

      return this.findThreadByIdForUserAsync(threadId, data.createdBy);
    }
    return this.createThread(data);
  }

  findMessagesByThread(threadId: number, userId: number): Message[] {
    this.findThreadByIdForUser(threadId, userId);
    const rows = getDb()
      .prepare(
        'SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC',
      )
      .all(threadId) as MessageRow[];
    return rows.map(rowToMessage);
  }

  async findMessagesByThreadAsync(
    threadId: number,
    userId: number,
  ): Promise<Message[]> {
    if (env.dbClient === 'postgres') {
      await this.findThreadByIdForUserAsync(threadId, userId);
      const result = await getPostgresPool().query<MessageRow>(
        'SELECT * FROM messages WHERE thread_id = $1 ORDER BY created_at ASC',
        [threadId],
      );
      return result.rows.map(rowToMessage);
    }
    return this.findMessagesByThread(threadId, userId);
  }

  createMessage(threadId: number, userId: number, data: CreateMessageDto): Message {
    this.findThreadByIdForUser(threadId, userId);
    const user = this.usersRepo.findById(userId);
    const now = new Date().toISOString();
    const result = getDb()
      .prepare(
        `INSERT INTO messages (thread_id, sender_id, sender_name, body)
         VALUES (?, ?, ?, ?)`,
      )
      .run(threadId, user.id, user.name, data.body);

    getDb()
      .prepare(`UPDATE message_threads SET updated_at = ? WHERE id = ?`)
      .run(now, threadId);
    getDb()
      .prepare(
        `INSERT INTO thread_reads (thread_id, user_id, last_read_at)
         VALUES (?, ?, ?)
         ON CONFLICT(thread_id, user_id)
         DO UPDATE SET last_read_at = excluded.last_read_at`,
      )
      .run(threadId, userId, now);

    const row = getDb()
      .prepare('SELECT * FROM messages WHERE id = ?')
      .get(result.lastInsertRowid as number) as MessageRow;
    return rowToMessage(row);
  }

  async createMessageAsync(
    threadId: number,
    userId: number,
    data: CreateMessageDto,
  ): Promise<Message> {
    if (env.dbClient === 'postgres') {
      await this.findThreadByIdForUserAsync(threadId, userId);
      const user = await this.usersRepo.findByIdAsync(userId);
      const now = new Date().toISOString();
      const result = await getPostgresPool().query<MessageRow>(
        `INSERT INTO messages (thread_id, sender_id, sender_name, body, created_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [threadId, user.id, user.name, data.body, now],
      );

      await getPostgresPool().query(
        `UPDATE message_threads SET updated_at = $1 WHERE id = $2`,
        [now, threadId],
      );
      await getPostgresPool().query(
        `INSERT INTO thread_reads (thread_id, user_id, last_read_at)
         VALUES ($1, $2, $3)
         ON CONFLICT(thread_id, user_id)
         DO UPDATE SET last_read_at = excluded.last_read_at`,
        [threadId, userId, now],
      );

      return rowToMessage(result.rows[0]);
    }
    return this.createMessage(threadId, userId, data);
  }

  sendDirectMessage(senderUserId: number, recipientUserId: number, body: string): Message {
    const thread = this.createThread({
      createdBy: senderUserId,
      participantIds: [recipientUserId],
    });
    return this.createMessage(thread.id, senderUserId, { body });
  }

  async sendDirectMessageAsync(
    senderUserId: number,
    recipientUserId: number,
    body: string,
  ): Promise<Message> {
    if (env.dbClient === 'postgres') {
      const thread = await this.createThreadAsync({
        createdBy: senderUserId,
        participantIds: [recipientUserId],
      });
      return this.createMessageAsync(thread.id, senderUserId, { body });
    }
    return this.sendDirectMessage(senderUserId, recipientUserId, body);
  }

  markThreadRead(threadId: number, userId: number): void {
    this.findThreadByIdForUser(threadId, userId);
    getDb()
      .prepare(
        `INSERT INTO thread_reads (thread_id, user_id, last_read_at)
         VALUES (?, ?, ?)
         ON CONFLICT(thread_id, user_id)
         DO UPDATE SET last_read_at = excluded.last_read_at`,
      )
      .run(threadId, userId, new Date().toISOString());
  }

  async markThreadReadAsync(threadId: number, userId: number): Promise<void> {
    if (env.dbClient === 'postgres') {
      await this.findThreadByIdForUserAsync(threadId, userId);
      await getPostgresPool().query(
        `INSERT INTO thread_reads (thread_id, user_id, last_read_at)
         VALUES ($1, $2, $3)
         ON CONFLICT(thread_id, user_id)
         DO UPDATE SET last_read_at = excluded.last_read_at`,
        [threadId, userId, new Date().toISOString()],
      );
      return;
    }
    this.markThreadRead(threadId, userId);
  }

  markThreadUnread(threadId: number, userId: number): void {
    this.findThreadByIdForUser(threadId, userId);
    getDb()
      .prepare(
        `INSERT INTO thread_reads (thread_id, user_id, last_read_at)
         VALUES (?, ?, NULL)
         ON CONFLICT(thread_id, user_id)
         DO UPDATE SET last_read_at = NULL`,
      )
      .run(threadId, userId);
  }

  async markThreadUnreadAsync(threadId: number, userId: number): Promise<void> {
    if (env.dbClient === 'postgres') {
      await this.findThreadByIdForUserAsync(threadId, userId);
      await getPostgresPool().query(
        `INSERT INTO thread_reads (thread_id, user_id, last_read_at)
         VALUES ($1, $2, NULL)
         ON CONFLICT(thread_id, user_id)
         DO UPDATE SET last_read_at = NULL`,
        [threadId, userId],
      );
      return;
    }
    this.markThreadUnread(threadId, userId);
  }
}
