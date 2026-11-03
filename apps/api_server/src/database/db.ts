import Database from 'better-sqlite3';
import { Pool, type PoolConfig } from 'pg';
import { env } from '../config/env';
import { runMigrations } from './migrations';
import { runPostgresBootstrap } from './postgres_bootstrap';
import { assertSafeNativeRuntime } from './native_runtime_guard';
import { GENERIC_ADMISSION_SQL_FUNCTION, genericAdmissionScalar } from '../utils/generic_memory_admission';

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

/**
 * Register the deterministic, pure SQLite scalars every normal and test handle
 * needs. Re-registering on a handle replaces the same function, so this is
 * idempotent. The scalar is the exact decoded generic-admission decision.
 */
function registerScalars(db: Database.Database): void {
  // Some suites hand setDb a partial stand-in; only a real handle can register.
  if (typeof db.function !== 'function') return;
  db.function(GENERIC_ADMISSION_SQL_FUNCTION, { deterministic: true }, genericAdmissionScalar);
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
  assertSafeNativeRuntime();
  _db = new Database(env.dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  registerScalars(_db);
  runMigrations(_db);
}

/** Swap the global SQLite handle; callers that temporarily replace it must restore the returned handle. */
export function setDb(db: Database.Database | null): Database.Database | null {
  const previous = _db;
  if (db) registerScalars(db);
  _db = db;
  return previous;
}
