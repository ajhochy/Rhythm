/**
 * G2 first adapter: admission contract/acknowledgement, strict receipt parser,
 * strict (non-defaulting) native reads, typed-context refusals, and the existing
 * conversation service's fail-closed answer for a workflow admission lacking its check.
 */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthContext } from '../middleware/auth_middleware';
import { getDb, setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { installAgentWorkstreamsSchema } from '../database/agent_workstreams_schema';
import { installCoordinatorConversationSchema } from '../database/coordinator_conversation_schema';
import {
  CODING_WORKFLOW_DISPATCH_REASON,
  parseCodingWorkflowDispatchReceipt,
  parseCoordinatorConversationPreparePlan,
} from '../contracts/coordinator_conversation_contract';
import { AgentWorkstreamsRepository } from '../repositories/agent_workstreams_repository';
import { CoordinatorConversationsRepository } from '../repositories/coordinator_conversations_repository';
import { CoordinatorConversationContextAssembler } from '../services/coordinator_conversation_context';
import { CoordinatorConversationService } from '../services/coordinator_conversation_service';
import { OpencodeClientService, type CodingWorkflowPromptDispatchContext } from '../services/opencode_client_service';

const admissionBase = {
  commandKey: 'plan-1', totalTokenAuthorization: 512, maxTurns: 2, maxWallTimeSeconds: 300, expiresInSeconds: 300,
  acknowledgesSoftTotalTokenAuthorization: true,
};
const plan = (admission: unknown) => ({
  sessionId: 'chat-a', projectId: 'project-a', expectedControlRevision: 1, goalId: 'goal-1', admission,
});

describe('admission contract: fixed Coding Workflow purpose and explicit acknowledgement', () => {
  it('requires the exact coverage acknowledgement for workflow and rejects borrowed flags', () => {
    expect(parseCoordinatorConversationPreparePlan(plan({
      ...admissionBase, purpose: 'workflow', acknowledgesCodingWorkflowCoverage: true,
    }))).toMatchObject({ admission: { purpose: 'workflow', acknowledgesCodingWorkflowCoverage: true } });
    for (const bad of [
      { ...admissionBase, purpose: 'workflow' },
      { ...admissionBase, purpose: 'workflow', acknowledgesCodingWorkflowCoverage: false },
      { ...admissionBase, purpose: 'workflow', acknowledgesCodingWorkflowCoverage: true, acknowledgesScopedWorkspaceExecution: true },
      { ...admissionBase, purpose: 'workflow', acknowledgesCodingWorkflowCoverage: true, extra: 1 },
      { ...admissionBase, purpose: 'workflow', acknowledgesScopedWorkspaceExecution: true },
    ]) expect(() => parseCoordinatorConversationPreparePlan(plan(bad))).toThrow();
  });

  it('keeps decompose, continue and scoped execute exactly as they were', () => {
    for (const purpose of ['decompose', 'continue'] as const) {
      expect(parseCoordinatorConversationPreparePlan(plan({ ...admissionBase, purpose }))).toMatchObject({ admission: { purpose } });
      expect(() => parseCoordinatorConversationPreparePlan(plan({ ...admissionBase, purpose, acknowledgesCodingWorkflowCoverage: true }))).toThrow();
    }
    expect(parseCoordinatorConversationPreparePlan(plan({
      ...admissionBase, purpose: 'execute', acknowledgesScopedWorkspaceExecution: true,
    }))).toMatchObject({ admission: { purpose: 'execute', acknowledgesScopedWorkspaceExecution: true } });
    expect(() => parseCoordinatorConversationPreparePlan(plan({ ...admissionBase, purpose: 'execute' }))).toThrow();
    expect(() => parseCoordinatorConversationPreparePlan(plan({ ...admissionBase, purpose: 'unknown' }))).toThrow();
  });
});

// The former absence pin ("no issuance path for workflow yet") is superseded by
// the positive schema-6 admission in coding_workflow_admission.test.ts. What
// remains true here: a workflow admission WITHOUT the selected-reference check
// is never issued and funds nothing.
describe('the conversation service refuses workflow issuance without a selected check', () => {
  const now = new Date('2026-10-05T12:00:00.000Z');
  const scope = { ownerUserId: 7, projectId: 'project-a', sessionId: 'chat-a' };
  const auth = { sessionToken: 'test-auth', user: { id: scope.ownerUserId } } as AuthContext;
  let db: Database.Database;
  let previous: Database.Database | null;
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`CREATE TABLE agent_sessions (
      id TEXT PRIMARY KEY, owner_user_id INTEGER, project_id TEXT, parent_session_id TEXT,
      is_system INTEGER NOT NULL DEFAULT 0, category TEXT NOT NULL DEFAULT 'chat', profile_id TEXT, sdk_session_id TEXT,
      archived_at TEXT, permission_mode TEXT NOT NULL DEFAULT 'default', approval_bypass_explicit INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    db.exec(`CREATE TABLE agent_session_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
      role TEXT NOT NULL, raw_text TEXT NOT NULL, stripped_text TEXT NOT NULL)`);
    db.prepare(`INSERT INTO agent_sessions (id, owner_user_id, project_id, parent_session_id, is_system, category, profile_id,
      sdk_session_id, permission_mode, approval_bypass_explicit, created_at, updated_at)
      VALUES (?, ?, ?, NULL, 0, 'chat', 'readonly-profile', 'sdk-root', 'default', 0, ?, ?)`)
      .run(scope.sessionId, scope.ownerUserId, scope.projectId, now.toISOString(), now.toISOString());
    installCoordinatorConversationSchema(db);
    installAgentWorkstreamsSchema(db);
    previous = setDb(db);
  });
  afterEach(() => { setDb(previous); db.close(); });

  it('answers planning_authority_unavailable, creates no workstream and funds no worker', async () => {
    const available = <T>(items: T[]) => ({
      availability: 'available' as const, reason: null, complete: true as const, authoritative: true as const,
      observedAt: now.toISOString(), sourceVersion: 'v1', items,
    });
    const root = {
      id: scope.sessionId, ownerUserId: scope.ownerUserId, projectId: scope.projectId, parentSessionId: null,
      isSystem: false, category: 'chat', sdkSessionId: 'sdk-root', profileId: 'readonly-profile', providerId: 'provider-a',
      modelId: 'model-a', modelMode: 'fixed' as const, permissionMode: 'default' as const, approvalBypassExplicit: false,
      thinkingBudget: 1234,
    };
    const profile = { id: 'readonly-profile', enabled: true, isAgent: true, locked: false, modelProvider: 'provider-a', modelId: 'model-a', revision: 9 };
    const runNext = vi.fn();
    const repository = new CoordinatorConversationsRepository(db, () => now);
    const workstreams = new AgentWorkstreamsRepository();
    const service = new CoordinatorConversationService({
      repository,
      context: new CoordinatorConversationContextAssembler({
        tasks: { read: async () => available([]) }, schedules: { read: async () => available([]) },
        rhythms: { read: async () => available([]) }, workstreams: { read: async () => available([]) },
        receipts: { read: async () => available([]) },
      }),
      workstreams,
      sessions: { findById: (id: string) => id === root.id ? root as never : null },
      configs: { getById: (id: string) => id === profile.id ? profile as never : null },
      coordinator: { runNextFromFiniteConversation: runNext } as never,
      jobs: { getNativeForWorkstream: () => null, coordinatorBudgetState: () => ({}) as never },
      projects: { findById: (id: string) => id === scope.projectId ? { id, cwd: '/safe/project', archivedAt: null } : null } as never,
      projectAccess: {
        canAccess: ({ actor, projectId }: { actor: AuthContext; projectId: string }) => actor.user.id === scope.ownerUserId && projectId === scope.projectId,
        canOwnerAccess: ({ ownerUserId, projectId }: { ownerUserId: number; projectId: string }) => ownerUserId === scope.ownerUserId && projectId === scope.projectId,
      },
      enabled: () => true,
      now: () => now,
    });
    const captured = await service.receiveMessage(auth, {
      sessionId: scope.sessionId, projectId: scope.projectId, expectedControlRevision: 1,
      commandKey: 'chat-goal-1', message: 'Build a review of current work without changing it.',
    });
    if (captured.kind !== 'created') throw new Error('expected a captured goal');

    const result = await service.preparePlan(auth, {
      sessionId: scope.sessionId, projectId: scope.projectId, expectedControlRevision: captured.conversation.controlRevision,
      goalId: captured.goal.id,
      admission: { ...admissionBase, purpose: 'workflow', acknowledgesCodingWorkflowCoverage: true } as never,
    });
    expect(result.kind).toBe('planning_authority_unavailable');
    expect(workstreams.list(scope.ownerUserId, scope.projectId, 10)).toEqual([]);
    expect(runNext).not.toHaveBeenCalled();
    expect(repository.get(scope)).toMatchObject({ kind: 'found', conversation: { continuations: [] } });
  });
});

describe('typed receipt parser', () => {
  const receipt = () => ({
    schemaVersion: 1, adapter: 'coding_workflow_v1',
    authorization: { authorizationId: 'auth-1', ordinal: 1, workstreamId: 'ws-1', goalId: 'goal-1' },
    owner: { ownerUserId: 7, projectId: 'project-a', rootSessionId: 'chat-a', rootSdkSessionId: 'sdk-root' },
    delegation: { delegationId: 'dg-1', managerSessionId: 'child-1', managerSdkSessionId: 'sdk-child', nativeParentSdkSessionId: 'sdk-root' },
    dispatch: { dispatchId: 'dispatch-1', sdkUserMessageId: 'msg_anchor', delivery: 'accepted' },
    engine: { version: '1.0.0', pid: 12, bootId: 'boot-1' },
  });
  it('round-trips an exact receipt and rejects any extra, missing, mistyped or unbound field', () => {
    expect(parseCodingWorkflowDispatchReceipt(receipt())).toEqual(receipt());
    const mutations: Array<(r: Record<string, any>) => void> = [
      (r) => { r.extra = 1; }, (r) => { r.schemaVersion = 2; }, (r) => { r.adapter = 'other'; },
      (r) => { delete r.engine; }, (r) => { r.authorization.ordinal = 9; }, (r) => { r.authorization.ordinal = 0; },
      (r) => { r.owner.ownerUserId = 0; }, (r) => { r.owner.projectId = ''; },
      (r) => { r.delegation.nativeParentSdkSessionId = 'sdk-other'; },
      (r) => { r.delegation.managerSdkSessionId = 'sdk-root'; },
      (r) => { r.dispatch.delivery = 'failed'; }, (r) => { r.dispatch.sdkUserMessageId = 'has space'; },
      (r) => { r.dispatch.extra = 1; }, (r) => { r.engine.pid = 1.5; }, (r) => { r.engine.bootId = ''; },
    ];
    for (const mutate of mutations) {
      const value = receipt() as Record<string, any>;
      mutate(value);
      expect(parseCodingWorkflowDispatchReceipt(value)).toBeNull();
    }
    expect(parseCodingWorkflowDispatchReceipt(null)).toBeNull();
    expect(parseCodingWorkflowDispatchReceipt([])).toBeNull();
  });
});

describe('strict native reads never turn absent or malformed data into an empty result', () => {
  const service = (sdk: Record<string, unknown>) => {
    const svc = new OpencodeClientService();
    (svc as unknown as { client: unknown }).client = { session: sdk };
    (svc as unknown as { status: string }).status = 'ready';
    return svc;
  };
  const node = { id: 'c1', parentID: 'p', directory: '/d' };

  it('listChildrenStrict', async () => {
    expect(await service({ children: async () => ({ data: [node] }) }).listChildrenStrict('p', '/d')).toEqual([node]);
    expect(await service({ children: async () => ({ data: [] }) }).listChildrenStrict('p', '/d')).toEqual([]);
    for (const response of [
      { error: { message: 'x' } }, { data: undefined }, { data: {} }, { data: [null] },
      { data: [{ id: 'c1', directory: '/d' }] }, { data: [{ ...node, directory: '' }] }, { data: [{ ...node, id: 7 }] },
    ]) expect(await service({ children: async () => response }).listChildrenStrict('p', '/d')).toBeNull();
    expect(await service({ children: async () => { throw new Error('down'); } }).listChildrenStrict('p', '/d')).toBeNull();
    const seen: unknown[] = [];
    await service({ children: async (request: unknown) => { seen.push(request); return { data: [] }; } }).listChildrenStrict('p', '/d');
    expect(seen).toEqual([{ path: { id: 'p' }, query: { directory: '/d' } }]);
  });

  it('listMessagesPageStrict', async () => {
    const message = { info: { id: 'm1', role: 'assistant' }, parts: [] };
    const withCursor = service({ messages: async () => ({ data: [message], response: { headers: new Headers({ 'x-next-cursor': 'c9' }) } }) });
    expect(await withCursor.listMessagesPageStrict('s', '/d')).toEqual({ messages: [{ info: message.info, parts: [] }], nextCursor: 'c9' });
    expect(await service({ messages: async () => ({ data: [message], response: { headers: new Headers() } }) })
      .listMessagesPageStrict('s', '/d')).toMatchObject({ nextCursor: null });
    for (const response of [
      { error: { message: 'x' } }, { data: undefined }, { data: {} }, { data: [null] }, { data: [{ parts: [] }] },
      { data: [{ info: { role: 'assistant' } }] }, { data: [{ info: { id: 'm1' } }] },
    ]) expect(await service({ messages: async () => response }).listMessagesPageStrict('s', '/d')).toBeNull();
    expect(await service({ messages: async () => { throw new Error('down'); } }).listMessagesPageStrict('s', '/d')).toBeNull();
  });

  it('keeps the old defaulting wrappers exactly as they were', async () => {
    expect(await service({ children: async () => ({ data: undefined }) }).listChildren('p', '/d')).toEqual([]);
    expect(await service({ messages: async () => ({ data: undefined }) }).listMessagesPage('s', '/d')).toEqual({ messages: [], nextCursor: null });
  });
});

describe('typed prompt context refusals (no SDK request, no row)', () => {
  let db: Database.Database;
  let previous: Database.Database | null;
  beforeEach(() => { db = new Database(':memory:'); runMigrations(db); previous = setDb(db); });
  afterEach(() => { setDb(previous); db.close(); vi.unstubAllGlobals(); });

  const context = (): CodingWorkflowPromptDispatchContext => ({
    kind: 'coding_workflow_dispatch_v1', validate: () => true, isCurrent: () => true,
    onPrepared: () => true, onOutcome: () => undefined,
  });
  const provenance = (over: Record<string, unknown> = {}) => ({
    sessionId: 'local-child', sdkSessionId: 'sdk-child', origin: 'delegation' as const, requestedSource: 'agent_config' as const,
    routeAuthed: null, reasonCode: CODING_WORKFLOW_DISPATCH_REASON, ...over,
  });

  it.each([
    ['another reason code', { reasonCode: 'other_code' }],
    ['no reason code', { reasonCode: undefined }],
    ['a foreground-shaped origin', { origin: 'prompt_api' }],
    ['a route-authenticated dispatch', { routeAuthed: true }],
    ['a different SDK session', { sdkSessionId: 'sdk-other' }],
  ])('refuses %s', async (_name, over) => {
    const sdkPrompt = vi.fn();
    const svc = new OpencodeClientService();
    (svc as unknown as { client: unknown }).client = { session: { promptAsync: sdkPrompt } };
    expect(await svc.promptAsync('sdk-child', 'hi', undefined, '/d', undefined, undefined, undefined,
      provenance(over) as never, undefined, undefined, undefined, undefined, context())).toBe(false);
    expect(sdkPrompt).not.toHaveBeenCalled();
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM agent_turn_dispatches').get()).toEqual({ n: 0 });
  });

  it('refuses a malformed context and any combination with another typed context', async () => {
    const sdkPrompt = vi.fn();
    const svc = new OpencodeClientService();
    (svc as unknown as { client: unknown }).client = { session: { promptAsync: sdkPrompt } };
    const call = (extra: { callback?: unknown; approval?: unknown; workflow?: unknown }) => svc.promptAsync(
      'sdk-child', 'hi', undefined, '/d', undefined, undefined, undefined, provenance() as never, undefined, undefined,
      extra.callback as never, extra.approval as never, extra.workflow as never);
    expect(await call({ workflow: { ...context(), kind: 'other' } })).toBe(false);
    expect(await call({ workflow: { ...context(), isCurrent: undefined } })).toBe(false);
    expect(await call({ workflow: context(), callback: { kind: 'coordinator_callback_v1', validate: () => true } })).toBe(false);
    expect(await call({ workflow: context(), approval: { kind: 'coordinator_goal_approval_resume_v1', validate: () => true } })).toBe(false);
    expect(sdkPrompt).not.toHaveBeenCalled();
  });
});
