import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setDb } from '../database/db';
import { installAgentWorkstreamsSchema } from '../database/agent_workstreams_schema';
import { AgentWorkstreamsRepository } from '../repositories/agent_workstreams_repository';
import { AgentBridgeJobsRepository } from '../shared_agents/delegation_jobs_repository';
import { installAgentBridgeSchema } from '../shared_agents/bridge_schema';
import { PersistentWorkstreamCoordinator } from '../services/persistent_workstream_coordinator';
import { type WorkstreamArtifactAuthorityResolver } from '../services/workstream_artifact_verifier';
import type { ProfileScope } from '../services/agent_profile_scope';
import type { AuthContext } from '../middleware/auth_middleware';
import type { AgentSession } from '../models/agent_session';
import type { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import type { AgentConfig, AgentConfigsRepository } from '../repositories/agent_configs_repository';
import type { ManagedWorkstreamContextRepository } from '../repositories/managed_workstream_context_repository';

const OWNER = 811;
const PROJECT = 'project-coordinator';
const NOW = '2026-10-03T12:00:00.000Z';
const auth = { sessionToken: 'test-session', user: { id: OWNER } } as AuthContext;

type Fixture = ReturnType<typeof fixture>;

function fixture(options: {
  terminalMessages?: unknown[];
  enabled?: boolean | (() => boolean);
  artifactResolver?: WorkstreamArtifactAuthorityResolver;
  profileScopeResolver?: (profileId: string) => Promise<ProfileScope>;
} = {}) {
  const db = new Database(':memory:');
  installAgentWorkstreamsSchema(db);
  installAgentBridgeSchema(db);
  setDb(db);
  const workstreams = new AgentWorkstreamsRepository();
  const jobs = new AgentBridgeJobsRepository(db);
  const workstream = workstreams.create(OWNER, {
    projectId: PROJECT,
    goal: 'Inspect the exact bounded outcome',
    constraints: 'Do not mutate anything',
    criteria: 'criterion one',
    checkpoint: {
      version: 1,
      criteria: [{ id: 'criterion-1', status: 'pending' }],
      references: [],
      nextAction: { kind: 'review', scope: PROJECT },
    },
    createKey: `create-${Math.random().toString(36).slice(2)}`,
  }).row;
  const child = {
    id: 'local-worker-1', sdkSessionId: 'sdk-worker-1', cwd: '/safe/project',
  };
  const parent = {
    id: 'parent-local',
    ownerUserId: OWNER,
    projectId: PROJECT,
    parentSessionId: null,
    sdkSessionId: 'sdk-parent',
    cwd: '/safe/project',
    profileId: null,
    opencodeAgentId: null,
    delegationDepth: 0,
  } as AgentSession;
  const sessions = {
    findById: (id: string) => id === child.id ? child : id === parent.id ? parent : null,
    findBySdkSessionId: (id: string) => id === parent.sdkSessionId ? parent : null,
    insert: vi.fn(() => ({ ...child, id: 'fresh-worker-local', sdkSessionId: null })),
    setSdkSessionId: vi.fn(),
    updateStatus: vi.fn(),
  } as unknown as AgentSessionsRepository;
  const profile = {
    id: 'worker-profile',
    label: 'Bounded reader',
    enabled: true,
    isAgent: true,
    allowedMcpsJson: null,
    revision: 1,
  } as AgentConfig;
  const configs = {
    getById: vi.fn((id: string) => id === profile.id ? profile : null),
  } as unknown as AgentConfigsRepository;
  const engine = {
    isReady: true,
    hasOwnedEngine: true,
    getEngineIdentity: vi.fn(async () => ({ version: 'test-engine', pid: 991, bootId: 'boot-test' })),
    createSession: vi.fn(),
    promptAsync: vi.fn(),
    abortSession: vi.fn(),
    getSessionStatuses: vi.fn(async () => ({ [child.sdkSessionId]: { type: 'idle' } })),
    listMcp: vi.fn(async () => ({ rhythm: { status: 'connected' } })),
    listQuestions: vi.fn(async (): Promise<Array<{ sessionID: string }>> => []),
    listPermissions: vi.fn(async (): Promise<Array<{ sessionID: string }>> => []),
    listMessagesPage: vi.fn(async (): Promise<{ messages: unknown[]; nextCursor: string | null }> => ({ messages: options.terminalMessages ?? [{
      info: {
        id: 'assistant-exact-anchor', role: 'assistant', parentID: 'sdk-user-anchor',
        time: { completed: 1 }, providerID: 'provider', modelID: 'model', finish: 'stop',
        tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      parts: [{ type: 'text', text: 'worker prose must never be persisted in result metadata' }],
    }], nextCursor: null })),
  };
  const coordinator = new PersistentWorkstreamCoordinator({
    engine: engine as never,
    records: {} as ManagedWorkstreamContextRepository,
    captureAvailable: () => true,
    enabled: () => typeof options.enabled === 'function' ? options.enabled() : options.enabled ?? true,
    dbClient: 'sqlite',
    role: 'local',
    rhythmMcpServerName: 'rhythm',
    workstreams,
    jobs,
    sessions,
    configs,
    profileScopeResolver: options.profileScopeResolver,
    hostEpoch: 'epoch-current',
    artifactResolver: options.artifactResolver,
  });
  coordinator.initialize();
  return { db, coordinator, engine, jobs, workstream, workstreams, child, profile };
}

function bindRunningJob(context: Fixture, now = NOW, maxTokens = 100) {
  const created = context.jobs.createNativeOrReplay({
    localUserId: OWNER,
    workstreamId: context.workstream.id,
    projectId: PROJECT,
    capturedRevision: context.workstream.revision,
    hostEpoch: 'epoch-current',
    commandKey: 'run-current',
    targetAgentId: 'worker-profile',
    targetRevision: 1,
    parent: {
      runtimeInstance: 'boot-test', sessionId: 'parent-local', agentId: 'parent', projectionId: null,
    },
    now,
  }).row;
  context.jobs.configureCoordinatorNativeJob({
    localUserId: OWNER,
    workstreamId: context.workstream.id,
    jobId: created.id,
    metadata: {
      policy: { maxTurns: 1, maxWallTimeSeconds: 300, maxTokens, queueDeadlineAt: null },
      budget: { schemaVersion: 1, authorizedTokens: maxTokens, units: 'tokens' },
      estimate: { authorizedTokens: maxTokens },
      targetProfileId: 'worker-profile',
      targetProfileRevision: 1,
      requestedModel: { providerId: 'requested-provider', modelId: 'requested-model' },
    },
    now,
  });
  // Explicit admission is now fenced by the same queued control snapshot the
  // normal Run next path publishes before it can claim a bounded worker.
  context.workstreams.setRuntimeState({
    ownerUserId: OWNER, projectId: PROJECT, id: context.workstream.id,
    state: 'queued', reason: null, executorEpoch: 'epoch-current', lastJobId: created.id,
  });
  expect(context.jobs.claimCoordinatorForExplicitDispatch({
    localUserId: OWNER, workstreamId: context.workstream.id, jobId: created.id,
    hostEpoch: 'epoch-current', now,
  }).admitted).toBe(true);
  context.jobs.bindCoordinatorChild({
    localUserId: OWNER, workstreamId: context.workstream.id, jobId: created.id,
    localSessionId: context.child.id, sdkSessionId: context.child.sdkSessionId, now,
  });
  context.jobs.bindCoordinatorDispatch({
    localUserId: OWNER, workstreamId: context.workstream.id, jobId: created.id,
    dispatchId: 'dispatch-current', sdkUserMessageId: 'sdk-user-anchor', now,
  });
  context.workstreams.setRuntimeState({
    ownerUserId: OWNER, projectId: PROJECT, id: context.workstream.id,
    state: 'running', reason: null, executorEpoch: 'epoch-current', lastJobId: created.id,
  });
  return created;
}

function assistantStep(
  id: string,
  finish: string,
  tokens: Record<string, unknown> = {
    input: 10, output: 20, reasoning: 0, cache: { read: 0, write: 0 },
  },
) {
  return {
    info: {
      id,
      role: 'assistant',
      parentID: 'sdk-user-anchor',
      time: { completed: 1 },
      providerID: 'provider',
      modelID: 'model',
      finish,
      tokens,
    },
    parts: [{ type: 'text', text: 'worker prose must never be persisted in result metadata' }],
  };
}

afterEach(() => setDb(null));

describe('persistent workstream coordinator', () => {
  it('C01: default-off readiness blocks explicit admission without creating a session or prompt', async () => {
    const context = fixture({ enabled: false });
    const view = await context.coordinator.runNext(auth, PROJECT, context.workstream.id, {
      expectedRevision: context.workstream.revision,
      commandKey: 'run-off',
      targetProfileId: 'worker-profile',
      parentSessionId: 'parent-local',
      policy: { maxTurns: 1, maxWallTimeSeconds: 300, maxTokens: 100, queueDeadlineAt: null },
      references: [],
    });
    expect(view.workstream).toMatchObject({ state: 'blocked', stateReason: 'workstreams_opt_in_required' });
    expect(context.engine.createSession).not.toHaveBeenCalled();
    expect(context.engine.promptAsync).not.toHaveBeenCalled();
    context.db.close();
  });

  it('R2: host-global admission counts a dispatched legacy child from another project', () => {
    const context = fixture();
    bindRunningJob(context);
    // This mirrors the durable legacy async-delegation rows that share the
    // same local engine resource but belong to a different project.
    context.db.exec(`
      CREATE TABLE agent_sessions (
        id TEXT PRIMARY KEY,
        owner_user_id INTEGER NOT NULL,
        project_id TEXT NOT NULL
      );
      CREATE TABLE agent_async_delegations (
        id TEXT PRIMARY KEY,
        child_session_id TEXT NOT NULL,
        status TEXT NOT NULL
      );
    `);
    context.db.prepare(`INSERT INTO agent_sessions (id, owner_user_id, project_id)
      VALUES ('legacy-child-other-project', ?, 'project-other')`).run(OWNER);
    context.db.prepare(`INSERT INTO agent_async_delegations (id, child_session_id, status)
      VALUES ('legacy-dispatched-other-project', 'legacy-child-other-project', 'dispatched')`).run();

    const secondWorkstream = context.workstreams.create(OWNER, {
      projectId: PROJECT,
      goal: 'Second bounded read',
      constraints: 'Do not mutate anything',
      criteria: 'criterion two',
      checkpoint: {
        version: 1,
        criteria: [{ id: 'criterion-2', status: 'pending' }],
        references: [],
        nextAction: { kind: 'review', scope: PROJECT },
      },
      createKey: 'create-capacity-second',
    }).row;
    const secondJob = context.jobs.createNativeOrReplay({
      localUserId: OWNER,
      workstreamId: secondWorkstream.id,
      projectId: PROJECT,
      capturedRevision: secondWorkstream.revision,
      hostEpoch: 'epoch-current',
      commandKey: 'run-capacity-second',
      targetAgentId: 'worker-profile',
      targetRevision: 1,
      parent: {
        runtimeInstance: 'boot-test', sessionId: 'parent-local', agentId: 'parent', projectionId: null,
      },
      now: NOW,
    }).row;
    context.jobs.configureCoordinatorNativeJob({
      localUserId: OWNER,
      workstreamId: secondWorkstream.id,
      jobId: secondJob.id,
      metadata: {
        policy: { maxTurns: 1, maxWallTimeSeconds: 300, maxTokens: 100, queueDeadlineAt: null },
        budget: { schemaVersion: 1, authorizedTokens: 100, units: 'tokens' },
        estimate: { authorizedTokens: 100 },
        targetProfileId: 'worker-profile',
        targetProfileRevision: 1,
        requestedModel: { providerId: 'requested-provider', modelId: 'requested-model' },
      },
      now: NOW,
    });
    context.workstreams.setRuntimeState({
      ownerUserId: OWNER,
      projectId: PROJECT,
      id: secondWorkstream.id,
      state: 'queued',
      reason: null,
      executorEpoch: 'epoch-current',
      lastJobId: secondJob.id,
    });

    expect(context.jobs.claimCoordinatorForExplicitDispatch({
      localUserId: OWNER,
      workstreamId: secondWorkstream.id,
      jobId: secondJob.id,
      hostEpoch: 'epoch-current',
      now: NOW,
    }).admitted).toBe(false);
    expect(context.db.prepare(`SELECT COUNT(*) AS count FROM agent_bridge_jobs
      WHERE direction='rhythm_to_native' AND native_execution_kind='coordinator'
        AND state IN ('claimed','running','unknown')`).get()).toEqual({ count: 1 });
    context.db.close();
  });

  it('R7: an SDK-ready but unowned engine is not coordinator-ready', async () => {
    const context = fixture();
    await context.coordinator.reconcileAfterEngineReady();
    context.engine.hasOwnedEngine = false;

    const readiness = await context.coordinator.readiness();

    expect(readiness).toMatchObject({ available: false, reason: 'owned_engine_not_ready' });
    context.db.close();
  });

  it('C05: accepts one exact terminal anchor, records actual usage, and quarantines result metadata without prose', async () => {
    const context = fixture();
    const job = bindRunningJob(context);
    await context.coordinator.reconcileAfterEngineReady();

    const view = await context.coordinator.status(auth, PROJECT, context.workstream.id);

    expect(view.workstream).toMatchObject({ state: 'ready', stateReason: 'result_quarantined_requires_receipt' });
    expect(view.jobs.find((item) => item.id === job.id)).toMatchObject({
      state: 'succeeded',
      commandKey: 'run-current',
      requestedProviderId: 'requested-provider',
      requestedModelId: 'requested-model',
      usage: { status: 'actual', totalTokens: 30, authorizedTokens: 100, overshoot: false },
      result: { terminalMessageId: 'assistant-exact-anchor', usageStatus: 'actual' },
      application: { status: 'quarantined' },
    });
    expect(JSON.stringify(view.jobs.find((item) => item.id === job.id)?.result)).not.toContain('worker prose');
    context.db.close();
  });

  it('C03/C05: a revised control fences a late terminal result instead of reopening admission', async () => {
    const context = fixture();
    const job = bindRunningJob(context);
    const revised = context.workstreams.revise(OWNER, PROJECT, context.workstream.id, 1, { goal: 'A revised exact goal' });
    expect(revised).toMatchObject({ revision: 2, state: 'blocked', stateReason: 'controls_revised' });
    await context.coordinator.reconcileAfterEngineReady();

    const view = await context.coordinator.status(auth, PROJECT, context.workstream.id);

    expect(view.workstream).toMatchObject({ state: 'blocked', stateReason: 'controls_revised', revision: 2 });
    expect(view.jobs.find((item) => item.id === job.id)?.application).toMatchObject({ status: 'stale' });
    context.db.close();
  });

  it('C07: an authenticated owner can apply one explicit waiver transactionally, never from worker prose', async () => {
    const context = fixture();
    const job = bindRunningJob(context);
    await context.coordinator.reconcileAfterEngineReady();
    const terminal = await context.coordinator.status(auth, PROJECT, context.workstream.id);

    const applied = await context.coordinator.waiveCriterion(
      auth, PROJECT, context.workstream.id, terminal.workstream.revision, job.id, 'criterion-1',
    );

    expect(applied.workstream).toMatchObject({
      state: 'completed', stateReason: 'criteria_authoritatively_resolved', revision: 2,
      checkpoint: { criteria: [{ id: 'criterion-1', status: 'waived' }] },
    });
    expect(applied.workstream.checkpoint.criteria[0]?.receiptId).toMatch(/^user-waiver:/);
    expect(applied.jobs.find((item) => item.id === job.id)?.application).toMatchObject({
      status: 'applied', authority: 'authenticated_user_waiver', actorUserId: OWNER,
      criteria: [{ criterionId: 'criterion-1', criterionStatus: 'waived' }],
    });
    expect(JSON.stringify(applied.jobs.find((item) => item.id === job.id)?.application)).not.toContain('worker prose');
    context.db.close();
  });

  it('R5: server-resolved qualified evidence applies only from a bound selector, never caller bytes', async () => {
    const sourceId = 'memory:123e4567-e89b-42d3-a456-426614174000';
    const observedHash = 'a'.repeat(64);
    const resolver = {
      resolveReference: vi.fn(async () => ({
        selector: sourceId,
        eligible: true,
        receipt: {
          kind: 'memory_vault',
          canonicalId: 'fact/canonical.md',
          observedVersion: `sha256:${observedHash}`,
          observedHash,
          verified: true,
          reason: null,
          sourceNamespace: 'memory-vault',
          sourceInstance: 'source-instance',
          evidenceState: 'preexisting',
        },
        managedReference: null,
      })),
    } as unknown as WorkstreamArtifactAuthorityResolver;
    const context = fixture({ artifactResolver: resolver });
    context.db.prepare('UPDATE agent_workstreams SET checkpoint_json=? WHERE id=?').run(JSON.stringify({
      version: 1,
      criteria: [{ id: 'criterion-1', status: 'pending' }],
      references: [{ sourceId, expectedVersion: `sha256:${observedHash}`, scope: PROJECT, provenance: 'trusted_reference' }],
      nextAction: { kind: 'review', scope: PROJECT },
    }), context.workstream.id);
    const job = bindRunningJob(context);
    await context.coordinator.reconcileAfterEngineReady();
    const terminal = await context.coordinator.status(auth, PROJECT, context.workstream.id);
    const applied = await context.coordinator.verifyCriteriaFromEvidence(
      auth, PROJECT, context.workstream.id, {
        expectedRevision: terminal.workstream.revision,
        jobId: job.id,
        sourceId,
        criterionIds: ['criterion-1'],
      },
    );

    expect(applied.workstream.checkpoint.criteria).toEqual([
      expect.objectContaining({ id: 'criterion-1', status: 'verified' }),
    ]);
    expect(applied.jobs.find((item) => item.id === job.id)?.application).toMatchObject({
      status: 'applied', authority: 'server_resolved_memory_vault_evidence', canonicalId: 'fact/canonical.md',
    });
    context.db.close();
  });

  it('C07: revision drift records stale application and never changes a criterion', async () => {
    const context = fixture();
    const job = bindRunningJob(context);
    await context.coordinator.reconcileAfterEngineReady();
    const terminal = await context.coordinator.status(auth, PROJECT, context.workstream.id);
    context.workstreams.revise(OWNER, PROJECT, context.workstream.id, terminal.workstream.revision, {
      goal: 'Changed after the terminal worker result',
    });

    const stale = await context.coordinator.waiveCriterion(
      auth, PROJECT, context.workstream.id, terminal.workstream.revision, job.id, 'criterion-1',
    );

    expect(stale.workstream).toMatchObject({ revision: 2, checkpoint: { criteria: [{ status: 'pending' }] } });
    expect(stale.jobs.find((item) => item.id === job.id)?.application).toMatchObject({
      status: 'stale', reason: 'criterion_application_fenced',
    });
    context.db.close();
  });

  it('C05: an idle worker without exactly one anchored terminal message remains unknown', async () => {
    const context = fixture({ terminalMessages: [] });
    const job = bindRunningJob(context);
    await context.coordinator.reconcileAfterEngineReady();

    const view = await context.coordinator.status(auth, PROJECT, context.workstream.id);

    expect(view.workstream).toMatchObject({ state: 'unknown', stateReason: 'native_status_unknown' });
    expect(view.jobs.find((item) => item.id === job.id)).toMatchObject({
      state: 'unknown',
      result: { status: 'unknown', reason: 'terminal_message_binding_missing' },
    });
    expect(context.engine.promptAsync).not.toHaveBeenCalled();
    context.db.close();
  });

  it('C06: explicit unknown reconciliation only accepts a fresh exact engine binding and never prompts', async () => {
    const context = fixture({ terminalMessages: [] });
    const job = bindRunningJob(context);
    const unknown = await context.coordinator.status(auth, PROJECT, context.workstream.id);
    expect(unknown.workstream).toMatchObject({ state: 'unknown' });

    context.engine.listMessagesPage.mockResolvedValue({ messages: [{
      info: {
        id: 'assistant-rechecked-anchor', role: 'assistant', parentID: 'sdk-user-anchor',
        time: { completed: 2 }, providerID: 'provider', modelID: 'model', finish: 'stop',
        tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      parts: [{ type: 'text', text: 'not durable worker prose' }],
    }], nextCursor: null });
    const reconciled = await context.coordinator.reconcileUnknownFromEngine(
      auth, PROJECT, context.workstream.id, unknown.workstream.revision, job.id,
    );

    expect(reconciled.workstream).toMatchObject({
      state: 'ready', stateReason: 'result_quarantined_requires_receipt',
    });
    expect(reconciled.jobs.find((item) => item.id === job.id)).toMatchObject({
      state: 'succeeded', result: { terminalMessageId: 'assistant-rechecked-anchor' },
    });
    expect(context.engine.promptAsync).not.toHaveBeenCalled();
    context.db.close();
  });

  it('C02/C05: an explicit status read past the wall limit requests termination and remains unknown', async () => {
    const context = fixture();
    const job = bindRunningJob(context, new Date(Date.now() - 301_000).toISOString());

    const view = await context.coordinator.status(auth, PROJECT, context.workstream.id);

    expect(view.workstream).toMatchObject({
      state: 'unknown',
      stateReason: 'wall_time_exceeded_termination_unconfirmed',
    });
    expect(view.jobs.find((item) => item.id === job.id)).toMatchObject({
      state: 'unknown',
      result: { status: 'cancelling', reason: 'wall_time_exceeded_termination_unconfirmed' },
    });
    expect(context.engine.abortSession).toHaveBeenCalledWith(context.child.sdkSessionId, context.child.cwd);
    expect(context.engine.promptAsync).not.toHaveBeenCalled();
    context.db.close();
  });

  it('R2: accounts for every assistant step in the exact turn while choosing only the final stop answer', async () => {
    const context = fixture({ terminalMessages: [
      assistantStep('assistant-tool-step', 'tool-calls', {
        input: 5, output: 5, reasoning: 0, cache: { read: 0, write: 0 },
      }),
      assistantStep('assistant-final-answer', 'stop', {
        input: 10, output: 20, reasoning: 0, cache: { read: 0, write: 0 },
      }),
    ] });
    const job = bindRunningJob(context);
    await context.coordinator.reconcileAfterEngineReady();

    const view = await context.coordinator.status(auth, PROJECT, context.workstream.id);

    expect(view.jobs.find((item) => item.id === job.id)).toMatchObject({
      state: 'succeeded',
      result: {
        terminalMessageId: 'assistant-final-answer',
        assistantMessageIds: ['assistant-tool-step', 'assistant-final-answer'],
      },
      usage: { status: 'actual', assistantStepCount: 2, totalTokens: 40 },
    });
    context.db.close();
  });

  it('R2: an idle pending question is a block, not a completed worker', async () => {
    const context = fixture();
    const job = bindRunningJob(context);
    context.engine.listQuestions.mockResolvedValue([{ sessionID: context.child.sdkSessionId }]);
    await context.coordinator.reconcileAfterEngineReady();

    const view = await context.coordinator.status(auth, PROJECT, context.workstream.id);

    expect(view.workstream).toMatchObject({ state: 'blocked', stateReason: 'worker_question_pending' });
    expect(view.jobs.find((item) => item.id === job.id)).toMatchObject({ state: 'running' });
    expect(context.engine.listMessagesPage).not.toHaveBeenCalled();
    context.db.close();
  });

  it('R2: a nonterminal tool-only turn and a repeated page cursor both remain unknown', async () => {
    const nonterminal = fixture({ terminalMessages: [assistantStep('assistant-tool-only', 'tool-calls')] });
    const nonterminalJob = bindRunningJob(nonterminal);
    await nonterminal.coordinator.reconcileAfterEngineReady();
    const toolOnly = await nonterminal.coordinator.status(auth, PROJECT, nonterminal.workstream.id);
    expect(toolOnly.jobs.find((item) => item.id === nonterminalJob.id)).toMatchObject({
      state: 'unknown', result: { reason: 'terminal_message_not_authoritative' },
    });
    nonterminal.db.close();

    const paged = fixture();
    const pagedJob = bindRunningJob(paged);
    paged.engine.listMessagesPage
      .mockResolvedValueOnce({ messages: [assistantStep('assistant-page-one', 'stop')], nextCursor: 'page-2' })
      .mockResolvedValueOnce({ messages: [], nextCursor: 'page-2' });
    await paged.coordinator.reconcileAfterEngineReady();
    const incomplete = await paged.coordinator.status(auth, PROJECT, paged.workstream.id);
    expect(incomplete.jobs.find((item) => item.id === pagedJob.id)).toMatchObject({
      state: 'unknown', result: { reason: 'terminal_message_lookup_unavailable' },
    });
    expect(paged.engine.listMessagesPage).toHaveBeenCalledTimes(2);
    paged.db.close();
  });

  it('R2/R4: incomplete usage holds the exact terminal observation until an explicit charged acknowledgement', async () => {
    const context = fixture({ terminalMessages: [assistantStep('assistant-usage-incomplete', 'stop', {
      input: 10, output: 20, reasoning: 1, cache: { read: 0, write: 0 },
    })] });
    const job = bindRunningJob(context);
    await context.coordinator.reconcileAfterEngineReady();

    const unknown = await context.coordinator.status(auth, PROJECT, context.workstream.id);
    expect(unknown.workstream).toMatchObject({ state: 'unknown', stateReason: 'usage_unknown_ack_required' });
    expect(unknown.jobs.find((item) => item.id === job.id)).toMatchObject({
      state: 'unknown', result: { terminalMessageId: 'assistant-usage-incomplete', usageStatus: 'unknown' },
    });
    const messageCalls = context.engine.listMessagesPage.mock.calls.length;
    await context.coordinator.status(auth, PROJECT, context.workstream.id);
    expect(context.engine.listMessagesPage).toHaveBeenCalledTimes(messageCalls);
    const acknowledged = await context.coordinator.acknowledgeUsageEstimate(
      auth, PROJECT, context.workstream.id, unknown.workstream.revision, job.id, true,
    );
    expect(acknowledged.workstream).toMatchObject({ state: 'blocked', stateReason: 'budget_exhausted_hold' });
    expect(acknowledged.jobs.find((item) => item.id === job.id)?.estimate).toMatchObject({
      estimateAcknowledgement: {
        accepted: true,
        chargedEstimateTokens: 100,
        units: 'tokens',
        authorizedTokens: 100,
        remainingAuthorizedTokens: 0,
        basis: 'declared_worker_authorization_due_to_missing_actual_usage',
        uncertainty: 'actual_usage_unavailable',
        actorUserId: OWNER,
      },
    });
    context.engine.listMessagesPage.mockResolvedValue({ messages: [assistantStep('assistant-actual-after-ack', 'stop')], nextCursor: null });
    const actual = await context.coordinator.reconcileUnknownFromEngine(
      auth, PROJECT, context.workstream.id, acknowledged.workstream.revision, job.id,
    );
    expect(actual.budget).toMatchObject({ actualTokens: 30, acknowledgedEstimateTokens: 0, remainingTokens: 70 });
    expect(actual.workstream).toMatchObject({ state: 'ready', stateReason: 'result_quarantined_requires_receipt' });
    context.db.close();
  });

  it.each([
    ['pause', 'paused', 'user_paused'],
    ['cancel', 'cancelled', 'user_cancelled'],
    ['revise', 'blocked', 'controls_revised'],
  ] as const)('R3: %s during an awaited terminal read wins over completion projection', async (control, state, reason) => {
    const context = fixture();
    const job = bindRunningJob(context);
    await context.coordinator.reconcileAfterEngineReady();
    let started!: () => void;
    const pageStarted = new Promise<void>((resolve) => { started = resolve; });
    let release!: (value: { messages: unknown[]; nextCursor: null }) => void;
    const page = new Promise<{ messages: unknown[]; nextCursor: null }>((resolve) => { release = resolve; });
    context.engine.listMessagesPage.mockImplementation(async () => {
      started();
      return page;
    });

    const observed = context.coordinator.status(auth, PROJECT, context.workstream.id);
    await pageStarted;
    if (control === 'pause') {
      await context.coordinator.pause(auth, PROJECT, context.workstream.id, 1);
    } else if (control === 'cancel') {
      await context.coordinator.cancel(auth, PROJECT, context.workstream.id, 1, job.id);
    } else {
      expect(context.workstreams.revise(OWNER, PROJECT, context.workstream.id, 1, {
        goal: 'User revision during terminal read',
      })).not.toBeNull();
    }
    release({ messages: [assistantStep('assistant-late-after-control', 'stop')], nextCursor: null });
    const view = await observed;

    expect(view.workstream).toMatchObject({ state, stateReason: reason, revision: 2 });
    expect(view.jobs.find((item) => item.id === job.id)).toMatchObject({
      state: 'succeeded', application: { status: 'stale' },
    });
    context.db.close();
  });

  it('R3: a revision during the restart status probe cannot reattach an old worker epoch', async () => {
    const context = fixture();
    const job = bindRunningJob(context);
    context.db.prepare('UPDATE agent_bridge_jobs SET host_epoch=? WHERE id=?')
      .run('epoch-before-restart', job.id);
    context.db.prepare('UPDATE agent_workstreams SET executor_epoch=? WHERE id=?')
      .run('epoch-before-restart', context.workstream.id);
    let probeStarted!: () => void;
    const started = new Promise<void>((resolve) => { probeStarted = resolve; });
    let releaseProbe!: (value: Record<string, { type: string }>) => void;
    const probe = new Promise<Record<string, { type: string }>>((resolve) => { releaseProbe = resolve; });
    context.engine.getSessionStatuses.mockImplementation(async () => {
      probeStarted();
      return probe;
    });

    const reconciling = context.coordinator.reconcileAfterEngineReady();
    await started;
    expect(context.workstreams.revise(OWNER, PROJECT, context.workstream.id, 1, {
      goal: 'Revise while an old worker status is being read',
    })).toMatchObject({ revision: 2, state: 'blocked', stateReason: 'controls_revised' });
    releaseProbe({ [context.child.sdkSessionId]: { type: 'busy' } });
    await reconciling;

    const view = await context.coordinator.status(auth, PROJECT, context.workstream.id);
    expect(view.workstream).toMatchObject({ revision: 2, state: 'blocked', stateReason: 'controls_revised' });
    expect(view.jobs.find((item) => item.id === job.id)).toMatchObject({
      state: 'unknown',
      stateReason: 'native_status_unknown',
    });
    expect(context.db.prepare('SELECT host_epoch FROM agent_bridge_jobs WHERE id=?').get(job.id))
      .toMatchObject({ host_epoch: 'epoch-before-restart' });
    context.db.close();
  });

  it('R3: flag drift during an awaited terminal read retains evidence but fences application and readiness', async () => {
    let enabled = true;
    const context = fixture({ enabled: () => enabled });
    const job = bindRunningJob(context);
    await context.coordinator.reconcileAfterEngineReady();
    let started!: () => void;
    const pageStarted = new Promise<void>((resolve) => { started = resolve; });
    let release!: (value: { messages: unknown[]; nextCursor: null }) => void;
    const page = new Promise<{ messages: unknown[]; nextCursor: null }>((resolve) => { release = resolve; });
    context.engine.listMessagesPage.mockImplementation(async () => {
      started();
      return page;
    });

    const observed = context.coordinator.status(auth, PROJECT, context.workstream.id);
    await pageStarted;
    enabled = false;
    release({ messages: [assistantStep('assistant-after-flag-drift', 'stop')], nextCursor: null });
    const view = await observed;

    expect(view.workstream).toMatchObject({ state: 'blocked', stateReason: 'coordinator_runtime_authority_changed' });
    expect(view.readiness).toMatchObject({ available: false, reason: 'workstreams_opt_in_required' });
    expect(view.jobs.find((item) => item.id === job.id)).toMatchObject({
      state: 'succeeded', application: { status: 'stale', reason: 'runtime_authority_changed_before_result' },
    });
    context.db.close();
  });

  it('R3: profile grant drift during an awaited terminal read fences the receipt rather than re-enabling it', async () => {
    const context = fixture();
    const job = bindRunningJob(context);
    await context.coordinator.reconcileAfterEngineReady();
    let started!: () => void;
    const pageStarted = new Promise<void>((resolve) => { started = resolve; });
    let release!: (value: { messages: unknown[]; nextCursor: null }) => void;
    const page = new Promise<{ messages: unknown[]; nextCursor: null }>((resolve) => { release = resolve; });
    context.engine.listMessagesPage.mockImplementation(async () => {
      started();
      return page;
    });

    const observed = context.coordinator.status(auth, PROJECT, context.workstream.id);
    await pageStarted;
    context.profile.allowedMcpsJson = JSON.stringify({ rhythm: ['another_tool'] });
    context.profile.revision = 2;
    release({ messages: [assistantStep('assistant-after-profile-drift', 'stop')], nextCursor: null });
    const view = await observed;

    expect(view.workstream).toMatchObject({ state: 'blocked', stateReason: 'coordinator_runtime_authority_changed' });
    expect(view.jobs.find((item) => item.id === job.id)).toMatchObject({
      state: 'succeeded', application: { status: 'stale', reason: 'runtime_authority_changed_before_result' },
    });
    context.db.close();
  });

  it('R3: flag drift during asynchronous Run next preparation prevents a fresh session and prompt', async () => {
    let enabled = true;
    let scopeStarted!: () => void;
    const started = new Promise<void>((resolve) => { scopeStarted = resolve; });
    let releaseScope!: (scope: ProfileScope) => void;
    const delayedScope = new Promise<ProfileScope>((resolve) => { releaseScope = resolve; });
    const context = fixture({
      enabled: () => enabled,
      profileScopeResolver: async () => {
        scopeStarted();
        return delayedScope;
      },
    });
    await context.coordinator.reconcileAfterEngineReady();
    const run = context.coordinator.runNext(auth, PROJECT, context.workstream.id, {
      expectedRevision: context.workstream.revision,
      commandKey: 'run-flag-drift-during-preparation',
      targetProfileId: 'worker-profile',
      parentSessionId: 'parent-local',
      policy: { maxTurns: 1, maxWallTimeSeconds: 300, maxTokens: 100, queueDeadlineAt: null },
      references: [],
    });
    await started;
    enabled = false;
    releaseScope({
      model: { providerID: 'provider', modelID: 'model' },
      mcpRoleConfig: null,
      allowedSkillsJson: null,
      systemPrompt: null,
      ocAgent: null,
      modelTierHint: null,
    });
    const view = await run;

    expect(view.workstream).toMatchObject({ state: 'blocked', stateReason: 'workstreams_opt_in_required' });
    expect(context.engine.createSession).not.toHaveBeenCalled();
    expect(context.engine.promptAsync).not.toHaveBeenCalled();
    context.db.close();
  });

  it('R4: an actual overshoot blocks resume and a forged ready projection cannot admit another Run next', async () => {
    const context = fixture();
    const job = bindRunningJob(context, NOW, 1);
    await context.coordinator.reconcileAfterEngineReady();
    const terminal = await context.coordinator.status(auth, PROJECT, context.workstream.id);
    expect(terminal.workstream).toMatchObject({ state: 'blocked', stateReason: 'budget_overshoot_hold' });
    expect(terminal.budget).toMatchObject({ authorizedTokens: 1, actualTokens: 30, overshoot: true, holdReason: 'budget_overshoot' });
    await expect(context.coordinator.resume(
      auth, PROJECT, context.workstream.id, terminal.workstream.revision,
    )).rejects.toThrow('budget_overshoot');

    // Even if an unrelated runtime projection mistakenly says ready, durable
    // actual usage remains the admission authority and no worker can be made.
    context.workstreams.setRuntimeState({
      ownerUserId: OWNER, projectId: PROJECT, id: context.workstream.id,
      state: 'ready', reason: null, executorEpoch: 'epoch-current', lastJobId: job.id,
    });
    const bypass = await context.coordinator.runNext(auth, PROJECT, context.workstream.id, {
      expectedRevision: terminal.workstream.revision,
      commandKey: 'run-after-overshoot',
      targetProfileId: 'worker-profile',
      parentSessionId: 'not-reached-parent',
      policy: { maxTurns: 1, maxWallTimeSeconds: 300, maxTokens: 100, queueDeadlineAt: null },
      references: [],
    });
    expect(bypass.workstream).toMatchObject({ state: 'blocked', stateReason: 'budget_overshoot_hold' });
    expect(context.engine.createSession).not.toHaveBeenCalled();
    context.db.close();
  });

  it('R4: actual usage that exactly exhausts authorization stays blocked after reconciliation', async () => {
    const context = fixture();
    const job = bindRunningJob(context, NOW, 30);
    await context.coordinator.reconcileAfterEngineReady();

    const terminal = await context.coordinator.status(auth, PROJECT, context.workstream.id);

    expect(terminal.workstream).toMatchObject({ state: 'blocked', stateReason: 'budget_exhausted_hold' });
    expect(terminal.budget).toMatchObject({
      authorizedTokens: 30,
      actualTokens: 30,
      remainingTokens: 0,
      holdReason: 'budget_exhausted',
    });
    await expect(context.coordinator.resume(
      auth, PROJECT, context.workstream.id, terminal.workstream.revision,
    )).rejects.toThrow('budget_exhausted');
    context.db.close();
  });

  it('R2/R4: malformed persisted terminal usage is held unknown and cannot fund a later admission', async () => {
    const context = fixture();
    const job = bindRunningJob(context);
    await context.coordinator.reconcileAfterEngineReady();
    await context.coordinator.status(auth, PROJECT, context.workstream.id);
    context.db.prepare('UPDATE agent_bridge_jobs SET native_usage_json=? WHERE id=?').run(
      JSON.stringify({ status: 'actual', totalTokens: 'truncated-or-invalid' }), job.id,
    );

    const held = context.jobs.coordinatorBudgetState({ localUserId: OWNER, workstreamId: context.workstream.id });
    expect(held).toMatchObject({ holdReason: 'budget_usage_unknown', unknownJobIds: [job.id] });
    const blocked = await context.coordinator.runNext(auth, PROJECT, context.workstream.id, {
      expectedRevision: 1,
      commandKey: 'run-after-malformed-usage',
      targetProfileId: 'worker-profile',
      parentSessionId: 'not-reached-parent',
      policy: { maxTurns: 1, maxWallTimeSeconds: 300, maxTokens: 100, queueDeadlineAt: null },
      references: [],
    });
    expect(blocked.workstream).toMatchObject({ state: 'blocked', stateReason: 'budget_usage_unknown_hold' });
    expect(context.engine.createSession).not.toHaveBeenCalled();
    context.db.close();
  });

  it('R6: one terminal result resolves all selected criteria atomically and refuses a partial application', async () => {
    const context = fixture();
    context.db.prepare('UPDATE agent_workstreams SET checkpoint_json=? WHERE id=?').run(JSON.stringify({
      version: 1,
      criteria: [
        { id: 'criterion-1', status: 'pending' },
        { id: 'criterion-2', status: 'pending' },
      ],
      references: [],
      nextAction: { kind: 'review', scope: PROJECT },
    }), context.workstream.id);
    const job = bindRunningJob(context);
    await context.coordinator.reconcileAfterEngineReady();
    const terminal = await context.coordinator.status(auth, PROJECT, context.workstream.id);
    await expect(context.coordinator.waiveCriteria(
      auth, PROJECT, context.workstream.id, terminal.workstream.revision, job.id, ['criterion-1'],
    )).rejects.toThrow('criterion is unavailable');

    const applied = await context.coordinator.waiveCriteria(
      auth, PROJECT, context.workstream.id, terminal.workstream.revision, job.id,
      ['criterion-1', 'criterion-2'],
    );
    expect(applied.workstream).toMatchObject({ state: 'completed', revision: 2 });
    expect(applied.workstream.checkpoint.criteria).toEqual([
      expect.objectContaining({ id: 'criterion-1', status: 'waived' }),
      expect.objectContaining({ id: 'criterion-2', status: 'waived' }),
    ]);
    expect(applied.jobs.find((item) => item.id === job.id)?.application).toMatchObject({
      status: 'applied', criteria: [
        { criterionId: 'criterion-1', criterionStatus: 'waived' },
        { criterionId: 'criterion-2', criterionStatus: 'waived' },
      ],
    });
    context.db.close();
  });

  it('R7: boot walks every outside-epoch page before admitting readiness', async () => {
    const context = fixture();
    for (let index = 0; index < 21; index += 1) {
      const old = context.jobs.createNativeOrReplay({
        localUserId: OWNER,
        workstreamId: context.workstream.id,
        projectId: PROJECT,
        capturedRevision: context.workstream.revision,
        hostEpoch: 'epoch-before-restart',
        commandKey: `old-epoch-${index}`,
        targetAgentId: 'worker-profile',
        targetRevision: 1,
        parent: { runtimeInstance: 'old-boot', sessionId: 'parent-local', agentId: 'parent', projectionId: null },
        now: `2026-10-03T12:00:${String(index).padStart(2, '0')}.000Z`,
      }).row;
      context.jobs.configureCoordinatorNativeJob({
        localUserId: OWNER,
        workstreamId: context.workstream.id,
        jobId: old.id,
        metadata: {
          policy: { maxTurns: 1, maxWallTimeSeconds: 300, maxTokens: 100, queueDeadlineAt: null },
          budget: { schemaVersion: 1, authorizedTokens: 100, units: 'tokens' },
          estimate: { authorizedTokens: 100 },
          targetProfileId: 'worker-profile',
          targetProfileRevision: 1,
        },
        now: NOW,
      });
    }

    const reconciliation = await context.coordinator.reconcileAfterEngineReady();
    const readiness = await context.coordinator.readiness();

    expect(reconciliation).toMatchObject({ examined: 21, reattached: 0, unknown: 21 });
    expect(context.jobs.listNativeForWorkstream({ localUserId: OWNER, workstreamId: context.workstream.id })
      .every((job) => job.state === 'unknown')).toBe(true);
    expect(readiness).toMatchObject({ available: true, hostEpoch: 'epoch-current' });
    expect(context.engine.createSession).not.toHaveBeenCalled();
    expect(context.engine.promptAsync).not.toHaveBeenCalled();
    context.db.close();
  });
});
