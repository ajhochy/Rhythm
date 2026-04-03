import { getDb } from '../database/db';
import { AppError } from '../errors/app_error';
import type { CreateUserDto, UpdateUserDto, User } from '../models/user';

interface UserRow {
  id: number;
  name: string;
  email: string;
  google_sub: string | null;
  photo_url: string | null;
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
    photoUrl: row.photo_url,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class UsersRepository {
  static readonly systemBotEmail = 'rhythm-bot@rhythm.local';

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
        `INSERT INTO users (name, email, google_sub, photo_url, role) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        data.name,
        data.email,
        data.googleSub ?? null,
        data.photoUrl ?? null,
        data.role ?? 'member',
      );
    return this.findById(result.lastInsertRowid as number);
  }

  update(id: number, data: UpdateUserDto): User {
    const existing = this.findById(id);
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE users SET name = ?, email = ?, google_sub = ?, photo_url = ?, role = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        data.name ?? existing.name,
        data.email ?? existing.email,
        data.googleSub ?? existing.googleSub,
        data.photoUrl !== undefined ? data.photoUrl : existing.photoUrl,
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
    photoUrl?: string | null;
  }): User {
    const existingBySub = this.findByGoogleSub(data.googleSub);
    if (existingBySub) {
      return this.update(existingBySub.id, {
        name: data.name,
        email: data.email,
        googleSub: data.googleSub,
        photoUrl: data.photoUrl ?? null,
      });
    }

    const existingByEmail = this.findByEmail(data.email);
    if (existingByEmail) {
      return this.update(existingByEmail.id, {
        name: data.name,
        email: data.email,
        googleSub: data.googleSub,
        photoUrl: data.photoUrl ?? null,
      });
    }

    return this.create({
      name: data.name,
      email: data.email,
      googleSub: data.googleSub,
      photoUrl: data.photoUrl ?? null,
    });
  }

  findOrCreateSystemBot(): User {
    const existing = this.findByEmail(UsersRepository.systemBotEmail);
    if (existing != null) {
      if (existing.name == 'Rhythm Bot' && existing.role == 'system') {
        return existing;
      }
      return this.update(existing.id, {
        name: 'Rhythm Bot',
        role: 'system',
      });
    }

    return this.create({
      name: 'Rhythm Bot',
      email: UsersRepository.systemBotEmail,
      photoUrl: null,
      role: 'system',
    });
  }
}
