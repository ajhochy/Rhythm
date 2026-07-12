/**
 * Durable seed markers (schema_meta) for boot-time seeds.
 *
 * Row-existence guards can't tell "never seeded" from "the user deleted the
 * seeded record" — so every boot resurrected records the user had removed.
 * These markers make seeding one-time per install: record the marker when the
 * seeded record is first created (or first observed, adopting existing
 * installs), and skip forever after — even when the record is later deleted.
 * A user's delete is a config edit like any other; it must survive restarts.
 *
 * SQLite-only, like every seed that uses it: on Postgres both functions
 * degrade to the pre-marker behavior (exists → false, record → no-op), so the
 * hosted API's behavior is unchanged.
 */
import { env } from '../config/env';
import { getDb } from '../database/db';

function metaDb() {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT)`);
  return db;
}

export function seedMarkerExists(key: string): boolean {
  if (env.dbClient === 'postgres') return false;
  return metaDb().prepare(`SELECT key FROM schema_meta WHERE key = ?`).get(key) !== undefined;
}

export function recordSeedMarker(key: string): void {
  if (env.dbClient === 'postgres') return;
  metaDb()
    .prepare(`INSERT OR IGNORE INTO schema_meta (key, value) VALUES (?, ?)`)
    .run(key, new Date().toISOString());
}
