/**
 * #1138 follow-up — legacy numbered-key corePermissionsJson repair.
 *
 * ~14 seeded agent_configs rows in real local DBs carry the old Tool
 * Permissions panel's indexed-list shape
 * ({"0":{"permission":"*","pattern":"*","action":"allow"},...}). The
 * projector skips those entries (fail-soft, #1149), so the permissions were
 * silently never applied. These tests cover the shared converter and the
 * one-time (runOnce/schema_meta-guarded) SQLite migration.
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { convertLegacyNumberedCorePermissions } from '../database/core_permissions_repair';
import { runMigrations } from '../database/migrations';

const MARKER = 'numbered_core_permissions_repair_v1';

/** The exact real-world seeded shape from #1138. */
const REAL_WORLD_LEGACY = JSON.stringify({
  '0': { permission: '*', pattern: '*', action: 'allow' },
  '1': { permission: 'doom_loop', pattern: '*', action: 'ask' },
  '2': { permission: 'external_directory', pattern: '*', action: 'ask' },
});

/** A flat, hand-repaired librarian-style row that must never be touched. */
const FLAT_LIBRARIAN = JSON.stringify({
  read: 'allow',
  bash: { '*': 'ask', 'git status*': 'allow', 'rm -rf*': 'deny' },
});

describe('convertLegacyNumberedCorePermissions', () => {
  it('converts the exact real-world seeded shape to the flat map', () => {
    expect(JSON.parse(convertLegacyNumberedCorePermissions(REAL_WORLD_LEGACY)!)).toEqual({
      '*': 'allow',
      doom_loop: 'ask',
      external_directory: 'ask',
    });
  });

  it('collapses a single "*" pattern to a plain action string, keeps others as pattern maps', () => {
    const raw = JSON.stringify({
      '0': { permission: 'read', pattern: '*', action: 'allow' },
      '1': { permission: 'bash', pattern: 'git push*', action: 'deny' },
    });
    expect(JSON.parse(convertLegacyNumberedCorePermissions(raw)!)).toEqual({
      read: 'allow',
      bash: { 'git push*': 'deny' },
    });
  });

  it('builds a pattern map for mixed patterns on the same permission', () => {
    const raw = JSON.stringify({
      '0': { permission: 'bash', pattern: '*', action: 'allow' },
      '1': { permission: 'bash', pattern: 'git push*', action: 'deny' },
    });
    expect(JSON.parse(convertLegacyNumberedCorePermissions(raw)!)).toEqual({
      bash: { '*': 'allow', 'git push*': 'deny' },
    });
  });

  it('defaults a missing pattern to "*"', () => {
    const raw = JSON.stringify({ '0': { permission: 'edit', action: 'ask' } });
    expect(JSON.parse(convertLegacyNumberedCorePermissions(raw)!)).toEqual({ edit: 'ask' });
  });

  it('merges duplicate perm+pattern pairs, last write wins', () => {
    const raw = JSON.stringify({
      '0': { permission: 'bash', pattern: '*', action: 'allow' },
      '1': { permission: 'bash', pattern: '*', action: 'deny' },
    });
    expect(JSON.parse(convertLegacyNumberedCorePermissions(raw)!)).toEqual({ bash: 'deny' });
  });

  it('skips entries with invalid actions but keeps valid siblings', () => {
    const raw = JSON.stringify({
      '0': { permission: 'read', pattern: '*', action: 'allow' },
      '1': { permission: 'bash', pattern: '*', action: 'yolo' },
      '2': { permission: '   ', pattern: '*', action: 'allow' },
    });
    expect(JSON.parse(convertLegacyNumberedCorePermissions(raw)!)).toEqual({ read: 'allow' });
  });

  it('returns null when every entry is invalid (row cleared to NULL)', () => {
    const raw = JSON.stringify({
      '0': { permission: 'bash', pattern: '*', action: 'maybe' },
      '1': { permission: '', pattern: '*', action: 'allow' },
    });
    expect(convertLegacyNumberedCorePermissions(raw)).toBeNull();
  });

  it('leaves flat rows, garbage JSON, arrays, empties, and mixed-key maps untouched', () => {
    expect(convertLegacyNumberedCorePermissions(FLAT_LIBRARIAN)).toBeUndefined();
    expect(convertLegacyNumberedCorePermissions('{not json')).toBeUndefined();
    expect(convertLegacyNumberedCorePermissions('[]')).toBeUndefined();
    expect(convertLegacyNumberedCorePermissions('{}')).toBeUndefined();
    expect(convertLegacyNumberedCorePermissions(null)).toBeUndefined();
    expect(convertLegacyNumberedCorePermissions('"allow"')).toBeUndefined();
    // one non-digit key → not the legacy shape
    expect(
      convertLegacyNumberedCorePermissions(
        JSON.stringify({
          '0': { permission: 'read', action: 'allow' },
          bash: 'allow',
        }),
      ),
    ).toBeUndefined();
    // numbered keys but values not entry-shaped → not the legacy shape
    expect(
      convertLegacyNumberedCorePermissions(JSON.stringify({ '0': 'allow' })),
    ).toBeUndefined();
  });
});

describe('numbered_core_permissions_repair_v1 migration', () => {
  function makeLegacyDb() {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    // Simulate upgrading a pre-marker install: bad rows already present, the
    // repair marker not yet consumed (same technique as agent_configs.test.ts).
    db.prepare(
      `INSERT INTO agent_configs (id, label, icon, command, is_agent, core_permissions_json)
       VALUES (?, ?, '', '', 1, ?)`,
    ).run('build', 'Build', REAL_WORLD_LEGACY);
    db.prepare(
      `INSERT INTO agent_configs (id, label, icon, command, is_agent, core_permissions_json)
       VALUES (?, ?, '', '', 1, ?)`,
    ).run('librarian', 'Librarian', FLAT_LIBRARIAN);
    db.prepare(`DELETE FROM schema_meta WHERE key = ?`).run(MARKER);
    return db;
  }

  const getPerms = (db: Database.Database, id: string): string | null =>
    (
      db
        .prepare(`SELECT core_permissions_json AS v FROM agent_configs WHERE id = ?`)
        .get(id) as { v: string | null }
    ).v;

  it('repairs legacy rows exactly once and records the marker', () => {
    const db = makeLegacyDb();
    runMigrations(db);

    expect(JSON.parse(getPerms(db, 'build')!)).toEqual({
      '*': 'allow',
      doom_loop: 'ask',
      external_directory: 'ask',
    });
    expect(
      db.prepare(`SELECT key FROM schema_meta WHERE key = ?`).get(MARKER),
    ).toBeTruthy();
  });

  it('leaves a flat/hand-repaired row byte-for-byte untouched', () => {
    const db = makeLegacyDb();
    runMigrations(db);
    expect(getPerms(db, 'librarian')).toBe(FLAT_LIBRARIAN);
  });

  it('is idempotent: a replay never re-transforms rows (marker consumed)', () => {
    const db = makeLegacyDb();
    runMigrations(db);
    // User hand-edits the row back into the legacy shape after the repair —
    // the next boots must NOT re-transform it.
    db.prepare(`UPDATE agent_configs SET core_permissions_json = ? WHERE id = 'build'`).run(
      REAL_WORLD_LEGACY,
    );
    runMigrations(db);
    runMigrations(db);
    expect(getPerms(db, 'build')).toBe(REAL_WORLD_LEGACY);
  });
});
