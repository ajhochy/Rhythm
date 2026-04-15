import { randomUUID } from 'crypto';
import { env } from '../config/env';
import { getDb } from '../database/db';
import { getPostgresPool } from '../database/db';
import type { User } from '../models/user';
import { UsersRepository } from './users_repository';

interface SessionRow {
  token: string;
  user_id: number;
  created_at: string;
  expires_at: string | null;
}

export interface Session {
  token: string;
  userId: number;
  createdAt: string;
  expiresAt: string | null;
}

function rowToSession(row: SessionRow): Session {
  return {
    token: row.token,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

const DEFAULT_SESSION_EXPIRY_DAYS = 365;

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export class SessionsRepository {
  private readonly usersRepo = new UsersRepository();

  async createAsync(userId: number, expiresInDays = DEFAULT_SESSION_EXPIRY_DAYS): Promise<Session> {
    if (env.dbClient === 'postgres') {
      const token = randomUUID();
      const now = new Date().toISOString();
      const expiresAt = addDays(expiresInDays);
      const result = await getPostgresPool().query<SessionRow>(
        `INSERT INTO sessions (token, user_id, created_at, expires_at)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [token, userId, now, expiresAt],
      );
      return rowToSession(result.rows[0]);
    }

    return this.create(userId, expiresInDays);
  }

  create(userId: number, expiresInDays = DEFAULT_SESSION_EXPIRY_DAYS): Session {
    const token = randomUUID();
    const now = new Date().toISOString();
    const expiresAt = addDays(expiresInDays);
    getDb()
      .prepare(
        `INSERT INTO sessions (token, user_id, created_at, expires_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(token, userId, now, expiresAt);
    return this.findByToken(token)!;
  }

  async findByTokenAsync(token: string): Promise<Session | null> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<SessionRow>(
        `SELECT * FROM sessions
         WHERE token = $1
           AND (expires_at IS NULL OR expires_at::timestamptz > NOW())`,
        [token],
      );
      const row = result.rows[0];
      return row ? rowToSession(row) : null;
    }

    return this.findByToken(token);
  }

  findByToken(token: string): Session | null {
    const row = getDb()
      .prepare(
        `SELECT * FROM sessions
         WHERE token = ?
           AND (expires_at IS NULL OR expires_at > datetime('now'))`,
      )
      .get(token) as SessionRow | undefined;
    return row ? rowToSession(row) : null;
  }

  async findUserByTokenAsync(token: string): Promise<User | null> {
    const session = await this.findByTokenAsync(token);
    if (!session) return null;
    return this.usersRepo.findByIdAsync(session.userId);
  }

  findUserByToken(token: string): User | null {
    const session = this.findByToken(token);
    if (!session) return null;
    return this.usersRepo.findById(session.userId);
  }

  async deleteAsync(token: string): Promise<void> {
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query('DELETE FROM sessions WHERE token = $1', [
        token,
      ]);
      return;
    }

    this.delete(token);
  }

  delete(token: string): void {
    getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
}
