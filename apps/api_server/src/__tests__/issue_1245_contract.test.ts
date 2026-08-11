import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Pool } from 'pg';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { runPostgresBootstrap } from '../database/postgres_bootstrap';
import type { CreateTaskDto, Task } from '../models/task';
import { TasksRepository } from '../repositories/tasks_repository';
import { UsersRepository } from '../repositories/users_repository';
import * as weeklyPlanning from '../services/weekly_planning_service';

type EnergyTask = Task & { energy: string | null };
type EnergyInput = CreateTaskDto & { energy?: string | null };

function taskFixture(
  id: string,
  title: string,
  scheduledOrder: number | null,
  energy: string | null,
): EnergyTask {
  return {
    id,
    title,
    notes: null,
    dueDate: '2026-03-23',
    scheduledDate: '2026-03-23',
    scheduledOrder,
    locked: false,
    status: 'open',
    sourceType: null,
    sourceId: null,
    sourceName: null,
    ownerId: 1,
    collaborators: [],
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:00.000Z',
    preferredAgent: null,
    priority: null,
    tags: [],
    energy,
  };
}

describe('issue #1245 acceptance contract: dopamine loop and task energy', () => {
  let db: Database.Database;
  let repo: TasksRepository;
  let ownerId: number;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    repo = new TasksRepository();
    ownerId = new UsersRepository().create({
      name: 'Energy planner',
      email: 'energy-planner@example.com',
    }).id;
  });

  afterEach(() => db.close());

  it('issue-1245-c3: task energy is nullable and round-trips as one emoji value', () => {
    // Regression caught: the migration exists but row mapping drops energy, or
    // legacy tasks without an energy value can no longer be read.
    const energyColumn = (db.pragma('table_info(tasks)') as Array<{
      name: string;
      notnull: number;
    }>).find(({ name }) => name === 'energy');
    expect(energyColumn).toEqual(expect.objectContaining({ notnull: 0 }));

    const energized = repo.create({
      title: 'Write liturgy',
      ownerId,
      energy: '🔥',
    } as EnergyInput) as EnergyTask;
    const unclassified = repo.create({
      title: 'Legacy task',
      ownerId,
    } as EnergyInput) as EnergyTask;
    expect(energized.energy).toBe('🔥');
    expect(repo.findById(energized.id, ownerId)).toMatchObject({ energy: '🔥' });
    expect(unclassified.energy).toBeNull();
  });

  it('issue-1245-c4: weekly ordering uses energy only after explicit scheduledOrder', () => {
    // Regression caught: energy sorting overwrites a user's drag order, or has
    // no effect at all for two tasks that do not have an explicit order.
    expect('compareTaskVisualOrder' in weeklyPlanning).toBe(true);
    const compare = (
      weeklyPlanning as unknown as {
        compareTaskVisualOrder: (left: Task, right: Task) => number;
      }
    ).compareTaskVisualOrder;
    const explicit = taskFixture('explicit', 'Explicitly ordered', 10000, null);
    const energized = taskFixture('energized', 'Energized', null, '🔥');
    const neutral = taskFixture('neutral', 'Neutral', null, null);
    const ordered = [neutral, energized, explicit].sort(compare);
    expect(ordered.map(({ id }) => id)).toEqual([
      'explicit',
      'energized',
      'neutral',
    ]);
  });

  it('issue-1245-c5: SQLite and Postgres add the same nullable energy column additively', async () => {
    // Regression caught: energy works locally but hosted Postgres lacks the
    // column, or rollout uses destructive task-table SQL.
    const sqliteEnergy = (db.pragma('table_info(tasks)') as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>).find(({ name }) => name === 'energy');
    expect(sqliteEnergy).toEqual(expect.objectContaining({
      name: 'energy',
      type: 'TEXT',
      notnull: 0,
      dflt_value: null,
    }));

    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    await runPostgresBootstrap({ query } as unknown as Pool);
    await runPostgresBootstrap({ query } as unknown as Pool);
    const postgresSql = query.mock.calls
      .map(([statement]) => String(statement))
      .join('\n')
      .replace(/\s+/g, ' ');
    expect(postgresSql).toMatch(
      /ALTER TABLE tasks ADD COLUMN IF NOT EXISTS energy TEXT/i,
    );
    expect(postgresSql).not.toMatch(
      /\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b[^;]*\btasks\b/i,
    );
  });
});
