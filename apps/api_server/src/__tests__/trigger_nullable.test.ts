/**
 * CONTRACT TESTS — pending_claude_triggers.task_id must be NULLABLE.
 *
 * Bug: task_id was declared `TEXT NOT NULL` in BOTH engines
 * (migrations.ts / postgres_bootstrap.ts), but scheduler/webhook/research
 * triggers insert task_id=NULL (agentSchedulerService.ts, agentWebhookController.ts,
 * agentResearchController.ts). Every taskless insert failed at runtime with a
 * NOT NULL constraint violation.
 *
 * These tests lock in that:
 *  - fresh migrated DBs accept a NULL task_id (AC1),
 *  - EXISTING DBs built with the old NOT NULL schema are rebuilt in-place,
 *    rows preserved, and then accept NULL inserts (AC2),
 *  - UNIQUE(task_id) still rejects duplicate NON-null ids but permits many
 *    NULLs (AC3),
 *  - ON DELETE CASCADE from tasks still fires (AC4),
 *  - the Postgres bootstrap carries a nullable CREATE + idempotent
 *    ALTER ... DROP NOT NULL (AC5),
 *  - a scheduler-shaped taskless INSERT (the full scheduler column set)
 *    succeeds against the migrated schema (AC6).
 */

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runMigrations } from '../database/migrations';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

/** notnull flag for a column, straight from the live schema. */
function taskIdNotNull(db: Database.Database): number {
  const cols = db.pragma('table_info(pending_claude_triggers)') as {
    name: string;
    notnull: number;
  }[];
  return cols.find((c) => c.name === 'task_id')!.notnull;
}

/** Insert a real task so FK-bearing inserts have a parent row. */
function seedTask(db: Database.Database, id: string, _ownerId: number): void {
  db.prepare(
    `INSERT INTO tasks (id, title, status, created_at, updated_at)
     VALUES (?, ?, 'open', datetime('now'), datetime('now'))`,
  ).run(id, `Task ${id}`);
}

function seedUser(db: Database.Database, id: number): void {
  db.prepare(
    `INSERT INTO users (id, name, email) VALUES (?, ?, ?)`,
  ).run(id, `User ${id}`, `u${id}@x.com`);
}

/** Insert a scheduled task so scheduled_task_id FK inserts have a parent. */
function seedScheduledTask(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO agent_scheduled_tasks (id, name, prompt) VALUES (?, ?, ?)`,
  ).run(id, `Sched ${id}`, 'scheduled prompt');
}

/** Insert a webhook endpoint so webhook_endpoint_id FK inserts have a parent. */
function seedWebhookEndpoint(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO agent_webhook_endpoints (id, name, secret) VALUES (?, ?, ?)`,
  ).run(id, `WH ${id}`, 'hmac-secret');
}

