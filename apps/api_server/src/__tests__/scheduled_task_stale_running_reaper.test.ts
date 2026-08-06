/**
 * CONTRACT — boot recovery for scheduled tasks orphaned mid-flight.
 *
 * `agent_scheduled_tasks` keeps ONE overwritten status slot, set to 'running'
 * before the async run begins. If the process dies before the run reports back,
 * that slot stays 'running' forever and the dashboard asserts an in-progress run
 * indefinitely. Observed 2026-08-04: `ffb-podcast-vibes` pinned at `running`
 * since 2026-08-03T18:30, its `bash` tool part still `running` 20+ hours later.
 *
 * `AgentSessionsRepository.resetStaleRunning` already recovered the SESSION half,
 * which is why the session showed 'idle'/'error' while the task row stayed
 * stale — the two halves were not symmetric. This pins the task half.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb, getDb } from '../database/db';
import { AgentScheduledTasksRepository } from '../repositories/agent_scheduled_tasks_repository';

const repo = new AgentScheduledTasksRepository();

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function task(id: string, lastRunStatus: string | null, nextRunAt = '2026-08-05T18:30:00.000Z') {
  getDb()
    .prepare(
      `INSERT INTO agent_scheduled_tasks (id, name, prompt, last_run_status, next_run_at, enabled)
       VALUES (?, ?, 'do the thing', ?, ?, 1)`,
    )
    .run(id, `task ${id}`, lastRunStatus, nextRunAt);
}

function statusOf(id: string) {
  return getDb()
    .prepare(`SELECT last_run_status, last_error, next_run_at FROM agent_scheduled_tasks WHERE id = ?`)
    .get(id) as { last_run_status: string | null; last_error: string | null; next_run_at: string | null };
}

describe('resetStaleRunningAsync', () => {
  beforeEach(() => {
    setDb(makeDb());
  });

  it("recovers a task orphaned at 'running'", async () => {
    task('orphan', 'running');
    const n = await repo.resetStaleRunningAsync();
    expect(n).toBe(1);
    expect(statusOf('orphan').last_run_status).toBe('error');
  });

  it("recovers a task orphaned at 'queued' (died before the run started)", async () => {
    task('queued-orphan', 'queued');
    expect(await repo.resetStaleRunningAsync()).toBe(1);
    expect(statusOf('queued-orphan').last_run_status).toBe('error');
  });

  it('records the interruption reason so the dashboard is not silently blank', async () => {
    task('orphan', 'running');
    await repo.resetStaleRunningAsync('Server restarted — run interrupted');
    expect(statusOf('orphan').last_error).toContain('run interrupted');
  });

  it('does NOT touch next_run_at — the schedule is still valid', async () => {
    task('orphan', 'running', '2026-08-05T18:30:00.000Z');
    await repo.resetStaleRunningAsync();
    // Reaping an orphan must not cause the task to skip or re-fire early.
    expect(statusOf('orphan').next_run_at).toBe('2026-08-05T18:30:00.000Z');
  });

  it.each(['success', 'error', 'completed_no_op', 'blocked_on_approval'])(
    "leaves a settled '%s' task alone",
    async (settled) => {
      task('settled', settled);
      expect(await repo.resetStaleRunningAsync()).toBe(0);
      expect(statusOf('settled').last_run_status).toBe(settled);
    },
  );

  it('leaves a never-run task alone', async () => {
    task('fresh', null);
    expect(await repo.resetStaleRunningAsync()).toBe(0);
    expect(statusOf('fresh').last_run_status).toBeNull();
  });

  it('recovers every orphan at once and only the orphans', async () => {
    task('a', 'running');
    task('b', 'queued');
    task('c', 'success');
    expect(await repo.resetStaleRunningAsync()).toBe(2);
    expect(statusOf('a').last_run_status).toBe('error');
    expect(statusOf('b').last_run_status).toBe('error');
    expect(statusOf('c').last_run_status).toBe('success');
  });

  it('is idempotent — a second boot reaps nothing', async () => {
    task('orphan', 'running');
    expect(await repo.resetStaleRunningAsync()).toBe(1);
    expect(await repo.resetStaleRunningAsync()).toBe(0);
  });
});
