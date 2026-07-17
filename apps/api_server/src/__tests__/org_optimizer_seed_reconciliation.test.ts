/**
 * #1111 (Discovery-003) — boot-time reconciliation of the seeded discovery
 * scheduled tasks. See docs/ai/generated-issues/discovery-003-unbreak-crons.md
 * for the live-`rhythm.db` snapshot this reproduces:
 *
 *   - "Org Self-Optimizer" (daily): enabled=0, last run errored (the
 *     historical NULL-model "no route in catalog" stall — already fixed by
 *     the model backfill in this same file, commits a9c92bed6/5c4af4ae8 — but
 *     that fix never restored `enabled`).
 *   - "Org External Discovery" (weekly): enabled=0.
 *   - "Org External Discovery v2" (weekly): enabled=1, a stray duplicate.
 *
 * These tests hand-craft that exact broken state in a fresh in-memory DB
 * (bypassing the seed, mirroring "an existing install") and assert
 * `seedOrgOptimizerTask()` reconciles it: exactly one enabled row per task
 * family, the canonical name preferred as survivor, and re-running is
 * idempotent (does not clobber a later, deliberate user disable).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentScheduledTasksRepository } from '../repositories/agent_scheduled_tasks_repository';

const AUDIT_TASK_NAME = 'Org Self-Optimizer';
const EXTERNAL_TASK_NAME = 'Org External Discovery';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

beforeEach(() => {
  setDb(makeDb());
});

afterEach(() => {
  delete process.env.MCP_ROLES_DIR;
});

describe('org_optimizer_seed boot-time reconciliation (#1111)', () => {
  it('a fresh boot seeds exactly one enabled weekly discovery task and the daily task enabled', async () => {
    const { seedOrgOptimizerTask } = await import('../services/org_optimizer_seed');
    await seedOrgOptimizerTask();

    const schedRepo = new AgentScheduledTasksRepository();
    const tasks = await schedRepo.listAllAsync();

    const externalTasks = tasks.filter((t) => t.name.startsWith(EXTERNAL_TASK_NAME));
    expect(externalTasks.filter((t) => t.enabled)).toHaveLength(1);

    const audit = tasks.find((t) => t.name === AUDIT_TASK_NAME);
    expect(audit).toBeDefined();
    expect(audit!.enabled).toBe(true);
  });

  it('re-invoking the seed is idempotent: no duplicates, enabled flags unchanged', async () => {
    const { seedOrgOptimizerTask } = await import('../services/org_optimizer_seed');
    await seedOrgOptimizerTask();
    await seedOrgOptimizerTask();

    const schedRepo = new AgentScheduledTasksRepository();
    const tasks = await schedRepo.listAllAsync();
    expect(tasks.filter((t) => t.name === AUDIT_TASK_NAME)).toHaveLength(1);
    expect(tasks.filter((t) => t.name === EXTERNAL_TASK_NAME)).toHaveLength(1);
    expect(tasks.find((t) => t.name === AUDIT_TASK_NAME)!.enabled).toBe(true);
    expect(tasks.find((t) => t.name === EXTERNAL_TASK_NAME)!.enabled).toBe(true);
  });

  it('reconciles a disabled canonical row + an enabled "v2" duplicate down to exactly one enabled row, preferring the canonical name', async () => {
    const schedRepo = new AgentScheduledTasksRepository();
    const canonical = await schedRepo.createAsync({
      name: EXTERNAL_TASK_NAME,
      scheduleType: 'weekly',
      prompt: 'legacy prompt',
    });
    await schedRepo.updateAsync(canonical.id, { enabled: false });
    const v2 = await schedRepo.createAsync({
      name: `${EXTERNAL_TASK_NAME} v2`,
      scheduleType: 'weekly',
      prompt: 'stray duplicate prompt',
    });
    expect(v2.enabled).toBe(true); // sanity: DB default is enabled

    const { seedOrgOptimizerTask } = await import('../services/org_optimizer_seed');
    const result = await seedOrgOptimizerTask();

    // Name-guard already sees "Org External Discovery" so no third row is created.
    expect(result.externalTaskSeeded).toBe(false);

    const tasks = await schedRepo.listAllAsync();
    const related = tasks.filter((t) => t.name.startsWith(EXTERNAL_TASK_NAME));
    expect(related).toHaveLength(2); // no rows deleted — disabled, not removed
    expect(related.filter((t) => t.enabled)).toHaveLength(1);

    const survivor = related.find((t) => t.enabled)!;
    expect(survivor.name).toBe(EXTERNAL_TASK_NAME); // canonical name wins over "v2"

    const strayDup = related.find((t) => t.id === v2.id)!;
    expect(strayDup.enabled).toBe(false);
  });

  it('re-enables a lone disabled "Org Self-Optimizer" row exactly once (the historical NULL-model bug repair), then respects a later deliberate user disable', async () => {
    const schedRepo = new AgentScheduledTasksRepository();
    const row = await schedRepo.createAsync({
      name: AUDIT_TASK_NAME,
      scheduleType: 'daily',
      scheduledTime: '02:00',
      prompt: 'legacy prompt',
    });
    await schedRepo.updateAsync(row.id, {
      enabled: false,
      lastRunAt: '2026-07-10T02:00:00.000Z',
      lastRunStatus: 'error',
    } as never);

    const { seedOrgOptimizerTask } = await import('../services/org_optimizer_seed');

    // First seed after the historical-bug state: repaired back to enabled.
    await seedOrgOptimizerTask();
    let after = await (await schedRepo.findByIdAsync(row.id))!;
    expect(after.enabled).toBe(true);

    // A human now deliberately turns it back off.
    await schedRepo.updateAsync(row.id, { enabled: false });

    // Re-running the seed must NOT clobber that deliberate disable a second time.
    await seedOrgOptimizerTask();
    after = await (await schedRepo.findByIdAsync(row.id))!;
    expect(after.enabled).toBe(false);
  });

  it('an already-enabled task is not clobbered by re-seeding', async () => {
    const { seedOrgOptimizerTask } = await import('../services/org_optimizer_seed');
    await seedOrgOptimizerTask();

    const schedRepo = new AgentScheduledTasksRepository();
    const before = await schedRepo.listAllAsync();
    expect(before.every((t) => t.enabled)).toBe(true);

    await seedOrgOptimizerTask();
    const after = await schedRepo.listAllAsync();
    expect(after.every((t) => t.enabled)).toBe(true);
    expect(after).toHaveLength(before.length);
  });
});
