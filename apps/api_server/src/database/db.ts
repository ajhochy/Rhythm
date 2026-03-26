import Database from 'better-sqlite3';
import { env } from '../config/env';
import { runMigrations } from './migrations';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return _db;
}

export function initDb(): void {
  _db = new Database(env.dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  runMigrations(_db);
}

/** For tests only — inject a pre-configured in-memory database instance. */
export function setDb(db: Database.Database): void {
  _db = db;
}
