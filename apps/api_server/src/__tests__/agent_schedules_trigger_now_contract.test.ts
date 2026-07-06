/**
 * Regression tests for a bug found live-testing #904 (activity log):
 *
 *   1. POST /agent-schedules/:id/trigger-now used to return only
 *      `{ message: '...' }`. The Flutter client parses this response as an
 *      AgentScheduledTask and merges it into its local task list — a
 *      message-only body silently parsed into a garbage task (empty id/name,
 *      'daily'/'opencode' fallback defaults) that overwrote the REAL
 *      triggered task in local state, corrupting the on-screen list.
 *   2. That garbage task (id='') then fed into GET
 *      /agent-sessions?scheduledTaskId= (empty string), which fell through
 *      to listAll() instead of returning nothing — leaking every session in
 *      the app into what was supposed to be one task's activity log.
 *
 * Real in-memory SQLite + real repository + real Express app, matching the
 * pattern in scheduled_task_columns_contract.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { startTestServer } from './helpers/real_server';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('trigger-now / activity-log regression', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let authHeaders: Record<string, string>;

  beforeEach(async () => {
    setDb(makeDb());
    const user = new UsersRepository().create({ name: 'T', email: 't@example.com' });
    const session = await new SessionsRepository().createAsync(user.id);
    authHeaders = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };
    const { baseUrl: b, close } = await startTestServer(createApp());
    baseUrl = b;
    closeServer = close;
  });

  afterEach(async () => {
    await closeServer();
  });

  it('POST /agent-schedules/:id/trigger-now returns the full updated task, not a bare message', async () => {
    const createRes = await fetch(`${baseUrl}/agent-schedules`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'ai-trend-research-daily',
        scheduleType: 'cron',
        cronExpression: '0 5 * * 1-5',
        prompt: 'Run the trend scan',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string };

    const triggerRes = await fetch(
      `${baseUrl}/agent-schedules/${created.id}/trigger-now`,
      { method: 'POST', headers: authHeaders },
    );
    expect(triggerRes.status).toBe(200);
    const body = (await triggerRes.json()) as {
      id: string;
      name: string;
      scheduleType: string;
      nextRunAt: string | null;
    };
    // Regression: these used to be undefined ('message' was the only key).
    expect(body.id).toBe(created.id);
    expect(body.name).toBe('ai-trend-research-daily');
    expect(body.scheduleType).toBe('cron');
    expect(body.nextRunAt).toBeTruthy();
  });

  it('GET /agent-sessions?scheduledTaskId= (empty) returns no sessions, never falls through to listAll', async () => {
    // Seed an unrelated, ordinary (non-scheduled) session so we can prove it
    // is NOT returned — this is exactly the "unrelated chat leaked into the
    // activity log" failure mode.
    await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ agentKind: 'claude-code', cwd: '/tmp', name: 'Unrelated chat' }),
    });

    const res = await fetch(`${baseUrl}/agent-sessions?scheduledTaskId=`, {
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions: unknown[] };
    expect(body.sessions).toEqual([]);
  });
});
