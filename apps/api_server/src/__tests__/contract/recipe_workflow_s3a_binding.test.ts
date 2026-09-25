/**
 * CONTRACT TEST for #1485 slice S3a-2 — AgentRunner binding, restart,
 * flag-off, cancellation slot release.
 *
 * S0 (the live restart-recovery probe) has not run. Per the lane's own
 * assumption for this case, createAgentRunnerDispatcher() (in
 * recipe_workflow_runner.ts) implements SYNCHRONOUS run() plus durable
 * completion — the current, already-blocking AgentRunner.run() shape — not a
 * new AgentRunner-owned async start API. That assumption is recorded in the
 * runner source and here.
 *
 * The dispatcher's own binding/mismatch/observed-provider logic is tested
 * with an INJECTED fake `Runner` (never a real opencode engine) — this is
 * the same seam dispatchAgentStage() already exposes for research (S2), so
 * no opencode_engine mock is needed to prove these rules. The one thing that
 * genuinely requires the real AgentRunner + a mocked engine — "cancel makes
 * a live blocking run() settle and the global active-slot count return to
 * baseline" — reuses the EXACT SAME opencodeClient.abortSession() mechanism
 * agent_sessions_controller.ts's existing session cancel() already relies on
 * (already covered by that mechanism's own tests); this slice does not
 * duplicate that proof, and the full live version is the sandbox lifecycle
 * run note the orchestrator writes after these unit tests pass (see the
 * lane notes).
 */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecipeWorkflowDefinitionV1 } from '../../contracts/recipe_workflow_contract';
import type { AgentRunOptions, AgentRunResult } from '../../services/agent_runner';
import type { Runner } from '../../services/recipe_workflow_runner';

function makeLinearDefinition(): RecipeWorkflowDefinitionV1 {
  return {
    schemaVersion: 1,
    entryStageId: 'start',
    budgets: { maxCostUsd: 1000, maxTokens: 1_000_000, maxWallTimeMs: 3_600_000, maxStageExecutions: 100 },
    stages: [
      { id: 'start', kind: 'agent', profileId: 'p', inputs: {}, output: { fields: { outcome: 'string' } }, terminal: true },
    ],
  } as RecipeWorkflowDefinitionV1;
}

function makePinnedDefinition(): RecipeWorkflowDefinitionV1 {
  return {
    schemaVersion: 1,
    entryStageId: 'start',
    budgets: { maxCostUsd: 1000, maxTokens: 1_000_000, maxWallTimeMs: 3_600_000, maxStageExecutions: 100 },
    stages: [
      {
        id: 'start', kind: 'agent', profileId: 'p',
        provider: { providerId: 'openai', modelId: 'gpt-5.1' },
        inputs: {}, output: { fields: { outcome: 'string' } }, terminal: true,
      },
    ],
  } as RecipeWorkflowDefinitionV1;
}

async function setup() {
  vi.resetModules();
  vi.stubEnv('RHYTHM_RECIPE_WORKFLOWS_ENABLED', 'true');
  vi.stubEnv('DB_CLIENT', 'sqlite');

  const { setDb } = await import('../../database/db');
  const { runMigrations } = await import('../../database/migrations');
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);

  const { AgentCookbookRepository } = await import('../../repositories/agent_cookbook_repository');
  const { AgentSessionsRepository } = await import('../../repositories/agent_sessions_repository');
  const { RecipeWorkflowRepository } = await import('../../repositories/recipe_workflow_repository');
  const { RecipeWorkflowRunner, createAgentRunnerDispatcher } = await import('../../services/recipe_workflow_runner');
  return {
    db,
    cookbookRepo: new AgentCookbookRepository(),
    sessionsRepo: new AgentSessionsRepository(),
    workflowRepo: new RecipeWorkflowRepository(),
    RecipeWorkflowRunner,
    createAgentRunnerDispatcher,
  };
}

function seedSession(db: Database.Database, id: string) {
  db.prepare(`INSERT INTO agent_sessions (id, agent_kind, cwd, name) VALUES (?, 'claude-code', '/tmp', ?)`).run(id, id);
}
function seedAssistantMessage(db: Database.Database, sessionId: string, providerId: string, modelId: string) {
  db.prepare(
    `INSERT INTO agent_session_messages (session_id, role, raw_text, stripped_text, info_json) VALUES (?, 'output', '', '', ?)`,
  ).run(sessionId, JSON.stringify({ role: 'assistant', providerID: providerId, modelID: modelId }));
}

