import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  return db;
}

describe('backfill_scheduled_date_v1 migration (issue #520)', () => {
  it('fresh DB: migration runs on empty tables, marker row inserted, log emitted (no rows match)', () => {
    const db = makeDb();
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    try {
      runMigrations(db);
    } finally {
      console.log = origLog;
    }

    // Marker must be present.
    const marker = db.prepare(`SELECT value FROM schema_meta WHERE key = 'backfill_scheduled_date_v1'`).get() as { value: string } | undefined;
    expect(marker).toBeDefined();
    expect(new Date(marker!.value).toString()).not.toBe('Invalid Date');

    // Log must have been emitted with zero counts.
    const backfillLog = logs.find((l) => l.includes('backfill_scheduled_date_v1'));
    expect(backfillLog).toBeDefined();
    expect(backfillLog).toMatch(/tasks updated=0/);
    expect(backfillLog).toMatch(/project_steps updated=0/);
  });

  it('pre-existing DB with legacy rows: correct rows backfilled, marker inserted, correct counts logged', () => {
    const db = makeDb();

    // Run migrations once to set up all tables (but no legacy data yet).
    runMigrations(db);

    // Remove the marker so we can test as if this were a pre-existing DB.
    db.exec(`DELETE FROM schema_meta WHERE key = 'backfill_scheduled_date_v1'`);

    // Seed tasks:
    //   t1: due_date set, scheduled_date NULL → should be backfilled
    //   t2: both set → scheduled_date must NOT change
    //   t3: due_date NULL, scheduled_date NULL → not touched
    //   t4: due_date set, scheduled_date NULL → should be backfilled
    db.exec(`
      INSERT INTO tasks (id, title, due_date, scheduled_date, status)
      VALUES
        ('t1', 'Task 1', '2026-01-01', NULL,         'open'),
        ('t2', 'Task 2', '2026-01-02', '2026-01-10', 'open'),
        ('t3', 'Task 3', NULL,         NULL,          'open'),
        ('t4', 'Task 4', '2026-01-05', NULL,          'open')
    `);

    // Seed project_instance_steps:
    //   ps1: due_date set, scheduled_date NULL → backfilled
    //   ps2: scheduled_date already set → not changed (due_date is required NOT NULL)
    // Note: project_instance_steps.due_date is NOT NULL so the NULL-due_date scenario
    // is enforced at the schema level; that constraint coverage is tested separately.
    // Disable FK enforcement so we can insert without real instance/step rows.
    db.pragma('foreign_keys = OFF');
    db.exec(`
      INSERT INTO project_instance_steps (id, instance_id, step_id, title, due_date, scheduled_date, status)
      VALUES
        ('ps1', 'dummy-inst', 'dummy-step', 'Step 1', '2026-02-01', NULL,         'open'),
        ('ps2', 'dummy-inst', 'dummy-step', 'Step 2', '2026-02-05', '2026-02-20', 'open')
    `);
    db.pragma('foreign_keys = ON');

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    try {
      runMigrations(db);
    } finally {
      console.log = origLog;
    }

    // --- task assertions ---
    const tasks = db.prepare(`SELECT id, scheduled_date FROM tasks ORDER BY id`).all() as { id: string; scheduled_date: string | null }[];
    const t1 = tasks.find((t) => t.id === 't1')!;
    const t2 = tasks.find((t) => t.id === 't2')!;
    const t3 = tasks.find((t) => t.id === 't3')!;
    const t4 = tasks.find((t) => t.id === 't4')!;

    expect(t1.scheduled_date).toBe('2026-01-01'); // backfilled from due_date
    expect(t2.scheduled_date).toBe('2026-01-10'); // unchanged
    expect(t3.scheduled_date).toBeNull();          // untouched (no due_date)
    expect(t4.scheduled_date).toBe('2026-01-05'); // backfilled from due_date

    // --- project_instance_steps assertions ---
    const steps = db.prepare(`SELECT id, scheduled_date FROM project_instance_steps ORDER BY id`).all() as { id: string; scheduled_date: string | null }[];
    const ps1 = steps.find((s) => s.id === 'ps1')!;
    const ps2 = steps.find((s) => s.id === 'ps2')!;

    expect(ps1.scheduled_date).toBe('2026-02-01'); // backfilled
    expect(ps2.scheduled_date).toBe('2026-02-20'); // unchanged

    // --- marker ---
    const marker = db.prepare(`SELECT value FROM schema_meta WHERE key = 'backfill_scheduled_date_v1'`).get() as { value: string } | undefined;
    expect(marker).toBeDefined();

    // --- log: tasks=2, steps=1 ---
    const backfillLog = logs.find((l) => l.includes('backfill_scheduled_date_v1'));
    expect(backfillLog).toBeDefined();
    expect(backfillLog).toMatch(/tasks updated=2/);
    expect(backfillLog).toMatch(/project_steps updated=1/);
  });

  it('running migrations a second time is a no-op: no rows re-updated, no log emitted', () => {
    const db = makeDb();

    // First run: sets up tables and marker.
    runMigrations(db);

    // Capture any logs from a second run.
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    try {
      runMigrations(db);
    } finally {
      console.log = origLog;
    }

    // No backfill log should be emitted on a second run.
    const backfillLog = logs.find((l) => l.includes('backfill_scheduled_date_v1'));
    expect(backfillLog).toBeUndefined();

    // Marker still present (not removed).
    const marker = db.prepare(`SELECT key FROM schema_meta WHERE key = 'backfill_scheduled_date_v1'`).get();
    expect(marker).toBeDefined();
  });

  it('rows where scheduled_date was already set are untouched even when due_date differs', () => {
    const db = makeDb();
    runMigrations(db);

    // Remove marker to re-test as a legacy DB.
    db.exec(`DELETE FROM schema_meta WHERE key = 'backfill_scheduled_date_v1'`);

    // Task with both dates already populated.
    db.exec(`
      INSERT INTO tasks (id, title, due_date, scheduled_date, status)
      VALUES ('tx', 'Already Scheduled', '2026-06-01', '2026-05-15', 'open')
    `);

    runMigrations(db);

    const row = db.prepare(`SELECT scheduled_date FROM tasks WHERE id = 'tx'`).get() as { scheduled_date: string };
    expect(row.scheduled_date).toBe('2026-05-15'); // unchanged
  });
});
