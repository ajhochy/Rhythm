import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setDb } from '../database/db';
import { installAgentWorkstreamsSchema } from '../database/agent_workstreams_schema';
import { AgentWorkstreamsRepository } from '../repositories/agent_workstreams_repository';
import { AgentBridgeJobsRepository } from '../shared_agents/delegation_jobs_repository';
import { installAgentBridgeSchema } from '../shared_agents/bridge_schema';
import { parseRunNext } from '../contracts/agent_workstream_contract';
import {
  PersistentWorkstreamCoordinator,
  type WorkstreamRunRequest,
} from '../services/persistent_workstream_coordinator';
import type { BoundSessionLifecycleInspection } from '../services/opencode_client_service';
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
  captureAvailable?: boolean | (() => boolean);
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
    status: 'idle', ownerUserId: OWNER, projectId: PROJECT, parentSessionId: 'parent-local',
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
    inspectBoundSessionLifecycles: vi.fn(async (
      sdkSessionIds: string[],
      _directory: string,
    ): Promise<BoundSessionLifecycleInspection> => ({
      available: true,
      knownSessionIds: sdkSessionIds,
      statusBySessionId: {},
      pendingQuestionSessionIds: [],
      pendingPermissionSessionIds: [],
    })),
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
    captureAvailable: () => typeof options.captureAvailable === 'function'
      ? options.captureAvailable()
      : options.captureAvailable ?? true,
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
  return { db, coordinator, engine, jobs, workstream, workstreams, child, parent, profile };
}

const RUN_SCOPE: ProfileScope = {
  model: { providerID: 'provider', modelID: 'model' },
  mcpRoleConfig: null,
  allowedSkillsJson: null,
  systemPrompt: null,
  ocAgent: null,
  modelTierHint: null,
};

function runInput(context: Fixture, commandKey = 'run-capacity'): WorkstreamRunRequest {
  return {
    expectedRevision: context.workstream.revision,
    commandKey,
    targetProfileId: 'worker-profile',
    parentSessionId: 'parent-local',
    softTokenBudgetAcknowledged: true,
    policy: { maxTurns: 1, maxWallTimeSeconds: 300, maxTokens: 20_000, queueDeadlineAt: null },
    references: [],
  };
}