/** A fake AgentRunner.run() that calls onSessionCreated for each id in order, then resolves/rejects. */
function makeFakeRunner(config: {
  sessionIds: string[];
  finalResult?: Partial<AgentRunResult>;
}): Runner {
  return {
    run: vi.fn(async (opts: AgentRunOptions): Promise<AgentRunResult> => {
      try {
        for (const sid of config.sessionIds) {
          // eslint-disable-next-line no-await-in-loop
          await opts.onSessionCreated?.(sid);
        }
      } catch (err) {
        return { sessionId: '', result: '', status: 'error', error: String(err) };
      }
      const last = config.sessionIds[config.sessionIds.length - 1] ?? '';
      return { sessionId: last, result: '{"outcome":"pass"}', status: 'done', ...config.finalResult };
    }),
  };
}

async function startRun(setupResult: Awaited<ReturnType<typeof setup>>, definition: RecipeWorkflowDefinitionV1) {
  const recipe = await setupResult.cookbookRepo.createAsync({
    title: 'Wf', schemaVersion: 1, definitionJson: JSON.stringify(definition),
  });
  const { RecipeWorkflowRunner } = setupResult;
  const runner = new RecipeWorkflowRunner(setupResult.workflowRepo, setupResult.cookbookRepo);
  const started = await runner.start({ recipeId: recipe.id, ownerUserId: null, input: {} });
  if (!started.ok) throw new Error('setup failed');
  return { runner, runId: started.runId };
}

describe('#1485 S3a-2 — two-phase session binding', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it('recipe_workflow_s3a_binding:1 — the first onSessionCreated atomically binds the provisional session on both tables before the model is called', async () => {
    const s = await setup();
    const { runner, runId } = await startRun(s, makeLinearDefinition());
    const stage = s.workflowRepo.listStageExecutions(runId)[0];
    seedSession(s.db, 's1');
    const fakeRunner = makeFakeRunner({ sessionIds: ['s1'] });
    const dispatcher = s.createAgentRunnerDispatcher(s.workflowRepo, s.sessionsRepo, fakeRunner);
    await runner.tick(runId, dispatcher);

    const updated = s.workflowRepo.listStageExecutions(runId)[0];
    expect(updated.provisionalSessionId).toBe('s1');
    expect(updated.committedSessionId).toBe('s1');
    const binding = s.sessionsRepo.getWorkflowBinding('s1');
    expect(binding).toEqual({ workflowRunId: runId, workflowStageExecutionId: stage.id });
  });

  it('recipe_workflow_s3a_binding:2 — a binding write failure fails the dispatch before the model is called', async () => {
    const s = await setup();
    const { runner, runId } = await startRun(s, makeLinearDefinition());
    const stage = s.workflowRepo.listStageExecutions(runId)[0];
    // Simulate a stale, uncleaned provisional binding from a prior crashed attempt.
    s.db.prepare(`UPDATE recipe_workflow_stage_executions SET provisional_session_id = 'stale' WHERE id = ?`).run(stage.id);

    let modelCalls = 0;
    const fakeRunner: Runner = {
      run: vi.fn(async (opts: AgentRunOptions): Promise<AgentRunResult> => {
        try {
          await opts.onSessionCreated?.('s1');
        } catch (err) {
          return { sessionId: '', result: '', status: 'error', error: String(err) };
        }
        modelCalls += 1; // only reached if onSessionCreated did NOT throw
        return { sessionId: 's1', result: '{"outcome":"pass"}', status: 'done' };
      }),
    };
    const dispatcher = s.createAgentRunnerDispatcher(s.workflowRepo, s.sessionsRepo, fakeRunner);
    await runner.tick(runId, dispatcher);

    expect(modelCalls).toBe(0);
    const updated = s.workflowRepo.listStageExecutions(runId)[0];
    expect(updated.status).toBe('failed');
    expect(updated.provisionalSessionId).toBe('stale'); // never overwritten by the rejected attempt
  });

  it('recipe_workflow_s3a_binding:3 — a second onSessionCreated call fails the attempt closed', async () => {
    const s = await setup();
    const { runner, runId } = await startRun(s, makeLinearDefinition());
    seedSession(s.db, 's1');
    seedSession(s.db, 's2');
    const fakeRunner = makeFakeRunner({ sessionIds: ['s1', 's2'], finalResult: { sessionId: 's2' } });
    const dispatcher = s.createAgentRunnerDispatcher(s.workflowRepo, s.sessionsRepo, fakeRunner);
    await runner.tick(runId, dispatcher);

    const updated = s.workflowRepo.listStageExecutions(runId)[0];
    expect(updated.status).toBe('failed');
    expect(updated.provisionalSessionId).toBe('s1'); // the first (and only valid) binding
    expect(updated.committedSessionId).toBeNull();
  });

  it('recipe_workflow_s3a_binding:4 — a final result.sessionId that mismatches the sole provisional session fails closed without committing', async () => {
    const s = await setup();
    const { runner, runId } = await startRun(s, makeLinearDefinition());
    seedSession(s.db, 's1');
    // A single onSessionCreated('s1') call, but the run() resolves claiming a DIFFERENT session id.
    const fakeRunner = makeFakeRunner({ sessionIds: ['s1'], finalResult: { sessionId: 's-mismatch' } });
    const dispatcher = s.createAgentRunnerDispatcher(s.workflowRepo, s.sessionsRepo, fakeRunner);
    await runner.tick(runId, dispatcher);

    const updated = s.workflowRepo.listStageExecutions(runId)[0];
    expect(updated.status).toBe('failed');
    expect(updated.committedSessionId).toBeNull();
    expect(updated.outputFields).toBeNull(); // no output was ever recorded
  });

  it('recipe_workflow_s3a_binding:5 — capacity/profile_unavailable is forwarded so the tick engine creates no attempt', async () => {
    const s = await setup();
    const { runner, runId } = await startRun(s, makeLinearDefinition());
    const fakeRunner: Runner = {
      run: vi.fn(async (): Promise<AgentRunResult> => ({
        sessionId: '', result: '', status: 'error', errorCode: 'capacity',
      })),
    };
    const dispatcher = s.createAgentRunnerDispatcher(s.workflowRepo, s.sessionsRepo, fakeRunner);
    await runner.tick(runId, dispatcher);
    const stage = s.workflowRepo.listStageExecutions(runId)[0];
    expect(stage.status).toBe('pending');
    expect(stage.attemptCount).toBe(0);
  });
});

