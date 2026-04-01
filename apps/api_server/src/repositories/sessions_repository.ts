import { randomUUID } from 'crypto';
import { getDb } from '../database/db';
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

export class SessionsRepository {
  private readonly usersRepo = new UsersRepository();

  create(userId: number): Session {
    const token = randomUUID();
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO sessions (token, user_id, created_at, expires_at)
         VALUES (?, ?, ?, NULL)`,
      )
      .run(token, userId, now);
    return this.findByToken(token)!;
  }

  findByToken(token: string): Session | null {
    const row = getDb()
      .prepare('SELECT * FROM sessions WHERE token = ?')
      .get(token) as SessionRow | undefined;
    return row ? rowToSession(row) : null;
  }

  findUserByToken(token: string): User | null {
    const session = this.findByToken(token);
    if (!session) return null;
    return this.usersRepo.findById(session.userId);
  }

  delete(token: string): void {
    getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
}
