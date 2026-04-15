import { env } from '../config/env';
import { getDb, getPostgresPool } from '../database/db';
import type { InsertNotificationDto, Notification } from '../models/notification';

interface NotificationRow {
  id: number;
  recipient_user_id?: number;
  recipientUserId?: number;
  type: string;
  entity_type?: string;
  entityType?: string;
  entity_id?: string;
  entityId?: string;
  message: string;
  read_at?: string | null;
  readAt?: string | null;
  created_at?: string;
  createdAt?: string;
}

function rowToNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    recipientUserId: (row.recipient_user_id ?? row.recipientUserId) as number,
    type: row.type as Notification['type'],
    entityType: (row.entity_type ?? row.entityType) as Notification['entityType'],
    entityId: (row.entity_id ?? row.entityId) as string,
    message: row.message,
    readAt: row.read_at ?? row.readAt ?? null,
    createdAt: (row.created_at ?? row.createdAt) as string,
  };
}

export class NotificationsRepository {
  async insertAsync(dto: InsertNotificationDto): Promise<void> {
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        `INSERT INTO notifications (recipient_user_id, type, entity_type, entity_id, message)
         VALUES ($1, $2, $3, $4, $5)`,
        [dto.recipientUserId, dto.type, dto.entityType, dto.entityId, dto.message],
      );
      return;
    }
    this.insert(dto);
  }

  insert(dto: InsertNotificationDto): void {
    getDb()
      .prepare(
        `INSERT INTO notifications (recipient_user_id, type, entity_type, entity_id, message)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(dto.recipientUserId, dto.type, dto.entityType, dto.entityId, dto.message);
  }

  async listUnreadAsync(userId: number): Promise<Notification[]> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<NotificationRow>(
        `SELECT * FROM notifications
         WHERE recipient_user_id = $1 AND read_at IS NULL
         ORDER BY created_at DESC`,
        [userId],
      );
      return result.rows.map(rowToNotification);
    }
    return this.listUnread(userId);
  }

  listUnread(userId: number): Notification[] {
    const rows = getDb()
      .prepare(
        `SELECT * FROM notifications
         WHERE recipient_user_id = ? AND read_at IS NULL
         ORDER BY created_at DESC`,
      )
      .all(userId) as NotificationRow[];
    return rows.map(rowToNotification);
  }

  async markReadAsync(id: number, userId: number): Promise<void> {
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        `UPDATE notifications SET read_at = NOW()
         WHERE id = $1 AND recipient_user_id = $2`,
        [id, userId],
      );
      return;
    }
    this.markRead(id, userId);
  }

  markRead(id: number, userId: number): void {
    getDb()
      .prepare(
        `UPDATE notifications SET read_at = datetime('now')
         WHERE id = ? AND recipient_user_id = ?`,
      )
      .run(id, userId);
  }

  async markAllReadAsync(userId: number): Promise<void> {
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        `UPDATE notifications SET read_at = NOW()
         WHERE recipient_user_id = $1 AND read_at IS NULL`,
        [userId],
      );
      return;
    }
    this.markAllRead(userId);
  }

  markAllRead(userId: number): void {
    getDb()
      .prepare(
        `UPDATE notifications SET read_at = datetime('now')
         WHERE recipient_user_id = ? AND read_at IS NULL`,
      )
      .run(userId);
  }
}
