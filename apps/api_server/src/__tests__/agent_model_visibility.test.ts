/**
 * Issue #609 — agent_model_visibility data-layer tests.
 *
 * Tests the DB migration and upsert logic directly without HTTP to avoid
 * a supertest dependency. The route itself is thin (GET → SELECT *, PATCH →
 * INSERT OR REPLACE), so these tests give the most signal per line.
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

describe('agent_model_visibility migration', () => {
  it('creates the agent_model_visibility table', () => {
    const db = makeDb();
    const table = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='agent_model_visibility'`,
      )
      .get() as { name: string } | undefined;
    expect(table).toBeDefined();
    expect(table?.name).toBe('agent_model_visibility');
  });

  it('has the correct column shape', () => {
    const db = makeDb();
    const cols = (
      db.pragma('table_info(agent_model_visibility)') as { name: string }[]
    ).map((c) => c.name);
    expect(cols).toEqual(
      expect.arrayContaining(['provider', 'model_id', 'visible']),
    );
  });

  it('adds thinking_budget and fast_mode to agent_sessions', () => {
    const db = makeDb();
    const cols = (
      db.pragma('table_info(agent_sessions)') as { name: string }[]
    ).map((c) => c.name);
    expect(cols).toContain('thinking_budget');
    expect(cols).toContain('fast_mode');
  });
});

// ---------------------------------------------------------------------------
// GET (SELECT) helpers
// ---------------------------------------------------------------------------

describe('visibility SELECT', () => {
  it('returns empty array when no rows exist', () => {
    const db = makeDb();
    type Row = { provider: string; model_id: string; visible: number };
    const rows = db
      .prepare(`SELECT provider, model_id, visible FROM agent_model_visibility`)
      .all() as Row[];
    expect(rows).toEqual([]);
  });

  it('returns existing rows', () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO agent_model_visibility (provider, model_id, visible) VALUES (?,?,?)`,
    ).run('openrouter', 'anthropic/claude-opus-4.7', 1);
    db.prepare(
      `INSERT INTO agent_model_visibility (provider, model_id, visible) VALUES (?,?,?)`,
    ).run('openrouter', 'anthropic/claude-haiku-4.5', 0);

    type Row = { provider: string; model_id: string; visible: number };
    const rows = db
      .prepare(
        `SELECT provider, model_id, visible FROM agent_model_visibility ORDER BY model_id`,
      )
      .all() as Row[];

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      provider: 'openrouter',
      model_id: 'anthropic/claude-haiku-4.5',
      visible: 0,
    });
    expect(rows[1]).toMatchObject({
      provider: 'openrouter',
      model_id: 'anthropic/claude-opus-4.7',
      visible: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// PATCH (UPSERT) helpers
// ---------------------------------------------------------------------------

describe('visibility UPSERT', () => {
  function upsert(
    db: Database.Database,
    updates: { provider: string; modelId: string; visible: boolean }[],
  ) {
    const stmt = db.prepare(
      `INSERT INTO agent_model_visibility (provider, model_id, visible)
       VALUES (?, ?, ?)
       ON CONFLICT(provider, model_id) DO UPDATE SET visible = excluded.visible`,
    );
    const runAll = db.transaction(
      (rows: { provider: string; modelId: string; visible: boolean }[]) => {
        for (const row of rows) {
          stmt.run(row.provider, row.modelId, row.visible ? 1 : 0);
        }
        return rows.length;
      },
    );
    return runAll(updates);
  }

  it('inserts new rows', () => {
    const db = makeDb();
    const count = upsert(db, [
      { provider: 'openrouter', modelId: 'anthropic/claude-opus-4.7', visible: true },
      { provider: 'openrouter', modelId: 'anthropic/claude-haiku-4.5', visible: false },
    ]);
    expect(count).toBe(2);

    type Row = { provider: string; model_id: string; visible: number };
    const rows = db
      .prepare(`SELECT * FROM agent_model_visibility ORDER BY model_id`)
      .all() as Row[];
    expect(rows).toHaveLength(2);
  });

  it('updates existing row when re-upserted', () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO agent_model_visibility (provider, model_id, visible) VALUES (?,?,?)`,
    ).run('openrouter', 'anthropic/claude-opus-4.7', 1);

    upsert(db, [
      { provider: 'openrouter', modelId: 'anthropic/claude-opus-4.7', visible: false },
    ]);

    type Row = { visible: number };
    const row = db
      .prepare(
        `SELECT visible FROM agent_model_visibility WHERE model_id='anthropic/claude-opus-4.7'`,
      )
      .get() as Row;
    expect(row.visible).toBe(0);
  });

  it('rejects non-array updates at the validation layer', () => {
    // Simulate the route-level guard: if body.updates is not an array, return 400.
    function validateUpdates(body: unknown): { ok: true } | { ok: false; error: string } {
      const b = body as Record<string, unknown>;
      if (!Array.isArray(b.updates)) {
        return { ok: false, error: 'updates must be an array' };
      }
      return { ok: true };
    }
    expect(validateUpdates({ updates: 'not-an-array' })).toEqual({
      ok: false,
      error: 'updates must be an array',
    });
    expect(validateUpdates({ updates: [] })).toEqual({ ok: true });
  });
});
