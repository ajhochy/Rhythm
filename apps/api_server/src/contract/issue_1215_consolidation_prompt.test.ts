import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { getDb, setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentScheduledTasksRepository } from '../repositories/agent_scheduled_tasks_repository';
import { agentMemoryService } from '../services/agentMemoryService';
import {
  LEGACY_MEMORY_CONSOLIDATION_PROMPT_V1,
  MEMORY_CONSOLIDATION_REPAIR_KEY,
} from '../services/memory_consolidation_seed';

const SUPPORTED_PROMPT_TOOLS = new Set([
  'rhythm_list_sessions',
  'rhythm_search_memory',
  'rhythm_remember_memory',
]);

beforeEach(() => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
});

async function seedRow() {
  await agentMemoryService.seedConsolidationTask();
  return (await new AgentScheduledTasksRepository().listAllAsync())
    .find((task) => task.name === 'Memory Consolidation')!;
}

describe('issue #1215 versioned consolidation prompt contract', () => {
  it('issue-1215-c1: fresh seed references only the supported consolidation tool surface', async () => {
    const task = await seedRow();
    const mentioned = new Set(task.prompt.match(/rhythm_[a-z_]+/g) ?? []);

    expect(mentioned).toEqual(SUPPORTED_PROMPT_TOOLS);
    expect(task.prompt).toContain('rhythm_list_sessions');
    expect(task.prompt).toContain('sessionId');
  });

  it('issue-1215-c2: fresh seed has no incompatible file-memory skill', async () => {
    const task = await seedRow();

    expect(JSON.parse(task.allowedSkillsJson ?? '[]')).toEqual([]);
    expect(task.prompt).not.toContain('consolidate-memory');
  });

  it('issue-1215-c3: prompt stays within the supported consolidation workflow', async () => {
    const task = await seedRow();

    for (const unsupportedClaim of [
      'staleAfter',
      'rhythm_verify_memory',
      'deprecat',
      'rollback',
    ]) {
      expect(task.prompt).not.toContain(unsupportedClaim);
    }
  });

  it('issue-1215-c4: versioned migration repairs only the known legacy managed row', async () => {
    const managed = await seedRow();
    const repo = new AgentScheduledTasksRepository();
    getDb().prepare(`
      UPDATE agent_scheduled_tasks
         SET prompt = ?, allowed_skills_json = ?
       WHERE id = ?
    `).run(
      LEGACY_MEMORY_CONSOLIDATION_PROMPT_V1,
      JSON.stringify(['anthropic-skills:consolidate-memory']),
      managed.id,
    );
    getDb().prepare(`DELETE FROM schema_meta WHERE key = ?`).run(
      MEMORY_CONSOLIDATION_REPAIR_KEY,
    );
    await repo.createAsync({
      name: 'Memory Consolidation',
      description: 'A user-authored task with the same display name.',
      scheduleType: 'weekly',
      scheduledTime: '13:00',
      timezone: 'UTC',
      prompt: 'My user-authored consolidation prompt.',
      agentKind: 'opencode',
      allowedMcpsJson: JSON.stringify(['custom']),
      allowedSkillsJson: JSON.stringify(['custom-skill']),
    });

    runMigrations(getDb());

    const rows = (await repo.listAllAsync()).filter((task) => task.name === 'Memory Consolidation');
    const repaired = rows.find((task) => task.id === managed.id)!;
    const custom = rows.find((task) => task.id !== managed.id)!;
    expect(JSON.parse(repaired.allowedSkillsJson ?? '[]')).toEqual([]);
    expect(repaired.prompt).not.toContain('anthropic-skills:consolidate-memory');
    expect(custom.prompt).toBe('My user-authored consolidation prompt.');
    expect(custom.allowedSkillsJson).toBe(JSON.stringify(['custom-skill']));
  });

  it('issue-1215-c5: deleted managed seed is not resurrected', async () => {
    const repo = new AgentScheduledTasksRepository();
    const task = await seedRow();
    await repo.deleteAsync(task.id);

    runMigrations(getDb());
    await agentMemoryService.seedConsolidationTask();

    expect((await repo.listAllAsync()).some((row) => row.name === 'Memory Consolidation')).toBe(false);
  });

  it('issue-1215-c6: repaired seed is stable across migration and boot replay', async () => {
    const initial = await seedRow();
    runMigrations(getDb());
    await agentMemoryService.seedConsolidationTask();
    runMigrations(getDb());

    const rows = (await new AgentScheduledTasksRepository().listAllAsync())
      .filter((task) => task.name === 'Memory Consolidation');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(initial.id);
    expect(JSON.parse(rows[0].allowedSkillsJson ?? '[]')).toEqual([]);
  });
});
