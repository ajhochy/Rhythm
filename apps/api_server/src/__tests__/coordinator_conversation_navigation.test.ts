import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import type { AuthContext } from '../middleware/auth_middleware';
import { installCoordinatorConversationSchema } from '../database/coordinator_conversation_schema';
import { CoordinatorConversationsRepository } from '../repositories/coordinator_conversations_repository';
import { coordinatorConversationResponseStatus } from '../controllers/coordinator_conversations_controller';
import {
  CoordinatorConversationService,
  type CoordinatorConversationServiceDependencies,
} from '../services/coordinator_conversation_service';
import { CoordinatorConversationModelStatusService } from '../services/coordinator_conversation_model_status_service';

const now = new Date('2026-10-05T12:00:00.000Z');
const auth = { sessionToken: 'desktop-auth', user: { id: 7 } } as AuthContext;

function database(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE agent_sessions (
    id TEXT PRIMARY KEY,
    owner_user_id INTEGER,
    project_id TEXT,
    parent_session_id TEXT,
    is_system INTEGER NOT NULL DEFAULT 0,
    category TEXT NOT NULL DEFAULT 'chat',
    archived_at TEXT,
    sdk_session_id TEXT,
    profile_id TEXT,
    cwd TEXT,
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
  const insert = db.prepare(`INSERT INTO agent_sessions
    (id, owner_user_id, project_id, parent_session_id, is_system, category, archived_at, sdk_session_id, profile_id, cwd, permission_mode, approval_bypass_explicit, created_at, updated_at)
    VALUES (?, ?, ?, NULL, 0, 'chat', NULL, ?, 'profile-a', ?, 'default', 0, ?, ?)`);
  insert.run('chat-a', 7, 'project-a', 'sdk-a', '/safe/project-a', now.toISOString(), now.toISOString());
  insert.run('chat-b', 7, 'project-b', 'sdk-b', '/safe/project-b', now.toISOString(), now.toISOString());
  insert.run('chat-foreign', 8, 'project-foreign', 'sdk-foreign', '/safe/project-foreign', now.toISOString(), now.toISOString());
  db.exec(`CREATE TABLE agent_turn_dispatches (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    sdk_session_id TEXT,
    sdk_user_message_id TEXT,
    origin TEXT NOT NULL,
    requested_source TEXT NOT NULL,
    route_authed INTEGER,
    reason_code TEXT,
    outcome TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE agent_async_delegations (
    id TEXT PRIMARY KEY,
    parent_session_id TEXT NOT NULL,
    child_session_id TEXT NOT NULL,
    target_agent_config_id TEXT NOT NULL,
    status TEXT NOT NULL
  )`);
  installCoordinatorConversationSchema(db);
  return db;
}

function service(
  repository: CoordinatorConversationsRepository,
  db: Database.Database,
  allowed: Map<number, Set<string>>,
  extras: Partial<Pick<CoordinatorConversationServiceDependencies, 'foreground' | 'messages' | 'context' | 'projects' | 'projectSetup' | 'configs' | 'codingWorkflow'>> = {},
) {
  const sessions = new Map<string, Record<string, unknown>>([
    ['chat-a', { id: 'chat-a', ownerUserId: 7, projectId: 'project-a', parentSessionId: null, isSystem: false, category: 'chat', sdkSessionId: 'sdk-a', profileId: 'profile-a', providerId: 'provider-a', modelId: 'model-a', modelMode: 'fixed', permissionMode: 'default', approvalBypassExplicit: false, cwd: '/safe/project-a' }],
    ['chat-b', { id: 'chat-b', ownerUserId: 7, projectId: 'project-b', parentSessionId: null, isSystem: false, category: 'chat', sdkSessionId: 'sdk-b', profileId: 'profile-a', providerId: 'provider-a', modelId: 'model-a', modelMode: 'fixed', permissionMode: 'default', approvalBypassExplicit: false, cwd: '/safe/project-b' }],
    ['chat-foreign', { id: 'chat-foreign', ownerUserId: 8, projectId: 'project-foreign', parentSessionId: null, isSystem: false, category: 'chat', sdkSessionId: 'sdk-foreign', profileId: 'profile-a', providerId: 'provider-a', modelId: 'model-a', modelMode: 'fixed', permissionMode: 'default', approvalBypassExplicit: false, cwd: '/safe/project-foreign' }],
  ]);
  let sequence = 0;
  return new CoordinatorConversationService({
    repository,
    context: extras.context ?? {} as never,
    sessions: {
      findById: (id) => {
        const known = sessions.get(id);
        if (known) return known as never;
        const row = db.prepare(`SELECT id, owner_user_id, project_id, profile_id, permission_mode, approval_bypass_explicit
          FROM agent_sessions WHERE id=?`).get(id) as {
            id: string; owner_user_id: number; project_id: string; profile_id: string | null;
            permission_mode: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'; approval_bypass_explicit: number;
          } | undefined;
        if (!row || !row.profile_id) return null;
        const restored = {
          id: row.id,
          ownerUserId: row.owner_user_id,
          projectId: row.project_id,
          parentSessionId: null,
          isSystem: false,
          category: 'chat',
          sdkSessionId: null,
          cwd: `/safe/${row.project_id}`,
          profileId: row.profile_id,
          providerId: null,
          modelId: null,
          modelMode: 'auto',
          permissionMode: row.permission_mode,
          approvalBypassExplicit: row.approval_bypass_explicit === 1,
        };
        sessions.set(id, restored);
        return restored as never;
      },
      insert: (input) => {
        sequence += 1;
        const id = `rhythm-coordinator-root-${sequence}`;
        const session = {
          id,
          ownerUserId: input.ownerUserId,
          projectId: input.projectId,
          parentSessionId: null,
          isSystem: false,
          category: 'chat',
          sdkSessionId: null,
          cwd: `/safe/${input.projectId}`,
          profileId: input.profileId,
          providerId: null,
          modelId: null,
          modelMode: input.modelMode,
          permissionMode: 'plan',
          approvalBypassExplicit: false,
        };
        sessions.set(id, session);
        db.prepare(`INSERT INTO agent_sessions
          (id, owner_user_id, project_id, parent_session_id, is_system, category, archived_at, sdk_session_id, profile_id, cwd, permission_mode, approval_bypass_explicit, created_at, updated_at)
          VALUES (?, ?, ?, NULL, 0, 'chat', NULL, NULL, ?, ?, 'plan', 0, ?, ?)`)
          .run(id, input.ownerUserId, input.projectId, input.profileId, `/safe/${input.projectId}`, now.toISOString(), now.toISOString());
        return session as never;
      },
    },
    configs: extras.configs ?? {
      getById: (id: string) => id === 'profile-a' ? {
        id, enabled: true, isAgent: true, locked: false, modelProvider: 'provider-a', modelId: 'model-a', revision: 3,
      } as never : null,
      listEnabled: () => [{
        id: 'profile-a', enabled: true, isAgent: true, locked: false, modelProvider: 'provider-a', modelId: 'model-a', revision: 3,
      }] as never,
    },
    projects: extras.projects ?? {
      findById: (id: string) => ['project-a', 'project-b', 'project-foreign'].includes(id)
        ? { id, cwd: `/safe/${id}`, archivedAt: null }
        : null,
    } as never,
    projectAccess: {
      canAccess: ({ actor, projectId }) => allowed.get(actor.user.id)?.has(projectId) === true,
    },
    projectSetup: extras.projectSetup,
    foreground: extras.foreground,
    codingWorkflow: extras.codingWorkflow,
    messages: extras.messages,
    enabled: () => true,
    now: () => now,
  });
}

function qualifiedContext(overrides: Record<string, unknown> = {}) {
  return {
    timeZone: 'America/Los_Angeles',
    asOf: now.toISOString(),
    today: '2026-10-05',
    yesterday: '2026-10-04',
    availability: {
      tasks: { state: 'available', reason: null },
      schedules: { state: 'available', reason: null },
      rhythms: { state: 'available', reason: null },
      workstreams: { state: 'available', reason: null },
      receipts: { state: 'available', reason: null },
      manualActivity: { state: 'available', reason: null },
    },
    coverage: {
      tasks: { strategy: 'complete', totalItems: 1, selectedItems: 1, maxItems: 25 },
      schedules: { strategy: 'complete', totalItems: 0, selectedItems: 0, maxItems: 25 },
      rhythms: { strategy: 'complete', totalItems: 0, selectedItems: 0, maxItems: 25 },
      workstreams: { strategy: 'complete', totalItems: 0, selectedItems: 0, maxItems: 25 },
      receipts: { strategy: 'complete', totalItems: 0, selectedItems: 0, maxItems: 25 },
      manualActivity: { strategy: 'complete', totalItems: 1, selectedItems: 1, maxItems: 25 },
    },
    todayTasks: [{ id: 'task-a', title: 'Prepare weekly update', status: 'open', dueDate: '2026-10-05', scheduledDate: null, priority: 1 }],
    waitingForReply: [],
    doneWithUnknownCompletionDate: [],
    scheduledPriorities: [],
    activeRhythms: [],
    activeWorkstreams: [],
    executionSucceededGoalUnverified: [],
    staleExecutions: [],
    verifiedYesterday: [],
    usageHolds: [],
    receipts: [],
    // Deliberately opaque: a model-status response must never copy this data.
    manualActivity: [{ sourceId: 'opaque', expectedVersion: 'v1', observedAt: now.toISOString(), state: 'active', namespace: 'dayflow', sourceInstance: 'source', sourceRevision: 'revision', sourceHash: 'hash', canonicalId: 'canonical', canonicalVersion: 'version', consentGeneration: 'consent', configurationGeneration: 'config', expiresAt: '2026-10-05T13:00:00.000Z', eligibility: 'active' }],
    manualActivityDependency: {
      schemaVersion: 1, namespace: 'dayflow', sourceInstance: 'source', consentGeneration: 'consent',
      configurationGeneration: 'config', sourceVersion: 'v1', sourceRevision: 'revision', sourceHash: 'hash',
      expiresAt: '2026-10-05T13:00:00.000Z', observedAt: now.toISOString(), references: [],
    },
    modelContext: { kind: 'ready', bytes: 512 },
    ...overrides,
  } as never;
}

describe('dedicated primary Rhythm conversation resolution', () => {
  let db: Database.Database | null = null;
  afterEach(() => { db?.close(); db = null; });

  it('keeps the closed setup profile-choice response actionable at the authenticated API boundary', () => {
    expect(coordinatorConversationResponseStatus('setup_profile_choice_required')).toBe(200);
  });

  it('creates one inert dedicated owner root, never adopts an older general chat, survives reopen, and ignores later project hints', () => {
    db = database();
    const allowed = new Map([[7, new Set(['project-a', 'project-b'])]]);
    const firstRepository = new CoordinatorConversationsRepository(db, () => now);
    const firstService = service(firstRepository, db, allowed);
    const first = firstService.resolvePrimary(auth, { projectId: 'project-a' });
    expect(first).toMatchObject({ kind: 'resolved', created: true, sessionId: 'rhythm-coordinator-root-1', projectId: 'project-a', conversation: { primaryOwnerRoot: true, controlRevision: 1 } });
    const laterHint = firstService.resolvePrimary(auth, { projectId: 'project-b' });
    expect(laterHint).toMatchObject({ kind: 'resolved', created: false, sessionId: 'rhythm-coordinator-root-1', projectId: 'project-a' });

    const afterRestart = service(new CoordinatorConversationsRepository(db, () => now), db, allowed).resolvePrimary(auth, {});
    expect(afterRestart).toMatchObject({ kind: 'resolved', created: false, sessionId: 'rhythm-coordinator-root-1', projectId: 'project-a' });
    expect(db.prepare('SELECT sdk_session_id, coordinator_conversation_json FROM agent_sessions WHERE id=?').get('chat-a'))
      .toMatchObject({ sdk_session_id: 'sdk-a', coordinator_conversation_json: null });
    expect(db.prepare('SELECT sdk_session_id, coordinator_conversation_json FROM agent_sessions WHERE id=?').get('rhythm-coordinator-root-1'))
      .toMatchObject({ sdk_session_id: null });
  });

  it('uses the durable transaction as the root idempotency boundary and fails closed when current project access is revoked', () => {
    db = database();
    const allowed = new Map([[7, new Set(['project-a'])], [8, new Set(['project-foreign'])]]);
    const first = service(new CoordinatorConversationsRepository(db, () => now), db, allowed);
    const second = service(new CoordinatorConversationsRepository(db, () => now), db, allowed);
    expect(first.resolvePrimary(auth, { projectId: 'project-a' })).toMatchObject({ kind: 'resolved', created: true, sessionId: 'rhythm-coordinator-root-1' });
    expect(second.resolvePrimary(auth, { projectId: 'project-a' })).toMatchObject({ kind: 'resolved', created: false, sessionId: 'rhythm-coordinator-root-1' });
    expect(db.prepare("SELECT COUNT(*) AS count FROM agent_sessions WHERE id LIKE 'rhythm-coordinator-root-%'").get())
      .toMatchObject({ count: 1 });

    const foreign = first.resolvePrimary({ sessionToken: 'foreign-auth', user: { id: 8 } } as AuthContext, { projectId: 'project-foreign' });
    expect(foreign).toMatchObject({ kind: 'resolved', sessionId: 'rhythm-coordinator-root-2', projectId: 'project-foreign' });
    expect(JSON.stringify(foreign)).not.toContain('project-a');

    allowed.set(7, new Set());
    expect(first.resolvePrimary(auth, {})).toEqual({ kind: 'setup_unavailable' });
  });

  it('creates a fresh authenticated setup root without adopting a catalog project or prior general chat', async () => {
    db = database();
    const fresh = {
      id: 'fresh-owned-project', cwd: '/server-owned/coordinator-workspace', archivedAt: null,
      coordinatorOwnerUserId: 7,
      coordinatorSetupKey: 'fresh-setup-command',
      coordinatorSetupProvenance: 'c2_fresh_owned_workspace_v1',
      coordinatorWorkspaceGeneration: 1,
      coordinatorProfileId: 'profile-a',
    } as never;
    const allowed = new Map([[7, new Set(['fresh-owned-project'])]]);
    const repository = new CoordinatorConversationsRepository(db, () => now);
    let setupCalls = 0;
    const coordinator = service(repository, db, allowed, {
      projects: { findById: (id: string) => id === 'fresh-owned-project' ? fresh : null } as never,
      projectSetup: {
        create: async ({ actor, commandKey, profileId }) => {
          setupCalls += 1;
          expect({ owner: actor.user.id, commandKey, profileId }).toEqual({
            owner: 7, commandKey: 'fresh-setup-command', profileId: 'profile-a',
          });
          return { kind: 'ready', project: fresh, created: setupCalls === 1 };
        },
      },
    });
    expect(await coordinator.setupPrimary(auth, { commandKey: 'fresh-setup-command', profileId: 'profile-a' }))
      .toMatchObject({
        kind: 'setup_created', projectId: 'fresh-owned-project', profileId: 'profile-a', workspaceGeneration: 1,
        conversation: { primaryOwnerRoot: true },
      });
    expect(await coordinator.setupPrimary(auth, { commandKey: 'fresh-setup-command', profileId: 'profile-a' }))
      .toMatchObject({ kind: 'setup_replay', projectId: 'fresh-owned-project' });
    expect(setupCalls).toBe(2);
    expect(db.prepare("SELECT COUNT(*) AS count FROM agent_sessions WHERE project_id='fresh-owned-project'").get())
      .toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM agent_sessions WHERE id IN ('chat-a','chat-b')").get())
      .toEqual({ count: 2 });
    expect(db.prepare("SELECT sdk_session_id FROM agent_sessions WHERE project_id='fresh-owned-project'").get())
      .toEqual({ sdk_session_id: null });
  });

  it('returns only current opaque profile choices when fresh setup is ambiguous, without creating a root or SDK work', async () => {
    db = database();
    const allowed = new Map([[7, new Set<string>()]]);
    const repository = new CoordinatorConversationsRepository(db, () => now);
    let setupCalls = 0;
    const coordinator = service(repository, db, allowed, {
      configs: {
        getById: () => null,
        listEnabled: () => [
          { id: 'profile-a', label: 'Profile A', enabled: true, isAgent: true, locked: false, modelProvider: 'provider-a', modelId: 'model-a' },
          { id: 'profile-b', label: 'Profile B', enabled: true, isAgent: true, locked: false, modelProvider: 'provider-b', modelId: 'model-b' },
        ] as never,
      },
      projectSetup: {
        create: async ({ actor, commandKey, profileId }) => {
          setupCalls += 1;
          expect({ owner: actor.user.id, commandKey, profileId }).toEqual({
            owner: 7, commandKey: 'ambiguous-stock-command', profileId: undefined,
          });
          return {
            kind: 'choice_required',
            profileChoices: [
              { id: 'profile-a', label: 'Profile A' },
              { id: 'profile-b', label: 'Profile B' },
            ],
          };
        },
      },
    });

    expect(await coordinator.setupPrimary(auth, { commandKey: 'ambiguous-stock-command' })).toEqual({
      kind: 'setup_profile_choice_required',
      profileChoices: [
        { id: 'profile-a', label: 'Profile A' },
        { id: 'profile-b', label: 'Profile B' },
      ],
    });
    expect(setupCalls).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS count FROM agent_sessions WHERE id LIKE 'rhythm-coordinator-root-%'").get())
      .toEqual({ count: 0 });
  });

  it('withholds a profile-choice response whose current eligibility changed while setup awaited', async () => {
    db = database();
    const allowed = new Map([[7, new Set<string>()]]);
    const repository = new CoordinatorConversationsRepository(db, () => now);
    const profileA = { id: 'profile-a', label: 'Profile A', enabled: true, isAgent: true, locked: false, modelProvider: 'provider-a', modelId: 'model-a' };
    const profileB = { id: 'profile-b', label: 'Profile B', enabled: true, isAgent: true, locked: false, modelProvider: 'provider-b', modelId: 'model-b' };
    let profiles = [profileA, profileB];
    const coordinator = service(repository, db, allowed, {
      configs: {
        getById: () => null,
        listEnabled: () => profiles as never,
      },
      projectSetup: {
        create: async () => {
          profiles = [profileA];
          return {
            kind: 'choice_required',
            profileChoices: [
              { id: 'profile-a', label: 'Profile A' },
              { id: 'profile-b', label: 'Profile B' },
            ],
          };
        },
      },
    });

    expect(await coordinator.setupPrimary(auth, { commandKey: 'changed-profile-choice' }))
      .toEqual({ kind: 'setup_unavailable' });
    expect(db.prepare("SELECT COUNT(*) AS count FROM agent_sessions WHERE id LIKE 'rhythm-coordinator-root-%'").get())
      .toEqual({ count: 0 });
  });

  it('reserves an ordinary foreground turn once, never turns its acknowledgement into a transcript bubble, and withholds an ambiguous send', async () => {
    db = database();
    const allowed = new Map([[7, new Set(['project-a'])]]);
    const repository = new CoordinatorConversationsRepository(db, () => now);
    expect(repository.designatePrimaryOwnerRoot({ ownerUserId: 7, projectId: 'project-a', sessionId: 'chat-a' }))
      .toMatchObject({ kind: 'found', conversation: { primaryOwnerRoot: true, controlRevision: 1 } });
    let calls = 0;
    const coordinator = service(repository, db, allowed, {
      foreground: {
        send: async (input) => {
          calls += 1;
          expect(input).toMatchObject({
            localSessionId: 'chat-a', sdkSessionId: 'sdk-a', projectId: 'project-a',
            profileId: 'profile-a', providerId: 'provider-a', modelId: 'model-a',
            commandKey: 'ordinary-one', controlRevision: 1,
          });
          expect(input.reservationCurrent()).toBe(true);
          return { kind: 'unavailable' };
        },
      },
    });
    const input = {
      sessionId: 'chat-a', projectId: 'project-a', expectedControlRevision: 1,
      commandKey: 'ordinary-one', message: 'Please explain why this dashboard is stale.',
    };
    expect(await coordinator.receiveMessage(auth, input)).toMatchObject({ kind: 'foreground_uncertain' });
    expect(await coordinator.receiveMessage(auth, input)).toMatchObject({ kind: 'foreground_uncertain' });
    expect(calls).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS count FROM agent_session_messages WHERE session_id=?').get('chat-a'))
      .toEqual({ count: 0 });
  });

  it('captures a conservative natural action as the exact durable goal while preserving the ordinary SDK foreground turn', async () => {
    db = database();
    const allowed = new Map([[7, new Set(['project-a'])]]);
    const repository = new CoordinatorConversationsRepository(db, () => now);
    expect(repository.designatePrimaryOwnerRoot({ ownerUserId: 7, projectId: 'project-a', sessionId: 'chat-a' }))
      .toMatchObject({ kind: 'found', conversation: { controlRevision: 1 } });
    let calls = 0;
    const coordinator = service(repository, db, allowed, {
      context: { assemble: async () => qualifiedContext() } as never,
      foreground: {
        send: async (input) => {
          calls += 1;
          expect(input.system).toContain('Rhythm Secretary');
          expect(input.system).not.toContain('opaque');
          expect(await input.contextCurrent()).toBe(true);
          return { kind: 'accepted' };
        },
      },
    });
    const input = {
      sessionId: 'chat-a', projectId: 'project-a', expectedControlRevision: 1,
      commandKey: 'plain-language-goal', message: 'Could you draft a weekly update from the current work?',
    };
    await expect(coordinator.receiveMessage(auth, input)).resolves.toMatchObject({
      kind: 'foreground_accepted',
      conversation: {
        controlRevision: 2,
        goals: [expect.objectContaining({ objective: input.message, state: 'captured' })],
      },
    });
    // The native stream remains the one transcript owner; goal capture adds
    // no synthetic local user/assistant event for the ordinary foreground turn.
    expect(db.prepare('SELECT COUNT(*) AS count FROM agent_session_messages WHERE session_id=?').get('chat-a'))
      .toEqual({ count: 0 });
    await expect(coordinator.receiveMessage(auth, input)).resolves.toMatchObject({ kind: 'foreground_accepted' });
    expect(calls).toBe(1);
  });

  it('starts one captured goal through the existing Coding Workflow, replays no child, and admits only its exact completion callback for status', async () => {
    db = database();
    const allowed = new Map([[7, new Set(['project-a'])]]);
    const repository = new CoordinatorConversationsRepository(db, () => now);
    expect(repository.designatePrimaryOwnerRoot({ ownerUserId: 7, projectId: 'project-a', sessionId: 'chat-a' }))
      .toMatchObject({ kind: 'found', conversation: { primaryOwnerRoot: true, controlRevision: 1 } });
    let foregroundCalls = 0;
    let codingCalls = 0;
    const coordinator = service(repository, db, allowed, {
      context: { assemble: async () => qualifiedContext() } as never,
      foreground: { send: async () => { foregroundCalls += 1; return { kind: 'accepted' }; } },
      codingWorkflow: {
        dispatch: async (input) => {
          codingCalls += 1;
          expect(input).toEqual(expect.objectContaining({
            parentSessionId: 'chat-a', parentSdkSessionId: 'sdk-a', parentProfileId: 'profile-a',
            objective: 'Could you draft a weekly update from the current work?',
          }));
          return {
            delegationId: 'delegation-1',
            childSessionId: 'child-1',
            targetAgentConfigId: 'workflow-orchestrator' as const,
          };
        },
      },
    });
    await expect(coordinator.receiveMessage(auth, {
      sessionId: 'chat-a', projectId: 'project-a', expectedControlRevision: 1,
      commandKey: 'captured-workflow-goal', message: 'Could you draft a weekly update from the current work?',
    })).resolves.toMatchObject({ kind: 'foreground_accepted' });
    expect(foregroundCalls).toBe(1);
    const captured = repository.get({ ownerUserId: 7, projectId: 'project-a', sessionId: 'chat-a' });
    expect(captured).toMatchObject({ kind: 'found' });
    if (captured.kind !== 'found') throw new Error('expected captured coordinator goal');
    const goalId = captured.conversation.goals[0]?.id;
    expect(goalId).toEqual(expect.any(String));
    const action = {
      sessionId: 'chat-a', projectId: 'project-a', sdkSessionId: 'sdk-a', goalId: goalId!,
      commandKey: 'goal-action-1', bindingCurrent: async () => true,
    };
    await expect(coordinator.startCodingWorkflow(auth, action)).resolves.toMatchObject({
      kind: 'delegation_started', goalId,
    });
    // Exact command replay returns the durable child link and cannot create a
    // second Coding Workflow child after the native boundary was crossed.
    await expect(coordinator.startCodingWorkflow(auth, action)).resolves.toMatchObject({
      kind: 'delegation_started', goalId,
    });
    expect(codingCalls).toBe(1);
    expect(repository.get({ ownerUserId: 7, projectId: 'project-a', sessionId: 'chat-a' })).toMatchObject({
      kind: 'found', conversation: { commandDedupe: expect.arrayContaining([expect.objectContaining({
        key: 'goal-action-1', kind: 'delegate_goal', goalId, state: 'dispatched',
        delegationId: 'delegation-1', childSessionId: 'child-1', targetAgentConfigId: 'workflow-orchestrator',
      })]) },
    });

    db.prepare(`INSERT INTO agent_async_delegations
      (id, parent_session_id, child_session_id, target_agent_config_id, status)
      VALUES ('delegation-1', 'chat-a', 'child-1', 'workflow-orchestrator', 'waking')`).run();
    // This is the exact marker the existing completion service may attach to
    // its native parent wake. A generic wake cannot mint it just by sharing
    // the root SDK session.
    expect(repository.coordinatorDelegationCallbackReason({
      parentSessionId: 'chat-a',
      parentSdkSessionId: 'sdk-a',
      delegationId: 'delegation-1',
      childSessionId: 'child-1',
      targetAgentConfigId: 'workflow-orchestrator',
    })).toBe('c2_goal_callback:delegation-1');
    db.prepare(`INSERT INTO agent_turn_dispatches
      (id, session_id, sdk_session_id, sdk_user_message_id, origin, requested_source, route_authed, reason_code, outcome)
      VALUES ('callback-1', 'chat-a', 'sdk-a', 'native-completion-1', 'delegation_completion', 'agent_config', 1, 'c2_goal_callback:delegation-1', 'accepted')`).run();

    const callbackStatus = new CoordinatorConversationModelStatusService({
      conversations: coordinator,
      records: repository,
      engine: {
        getCurrentTrustedMcpToolCall: async () => ({
          sdkSessionId: 'sdk-a', assistantId: 'assistant-callback', toolCallId: 'tool-callback', agentName: 'Secretary',
          userMessageId: 'native-completion-1', partId: 'part-callback', toolKey: 'rhythm_get_coordinator_status',
          serverName: 'rhythm', toolName: 'rhythm_get_coordinator_status',
        }),
      },
      verify: async () => ({
        context: { sdkSessionId: 'sdk-a', turnId: 'assistant-callback', toolCallId: 'tool-callback', agentName: 'Secretary' },
        arguments: {},
      }),
    });
    await expect(callbackStatus.status(auth, { trustedCall: { ignored: true } })).resolves.toMatchObject({ status: 'available' });

    // Completion callbacks can review the existing result but cannot recursively
    // start another goal merely because they share the same SDK session.
    const callbackAction = new CoordinatorConversationModelStatusService({
      conversations: coordinator,
      records: repository,
      engine: {
        getCurrentTrustedMcpToolCall: async () => ({
          sdkSessionId: 'sdk-a', assistantId: 'assistant-callback', toolCallId: 'tool-callback', agentName: 'Secretary',
          userMessageId: 'native-completion-1', partId: 'part-callback', toolKey: 'rhythm_start_coordinator_goal',
          serverName: 'rhythm', toolName: 'rhythm_start_coordinator_goal',
        }),
      },
      verify: async () => ({
        context: { sdkSessionId: 'sdk-a', turnId: 'assistant-callback', toolCallId: 'tool-callback', agentName: 'Secretary' },
        arguments: { goalId },
      }),
    });
    await expect(callbackAction.startGoal(auth, { trustedCall: { ignored: true } })).resolves.toMatchObject({ status: 'unavailable' });
    expect(codingCalls).toBe(1);

    // A stale/terminal async record is not a current callback authority.
    db.prepare("UPDATE agent_async_delegations SET status='completed' WHERE id='delegation-1'").run();
    await expect(callbackStatus.status(auth, { trustedCall: { ignored: true } })).resolves.toEqual({
      schemaVersion: 1, status: 'unavailable', text: '',
    });
  });

  it('withholds qualified coordinator context when its Dayflow dependency changes during foreground preparation', async () => {
    db = database();
    const allowed = new Map([[7, new Set(['project-a'])]]);
    const repository = new CoordinatorConversationsRepository(db, () => now);
    expect(repository.designatePrimaryOwnerRoot({ ownerUserId: 7, projectId: 'project-a', sessionId: 'chat-a' }))
      .toMatchObject({ kind: 'found' });
    let sourceRevision = 'revision-a';
    const coordinator = service(repository, db, allowed, {
      context: {
        assemble: async () => qualifiedContext({
          manualActivityDependency: {
            schemaVersion: 1,
            namespace: 'dayflow',
            sourceInstance: 'source',
            consentGeneration: 'consent',
            configurationGeneration: 'config',
            sourceVersion: 'v1',
            sourceRevision,
            sourceHash: 'hash',
            expiresAt: '2026-10-05T13:00:00.000Z',
            observedAt: now.toISOString(),
            references: [],
          },
        }),
      } as never,
      foreground: {
        send: async (input) => {
          expect(await input.contextCurrent()).toBe(true);
          sourceRevision = 'revision-b';
          expect(await input.contextCurrent()).toBe(false);
          return { kind: 'unavailable' };
        },
      },
    });
    await expect(coordinator.receiveMessage(auth, {
      sessionId: 'chat-a', projectId: 'project-a', expectedControlRevision: 1,
      commandKey: 'dayflow-generation-drift', message: 'Please draft the current update.',
    })).resolves.toMatchObject({ kind: 'foreground_uncertain' });
  });

  it('keeps questions as ordinary foreground chat rather than creating a coordinator goal', async () => {
    db = database();
    const allowed = new Map([[7, new Set(['project-a'])]]);
    const repository = new CoordinatorConversationsRepository(db, () => now);
    expect(repository.designatePrimaryOwnerRoot({ ownerUserId: 7, projectId: 'project-a', sessionId: 'chat-a' }))
      .toMatchObject({ kind: 'found' });
    let calls = 0;
    const coordinator = service(repository, db, allowed, {
      foreground: { send: async () => { calls += 1; return { kind: 'accepted' }; } },
    });
    await expect(coordinator.receiveMessage(auth, {
      sessionId: 'chat-a', projectId: 'project-a', expectedControlRevision: 1,
      commandKey: 'ordinary-question', message: 'Please explain why this dashboard is stale?',
    })).resolves.toMatchObject({ kind: 'foreground_accepted', conversation: { goals: [] } });
    expect(calls).toBe(1);
  });

  it('serves signed current coordinator status only for the exact accepted C2 foreground native user message', async () => {
    db = database();
    const allowed = new Map([[7, new Set(['project-a'])]]);
    const repository = new CoordinatorConversationsRepository(db, () => now);
    expect(repository.designatePrimaryOwnerRoot({ ownerUserId: 7, projectId: 'project-a', sessionId: 'chat-a' }))
      .toMatchObject({ kind: 'found' });
    db.prepare(`INSERT INTO agent_turn_dispatches
      (id, session_id, sdk_session_id, sdk_user_message_id, origin, requested_source, route_authed, reason_code, outcome)
      VALUES ('dispatch-a', 'chat-a', 'sdk-a', 'native-user-a', 'prompt_api', 'session', 1, 'c2_foreground', 'accepted')`).run();
    const coordinator = service(repository, db, allowed, {
      context: { assemble: async () => qualifiedContext() } as never,
    });
    const verified = {
      context: { sdkSessionId: 'sdk-a', turnId: 'assistant-a', toolCallId: 'tool-a', agentName: 'Secretary' },
      arguments: {},
    };
    const modelStatus = new CoordinatorConversationModelStatusService({
      conversations: coordinator,
      records: repository,
      engine: {
        getCurrentTrustedMcpToolCall: async () => ({
          sdkSessionId: 'sdk-a', assistantId: 'assistant-a', toolCallId: 'tool-a', agentName: 'Secretary',
          userMessageId: 'native-user-a', partId: 'part-a', toolKey: 'rhythm_get_coordinator_status',
          serverName: 'rhythm', toolName: 'rhythm_get_coordinator_status',
        }),
      },
      verify: async () => verified,
    });
    await expect(modelStatus.status(auth, { trustedCall: { ignored: true } })).resolves.toMatchObject({
      schemaVersion: 1,
      status: 'available',
    });
    const response = await modelStatus.status(auth, { trustedCall: { ignored: true } });
    // The first signed nonce verification would normally be single-use; this
    // injected verifier models a distinct valid invocation for output checks.
    expect(response.status).toBe('available');
    if (response.status === 'available') {
      expect(response.text).toContain('Prepare weekly update');
      expect(response.text).not.toContain('opaque');
      expect(response.text).toContain('not_composed_in_coordinator_context');
    }
    db.prepare("UPDATE agent_turn_dispatches SET sdk_user_message_id='different-native-user' WHERE id='dispatch-a'").run();
    await expect(modelStatus.status(auth, { trustedCall: { ignored: true } })).resolves.toEqual({
      schemaVersion: 1, status: 'unavailable', text: '',
    });
    allowed.set(7, new Set());
    await expect(modelStatus.status(auth, { trustedCall: { ignored: true } })).resolves.toEqual({
      schemaVersion: 1, status: 'unavailable', text: '',
    });
  });

  it('withholds a signed status response when project access is revoked during the final active-tool reread', async () => {
    db = database();
    const allowed = new Map([[7, new Set(['project-a'])]]);
    const repository = new CoordinatorConversationsRepository(db, () => now);
    expect(repository.designatePrimaryOwnerRoot({ ownerUserId: 7, projectId: 'project-a', sessionId: 'chat-a' }))
      .toMatchObject({ kind: 'found' });
    db.prepare(`INSERT INTO agent_turn_dispatches
      (id, session_id, sdk_session_id, sdk_user_message_id, origin, requested_source, route_authed, reason_code, outcome)
      VALUES ('dispatch-race', 'chat-a', 'sdk-a', 'native-user-a', 'prompt_api', 'session', 1, 'c2_foreground', 'accepted')`).run();
    let activeReads = 0;
    const modelStatus = new CoordinatorConversationModelStatusService({
      conversations: service(repository, db, allowed, { context: { assemble: async () => qualifiedContext() } as never }),
      records: repository,
      engine: {
        getCurrentTrustedMcpToolCall: async () => {
          activeReads += 1;
          if (activeReads === 2) allowed.set(7, new Set());
          return {
            sdkSessionId: 'sdk-a', assistantId: 'assistant-a', toolCallId: 'tool-a', agentName: 'Secretary',
            userMessageId: 'native-user-a', partId: 'part-a', toolKey: 'rhythm_get_coordinator_status',
            serverName: 'rhythm', toolName: 'rhythm_get_coordinator_status',
          };
        },
      },
      verify: async () => ({
        context: { sdkSessionId: 'sdk-a', turnId: 'assistant-a', toolCallId: 'tool-a', agentName: 'Secretary' },
        arguments: {},
      }),
    });
    await expect(modelStatus.status(auth, { trustedCall: { ignored: true } })).resolves.toEqual({
      schemaVersion: 1, status: 'unavailable', text: '',
    });
  });

  it('withholds a reserved foreground command when current project authority is revoked during adapter preparation', async () => {
    db = database();
    const allowed = new Map([[7, new Set(['project-a'])]]);
    const repository = new CoordinatorConversationsRepository(db, () => now);
    expect(repository.designatePrimaryOwnerRoot({ ownerUserId: 7, projectId: 'project-a', sessionId: 'chat-a' }))
      .toMatchObject({ kind: 'found', conversation: { primaryOwnerRoot: true, controlRevision: 1 } });
    let calls = 0;
    const coordinator = service(repository, db, allowed, {
      foreground: {
        send: async (input) => {
          calls += 1;
          expect(input.reservationCurrent()).toBe(true);
          allowed.set(7, new Set());
          expect(input.reservationCurrent()).toBe(false);
          return { kind: 'unavailable' };
        },
      },
    });
    const request = {
      sessionId: 'chat-a', projectId: 'project-a', expectedControlRevision: 1,
      commandKey: 'ordinary-revoked', message: 'Please hold this foreground turn.',
    };
    await expect(coordinator.receiveMessage(auth, request)).resolves.toMatchObject({ kind: 'foreground_uncertain' });
    // A caller that has lost project access gets only the generic route hold;
    // it cannot learn or replay the retained command state.
    await expect(coordinator.receiveMessage(auth, request)).resolves.toMatchObject({ kind: 'not_found' });
    expect(calls).toBe(1);
    expect(repository.get({ ownerUserId: 7, sessionId: 'chat-a', projectId: 'project-a' }))
      .toMatchObject({ kind: 'found', conversation: { commandDedupe: [expect.objectContaining({
        key: 'ordinary-revoked', kind: 'foreground', state: 'uncertain',
      })] } });
  });

  it('returns only the existing local canonical history page after current owner/project authorization', () => {
    db = database();
    const allowed = new Map([[7, new Set(['project-a'])]]);
    const repository = new CoordinatorConversationsRepository(db, () => now);
    expect(repository.designatePrimaryOwnerRoot({ ownerUserId: 7, projectId: 'project-a', sessionId: 'chat-a' }))
      .toMatchObject({ kind: 'found', conversation: { primaryOwnerRoot: true } });
    let reads = 0;
    const coordinator = service(repository, db, allowed, {
      messages: {
        listBySessionStructuredPage: (sessionId, limit, beforeId) => {
          reads += 1;
          expect({ sessionId, limit, beforeId }).toEqual({ sessionId: 'chat-a', limit: 20, beforeId: undefined });
          return {
            messages: [{ id: 41, role: 'assistant', text: 'persisted only' }] as never,
            nextCursor: null,
            hasMore: false,
          };
        },
      },
    });
    expect(coordinator.history(auth, { sessionId: 'chat-a', projectId: 'project-a', limit: 20, beforeId: undefined }))
      .toMatchObject({ kind: 'history', messages: [{ id: 41, text: 'persisted only' }], nextCursor: null, hasMore: false });
    expect(reads).toBe(1);
    allowed.set(7, new Set());
    expect(coordinator.history(auth, { sessionId: 'chat-a', projectId: 'project-a', limit: 20, beforeId: undefined }))
      .toEqual({ kind: 'history_unavailable' });
    expect(reads).toBe(1);
  });

  it('withholds every scoped CRUD/context path after current project revocation or archive, without appending a goal', async () => {
    db = database();
    const allowed = new Map([[7, new Set(['project-a'])]]);
    const repository = new CoordinatorConversationsRepository(db, () => now);
    expect(repository.designatePrimaryOwnerRoot({ ownerUserId: 7, projectId: 'project-a', sessionId: 'chat-a' }))
      .toMatchObject({ kind: 'found' });
    const coordinator = service(repository, db, allowed);
    const request = { sessionId: 'chat-a', projectId: 'project-a' };
    expect(coordinator.open(auth, request)).toMatchObject({ kind: 'replay' });
    allowed.set(7, new Set());
    expect(coordinator.open(auth, request)).toEqual({ kind: 'not_found' });
    expect(await coordinator.status(auth, request)).toEqual({ kind: 'not_found' });
    expect(await coordinator.receiveMessage(auth, {
      ...request, expectedControlRevision: 1, commandKey: 'revoked-message', message: 'Add a workstream: must not persist',
    })).toEqual({ kind: 'not_found' });
    expect(coordinator.addGoal(auth, {
      ...request, expectedControlRevision: 1, commandKey: 'revoked-goal', objective: 'must not persist',
    })).toEqual({ kind: 'not_found' });
    expect(repository.get({ ownerUserId: 7, ...request })).toMatchObject({
      kind: 'found', conversation: { goals: [] },
    });
  });

  it('rechecks project authority after context assembly before exposing any status projection', async () => {
    db = database();
    const allowed = new Map([[7, new Set(['project-a'])]]);
    const repository = new CoordinatorConversationsRepository(db, () => now);
    expect(repository.designatePrimaryOwnerRoot({ ownerUserId: 7, projectId: 'project-a', sessionId: 'chat-a' }))
      .toMatchObject({ kind: 'found' });
    const coordinator = service(repository, db, allowed, {
      context: {
        assemble: async () => {
          allowed.set(7, new Set());
          return {} as never;
        },
      } as never,
    });
    expect(await coordinator.status(auth, { sessionId: 'chat-a', projectId: 'project-a' }))
      .toEqual({ kind: 'not_found' });
  });

  it('treats an archived known project as non-disclosing for open, status, message, and goals', async () => {
    db = database();
    const allowed = new Map([[7, new Set(['project-a'])]]);
    const repository = new CoordinatorConversationsRepository(db, () => now);
    expect(repository.designatePrimaryOwnerRoot({ ownerUserId: 7, projectId: 'project-a', sessionId: 'chat-a' }))
      .toMatchObject({ kind: 'found' });
    let archived = false;
    const coordinator = service(repository, db, allowed, {
      projects: {
        findById: (id: string) => id === 'project-a'
          ? { id, cwd: '/safe/project-a', archivedAt: archived ? now.toISOString() : null }
          : null,
      } as never,
    });
    archived = true;
    const request = { sessionId: 'chat-a', projectId: 'project-a' };
    expect(coordinator.open(auth, request)).toEqual({ kind: 'not_found' });
    expect(await coordinator.status(auth, request)).toEqual({ kind: 'not_found' });
    expect(await coordinator.receiveMessage(auth, {
      ...request, expectedControlRevision: 1, commandKey: 'archived-message', message: 'Add a workstream: archive must hold',
    })).toEqual({ kind: 'not_found' });
    expect(coordinator.addGoal(auth, {
      ...request, expectedControlRevision: 1, commandKey: 'archived-goal', objective: 'archive must hold',
    })).toEqual({ kind: 'not_found' });
    expect(repository.get({ ownerUserId: 7, ...request })).toMatchObject({ kind: 'found', conversation: { goals: [] } });
  });
});

// Sol verification only in isolated frozen reconstruction; no owner source edits.
import { createTrustedMcpTestSigner } from './helpers/trusted_mcp_test_proof';
import { clearTrustedMcpVerifier, pinTrustedMcpPublicKey } from '../security/trusted_mcp_call';

it('SOL core: actual signed goal boundary dispatches exact durable objective once and blocks tampering and unbound native turns', async () => {
  const db = database();
  const allowed = new Map([[7, new Set(['project-a'])]]);
  const repository = new CoordinatorConversationsRepository(db, () => now);
  expect(repository.designatePrimaryOwnerRoot({ownerUserId:7,projectId:'project-a',sessionId:'chat-a'})).toMatchObject({kind:'found'});
  let dispatches = 0;
  const objective = 'Could you draft a weekly update from the current work?';
  const coordinator = service(repository, db, allowed, {
    context: {assemble:async()=>qualifiedContext()} as never,
    foreground: {send:async()=>({kind:'accepted'})},
    codingWorkflow: {dispatch:async(input)=>{
      dispatches++;
      expect(input.objective).toBe(objective);
      expect(input.parentSessionId).toBe('chat-a');
      expect(input.parentSdkSessionId).toBe('sdk-a');
      return {delegationId:'sol-child-delegation',childSessionId:'sol-child-session',targetAgentConfigId:'workflow-orchestrator' as const};
    }},
  });
  await expect(coordinator.receiveMessage(auth,{sessionId:'chat-a',projectId:'project-a',expectedControlRevision:1,commandKey:'sol-capture',message:objective})).resolves.toMatchObject({kind:'foreground_accepted'});
  const captured=repository.get({ownerUserId:7,projectId:'project-a',sessionId:'chat-a'});
  if(captured.kind!=='found')throw new Error('missing goal');
  const goalId=captured.conversation.goals[0].id;
  db.prepare(`INSERT INTO agent_turn_dispatches (id,session_id,sdk_session_id,sdk_user_message_id,origin,requested_source,route_authed,reason_code,outcome) VALUES ('sol-foreground','chat-a','sdk-a','sol-native-user','prompt_api','session',1,'c2_foreground','accepted')`).run();
  const identity={sdkSessionId:'sdk-a',turnId:'sol-assistant',toolCallId:'sol-tool',agentName:'Secretary'};
  let nativeUser='sol-native-user';
  const model=new CoordinatorConversationModelStatusService({conversations:coordinator,records:repository,engine:{getCurrentTrustedMcpToolCall:async()=>({...identity,assistantId:identity.turnId,userMessageId:nativeUser,partId:'sol-part',toolKey:'rhythm_start_coordinator_goal',serverName:'rhythm',toolName:'rhythm_start_coordinator_goal'})}});
  const signer=createTrustedMcpTestSigner();
  pinTrustedMcpPublicKey(signer.publicDocument);
  try{
    const tampered=signer.signCall(identity,'rhythm_start_coordinator_goal',{goalId});
    tampered.arguments.goalId='different-goal';
    await expect(model.startGoal(auth,{trustedCall:tampered})).resolves.toMatchObject({status:'unavailable'});
    expect(dispatches).toBe(0);
    const first=signer.signCall(identity,'rhythm_start_coordinator_goal',{goalId});
    await expect(model.startGoal(auth,{trustedCall:first})).resolves.toMatchObject({status:'started'});
    expect(dispatches).toBe(1);
    await expect(model.startGoal(auth,{trustedCall:first})).resolves.toMatchObject({status:'unavailable'});
    const distinctProof=signer.signCall(identity,'rhythm_start_coordinator_goal',{goalId});
    await expect(model.startGoal(auth,{trustedCall:distinctProof})).resolves.toMatchObject({status:'started'});
    expect(dispatches).toBe(1);
    expect(repository.get({ownerUserId:7,projectId:'project-a',sessionId:'chat-a'})).toMatchObject({kind:'found',conversation:{commandDedupe:expect.arrayContaining([expect.objectContaining({kind:'delegate_goal',goalId,state:'dispatched',delegationId:'sol-child-delegation',childSessionId:'sol-child-session'})])}});
    nativeUser='sol-unbound-user';
    await expect(model.startGoal(auth,{trustedCall:signer.signCall(identity,'rhythm_start_coordinator_goal',{goalId})})).resolves.toMatchObject({status:'unavailable'});
    expect(dispatches).toBe(1);
  }finally{clearTrustedMcpVerifier();db.close();}
});
