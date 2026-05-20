/**
 * Unit tests for SyncOrchestratorService.mirrorProductionTasksAsync
 *
 * Issue #620: the sync orchestrator previously had no mechanism to pull tasks
 * from the production server (api.vcrcapps.com) into the local agent server's
 * SQLite database.  These tests verify:
 *
 *   1. A freshly-created production task is upserted into the local DB within
 *      one mirrorProductionTasksAsync() call.
 *   2. Tasks are re-upserted idempotently on the second call (no duplicates).
 *   3. Pagination: tasks beyond the first page are fetched and upserted.
 *   4. When PROD_API_URL is not set, mirroring is skipped silently.
 *   5. When the production server returns an error, mirroring fails gracefully
 *      (returns { upserted: 0, skipped: 0 }) without throwing.
 *   6. A task whose ID already exists verbatim in the local DB (pre-split
 *      task) is updated in-place, not duplicated.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { TasksRepository } from '../../repositories/tasks_repository';
import { UsersRepository } from '../../repositories/users_repository';
import { SyncOrchestratorService } from '../sync_orchestrator_service';
import * as envModule from '../../config/env';

// ---------------------------------------------------------------------------
// Minimal mocks for services that SyncOrchestratorService pulls in but that
// are not relevant to the production-mirror path.
// ---------------------------------------------------------------------------

vi.mock('../rhythm_signal_generator_service', () => ({
  RhythmSignalGeneratorService: vi.fn().mockImplementation(function () { return {
    generateTaskDueSignalsAsync: vi.fn().mockResolvedValue([]),
    generateProjectStepDueSignalsAsync: vi.fn().mockResolvedValue([]),
  }; }),
}));

vi.mock('../../repositories/automation_signals_repository', () => ({
  AutomationSignalsRepository: vi.fn().mockImplementation(function () { return {
    upsertManyDetailedAsync: vi.fn().mockResolvedValue({ changedSignals: [] }),
  }; }),
}));

vi.mock('../automation_engine_service', () => ({
  AutomationEngineService: vi.fn().mockImplementation(function () { return {
    evaluateSignals: vi.fn().mockResolvedValue({ matchedRules: 0 }),
  }; }),
}));

vi.mock('../../repositories/integration_accounts_repository', () => ({
  IntegrationAccountsRepository: vi.fn().mockImplementation(function () { return {
    findAllAsync: vi.fn().mockResolvedValue([]),
    findByProviderAsync: vi.fn().mockResolvedValue(null),
  }; }),
}));

vi.mock('../integrations_service', () => ({
  IntegrationsService: vi.fn().mockImplementation(function () { return {
    syncGoogleCalendar: vi.fn().mockResolvedValue({ syncedCount: 0 }),
    syncGmail: vi.fn().mockResolvedValue({ syncedCount: 0 }),
    syncPlanningCenter: vi.fn().mockResolvedValue({ planCount: 0 }),
  }; }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  return db;
}

/** Build a minimal production task payload. */
function prodTask(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    title: `Prod task ${id}`,
    notes: null,
    dueDate: null,
    scheduledDate: null,
    scheduledOrder: null,
    locked: false,
    status: 'open',
    sourceType: null,
    sourceId: null,
    ownerId: null,
    preferredAgent: null,
    ...overrides,
  };
}

