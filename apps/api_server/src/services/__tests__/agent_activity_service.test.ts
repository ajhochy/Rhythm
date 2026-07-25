import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import {
  listAgentActivity,
  type AgentActivityItem,
} from '../agent_activity_service';

function insert(
  db: Database.Database,
  sql: string,
  values: unknown[],
) {
  db.prepare(sql).run(...values);
}

describe('#1172 agent activity aggregation', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    setDb(db);
    runMigrations(db);
    insert(
      db,
      `INSERT INTO projects (id, name, cwd, created_at)
       VALUES (?, ?, ?, ?)`,
      ['project-a', 'Project A', '/tmp/project-a', '2026-07-24T08:00:00.000Z'],
    );

    insert(
      db,
      `INSERT INTO agent_sessions
        (id, agent_kind, status, cwd, name, project_id, category, is_system, created_at, updated_at)
       VALUES (?, 'opencode', ?, '/tmp', ?, ?, ?, ?, ?, ?)`,
      ['human-1', 'working', 'Human planning', 'project-a', 'chat', 0, '2026-07-25T09:00:00.000Z', '2026-07-25T09:05:00.000Z'],
    );
    insert(
      db,
      `INSERT INTO agent_scheduled_tasks
        (id, name, prompt, agent_config_id, last_run_at, last_run_status, created_at, updated_at)
       VALUES (?, ?, 'run', ?, ?, ?, ?, ?)`,
      ['schedule-1', 'Sunday prep', 'secretary', '2026-07-25T09:04:00.000Z', 'success', '2026-07-24T09:04:00.000Z', '2026-07-25T09:04:00.000Z'],
    );
    insert(
      db,
      `INSERT INTO agent_sessions
        (id, agent_kind, status, cwd, name, project_id, scheduled_task_id, category, is_system, created_at, updated_at)
       VALUES (?, 'opencode', ?, '/tmp', ?, ?, ?, 'scheduled', 1, ?, ?)`,
      ['scheduled-run-1', 'done', 'Sunday prep', 'project-a', 'schedule-1', '2026-07-25T09:03:00.000Z', '2026-07-25T09:04:00.000Z'],
    );
    insert(
      db,
      `INSERT INTO agent_webhook_endpoints
        (id, name, secret, last_triggered_at, trigger_count, created_at, updated_at)
       VALUES (?, ?, 'must-never-leak', ?, 1, ?, ?)`,
      ['webhook-1', 'Planning Center', '2026-07-25T09:03:30.000Z', '2026-07-24T09:03:30.000Z', '2026-07-25T09:03:30.000Z'],
    );
    insert(
      db,
      `INSERT INTO agent_research_jobs
        (id, query, status, report, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['research-1', 'Best volunteer follow-up', 'synthesizing', null, '2026-07-25T09:01:00.000Z', '2026-07-25T09:03:00.000Z'],
    );
    insert(
      db,
      `INSERT INTO agent_cookbook
        (id, title, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      ['cookbook-1', 'Build weekly recap', 'Weekly recap recipe', '2026-07-24T09:00:00.000Z', '2026-07-25T09:02:00.000Z'],
    );
    insert(
      db,
      `INSERT INTO agent_sessions
        (id, agent_kind, status, cwd, name, category, is_system, created_at, updated_at)
       VALUES (?, 'opencode', 'done', '/tmp', ?, 'chat', 0, ?, ?)`,
      ['cookbook-run-1', 'Build weekly recap', '2026-07-25T09:01:30.000Z', '2026-07-25T09:02:00.000Z'],
    );
    insert(
      db,
      `INSERT INTO agent_org_proposals
        (id, audit_run_id, kind, risk, status, title, created_at, updated_at)
       VALUES (?, ?, 'refine-skill', 'low', 'applied', ?, ?, ?)`,
      ['proposal-1', 'optimizer-run-1', 'Improve handoff', '2026-07-25T09:00:30.000Z', '2026-07-25T09:01:00.000Z'],
    );
  });

  afterEach(() => {
    db.close();
  });

  it('issue-1172-c5: aggregates all execution sources without a duplicate activity table', async () => {
    const result = await listAgentActivity({ limit: 50 });

    expect(new Set(result.items.map((item) => item.source))).toEqual(
      new Set(['human', 'scheduler', 'webhook', 'research', 'cookbook', 'optimizer']),
    );
    expect(result.items.filter((item) => item.source === 'scheduler')).toHaveLength(1);
    expect(result.items.filter((item) => item.source === 'cookbook')).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('must-never-leak');

    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%activity%'`)
      .all() as Array<{ name: string }>;
    expect(tables).toEqual([]);
  });

  it('issue-1172-c6: canonical order filters and cursor remain stable and duplicate-free', async () => {
    const first = await listAgentActivity({ limit: 2 });
    expect(first.nextCursor).not.toBeNull();
    const cursor = first.nextCursor ?? undefined;
    const second = await listAgentActivity({ limit: 2, cursor });
    const repeated = await listAgentActivity({ limit: 2, cursor });

    expect(first.items).toHaveLength(2);
    expect(second.items).toEqual(repeated.items);
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(4);
    expect(
      [...first.items, ...second.items]
        .map((item) => item.occurredAt)
        .slice()
        .sort()
        .reverse(),
    ).toEqual([...first.items, ...second.items].map((item) => item.occurredAt));

    const filtered = await listAgentActivity({
      limit: 20,
      source: 'research',
      status: 'active',
    });
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0]).toMatchObject({
      source: 'research',
      status: 'active',
      profileId: null,
      projectId: null,
    } satisfies Partial<AgentActivityItem>);

    await expect(
      listAgentActivity({ limit: 20, cursor: 'not-an-opaque-cursor' }),
    ).rejects.toThrow(/cursor/i);
  });
});
