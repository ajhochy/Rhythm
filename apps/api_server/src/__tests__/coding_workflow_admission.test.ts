/**
 * G2 S2: the schema-6 workflow admission through the REAL conversation
 * service + conversation repository + PersistentWorkstreamCoordinator + native
 * job repository. Only the engine network edge, the indexed-memory resolver and
 * the async-delegation adapter (the SDK boundary) are stubbed. The adapter stub
 * honours the production contract: it calls the typed `onPrepared` exactly once
 * and counts an SDK request only when that durable hook returned true.
 */
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuthContext } from '../middleware/auth_middleware';
import { setDb } from '../database/db';
import { installAgentWorkstreamsSchema } from '../database/agent_workstreams_schema';
import { installCoordinatorConversationSchema } from '../database/coordinator_conversation_schema';
import { installAgentBridgeSchema } from '../shared_agents/bridge_schema';
import { AgentBridgeJobsRepository } from '../shared_agents/delegation_jobs_repository';
import { CoordinatorConversationsRepository } from '../repositories/coordinator_conversations_repository';
import { AgentWorkstreamsRepository } from '../repositories/agent_workstreams_repository';
import { CoordinatorConversationContextAssembler } from '../services/coordinator_conversation_context';
import { CoordinatorConversationService } from '../services/coordinator_conversation_service';
import { PersistentWorkstreamCoordinator } from '../services/persistent_workstream_coordinator';
import type { CodingWorkflowPreparedBinding } from '../services/agent_delegation_service';
import type { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import type { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import type { ManagedWorkstreamContextRepository } from '../repositories/managed_workstream_context_repository';
import type { ProfileScope } from '../services/agent_profile_scope';

// The real coordinator/native job contract reads the wall clock (queue deadline > now).
const now = new Date();
const scope = { ownerUserId: 7, projectId: 'project-a', sessionId: 'chat-a' };
const auth = { sessionToken: 'test-auth', user: { id: scope.ownerUserId } } as AuthContext;
const ENGINE = { version: 'test-engine', pid: 991, bootId: 'boot-g2' };
const HASH = 'a'.repeat(64);
const INSTANCE = 'b'.repeat(64);

const profiles: Record<string, Record<string, unknown>> = {
  'readonly-profile': {
    id: 'readonly-profile', enabled: true, isAgent: true, locked: false,
    modelProvider: 'provider-a', modelId: 'model-a', revision: 9,
  },
  'workflow-orchestrator': {
    id: 'workflow-orchestrator', label: 'Workflow', allowedMcpsJson: null, enabled: true, isAgent: true, isManager: true, locked: false,
    modelProvider: 'provider-a', modelId: 'model-a', revision: 3,
    allowedDelegatesJson: JSON.stringify(['verification-gate']),
  },
  'verification-gate': {
    id: 'verification-gate', label: 'Verify', allowedMcpsJson: null, enabled: true, isAgent: true, locked: false,
    modelProvider: 'provider-a', modelId: 'model-a', revision: 1,
  },
};

function admission(over: Record<string, unknown> = {}) {
  return {
    commandKey: 'wf-plan-1', totalTokenAuthorization: 4096, maxTurns: 2 as const, maxWallTimeSeconds: 300,
    expiresInSeconds: 600, acknowledgesSoftTotalTokenAuthorization: true as const, purpose: 'workflow' as const,
    acknowledgesCodingWorkflowCoverage: true as const,
    workflowCheck: { kind: 'selected_reference_summary_v1' as const, sourceId: 'note-1', expectedVersion: 'v7' },
    ...over,
  };
}

function harness(options: { bindFails?: boolean; actorOwns?: (userId: number) => boolean } = {}) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE agent_sessions (
    id TEXT PRIMARY KEY, owner_user_id INTEGER, project_id TEXT, parent_session_id TEXT,
    is_system INTEGER NOT NULL DEFAULT 0, category TEXT NOT NULL DEFAULT 'chat', profile_id TEXT, sdk_session_id TEXT,
    archived_at TEXT, permission_mode TEXT NOT NULL DEFAULT 'default', approval_bypass_explicit INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  db.exec(`CREATE TABLE agent_session_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
    role TEXT NOT NULL, raw_text TEXT NOT NULL, stripped_text TEXT NOT NULL)`);
  db.prepare(`INSERT INTO agent_sessions (id, owner_user_id, project_id, parent_session_id, is_system, category, profile_id,
    sdk_session_id, permission_mode, approval_bypass_explicit, created_at, updated_at)
    VALUES (?, ?, ?, NULL, 0, 'chat', 'readonly-profile', 'sdk-root', 'plan', 0, ?, ?)`)
    .run(scope.sessionId, scope.ownerUserId, scope.projectId, now.toISOString(), now.toISOString());
  installCoordinatorConversationSchema(db);
  installAgentWorkstreamsSchema(db);
  installAgentBridgeSchema(db);
  const previous = setDb(db);

  const root = {
    id: scope.sessionId, ownerUserId: scope.ownerUserId, projectId: scope.projectId, parentSessionId: null,
    isSystem: false, category: 'chat', sdkSessionId: 'sdk-root', cwd: '/safe/project', profileId: 'readonly-profile',
    providerId: 'provider-a', modelId: 'model-a', modelMode: 'fixed' as const,
    permissionMode: 'plan' as 'plan' | 'default', approvalBypassExplicit: false, status: 'idle',
  };
  const realJobs = new AgentBridgeJobsRepository(db);
  const jobs = new Proxy(realJobs, {
    get(target, prop, receiver) {
      if (prop === 'bindCoordinatorWorkflowPrepared' && options.bindFails) {
        return () => { throw new Error('storage refused'); };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const workstreams = new AgentWorkstreamsRepository();
  const sessions = {
    findById: (id: string) => id === root.id ? root : null,
    findBySdkSessionId: (id: string) => id === root.sdkSessionId ? root : null,
    insert: vi.fn(), setSdkSessionId: vi.fn(), updateStatus: vi.fn(),
  } as unknown as AgentSessionsRepository;
  const configs = { getById: (id: string) => (profiles[id] ?? null) as never } as unknown as AgentConfigsRepository;
  const engine = {
    isReady: true, hasOwnedEngine: true,
    getEngineIdentity: vi.fn(async () => ENGINE),
    createSession: vi.fn(async () => ({ id: 'unexpected-worker' })),
    promptAsync: vi.fn(async () => true),
    abortSession: vi.fn(async () => undefined),
    getSessionStatuses: vi.fn(async () => ({})),
    inspectBoundSessionLifecycles: vi.fn(async (ids: string[]) => ({
      available: true, knownSessionIds: ids, statusBySessionId: {}, pendingQuestionSessionIds: [], pendingPermissionSessionIds: [],
    })),
    listMessagesPage: vi.fn(async () => ({ messages: [], nextCursor: null })),
    listQuestions: vi.fn(async () => []),
    listPermissions: vi.fn(async () => []),
    listMcp: vi.fn(async () => ({ rhythm: { status: 'connected' } })),
  };
  // Indexed-memory source boundary (shared by the service and the coordinator).
  const resolveReference = vi.fn(async (input: {
    ownerUserId: number; projectId: string; workstreamId: string; workstreamRevision: number;
    reference: { sourceId: string; expectedVersion: string };
  }) => {
    const current = input.reference.expectedVersion === 'v7';
    return {
      eligible: current,
      managedReference: current ? {
        schemaVersion: 1, dependencyId: 'dep-note-1', canonicalId: 'canon-1', observedVersion: 'v7', observedHash: HASH,
        sourceNamespace: 'memory-vault', sourceInstance: INSTANCE, ownerUserId: input.ownerUserId,
        projectId: input.projectId, workstreamId: input.workstreamId, workstreamRevision: input.workstreamRevision,
        provenance: 'user_reference',
      } : null,
      receipt: {
        kind: 'memory_vault', verified: current, reason: current ? null : 'version_mismatch', canonicalId: 'canon-1',
        observedVersion: 'v7', observedHash: HASH, sourceNamespace: 'memory-vault', sourceInstance: INSTANCE,
      },
    };
  });
  const coordinator = new PersistentWorkstreamCoordinator({
    artifactResolver: { resolveReference } as never,
    engine: engine as never,
    records: {} as ManagedWorkstreamContextRepository,
    captureAvailable: () => true, enabled: () => true, dbClient: 'sqlite', role: 'local', rhythmMcpServerName: 'rhythm',
    workstreams, jobs, sessions, configs,
    profileScopeResolver: async (): Promise<ProfileScope> => ({
      model: { providerID: 'provider-a', modelID: 'model-a' }, mcpRoleConfig: null, allowedSkillsJson: null,
      systemPrompt: null, ocAgent: null, modelTierHint: null,
    }),
    hostEpoch: 'g2-epoch',
  });
  coordinator.initialize();

  // The async-delegation/SDK boundary. Mirrors delegateToAgentAsync's contract.
  const sdkRequests: CodingWorkflowPreparedBinding[] = [];
  const prepared: boolean[] = [];
  const dispatch = vi.fn(async (input: {
    workflow?: { authorization: CodingWorkflowPreparedBinding['authorization']; workflowBinding?: { jobId: string; expiresAt: string };
      onPrepared?: (binding: CodingWorkflowPreparedBinding) => boolean; isCurrent(): boolean; };
  }) => {
    const workflow = input.workflow!;
    const binding: CodingWorkflowPreparedBinding = {
      authorization: workflow.authorization,
      workflowBinding: {
        schemaVersion: 1, jobId: workflow.workflowBinding!.jobId, rootSdkSessionId: 'sdk-root',
        managerSdkSessionId: 'sdk-manager', expiresAt: workflow.workflowBinding!.expiresAt,
      },
      owner: { ownerUserId: scope.ownerUserId, projectId: scope.projectId, rootSessionId: root.id, rootSdkSessionId: 'sdk-root' },
      delegation: {
        delegationId: 'delegation-1', managerSessionId: 'manager-local', managerSdkSessionId: 'sdk-manager',
        nativeParentSdkSessionId: 'sdk-root',
      },
      dispatch: { dispatchId: 'dispatch-1', sdkUserMessageId: 'msg-anchor-1' },
      engine: ENGINE,
    };
    const ok = workflow.onPrepared?.(binding) === true;
    prepared.push(ok);
    if (!ok || workflow.isCurrent() !== true) return null;
    sdkRequests.push(binding);
    return { delegationId: 'delegation-1', childSessionId: 'manager-local', targetAgentConfigId: 'workflow-orchestrator' as const, delivery: 'accepted' as const };
  });
  const repository = new CoordinatorConversationsRepository(db, () => now);
  const available = <T>(items: T[]) => ({
    availability: 'available' as const, reason: null, complete: true as const, authoritative: true as const,
    observedAt: now.toISOString(), sourceVersion: 'v1', items,
  });
  const service = new CoordinatorConversationService({
    repository,
    context: new CoordinatorConversationContextAssembler({
      tasks: { read: async () => available([]) }, schedules: { read: async () => available([]) },
      rhythms: { read: async () => available([]) }, workstreams: { read: async () => available([]) },
      receipts: { read: async () => available([]) },
    }),
    workstreams,
    sessions: sessions as never,
    configs: configs as never,
    coordinator,
    jobs,
    artifactResolver: { resolveReference } as never,
    codingWorkflow: { dispatch } as never,
    projects: { findById: (id: string) => id === scope.projectId ? { id, cwd: '/safe/project', archivedAt: null } : null } as never,
    projectAccess: {
      canAccess: ({ actor, projectId }: { actor: AuthContext; projectId: string }) =>
        (options.actorOwns ?? ((id) => id === scope.ownerUserId))(actor.user.id) && projectId === scope.projectId,
      canOwnerAccess: ({ ownerUserId, projectId }: { ownerUserId: number; projectId: string }) =>
        ownerUserId === scope.ownerUserId && projectId === scope.projectId,
    },
    enabled: () => true,
    now: () => now,
  });
  const nativeJobs = () => db.prepare(
    `SELECT id, idempotency_key, native_metadata_json FROM agent_bridge_jobs WHERE native_execution_kind='coordinator'`,
  ).all() as Array<{ id: string; idempotency_key: string; native_metadata_json: string }>;
  const close = () => { setDb(previous); db.close(); };
  return { db, service, repository, workstreams, dispatch, resolveReference, sdkRequests, prepared, nativeJobs, root, close };
}

async function captureGoal(h: ReturnType<typeof harness>) {
  const captured = await h.service.receiveMessage(auth, {
    sessionId: scope.sessionId, projectId: scope.projectId, expectedControlRevision: 1,
    commandKey: 'chat-goal-1', message: 'Validate the selected note and write a cited brief.',
  });
  if (captured.kind !== 'created') throw new Error(`expected a captured goal, got ${captured.kind}`);
  return captured;
}

function prepare(h: ReturnType<typeof harness>, captured: Awaited<ReturnType<typeof captureGoal>>, over: Record<string, unknown> = {}, actor = auth) {
  return h.service.preparePlan(actor, {
    sessionId: scope.sessionId, projectId: scope.projectId,
    expectedControlRevision: captured.conversation.controlRevision, goalId: captured.goal.id,
    admission: admission() as never,
    ...over,
  });
}

describe('G2 S2 workflow admission (schema 6) through the real service, repository and coordinator', () => {
  let h: ReturnType<typeof harness> | null = null;
  afterEach(() => { h?.close(); h = null; });

  it('workflow purpose + acknowledgement + workflowCheck creates exactly one durable job and one SDK request', async () => {
    h = harness();
    const captured = await captureGoal(h);
    const result = await prepare(h, captured);
    expect(result.kind).toBe('planned');

    const jobs = h.nativeJobs();
    expect(jobs).toHaveLength(1);
    const metadata = JSON.parse(jobs[0].native_metadata_json);
    expect(metadata).toMatchObject({
      executionKind: 'coding_workflow_durable_consumer',
      targetProfileId: 'workflow-orchestrator',
      workflow: {
        kind: 'coding_workflow',
        authorization: { authorizationId: 'wf-plan-1', ordinal: 1, goalId: captured.goal.id },
        prepared: { dispatch: { dispatchId: 'dispatch-1', sdkUserMessageId: 'msg-anchor-1' } },
      },
    });
    expect(h.prepared).toEqual([true]);
    expect(h.sdkRequests).toHaveLength(1);

    // The stored authority is the schema-6 workflow branch and round-trips.
    const stored = h.repository.get(scope);
    expect(stored).toMatchObject({
      kind: 'found',
      conversation: { continuations: [{
        schemaVersion: 6, purpose: 'workflow', consumedTurns: 1, status: 'consumed',
        permissionAuthority: { schemaVersion: 2, worker: { managedReadOnly: false }, workflow: { targetAgentConfigId: 'workflow-orchestrator' } },
        workflow: { kind: 'coding_workflow', check: { canonicalId: 'canon-1', observedVersion: 'v7', observedHash: HASH } },
      }] },
    });
  });

  it('a CAS replay of the same command key never creates a second job or SDK request', async () => {
    h = harness();
    const captured = await captureGoal(h);
    expect((await prepare(h, captured)).kind).toBe('planned');
    const latest = h.repository.get(scope);
    if (latest.kind !== 'found') throw new Error('conversation missing');
    const replay = await h.service.preparePlan(auth, {
      sessionId: scope.sessionId, projectId: scope.projectId,
      expectedControlRevision: latest.conversation.controlRevision, goalId: captured.goal.id,
      admission: admission() as never,
    });
    expect(replay.kind).toBe('planning_already_linked');
    expect(h.nativeJobs()).toHaveLength(1);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.sdkRequests).toHaveLength(1);
  });

  it('a workflow grant never funds the legacy continue lane', async () => {
    h = harness();
    const captured = await captureGoal(h);
    expect((await prepare(h, captured)).kind).toBe('planned');
    const latest = h.repository.get(scope);
    if (latest.kind !== 'found') throw new Error('conversation missing');
    const result = await h.service.continuePlan(auth, {
      sessionId: scope.sessionId, projectId: scope.projectId, expectedControlRevision: latest.conversation.controlRevision,
      goalId: captured.goal.id, authorizationId: 'wf-plan-1',
    } as never);
    expect(result.kind).toBe('planning_authority_conflict');
    expect(h.nativeJobs()).toHaveLength(1);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
  });

  it('an onPrepared storage failure refuses the durable hook and sends zero SDK requests', async () => {
    h = harness({ bindFails: true });
    const captured = await captureGoal(h);
    const result = await prepare(h, captured);
    expect(result.kind).not.toBe('planned');
    expect(h.prepared).toEqual([false]);
    expect(h.sdkRequests).toEqual([]);
  });

  it.each([
    ['missing workflowCheck', { admission: { ...admission(), workflowCheck: undefined } }, 'planning_authority_unavailable'],
    ['resolver revision mismatch', { admission: admission({ workflowCheck: { kind: 'selected_reference_summary_v1', sourceId: 'note-1', expectedVersion: 'v6' } }) }, 'planning_authority_unavailable'],
    ['wrong project', { projectId: 'project-other' }, null],
  ] as const)('%s: zero dispatch and a named refusal', async (_name, over, kind) => {
    h = harness();
    const captured = await captureGoal(h);
    const result = await prepare(h, captured, over as Record<string, unknown>);
    expect(result.kind).not.toBe('planned');
    if (kind) expect(result.kind).toBe(kind);
    expect(typeof result.kind).toBe('string');
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.nativeJobs()).toEqual([]);
  });

  it('wrong actor: zero dispatch and a named refusal', async () => {
    h = harness();
    const captured = await captureGoal(h);
    const stranger = { sessionToken: 'other', user: { id: 99 } } as AuthContext;
    const result = await prepare(h, captured, {}, stranger);
    expect(result.kind).not.toBe('planned');
    expect(typeof result.kind).toBe('string');
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.nativeJobs()).toEqual([]);
  });

  it('wrong control revision: zero dispatch and revision_conflict', async () => {
    h = harness();
    const captured = await captureGoal(h);
    const result = await prepare(h, captured, { expectedControlRevision: captured.conversation.controlRevision + 5 });
    expect(result.kind).toBe('revision_conflict');
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.nativeJobs()).toEqual([]);
  });

  it('missing coverage acknowledgement is refused at the wire before any service effect', async () => {
    const { parseCoordinatorConversationPreparePlan } = await import('../contracts/coordinator_conversation_contract');
    expect(() => parseCoordinatorConversationPreparePlan({
      sessionId: scope.sessionId, projectId: scope.projectId, expectedControlRevision: 1, goalId: 'goal-1',
      admission: { ...admission(), acknowledgesCodingWorkflowCoverage: undefined },
    })).toThrow(/admission/);
    expect(parseCoordinatorConversationPreparePlan({
      sessionId: scope.sessionId, projectId: scope.projectId, expectedControlRevision: 1, goalId: 'goal-1',
      admission: admission(),
    })).toMatchObject({ admission: { purpose: 'workflow', workflowCheck: { kind: 'selected_reference_summary_v1' } } });
  });
});
