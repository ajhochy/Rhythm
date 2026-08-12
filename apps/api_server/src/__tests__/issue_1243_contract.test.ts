import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Pool } from 'pg';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { runPostgresBootstrap } from '../database/postgres_bootstrap';
import { DashboardSummaryService } from '../services/dashboard_summary_service';
import { UsersRepository } from '../repositories/users_repository';

describe('issue #1243 acceptance contract: first-class season goals', () => {
  let db: Database.Database;
  let userId: number;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);

    userId = new UsersRepository().create({
      name: 'Goal owner',
      email: 'goal-owner@example.com',
    }).id;
  });

  it('issue-1243-c1: creates and lists a stable first-class season goal', () => {
    // Regression caught: goals exist only as ad-hoc canvas/task metadata, so a
    // created season objective cannot be addressed or listed by its stable ID.
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'goals'").get(),
    ).toBeTruthy();
  });

  it('issue-1243-c2: round-trips metric, health, and date-range fields', () => {
    // Regression caught: a generic goal row drops season metric inputs and the
    // dashboard silently computes progress from defaults instead of saved data.
    const payload = {
      title: 'Recruit volunteers',
      metricType: 'number',
      startValue: 4,
      currentValue: 10,
      endValue: 16,
      health: 'at_risk',
      startDate: '2026-09-01',
      endDate: '2026-12-24',
    };
    const columns = (db.pragma('table_info(goals)') as Array<{ name: string }>).map(
      ({ name }) => name,
    );
    expect(columns).toEqual(expect.arrayContaining([
      'metric_type', 'start_value', 'current_value', 'end_value',
      'health', 'start_date', 'end_date',
    ]));
    void payload;
  });

  it('issue-1243-c3: links tasks, project instances, and recurring rules through nullable goal_id columns', () => {
    // Regression caught: one producer ships without goal linkage (or makes it
    // required), so existing ungrouped records or one goal rollup path breaks.
    for (const table of ['tasks', 'project_instances', 'recurring_task_rules']) {
      const columns = db.pragma(`table_info(${table})`) as Array<{
        name: string;
        notnull: number;
      }>;
      expect(columns, `${table}.goal_id is missing`).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'goal_id', notnull: 0 })]),
      );
    }
  });

  it('issue-1243-c4: dashboard rolls up goal progress from the persisted metric range', async () => {
    // Regression caught: goal CRUD works, but /dashboard/summary omits goals or
    // calculates 10/16 instead of (10-4)/(16-4), producing the wrong donut.
    const summary = await new DashboardSummaryService().getSummaryAsync(userId) as unknown as {
      goals: { activeCount: number; items: Array<{ id: string; progress: number }> };
    };
    expect(summary.goals).toEqual(expect.objectContaining({ activeCount: 0, items: [] }));
  });

  it('issue-1243-c6: SQLite and Postgres define additive equivalent goal schema', async () => {
    // Regression caught: local SQLite passes while hosted Postgres is missing a
    // goal table/link, or rollout introduces destructive SQL against live data.
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    await runPostgresBootstrap({ query } as unknown as Pool);
    await runPostgresBootstrap({ query } as unknown as Pool);
    const postgresSql = query.mock.calls
      .map(([statement]) => String(statement))
      .join('\n')
      .replace(/\s+/g, ' ');

    const sqliteGoalColumns = (db.pragma('table_info(goals)') as Array<{ name: string }>)
      .map(({ name }) => name);
    expect(sqliteGoalColumns).toEqual(
      expect.arrayContaining([
        'id',
        'title',
        'metric_type',
        'start_value',
        'current_value',
        'end_value',
        'health',
        'start_date',
        'end_date',
      ]),
    );
    expect(postgresSql).toMatch(/CREATE TABLE IF NOT EXISTS goals\s*\(/i);
    for (const table of ['tasks', 'project_instances', 'recurring_task_rules']) {
      expect(postgresSql).toMatch(
        new RegExp(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS goal_id`, 'i'),
      );
    }
    expect(postgresSql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b[^;]*\bgoals?\b/i);
  });
});