describe('#1485 S3a-2 — observed provider/model from assistant messages only', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it('recipe_workflow_s3a_binding:6 — a single consistent assistant message is the observed pair', async () => {
    const s = await setup();
    const { runner, runId } = await startRun(s, makeLinearDefinition());
    seedSession(s.db, 's1');
    seedAssistantMessage(s.db, 's1', 'openai', 'gpt-5.1');
    const fakeRunner = makeFakeRunner({ sessionIds: ['s1'] });
    const dispatcher = s.createAgentRunnerDispatcher(s.workflowRepo, s.sessionsRepo, fakeRunner);
    await runner.tick(runId, dispatcher);
    const stage = s.workflowRepo.listStageExecutions(runId)[0];
    expect(stage.observedProviderId).toBe('openai');
    expect(stage.observedModelId).toBe('gpt-5.1');
    expect(stage.status).toBe('succeeded');
  });

  it('recipe_workflow_s3a_binding:7 — zero assistant messages fails closed for a pinned stage', async () => {
    const s = await setup();
    const { runner, runId } = await startRun(s, makePinnedDefinition());
    seedSession(s.db, 's1');
    const fakeRunner = makeFakeRunner({ sessionIds: ['s1'] });
    const dispatcher = s.createAgentRunnerDispatcher(s.workflowRepo, s.sessionsRepo, fakeRunner);
    await runner.tick(runId, dispatcher);
    const stage = s.workflowRepo.listStageExecutions(runId)[0];
    expect(stage.status).toBe('failed');
  });

  it('recipe_workflow_s3a_binding:8 — mixed provider/model values across assistant messages fail closed for a pinned stage', async () => {
    const s = await setup();
    const { runner, runId } = await startRun(s, makePinnedDefinition());
    seedSession(s.db, 's1');
    seedAssistantMessage(s.db, 's1', 'openai', 'gpt-5.1');
    seedAssistantMessage(s.db, 's1', 'anthropic', 'claude-opus-4'); // mid-run cross-provider re-dispatch
    const fakeRunner = makeFakeRunner({ sessionIds: ['s1'] });
    const dispatcher = s.createAgentRunnerDispatcher(s.workflowRepo, s.sessionsRepo, fakeRunner);
    await runner.tick(runId, dispatcher);
    const stage = s.workflowRepo.listStageExecutions(runId)[0];
    expect(stage.status).toBe('failed');
  });
});

