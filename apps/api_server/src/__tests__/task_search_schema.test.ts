/**
 * Contract: task-search Tier 1+2 needs durable, additive full-text indexes.
 * Regression guarded: a migration that creates the FTS table without rebuilds
 * or sync triggers leaves legacy or changed tasks invisible to retrieval.
 */
import Database from 'better-sqlite3';
import type { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { runMigrations } from '../database/migrations';
import { runPostgresBootstrap } from '../database/postgres_bootstrap';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function makeLegacyTasksDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      source_type TEXT,
      source_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.prepare(`INSERT INTO tasks (id, title) VALUES (?, ?)`).run('existing-1', 'Sunday setup');
  db.prepare(`INSERT INTO tasks (id, title) VALUES (?, ?)`).run('existing-2', 'Legacy candles');
  return db;
}

function totalChanges(db: Database.Database): number {
  return (db.prepare(`SELECT total_changes() AS count`).get() as { count: number }).count;
}

describe('task-search schema contract', () => {
  it('indexes existing SQLite tasks and keeps title plus notes synchronized', () => {
    const db = makeLegacyTasksDb();

    // Regression: a post-migration insert exercises only triggers, not backfill.
    runMigrations(db);
    expect(
      db.prepare(`SELECT rowid FROM tasks_fts WHERE tasks_fts MATCH 'candles'`).all(),
    ).toEqual([{ rowid: 2 }]);

    db.prepare(`INSERT INTO tasks (id, title, notes) VALUES (?, ?, ?)`).run(
      'created',
      'Choir rehearsal',
      'Meet in sanctuary',
    );
    expect(
      db.prepare(`SELECT rowid FROM tasks_fts WHERE tasks_fts MATCH 'choir'`).all(),
    ).toEqual([{ rowid: 3 }]);

    db.prepare(`UPDATE tasks SET title = ?, notes = ? WHERE id = ?`).run(
      'Band rehearsal',
      'Bring charts',
      'created',
    );
    expect(
      db.prepare(`SELECT rowid FROM tasks_fts WHERE tasks_fts MATCH 'choir'`).all(),
    ).toEqual([]);
    expect(
      db.prepare(`SELECT rowid FROM tasks_fts WHERE tasks_fts MATCH 'charts'`).all(),
    ).toEqual([{ rowid: 3 }]);

    db.prepare(`DELETE FROM tasks WHERE id = ?`).run('created');
    expect(
      db.prepare(`SELECT rowid FROM tasks_fts WHERE tasks_fts MATCH 'charts'`).all(),
    ).toEqual([]);
  });

  it('replays task FTS setup without changing task content or duplicating triggers', () => {
    const db = makeDb();
    db.prepare(`INSERT INTO tasks (id, title, notes) VALUES (?, ?, ?)`).run(
      'keep',
      'Keep title',
      'Keep notes',
    );
    runMigrations(db);

    expect(db.prepare(`SELECT title, notes FROM tasks WHERE id = 'keep'`).get()).toEqual({
      title: 'Keep title',
      notes: 'Keep notes',
    });
    expect(
      db.prepare(`SELECT count(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'tasks_fts_%'`).get(),
    ).toEqual({ count: 3 });
    expect(
      db.prepare(`SELECT rowid FROM tasks_fts WHERE tasks_fts MATCH 'keep'`).all(),
    ).toEqual([{ rowid: 1 }]);
  });

  it('converges without FTS or content writes after one-time setup settles', () => {
    const db = makeDb();
    db.prepare(`INSERT INTO tasks (id, title, notes) VALUES (?, ?, ?)`).run(
      'settled-1',
      'Settled task one',
      'Replay must not rebuild this FTS row',
    );
    db.prepare(`INSERT INTO tasks (id, title, notes) VALUES (?, ?, ?)`).run(
      'settled-2',
      'Settled task two',
      'A second row exposes repeated FTS rebuild writes',
    );

    const before = totalChanges(db);
    runMigrations(db);
    expect(totalChanges(db) - before).toBe(0);
  });

  it('declares additive weighted Postgres search vector and GIN index before role-gated returns', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    await runPostgresBootstrap({
      query,
      connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }),
    } as unknown as Pool);
    const sql = query.mock.calls.map(([statement]) => String(statement)).join('\n');

    expect(sql).toMatch(/search_vector TSVECTOR GENERATED ALWAYS AS\s*\([\s\S]*setweight\(to_tsvector\('english', title\), 'A'\)[\s\S]*setweight\(to_tsvector\('english', COALESCE\(notes, ''\)\), 'B'\)[\s\S]*\) STORED/i);
    expect(sql).toMatch(/ALTER TABLE tasks ADD COLUMN IF NOT EXISTS search_vector TSVECTOR GENERATED ALWAYS AS/i);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_tasks_search ON tasks USING GIN\(search_vector\)/i);
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)|DELETE\s+FROM\s+tasks|UPDATE\s+tasks/i);

    const source = readFileSync(join(__dirname, '..', 'database', 'postgres_bootstrap.ts'), 'utf8');
    expect(source.indexOf('idx_tasks_search')).toBeLessThan(
      source.indexOf('if (!env.agentExecutionEnabled)'),
    );
  });
});
