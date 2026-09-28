/**
 * CONTRACT TEST for #1485 slice S3a-1 — workflow repository, transition
 * engine, fan-out, budgets, DTO. Uses ONLY an injected fake StageDispatcher —
 * no AgentRunner wiring here (that's S3a-2, per the lane notes: "Keep it
 * pure with a fake dispatcher").
 *
 * Also folds in a coordinator review follow-up: AgentCookbook.format must be
 * DERIVED (v1 when a valid definition is present, legacy otherwise), not
 * hardcoded, now that this slice starts writing definitions.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecipeWorkflowDefinitionV1 } from '../../contracts/recipe_workflow_contract';
import type { StageDispatchOutcome, StageDispatcher } from '../../services/recipe_workflow_runner';

function makeLinearDefinition(overrides: {
  budgets?: Partial<RecipeWorkflowDefinitionV1['budgets']>;
  loop?: Record<string, unknown>;
} = {}): RecipeWorkflowDefinitionV1 {
  return {
    schemaVersion: 1,
    entryStageId: 'start',
    budgets: {
      maxCostUsd: 1000, maxTokens: 1_000_000, maxWallTimeMs: 3_600_000, maxStageExecutions: 100,
      ...overrides.budgets,
    },
    stages: [
      { id: 'start', kind: 'agent', profileId: 'p', inputs: {}, output: { fields: { outcome: 'string' } }, next: 'gate1' },
      {
        id: 'gate1', kind: 'gate', producerStageId: 'start',
        branches: { pass: 'done_pass', fail: 'done_fail', repair: 'redo' },
        onInvalid: 'done_invalid',
        loop: {
          loopId: 'L1', maxIterations: 2, maxCostUsd: 1000, maxTokens: 1_000_000, maxWallTimeMs: 3_600_000,
          exhaustedTarget: 'done_exhausted',
          ...overrides.loop,
        },
      },
      { id: 'redo', kind: 'agent', profileId: 'p', inputs: {}, output: { fields: {} }, next: 'start' },
      { id: 'done_pass', kind: 'agent', profileId: 'p', terminal: true, inputs: {}, output: { fields: {} } },
      { id: 'done_fail', kind: 'agent', profileId: 'p', terminal: true, inputs: {}, output: { fields: {} } },
      { id: 'done_invalid', kind: 'agent', profileId: 'p', terminal: true, inputs: {}, output: { fields: {} } },
      { id: 'done_exhausted', kind: 'agent', profileId: 'p', terminal: true, inputs: {}, output: { fields: {} } },
    ],
  } as RecipeWorkflowDefinitionV1;
}

function makeFanOutDefinition(): RecipeWorkflowDefinitionV1 {
  return {
    schemaVersion: 1,
    entryStageId: 'producer',
    budgets: { maxCostUsd: 1000, maxTokens: 1_000_000, maxWallTimeMs: 3_600_000, maxStageExecutions: 100 },
    stages: [
      {
        id: 'producer', kind: 'agent', profileId: 'p', inputs: {},
        output: { fields: {}, items: { keyField: 'id', fields: { id: 'string' } } },
        next: 'fan',
      },
      {
        id: 'fan', kind: 'fanOut', itemsFrom: { stageId: 'producer' }, itemKey: 'item',
        entryStageId: 'child', join: 'all', next: 'after',
        stages: [
          {
            id: 'child', kind: 'agent', profileId: 'p', terminal: true,
            inputs: { itemId: { source: 'currentItem', field: 'id', type: 'string' } },
            output: { fields: {} },
          },
        ],
      },
      { id: 'after', kind: 'agent', profileId: 'p', terminal: true, inputs: {}, output: { fields: {} } },
    ],
  } as RecipeWorkflowDefinitionV1;
}

async function setup(dbClient: 'sqlite' | 'postgres' = 'sqlite', flagValue = 'true') {
  vi.resetModules();
  vi.stubEnv('RHYTHM_RECIPE_WORKFLOWS_ENABLED', flagValue);
  vi.stubEnv('DB_CLIENT', dbClient);

  const { setDb } = await import('../../database/db');
  const { runMigrations } = await import('../../database/migrations');
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);

  const { AgentCookbookRepository } = await import('../../repositories/agent_cookbook_repository');
  const { RecipeWorkflowRunner } = await import('../../services/recipe_workflow_runner');
  const { RecipeWorkflowRepository } = await import('../../repositories/recipe_workflow_repository');
  return {
    db,
    cookbookRepo: new AgentCookbookRepository(),
    runner: new RecipeWorkflowRunner(),
    repo: new RecipeWorkflowRepository(),
  };
}

function outcome(o: StageDispatchOutcome['outputFields']): StageDispatchOutcome {
  return { status: 'succeeded', outputFields: o, costUsd: 1, tokens: 100 };
}

describe('#1485 S3a-1 — AgentCookbook.format is derived, not hardcoded', () => {
  beforeEach(async () => {
    vi.resetModules();
    const { setDb } = await import('../../database/db');
    const { runMigrations } = await import('../../database/migrations');
    const db = new Database(':memory:');
    runMigrations(db);
    setDb(db);
  });
  afterEach(() => vi.resetModules());

  it('recipe_workflow_s3a:format:1 — no definitionJson -> legacy', async () => {
    const { AgentCookbookRepository } = await import('../../repositories/agent_cookbook_repository');
    const repo = new AgentCookbookRepository();
    const created = await repo.createAsync({ title: 'Legacy recipe' });
    expect(created.format).toBe('legacy');
  });

  it('recipe_workflow_s3a:format:2 — a valid v1 definitionJson -> v1', async () => {
    const { AgentCookbookRepository } = await import('../../repositories/agent_cookbook_repository');
    const repo = new AgentCookbookRepository();
    const definition = makeLinearDefinition();
    const created = await repo.createAsync({
      title: 'Workflow recipe', schemaVersion: 1, definitionJson: JSON.stringify(definition),
    });
    expect(created.format).toBe('v1');
    const fetched = await repo.findByIdAsync(created.id);
    expect(fetched!.format).toBe('v1');
  });

  it('recipe_workflow_s3a:format:3 — an invalid stored definition reports legacy, never a new state', async () => {
    const { AgentCookbookRepository } = await import('../../repositories/agent_cookbook_repository');
    const repo = new AgentCookbookRepository();
    const created = await repo.createAsync({
      title: 'Broken', schemaVersion: 1, definitionJson: JSON.stringify({ schemaVersion: 1 }),
    });
    expect(created.format).toBe('legacy');
  });
});

describe('#1485 S3a-1 — start() gating', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it('recipe_workflow_s3a:1 — flag on, SQLite: persists the run and returns {runId, status:pending} before any dispatch', async () => {
    const { cookbookRepo, runner, db } = await setup('sqlite', 'true');
    const recipe = await cookbookRepo.createAsync({
      title: 'Wf', schemaVersion: 1, definitionJson: JSON.stringify(makeLinearDefinition()),
    });
    const result = await runner.start({ recipeId: recipe.id, ownerUserId: null, input: {} });
    expect(result).toEqual(expect.objectContaining({ ok: true, status: 'pending' }));
    const count = db.prepare('SELECT COUNT(*) as c FROM recipe_workflow_runs').get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('recipe_workflow_s3a:2 — flag off: returns disabled, creates no row', async () => {
    const { cookbookRepo, runner, db } = await setup('sqlite', 'false');
    const recipe = await cookbookRepo.createAsync({
      title: 'Wf', schemaVersion: 1, definitionJson: JSON.stringify(makeLinearDefinition()),
    });
    const result = await runner.start({ recipeId: recipe.id, ownerUserId: null, input: {} });
    expect(result).toEqual({ ok: false, reason: 'disabled' });
    const count = db.prepare('SELECT COUNT(*) as c FROM recipe_workflow_runs').get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('recipe_workflow_s3a:3 — flag on, Postgres deployment: returns workflow_execution_unavailable, creates no row', async () => {
    const { cookbookRepo, runner, db } = await setup('sqlite', 'true');
    const recipe = await cookbookRepo.createAsync({
      title: 'Wf', schemaVersion: 1, definitionJson: JSON.stringify(makeLinearDefinition()),
    });
    vi.stubEnv('DB_CLIENT', 'postgres');
    vi.resetModules();
    vi.stubEnv('RHYTHM_RECIPE_WORKFLOWS_ENABLED', 'true');
    vi.stubEnv('DB_CLIENT', 'postgres');
    const { setDb } = await import('../../database/db');
    setDb(db); // reuse the same sqlite db instance as the local dev db under the pg env flag
    const { RecipeWorkflowRunner } = await import('../../services/recipe_workflow_runner');
    const pgRunner = new RecipeWorkflowRunner();
    const result = await pgRunner.start({ recipeId: recipe.id, ownerUserId: null, input: {} });
    expect(result).toEqual({ ok: false, reason: 'workflow_execution_unavailable' });
    const count = db.prepare('SELECT COUNT(*) as c FROM recipe_workflow_runs').get() as { c: number };
    expect(count.c).toBe(0);
  });
});

describe('#1485 S3a-1 — verdict routing with a fake dispatcher', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  async function startLinear(defOverrides: Parameters<typeof makeLinearDefinition>[0] = {}) {
    const { cookbookRepo, runner, repo } = await setup('sqlite', 'true');
    const recipe = await cookbookRepo.createAsync({
      title: 'Wf', schemaVersion: 1, definitionJson: JSON.stringify(makeLinearDefinition(defOverrides)),
    });
    const started = await runner.start({ recipeId: recipe.id, ownerUserId: null, input: {} });
    if (!started.ok) throw new Error('setup failed');
    return { runner, repo, runId: started.runId };
  }

  it('recipe_workflow_s3a:4 — pass routes to branches.pass', async () => {
    const { runner, runId } = await startLinear();
    const dispatcher: StageDispatcher = vi.fn(async () => outcome({ outcome: 'pass' }));
    await runner.tick(runId, dispatcher);
    const dto = runner.getDto(runId)!;
    expect(dto.status).toBe('succeeded');
    expect(dto.stages.find((s) => s.stageId === 'done_pass')?.status).toBe('succeeded');
  });

  it('recipe_workflow_s3a:5 — fail routes to branches.fail', async () => {
    const { runner, runId } = await startLinear();
    const dispatcher: StageDispatcher = vi.fn(async () => outcome({ outcome: 'fail' }));
    await runner.tick(runId, dispatcher);
    const dto = runner.getDto(runId)!;
    expect(dto.status).toBe('succeeded'); // the RUN succeeds structurally at done_fail (a terminal marker)
    expect(dto.stages.find((s) => s.stageId === 'done_fail')?.status).toBe('succeeded');
    expect(dto.stages.find((s) => s.stageId === 'gate1')?.outcome).toBe('fail');
  });

  it('recipe_workflow_s3a:6 — repair routes to branches.repair and loops back, eventually reaching pass', async () => {
    const { runner, runId } = await startLinear();
    let call = 0;
    const dispatcher: StageDispatcher = vi.fn(async () => {
      call += 1;
      return outcome({ outcome: call < 2 ? 'repair' : 'pass' });
    });
    for (let i = 0; i < 6; i++) await runner.tick(runId, dispatcher);
    const dto = runner.getDto(runId)!;
    expect(dto.status).toBe('succeeded');
    expect(dto.stages.find((s) => s.stageId === 'done_pass')?.status).toBe('succeeded');
  });

  it('recipe_workflow_s3a:7 — an invalid verdict (missing/malformed outcome) routes to onInvalid and can never succeed', async () => {
    const { runner, runId } = await startLinear();
    const dispatcher: StageDispatcher = vi.fn(async () => outcome({ notOutcome: 'garbage' }));
    await runner.tick(runId, dispatcher);
    const dto = runner.getDto(runId)!;
    expect(dto.stages.find((s) => s.stageId === 'gate1')?.status).toBe('failed');
    expect(dto.stages.find((s) => s.stageId === 'gate1')?.outcome).toBeNull();
    expect(dto.stages.find((s) => s.stageId === 'done_invalid')?.status).toBe('succeeded');
    // Re-ticking can never resurrect gate1 into 'succeeded'.
    await runner.tick(runId, dispatcher);
    expect(runner.getDto(runId)!.stages.find((s) => s.stageId === 'gate1')?.status).toBe('failed');
  });
});

describe('#1485 S3a-1 — loop caps (each of the four stops the loop independently)', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  async function startWithLoop(loopOverride: Record<string, unknown>) {
    const { cookbookRepo, runner, repo } = await setup('sqlite', 'true');
    const recipe = await cookbookRepo.createAsync({
      title: 'Wf', schemaVersion: 1, definitionJson: JSON.stringify(makeLinearDefinition({ loop: loopOverride })),
    });
    const started = await runner.start({ recipeId: recipe.id, ownerUserId: null, input: {} });
    if (!started.ok) throw new Error('setup failed');
    return { runner, runId: started.runId, repo };
  }

  it('recipe_workflow_s3a:8 — maxIterations stops the loop and routes to exhaustedTarget', async () => {
    const { runner, runId } = await startWithLoop({ maxIterations: 1 });
    const dispatcher: StageDispatcher = vi.fn(async () => outcome({ outcome: 'repair' }));
    for (let i = 0; i < 6; i++) await runner.tick(runId, dispatcher);
    const dto = runner.getDto(runId)!;
    expect(dto.stages.find((s) => s.stageId === 'done_exhausted')?.status).toBe('succeeded');
  });

  it('recipe_workflow_s3a_review:2 — exactly maxIterations repair cycles run before the loop is exhausted (no extra cycle past the cap)', async () => {
    const { runner, runId, repo } = await startWithLoop({ maxIterations: 3 });
    const dispatcher: StageDispatcher = vi.fn(async () => outcome({ outcome: 'repair' })); // never resolves — always needs repair
    for (let i = 0; i < 12; i++) await runner.tick(runId, dispatcher);

    const dto = runner.getDto(runId)!;
    expect(dto.stages.find((s) => s.stageId === 'done_exhausted')?.status).toBe('succeeded');

    const redoCalls = (dispatcher as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
      (c) => (c[0] as { stage: { id: string } }).stage.id === 'redo',
    );
    expect(redoCalls).toHaveLength(3); // exactly maxIterations repair-stage dispatches, not 4

    const usage = repo.getLoopUsage(runId, 'L1', null, null);
    expect(usage?.iterations).toBe(3);
  });

  it('recipe_workflow_s3a:9 — maxCostUsd stops the loop and routes to exhaustedTarget', async () => {
    const { runner, runId } = await startWithLoop({ maxIterations: 100, maxCostUsd: 1 });
    const dispatcher: StageDispatcher = vi.fn(async () => ({ status: 'succeeded', outputFields: { outcome: 'repair' }, costUsd: 1, tokens: 1 } as StageDispatchOutcome));
    for (let i = 0; i < 6; i++) await runner.tick(runId, dispatcher);
    const dto = runner.getDto(runId)!;
    expect(dto.stages.find((s) => s.stageId === 'done_exhausted')?.status).toBe('succeeded');
  });

  it('recipe_workflow_s3a:10 — maxTokens stops the loop and routes to exhaustedTarget', async () => {
    const { runner, runId } = await startWithLoop({ maxIterations: 100, maxTokens: 50 });
    const dispatcher: StageDispatcher = vi.fn(async () => ({ status: 'succeeded', outputFields: { outcome: 'repair' }, costUsd: 0, tokens: 100 } as StageDispatchOutcome));
    for (let i = 0; i < 6; i++) await runner.tick(runId, dispatcher);
    const dto = runner.getDto(runId)!;
    expect(dto.stages.find((s) => s.stageId === 'done_exhausted')?.status).toBe('succeeded');
  });

  it('recipe_workflow_s3a:11 — maxWallTimeMs stops the loop and routes to exhaustedTarget', async () => {
    const { runner, runId } = await startWithLoop({ maxIterations: 100, maxWallTimeMs: 1 });
    const dispatcher: StageDispatcher = vi.fn(async () => outcome({ outcome: 'repair' }));
    await runner.tick(runId, dispatcher); // first repair decision seeds loop started_at
    await new Promise((r) => setTimeout(r, 5));
    for (let i = 0; i < 6; i++) await runner.tick(runId, dispatcher);
    const dto = runner.getDto(runId)!;
    expect(dto.stages.find((s) => s.stageId === 'done_exhausted')?.status).toBe('succeeded');
  });
});

describe('#1485 S3a-1 — run-level budgets', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it('recipe_workflow_s3a:12 — exceeding maxStageExecutions produces budget_exhausted', async () => {
    const { cookbookRepo, runner } = await setup('sqlite', 'true');
    const recipe = await cookbookRepo.createAsync({
      title: 'Wf', schemaVersion: 1,
      definitionJson: JSON.stringify(makeLinearDefinition({ budgets: { maxStageExecutions: 1 } })),
    });
    const started = await runner.start({ recipeId: recipe.id, ownerUserId: null, input: {} });
    if (!started.ok) throw new Error('setup failed');
    const dispatcher: StageDispatcher = vi.fn(async () => outcome({ outcome: 'pass' }));
    await runner.tick(started.runId, dispatcher);
    const dto = runner.getDto(started.runId)!;
    expect(dto.status).toBe('budget_exhausted');
  });
});

describe('#1485 S3a-1 — one-level fan-out', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  async function startFanOut() {
    const { cookbookRepo, runner } = await setup('sqlite', 'true');
    const recipe = await cookbookRepo.createAsync({
      title: 'FanOutWf', schemaVersion: 1, definitionJson: JSON.stringify(makeFanOutDefinition()),
    });
    const started = await runner.start({ recipeId: recipe.id, ownerUserId: null, input: {} });
    if (!started.ok) throw new Error('setup failed');
    return { runner, runId: started.runId };
  }

  it('recipe_workflow_s3a:13 — dispatches the child stage once per keyed item, joins(all) only once every item is terminal', async () => {
    const { runner, runId } = await startFanOut();
    const dispatcher: StageDispatcher = vi.fn(async (ctx): Promise<StageDispatchOutcome> => {
      if (ctx.stage.id === 'producer') {
        return { status: 'succeeded', outputFields: { items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }, costUsd: 0, tokens: 0 };
      }
      return { status: 'succeeded', outputFields: {}, costUsd: 0, tokens: 0 };
    });
    for (let i = 0; i < 4; i++) await runner.tick(runId, dispatcher);
    const childCalls = (dispatcher as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
      (c) => (c[0] as { stage: { id: string } }).stage.id === 'child',
    );
    expect(childCalls).toHaveLength(3);
    const dto = runner.getDto(runId)!;
    expect(dto.stages.filter((s) => s.stageId === 'child')).toHaveLength(3);
    expect(dto.stages.find((s) => s.stageId === 'fan')?.status).toBe('succeeded');
    expect(dto.stages.find((s) => s.stageId === 'after')?.status).toBe('succeeded');
    expect(dto.status).toBe('succeeded');
  });

  it('recipe_workflow_s3a:14 — an empty item collection joins immediately with no child dispatch', async () => {
    const { runner, runId } = await startFanOut();
    const dispatcher: StageDispatcher = vi.fn(async (ctx): Promise<StageDispatchOutcome> => {
      if (ctx.stage.id === 'producer') return { status: 'succeeded', outputFields: { items: [] }, costUsd: 0, tokens: 0 };
      return { status: 'succeeded', outputFields: {}, costUsd: 0, tokens: 0 };
    });
    for (let i = 0; i < 4; i++) await runner.tick(runId, dispatcher);
    const childCalls = (dispatcher as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
      (c) => (c[0] as { stage: { id: string } }).stage.id === 'child',
    );
    expect(childCalls).toHaveLength(0);
    const dto = runner.getDto(runId)!;
    expect(dto.stages.find((s) => s.stageId === 'fan')?.status).toBe('succeeded');
    expect(dto.status).toBe('succeeded');
  });
});

describe('#1485 S3a-1 — idempotent claims/attempts under a duplicated tick', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it('recipe_workflow_s3a:15 — two concurrent ticks dispatch the same occurrence exactly once', async () => {
    const { cookbookRepo, runner } = await setup('sqlite', 'true');
    const recipe = await cookbookRepo.createAsync({
      title: 'Wf', schemaVersion: 1, definitionJson: JSON.stringify(makeLinearDefinition()),
    });
    const started = await runner.start({ recipeId: recipe.id, ownerUserId: null, input: {} });
    if (!started.ok) throw new Error('setup failed');
    const dispatcher: StageDispatcher = vi.fn(async () => {
      await Promise.resolve();
      return outcome({ outcome: 'pass' });
    });
    await Promise.all([runner.tick(started.runId, dispatcher), runner.tick(started.runId, dispatcher)]);
    const startCalls = (dispatcher as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
      (c) => (c[0] as { stage: { id: string } }).stage.id === 'start',
    );
    expect(startCalls).toHaveLength(1);
  });

  it('recipe_workflow_s3a:16 — a capacity/profile failure creates no attempt and consumes no repair budget', async () => {
    const { cookbookRepo, runner, repo } = await setup('sqlite', 'true');
    const recipe = await cookbookRepo.createAsync({
      title: 'Wf', schemaVersion: 1, definitionJson: JSON.stringify(makeLinearDefinition()),
    });
    const started = await runner.start({ recipeId: recipe.id, ownerUserId: null, input: {} });
    if (!started.ok) throw new Error('setup failed');
    const dispatcher: StageDispatcher = vi.fn(async () => ({ status: 'failed', errorCode: 'capacity' }) as StageDispatchOutcome);
    await runner.tick(started.runId, dispatcher);
    const stages = repo.listStageExecutions(started.runId);
    const start = stages.find((s) => s.stageId === 'start')!;
    expect(start.status).toBe('pending'); // reverted — no attempt recorded
    expect(start.attemptCount).toBe(0);
    const run = repo.getRun(started.runId)!;
    expect(run.stageExecutionCount).toBe(0);
  });
});

describe('#1485 S3a-1 — GET run DTO shape', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it('recipe_workflow_s3a:17 — matches RecipeWorkflowRunDtoV1 / RecipeWorkflowStageDtoV1 key sets exactly', async () => {
    const { cookbookRepo, runner } = await setup('sqlite', 'true');
    const recipe = await cookbookRepo.createAsync({
      title: 'Wf', schemaVersion: 1, definitionJson: JSON.stringify(makeLinearDefinition()),
    });
    const started = await runner.start({ recipeId: recipe.id, ownerUserId: null, input: {} });
    if (!started.ok) throw new Error('setup failed');
    const dto = runner.getDto(started.runId)!;
    expect(new Set(Object.keys(dto))).toEqual(
      new Set(['version', 'runId', 'recipeId', 'status', 'stages', 'pendingApprovalId', 'createdAt', 'updatedAt']),
    );
    expect(new Set(Object.keys(dto.stages[0]))).toEqual(
      new Set([
        'stageExecutionId', 'stageId', 'itemKey', 'attemptId', 'status', 'profileId',
        'configuredProviderId', 'configuredModelId', 'observedProviderId', 'observedModelId',
        'startedAt', 'completedAt', 'outcome',
      ]),
    );
  });

  it('recipe_workflow_s3a:18 — a consequential (approval) stage blocks rather than auto-advancing (rejected until S3b)', async () => {
    const { cookbookRepo, runner } = await setup('sqlite', 'true');
    const def: RecipeWorkflowDefinitionV1 = {
      schemaVersion: 1,
      entryStageId: 'ask',
      budgets: { maxCostUsd: 100, maxTokens: 100000, maxWallTimeMs: 3600000, maxStageExecutions: 100 },
      stages: [
        { id: 'ask', kind: 'approval', inputs: {}, onApprove: 'done', onReject: 'done' } as never,
        { id: 'done', kind: 'agent', profileId: 'p', terminal: true, inputs: {}, output: { fields: {} } },
      ],
    } as RecipeWorkflowDefinitionV1;
    const recipe = await cookbookRepo.createAsync({ title: 'Approval Wf', schemaVersion: 1, definitionJson: JSON.stringify(def) });
    const started = await runner.start({ recipeId: recipe.id, ownerUserId: null, input: {} });
    if (!started.ok) throw new Error('setup failed');
    const dispatcher: StageDispatcher = vi.fn(async () => outcome({}));
    await runner.tick(started.runId, dispatcher);
    const dto = runner.getDto(started.runId)!;
    expect(dto.status).toBe('blocked_approval');
    expect(dto.pendingApprovalId).not.toBeNull();
    expect(dispatcher).not.toHaveBeenCalled();
  });
});

describe('#1485 S3a-review — ownership: GET/cancel 404 for another user, real route + requireAuth', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it('recipe_workflow_s3a_review:1 — another authenticated user gets 404 on GET and cancel; the owner succeeds', async () => {
    vi.resetModules();
    vi.stubEnv('RHYTHM_RECIPE_WORKFLOWS_ENABLED', 'true');
    vi.stubEnv('DB_CLIENT', 'sqlite');
    vi.stubEnv('AGENT_LOCAL', ''); // unset — requireAuth must actually run

    const { setDb } = await import('../../database/db');
    const { runMigrations } = await import('../../database/migrations');
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);

    const { AgentCookbookRepository } = await import('../../repositories/agent_cookbook_repository');
    const { UsersRepository } = await import('../../repositories/users_repository');
    const { SessionsRepository } = await import('../../repositories/sessions_repository');
    const { createApp } = await import('../../app');
    const { startTestServer } = await import('../helpers/real_server');

    const usersRepo = new UsersRepository();
    const sessionsRepo = new SessionsRepository();
    const owner = usersRepo.create({ name: 'Owner', email: 'owner-s3a-review@example.com' });
    const intruder = usersRepo.create({ name: 'Intruder', email: 'intruder-s3a-review@example.com' });
    const ownerSession = await sessionsRepo.createAsync(owner.id);
    const intruderSession = await sessionsRepo.createAsync(intruder.id);
    const ownerAuth = { Authorization: `Bearer ${ownerSession.token}` };
    const intruderAuth = { Authorization: `Bearer ${intruderSession.token}` };

    const cookbookRepo = new AgentCookbookRepository();
    const recipe = await cookbookRepo.createAsync({
      title: 'Shared recipe', schemaVersion: 1, definitionJson: JSON.stringify(makeLinearDefinition()),
    });

    const { baseUrl, close } = await startTestServer(createApp());
    try {
      const startRes = await fetch(`${baseUrl}/agent-workflows`, {
        method: 'POST',
        headers: { ...ownerAuth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipeId: recipe.id }),
      });
      expect(startRes.status).toBe(202);
      const { runId } = (await startRes.json()) as { runId: string };

      const intruderGet = await fetch(`${baseUrl}/agent-workflows/${runId}`, { headers: intruderAuth });
      expect(intruderGet.status).toBe(404); // no existence leak — not 403

      const intruderCancel = await fetch(`${baseUrl}/agent-workflows/${runId}/cancel`, {
        method: 'POST', headers: intruderAuth,
      });
      expect(intruderCancel.status).toBe(404);

      const ownerGet = await fetch(`${baseUrl}/agent-workflows/${runId}`, { headers: ownerAuth });
      expect(ownerGet.status).toBe(200);
      const ownerDto = (await ownerGet.json()) as { runId: string };
      expect(ownerDto.runId).toBe(runId);

      const ownerCancel = await fetch(`${baseUrl}/agent-workflows/${runId}/cancel`, {
        method: 'POST', headers: ownerAuth,
      });
      expect(ownerCancel.status).toBe(202);
    } finally {
      await close();
    }
  });
});

describe('#1485 S3a-1 — cancellation persists a durable terminal state', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it('recipe_workflow_s3a:19 — cancel() transitions the run and all non-terminal stages to cancelled', async () => {
    const { cookbookRepo, runner, repo } = await setup('sqlite', 'true');
    const recipe = await cookbookRepo.createAsync({
      title: 'Wf', schemaVersion: 1, definitionJson: JSON.stringify(makeLinearDefinition()),
    });
    const started = await runner.start({ recipeId: recipe.id, ownerUserId: null, input: {} });
    if (!started.ok) throw new Error('setup failed');
    const result = await runner.cancel(started.runId);
    expect(result).toEqual({ ok: true, status: 'cancelled' });
    const dto = runner.getDto(started.runId)!;
    expect(dto.status).toBe('cancelled');
    expect(dto.stages.every((s) => s.status === 'cancelled')).toBe(true);
    // idempotent — cancelling again is a no-op success
    expect(await runner.cancel(started.runId)).toEqual({ ok: true, status: 'cancelled' });
  });
});

describe('#1485 S3a-1 — Postgres schema parity (source contract)', () => {
  it('recipe_workflow_s3a:20 — the three new tables exist in postgres_bootstrap.ts with the same columns as migrations.ts', () => {
    const migrationsSource = fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'migrations.ts'), 'utf8');
    const bootstrapSource = fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'postgres_bootstrap.ts'), 'utf8');
    for (const table of ['recipe_workflow_runs', 'recipe_workflow_stage_executions', 'recipe_workflow_loop_usage']) {
      expect(migrationsSource).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
      expect(bootstrapSource).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    // Column-name parity: every snake_case identifier following "  name TYPE"
    // inside each CREATE TABLE block should match between the two files.
    const extractColumns = (source: string, table: string): string[] => {
      const start = source.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
      const openParen = source.indexOf('(', start);
      const closeParen = source.indexOf('\n    )', openParen); // both files close with 4-space-indented ")"
      const body = source.slice(openParen, closeParen === -1 ? undefined : closeParen);
      return [...body.matchAll(/^\s*([a-z_]+)\s+[A-Z]/gm)].map((m) => m[1]);
    };
    for (const table of ['recipe_workflow_runs', 'recipe_workflow_stage_executions', 'recipe_workflow_loop_usage']) {
      const sqliteCols = extractColumns(migrationsSource, table).sort();
      const pgCols = extractColumns(bootstrapSource, table).sort();
      expect(pgCols, table).toEqual(sqliteCols);
    }
  });
});