describe('#1485 S3a-2 — cancellation fences the run and aborts bound sessions', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it('recipe_workflow_s3a_binding:9 — cancel() fences non-terminal stages and calls the aborter for every bound session', async () => {
    const s = await setup();
    const { RecipeWorkflowRunner } = s;
    const aborter = vi.fn(async () => {});
    const runner = new RecipeWorkflowRunner(s.workflowRepo, s.cookbookRepo, aborter);
    const recipe = await s.cookbookRepo.createAsync({ title: 'Wf', schemaVersion: 1, definitionJson: JSON.stringify(makeLinearDefinition()) });
    const started = await runner.start({ recipeId: recipe.id, ownerUserId: null, input: {} });
    if (!started.ok) throw new Error('setup failed');
    const stage = s.workflowRepo.listStageExecutions(started.runId)[0];
    // Simulate a stage mid-flight with a bound provisional session.
    s.db.prepare(`UPDATE recipe_workflow_stage_executions SET status = 'running', provisional_session_id = 's1' WHERE id = ?`).run(stage.id);

    const result = await runner.cancel(started.runId);
    expect(result).toEqual({ ok: true, status: 'cancelled' });
    expect(aborter).toHaveBeenCalledWith('s1');
    const dto = runner.getDto(started.runId)!;
    expect(dto.status).toBe('cancelled');
    expect(dto.stages.every((st) => st.status === 'cancelled')).toBe(true);
  });

  it('recipe_workflow_s3a_binding:10 — a late completion cannot resurrect a cancelled run', async () => {
    const s = await setup();
    const { RecipeWorkflowRunner } = s;
    const aborter = vi.fn(async () => {});
    const runner = new RecipeWorkflowRunner(s.workflowRepo, s.cookbookRepo, aborter);
    const recipe = await s.cookbookRepo.createAsync({ title: 'Wf', schemaVersion: 1, definitionJson: JSON.stringify(makeLinearDefinition()) });
    const started = await runner.start({ recipeId: recipe.id, ownerUserId: null, input: {} });
    if (!started.ok) throw new Error('setup failed');
    const stage = s.workflowRepo.listStageExecutions(started.runId)[0];
    await runner.cancel(started.runId);

    // A completion arrives after cancellation — recordCompletion targets this
    // exact stageExecutionId, but the run/stage are already fenced 'cancelled'.
    s.workflowRepo.recordCompletion(stage.id, { status: 'succeeded', outputFields: { outcome: 'pass' } });
    const dto = runner.getDto(started.runId)!;
    expect(dto.status).toBe('cancelled'); // tick() never re-examines a terminal run
    await runner.tick(started.runId, async () => ({ status: 'succeeded', outputFields: {} }));
    expect(runner.getDto(started.runId)!.status).toBe('cancelled');
  });
});

