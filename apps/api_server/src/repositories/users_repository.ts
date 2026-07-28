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
  email_notifications_enabled: number | boolean;
  timezone: string;
  created_at: string;
  updated_at: string;
}

function rowToUser(row: UserRow): User {
  const isFacilitiesManager =
    typeof row.is_facilities_manager === 'boolean'
      ? row.is_facilities_manager
      : row.is_facilities_manager === 1;

  const emailNotificationsEnabled =
    typeof row.email_notifications_enabled === 'boolean'
      ? row.email_notifications_enabled
      : row.email_notifications_enabled === 1;

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    googleSub: row.google_sub,
    photoUrl: row.photo_url,
    role: row.role,
    isFacilitiesManager,
    emailNotificationsEnabled,
    timezone: row.timezone ?? 'America/Los_Angeles',
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

  async bindGoogleIdentityByEmailAsync(
    email: string,
    googleSub: string,
  ): Promise<User | null> {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedSub = googleSub.trim();
    if (!normalizedEmail || !normalizedSub) return null;
    if (env.dbClient === 'postgres') {
      try {
        const result = await getPostgresPool().query<UserRow>(
          `UPDATE users
              SET google_sub = $1, updated_at = $2
            WHERE lower(email) = lower($3)
              AND google_sub IS NULL
          RETURNING *`,
          [normalizedSub, new Date().toISOString(), normalizedEmail],
        );
        if (result.rows[0]) return rowToUser(result.rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code !== '23505') throw error;
      }
      const [bySubject, byEmail] = await Promise.all([
        this.findByGoogleSubAsync(normalizedSub),
        this.findByEmailAsync(normalizedEmail),
      ]);
      return bySubject &&
        byEmail &&
        bySubject.id === byEmail.id &&
        byEmail.googleSub === normalizedSub
        ? bySubject
        : null;
    }

    try {
      const result = getDb()
        .prepare(
          `UPDATE users
              SET google_sub = ?, updated_at = ?
            WHERE lower(email) = lower(?)
              AND google_sub IS NULL`,
        )
        .run(normalizedSub, new Date().toISOString(), normalizedEmail);
      if (result.changes === 1) return this.findByGoogleSub(normalizedSub);
    } catch (error) {
      if (
        !(error as { code?: string }).code?.startsWith('SQLITE_CONSTRAINT')
      ) {
        throw error;
      }
    }
    const bySubject = this.findByGoogleSub(normalizedSub);
    const byEmail = this.findByEmail(normalizedEmail);
    return bySubject &&
      byEmail &&
      bySubject.id === byEmail.id &&
      byEmail.googleSub === normalizedSub
      ? bySubject
      : null;
  }

  async createAsync(data: CreateUserDto): Promise<User> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<UserRow>(
        `INSERT INTO users (name, email, google_sub, photo_url, role, is_facilities_manager, email_notifications_enabled, timezone)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          data.name,
          data.email,
          data.googleSub ?? null,
          data.photoUrl ?? null,
          data.role ?? 'member',
          data.isFacilitiesManager ?? false,
          data.emailNotificationsEnabled ?? true,
          data.timezone ?? 'America/Los_Angeles',
        ],
      );
      return rowToUser(result.rows[0]);
    }

    return this.create(data);
  }

  create(data: CreateUserDto): User {
    const result = getDb()
      .prepare(
        `INSERT INTO users (name, email, google_sub, photo_url, role, is_facilities_manager, email_notifications_enabled, timezone) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.name,
        data.email,
        data.googleSub ?? null,
        data.photoUrl ?? null,
        data.role ?? 'member',
        data.isFacilitiesManager ? 1 : 0,
        (data.emailNotificationsEnabled ?? true) ? 1 : 0,
        data.timezone ?? 'America/Los_Angeles',
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
                email_notifications_enabled = $7,
                timezone = $8,
                updated_at = $9
          WHERE id = $10
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
          data.emailNotificationsEnabled !== undefined
            ? data.emailNotificationsEnabled
            : existing.emailNotificationsEnabled,
          data.timezone ?? existing.timezone,
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
        `UPDATE users SET name = ?, email = ?, google_sub = ?, photo_url = ?, role = ?, is_facilities_manager = ?, email_notifications_enabled = ?, timezone = ?, updated_at = ? WHERE id = ?`,
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
        data.emailNotificationsEnabled !== undefined
            ? (data.emailNotificationsEnabled ? 1 : 0)
            : (existing.emailNotificationsEnabled ? 1 : 0),
        data.timezone ?? existing.timezone,
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
      if (existingBySub.email.toLowerCase() !== data.email.trim().toLowerCase()) {
        throw AppError.conflict('Google identity is already bound to another email');
      }
      return this.updateAsync(existingBySub.id, {
        name: data.name,
        photoUrl: data.photoUrl ?? existingBySub.photoUrl,
      });
    }

    const existingByEmail = await this.findByEmailAsync(data.email);
    if (existingByEmail) {
      if (
        existingByEmail.googleSub &&
        existingByEmail.googleSub !== data.googleSub
      ) {
        throw AppError.conflict('Email is already bound to another Google identity');
      }
      const bound = existingByEmail.googleSub
        ? existingByEmail
        : await this.bindGoogleIdentityByEmailAsync(data.email, data.googleSub);
      if (!bound) {
        throw AppError.conflict('Google identity binding changed concurrently');
      }
      return this.updateAsync(bound.id, {
        name: data.name,
        photoUrl: data.photoUrl ?? bound.photoUrl,
      });
    }

    try {
      return await this.createAsync({
        name: data.name,
        email: data.email,
        googleSub: data.googleSub,
        photoUrl: data.photoUrl ?? null,
      });
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      if (code !== '23505' && !code.startsWith('SQLITE_CONSTRAINT')) throw error;
      const winner = await this.findByGoogleSubAsync(data.googleSub);
      if (
        winner &&
        winner.email.toLowerCase() === data.email.trim().toLowerCase()
      ) {
        return winner;
      }
      throw AppError.conflict('Google identity binding changed concurrently');
    }
  }

  upsertGoogleUser(data: {
    googleSub: string;
    email: string;
    name: string;
    photoUrl?: string | null;
  }): User {
    const existingBySub = this.findByGoogleSub(data.googleSub);
    if (existingBySub) {
      if (existingBySub.email.toLowerCase() !== data.email.trim().toLowerCase()) {
        throw AppError.conflict('Google identity is already bound to another email');
      }
      return this.update(existingBySub.id, {
        name: data.name,
        photoUrl: data.photoUrl ?? existingBySub.photoUrl,
      });
    }

    const existingByEmail = this.findByEmail(data.email);
    if (existingByEmail) {
      if (
        existingByEmail.googleSub &&
        existingByEmail.googleSub !== data.googleSub
      ) {
        throw AppError.conflict('Email is already bound to another Google identity');
      }
      if (!existingByEmail.googleSub) {
        try {
          const result = getDb()
            .prepare(
              `UPDATE users
                  SET google_sub = ?, updated_at = ?
                WHERE id = ? AND google_sub IS NULL`,
            )
            .run(data.googleSub, new Date().toISOString(), existingByEmail.id);
          if (result.changes !== 1) {
            throw AppError.conflict('Google identity binding changed concurrently');
          }
        } catch (error) {
          if (error instanceof AppError) throw error;
          if (
            (error as { code?: string }).code?.startsWith('SQLITE_CONSTRAINT')
          ) {
            throw AppError.conflict('Google identity is already bound');
          }
          throw error;
        }
      }
      const bound = this.findByEmail(data.email);
      if (!bound || bound.googleSub !== data.googleSub) {
        throw AppError.conflict('Google identity binding changed concurrently');
      }
      return this.update(bound.id, {
        name: data.name,
        photoUrl: data.photoUrl ?? bound.photoUrl,
      });
    }

    try {
      return this.create({
        name: data.name,
        email: data.email,
        googleSub: data.googleSub,
        photoUrl: data.photoUrl ?? null,
      });
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      if (!code.startsWith('SQLITE_CONSTRAINT')) throw error;
      const winner = this.findByGoogleSub(data.googleSub);
      if (
        winner &&
        winner.email.toLowerCase() === data.email.trim().toLowerCase()
      ) {
        return winner;
      }
      throw AppError.conflict('Google identity binding changed concurrently');
    }
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
