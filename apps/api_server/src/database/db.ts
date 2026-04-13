import Database from 'better-sqlite3';
import { Pool, type PoolConfig } from 'pg';
import { env } from '../config/env';
import { runMigrations } from './migrations';
import { runPostgresBootstrap } from './postgres_bootstrap';

let _db: Database.Database | null = null;
let _postgresPool: Pool | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return _db;
}

export function getPostgresPool(): Pool {
  if (!_postgresPool) {
    throw new Error('Postgres pool not initialized. Call initDb() first.');
  }
  return _postgresPool;
}

function createPostgresPool(): Pool {
  const config: PoolConfig = {
    host: env.dbHost,
    port: env.dbPort,
    database: env.dbName,
    user: env.dbUser,
    password: env.dbPassword,
  };

  if (env.dbSsl) {
    config.ssl = {
      rejectUnauthorized: false,
    };
  }

  return new Pool(config);
}

export async function initDb(): Promise<void> {
  if (env.dbClient === 'postgres') {
    _db = null;
    _postgresPool = createPostgresPool();

    try {
      await _postgresPool.query('SELECT 1');
      await runPostgresBootstrap(_postgresPool);
    } catch (error) {
      await _postgresPool.end().catch(() => undefined);
      _postgresPool = null;
      throw error;
    }
    return;
  }

  _postgresPool = null;
  _db = new Database(env.dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  runMigrations(_db);
}

/** For tests only — inject a pre-configured in-memory database instance. */
export function setDb(db: Database.Database): void {
  _db = db;
}
