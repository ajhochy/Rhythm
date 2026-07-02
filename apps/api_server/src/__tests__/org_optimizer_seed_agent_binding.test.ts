/**
 * CONTRACT TEST — docs/ai/contracts/fix-recipe-binding.json, criterion
 * fix-recipe-binding-c6.
 *
 * The #846 ministry-recipes dangling-binding bug does NOT reproduce for
 * org_optimizer_seed.ts, because that seed's `ensureAgentConfigForRole`
 * helper INSERTS the `agent_configs` row itself, keyed by the role file's own
 * `agentConfigId`, the first time it runs (idempotent by that id via
 * `getById`) — unlike ministry_recipes_seed.ts, which only ever READS an
 * agent_configs row that some other process (syncOpencodeAgentProfiles) may
 * or may not have created under a different key (the slug).
 *
 * This test proves that safety directly: seed against a completely empty
 * agent_configs table (no pre-existing rows of ANY kind — the worst case for
 * ministry_recipes_seed) and assert both scheduled tasks still end up bound
 * to a real, resolvable agent_configs row.
 *
 * Regression this catches: if a future change makes org_optimizer_seed READ
 * an existing row instead of creating one (e.g. refactored to share the
 * ministry_recipes_seed resolution helper without preserving the
 * self-creation fallback), this test fails because the join count drops to 0
 * exactly like the original #846 bug.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentScheduledTasksRepository } from '../repositories/agent_scheduled_tasks_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';

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

describe('org_optimizer_seed agent binding hazard check (fix-recipe-binding-c6)', () => {
  it('fix-recipe-binding-c6: org_optimizer_seed always self-creates a resolvable agent_configs row keyed by its own agentConfigId (no dangling-binding hazard)', async () => {
    const configsRepoBefore = new AgentConfigsRepository();
    // Confirm the worst case: no org-optimizer agent_configs row exists yet
    // (neither UUID-keyed nor slug-keyed) — only the built-in CLI presets
    // from migrations (claude-code, etc.) are present, mirroring a totally
    // fresh DB that has never run this seed before.
    expect(configsRepoBefore.getById('8f1c2d3e-4a5b-4c6d-9e7f-0a1b2c3d4e5f')).toBeNull();
    expect(configsRepoBefore.getById('9a2d3e4f-5b6c-4d7e-8f9a-1b2c3d4e5f6a')).toBeNull();
    expect(configsRepoBefore.getById('org-optimizer')).toBeNull();
    expect(configsRepoBefore.getById('org-external-discovery')).toBeNull();

    const { seedOrgOptimizerTask } = await import('../services/org_optimizer_seed');
    const result = await seedOrgOptimizerTask();

    expect(result.auditTaskSeeded).toBe(true);
    expect(result.externalTaskSeeded).toBe(true);

    const schedRepo = new AgentScheduledTasksRepository();
    const configsRepo = new AgentConfigsRepository();
    const tasks = await schedRepo.listAllAsync();

    const audit = tasks.find((t) => t.name === 'Org Self-Optimizer');
    const external = tasks.find((t) => t.name === 'Org External Discovery');
    expect(audit).toBeDefined();
    expect(external).toBeDefined();

    // The load-bearing assertion: each task's agent_config_id resolves to a
    // REAL agent_configs row — the seed created it itself.
    expect(audit!.agentConfigId).not.toBeNull();
    expect(external!.agentConfigId).not.toBeNull();
    expect(configsRepo.getById(audit!.agentConfigId!)).not.toBeNull();
    expect(configsRepo.getById(external!.agentConfigId!)).not.toBeNull();

    // Re-running is idempotent and the rows remain resolvable (no thrash).
    const second = await seedOrgOptimizerTask();
    expect(second.auditTaskSeeded).toBe(false);
    expect(second.externalTaskSeeded).toBe(false);
    const tasksAfter = await schedRepo.listAllAsync();
    expect(tasksAfter.filter((t) => t.name === 'Org Self-Optimizer')).toHaveLength(1);
    expect(tasksAfter.filter((t) => t.name === 'Org External Discovery')).toHaveLength(1);
  });

  it('#855b: seeded optimizer configs carry a concrete model (else their turns stall on "no route in catalog")', async () => {
    const { seedOrgOptimizerTask } = await import('../services/org_optimizer_seed');
    await seedOrgOptimizerTask();
    const configsRepo = new AgentConfigsRepository();
    for (const id of [
      '8f1c2d3e-4a5b-4c6d-9e7f-0a1b2c3d4e5f',
      '9a2d3e4f-5b6c-4d7e-8f9a-1b2c3d4e5f6a',
    ]) {
      const cfg = configsRepo.getById(id);
      expect(cfg).not.toBeNull();
      expect(cfg!.modelProvider).toBe('anthropic');
      expect(cfg!.modelId).toBe('claude-sonnet-4-6');
    }
  });

  it('#855b: NULL model is repaired on a re-seed even when the TASK already exists (the real already-seeded case; task name-guard must not skip the repair)', async () => {
    const { seedOrgOptimizerTask } = await import('../services/org_optimizer_seed');
    const configsRepo = new AgentConfigsRepository();

    // First boot: seeds both tasks + configs (with the model default).
    const first = await seedOrgOptimizerTask();
    expect(first.auditTaskSeeded).toBe(true);

    // Simulate a row seeded BEFORE the model default existed: null it out while
    // the TASK stays present, so the next seed short-circuits the task guard.
    configsRepo.update('8f1c2d3e-4a5b-4c6d-9e7f-0a1b2c3d4e5f', {
      modelProvider: null,
      modelId: null,
    });
    expect(configsRepo.getById('8f1c2d3e-4a5b-4c6d-9e7f-0a1b2c3d4e5f')!.modelProvider).toBeNull();

    // Second boot: task already exists (guard skips creation) — the repair MUST
    // still fire because it runs before the guard.
    const second = await seedOrgOptimizerTask();
    expect(second.auditTaskSeeded).toBe(false); // guard short-circuited task creation
    const repaired = configsRepo.getById('8f1c2d3e-4a5b-4c6d-9e7f-0a1b2c3d4e5f')!;
    expect(repaired.modelProvider).toBe('anthropic');
    expect(repaired.modelId).toBe('claude-sonnet-4-6');
  });

  it('#855b: a user-set model on an existing optimizer row is NOT overwritten', async () => {
    const configsRepo = new AgentConfigsRepository();
    configsRepo.insert({
      id: '8f1c2d3e-4a5b-4c6d-9e7f-0a1b2c3d4e5f',
      label: 'Org Optimizer',
      icon: 'x',
      isAgent: true,
      isManager: false,
      modelProvider: 'openai',
      modelId: 'gpt-5.5',
      sessionSelectable: false,
    });
    const { seedOrgOptimizerTask } = await import('../services/org_optimizer_seed');
    await seedOrgOptimizerTask();
    const cfg = configsRepo.getById('8f1c2d3e-4a5b-4c6d-9e7f-0a1b2c3d4e5f')!;
    expect(cfg.modelProvider).toBe('openai');
    expect(cfg.modelId).toBe('gpt-5.5');
  });
});