describe('pending_claude_triggers.task_id nullability', () => {
  it('AC1: fresh migrated DB accepts a NULL task_id trigger insert', () => {
    const db = freshDb();
    expect(taskIdNotNull(db)).toBe(0); // nullable
    seedScheduledTask(db, 'sched-1');

    expect(() =>
      db
        .prepare(
          `INSERT INTO pending_claude_triggers
             (task_id, triggered_by_user_id, scheduled_task_id, prompt, created_at)
           VALUES (NULL, NULL, ?, ?, datetime('now'))`,
        )
        .run('sched-1', 'do the thing'),
    ).not.toThrow();

    const row = db
      .prepare(`SELECT task_id, prompt FROM pending_claude_triggers`)
      .get() as { task_id: string | null; prompt: string };
    expect(row.task_id).toBeNull();
    expect(row.prompt).toBe('do the thing');
    db.close();
  });

  it('AC2: existing NOT NULL DB is rebuilt, rows preserved, NULL insert then succeeds', () => {
    // Simulate a real EXISTING deployment: first run the full migrations to get
    // the authentic schema (so downstream backfills that read other tables'
    // columns don't blow up), then FORCE pending_claude_triggers back to the
    // legacy `task_id TEXT NOT NULL` shape (with the additive scheduler columns
    // present) and seed a row. Re-running migrations must fire the rebuild.
    const db = freshDb();
    seedUser(db, 1);
    seedTask(db, 'task-old-1', 1);

    // Rebuild the table into the OLD (NOT NULL) shape, preserving the additive
    // columns — mirrors a DB that took the additive ALTERs but predates the fix.
    db.pragma('foreign_keys = OFF');
    db.exec(`
      DROP TABLE pending_claude_triggers;
      CREATE TABLE pending_claude_triggers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        triggered_by_user_id INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        scheduled_task_id TEXT REFERENCES agent_scheduled_tasks(id) ON DELETE CASCADE,
        prompt TEXT,
        allowed_mcps_json TEXT,
        allowed_skills_json TEXT,
        model_provider TEXT,
        model_id TEXT,
        webhook_endpoint_id TEXT,
        UNIQUE(task_id)
      );
      CREATE INDEX idx_pending_claude_triggers_created_at ON pending_claude_triggers(created_at);
    `);
    db.pragma('foreign_keys = ON');
    db.prepare(
      `INSERT INTO pending_claude_triggers (task_id, triggered_by_user_id, prompt)
       VALUES (?, ?, ?)`,
    ).run('task-old-1', 1, 'legacy human trigger');

    expect(taskIdNotNull(db)).toBe(1); // starts NOT NULL

    runMigrations(db);

    // Rebuilt → nullable now.
    expect(taskIdNotNull(db)).toBe(0);

    // Pre-existing row preserved with its data intact.
    const preserved = db
      .prepare(
        `SELECT task_id, triggered_by_user_id, prompt FROM pending_claude_triggers WHERE task_id = ?`,
      )
      .get('task-old-1') as {
      task_id: string;
      triggered_by_user_id: number;
      prompt: string;
    };
    expect(preserved.task_id).toBe('task-old-1');
    expect(preserved.triggered_by_user_id).toBe(1);
    expect(preserved.prompt).toBe('legacy human trigger');

    // And a NULL insert now succeeds.
    expect(() =>
      db
        .prepare(
          `INSERT INTO pending_claude_triggers (task_id, triggered_by_user_id, prompt)
           VALUES (NULL, NULL, ?)`,
        )
        .run('taskless after rebuild'),
    ).not.toThrow();

    // Index recreated.
    const idx = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_pending_claude_triggers_created_at'`,
      )
      .get();
    expect(idx).toBeTruthy();

    db.close();
  });

  it('AC2b: rebuild migration is idempotent (running migrations twice is a no-op)', () => {
    const db = freshDb();
    expect(taskIdNotNull(db)).toBe(0);
    // Second run must not throw and must leave the column nullable.
    expect(() => runMigrations(db)).not.toThrow();
    expect(taskIdNotNull(db)).toBe(0);
    db.close();
  });

  it('AC3: UNIQUE(task_id) rejects duplicate non-null but permits multiple NULLs', () => {
    const db = freshDb();
    seedUser(db, 1);
    seedTask(db, 'task-a', 1);

    const insert = db.prepare(
      `INSERT INTO pending_claude_triggers (task_id, triggered_by_user_id) VALUES (?, ?)`,
    );
    insert.run('task-a', 1);
    // Duplicate non-null task_id must be rejected by UNIQUE(task_id).
    expect(() => insert.run('task-a', 1)).toThrow(/UNIQUE/i);

    // Multiple NULL task_ids must be allowed.
    const insertNull = db.prepare(
      `INSERT INTO pending_claude_triggers (task_id, prompt) VALUES (NULL, ?)`,
    );
    insertNull.run('null-1');
    insertNull.run('null-2');
    insertNull.run('null-3');

    const nulls = db
      .prepare(`SELECT COUNT(*) AS c FROM pending_claude_triggers WHERE task_id IS NULL`)
      .get() as { c: number };
    expect(nulls.c).toBe(3);
    db.close();
  });

  it('AC4: deleting a task cascades to remove its pending trigger', () => {
    const db = freshDb();
    seedUser(db, 1);
    seedTask(db, 'task-cascade', 1);
    db.prepare(
      `INSERT INTO pending_claude_triggers (task_id, triggered_by_user_id) VALUES (?, ?)`,
    ).run('task-cascade', 1);

    let count = db
      .prepare(`SELECT COUNT(*) AS c FROM pending_claude_triggers WHERE task_id = ?`)
      .get('task-cascade') as { c: number };
    expect(count.c).toBe(1);

    db.prepare(`DELETE FROM tasks WHERE id = ?`).run('task-cascade');

    count = db
      .prepare(`SELECT COUNT(*) AS c FROM pending_claude_triggers WHERE task_id = ?`)
      .get('task-cascade') as { c: number };
    expect(count.c).toBe(0);
    db.close();
  });

  it('AC5: postgres_bootstrap declares task_id nullable and DROP NOT NULL statement present', () => {
    const src = readFileSync(
      join(__dirname, '..', 'database', 'postgres_bootstrap.ts'),
      'utf8',
    );
    // Scope the assertion to the pending_claude_triggers CREATE block only
    // (task_collaborators legitimately keeps task_id NOT NULL). Take the window
    // from the CREATE up to the next CREATE INDEX for this table.
    const createStart = src.indexOf(
      'CREATE TABLE IF NOT EXISTS pending_claude_triggers',
    );
    const idxAfter = src.indexOf(
      'CREATE INDEX IF NOT EXISTS idx_pending_claude_triggers_created_at',
      createStart,
    );
    const pctCreate = src.slice(createStart, idxAfter);
    // The pending_claude_triggers CREATE no longer declares task_id NOT NULL.
    expect(pctCreate).not.toMatch(/task_id TEXT NOT NULL/);
    // task_id column still references tasks with cascade (just nullable now).
    expect(pctCreate).toMatch(/task_id TEXT REFERENCES tasks\(id\) ON DELETE CASCADE/);
    // UNIQUE(task_id) preserved.
    expect(pctCreate).toMatch(/UNIQUE\(task_id\)/);
    // Idempotent DROP NOT NULL for existing deployments.
    expect(src).toMatch(
      /ALTER TABLE pending_claude_triggers ALTER COLUMN task_id DROP NOT NULL/,
    );
  });

  it('AC6: scheduler-shaped taskless INSERT (full scheduler column set) succeeds', () => {
    const db = freshDb();
    // Parent rows for the scheduled_task_id FK (webhook_endpoint_id has no FK).
    seedScheduledTask(db, 'sched-task-1');
    seedScheduledTask(db, 'sched-wh-1');
    seedWebhookEndpoint(db, 'wh-endpoint-1');
    // Mirror the exact column list + NULL task_id that agentSchedulerService.ts
    // uses for scheduler-originated triggers.
    expect(() =>
      db
        .prepare(
          `INSERT INTO pending_claude_triggers
             (task_id, triggered_by_user_id, scheduled_task_id, prompt,
              allowed_mcps_json, allowed_skills_json, model_provider, model_id, created_at)
           VALUES (NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'sched-task-1',
          'run the scheduled job',
          JSON.stringify(['rhythm']),
          JSON.stringify(['skill-a']),
          'anthropic',
          'claude-opus-4-1',
          new Date().toISOString(),
        ),
    ).not.toThrow();

    // Webhook-shaped insert (task_id + triggered_by NULL, webhook_endpoint_id set).
    expect(() =>
      db
        .prepare(
          `INSERT INTO pending_claude_triggers
             (task_id, triggered_by_user_id, scheduled_task_id, webhook_endpoint_id, prompt, created_at)
           VALUES (NULL, NULL, ?, ?, ?, datetime('now'))`,
        )
        .run('sched-wh-1', 'wh-endpoint-1', 'webhook fired'),
    ).not.toThrow();

    // Research-shaped insert (task_id NULL, triggered_by set, prompt).
    seedUser(db, 7);
    expect(() =>
      db
        .prepare(
          `INSERT INTO pending_claude_triggers (task_id, triggered_by_user_id, prompt, created_at)
           VALUES (NULL, ?, ?, datetime('now'))`,
        )
        .run(7, 'research this'),
    ).not.toThrow();

    const c = db
      .prepare(`SELECT COUNT(*) AS c FROM pending_claude_triggers WHERE task_id IS NULL`)
      .get() as { c: number };
    expect(c.c).toBe(3);
    db.close();
  });
});
