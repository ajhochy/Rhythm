import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import type {
  CoordinatorContextRead,
  CoordinatorConversationContextAdapters,
} from '../contracts/coordinator_conversation_contract';
import { installCoordinatorConversationSchema } from '../database/coordinator_conversation_schema';
import { CoordinatorConversationsRepository } from '../repositories/coordinator_conversations_repository';
import { CoordinatorConversationContextAssembler } from '../services/coordinator_conversation_context';
import { CoordinatorConversationService } from '../services/coordinator_conversation_service';

const scope = { ownerUserId: 7, projectId: 'project-a', sessionId: 'chat-a' };
const now = new Date('2026-10-05T12:00:00.000Z');

function available<T>(items: T[]): CoordinatorContextRead<T> {
  return {
    availability: 'available',
    reason: null,
    complete: true,
    authoritative: true,
    observedAt: now.toISOString(),
    sourceVersion: 'snapshot-1',
    items,
  };
}

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
    permission_mode TEXT NOT NULL DEFAULT 'default',
    approval_bypass_explicit INTEGER NOT NULL DEFAULT 0,
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
    (id, owner_user_id, project_id, parent_session_id, is_system, category, profile_id, permission_mode, approval_bypass_explicit, updated_at)
    VALUES (?, ?, ?, NULL, 0, 'chat', 'profile-1', 'default', 0, ?)`).run(scope.sessionId, scope.ownerUserId, scope.projectId, now.toISOString());
  installCoordinatorConversationSchema(db);
  return db;
}

function context(): CoordinatorConversationContextAssembler {
  const adapters: CoordinatorConversationContextAdapters = {
    tasks: { read: async () => available([]) },
    schedules: { read: async () => available([]) },
    rhythms: { read: async () => available([]) },
    workstreams: { read: async () => available([]) },
    receipts: { read: async () => available([]) },
  };
  return new CoordinatorConversationContextAssembler(adapters);
}

function request(input: { commandKey: string; message: string; expectedControlRevision: number }) {
  return { sessionId: scope.sessionId, projectId: scope.projectId, ...input };
}

function storedAuthority(goalId: string) {
  return {
    schemaVersion: 5 as const,
    authorizationId: 'authorization-1',
    authorizationCommandKey: 'authorization-command-1',
    goalId,
    projectId: scope.projectId,
    workstreamId: 'workstream-1',
    goalRevision: 2,
    parentSessionId: scope.sessionId,
    profileId: 'profile-1',
    profileRevision: 1,
    workstreamRevision: 1,
    issuedFromControlRevision: 3,
    issuedAt: '2026-10-05T11:30:00.000Z',
    expiresAt: '2026-10-05T12:30:00.000Z',
    requestedModel: { providerId: 'provider', modelId: 'model', mode: 'fixed' as const },
    permissionAuthority: {
      schemaVersion: 1 as const,
      parent: { sessionId: scope.sessionId, permissionMode: 'default' as const, approvalBypassExplicit: false },
      worker: { parentSessionId: scope.sessionId, permissionMode: 'default' as const, managedReadOnly: true as const },
    },
    maxTurns: 1 as const,
    consumedTurns: 0 as const,
    totalTokenAuthorization: 512,
    maxWallTimeSeconds: 300,
    acknowledgement: {
      schemaVersion: 1 as const,
      actorUserId: scope.ownerUserId,
      acknowledgedAt: '2026-10-05T11:30:00.000Z',
      kind: 'soft_total_tokens' as const,
      includes: ['input', 'output', 'reasoning', 'cache'] as ['input', 'output', 'reasoning', 'cache'],
      outputCapEnforced: false as const,
    },
    purpose: 'decompose' as const,
    executionScope: null,
    dayflowDependency: null,
    status: 'authorized' as const,
  };
}

describe('coordinator conversation C1 message ingress', () => {
  let db: Database.Database | null = null;
  afterEach(() => { db?.close(); db = null; });

  it('captures first and second literal goals through the same chat with durable replay/conflict and exact authored control', async () => {
    db = database();
    const repository = new CoordinatorConversationsRepository(db, () => now);
    const service = new CoordinatorConversationService({ repository, context: context(), now: () => now });

    const first = await service.receiveMessage(scope.ownerUserId, request({
      commandKey: 'goal-one', expectedControlRevision: 1,
      message: 'Add a workstream: Build the synthetic dashboard exactly as written',
    }));
    expect(first).toMatchObject({
      kind: 'created',
      goal: { objective: 'Build the synthetic dashboard exactly as written', state: 'captured', linkedWorkstreamId: null },
    });
    if (first.kind !== 'created') throw new Error('expected first literal goal');

    const second = await service.receiveMessage(scope.ownerUserId, request({
      commandKey: 'goal-two', expectedControlRevision: 2,
      message: 'I have another idea: Preserve the existing work references',
    }));
    expect(second).toMatchObject({ kind: 'created', goal: { objective: 'Preserve the existing work references' } });
    if (second.kind !== 'created') throw new Error('expected second literal goal');
    expect(second.conversation.goals.map((goal) => goal.id)).toEqual([first.goal.id, second.goal.id]);
    expect(second.conversation.goals[0].objective).toBe('Build the synthetic dashboard exactly as written');

    const replay = await service.receiveMessage(scope.ownerUserId, request({
      commandKey: 'goal-one', expectedControlRevision: 1,
      message: 'Add a workstream: Build the synthetic dashboard exactly as written',
    }));
    expect(replay).toMatchObject({ kind: 'replay', goal: { id: first.goal.id } });
    const conflict = await service.receiveMessage(scope.ownerUserId, request({
      commandKey: 'goal-one', expectedControlRevision: 3,
      message: 'Add a workstream: Model-rewritten control must not replace this',
    }));
    expect(conflict.kind).toBe('command_conflict');
    if (conflict.kind !== 'command_conflict') throw new Error('expected command conflict');
    expect(conflict.conversation.goals[0].id).toBe(first.goal.id);

    const afterReopen = new CoordinatorConversationsRepository(db, () => now).get(scope);
    expect(afterReopen).toMatchObject({
      kind: 'found', conversation: { controlRevision: 3, goals: [{ id: first.goal.id }, { id: second.goal.id }] },
    });
    expect(repository.get({ ...scope, ownerUserId: 8 }).kind).toBe('not_found');
    expect(repository.get({ ...scope, projectId: 'project-b' }).kind).toBe('not_found');
    expect(db.prepare('SELECT role, raw_text, stripped_text FROM agent_session_messages ORDER BY id').all()).toEqual([
      { role: 'input', raw_text: 'Add a workstream: Build the synthetic dashboard exactly as written', stripped_text: 'Add a workstream: Build the synthetic dashboard exactly as written' },
      { role: 'input', raw_text: 'I have another idea: Preserve the existing work references', stripped_text: 'I have another idea: Preserve the existing work references' },
    ]);
  });

  it('answers only status-shaped prompts deterministically and captures non-status authored controls without model classification', async () => {
    db = database();
    const repository = new CoordinatorConversationsRepository(db, () => now);
    let intentCalls = 0;
    let plannerCalls = 0;
    let exposureCalls = 0;
    let preferenceCalls = 0;
    const service = new CoordinatorConversationService({
      repository,
      context: context(),
      now: () => now,
      modelPreferences: { resolve: async () => {
        preferenceCalls += 1;
        return { providerId: 'provider', modelId: 'model', mode: 'fixed' as const };
      } },
      intent: { interpret: async () => {
        intentCalls += 1;
        return { kind: 'add_goal', objective: 'adversarial model rewrite' };
      } },
      planner: { prepare: async () => {
        plannerCalls += 1;
        return { kind: 'prepared', planReference: 'fake-plan' };
      } },
      exposure: { captureForPlanning: async () => {
        exposureCalls += 1;
        return { kind: 'ready', referenceManifestId: 'fake-manifest', sessionPolicy: 'fresh_managed_session_required' };
      } },
    });

    const status = await service.receiveMessage(scope.ownerUserId, request({
      commandKey: 'status-one', expectedControlRevision: 1,
      message: 'hey rhythm what did we do yesterday and what do we have to do today, and what are you doing',
    }));
    expect(status.kind).toBe('status');

    const ordinary = await service.receiveMessage(scope.ownerUserId, request({
      commandKey: 'imperative-status', expectedControlRevision: 1, message: 'Implement a status dashboard',
    }));
    const ordinaryToday = await service.receiveMessage(scope.ownerUserId, request({
      commandKey: 'imperative-today', expectedControlRevision: 1, message: 'Build something today',
    }));
    // The uncomposed C1 service retains only deterministic local capture; the
    // real server composition supplies foreground and routes this text there.
    expect(ordinary).toMatchObject({ kind: 'created', goal: { objective: 'Implement a status dashboard' } });
    expect(ordinaryToday).toMatchObject({ kind: 'revision_conflict' });

    const literalToday = await service.receiveMessage(scope.ownerUserId, request({
      commandKey: 'literal-today', expectedControlRevision: 2, message: 'Add a workstream: Build something today',
    }));
    expect(literalToday).toMatchObject({ kind: 'created', goal: { objective: 'Build something today' } });
    expect({ intentCalls, plannerCalls, exposureCalls, preferenceCalls }).toEqual({
      intentCalls: 0, plannerCalls: 0, exposureCalls: 0, preferenceCalls: 0,
    });
  });

  it('keeps all injected model-facing ports unavailable even with a stored one-turn record', async () => {
    db = database();
    const repository = new CoordinatorConversationsRepository(db, () => now);
    const opened = repository.open(scope);
    if (opened.kind !== 'created') throw new Error('expected conversation');
    const goal = repository.addGoal({ ...scope, expectedControlRevision: 1, commandKey: 'stored-goal', objective: 'Stored goal' });
    if (goal.kind !== 'created') throw new Error('expected goal');
    const linked = repository.linkGoal({
      ...scope,
      expectedControlRevision: 2,
      goalId: goal.goal.id,
      workstreamId: 'workstream-1',
    });
    if (linked.kind !== 'updated') throw new Error('expected linked goal');
    const authority = storedAuthority(goal.goal.id);
    expect(repository.setContinuationAuthority({ ...scope, expectedControlRevision: 3, authority }).kind).toBe('updated');
    let calls = 0;
    const service = new CoordinatorConversationService({
      repository,
      context: context(),
      now: () => now,
      modelPreferences: { resolve: async () => { calls += 1; return null; } },
      intent: { interpret: async () => { calls += 1; return { kind: 'add_goal', objective: 'overwrite user control' }; } },
      planner: { prepare: async () => { calls += 1; return { kind: 'prepared', planReference: 'fake-plan' }; } },
      exposure: { captureForPlanning: async () => {
        calls += 1;
        return { kind: 'ready', referenceManifestId: 'fake-manifest', sessionPolicy: 'fresh_managed_session_required' };
      } },
    });

    expect(await service.receiveMessage(scope.ownerUserId, request({
      commandKey: 'ambiguous', expectedControlRevision: 4, message: 'Please make progress on this',
    }))).toMatchObject({ kind: 'created', goal: { objective: 'Please make progress on this' } });
    expect(await service.preparePlan(scope.ownerUserId, {
      sessionId: scope.sessionId, projectId: scope.projectId, expectedControlRevision: 5, goalId: goal.goal.id,
      admission: null,
    })).toMatchObject({ kind: 'planner_unavailable' });
    expect(await service.receiveMessage(scope.ownerUserId, request({
      commandKey: 'second-literal', expectedControlRevision: 5, message: 'I have another idea: User control survives the stored authority',
    }))).toMatchObject({ kind: 'created', goal: { objective: 'User control survives the stored authority' } });
    expect(calls).toBe(0);
  });
});