/** Minimal real SQLite shape for the legacy lifecycle evidence read by R4. */
function installLegacyCapacityLifecycleSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE agent_sessions (
      id TEXT PRIMARY KEY,
      owner_user_id INTEGER NOT NULL,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      sdk_session_id TEXT,
      cwd TEXT NOT NULL,
      parent_session_id TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE agent_async_delegations (
      id TEXT PRIMARY KEY,
      parent_session_id TEXT NOT NULL,
      child_session_id TEXT NOT NULL,
      target_agent_config_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function seedLegacyCapacityDelegation(
  db: Database.Database,
  input: {
    id: string;
    parentId?: string;
    childStatus?: string;
    delegationStatus?: 'dispatched' | 'waking';
    childSdkSessionId?: string;
    childCwd?: string;
    childParentSessionId?: string;
    ownerUserId?: number;
    projectId?: string;
  },
): { parentId: string; childId: string; sdkSessionId: string } {
  const parentId = input.parentId ?? 'legacy-parent-other-owner';
  const childId = `legacy-child-${input.id}`;
  const sdkSessionId = input.childSdkSessionId ?? `legacy-sdk-${input.id}`;
  const childCwd = input.childCwd ?? '/legacy/project';
  const ownerUserId = input.ownerUserId ?? OWNER + 99;
  const projectId = input.projectId ?? 'other-project';
  db.prepare(`INSERT OR IGNORE INTO agent_sessions
    (id, owner_user_id, project_id, status, sdk_session_id, cwd, parent_session_id, updated_at)
    VALUES (?, ?, ?, 'idle', ?, ?, NULL, ?)`)
    .run(parentId, ownerUserId, projectId, `legacy-parent-sdk-${parentId}`, childCwd, NOW);
  db.prepare(`INSERT INTO agent_sessions
    (id, owner_user_id, project_id, status, sdk_session_id, cwd, parent_session_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      childId,
      ownerUserId,
      projectId,
      input.childStatus ?? 'idle',
      sdkSessionId,
      childCwd,
      input.childParentSessionId ?? parentId,
      NOW,
    );
  db.prepare(`INSERT INTO agent_async_delegations
    (id, parent_session_id, child_session_id, target_agent_config_id, status, created_at, updated_at)
    VALUES (?, ?, ?, 'legacy-worker', ?, ?, ?)`)
    .run(input.id, parentId, childId, input.delegationStatus ?? 'dispatched', NOW, NOW);
  return { parentId, childId, sdkSessionId };
}

function bindRunningJob(context: Fixture, now = new Date().toISOString(), maxTokens = 100) {
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

function seedOutsideEpochCoordinatorJob(
  context: Fixture,
  input: { workstreamId: string; revision: number; commandKey: string; now?: string },
) {
  const now = input.now ?? NOW;
  const created = context.jobs.createNativeOrReplay({
    localUserId: OWNER,
    workstreamId: input.workstreamId,
    projectId: PROJECT,
    capturedRevision: input.revision,
    hostEpoch: 'epoch-before-restart',
    commandKey: input.commandKey,
    targetAgentId: 'worker-profile',
    targetRevision: 1,
    parent: {
      runtimeInstance: 'boot-before-restart', sessionId: 'parent-local', agentId: 'parent', projectionId: null,
    },
    now,
  }).row;
  context.jobs.configureCoordinatorNativeJob({
    localUserId: OWNER,
    workstreamId: input.workstreamId,
    jobId: created.id,
    metadata: {
      policy: { maxTurns: 1, maxWallTimeSeconds: 300, maxTokens: 100, queueDeadlineAt: null },
      budget: { schemaVersion: 1, authorizedTokens: 100, units: 'tokens' },
      estimate: { authorizedTokens: 100 },
      targetProfileId: 'worker-profile',
      targetProfileRevision: 1,
      requestedModel: { providerId: 'requested-provider', modelId: 'requested-model' },
    },
    now,
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
      cost: 0,
    },
    parts: [{ type: 'text', text: 'worker prose must never be persisted in result metadata' }],
  };
}

function assistantStepForParent(
  id: string,
  finish: string,
  parentID: string,
  tokens?: Record<string, unknown>,
) {
  const step = assistantStep(id, finish, tokens);
  step.info.parentID = parentID;
  return step;
}

function capturedShapeTerminalStep() {
  const step = assistantStep('assistant-fictional-terminal', 'stop', {
    total: 4_742,
    input: 4_634,
    output: 37,
    reasoning: 71,
    cache: { read: 0, write: 0 },
  });
  step.info.providerID = 'openai';
  step.info.modelID = 'gpt-6.1-sol';
  return step;
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
      softTokenBudgetAcknowledged: true,
      policy: { maxTurns: 1, maxWallTimeSeconds: 300, maxTokens: 100, queueDeadlineAt: null },
      references: [],
    });
    expect(view.workstream).toMatchObject({ state: 'blocked', stateReason: 'workstreams_opt_in_required' });
    expect(context.engine.getEngineIdentity).not.toHaveBeenCalled();
    expect(context.engine.listMcp).not.toHaveBeenCalled();
    expect(context.engine.createSession).not.toHaveBeenCalled();
    expect(context.engine.promptAsync).not.toHaveBeenCalled();
    expect(context.engine.abortSession).not.toHaveBeenCalled();
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

  it('R7: an explicit strict omitted-idle recheck records complete actual usage without reopening paused controls', async () => {
    const context = fixture({ terminalMessages: [capturedShapeTerminalStep()] });
    const job = bindRunningJob(context, new Date().toISOString(), 512);
    await context.coordinator.reconcileAfterEngineReady();
    const cancellationAt = new Date().toISOString();
    expect(context.jobs.requestCoordinatorCancellation({
      localUserId: OWNER,
      workstreamId: context.workstream.id,
      jobId: job.id,
      reason: 'termination_unconfirmed',
      now: cancellationAt,
    })).toMatchObject({ state: 'unknown', cancel_requested_at: cancellationAt });
    expect(context.workstreams.pause(OWNER, PROJECT, context.workstream.id, 1)).toMatchObject({
      state: 'paused', stateReason: 'user_paused', revision: 2,
    });
    const pausedControls = context.db.prepare('SELECT * FROM agent_workstreams WHERE id=?').get(context.workstream.id);

    const reconciled = await context.coordinator.reconcileUnknownFromEngine(
      auth, PROJECT, context.workstream.id, 2, job.id,
    );

    expect(context.db.prepare('SELECT * FROM agent_workstreams WHERE id=?').get(context.workstream.id))
      .toEqual(pausedControls);
    expect(reconciled.workstream).toMatchObject({ state: 'paused', stateReason: 'user_paused', revision: 2 });
    expect(reconciled.workstream.checkpoint.criteria).toEqual([
      expect.objectContaining({ id: 'criterion-1', status: 'pending' }),
    ]);
    expect(reconciled.jobs.find((item) => item.id === job.id)).toMatchObject({
      state: 'succeeded',
      cancellationRequestedAt: cancellationAt,
      usage: {
        status: 'actual', totalTokens: 4_742, inputTokens: 4_634,
        outputTokens: 37, reasoningTokens: 71, cacheReadTokens: 0,
        cacheWriteTokens: 0, authorizedTokens: 512, overshoot: true,
      },
      result: {
        status: 'succeeded', terminalMessageId: 'assistant-fictional-terminal',
        servedProviderId: 'openai', servedModelId: 'gpt-6.1-sol',
        usageStatus: 'actual',
        terminalObservation: {
          kind: 'strict_bound_session_lifecycle',
          status: 'idle_omitted_after_complete_snapshot',
          originalHostEpoch: 'epoch-current', originalParentRuntimeInstance: 'boot-test',
          observedEngineBootId: 'boot-test',
        },
        priorUnknownBoundary: {
          stateReason: 'native_status_unknown', resultReason: 'termination_unconfirmed',
          cancellationRequestedAt: cancellationAt,
        },
      },
      application: { status: 'stale', reason: 'controls_or_user_state_changed_before_result' },
    });
    expect(reconciled.budget).toMatchObject({
      authorizedTokens: 512, actualTokens: 4_742, committedTokens: 4_742,
      remainingTokens: 0, overshoot: true, holdReason: 'budget_overshoot',
    });
    expect(context.engine.createSession).not.toHaveBeenCalled();
    expect(context.engine.promptAsync).not.toHaveBeenCalled();
    expect(context.engine.abortSession).not.toHaveBeenCalled();
    const terminalRow = context.db.prepare('SELECT * FROM agent_bridge_jobs WHERE id=?').get(job.id);
    const messageCalls = context.engine.listMessagesPage.mock.calls.length;
    await context.coordinator.status(auth, PROJECT, context.workstream.id);
    expect(context.db.prepare('SELECT * FROM agent_bridge_jobs WHERE id=?').get(job.id)).toEqual(terminalRow);
    expect(context.engine.listMessagesPage).toHaveBeenCalledTimes(messageCalls);
    context.db.close();
  });

  it('R7: a current strict busy observation keeps a locally lagged working child running', async () => {
    const context = fixture();
    const job = bindRunningJob(context, new Date().toISOString());
    context.child.status = 'working';
    context.engine.inspectBoundSessionLifecycles.mockResolvedValue({
      available: true,
      knownSessionIds: [context.child.sdkSessionId],
      statusBySessionId: { [context.child.sdkSessionId]: { type: 'busy' } },
      pendingQuestionSessionIds: [],
      pendingPermissionSessionIds: [],
    });
    await context.coordinator.reconcileAfterEngineReady();

    const view = await context.coordinator.status(auth, PROJECT, context.workstream.id);

    expect(view.workstream).toMatchObject({ state: 'running' });
    expect(view.jobs.find((item) => item.id === job.id)).toMatchObject({
      state: 'running', usage: null, result: null,
    });
    expect(context.engine.inspectBoundSessionLifecycles).toHaveBeenCalledTimes(1);
    expect(context.engine.listMessagesPage).not.toHaveBeenCalled();
    expect(context.engine.createSession).not.toHaveBeenCalled();
    expect(context.engine.promptAsync).not.toHaveBeenCalled();
    expect(context.engine.abortSession).not.toHaveBeenCalled();
    context.db.close();
  });

  it('R7: a strict omitted-idle terminal receipt accounts despite a locally lagged working child', async () => {
    const context = fixture({ terminalMessages: [capturedShapeTerminalStep()] });
    const job = bindRunningJob(context, new Date().toISOString(), 512);
    context.child.status = 'working';
    await context.coordinator.reconcileAfterEngineReady();

    const view = await context.coordinator.status(auth, PROJECT, context.workstream.id);

    expect(view.jobs.find((item) => item.id === job.id)).toMatchObject({
      state: 'succeeded',
      usage: {
        status: 'actual', totalTokens: 4_742, authorizedTokens: 512, overshoot: true,
      },
      result: {
        terminalMessageId: 'assistant-fictional-terminal',
        terminalObservation: { status: 'idle_omitted_after_complete_snapshot' },
      },
    });
    expect(view.budget).toMatchObject({
      authorizedTokens: 512, actualTokens: 4_742, remainingTokens: 0,
      overshoot: true, holdReason: 'budget_overshoot',
    });
    expect(context.engine.inspectBoundSessionLifecycles).toHaveBeenCalledTimes(2);
    expect(context.engine.createSession).not.toHaveBeenCalled();
    expect(context.engine.promptAsync).not.toHaveBeenCalled();
    expect(context.engine.abortSession).not.toHaveBeenCalled();
    context.db.close();
  });

  it('R7: identity drift during terminal reads holds unknown, while an MCP drift records only a stale receipt', async () => {
    const identity = fixture();
    const identityJob = bindRunningJob(identity);
    let bootId = 'boot-test';
    identity.engine.getEngineIdentity.mockImplementation(async () => ({ version: 'test-engine', pid: 991, bootId }));
    await identity.coordinator.reconcileAfterEngineReady();
    identity.engine.listMessagesPage.mockImplementation(async () => {
      bootId = 'boot-after-terminal-read';
      return { messages: [capturedShapeTerminalStep()], nextCursor: null };
    });

    const identityView = await identity.coordinator.status(auth, PROJECT, identity.workstream.id);

    expect(identityView.jobs.find((item) => item.id === identityJob.id)).toMatchObject({
      state: 'unknown', usage: null, application: null,
    });
    expect(identity.engine.createSession).not.toHaveBeenCalled();
    expect(identity.engine.promptAsync).not.toHaveBeenCalled();
    expect(identity.engine.abortSession).not.toHaveBeenCalled();
    identity.db.close();

    const mcp = fixture();
    const mcpJob = bindRunningJob(mcp);
    await mcp.coordinator.reconcileAfterEngineReady();
    mcp.engine.listMessagesPage.mockImplementation(async () => {
      mcp.engine.listMcp.mockResolvedValue({ rhythm: { status: 'connecting' } });
      return { messages: [capturedShapeTerminalStep()], nextCursor: null };
    });

    const mcpView = await mcp.coordinator.status(auth, PROJECT, mcp.workstream.id);

    expect(mcpView.workstream).toMatchObject({
      state: 'blocked', stateReason: 'coordinator_runtime_authority_changed',
    });
    expect(mcpView.readiness).toMatchObject({ available: false, reason: 'managed_mcp_unavailable' });
    expect(mcpView.jobs.find((item) => item.id === mcpJob.id)).toMatchObject({
      state: 'succeeded', application: { status: 'stale', reason: 'runtime_authority_changed_before_result' },
    });
    expect(mcp.engine.createSession).not.toHaveBeenCalled();
    expect(mcp.engine.promptAsync).not.toHaveBeenCalled();
    expect(mcp.engine.abortSession).not.toHaveBeenCalled();
    mcp.db.close();
  });

  it('R7: a strict recheck retains an existing unknown boundary for incomplete lifecycle, binding, terminal, or usage proof', async () => {
    const cases: Array<{
      name: string;
      terminalMessages?: unknown[];
      prepare?: (context: Fixture) => void;
    }> = [
      {
        name: 'unavailable status, question, or permission snapshot',
        prepare: (context) => context.engine.inspectBoundSessionLifecycles.mockResolvedValue({
          available: false, knownSessionIds: [], statusBySessionId: {},
          pendingQuestionSessionIds: [], pendingPermissionSessionIds: [],
        }),
      },
      {
        name: 'missing exact engine session metadata',
        prepare: (context) => context.engine.inspectBoundSessionLifecycles.mockResolvedValue({
          available: true, knownSessionIds: [], statusBySessionId: {},
          pendingQuestionSessionIds: [], pendingPermissionSessionIds: [],
        }),
      },
      {
        name: 'pending permission',
        prepare: (context) => context.engine.inspectBoundSessionLifecycles.mockResolvedValue({
          available: true, knownSessionIds: [context.child.sdkSessionId], statusBySessionId: {},
          pendingQuestionSessionIds: [], pendingPermissionSessionIds: [context.child.sdkSessionId],
        }),
      },
      {
        name: 'wrong local child owner',
        prepare: (context) => { context.child.ownerUserId = OWNER + 1; },
      },
      {
        name: 'wrong local child project',
        prepare: (context) => { context.child.projectId = 'other-project'; },
      },
      {
        name: 'wrong local child directory',
        prepare: (context) => { context.child.cwd = '/different/project'; },
      },
      {
        name: 'wrong anchored assistant',
        terminalMessages: [assistantStepForParent('assistant-wrong-anchor', 'stop', 'foreign-user-anchor')],
      },
      {
        name: 'missing explicit total where reasoning may overlap output',
        terminalMessages: [assistantStep('assistant-incomplete-usage', 'stop', {
          input: 4_634, output: 37, reasoning: 71, cache: { read: 0, write: 0 },
        })],
      },
    ];
    for (const testCase of cases) {
      const context = fixture({ terminalMessages: testCase.terminalMessages });
      const job = bindRunningJob(context);
      await context.coordinator.reconcileAfterEngineReady();
      context.jobs.markCoordinatorUnknown({
        localUserId: OWNER, workstreamId: context.workstream.id, jobId: job.id,
        reason: 'termination_unconfirmed', now: new Date().toISOString(),
      });
      testCase.prepare?.(context);
      const before = context.db.prepare('SELECT * FROM agent_bridge_jobs WHERE id=?').get(job.id);

      const view = await context.coordinator.reconcileUnknownFromEngine(
        auth, PROJECT, context.workstream.id, context.workstream.revision, job.id,
      );

      expect(view.jobs.find((item) => item.id === job.id), testCase.name).toMatchObject({ state: 'unknown' });
      expect(context.db.prepare('SELECT * FROM agent_bridge_jobs WHERE id=?').get(job.id), testCase.name).toEqual(before);
      expect(context.engine.createSession, testCase.name).not.toHaveBeenCalled();
      expect(context.engine.promptAsync, testCase.name).not.toHaveBeenCalled();
      expect(context.engine.abortSession, testCase.name).not.toHaveBeenCalled();
      context.db.close();
    }
  });

  it('R7: Run next requires server-validated soft total-token acknowledgement and rejects an impossible authored-control floor', async () => {
    const context = fixture();
    const withoutAcknowledgement = {
      ...runInput(context, 'missing-soft-token-ack'),
      softTokenBudgetAcknowledged: false,
    } as unknown as WorkstreamRunRequest;
    await expect(context.coordinator.runNext(
      auth, PROJECT, context.workstream.id, withoutAcknowledgement,
    )).rejects.toThrow('explicit acknowledgement');
    expect(() => parseRunNext({
      expectedRevision: 1,
      commandKey: 'missing-soft-token-ack',
      targetProfileId: 'worker-profile',
      parentSessionId: 'parent-local',
      policy: { maxTurns: 1, maxWallTimeSeconds: 300, maxTokens: 512, queueDeadlineAt: null },
      references: [],
    })).toThrow('invalid workstream run payload');
    await context.coordinator.reconcileAfterEngineReady();

    const blocked = await context.coordinator.runNext(auth, PROJECT, context.workstream.id, {
      ...runInput(context, 'below-authored-control-floor'),
      policy: { maxTurns: 1, maxWallTimeSeconds: 300, maxTokens: 1, queueDeadlineAt: null },
    });

    expect(blocked.workstream).toMatchObject({
      state: 'blocked', stateReason: 'token_authorization_below_authored_control_estimate',
    });
    expect(context.engine.createSession).not.toHaveBeenCalled();
    expect(context.engine.promptAsync).not.toHaveBeenCalled();
    expect(context.engine.abortSession).not.toHaveBeenCalled();
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
    context.engine.inspectBoundSessionLifecycles.mockResolvedValue({
      available: true,
      knownSessionIds: [context.child.sdkSessionId],
      statusBySessionId: {},
      pendingQuestionSessionIds: [context.child.sdkSessionId],
      pendingPermissionSessionIds: [],
    });
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
      softTokenBudgetAcknowledged: true,
      policy: { maxTurns: 1, maxWallTimeSeconds: 300, maxTokens: 20_000, queueDeadlineAt: null },
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
    const job = bindRunningJob(context, new Date().toISOString(), 1);
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
      softTokenBudgetAcknowledged: true,
      policy: { maxTurns: 1, maxWallTimeSeconds: 300, maxTokens: 100, queueDeadlineAt: null },
      references: [],
    });
    expect(bypass.workstream).toMatchObject({ state: 'blocked', stateReason: 'budget_overshoot_hold' });
    expect(context.engine.createSession).not.toHaveBeenCalled();
    context.db.close();
  });

  it('R4: actual usage that exactly exhausts authorization stays blocked after reconciliation', async () => {
    const context = fixture();
    const job = bindRunningJob(context, new Date().toISOString(), 30);
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
      softTokenBudgetAcknowledged: true,
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

  it('R4: 29 historical idle dispatched children clear only through the real omitted-idle protocol proof', async () => {
    const context = fixture({ profileScopeResolver: async () => RUN_SCOPE });
    installLegacyCapacityLifecycleSchema(context.db);
    const legacy = Array.from({ length: 29 }, (_, index) =>
      seedLegacyCapacityDelegation(context.db, { id: `historical-${index + 1}` }),
    );
    const before = context.db.prepare(`SELECT id, status, updated_at
      FROM agent_async_delegations ORDER BY id`).all();
    context.engine.inspectBoundSessionLifecycles.mockImplementation(async (
      ids: string[],
      directory: string,
    ): Promise<BoundSessionLifecycleInspection> => ({
      available: directory === '/legacy/project',
      knownSessionIds: ids,
      // This is the shipped engine's successful idle shape: SessionStatus.set
      // removes the idle entry from the current status map.
      statusBySessionId: {},
      pendingQuestionSessionIds: [],
      pendingPermissionSessionIds: [],
    }));
    context.engine.createSession.mockResolvedValue({ id: 'fresh-coordinator-sdk-session' });
    context.engine.promptAsync.mockResolvedValue(true);

    await context.coordinator.reconcileAfterEngineReady();
    await context.coordinator.runNext(auth, PROJECT, context.workstream.id, runInput(context));

    expect(context.engine.inspectBoundSessionLifecycles).toHaveBeenCalledWith(
      legacy.map((row) => row.sdkSessionId).sort(),
      '/legacy/project',
    );
    expect(context.engine.createSession).toHaveBeenCalledTimes(1);
    expect(context.engine.promptAsync).toHaveBeenCalledTimes(1);
    const admitted = context.jobs.listNativeForWorkstream({
      localUserId: OWNER,
      workstreamId: context.workstream.id,
    })[0];
    expect(JSON.parse(admitted!.native_metadata_json!)).toMatchObject({
      budget: {
        authorizationKind: 'soft_total_tokens',
        softTokenBudgetAcknowledgement: {
          accepted: true, actorUserId: OWNER,
          includes: ['input', 'output', 'reasoning', 'cache'],
          inputOverhead: 'unknown_engine_profile_tool_system',
          outputCapEnforced: false,
        },
      },
      estimate: {
        scope: 'authored_control_only', fullInputEstimate: 'unknown',
        totalUsageEstimate: 'unknown', outputCapEnforced: false,
      },
    });
    expect(context.engine.promptAsync.mock.calls[0]?.[1]).toContain('This is not an output cap and actual usage may exceed it');
    expect(context.db.prepare(`SELECT id, status, updated_at
      FROM agent_async_delegations ORDER BY id`).all()).toEqual(before);
    expect(context.db.prepare(`SELECT COUNT(*) AS count FROM agent_async_delegations
      WHERE status='waking'`).get()).toEqual({ count: 0 });
    context.db.close();
  });

  it('R4: busy/retry legacy children from another owner/project remain host-global occupancy', async () => {
    const context = fixture({ profileScopeResolver: async () => RUN_SCOPE });
    installLegacyCapacityLifecycleSchema(context.db);
    const busy = seedLegacyCapacityDelegation(context.db, { id: 'other-owner-busy' });
    const retry = seedLegacyCapacityDelegation(context.db, { id: 'other-owner-retry' });
    context.engine.inspectBoundSessionLifecycles.mockResolvedValue({
      available: true,
      knownSessionIds: [busy.sdkSessionId, retry.sdkSessionId],
      statusBySessionId: {
        [busy.sdkSessionId]: { type: 'busy' },
        [retry.sdkSessionId]: { type: 'retry' },
      },
      pendingQuestionSessionIds: [],
      pendingPermissionSessionIds: [],
    });

    await context.coordinator.reconcileAfterEngineReady();
    const view = await context.coordinator.runNext(auth, PROJECT, context.workstream.id, runInput(context));

    expect(view.workstream).toMatchObject({ state: 'queued', stateReason: 'worker_capacity_full' });
    expect(context.engine.createSession).not.toHaveBeenCalled();
    expect(context.engine.promptAsync).not.toHaveBeenCalled();
    expect(context.db.prepare(`SELECT status FROM agent_async_delegations ORDER BY id`).all())
      .toEqual([{ status: 'dispatched' }, { status: 'dispatched' }]);
    context.db.close();
  });

  it('R4: missing, failed, malformed, and pending lifecycle evidence remains a capacity hold', async () => {
    const cases: Array<{
      name: string;
      inspection: (ids: string[], directory: string) => BoundSessionLifecycleInspection;
    }> = [
      {
        name: 'known-session metadata missing',
        inspection: (_ids: string[], _directory: string) => ({
          available: true,
          knownSessionIds: [],
          statusBySessionId: {},
          pendingQuestionSessionIds: [],
          pendingPermissionSessionIds: [],
        }),
      },
      {
        name: 'strict response unavailable',
        inspection: (_ids: string[], _directory: string) => ({
          available: false,
          knownSessionIds: [],
          statusBySessionId: {},
          pendingQuestionSessionIds: [],
          pendingPermissionSessionIds: [],
        }),
      },
      {
        name: 'pending question and permission',
        inspection: (ids: string[], _directory: string) => ({
          available: true,
          knownSessionIds: ids,
          statusBySessionId: {},
          pendingQuestionSessionIds: [ids[0]!],
          pendingPermissionSessionIds: [ids[1]!],
        }),
      },
    ];

    for (const testCase of cases) {
      const context = fixture({ profileScopeResolver: async () => RUN_SCOPE });
      installLegacyCapacityLifecycleSchema(context.db);
      seedLegacyCapacityDelegation(context.db, { id: `${testCase.name}-1` });
      seedLegacyCapacityDelegation(context.db, { id: `${testCase.name}-2` });
      context.engine.inspectBoundSessionLifecycles.mockImplementation(async (
        ids: string[],
        directory: string,
      ) => testCase.inspection(ids, directory));

      await context.coordinator.reconcileAfterEngineReady();
      const view = await context.coordinator.runNext(auth, PROJECT, context.workstream.id, runInput(context));

      expect(view.workstream, testCase.name).toMatchObject({ state: 'queued', stateReason: 'worker_capacity_full' });
      expect(context.engine.createSession, testCase.name).not.toHaveBeenCalled();
      expect(context.engine.promptAsync, testCase.name).not.toHaveBeenCalled();
      context.db.close();
    }
  });

  it('R4: pause or revise during a delayed lifecycle proof wins without an SDK child or prompt', async () => {
    for (const action of ['pause', 'revise'] as const) {
      const context = fixture({ profileScopeResolver: async () => RUN_SCOPE });
      installLegacyCapacityLifecycleSchema(context.db);
      const legacy = seedLegacyCapacityDelegation(context.db, { id: `delayed-${action}` });
      let inspectionStarted!: () => void;
      const started = new Promise<void>((resolve) => { inspectionStarted = resolve; });
      let releaseInspection!: (value: BoundSessionLifecycleInspection) => void;
      const pendingInspection = new Promise<BoundSessionLifecycleInspection>((resolve) => { releaseInspection = resolve; });
      context.engine.inspectBoundSessionLifecycles.mockImplementation(async (
        _ids: string[],
        _directory: string,
      ) => {
        inspectionStarted();
        return pendingInspection;
      });

      await context.coordinator.reconcileAfterEngineReady();
      const running = context.coordinator.runNext(auth, PROJECT, context.workstream.id, runInput(context, `run-${action}`));
      await started;
      if (action === 'pause') {
        await context.coordinator.pause(auth, PROJECT, context.workstream.id, context.workstream.revision);
      } else {
        context.workstreams.revise(OWNER, PROJECT, context.workstream.id, context.workstream.revision, {
          goal: 'Controls changed during capacity inspection',
        });
      }
      releaseInspection({
        available: true,
        knownSessionIds: [legacy.sdkSessionId],
        statusBySessionId: {},
        pendingQuestionSessionIds: [],
        pendingPermissionSessionIds: [],
      });
      const view = await running;

      expect(view.workstream).toMatchObject(action === 'pause'
        ? { revision: 2, state: 'paused', stateReason: 'user_paused' }
        : { revision: 2, state: 'blocked', stateReason: 'controls_revised' });
      expect(context.engine.createSession).not.toHaveBeenCalled();
      expect(context.engine.promptAsync).not.toHaveBeenCalled();
      context.db.close();
    }
  });

  it('R4: a capacity-held exact Run-next replay does not create a second native intent', async () => {
    const context = fixture({ profileScopeResolver: async () => RUN_SCOPE });
    installLegacyCapacityLifecycleSchema(context.db);
    const firstLegacy = seedLegacyCapacityDelegation(context.db, { id: 'replay-busy-1' });
    const secondLegacy = seedLegacyCapacityDelegation(context.db, { id: 'replay-busy-2' });
    context.engine.inspectBoundSessionLifecycles.mockResolvedValue({
      available: true,
      knownSessionIds: [firstLegacy.sdkSessionId, secondLegacy.sdkSessionId],
      statusBySessionId: {
        [firstLegacy.sdkSessionId]: { type: 'busy' },
        [secondLegacy.sdkSessionId]: { type: 'busy' },
      },
      pendingQuestionSessionIds: [],
      pendingPermissionSessionIds: [],
    });

    await context.coordinator.reconcileAfterEngineReady();
    const first = await context.coordinator.runNext(auth, PROJECT, context.workstream.id, runInput(context, 'run-replay-held'));
    const second = await context.coordinator.runNext(auth, PROJECT, context.workstream.id, {
      ...runInput(context, 'run-replay-held'),
      expectedRevision: first.workstream.revision,
    });

    expect(first.workstream).toMatchObject({ state: 'queued', stateReason: 'worker_capacity_full' });
    expect(second.workstream).toMatchObject({ state: 'queued', stateReason: 'worker_capacity_full' });
    expect(context.db.prepare(`SELECT COUNT(*) AS count FROM agent_bridge_jobs
      WHERE direction='rhythm_to_native' AND native_execution_kind='coordinator'`).get())
      .toEqual({ count: 1 });
    expect(context.engine.createSession).not.toHaveBeenCalled();
    expect(context.engine.promptAsync).not.toHaveBeenCalled();
    context.db.close();
  });

  it('R5: a later empty-list Refresh completes an empty scan once MCP is actually connected', async () => {
    const context = fixture();
    context.engine.listMcp.mockResolvedValue({ rhythm: { status: 'connecting' } });

    const waiting = await context.coordinator.reconcileAfterEngineReady();
    expect(waiting).toEqual({
      status: 'waiting', reason: 'managed_mcp_unavailable', examined: 0, reattached: 0, unknown: 0,
    });

    context.engine.listMcp.mockResolvedValue({ rhythm: { status: 'connected' } });
    const refreshed = await context.coordinator.list(auth, 'project-empty-refresh', 50);
    const readiness = await context.coordinator.readiness();

    expect(refreshed.items).toEqual([]);
    expect(readiness).toMatchObject({ available: true, reason: null, hostEpoch: 'epoch-current' });
    expect(await context.coordinator.reconcileAfterEngineReady()).toEqual({
      status: 'completed', reason: null, examined: 0, reattached: 0, unknown: 0,
    });
    expect(context.engine.createSession).not.toHaveBeenCalled();
    expect(context.engine.promptAsync).not.toHaveBeenCalled();
    expect(context.engine.abortSession).not.toHaveBeenCalled();
    context.db.close();
  });

  it('R5: an existing unknown cancellation receipt stays byte-exact while another workstream can use the remaining slot', async () => {
    const context = fixture({ profileScopeResolver: async () => RUN_SCOPE });
    const job = bindRunningJob(context);
    context.db.prepare(`UPDATE agent_bridge_jobs
      SET host_epoch=?, state='unknown', state_reason='native_status_unknown',
          cancel_requested_at=?, native_usage_json=NULL, native_result_json=?, updated_at=?
      WHERE id=?`).run(
      'epoch-before-restart',
      '2026-10-03T12:01:00.000Z',
      JSON.stringify({
        schemaVersion: 1,
        status: 'unknown',
        reason: 'termination_unconfirmed',
        cancellation: 'cancelling',
      }),
      '2026-10-03T12:01:00.000Z',
      job.id,
    );
    expect(context.workstreams.pause(OWNER, PROJECT, context.workstream.id, 1))
      .toMatchObject({ state: 'paused', revision: 2, stateReason: 'user_paused' });
    const beforeJob = context.db.prepare('SELECT * FROM agent_bridge_jobs WHERE id=?').get(job.id);
    const beforeWorkstream = context.db.prepare('SELECT * FROM agent_workstreams WHERE id=?').get(context.workstream.id);

    const reconciled = await context.coordinator.reconcileAfterEngineReady();
    const status = await context.coordinator.status(auth, PROJECT, context.workstream.id);

    expect(reconciled).toMatchObject({ status: 'completed', examined: 1, reattached: 0, unknown: 1 });
    expect(context.db.prepare('SELECT * FROM agent_bridge_jobs WHERE id=?').get(job.id)).toEqual(beforeJob);
    expect(context.db.prepare('SELECT * FROM agent_workstreams WHERE id=?').get(context.workstream.id))
      .toEqual(beforeWorkstream);
    expect(status.workstream).toMatchObject({ state: 'paused', revision: 2, stateReason: 'user_paused' });
    expect(status.budget).toMatchObject({ holdReason: 'budget_usage_unknown', unknownJobIds: [job.id] });

    const fresh = context.workstreams.create(OWNER, {
      projectId: PROJECT,
      goal: 'Fresh separate bounded read',
      constraints: 'Do not mutate anything',
      criteria: 'fresh criterion',
      checkpoint: {
        version: 1,
        criteria: [{ id: 'fresh-criterion', status: 'pending' }],
        references: [],
        nextAction: { kind: 'review', scope: PROJECT },
      },
      createKey: 'r5-fresh-workstream',
    }).row;
    context.engine.createSession.mockResolvedValue({ id: 'r5-fresh-sdk-session' });
    context.engine.promptAsync.mockResolvedValue(true);

    await context.coordinator.runNext(auth, PROJECT, fresh.id, {
      ...runInput(context, 'r5-fresh-run'),
      expectedRevision: fresh.revision,
    });

    expect(context.engine.createSession).toHaveBeenCalledTimes(1);
    expect(context.engine.promptAsync).toHaveBeenCalledTimes(1);
    expect(context.engine.abortSession).not.toHaveBeenCalled();
    context.db.close();
  });

  it('R5: two retained unknown native workers keep the host-global cap of two', async () => {
    const context = fixture({ profileScopeResolver: async () => RUN_SCOPE });
    const first = seedOutsideEpochCoordinatorJob(context, {
      workstreamId: context.workstream.id,
      revision: context.workstream.revision,
      commandKey: 'r5-unknown-first',
    });
    context.jobs.markCoordinatorUnknown({
      localUserId: OWNER, workstreamId: context.workstream.id, jobId: first.id,
      reason: 'termination_unconfirmed', now: NOW,
    });
    const secondWorkstream = context.workstreams.create(OWNER, {
      projectId: PROJECT,
      goal: 'Second retained native hold',
      constraints: 'Do not mutate anything',
      criteria: 'second criterion',
      checkpoint: {
        version: 1,
        criteria: [{ id: 'second-criterion', status: 'pending' }],
        references: [],
        nextAction: { kind: 'review', scope: PROJECT },
      },
      createKey: 'r5-unknown-second-workstream',
    }).row;
    const second = seedOutsideEpochCoordinatorJob(context, {
      workstreamId: secondWorkstream.id,
      revision: secondWorkstream.revision,
      commandKey: 'r5-unknown-second',
    });
    context.jobs.markCoordinatorUnknown({
      localUserId: OWNER, workstreamId: secondWorkstream.id, jobId: second.id,
      reason: 'termination_unconfirmed', now: NOW,
    });
    await context.coordinator.reconcileAfterEngineReady();
    const third = context.workstreams.create(OWNER, {
      projectId: PROJECT,
      goal: 'Third bounded read',
      constraints: 'Do not mutate anything',
      criteria: 'third criterion',
      checkpoint: {
        version: 1,
        criteria: [{ id: 'third-criterion', status: 'pending' }],
        references: [],
        nextAction: { kind: 'review', scope: PROJECT },
      },
      createKey: 'r5-capacity-third-workstream',
    }).row;

    const view = await context.coordinator.runNext(auth, PROJECT, third.id, {
      ...runInput(context, 'r5-capacity-third'),
      expectedRevision: third.revision,
    });

    expect(view.workstream).toMatchObject({ state: 'queued', stateReason: 'worker_capacity_full' });
    expect(context.engine.createSession).not.toHaveBeenCalled();
    expect(context.engine.promptAsync).not.toHaveBeenCalled();
    expect(context.engine.abortSession).not.toHaveBeenCalled();
    context.db.close();
  });

  it('R5: simultaneous startup and status reads share one bounded restart scan', async () => {
    const context = fixture();
    const job = bindRunningJob(context);
    context.db.prepare('UPDATE agent_bridge_jobs SET host_epoch=? WHERE id=?')
      .run('epoch-before-restart', job.id);
    context.db.prepare('UPDATE agent_workstreams SET executor_epoch=? WHERE id=?')
      .run('epoch-before-restart', context.workstream.id);
    let scanStarted!: () => void;
    const started = new Promise<void>((resolve) => { scanStarted = resolve; });
    let release!: (value: Record<string, { type: string }>) => void;
    const delayed = new Promise<Record<string, { type: string }>>((resolve) => { release = resolve; });
    context.engine.getSessionStatuses.mockImplementation(async () => {
      scanStarted();
      return delayed;
    });

    const startup = context.coordinator.reconcileAfterEngineReady();
    await started;
    const status = context.coordinator.readiness();
    release({ [context.child.sdkSessionId]: { type: 'busy' } });
    const [reconciled, readiness] = await Promise.all([startup, status]);

    expect(reconciled).toMatchObject({ status: 'completed', examined: 1, reattached: 1, unknown: 0 });
    expect(readiness).toMatchObject({ available: true, reason: null });
    expect(context.engine.getSessionStatuses).toHaveBeenCalledTimes(1);
    expect(context.engine.createSession).not.toHaveBeenCalled();
    expect(context.engine.promptAsync).not.toHaveBeenCalled();
    expect(context.engine.abortSession).not.toHaveBeenCalled();
    context.db.close();
  });

  it('R5: a later owned-engine boot reopens the bounded scan at its lifecycle callback', async () => {
    let bootId = 'boot-before-reload';
    const context = fixture();
    context.engine.getEngineIdentity.mockImplementation(async () => ({
      version: 'test-engine', pid: 991, bootId,
    }));
    await context.coordinator.reconcileAfterEngineReady();
    const pageSpy = vi.spyOn(context.jobs, 'listCoordinatorOutsideEpochPage');

    bootId = 'boot-after-reload';
    const reconciled = await context.coordinator.reconcileAfterEngineReady();

    expect(reconciled).toEqual({
      status: 'completed', reason: null, examined: 0, reattached: 0, unknown: 0,
    });
    expect(pageSpy).toHaveBeenCalledTimes(1);
    expect(context.engine.createSession).not.toHaveBeenCalled();
    expect(context.engine.promptAsync).not.toHaveBeenCalled();
    expect(context.engine.abortSession).not.toHaveBeenCalled();
    context.db.close();
  });

  it('R5: incomplete scans fail closed, expose a safe reason, and retry only on a later explicit read', async () => {
    const context = fixture();
    for (let index = 0; index < 21; index += 1) {
      seedOutsideEpochCoordinatorJob(context, {
        workstreamId: context.workstream.id,
        revision: context.workstream.revision,
        commandKey: `r5-partial-${index}`,
        now: `2026-10-03T12:00:${String(index).padStart(2, '0')}.000Z`,
      });
    }
    const original = context.jobs.listCoordinatorOutsideEpochPage.bind(context.jobs);
    let pageCalls = 0;
    const pageSpy = vi.spyOn(context.jobs, 'listCoordinatorOutsideEpochPage').mockImplementation((input) => {
      pageCalls += 1;
      if (pageCalls >= 2) throw new Error('injected_page_failure');
      return original(input);
    });

    const failed = await context.coordinator.reconcileAfterEngineReady();
    const held = await context.coordinator.readiness();

    expect(failed).toMatchObject({
      status: 'failed', reason: 'restart_reconciliation_scan_failed', examined: 20, unknown: 20,
    });
    expect(held).toMatchObject({ available: false, reason: 'restart_reconciliation_scan_failed' });
    pageSpy.mockRestore();
    const recovered = await context.coordinator.readiness();

    expect(recovered).toMatchObject({ available: true, reason: null });
    expect(context.engine.createSession).not.toHaveBeenCalled();
    expect(context.engine.promptAsync).not.toHaveBeenCalled();
    expect(context.engine.abortSession).not.toHaveBeenCalled();
    context.db.close();
  });

  it('R5: authority drift during an awaited restart probe never publishes completion or mutates the observed worker', async () => {
    const cases: Array<{
      name: string;
      expectedStatus: 'waiting' | 'skipped';
      expectedReason: string;
      change: (context: Fixture, controls: { setEnabled: (value: boolean) => void; setCapture: (value: boolean) => void; setBootId: (value: string) => void }) => void;
    }> = [
      {
        name: 'feature flag', expectedStatus: 'waiting', expectedReason: 'workstreams_opt_in_required',
        change: (_context, controls) => controls.setEnabled(false),
      },
      {
        name: 'capture proof', expectedStatus: 'waiting', expectedReason: 'managed_capture_unavailable',
        change: (_context, controls) => controls.setCapture(false),
      },
      {
        name: 'owned engine', expectedStatus: 'waiting', expectedReason: 'owned_engine_not_ready',
        change: (context) => { context.engine.hasOwnedEngine = false; },
      },
      {
        name: 'MCP status', expectedStatus: 'waiting', expectedReason: 'managed_mcp_unavailable',
        change: (context) => { context.engine.listMcp.mockResolvedValue({ rhythm: { status: 'connecting' } }); },
      },
      {
        name: 'engine identity', expectedStatus: 'waiting', expectedReason: 'owned_engine_identity_changed_during_reconciliation',
        change: (_context, controls) => controls.setBootId('boot-after-restart'),
      },
      {
        name: 'disposal', expectedStatus: 'skipped', expectedReason: 'coordinator_disposed',
        change: (context) => { context.coordinator.dispose(); },
      },
    ];

    for (const testCase of cases) {
      let enabled = true;
      let capture = true;
      let bootId = 'boot-test';
      const context = fixture({
        enabled: () => enabled,
        captureAvailable: () => capture,
      });
      context.engine.getEngineIdentity.mockImplementation(async () => ({
        version: 'test-engine', pid: 991, bootId,
      }));
      const job = bindRunningJob(context);
      context.db.prepare('UPDATE agent_bridge_jobs SET host_epoch=? WHERE id=?')
        .run('epoch-before-restart', job.id);
      context.db.prepare('UPDATE agent_workstreams SET executor_epoch=? WHERE id=?')
        .run('epoch-before-restart', context.workstream.id);
      const before = context.db.prepare('SELECT * FROM agent_bridge_jobs WHERE id=?').get(job.id);
      let probeStarted!: () => void;
      const started = new Promise<void>((resolve) => { probeStarted = resolve; });
      let release!: (value: Record<string, { type: string }>) => void;
      const delayed = new Promise<Record<string, { type: string }>>((resolve) => { release = resolve; });
      context.engine.getSessionStatuses.mockImplementation(async () => {
        probeStarted();
        return delayed;
      });

      const reconciliation = context.coordinator.reconcileAfterEngineReady();
      await started;
      testCase.change(context, {
        setEnabled: (value) => { enabled = value; },
        setCapture: (value) => { capture = value; },
        setBootId: (value) => { bootId = value; },
      });
      release({ [context.child.sdkSessionId]: { type: 'busy' } });
      const result = await reconciliation;

      expect(result, testCase.name).toMatchObject({
        status: testCase.expectedStatus,
        reason: testCase.expectedReason,
        examined: 1,
        reattached: 0,
        unknown: 0,
      });
      expect(context.db.prepare('SELECT * FROM agent_bridge_jobs WHERE id=?').get(job.id), testCase.name)
        .toEqual(before);
      expect(context.engine.createSession, testCase.name).not.toHaveBeenCalled();
      expect(context.engine.promptAsync, testCase.name).not.toHaveBeenCalled();
      expect(context.engine.abortSession, testCase.name).not.toHaveBeenCalled();
      context.db.close();
    }
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

    expect(reconciliation).toMatchObject({ status: 'completed', reason: null, examined: 21, reattached: 0, unknown: 21 });
    expect(context.jobs.listNativeForWorkstream({ localUserId: OWNER, workstreamId: context.workstream.id })
      .every((job) => job.state === 'unknown')).toBe(true);
    expect(readiness).toMatchObject({ available: true, hostEpoch: 'epoch-current' });
    expect(context.engine.createSession).not.toHaveBeenCalled();
    expect(context.engine.promptAsync).not.toHaveBeenCalled();
    context.db.close();
  });
});
