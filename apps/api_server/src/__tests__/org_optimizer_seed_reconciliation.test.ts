import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentScheduledTasksRepository } from '../repositories/agent_scheduled_tasks_repository';
import { UsersRepository } from '../repositories/users_repository';
import { seedOrgOptimizerTask } from '../services/org_optimizer_seed';
import { ORG_REVIEWER_ALLOWED_MCPS_JSON, ORG_REVIEWER_ALLOWED_SKILLS_JSON } from '../services/org_reviewer_seed';
import { useTempManagedSkillsRoot } from './_managed_skills_temp_root';

vi.mock('../services/agent_profile_projection_service', () => ({
  projectAgentProfileAfterWrite: vi.fn(() => ({ kind: 'projected', revision: 0, write: 'written' })),
}));
useTempManagedSkillsRoot('org-reviewer-reconciliation');
let db: Database.Database;
beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
});
afterEach(() => { vi.restoreAllMocks(); setDb(null); db.close(); });
const repo = new AgentScheduledTasksRepository();
const reviewerInput = {
  name: 'Org Reviewer', scheduleType: 'weekly', agentKind: 'opencode', agentConfigId: 'org-reviewer',
  prompt: 'Review recent evidence', allowedMcpsJson: ORG_REVIEWER_ALLOWED_MCPS_JSON,
  allowedSkillsJson: ORG_REVIEWER_ALLOWED_SKILLS_JSON,
};

describe('Org Reviewer retirement and schedule reconciliation', () => {
  it('reports retirement failure so startup can keep the scheduler stopped', async () => {
    const old = await repo.createAsync({ name: 'Org Self-Optimizer', scheduleType: 'daily', prompt: 'legacy' });
    vi.spyOn(AgentScheduledTasksRepository.prototype, 'updateAsync').mockRejectedValueOnce(new Error('synthetic unavailable write'));
    const result = await seedOrgOptimizerTask();
    expect(result.legacyRetired).toBe(false);
    expect(result.reviewerTaskSeeded).toBe(false);
    expect(await repo.findByIdAsync(old.id)).toMatchObject({ enabled: true });
    expect(await repo.listAllAsync()).toHaveLength(1);
  });

  it('disables every old daily/external duplicate and renamed legacy-profile task without deleting rows', async () => {
    const legacy = [];
    for (const name of ['Org Self-Optimizer', 'Org Self-Optimizer v2', 'Org External Discovery', 'Org External Discovery v2']) {
      legacy.push(await repo.createAsync({ name, scheduleType: 'daily', prompt: 'legacy' }));
    }
    legacy.push(await repo.createAsync({ name: 'Renamed legacy job', scheduleType: 'daily', prompt: 'legacy', agentConfigId: '8f1c2d3e-4a5b-4c6d-9e7f-0a1b2c3d4e5f' }));
    const unrelated = await repo.createAsync({ name: 'Facilities summary', scheduleType: 'daily', prompt: 'Leave alone' });
    await seedOrgOptimizerTask();
    await seedOrgOptimizerTask();
    const all = await repo.listAllAsync();
    for (const old of legacy) expect(all.find(task => task.id === old.id)).toMatchObject({ enabled: false, prompt: 'legacy' });
    expect(all.find(task => task.id === unrelated.id)).toEqual(unrelated);
    expect(all.filter(task => task.name === 'Org Reviewer' && task.enabled)).toHaveLength(1);
    expect(all).toHaveLength(legacy.length + 2);
  });

  it('preserves the old audit task owner on the replacement', async () => {
    const user = new UsersRepository().create({ name: 'Synthetic owner', email: 'owner@example.invalid' });
    await repo.createAsync({ name: 'Org Self-Optimizer', scheduleType: 'daily', prompt: 'legacy', createdByUserId: user.id });
    await seedOrgOptimizerTask();
    expect((await repo.listAllAsync()).find(task => task.name === 'Org Reviewer')!.createdByUserId).toBe(user.id);
  });

  it('preserves deliberate task disable and deletion across subsequent boots', async () => {
    await seedOrgOptimizerTask();
    const first = (await repo.listAllAsync())[0];
    await repo.updateAsync(first.id, { enabled: false, scheduledTime: '09:45' });
    await seedOrgOptimizerTask();
    expect(await repo.findByIdAsync(first.id)).toMatchObject({ enabled: false, scheduledTime: '09:45' });
    await repo.deleteAsync(first.id);
    expect((await seedOrgOptimizerTask()).reviewerTaskSkippedReason).toContain('deleted by user');
    expect(await repo.listAllAsync()).toHaveLength(0);
  });

  it('disables reviewer duplicates and never re-enables a disabled canonical task', async () => {
    await seedOrgOptimizerTask();
    const original = (await repo.listAllAsync())[0];
    const duplicate = await repo.createAsync({ ...reviewerInput, name: 'Org Reviewer v2' });
    await seedOrgOptimizerTask();
    expect((await repo.listAllAsync()).filter(task => task.enabled).map(task => task.id)).toEqual([original.id]);
    await repo.updateAsync(original.id, { enabled: false });
    await repo.updateAsync(duplicate.id, { enabled: true });
    await seedOrgOptimizerTask();
    expect((await repo.listAllAsync()).filter(task => task.enabled)).toHaveLength(0);
  });

  it('disables a reviewer task with widened scope or model override without rewriting it', async () => {
    await seedOrgOptimizerTask();
    const task = (await repo.listAllAsync())[0];
    await repo.updateAsync(task.id, { allowedMcpsJson: '{}', modelProvider: 'anthropic', modelId: 'unexpected' });
    await seedOrgOptimizerTask();
    expect(await repo.findByIdAsync(task.id)).toMatchObject({ enabled: false, allowedMcpsJson: '{}', modelProvider: 'anthropic', modelId: 'unexpected' });
  });
});
