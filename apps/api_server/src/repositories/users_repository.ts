import { env } from '../config/env';
import { getPostgresPool } from '../database/db';
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
  is_facilities_manager: number;
  created_at: string;
  updated_at: string;
}

function rowToUser(row: UserRow): User {
  const isFacilitiesManager =
    typeof row.is_facilities_manager === 'boolean'
      ? row.is_facilities_manager
      : row.is_facilities_manager === 1;

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    googleSub: row.google_sub,
    photoUrl: row.photo_url,
    role: row.role,
    isFacilitiesManager,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class UsersRepository {
  static readonly systemBotEmail = 'rhythm-bot@rhythm.local';

  async findAllAsync(): Promise<User[]> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<UserRow>(
        'SELECT * FROM users ORDER BY created_at ASC',
      );
      return result.rows.map(rowToUser);
    }

    return this.findAll();
  }

  findAll(): User[] {
    const rows = getDb()
      .prepare('SELECT * FROM users ORDER BY created_at ASC')
      .all() as UserRow[];
    return rows.map(rowToUser);
  }

  async findByIdAsync(id: number): Promise<User> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<UserRow>(
        'SELECT * FROM users WHERE id = $1',
        [id],
      );
      const row = result.rows[0];
      if (!row) throw AppError.notFound('User');
      return rowToUser(row);
    }

    return this.findById(id);
  }

  findById(id: number): User {
    const row = getDb()
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(id) as UserRow | undefined;
    if (!row) throw AppError.notFound('User');
    return rowToUser(row);
  }

  async findByEmailAsync(email: string): Promise<User | null> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<UserRow>(
        'SELECT * FROM users WHERE lower(email) = lower($1)',
        [email],
      );
      const row = result.rows[0];
      return row ? rowToUser(row) : null;
    }

    return this.findByEmail(email);
  }

  findByEmail(email: string): User | null {
    const row = getDb()
      .prepare('SELECT * FROM users WHERE lower(email) = lower(?)')
      .get(email) as UserRow | undefined;
    return row ? rowToUser(row) : null;
  }

  async findByGoogleSubAsync(googleSub: string): Promise<User | null> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<UserRow>(
        'SELECT * FROM users WHERE google_sub = $1',
        [googleSub],
      );
      const row = result.rows[0];
      return row ? rowToUser(row) : null;
    }

    return this.findByGoogleSub(googleSub);
  }

  findByGoogleSub(googleSub: string): User | null {
    const row = getDb()
      .prepare('SELECT * FROM users WHERE google_sub = ?')
      .get(googleSub) as UserRow | undefined;
    return row ? rowToUser(row) : null;
  }

  async createAsync(data: CreateUserDto): Promise<User> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<UserRow>(
        `INSERT INTO users (name, email, google_sub, photo_url, role, is_facilities_manager)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          data.name,
          data.email,
          data.googleSub ?? null,
          data.photoUrl ?? null,
          data.role ?? 'member',
          data.isFacilitiesManager ?? false,
        ],
      );
      return rowToUser(result.rows[0]);
    }

    return this.create(data);
  }

  create(data: CreateUserDto): User {
    const result = getDb()
      .prepare(
        `INSERT INTO users (name, email, google_sub, photo_url, role, is_facilities_manager) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.name,
        data.email,
        data.googleSub ?? null,
        data.photoUrl ?? null,
        data.role ?? 'member',
        data.isFacilitiesManager ? 1 : 0,
      );
    return this.findById(result.lastInsertRowid as number);
  }

  async updateAsync(id: number, data: UpdateUserDto): Promise<User> {
    if (env.dbClient === 'postgres') {
      const existing = await this.findByIdAsync(id);
      const now = new Date().toISOString();
      const result = await getPostgresPool().query<UserRow>(
        `UPDATE users
            SET name = $1,
                email = $2,
                google_sub = $3,
                photo_url = $4,
                role = $5,
                is_facilities_manager = $6,
                updated_at = $7
          WHERE id = $8
          RETURNING *`,
        [
          data.name ?? existing.name,
          data.email ?? existing.email,
          data.googleSub ?? existing.googleSub,
          data.photoUrl !== undefined ? data.photoUrl : existing.photoUrl,
          data.role ?? existing.role,
          data.isFacilitiesManager !== undefined
            ? data.isFacilitiesManager
            : existing.isFacilitiesManager,
          now,
          id,
        ],
      );
      return rowToUser(result.rows[0]);
    }

    return this.update(id, data);
  }

  update(id: number, data: UpdateUserDto): User {
    const existing = this.findById(id);
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE users SET name = ?, email = ?, google_sub = ?, photo_url = ?, role = ?, is_facilities_manager = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        data.name ?? existing.name,
        data.email ?? existing.email,
        data.googleSub ?? existing.googleSub,
        data.photoUrl !== undefined ? data.photoUrl : existing.photoUrl,
        data.role ?? existing.role,
        data.isFacilitiesManager !== undefined
            ? (data.isFacilitiesManager ? 1 : 0)
            : (existing.isFacilitiesManager ? 1 : 0),
        now,
        id,
      );
    return this.findById(id);
  }

  async upsertGoogleUserAsync(data: {
    googleSub: string;
    email: string;
    name: string;
    photoUrl?: string | null;
  }): Promise<User> {
    const existingBySub = await this.findByGoogleSubAsync(data.googleSub);
    if (existingBySub) {
      return this.updateAsync(existingBySub.id, {
        name: data.name,
        email: data.email,
        googleSub: data.googleSub,
        photoUrl: data.photoUrl ?? null,
      });
    }

    const existingByEmail = await this.findByEmailAsync(data.email);
    if (existingByEmail) {
      return this.updateAsync(existingByEmail.id, {
        name: data.name,
        email: data.email,
        googleSub: data.googleSub,
        photoUrl: data.photoUrl ?? null,
      });
    }

    return this.createAsync({
      name: data.name,
      email: data.email,
      googleSub: data.googleSub,
      photoUrl: data.photoUrl ?? null,
    });
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

  async findOrCreateSystemBotAsync(): Promise<User> {
    const existing = await this.findByEmailAsync(UsersRepository.systemBotEmail);
    if (existing != null) {
      if (existing.name == 'Rhythm Bot' && existing.role == 'system') {
        return existing;
      }
      return this.updateAsync(existing.id, {
        name: 'Rhythm Bot',
        role: 'system',
      });
    }

    return this.createAsync({
      name: 'Rhythm Bot',
      email: UsersRepository.systemBotEmail,
      photoUrl: null,
      role: 'system',
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
