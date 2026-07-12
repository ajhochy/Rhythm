/**
 * Seeded scheduled tasks — durable delete (no resurrection on boot).
 *
 * Boot-time task seeds used row-existence-by-name as their idempotency
 * guard, which can't tell "never seeded" from "the user deleted the seeded
 * task" — so every restart resurrected tasks the user had removed. The
 * seed_once markers (schema_meta) fix that: seeding is one-time per install,
 * and a user's delete is a config edit that survives restarts like any other.
 * Same fix pattern in sundayPrepService, ministry_recipes_seed, and
 * org_optimizer_seed (all share seed_once.ts); agentMemoryService is
 * exercised here as the representative (no role-file fixtures needed).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { agentMemoryService } from '../services/agentMemoryService';
import { AgentScheduledTasksRepository } from '../repositories/agent_scheduled_tasks_repository';
import { recordSeedMarker, seedMarkerExists } from '../services/seed_once';

describe('seeded scheduled tasks — durable delete', () => {
  beforeEach(() => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
  });

  it('a deleted seeded task stays deleted across re-seeds (boot replay)', async () => {
    const repo = new AgentScheduledTasksRepository();

    await agentMemoryService.seedConsolidationTask();
    const seeded = (await repo.listAllAsync()).find((t) => t.name === 'Memory Consolidation');
    expect(seeded, 'first boot seeds the task').toBeDefined();

    await repo.deleteAsync(seeded!.id);

    // Next boot must NOT resurrect it.
    await agentMemoryService.seedConsolidationTask();
    expect(
      (await repo.listAllAsync()).some((t) => t.name === 'Memory Consolidation'),
      'a user-deleted seeded task must not be resurrected on the next boot',
    ).toBe(false);
  });

  it('adopts pre-marker installs: existing row is untouched, then its delete sticks', async () => {
    const repo = new AgentScheduledTasksRepository();

    // Simulate an install seeded before markers existed: row present (with a
    // user-customized prompt), no marker.
    await repo.createAsync({
      name: 'Memory Interview',
      description: 'user-tuned',
      scheduleType: 'weekly',
      scheduledTime: '09:00',
      timezone: 'America/Los_Angeles',
      prompt: 'user-customized prompt',
      agentKind: 'opencode',
    });

    await agentMemoryService.seedMemoryInterviewTask(); // adopts, never rewrites
    const row = (await repo.listAllAsync()).find((t) => t.name === 'Memory Interview')!;
    expect(row.prompt, 'adoption must not rewrite the user prompt').toBe(
      'user-customized prompt',
    );

    await repo.deleteAsync(row.id);
    await agentMemoryService.seedMemoryInterviewTask();
    expect(
      (await repo.listAllAsync()).some((t) => t.name === 'Memory Interview'),
      'delete after adoption must survive the next boot',
    ).toBe(false);
  });

  it('seed markers are durable schema_meta rows', () => {
    expect(seedMarkerExists('some_marker')).toBe(false);
    recordSeedMarker('some_marker');
    expect(seedMarkerExists('some_marker')).toBe(true);
    recordSeedMarker('some_marker'); // idempotent
    expect(seedMarkerExists('some_marker')).toBe(true);
  });
});
