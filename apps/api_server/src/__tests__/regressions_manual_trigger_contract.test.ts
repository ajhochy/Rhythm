import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentScheduledTasksRepository } from '../repositories/agent_scheduled_tasks_repository';
import { AgentSchedulesController } from '../controllers/agentSchedulesController';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { UsersRepository } from '../repositories/users_repository';
import type { Request, Response } from 'express';

describe('C1 manual dispatch eligibility', () => {
  let db: Database.Database;
  const repo = new AgentScheduledTasksRepository();
  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    setDb(db);
  });
  afterEach(() => db.close());

  it('disabled recurrence remains disabled but an explicit queued request is dispatchable', async () => {
    // Regression: queueNowAsync accepts a disabled schedule that findDueAsync drops forever.
    const task = await repo.createAsync({ name: 'Synthetic Org Reviewer', scheduleType: 'daily', scheduledTime: '09:00', prompt: 'Synthetic review only' });
    await repo.updateAsync(task.id, { enabled: false });
    expect((await repo.findByIdAsync(task.id))?.enabled).toBe(false);
    expect(await repo.findDueAsync()).toEqual([]);
    await repo.queueNowAsync(task.id);
    expect((await repo.findDueAsync()).map(row => row.id)).toEqual([task.id]);
    expect((await repo.findByIdAsync(task.id))?.enabled).toBe(false);
  });

  it('duplicate manual requests join running work instead of resetting it to queued', async () => {
    // Regression: another click overwrites running state and allows another dispatch.
    const task = await repo.createAsync({ name: 'Synthetic review in flight', scheduleType: 'daily', prompt: 'Synthetic review only' });
    const startedAt = '2026-10-01T00:00:00.000Z';
    await repo.updateNextRunAsync(task.id, null, startedAt, 'running');
    await repo.queueNowAsync(task.id);
    const fresh = await repo.findByIdAsync(task.id);
    expect(fresh?.lastRunStatus).toBe('running');
    expect(fresh?.lastRunAt).toBe(startedAt);
    expect(fresh?.nextRunAt).toBeNull();
  });

  it('queued duplicates preserve the accepted attempt and running recurrence cannot be selected again', async () => {
    const task = await repo.createAsync({ name: 'Synthetic duplicate', scheduleType: 'daily', prompt: 'Read only' });
    const accepted = await repo.queueNowAsync(task.id);
    await repo.queueNowAsync(task.id);
    expect(await repo.findByIdAsync(task.id)).toEqual(accepted);
    await repo.updateNextRunAsync(task.id, '2020-01-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', 'running');
    expect(await repo.findDueAsync()).toEqual([]);
  });

  it('unrequested disabled recurrence and future enabled recurrence remain ineligible', async () => {
    const disabled = await repo.createAsync({ name: 'Off', scheduleType: 'daily', prompt: 'Read only', nextRunAt: '2020-01-01T00:00:00.000Z' });
    await repo.updateAsync(disabled.id, { enabled: false });
    await repo.createAsync({ name: 'Future', scheduleType: 'daily', prompt: 'Read only', nextRunAt: '2099-01-01T00:00:00.000Z' });
    const due = await repo.createAsync({ name: 'Due', scheduleType: 'daily', prompt: 'Read only', nextRunAt: '2020-01-01T00:00:00.000Z' });
    expect((await repo.findDueAsync()).map(row => row.id)).toEqual([due.id]);
  });

  it.each(['disabled', 'locked', 'retired'])('rejects %s profile configuration before queuing', async (state) => {
    // Regression: trigger accepts work that can never execute, hiding the actionable reason.
    const configs = new AgentConfigsRepository();
    const config = configs.insert({ id: 'synthetic-c1', label: 'Synthetic', icon: 'bot', enabled: state !== 'disabled', allowedMcpsJson: state === 'retired' ? '{"rhythm":["rhythm_run_org_optimizer"]}' : null });
    if (state === 'locked') db.prepare('UPDATE agent_configs SET locked = 1 WHERE id = ?').run(config.id);
    const task = await repo.createAsync({ name: 'Synthetic guarded', scheduleType: 'daily', prompt: 'Read only', agentConfigId: config.id });
    let failure: unknown;
    let response: unknown;
    await new AgentSchedulesController().triggerNow({ params: { id: task.id } } as unknown as Request, { json: (value: unknown) => { response = value; } } as Response, error => { failure = error; });
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(state === 'retired' ? /retired.*Org Reviewer/i : new RegExp(state, 'i'));
    expect(response).toBeUndefined();
    expect((await repo.findByIdAsync(task.id))?.lastRunStatus).toBeNull();
  });

  it('owner-bound manual entry denies another device and the owner receives the same queued attempt on duplicate', async () => {
    const users = new UsersRepository();
    const owner = users.create({ name: 'Synthetic Owner', email: 'c1-owner@example.test' });
    const other = users.create({ name: 'Synthetic Other', email: 'c1-other@example.test' });
    const task = await repo.createAsync({ name: 'Synthetic owned', scheduleType: 'daily', prompt: 'Read only', createdByUserId: owner.id });
    const controller = new AgentSchedulesController();
    let denied: unknown;
    await controller.triggerNow({ params: { id: task.id }, mobileDevice: { userId: other.id } } as unknown as Request, { json: () => { throw new Error('must not publish'); } } as unknown as Response, error => { denied = error; });
    expect(denied).toBeInstanceOf(Error);
    expect((await repo.findByIdAsync(task.id))?.lastRunStatus).toBeNull();
    const responses: unknown[] = [];
    for (let i = 0; i < 2; i++) {
      await controller.triggerNow({ params: { id: task.id }, mobileDevice: { userId: owner.id } } as unknown as Request, { json: (value: unknown) => { responses.push(value); } } as Response, error => { throw error; });
    }
    expect(responses).toHaveLength(2);
    expect(responses[1]).toEqual(responses[0]);
    expect(await repo.findByIdAsync(task.id)).toMatchObject({ createdByUserId: owner.id, lastRunStatus: 'queued' });
  });
});
