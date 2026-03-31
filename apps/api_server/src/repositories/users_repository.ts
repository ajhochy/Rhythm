import { getDb } from '../database/db';
import { AppError } from '../errors/app_error';
import type { CreateUserDto, UpdateUserDto, User } from '../models/user';

interface UserRow {
  id: number;
  name: string;
  email: string;
  role: string;
  created_at: string;
  updated_at: string;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
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

  create(data: CreateUserDto): User {
    const result = getDb()
      .prepare(
        `INSERT INTO users (name, email, role) VALUES (?, ?, ?)`,
      )
      .run(data.name, data.email, data.role ?? 'member');
    return this.findById(result.lastInsertRowid as number);
  }

  update(id: number, data: UpdateUserDto): User {
    const existing = this.findById(id);
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE users SET name = ?, email = ?, role = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        data.name ?? existing.name,
        data.email ?? existing.email,
        data.role ?? existing.role,
        now,
        id,
      );
    return this.findById(id);
  }
}