/** Override env fields for a single test. */
function withEnv(overrides: Partial<typeof envModule.env>) {
  const original = { ...envModule.env };
  Object.assign(envModule.env, overrides);
  return () => Object.assign(envModule.env, original);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SyncOrchestratorService.mirrorProductionTasksAsync', () => {
  let tasksRepo: TasksRepository;
  // Default no-op so afterEach is safe even when beforeEach throws (e.g. ABI).
  let restoreEnv: () => void = () => undefined;

  beforeEach(() => {
    setDb(makeDb());
    tasksRepo = new TasksRepository();
    restoreEnv = withEnv({
      prodApiUrl: 'https://api.example.com',
      prodAuthToken: 'test-token',
    });
  });

  afterEach(() => {
    restoreEnv();
    restoreEnv = () => undefined;
    vi.restoreAllMocks();
  });

  it('upserts a production task into the local SQLite on the first sync cycle', async () => {
    const task1 = prodTask('prod-uuid-1', { title: 'Design Archive/Abandon Task feature' });

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [task1],
    } as unknown as Response);

    const orchestrator = new SyncOrchestratorService();
    const result = await orchestrator.mirrorProductionTasksAsync();

    expect(result.upserted).toBe(1);
    expect(result.skipped).toBe(0);

    // The task must now be findable in the local SQLite by its production UUID
    // via the prod_mirror source_type/source_id key.
    const found = await tasksRepo.findBySourceAsync('prod_mirror', 'prod-uuid-1');
    expect(found).not.toBeNull();
    expect(found!.title).toBe('Design Archive/Abandon Task feature');
  });

  it('is idempotent — re-running the mirror does not duplicate tasks', async () => {
    const task1 = prodTask('prod-uuid-2');

    // Two consecutive syncs return the same task.
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [task1] } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [task1] } as unknown as Response);

    const orchestrator = new SyncOrchestratorService();
    await orchestrator.mirrorProductionTasksAsync();
    await orchestrator.mirrorProductionTasksAsync();

    // findAllIncludingLegacy should contain exactly one row for this prod ID.
    const all = tasksRepo.findAllIncludingLegacy();
    const matching = all.filter((t) => t.sourceId === 'prod-uuid-2');
    expect(matching).toHaveLength(1);
  });

  it('fetches multiple pages when the first page is full', async () => {
    const PAGE = 100;
    const page1 = Array.from({ length: PAGE }, (_, i) => prodTask(`page1-${i}`));
    const page2 = [prodTask('page2-0'), prodTask('page2-1')];

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => page1 } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => page2 } as unknown as Response);

    const orchestrator = new SyncOrchestratorService();
    const result = await orchestrator.mirrorProductionTasksAsync();

    expect(result.upserted).toBe(PAGE + 2);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('skips mirroring silently when PROD_API_URL is not set', async () => {
    restoreEnv(); // undo the beforeEach override
    restoreEnv = withEnv({ prodApiUrl: null, prodAuthToken: null });

    global.fetch = vi.fn();

    const orchestrator = new SyncOrchestratorService();
    const result = await orchestrator.mirrorProductionTasksAsync();

    expect(result).toEqual({ upserted: 0, skipped: 0 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns { upserted: 0, skipped: 0 } when the production API is unreachable', async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const orchestrator = new SyncOrchestratorService();
    const result = await orchestrator.mirrorProductionTasksAsync();

    expect(result).toEqual({ upserted: 0, skipped: 0 });
  });

  it('updates a pre-split task (verbatim ID in local DB) without duplicating it', async () => {
    // Seed a task whose ID matches the production UUID verbatim (pre-split task).
    const usersRepo = new UsersRepository();
    const user = usersRepo.create({ name: 'Alice', email: 'alice@example.com' });

    const seeded = await tasksRepo.createAsync({
      title: 'Old local title',
      status: 'open',
      ownerId: user.id,
    });

    // Production has the same task ID with an updated title.
    const prodPayload = prodTask(seeded.id, { title: 'Updated prod title' });
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [prodPayload],
    } as unknown as Response);

    const orchestrator = new SyncOrchestratorService();
    const result = await orchestrator.mirrorProductionTasksAsync();

    expect(result.upserted).toBe(1);

    const allTasks = tasksRepo.findAllIncludingLegacy();
    // Still only one task (the seeded one) — not duplicated.
    expect(allTasks).toHaveLength(1);
    expect(allTasks[0].title).toBe('Updated prod title');
  });
});
