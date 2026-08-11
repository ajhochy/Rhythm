import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Pool } from 'pg';

import { parseTaskFilters } from '../controllers/tasks_controller';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { runPostgresBootstrap } from '../database/postgres_bootstrap';
import type { CreateTaskDto, Task } from '../models/task';
import type { TaskFilter } from '../models/task_filter';
import { TasksRepository } from '../repositories/tasks_repository';
import { UsersRepository } from '../repositories/users_repository';

type TaskOrganizationFields = {
  priority: number | null;
  tags: string[];
};

type TaskOrganizationInput = CreateTaskDto & {
  priority?: number | null;
  tags?: string[];
};

function organizationFields(task: Task): TaskOrganizationFields {
  return task as unknown as TaskOrganizationFields;
}

describe('issue #1244 acceptance contract: task priority and tags', () => {
  let db: Database.Database;
  let repo: TasksRepository;
  let userId: number;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    repo = new TasksRepository();
    userId = new UsersRepository().create({
      name: 'Task organizer',
      email: 'task-organizer@example.com',
    }).id;
  });

  afterEach(() => {
    db.close();
  });

  it('issue-1244-c1: priority is an integer that round-trips through task persistence', () => {
    // Regression caught: the priority column exists but create/read mapping
    // drops it, leaving every task indistinguishable to filters and ordering.
    const created = repo.create({
      title: 'Prepare Christmas service',
      ownerId: userId,
      priority: 3,
    } as TaskOrganizationInput);

    expect(organizationFields(created).priority).toBe(3);
    expect(organizationFields(repo.findById(created.id, userId)).priority).toBe(3);
  });

  it('issue-1244-c2: tags round-trip as a JSON string array, not a comma-separated scalar', () => {
    // Regression caught: tags are persisted as "worship,christmas", which
    // corrupts exact membership when a tag itself contains punctuation.
    const tags = ['worship', 'christmas-eve'];
    const created = repo.create({
      title: 'Choose songs',
      ownerId: userId,
      tags,
    } as TaskOrganizationInput);

    expect(organizationFields(created).tags).toEqual(tags);
    expect(organizationFields(repo.findById(created.id, userId)).tags).toEqual(tags);
    const stored = db
      .prepare('SELECT tags FROM tasks WHERE id = ?')
      .get(created.id) as { tags: string };
    expect(JSON.parse(stored.tags)).toEqual(tags);
  });

  it('issue-1244-c3: TaskFilter tag uses exact JSON-array membership', () => {
    // Regression caught: LIKE matching #worship also returns #worship-tech,
    // defeating cross-project organization by an exact shared tag.
    const worship = repo.create({
      title: 'Worship exact',
      ownerId: userId,
      tags: ['worship'],
    } as TaskOrganizationInput);
    repo.create({
      title: 'Worship tech only',
      ownerId: userId,
      tags: ['worship-tech'],
    } as TaskOrganizationInput);

    const parsed = parseTaskFilters({ status: 'all', tag: 'worship' }, userId);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect((parsed.filter as TaskFilter & { tag?: string }).tag).toBe('worship');
    expect(repo.findByFilter(parsed.filter).map(({ id }) => id)).toEqual([worship.id]);
  });

  it('issue-1244-c4: TaskFilter minPriority returns only tasks at or above the threshold', () => {
    // Regression caught: min_priority parses as text or is ignored, so a
    // priority-1 task leaks into the priority-2-and-up result.
    const high = repo.create({
      title: 'High priority',
      ownerId: userId,
      priority: 3,
    } as TaskOrganizationInput);
    const medium = repo.create({
      title: 'Medium priority',
      ownerId: userId,
      priority: 2,
    } as TaskOrganizationInput);
    repo.create({
      title: 'Low priority',
      ownerId: userId,
      priority: 1,
    } as TaskOrganizationInput);

    const parsed = parseTaskFilters(
      { status: 'all', min_priority: '2' },
      userId,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(
      (parsed.filter as TaskFilter & { minPriority?: number }).minPriority,
    ).toBe(2);
    expect(repo.findByFilter(parsed.filter).map(({ id }) => id).sort()).toEqual(
      [high.id, medium.id].sort(),
    );
  });

  it('issue-1244-c6: SQLite and Postgres add equivalent priority and tags columns without destructive SQL', async () => {
    // Regression caught: local SQLite accepts organized tasks while hosted
    // Postgres lacks one column/default, or rollout destroys existing task data.
    const sqliteColumns = db.pragma('table_info(tasks)') as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>;
    expect(sqliteColumns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'priority', type: 'INTEGER' }),
        expect.objectContaining({
          name: 'tags',
          type: 'TEXT',
          notnull: 1,
          dflt_value: "'[]'",
        }),
      ]),
    );

    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    await runPostgresBootstrap({ query } as unknown as Pool);
    await runPostgresBootstrap({ query } as unknown as Pool);
    const postgresSql = query.mock.calls
      .map(([statement]) => String(statement))
      .join('\n')
      .replace(/\s+/g, ' ');
    expect(postgresSql).toMatch(
      /ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority INTEGER/i,
    );
    expect(postgresSql).toMatch(
      /ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '\[\]'::jsonb/i,
    );
    expect(postgresSql).not.toMatch(
      /\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b[^;]*\btasks\b/i,
    );
  });
});
