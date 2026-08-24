import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Pool } from 'pg';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { runPostgresBootstrap } from '../database/postgres_bootstrap';
import { projectInstancesRouter } from '../routes/project_instances_routes';

type RouteLayer = {
  route?: { path: string; methods: Record<string, boolean> };
};

function registeredRoutes(): string[] {
  const stack = (projectInstancesRouter as unknown as { stack: RouteLayer[] }).stack;
  return stack.flatMap((layer) => {
    if (!layer.route) return [];
    return Object.entries(layer.route.methods)
      .filter(([, enabled]) => enabled)
      .map(([method]) => `${method.toUpperCase()} ${layer.route!.path}`);
  });
}

describe('issue #1246 acceptance contract: project milestones', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
  });

  afterEach(() => db.close());

  it('issue-1246-c1: defines a small instance-scoped milestone table', () => {
    // Regression caught: milestones are folded into the task/step model or the
    // dedicated table omits a phase field needed by the timeline.
    const columns = db.pragma('table_info(project_milestones)') as Array<{
      name: string;
      notnull: number;
    }>;
    expect(columns.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'id',
        'instance_id',
        'title',
        'due_date',
        'color',
        'sort_order',
      ]),
    );
    expect(columns.find(({ name }) => name === 'instance_id')).toEqual(
      expect.objectContaining({ notnull: 1 }),
    );
  });

  it('issue-1246-c2: exposes instance-scoped milestone CRUD routes', () => {
    // Regression caught: persistence lands without one CRUD action, leaving the
    // desktop unable to add, rename, reorder, or remove project phases.
    expect(registeredRoutes()).toEqual(
      expect.arrayContaining([
        'GET /:id/milestones',
        'POST /:id/milestones',
        'PATCH /:id/milestones/:milestoneId',
        'DELETE /:id/milestones/:milestoneId',
      ]),
    );
  });

  it('issue-1246-c3: project steps may be grouped into a milestone or remain ungrouped', () => {
    // Regression caught: milestone_id is required (breaking existing steps), or
    // references a milestone belonging to a different project instance.
    const stepColumns = db.pragma('table_info(project_instance_steps)') as Array<{
      name: string;
      notnull: number;
    }>;
    expect(stepColumns.find(({ name }) => name === 'milestone_id')).toEqual(
      expect.objectContaining({ notnull: 0 }),
    );

    db.exec(`
      INSERT INTO project_templates (id, name, anchor_type) VALUES ('template-a', 'Launch', 'date');
      INSERT INTO project_instances (id, template_id, name, anchor_date, status)
        VALUES ('instance-a', 'template-a', 'Christmas launch', '2026-12-01', 'active');
      INSERT INTO project_template_steps (id, template_id, title, offset_days, sort_order)
        VALUES ('template-step-a', 'template-a', 'Draft', 0, 0),
               ('template-step-b', 'template-a', 'Review', 1, 1);
      INSERT INTO project_milestones (id, instance_id, title, due_date, color, sort_order)
        VALUES ('milestone-a', 'instance-a', 'Planning', '2026-12-10', '#336699', 1);
      INSERT INTO project_instance_steps
        (id, instance_id, step_id, title, due_date, status, milestone_id)
        VALUES ('step-grouped', 'instance-a', 'template-step-a', 'Draft', '2026-12-05', 'open', 'milestone-a'),
               ('step-ungrouped', 'instance-a', 'template-step-b', 'Review', '2026-12-06', 'open', NULL);
    `);

    const rows = db
      .prepare(
        'SELECT id, milestone_id FROM project_instance_steps ORDER BY id',
      )
      .all() as Array<{ id: string; milestone_id: string | null }>;
    expect(rows).toEqual([
      { id: 'step-grouped', milestone_id: 'milestone-a' },
      { id: 'step-ungrouped', milestone_id: null },
    ]);

    db.exec(`
      INSERT INTO project_instances (id, template_id, name, anchor_date, status)
        VALUES ('instance-b', 'template-a', 'Other project', '2026-12-01', 'active');
      INSERT INTO project_milestones (id, instance_id, title, sort_order)
        VALUES ('milestone-b', 'instance-b', 'Wrong project phase', 1);
    `);
    expect(() =>
      db.prepare(
        "UPDATE project_instance_steps SET milestone_id = 'milestone-b' WHERE id = 'step-grouped'",
      ).run(),
    ).toThrow();
  });

  it('issue-1246-c5: SQLite and Postgres milestone schema are additive and equivalent', async () => {
    // Regression caught: local milestone grouping passes while hosted Postgres
    // lacks the table/link/index, or rollout destroys existing project data.
    const sqliteTable = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'project_milestones'",
      )
      .get() as { sql: string } | undefined;
    expect(sqliteTable, 'SQLite project_milestones table is missing').toBeDefined();
    expect(sqliteTable!.sql).toContain('REFERENCES project_instances(id)');
    expect(sqliteTable!.sql).toContain('UNIQUE(instance_id, id)');
    const stepDdl = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'project_instance_steps'",
      )
      .get() as { sql: string };
    expect(stepDdl.sql).toContain(
      'FOREIGN KEY (instance_id, milestone_id) REFERENCES project_milestones(instance_id, id)',
    );

    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    await runPostgresBootstrap({
      query,
      connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }),
    } as unknown as Pool);
    await runPostgresBootstrap({
      query,
      connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }),
    } as unknown as Pool);
    const postgresSql = query.mock.calls
      .map(([statement]) => String(statement))
      .join('\n')
      .replace(/\s+/g, ' ');
    expect(postgresSql).toMatch(
      /CREATE TABLE IF NOT EXISTS project_milestones\s*\(/i,
    );
    expect(postgresSql).toMatch(
      /ALTER TABLE project_instance_steps ADD COLUMN IF NOT EXISTS milestone_id TEXT/i,
    );
    expect(postgresSql).not.toMatch(
      /\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b[^;]*\b(?:project_milestones|project_instances|project_instance_steps)\b/i,
    );
  });
});
