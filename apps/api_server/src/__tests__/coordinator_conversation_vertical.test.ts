import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COORDINATOR_CHANGED_EVENT, opencodeEventHub } from '../services/opencode_event_hub';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import type { AuthContext } from '../middleware/auth_middleware';
import { setDb } from '../database/db';
import { installAgentWorkstreamsSchema } from '../database/agent_workstreams_schema';
import { installCoordinatorConversationSchema } from '../database/coordinator_conversation_schema';
import { CoordinatorConversationsRepository } from '../repositories/coordinator_conversations_repository';
import { AgentWorkstreamsRepository } from '../repositories/agent_workstreams_repository';
import { AgentBridgeJobsRepository } from '../shared_agents/delegation_jobs_repository';
import { installAgentBridgeSchema } from '../shared_agents/bridge_schema';
import { CoordinatorConversationContextAssembler } from '../services/coordinator_conversation_context';
import { CoordinatorConversationService } from '../services/coordinator_conversation_service';
import type {
  FiniteExecutionPermissionRule,
  ResolvedFiniteExecutionScope,
} from '../services/coordinator_finite_execution_scope';
import { parseManagedWorkstreamStructuredProposal } from '../contracts/agent_workstream_contract';
import {
  type CoordinatorTerminalObserver,
  PersistentWorkstreamCoordinator,
} from '../services/persistent_workstream_coordinator';
import type { AgentSession } from '../models/agent_session';
import type { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import type { AgentConfig, AgentConfigsRepository } from '../repositories/agent_configs_repository';
import type { ManagedWorkstreamContextRepository } from '../repositories/managed_workstream_context_repository';
import type { ProfileScope } from '../services/agent_profile_scope';

const now = new Date('2026-10-05T12:00:00.000Z');
const scope = { ownerUserId: 7, projectId: 'project-a', sessionId: 'chat-a' };
const auth = { sessionToken: 'test-auth', user: { id: scope.ownerUserId } } as AuthContext;

function database(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE agent_sessions (
    id TEXT PRIMARY KEY,
    owner_user_id INTEGER,
    project_id TEXT,
    parent_session_id TEXT,
    is_system INTEGER NOT NULL DEFAULT 0,
    category TEXT NOT NULL DEFAULT 'chat',
    profile_id TEXT,
    sdk_session_id TEXT,
    archived_at TEXT,
    permission_mode TEXT NOT NULL DEFAULT 'default',
    approval_bypass_explicit INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE agent_session_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    raw_text TEXT NOT NULL,
    stripped_text TEXT NOT NULL
  )`);
  db.prepare(`INSERT INTO agent_sessions
    (id, owner_user_id, project_id, parent_session_id, is_system, category, profile_id, sdk_session_id, permission_mode, approval_bypass_explicit, created_at, updated_at)
    VALUES (?, ?, ?, NULL, 0, 'chat', 'readonly-profile', 'sdk-root', 'default', 0, ?, ?)`).run(scope.sessionId, scope.ownerUserId, scope.projectId, now.toISOString(), now.toISOString());
  installCoordinatorConversationSchema(db);
  installAgentWorkstreamsSchema(db);
  return db;
}

function context(): CoordinatorConversationContextAssembler {
  const available = <T>(items: T[]) => ({
    availability: 'available' as const,
    reason: null,
    complete: true as const,
    authoritative: true as const,
    observedAt: now.toISOString(),
    sourceVersion: 'test-v1',
    items,
  });
  return new CoordinatorConversationContextAssembler({
    tasks: { read: async () => available([]) },
    schedules: { read: async () => available([]) },
    rhythms: { read: async () => available([]) },
    workstreams: { read: async () => available([]) },
    receipts: { read: async () => available([]) },
  });
}

function actualCoordinator(
  db: Database.Database,
  workstreams: AgentWorkstreamsRepository,
  root: AgentSession,
  profile: AgentConfig,
  terminalObserver?: CoordinatorTerminalObserver,
) {
  installAgentBridgeSchema(db);
  const jobs = new AgentBridgeJobsRepository(db);
  const children = new Map<string, {
    id: string; sdkSessionId: string | null; cwd: string; status: string;
    ownerUserId: number; projectId: string; parentSessionId: string;
    profileId: string | null; permissionMode: 'default'; approvalBypassExplicit: false;
  }>();
  let childCount = 0;
  let createdCount = 0;
  let promptCount = 0;
  const sessions = {
    findById: (id: string) => id === root.id ? root : children.get(id) ?? null,
    findBySdkSessionId: (id: string) => id === root.sdkSessionId ? root : null,
    insert: vi.fn(() => {
      childCount += 1;
      const child = {
        id: `fresh-worker-local-${childCount}`, sdkSessionId: null, cwd: '/safe/project', status: 'idle',
        ownerUserId: scope.ownerUserId, projectId: scope.projectId, parentSessionId: root.id,
        profileId: root.profileId, permissionMode: 'default' as const, approvalBypassExplicit: false as const,
      };
      children.set(child.id, child);
      return child;
    }),
    setSdkSessionId: vi.fn((id: string, sdkSessionId: string) => {
      const child = children.get(id);
      if (child) child.sdkSessionId = sdkSessionId;
    }),
    updateStatus: vi.fn(),
  } as unknown as AgentSessionsRepository;
  const configs = {
    getById: vi.fn((id: string) => id === profile.id ? profile : null),
  } as unknown as AgentConfigsRepository;
  const engine = {
    isReady: true,
    hasOwnedEngine: true,
    getEngineIdentity: vi.fn(async () => ({ version: 'test-engine', pid: 991, bootId: 'boot-c2' })),
    createSession: vi.fn(async () => ({ id: `fresh-worker-sdk-${++createdCount}` })),
    promptAsync: vi.fn(async (...args: unknown[]) => {
      const managed = args[8] as { onPrepared(input: { dispatchId: string; sdkUserMessageId: string }): void };
      promptCount += 1;
      managed.onPrepared({ dispatchId: `dispatch-c2-${promptCount}`, sdkUserMessageId: `sdk-user-c2-${promptCount}` });
      return true;
    }),
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
  const coordinator = new PersistentWorkstreamCoordinator({
    engine: engine as never,
    records: {} as ManagedWorkstreamContextRepository,
    captureAvailable: () => true,
    enabled: () => true,
    dbClient: 'sqlite',
    role: 'local',
    rhythmMcpServerName: 'rhythm',
    workstreams,
    jobs,
    sessions,
    configs,
    profileScopeResolver: async (): Promise<ProfileScope> => ({
      model: { providerID: 'provider-a', modelID: 'model-a' },
      mcpRoleConfig: null,
      allowedSkillsJson: null,
      systemPrompt: null,
      ocAgent: null,
      modelTierHint: null,
    }),
    terminalObserver,
    hostEpoch: 'c2-epoch',
  });
  coordinator.initialize();
  return { coordinator, engine, jobs, sessions, configs };
}

function admission(
  commandKey: string,
  purpose: 'decompose' | 'continue' | 'execute' = 'decompose',
  totalTokenAuthorization = 512,
  maxTurns: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 = 1,
) {
  return {
    commandKey,
    totalTokenAuthorization,
    maxTurns,
    maxWallTimeSeconds: 300,
    expiresInSeconds: 300,
    acknowledgesSoftTotalTokenAuthorization: true as const,
    purpose,
    ...(purpose === 'execute' ? { acknowledgesScopedWorkspaceExecution: true as const } : {}),
  };
}

function structuredProposalParts(
  criterionId: string,
  status: 'pending' | 'blocked' = 'pending',
) {
  return [{
    type: 'text',
    text: JSON.stringify({
      schemaVersion: 1,
      kind: 'workstream_proposal',
      criteria: [{ id: criterionId, status }],
      nextAction: { kind: 'review', scope: scope.projectId },
    }),
  }];
}

function nativeTerminalStructuredProposalParts(
  criterionId: string,
  status: 'pending' | 'blocked' = 'pending',
) {
  return [
    { type: 'step-start', id: `step-start-${criterionId}` },
    ...structuredProposalParts(criterionId, status),
    { type: 'step-finish', id: `step-finish-${criterionId}`, reason: 'stop' },
  ];
}

function authorizedProjectDependencies() {
  return {
    projects: {
      findById: (id: string) => id === scope.projectId
        ? { id, cwd: '/safe/project', archivedAt: null }
        : null,
    } as never,
    projectAccess: {
      canAccess: ({ actor, projectId }: { actor: AuthContext; projectId: string }) =>
        actor.user.id === scope.ownerUserId && projectId === scope.projectId,
      canOwnerAccess: ({ ownerUserId, projectId }: { ownerUserId: number; projectId: string }) =>
        ownerUserId === scope.ownerUserId && projectId === scope.projectId,
    },
  };
}

describe('C2 conversation to existing workstream vertical', () => {
  let db: Database.Database | null = null;
  let previous: Database.Database | null = null;

  afterEach(() => {
    setDb(previous);
    db?.close();
    db = null;
    previous = null;
  });

  it('accepts only a bounded exact structured proposal and never interprets prose as a plan', () => {
    expect(parseManagedWorkstreamStructuredProposal(
      structuredProposalParts('review_exact'),
      scope.projectId,
    )).toEqual({
      schemaVersion: 1,
      kind: 'workstream_proposal',
      criteria: [{ id: 'review_exact', status: 'pending' }],
      nextAction: { kind: 'review', scope: scope.projectId },
    });
    expect(parseManagedWorkstreamStructuredProposal(
      nativeTerminalStructuredProposalParts('review_native_envelope'),
      scope.projectId,
    )).toMatchObject({
      criteria: [{ id: 'review_native_envelope', status: 'pending' }],
      nextAction: { kind: 'review', scope: scope.projectId },
    });
    expect(parseManagedWorkstreamStructuredProposal(
      [
        { type: 'step-start' },
        ...structuredProposalParts('review_mixed'),
        { type: 'tool' },
        { type: 'step-finish' },
      ],
      scope.projectId,
    )).toBeNull();
    const escapedProposal = structuredProposalParts('review_escaped')[0].text.replaceAll('"', '\\"');
    expect(parseManagedWorkstreamStructuredProposal(
      [{ type: 'text', text: escapedProposal }],
      scope.projectId,
    )).toBeNull();
    expect(parseManagedWorkstreamStructuredProposal(
      [{ type: 'text', text: '```json\n{"schemaVersion":1}\n```' }],
      scope.projectId,
    )).toBeNull();
    expect(parseManagedWorkstreamStructuredProposal(
      [{ type: 'text', text: JSON.stringify({
        schemaVersion: 1, kind: 'workstream_proposal',
        criteria: [{ id: 'review_wrong_scope', status: 'pending' }],
        nextAction: { kind: 'review', scope: 'other-project' },
      }) }],
      scope.projectId,
    )).toBeNull();
  });

  it('captures authored chat text, links one real durable workstream, consumes one authority before the existing coordinator dispatch boundary, and never replays it', async () => {
    db = database();
    previous = setDb(db);
    const repository = new CoordinatorConversationsRepository(db, () => now);
    const workstreams = new AgentWorkstreamsRepository();
    const runCalls: unknown[][] = [];
    let statusCalls = 0;
    const root = {
      id: scope.sessionId,
      ownerUserId: scope.ownerUserId,
      projectId: scope.projectId,
      parentSessionId: null,
      isSystem: false,
      category: 'chat',
      sdkSessionId: 'sdk-root',
      profileId: 'readonly-profile',
      providerId: 'provider-a',
      modelId: 'model-a',
      modelMode: 'fixed' as const,
      permissionMode: 'default' as const,
      approvalBypassExplicit: false,
      // A reasoning preference is deliberately not a total-use authorization.
      thinkingBudget: 1234,
    };
    const profile = {
      id: 'readonly-profile', enabled: true, isAgent: true, locked: false,
      modelProvider: 'provider-a', modelId: 'model-a', revision: 9,
    };
    const coordinator = {
      runNextFromFiniteConversation: async (...args: unknown[]) => {
        runCalls.push(args);
        const id = args[2] as string;
        const row = workstreams.find(scope.ownerUserId, scope.projectId, id)!;
        return { workstream: { ...row, state: 'running' as const }, readiness: { available: false, reason: 'test', hostEpoch: null, engine: null }, jobs: [], budget: {
          authorizedTokens: 512, actualTokens: 0, acknowledgedEstimateTokens: 0, reservedTokens: 0,
          committedTokens: 0, remainingTokens: 512, overshoot: false, unknownJobIds: [], holdReason: null,
        } };
      },
      status: async (_actor: unknown, _project: unknown, id: unknown) => {
        statusCalls += 1;
        const row = workstreams.find(scope.ownerUserId, scope.projectId, id as string)!;
        return { workstream: row, readiness: { available: true, reason: null, hostEpoch: 'test', engine: null }, jobs: [], budget: {
          authorizedTokens: null, actualTokens: 0, acknowledgedEstimateTokens: 0, reservedTokens: 0,
          committedTokens: 0, remainingTokens: null, overshoot: false, unknownJobIds: [], holdReason: null,
        } };
      },
    };
    const service = new CoordinatorConversationService({
      repository,
      context: context(),
      workstreams,
      sessions: { findById: (id) => id === root.id ? root as never : null },
      configs: { getById: (id) => id === profile.id ? profile as never : null },
      coordinator: coordinator as never,
      jobs: {
        getNativeForWorkstream: () => null,
        coordinatorBudgetState: () => ({
          authorizedTokens: null, actualTokens: 0, acknowledgedEstimateTokens: 0, reservedTokens: 0,
          committedTokens: 0, remainingTokens: null, overshoot: false, unknownJobIds: [], holdReason: null,
        }),
      },
      ...authorizedProjectDependencies(),
      enabled: () => true,
      now: () => now,
    });

    const captured = await service.receiveMessage(auth, {
      sessionId: scope.sessionId,
      projectId: scope.projectId,
      expectedControlRevision: 1,
      commandKey: 'chat-goal-1',
      message: 'Build a review of current work without changing it.',
    });
    expect(captured).toMatchObject({
      kind: 'created',
      goal: { objective: 'Build a review of current work without changing it.', state: 'captured' },
    });
    if (captured.kind !== 'created') throw new Error('expected captured goal');

    expect(await service.preparePlan(auth, {
      sessionId: scope.sessionId,
      projectId: scope.projectId,
      expectedControlRevision: captured.conversation.controlRevision,
      goalId: captured.goal.id,
      admission: null,
    })).toMatchObject({ kind: 'planning_authority_required' });
    expect(workstreams.list(scope.ownerUserId, scope.projectId, 10)).toEqual([]);
    expect(runCalls).toHaveLength(0);
    expect(repository.get(scope)).toMatchObject({ kind: 'found', conversation: { continuations: [] } });

    const planned = await service.preparePlan(auth, {
      sessionId: scope.sessionId,
      projectId: scope.projectId,
      expectedControlRevision: captured.conversation.controlRevision,
      goalId: captured.goal.id,
      admission: admission('plan-chat-goal-1'),
    });
    expect(planned.kind).toBe('planned');
    expect(runCalls).toHaveLength(1);
    const [runAuthority, runProject, workstreamId, request] = runCalls[0] as [Record<string, unknown>, string, string, Record<string, unknown>];
    expect(runAuthority).toMatchObject({ kind: 'conversation_finite', ownerUserId: scope.ownerUserId });
    expect(runProject).toBe(scope.projectId);
    expect(request).toMatchObject({
      expectedRevision: 1,
      targetProfileId: profile.id,
      parentSessionId: root.id,
      softTokenBudgetAcknowledged: true,
      policy: { maxTurns: 1, maxWallTimeSeconds: 300, maxTokens: 512, queueDeadlineAt: null },
      references: [],
    });
    const persisted = repository.get(scope);
    expect(persisted).toMatchObject({
      kind: 'found',
      conversation: {
        goals: [{ id: captured.goal.id, state: 'linked', linkedWorkstreamId: workstreamId }],
        continuations: [{ consumedTurns: 1, status: 'consumed', totalTokenAuthorization: 512 }],
      },
    });
    expect(workstreams.find(scope.ownerUserId, scope.projectId, workstreamId)).toMatchObject({
      goal: captured.goal.objective,
      state: 'ready',
      checkpoint: { criteria: [{ id: 'conversation_goal_verification', status: 'pending' }] },
    });

    const replay = await service.preparePlan(auth, {
      sessionId: scope.sessionId,
      projectId: scope.projectId,
      expectedControlRevision: 5,
      goalId: captured.goal.id,
      admission: admission('plan-chat-goal-1'),
    });
    expect(replay.kind).toBe('planning_already_linked');
    expect(runCalls).toHaveLength(1);
    await service.status(auth, { sessionId: scope.sessionId, projectId: scope.projectId });
    expect(statusCalls).toBe(2);
    expect(runCalls).toHaveLength(1);
  });

  it('refuses a mismatched current root/profile selection before it creates a workstream or calls the coordinator', async () => {
    db = database();
    previous = setDb(db);
    const repository = new CoordinatorConversationsRepository(db, () => now);
    const workstreams = new AgentWorkstreamsRepository();
    let calls = 0;
    const service = new CoordinatorConversationService({
      repository,
      context: context(),
      workstreams,
      sessions: { findById: () => ({
        id: scope.sessionId, ownerUserId: scope.ownerUserId, projectId: scope.projectId,
        parentSessionId: null, isSystem: false, category: 'chat', sdkSessionId: 'sdk-root',
        profileId: 'profile-a', providerId: 'provider-a', modelId: 'model-a', modelMode: 'fixed',
        permissionMode: 'default', approvalBypassExplicit: false, thinkingBudget: 512,
      }) as never },
      configs: { getById: () => ({
        id: 'profile-a', enabled: true, isAgent: true, locked: false,
        modelProvider: 'provider-b', modelId: 'model-a', revision: 1,
      }) as never },
      coordinator: { runNextFromFiniteConversation: async () => { calls += 1; throw new Error('must not run'); }, status: async () => ({}) } as never,
      ...authorizedProjectDependencies(),
      enabled: () => true,
      now: () => now,
    });
    const captured = await service.receiveMessage(auth, {
      sessionId: scope.sessionId, projectId: scope.projectId, expectedControlRevision: 1,
      commandKey: 'chat-goal-2', message: 'Review profile binding.',
    });
    if (captured.kind !== 'created') throw new Error('expected captured goal');
    expect(await service.preparePlan(auth, {
      sessionId: scope.sessionId, projectId: scope.projectId,
      expectedControlRevision: 2, goalId: captured.goal.id,
      admission: admission('mismatch-profile'),
    })).toMatchObject({ kind: 'planning_authority_unavailable' });
    expect(workstreams.list(scope.ownerUserId, scope.projectId, 10)).toEqual([]);
    expect(calls).toBe(0);
  });

  it('preserves a pause/revision made while admission is awaiting status proof and sends no worker turn', async () => {
    db = database();
    previous = setDb(db);
    const repository = new CoordinatorConversationsRepository(db, () => now);
    const workstreams = new AgentWorkstreamsRepository();
    const root = {
      id: scope.sessionId, ownerUserId: scope.ownerUserId, projectId: scope.projectId,
      parentSessionId: null, isSystem: false, category: 'chat', sdkSessionId: 'sdk-root',
      profileId: 'profile-a', providerId: 'provider-a', modelId: 'model-a', modelMode: 'fixed',
      permissionMode: 'default' as const, approvalBypassExplicit: false,
    };
    const profile = { id: 'profile-a', enabled: true, isAgent: true, locked: false, modelProvider: 'provider-a', modelId: 'model-a', revision: 1 };
    let runCalls = 0;
    const service = new CoordinatorConversationService({
      repository, context: context(), workstreams,
      sessions: { findById: () => root as never }, configs: { getById: () => profile as never },
      coordinator: {
        status: async (_auth: unknown, _project: unknown, id: string) => {
          const before = workstreams.find(scope.ownerUserId, scope.projectId, id)!;
          expect(workstreams.pause(scope.ownerUserId, scope.projectId, id, before.revision)).toMatchObject({ state: 'paused' });
          return {
            workstream: before, readiness: { available: true, reason: null, hostEpoch: 'test', engine: null }, jobs: [], budget: {
              authorizedTokens: null, actualTokens: 0, acknowledgedEstimateTokens: 0, reservedTokens: 0,
              committedTokens: 0, remainingTokens: null, overshoot: false, unknownJobIds: [], holdReason: null,
            },
          };
        },
        runNextFromFiniteConversation: async () => { runCalls += 1; throw new Error('paused admission must not dispatch'); },
      } as never,
      jobs: {
        getNativeForWorkstream: () => null,
        coordinatorBudgetState: () => ({
          authorizedTokens: null, actualTokens: 0, acknowledgedEstimateTokens: 0, reservedTokens: 0,
          committedTokens: 0, remainingTokens: null, overshoot: false, unknownJobIds: [], holdReason: null,
        }),
      },
      ...authorizedProjectDependencies(),
      enabled: () => true, now: () => now,
    });
    const captured = await service.receiveMessage(auth, {
      sessionId: scope.sessionId, projectId: scope.projectId, expectedControlRevision: 1,
      commandKey: 'pause-during-admission', message: 'Review the paused work safely.',
    });
    if (captured.kind !== 'created') throw new Error('expected captured goal');
    expect(await service.preparePlan(auth, {
      sessionId: scope.sessionId, projectId: scope.projectId, expectedControlRevision: captured.conversation.controlRevision,
      goalId: captured.goal.id, admission: admission('pause-during-admission'),
    })).toMatchObject({ kind: 'planning_authority_unavailable' });
    const linked = repository.get(scope);
    expect(linked).toMatchObject({ kind: 'found', conversation: { continuations: [] } });
    const linkedId = linked.kind === 'found' ? linked.conversation.goals[0].linkedWorkstreamId : null;
    expect(workstreams.find(scope.ownerUserId, scope.projectId, linkedId!)).toMatchObject({ state: 'paused' });
    expect(runCalls).toBe(0);
  });

  it('uses the real coordinator bridge admission and fresh SDK edge after durable link/consumption rather than a planner port', async () => {
    db = database();
    previous = setDb(db);
    const repository = new CoordinatorConversationsRepository(db, () => now);
    const workstreams = new AgentWorkstreamsRepository();
    const root = {
      id: scope.sessionId, ownerUserId: scope.ownerUserId, projectId: scope.projectId,
      parentSessionId: null, sdkSessionId: 'sdk-root', cwd: '/safe/project',
      profileId: 'readonly-profile', opencodeAgentId: null, delegationDepth: 0,
      isSystem: false, category: 'chat', providerId: 'provider-a', modelId: 'model-a',
      modelMode: 'fixed', permissionMode: 'default', approvalBypassExplicit: false, thinkingBudget: 512,
    } as AgentSession;
    const profile = {
      id: 'readonly-profile', label: 'Bounded reader', enabled: true, isAgent: true,
      allowedMcpsJson: null, revision: 9, modelProvider: 'provider-a', modelId: 'model-a',
    } as AgentConfig;
    const real = actualCoordinator(db, workstreams, root, profile);
    const service = new CoordinatorConversationService({
      repository, context: context(), workstreams,
      sessions: { findById: real.sessions.findById },
      configs: { getById: real.configs.getById },
      coordinator: real.coordinator,
      jobs: real.jobs,
      ...authorizedProjectDependencies(),
      enabled: () => true, now: () => now,
    });
    const captured = await service.receiveMessage(auth, {
      sessionId: scope.sessionId, projectId: scope.projectId, expectedControlRevision: 1,
      commandKey: 'real-admission-goal', message: 'Review the current workstream state without changing it.',
    });
    if (captured.kind !== 'created') throw new Error('expected captured goal');
    const planned = await service.preparePlan(auth, {
      sessionId: scope.sessionId, projectId: scope.projectId,
      expectedControlRevision: captured.conversation.controlRevision, goalId: captured.goal.id,
      admission: admission('real-admission'),
    });
    expect(planned.kind).toBe('planned');
    expect(real.engine.createSession).toHaveBeenCalledTimes(1);
    expect(real.engine.promptAsync).toHaveBeenCalledTimes(1);
    const conversation = repository.get(scope);
    if (conversation.kind !== 'found') throw new Error('expected durable conversation');
    const linkedId = conversation.conversation.goals[0].linkedWorkstreamId;
    expect(linkedId).toBeTruthy();
    const jobs = real.jobs.listNativeForWorkstream({ localUserId: scope.ownerUserId, workstreamId: linkedId! });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      direction: 'rhythm_to_native', native_execution_kind: 'coordinator', state: 'running',
      parent_session_id: scope.sessionId,
    });
    expect(conversation.conversation.continuations[0]).toMatchObject({ status: 'consumed', consumedTurns: 1, totalTokenAuthorization: 512 });
    expect(JSON.stringify(jobs[0].native_metadata_json)).not.toContain('current workstream state');

    real.engine.listMessagesPage.mockResolvedValue({
      messages: [{
        info: {
          id: 'assistant-c2-terminal', role: 'assistant', parentID: 'sdk-user-c2-1',
          time: { completed: 1 }, providerID: 'provider-a', modelID: 'model-a', finish: 'stop',
          tokens: { input: 4_634, output: 37, reasoning: 71, cache: { read: 0, write: 0 }, total: 4_742 },
        },
        parts: structuredProposalParts('review_current_state'),
      }],
      nextCursor: null,
    } as never);
    await service.status(auth, { sessionId: scope.sessionId, projectId: scope.projectId });
    const reconciled = real.jobs.listNativeForWorkstream({ localUserId: scope.ownerUserId, workstreamId: linkedId! })[0];
    expect(reconciled).toMatchObject({ state: 'succeeded' });
    expect(JSON.parse(reconciled.native_usage_json!)).toMatchObject({ status: 'actual', totalTokens: 4_742, overshoot: true });
    expect(JSON.stringify(reconciled.native_result_json)).not.toContain('untrusted worker prose');
    expect(await service.preparePlan(auth, {
      sessionId: scope.sessionId, projectId: scope.projectId, expectedControlRevision: 5, goalId: captured.goal.id,
      admission: admission('real-admission'),
    })).toMatchObject({ kind: 'planning_already_linked' });
    expect(real.engine.promptAsync).toHaveBeenCalledTimes(1);
  });

  it('requires a fresh execute acknowledgement and gives the actual bridge only the server-derived owned-workspace ruleset', async () => {
    db = database();
    previous = setDb(db);
    const repository = new CoordinatorConversationsRepository(db, () => now);
    const workstreams = new AgentWorkstreamsRepository();
    const root = {
      id: scope.sessionId, ownerUserId: scope.ownerUserId, projectId: scope.projectId,
      parentSessionId: null, sdkSessionId: 'sdk-root', cwd: '/safe/project',
      profileId: 'readonly-profile', opencodeAgentId: null, delegationDepth: 0,
      isSystem: false, category: 'chat', providerId: 'provider-a', modelId: 'model-a', modelMode: 'fixed',
      permissionMode: 'default', approvalBypassExplicit: false,
    } as AgentSession;
    const profile = {
      id: 'readonly-profile', label: 'Bounded editor', enabled: true, isAgent: true,
      allowedMcpsJson: JSON.stringify({ rhythm: ['rhythm_search_memory'] }), revision: 9,
      modelProvider: 'provider-a', modelId: 'model-a',
    } as AgentConfig;
    const real = actualCoordinator(db, workstreams, root, profile);
    const serverRules: FiniteExecutionPermissionRule[] = [
      { permission: '*', pattern: '*', action: 'deny' as const },
      { permission: 'bash', pattern: '*', action: 'deny' as const },
      { permission: 'external_directory', pattern: '*', action: 'deny' as const },
      { permission: 'edit', pattern: 'safe/project/notes/*.md', action: 'ask' as const },
    ];
    const scopePreview = {
      schemaVersion: 1 as const,
      kind: 'scoped_workspace_execution' as const,
      projectId: scope.projectId,
      workspaceGeneration: 1,
      profileId: profile.id,
      profileRevision: profile.revision!,
      targetFingerprint: 'a'.repeat(64),
      scopeSignature: 'b'.repeat(64),
    };
    const resolvedScope: ResolvedFiniteExecutionScope = {
      preview: scopePreview,
      targetCwd: '/safe/project',
      permissionRules: serverRules,
      mcpRoleConfig: {
        role: 'profile-scoped',
        mcpServers: { rhythm: { allowedTools: ['rhythm_search_memory'] } },
        allowedToolsJson: JSON.stringify({ rhythm: ['rhythm_search_memory'] }),
      },
      skillAllowlist: ['review-skill'],
    };
    const resolveScope = vi.fn(async (): Promise<ResolvedFiniteExecutionScope> => resolvedScope);
    const service = new CoordinatorConversationService({
      repository, context: context(), workstreams, jobs: real.jobs,
      sessions: { findById: real.sessions.findById }, configs: { getById: real.configs.getById },
      coordinator: real.coordinator, executionScope: { resolve: resolveScope },
      ...authorizedProjectDependencies(), enabled: () => true, now: () => now,
    });
    const captured = await service.receiveMessage(auth, {
      sessionId: scope.sessionId, projectId: scope.projectId, expectedControlRevision: 1,
      commandKey: 'execute-owned-workspace-goal', message: 'Prepare the owned workspace notes for review.',
    });
    if (captured.kind !== 'created') throw new Error('expected captured goal');
    expect((await service.preparePlan(auth, {
      sessionId: scope.sessionId, projectId: scope.projectId,
      expectedControlRevision: captured.conversation.controlRevision, goalId: captured.goal.id,
      admission: admission('execute-owned-workspace', 'execute', 1_000, 1),
    })).kind).toBe('planned');
    expect(resolveScope).toHaveBeenCalled();
    expect(real.engine.createSession).toHaveBeenCalledTimes(1);
    const createArgs = real.engine.createSession.mock.calls[0] as unknown as unknown[];
    expect(createArgs[1]).toBe('/safe/project');
    expect(createArgs[2]).toMatchObject({ role: 'profile-scoped' });
    expect(createArgs[3]).toEqual(['review-skill']);
    expect(createArgs[8]).toBe(false);
    expect(createArgs[9]).toEqual(serverRules);
    expect(real.engine.promptAsync).toHaveBeenCalledTimes(1);
    expect(repository.get(scope)).toMatchObject({
      kind: 'found',
      conversation: { continuations: [{ purpose: 'execute', executionScope: scopePreview }] },
    });
  });

  it('uses one explicit outer total-token authority for two actual bridge turns, then holds the consumed budget rather than minting another grant', async () => {
    db = database();
    previous = setDb(db);
    const repository = new CoordinatorConversationsRepository(db, () => now);
    const workstreams = new AgentWorkstreamsRepository();
    const root = {
      id: scope.sessionId, ownerUserId: scope.ownerUserId, projectId: scope.projectId,
      parentSessionId: null, sdkSessionId: 'sdk-root', cwd: '/safe/project',
      profileId: 'readonly-profile', opencodeAgentId: null, delegationDepth: 0,
      isSystem: false, category: 'chat', providerId: 'provider-a', modelId: 'model-a', modelMode: 'fixed',
      permissionMode: 'default', approvalBypassExplicit: false,
    } as AgentSession;
    const profile = {
      id: 'readonly-profile', label: 'Bounded reader', enabled: true, isAgent: true,
      allowedMcpsJson: null, revision: 9, modelProvider: 'provider-a', modelId: 'model-a',
    } as AgentConfig;
    const real = actualCoordinator(db, workstreams, root, profile);
    const firstTerminal = {
      messages: [{ info: {
        id: 'assistant-terminal-1', role: 'assistant', parentID: 'sdk-user-c2-1', time: { completed: 1 },
        providerID: 'provider-a', modelID: 'model-a', finish: 'stop',
        tokens: { input: 3_900, output: 40, reasoning: 60, cache: { read: 0, write: 0 }, total: 4_000 },
      }, parts: structuredProposalParts('review_first_step') }], nextCursor: null,
    };
    const secondTerminal = {
      messages: [{ info: {
        id: 'assistant-terminal-2', role: 'assistant', parentID: 'sdk-user-c2-2', time: { completed: 1 },
        providerID: 'provider-a', modelID: 'model-a', finish: 'stop',
        tokens: { input: 6_850, output: 70, reasoning: 81, cache: { read: 0, write: 0 }, total: 7_001 },
      }, parts: structuredProposalParts('review_second_step') }], nextCursor: null,
    };
    real.engine.listMessagesPage.mockImplementation(async (...args: unknown[]) => {
      const sdkSessionId = args[0] as string;
      return (
      sdkSessionId === 'fresh-worker-sdk-1' ? firstTerminal :
        sdkSessionId === 'fresh-worker-sdk-2' ? secondTerminal : { messages: [], nextCursor: null }
      ) as never;
    });
    const service = new CoordinatorConversationService({
      repository, context: context(), workstreams,
      sessions: { findById: real.sessions.findById }, configs: { getById: real.configs.getById },
      coordinator: real.coordinator, jobs: real.jobs,
      ...authorizedProjectDependencies(), enabled: () => true, now: () => now,
    });
    const captured = await service.receiveMessage(auth, {
      sessionId: scope.sessionId, projectId: scope.projectId, expectedControlRevision: 1,
      commandKey: 'two-turn-goal', message: 'Decompose the current work into two bounded review steps.',
    });
    if (captured.kind !== 'created') throw new Error('expected captured goal');
    const initial = await service.preparePlan(auth, {
      sessionId: scope.sessionId, projectId: scope.projectId, expectedControlRevision: captured.conversation.controlRevision,
      goalId: captured.goal.id, admission: admission('two-turn-authorization', 'decompose', 10_000, 2),
    });
    expect(initial.kind).toBe('planned');
    await service.status(auth, { sessionId: scope.sessionId, projectId: scope.projectId });
    const afterFirst = repository.get(scope);
    if (afterFirst.kind !== 'found' || !afterFirst.conversation.continuations[0]) throw new Error('expected durable authority');
    expect(afterFirst.conversation.continuations[0]).toMatchObject({ maxTurns: 2, consumedTurns: 1, totalTokenAuthorization: 10_000 });

    const continued = await service.continuePlan(auth, {
      sessionId: scope.sessionId, projectId: scope.projectId,
      expectedControlRevision: afterFirst.conversation.controlRevision,
      goalId: captured.goal.id,
      authorizationId: afterFirst.conversation.continuations[0].authorizationId,
    });
    expect(continued.kind).toBe('planned');
    expect(real.engine.createSession).toHaveBeenCalledTimes(2);
    expect(real.engine.promptAsync).toHaveBeenCalledTimes(2);
    await service.status(auth, { sessionId: scope.sessionId, projectId: scope.projectId });

    const linkedId = afterFirst.conversation.goals.find((goal) => goal.id === captured.goal.id)?.linkedWorkstreamId;
    if (!linkedId) throw new Error('expected linked workstream');
    const bridgeJobs = real.jobs.listNativeForWorkstream({ localUserId: scope.ownerUserId, workstreamId: linkedId });
    expect(bridgeJobs).toHaveLength(2);
    expect(bridgeJobs.map((job) => JSON.parse(job.native_usage_json ?? '{}').totalTokens)).toEqual([4_000, 7_001]);
    const finalConversation = repository.get(scope);
    if (finalConversation.kind !== 'found' || !finalConversation.conversation.continuations[0]) throw new Error('expected final authority');
    expect(finalConversation.conversation.continuations[0]).toMatchObject({ maxTurns: 2, consumedTurns: 2, status: 'consumed' });
    expect(await service.continuePlan(auth, {
      sessionId: scope.sessionId, projectId: scope.projectId,
      expectedControlRevision: finalConversation.conversation.controlRevision,
      goalId: captured.goal.id,
      authorizationId: finalConversation.conversation.continuations[0].authorizationId,
    })).toMatchObject({ kind: 'planning_authority_conflict' });
    expect(real.engine.promptAsync).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['more permissive', 'default', false, 'bypassPermissions', true],
    ['more restrictive', 'bypassPermissions', true, 'plan', false],
  ] as const)(
    'holds a saved finite authority before the next ordinal when parent permission becomes %s',
    async (_direction, initialPermissionMode, initialApprovalBypassExplicit, changedPermissionMode, changedApprovalBypassExplicit) => {
      db = database();
      previous = setDb(db);
      const repository = new CoordinatorConversationsRepository(db, () => now);
      const workstreams = new AgentWorkstreamsRepository();
      const root = {
        id: scope.sessionId, ownerUserId: scope.ownerUserId, projectId: scope.projectId,
        parentSessionId: null, sdkSessionId: 'sdk-root', cwd: '/safe/project',
        profileId: 'readonly-profile', opencodeAgentId: null, delegationDepth: 0,
        isSystem: false, category: 'chat', providerId: 'provider-a', modelId: 'model-a', modelMode: 'fixed',
        permissionMode: initialPermissionMode, approvalBypassExplicit: initialApprovalBypassExplicit,
      } as AgentSession;
      // The staged repository's final CAS reads the same durable parent fields
      // that a normal AgentSessionsRepository mutation would update. Keep this
      // real SQLite fixture aligned with the injected current-session view.
      db.prepare(`UPDATE agent_sessions
        SET profile_id=?, permission_mode=?, approval_bypass_explicit=? WHERE id=?`).run(
        root.profileId,
        initialPermissionMode,
        initialApprovalBypassExplicit ? 1 : 0,
        root.id,
      );
      const profile = {
        id: 'readonly-profile', label: 'Bounded reader', enabled: true, isAgent: true,
        allowedMcpsJson: null, revision: 9, modelProvider: 'provider-a', modelId: 'model-a',
      } as AgentConfig;
      const real = actualCoordinator(db, workstreams, root, profile);
      real.engine.listMessagesPage.mockResolvedValue({
        messages: [{ info: {
          id: 'assistant-permission-terminal', role: 'assistant', parentID: 'sdk-user-c2-1', time: { completed: 1 },
          providerID: 'provider-a', modelID: 'model-a', finish: 'stop',
          tokens: { input: 3_900, output: 40, reasoning: 60, cache: { read: 0, write: 0 }, total: 4_000 },
        }, parts: structuredProposalParts('permission_drift_review') }],
        nextCursor: null,
      } as never);
      const service = new CoordinatorConversationService({
        repository, context: context(), workstreams, jobs: real.jobs,
        sessions: { findById: real.sessions.findById }, configs: { getById: real.configs.getById },
        coordinator: real.coordinator, ...authorizedProjectDependencies(), enabled: () => true, now: () => now,
      });
      const captured = await service.receiveMessage(auth, {
        sessionId: scope.sessionId, projectId: scope.projectId, expectedControlRevision: 1,
        commandKey: `permission-${initialPermissionMode}-goal`, message: 'Decompose this permission-bound review.',
      });
      if (captured.kind !== 'created') throw new Error('expected captured goal');
      expect((await service.preparePlan(auth, {
        sessionId: scope.sessionId, projectId: scope.projectId,
        expectedControlRevision: captured.conversation.controlRevision, goalId: captured.goal.id,
        admission: admission(`permission-${initialPermissionMode}-authority`, 'decompose', 10_000, 2),
      })).kind).toBe('planned');
      await service.status(auth, { sessionId: scope.sessionId, projectId: scope.projectId });
      const afterFirst = repository.get(scope);
      if (afterFirst.kind !== 'found') throw new Error('expected consumed first ordinal');
      const authority = afterFirst.conversation.continuations.find((candidate) => candidate.goalId === captured.goal.id);
      if (!authority) throw new Error('expected finite authority');
      expect(authority).toMatchObject({
        schemaVersion: 5,
        consumedTurns: 1,
        permissionAuthority: {
          parent: { permissionMode: initialPermissionMode, approvalBypassExplicit: initialApprovalBypassExplicit },
          worker: { parentSessionId: scope.sessionId, permissionMode: 'default', managedReadOnly: true },
        },
      });

      root.permissionMode = changedPermissionMode;
      root.approvalBypassExplicit = changedApprovalBypassExplicit;
      db.prepare(`UPDATE agent_sessions
        SET permission_mode=?, approval_bypass_explicit=? WHERE id=?`).run(
        changedPermissionMode,
        changedApprovalBypassExplicit ? 1 : 0,
        root.id,
      );
      expect(await service.continuePlan(auth, {
        sessionId: scope.sessionId, projectId: scope.projectId,
        expectedControlRevision: afterFirst.conversation.controlRevision,
        goalId: captured.goal.id, authorizationId: authority.authorizationId,
      })).toMatchObject({ kind: 'planning_authority_unavailable' });
      expect(real.engine.promptAsync).toHaveBeenCalledTimes(1);
      const held = repository.get(scope);
      expect(held).toMatchObject({
        kind: 'found',
        conversation: { continuations: [{ authorizationId: authority.authorizationId, consumedTurns: 1, status: 'consumed' }] },
      });

      // A new authenticated control is allowed to replace the invalidated,
      // already-settled grant. It is not a retry of ordinal two and cannot use
      // the old parent permission snapshot.
      if (held.kind !== 'found') throw new Error('expected held conversation');
      expect((await service.preparePlan(auth, {
        sessionId: scope.sessionId, projectId: scope.projectId,
        expectedControlRevision: held.conversation.controlRevision, goalId: captured.goal.id,
        admission: admission(`permission-${initialPermissionMode}-renewed`, 'continue', 10_000, 1),
      })).kind).toBe('planned');
      expect(real.engine.promptAsync).toHaveBeenCalledTimes(2);
      const renewed = repository.get(scope);
      expect(renewed).toMatchObject({
        kind: 'found',
        conversation: { continuations: [{ consumedTurns: 1, maxTurns: 1, permissionAuthority: {
          parent: { permissionMode: changedPermissionMode, approvalBypassExplicit: changedApprovalBypassExplicit },
        } }] },
      });
    },
  );

  it('automatically consumes only the next finite ordinal after a strict terminal receipt, even when a sibling idea advanced the chat control revision', async () => {
    db = database();
    previous = setDb(db);
    // Sol: provide the existing notification lookup's real filesystem/project seam.
    const notificationRoot = realpathSync(mkdtempSync(join(tmpdir(), 'sol-c3-terminal-')));
    db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY, cwd TEXT NOT NULL, archived_at TEXT)');
    db.prepare('INSERT INTO projects (id, cwd, archived_at) VALUES (?, ?, NULL)').run(scope.projectId, notificationRoot);
    const hintTransactions: boolean[] = [];
    const originalPublish = opencodeEventHub.publish.bind(opencodeEventHub);
    const published = vi.spyOn(opencodeEventHub, 'publish').mockImplementation((envelope) => {
      if ((envelope.payload as { type?: string }).type === COORDINATOR_CHANGED_EVENT) hintTransactions.push(db!.inTransaction);
      originalPublish(envelope);
    });

    const repository = new CoordinatorConversationsRepository(db, () => now);
    expect(repository.designatePrimaryOwnerRoot({
      ownerUserId: scope.ownerUserId,
      projectId: scope.projectId,
      sessionId: scope.sessionId,
    })).toMatchObject({ kind: 'found', conversation: { primaryOwnerRoot: true } });
    const workstreams = new AgentWorkstreamsRepository();
    const root = {
      id: scope.sessionId, ownerUserId: scope.ownerUserId, projectId: scope.projectId,
      parentSessionId: null, sdkSessionId: 'sdk-root', cwd: '/safe/project',
      profileId: 'readonly-profile', opencodeAgentId: null, delegationDepth: 0,
      isSystem: false, category: 'chat', providerId: 'provider-a', modelId: 'model-a', modelMode: 'fixed',
      permissionMode: 'default', approvalBypassExplicit: false,
    } as AgentSession;
    const profile = {
      id: 'readonly-profile', label: 'Bounded reader', enabled: true, isAgent: true,
      allowedMcpsJson: null, revision: 9, modelProvider: 'provider-a', modelId: 'model-a',
    } as AgentConfig;
    let service: CoordinatorConversationService;
    const real = actualCoordinator(db, workstreams, root, profile, {
      onCoordinatorTerminal: (input) => service.onCoordinatorTerminal(input),
    });
    real.engine.listMessagesPage.mockResolvedValue({
      messages: [{ info: {
        id: 'assistant-auto-terminal', role: 'assistant', parentID: 'sdk-user-c2-1', time: { completed: 1 },
        providerID: 'provider-a', modelID: 'model-a', finish: 'stop',
        tokens: { input: 640, output: 30, reasoning: 10, cache: { read: 0, write: 0 }, total: 680 },
      }, parts: nativeTerminalStructuredProposalParts('review_synthesis') }],
      nextCursor: null,
    } as never);
    service = new CoordinatorConversationService({
      repository, context: context(), workstreams, jobs: real.jobs,
      sessions: { findById: real.sessions.findById }, configs: { getById: real.configs.getById },
      coordinator: real.coordinator, ...authorizedProjectDependencies(), enabled: () => true, now: () => now,
    });
    const captured = await service.receiveMessage(auth, {
      sessionId: scope.sessionId, projectId: scope.projectId, expectedControlRevision: 1,
      commandKey: 'auto-first-goal', message: 'Decompose the current work into a bounded review and synthesis.',
    });
    if (captured.kind !== 'created') throw new Error('expected captured goal');
    expect((await service.preparePlan(auth, {
      sessionId: scope.sessionId, projectId: scope.projectId,
      expectedControlRevision: captured.conversation.controlRevision,
      goalId: captured.goal.id,
      admission: admission('auto-finite', 'decompose', 2_000, 2),
    })).kind).toBe('planned');
    const afterFirstAdmission = repository.get(scope);
    if (afterFirstAdmission.kind !== 'found') throw new Error('expected conversation');
    const sibling = await service.receiveMessage(auth, {
      sessionId: scope.sessionId, projectId: scope.projectId,
      expectedControlRevision: afterFirstAdmission.conversation.controlRevision,
      commandKey: 'auto-sibling-goal', message: 'I have another idea: Review the unrelated follow-up separately.',
    });
    expect(sibling).toMatchObject({ kind: 'created', goal: { state: 'captured' } });

    // No UI status/chat poll participates in advancement. The existing
    // scheduler-owned bounded sweep observes this exact ordinary finite child,
    // reconciles its strict terminal receipt, and the existing observer then
    // rechecks authority before it can reserve ordinal two.
    published.mockClear();
    hintTransactions.length = 0;
    await service.sweepFiniteConversationReconciliation();
    await vi.waitFor(() => expect(published.mock.calls.filter(([e]) => (e.payload as {type?: string}).type === COORDINATOR_CHANGED_EVENT)).toHaveLength(1));
    expect(hintTransactions).toEqual([false]);
    const terminalHint = published.mock.calls.find(([e]) => (e.payload as {type?: string}).type === COORDINATOR_CHANGED_EVENT)![0];
    expect(terminalHint).toMatchObject({ directory: notificationRoot, payload: { properties: { projectId: scope.projectId, localSessionId: scope.sessionId } } });
    expect(Object.keys((terminalHint.payload as {properties: object}).properties).sort()).toEqual(['conversationId','localSessionId','projectId']);

    await vi.waitFor(() => expect(real.engine.promptAsync).toHaveBeenCalledTimes(2));
    const afterTerminal = repository.get(scope);
    if (afterTerminal.kind !== 'found') throw new Error('expected updated conversation');
    const firstAuthority = afterTerminal.conversation.continuations.find((candidate) => candidate.goalId === captured.goal.id);
    expect(firstAuthority).toMatchObject({ maxTurns: 2, consumedTurns: 2, status: 'consumed' });
    expect(afterTerminal.conversation.goals).toHaveLength(2);
    expect(real.jobs.listNativeForWorkstream({
      localUserId: scope.ownerUserId,
      workstreamId: firstAuthority!.workstreamId,
    })).toHaveLength(2);
    const firstJob = real.jobs.listNativeForWorkstream({
      localUserId: scope.ownerUserId,
      workstreamId: firstAuthority!.workstreamId,
    })[0];
    expect(JSON.parse(firstJob.native_application_json!)).toMatchObject({
      reason: 'read_only_proposal_pending_authoritative_criterion_receipt',
      structuredProposal: { state: 'stored', criteriaCount: 1, nextAction: 'review' },
    });
    expect(workstreams.find(scope.ownerUserId, scope.projectId, firstAuthority!.workstreamId)?.checkpoint.criteria)
      .toEqual(expect.arrayContaining([
        { id: 'conversation_goal_verification', status: 'pending' },
        { id: 'review_synthesis', status: 'pending' },
      ]));

    await service.onCoordinatorTerminal({
      ownerUserId: scope.ownerUserId,
      projectId: scope.projectId,
      workstreamId: firstAuthority!.workstreamId,
      parentSessionId: scope.sessionId,
      jobId: real.jobs.listNativeForWorkstream({
        localUserId: scope.ownerUserId,
        workstreamId: firstAuthority!.workstreamId,
      })[0].id,
      state: 'succeeded',
      hostEpoch: 'c2-epoch',
    });
    expect(real.engine.promptAsync).toHaveBeenCalledTimes(2);
    expect(published.mock.calls.filter(([e]) => (e.payload as {type?: string}).type === COORDINATOR_CHANGED_EVENT)).toHaveLength(1);
    published.mockRestore();
  });

  it('keeps a malformed terminal proposal accounted but held, with no automatic second dispatch', async () => {
    db = database();
    previous = setDb(db);
    const repository = new CoordinatorConversationsRepository(db, () => now);
    const workstreams = new AgentWorkstreamsRepository();
    const root = {
      id: scope.sessionId, ownerUserId: scope.ownerUserId, projectId: scope.projectId,
      parentSessionId: null, sdkSessionId: 'sdk-root', cwd: '/safe/project',
      profileId: 'readonly-profile', opencodeAgentId: null, delegationDepth: 0,
      isSystem: false, category: 'chat', providerId: 'provider-a', modelId: 'model-a', modelMode: 'fixed',
      permissionMode: 'default', approvalBypassExplicit: false,
    } as AgentSession;
    const profile = {
      id: 'readonly-profile', label: 'Bounded reader', enabled: true, isAgent: true,
      allowedMcpsJson: null, revision: 9, modelProvider: 'provider-a', modelId: 'model-a',
    } as AgentConfig;
    let service: CoordinatorConversationService;
    const real = actualCoordinator(db, workstreams, root, profile, {
      onCoordinatorTerminal: (input) => service.onCoordinatorTerminal(input),
    });
    real.engine.listMessagesPage.mockResolvedValue({
      messages: [{
        info: {
          id: 'assistant-malformed-terminal', role: 'assistant', parentID: 'sdk-user-c2-1', time: { completed: 1 },
          providerID: 'provider-a', modelID: 'model-a', finish: 'stop',
          tokens: { input: 100, output: 10, reasoning: 1, cache: { read: 0, write: 0 }, total: 111 },
        },
        parts: [{ type: 'text', text: 'ordinary worker prose is not a structured plan' }],
      }],
      nextCursor: null,
    } as never);
    service = new CoordinatorConversationService({
      repository, context: context(), workstreams, jobs: real.jobs,
      sessions: { findById: real.sessions.findById }, configs: { getById: real.configs.getById },
      coordinator: real.coordinator, ...authorizedProjectDependencies(), enabled: () => true, now: () => now,
    });
    const captured = await service.receiveMessage(auth, {
      sessionId: scope.sessionId, projectId: scope.projectId, expectedControlRevision: 1,
      commandKey: 'malformed-proposal-goal', message: 'Decompose this safely without applying completion.',
    });
    if (captured.kind !== 'created') throw new Error('expected captured goal');
    expect((await service.preparePlan(auth, {
      sessionId: scope.sessionId, projectId: scope.projectId,
      expectedControlRevision: captured.conversation.controlRevision, goalId: captured.goal.id,
      admission: admission('malformed-proposal-admission', 'decompose', 2_000, 2),
    })).kind).toBe('planned');
    await service.status(auth, { sessionId: scope.sessionId, projectId: scope.projectId });
    await Promise.resolve();
    await Promise.resolve();
    expect(real.engine.promptAsync).toHaveBeenCalledTimes(1);
    const stored = repository.get(scope);
    if (stored.kind !== 'found') throw new Error('expected conversation');
    const authority = stored.conversation.continuations.find((candidate) => candidate.goalId === captured.goal.id);
    if (!authority) throw new Error('expected authority');
    const job = real.jobs.listNativeForWorkstream({
      localUserId: scope.ownerUserId,
      workstreamId: authority.workstreamId,
    })[0];
    expect(job).toMatchObject({ state: 'succeeded' });
    expect(JSON.parse(job.native_application_json!)).toMatchObject({
      reason: 'structured_proposal_unavailable',
      structuredProposal: { state: 'unavailable' },
    });
    expect(workstreams.find(scope.ownerUserId, scope.projectId, authority.workstreamId)?.checkpoint.criteria)
      .toEqual([{ id: 'conversation_goal_verification', status: 'pending' }]);
  });
});