describe('#1485 S3a-2 — flag-off mid-run', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it('recipe_workflow_s3a_binding:11 — turning the flag off transitions an in-flight run to workflow_disabled and aborts its sessions at the next tick', async () => {
    const s = await setup();
    const aborter = vi.fn(async () => {});
    const runner = new s.RecipeWorkflowRunner(s.workflowRepo, s.cookbookRepo, aborter);
    const recipe = await s.cookbookRepo.createAsync({ title: 'Wf', schemaVersion: 1, definitionJson: JSON.stringify(makeLinearDefinition()) });
    const started = await runner.start({ recipeId: recipe.id, ownerUserId: null, input: {} });
    if (!started.ok) throw new Error('setup failed');
    const stage = s.workflowRepo.listStageExecutions(started.runId)[0];
    s.db.prepare(`UPDATE recipe_workflow_stage_executions SET status = 'running', provisional_session_id = 's1' WHERE id = ?`).run(stage.id);

    // Simulates the process restarting with the flag now off: every module
    // (including the repositories) must be re-imported fresh so they all
    // bind to the SAME (new) database module instance as the new setDb() call.
    vi.resetModules();
    vi.stubEnv('RHYTHM_RECIPE_WORKFLOWS_ENABLED', 'false');
    vi.stubEnv('DB_CLIENT', 'sqlite');
    const { setDb } = await import('../../database/db');
    setDb(s.db);
    const { AgentCookbookRepository: FreshCookbookRepo } = await import('../../repositories/agent_cookbook_repository');
    const { RecipeWorkflowRepository: FreshWorkflowRepo } = await import('../../repositories/recipe_workflow_repository');
    const { RecipeWorkflowRunner: FreshRunner } = await import('../../services/recipe_workflow_runner');
    const freshAborter = vi.fn(async () => {});
    const freshRunner = new FreshRunner(new FreshWorkflowRepo(), new FreshCookbookRepo(), freshAborter);

    await freshRunner.tick(started.runId, async () => ({ status: 'succeeded', outputFields: {} }));
    expect(freshAborter).toHaveBeenCalledWith('s1');
    const dto = freshRunner.getDto(started.runId)!;
    expect(dto.status).toBe('workflow_disabled');
    expect(dto.stages.every((st) => st.status === 'cancelled' || st.status === 'succeeded')).toBe(true);
  });
});

describe('#1485 S3a-2 — restart reconciliation', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it('recipe_workflow_s3a_binding:12 — a stage caught mid-flight ("running") becomes blocked_reconciliation; committed stages are untouched', async () => {
    const s = await setup();
    const { runner, runId } = await startRun(s, makeLinearDefinition());
    const stage = s.workflowRepo.listStageExecutions(runId)[0];
    s.db.prepare(`UPDATE recipe_workflow_stage_executions SET status = 'running' WHERE id = ?`).run(stage.id);

    const result = runner.reconcileAfterRestart();
    expect(result).toEqual({ reconciledStages: 1, affectedRuns: 1 });
    const dto = runner.getDto(runId)!;
    expect(dto.status).toBe('blocked_reconciliation');
    expect(dto.stages[0].status).toBe('blocked_reconciliation');
  });

  it('recipe_workflow_s3a_binding:13 — a succeeded stage is never re-dispatched by reconciliation or a subsequent tick', async () => {
    const s = await setup();
    const { runner, runId } = await startRun(s, makeLinearDefinition());
    const dispatcher = vi.fn(async () => ({ status: 'succeeded' as const, outputFields: { outcome: 'pass' } }));
    await runner.tick(runId, dispatcher);
    expect(dispatcher).toHaveBeenCalledOnce();

    runner.reconcileAfterRestart();
    await runner.tick(runId, dispatcher);
    expect(dispatcher).toHaveBeenCalledOnce(); // still once — never re-dispatched
  });

  it('recipe_workflow_s3a_review:3 — a run stalled between a stage committing and the run finalizing (crash-between-steps) becomes blocked_reconciliation and is never resent', async () => {
    const s = await setup();
    const { runner, runId } = await startRun(s, makeLinearDefinition());
    const stage = s.workflowRepo.listStageExecutions(runId)[0];
    // Simulates the exact crash window this review fix closes with
    // db.transaction(): the stage-side commit happened, but the run-level
    // advanceTo/updateRunStatus in the SAME sequence never ran (process died
    // in between) — so the run is still 'pending' with no running/pending
    // stage left at all.
    s.db.prepare(`UPDATE recipe_workflow_stage_executions SET status = 'succeeded' WHERE id = ?`).run(stage.id);

    const result = runner.reconcileAfterRestart();
    expect(result.affectedRuns).toBe(1);
    const dto = runner.getDto(runId)!;
    expect(dto.status).toBe('blocked_reconciliation');

    // Never resent — nothing pending/running exists to dispatch.
    const dispatcher = vi.fn(async () => ({ status: 'succeeded' as const, outputFields: {} }));
    await runner.tick(runId, dispatcher);
    expect(dispatcher).not.toHaveBeenCalled();
  });
});
