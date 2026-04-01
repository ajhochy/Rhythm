import { getDb } from '../database/db';
import { AppError } from '../errors/app_error';
import type { CreateUserDto, UpdateUserDto, User } from '../models/user';

interface UserRow {
  id: number;
  name: string;
  email: string;
  google_sub: string | null;
  role: string;
  created_at: string;
  updated_at: string;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    googleSub: row.google_sub,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class UsersRepository {
  findAll(): User[] {
    const rows = getDb()
      .prepare('SELECT * FROM users ORDER BY created_at ASC')
      .all() as UserRow[];
    return rows.map(rowToUser);
  }

  findById(id: number): User {
    const row = getDb()
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(id) as UserRow | undefined;
    if (!row) throw AppError.notFound('User');
    return rowToUser(row);
  }

  findByEmail(email: string): User | null {
    const row = getDb()
      .prepare('SELECT * FROM users WHERE lower(email) = lower(?)')
      .get(email) as UserRow | undefined;
    return row ? rowToUser(row) : null;
  }

  findByGoogleSub(googleSub: string): User | null {
    const row = getDb()
      .prepare('SELECT * FROM users WHERE google_sub = ?')
      .get(googleSub) as UserRow | undefined;
    return row ? rowToUser(row) : null;
  }

  create(data: CreateUserDto): User {
    const result = getDb()
      .prepare(
        `INSERT INTO users (name, email, google_sub, role) VALUES (?, ?, ?, ?)`,
      )
      .run(data.name, data.email, data.googleSub ?? null, data.role ?? 'member');
    return this.findById(result.lastInsertRowid as number);
  }

  update(id: number, data: UpdateUserDto): User {
    const existing = this.findById(id);
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE users SET name = ?, email = ?, google_sub = ?, role = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        data.name ?? existing.name,
        data.email ?? existing.email,
        data.googleSub ?? existing.googleSub,
        data.role ?? existing.role,
        now,
        id,
      );
    return this.findById(id);
  }

  upsertGoogleUser(data: {
    googleSub: string;
    email: string;
    name: string;
  }): User {
    const existingBySub = this.findByGoogleSub(data.googleSub);
    if (existingBySub) {
      return this.update(existingBySub.id, {
        name: data.name,
        email: data.email,
        googleSub: data.googleSub,
      });
    }

    const existingByEmail = this.findByEmail(data.email);
    if (existingByEmail) {
      return this.update(existingByEmail.id, {
        name: data.name,
        email: data.email,
        googleSub: data.googleSub,
      });
    }

    return this.create({
      name: data.name,
      email: data.email,
      googleSub: data.googleSub,
    });
  }
}
