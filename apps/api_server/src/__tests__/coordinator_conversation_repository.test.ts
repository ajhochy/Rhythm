import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { installCoordinatorConversationSchema } from '../database/coordinator_conversation_schema';
import { continuationIsLive } from '../contracts/coordinator_conversation_contract';
import { CoordinatorConversationsRepository } from '../repositories/coordinator_conversations_repository';

const scope = { ownerUserId: 7, projectId: 'project-a', sessionId: 'chat-a' };
const clock = () => new Date('2026-10-05T12:00:00.000Z');

function authority(goalId: string) {
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
    issuedAt: '2026-10-05T12:00:00.000Z',
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
      acknowledgedAt: '2026-10-05T12:00:00.000Z',
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
    VALUES (?, ?, ?, NULL, 0, 'chat', 'profile-1', 'default', 0, ?)`).run(scope.sessionId, scope.ownerUserId, scope.projectId, clock().toISOString());
  return db;
}

describe('coordinator conversation durable binding', () => {
  let db: Database.Database | null = null;
  afterEach(() => { db?.close(); db = null; });

  it('adds only a nullable default-off column, preserves existing rows, and rejects noncanonical storage', () => {
    db = database();
    const before = db.prepare('SELECT updated_at FROM agent_sessions WHERE id=?').get(scope.sessionId) as { updated_at: string };
    installCoordinatorConversationSchema(db);
    installCoordinatorConversationSchema(db);
    const column = (db.prepare('PRAGMA table_info(agent_sessions)').all() as Array<Record<string, unknown>>)
      .find((candidate) => candidate.name === 'coordinator_conversation_json');
    expect(column).toMatchObject({ type: 'TEXT', notnull: 0, dflt_value: null });
    expect(db.prepare('SELECT updated_at, coordinator_conversation_json FROM agent_sessions WHERE id=?').get(scope.sessionId)).toEqual({
      ...before,
      coordinator_conversation_json: null,
    });

    const invalid = new Database(':memory:');
    invalid.exec(`CREATE TABLE agent_sessions (
      id TEXT PRIMARY KEY, owner_user_id INTEGER, project_id TEXT, parent_session_id TEXT,
      is_system INTEGER, category TEXT, updated_at TEXT,
      coordinator_conversation_json TEXT NOT NULL DEFAULT '{}'
    )`);
    expect(() => installCoordinatorConversationSchema(invalid)).toThrow('Unsupported coordinator conversation column');
    invalid.close();
  });

  it('reopens the same chat binding, dedupes exact goal commands, and preserves earlier goal IDs', () => {
    db = database(); installCoordinatorConversationSchema(db);
    const repo = new CoordinatorConversationsRepository(db, clock);
    const opened = repo.open(scope);
    expect(opened.kind).toBe('created');
    if (opened.kind !== 'created') throw new Error('expected create');
    const first = repo.addGoal({ ...scope, expectedControlRevision: 1, commandKey: 'goal-one', objective: 'Review today' });
    expect(first.kind).toBe('created');
    if (first.kind !== 'created') throw new Error('expected first goal');
    const replay = repo.addGoal({ ...scope, expectedControlRevision: 1, commandKey: 'goal-one', objective: 'Review today' });
    expect(replay).toMatchObject({ kind: 'replay', goal: { id: first.goal.id } });
    const conflict = repo.addGoal({ ...scope, expectedControlRevision: 2, commandKey: 'goal-one', objective: 'Changed meaning' });
    expect(conflict.kind).toBe('command_conflict');
    const second = repo.addGoal({ ...scope, expectedControlRevision: 2, commandKey: 'goal-two', objective: 'Capture another idea' });
    expect(second.kind).toBe('created');
    if (second.kind !== 'created') throw new Error('expected second goal');
    expect(second.conversation.goals.map((goal) => goal.id)).toEqual([first.goal.id, second.goal.id]);
    expect(second.conversation.controlRevision).toBe(3);

    const afterRestart = new CoordinatorConversationsRepository(db, clock).open(scope);
    expect(afterRestart).toMatchObject({ kind: 'replay', conversation: { id: opened.conversation.id, controlRevision: 3 } });
    expect(repo.get({ ...scope, ownerUserId: 8 }).kind).toBe('not_found');
    expect(repo.get({ ...scope, projectId: 'project-b' }).kind).toBe('not_found');
  });

  it('holds malformed bytes and enforces one-turn authority without a route-side grant', () => {
    db = database(); installCoordinatorConversationSchema(db);
    const repo = new CoordinatorConversationsRepository(db, clock);
    repo.open(scope);
    const goal = repo.addGoal({ ...scope, expectedControlRevision: 1, commandKey: 'goal', objective: 'Bounded planning' });
    if (goal.kind !== 'created') throw new Error('expected goal');
    const linked = repo.linkGoal({ ...scope, expectedControlRevision: 2, goalId: goal.goal.id, workstreamId: 'workstream-1' });
    expect(linked.kind).toBe('updated');
    const savedAuthority = authority(goal.goal.id);
    const saved = repo.setContinuationAuthority({ ...scope, expectedControlRevision: 3, authority: savedAuthority });
    expect(saved).toMatchObject({ kind: 'updated', conversation: { controlRevision: 4 } });
    const consumed = repo.markContinuationConsumed({ ...scope, expectedControlRevision: 4, authorizationId: savedAuthority.authorizationId });
    expect(consumed).toMatchObject({ kind: 'updated', conversation: { continuations: [{ status: 'consumed', consumedTurns: 1 }] } });
    expect(repo.markContinuationConsumed({ ...scope, expectedControlRevision: 5, authorizationId: savedAuthority.authorizationId })).toMatchObject({ kind: 'replay' });

    db.prepare('UPDATE agent_sessions SET coordinator_conversation_json=? WHERE id=?').run('{malformed', scope.sessionId);
    expect(repo.get(scope).kind).toBe('integrity_hold');
    expect(repo.open(scope).kind).toBe('integrity_hold');
  });

  it('keeps a schema-3 continuation readable for status but unavailable for any further finite admission', () => {
    db = database(); installCoordinatorConversationSchema(db);
    const repo = new CoordinatorConversationsRepository(db, clock);
    repo.open(scope);
    const goal = repo.addGoal({ ...scope, expectedControlRevision: 1, commandKey: 'legacy-goal', objective: 'Legacy authority' });
    if (goal.kind !== 'created') throw new Error('expected goal');
    expect(repo.linkGoal({
      ...scope, expectedControlRevision: 2, goalId: goal.goal.id, workstreamId: 'workstream-1',
    }).kind).toBe('updated');
    const current = authority(goal.goal.id);
    expect(repo.setContinuationAuthority({ ...scope, expectedControlRevision: 3, authority: current }).kind).toBe('updated');
    const raw = db.prepare('SELECT coordinator_conversation_json AS value FROM agent_sessions WHERE id=?')
      .get(scope.sessionId) as { value: string };
    const legacy = JSON.parse(raw.value) as { continuations: Array<Record<string, unknown>> };
    legacy.continuations[0].schemaVersion = 3;
    delete legacy.continuations[0].permissionAuthority;
    delete legacy.continuations[0].executionScope;
    db.prepare('UPDATE agent_sessions SET coordinator_conversation_json=? WHERE id=?')
      .run(JSON.stringify(legacy), scope.sessionId);

    const reread = repo.get(scope);
    expect(reread).toMatchObject({
      kind: 'found',
      conversation: { continuations: [{ schemaVersion: 5, permissionAuthority: null, executionScope: null }] },
    });
    if (reread.kind !== 'found') throw new Error('expected readable legacy record');
    expect(continuationIsLive(reread.conversation.continuations[0], clock())).toBe(false);
  });

  it('keeps a finite authority fenced to its own goal when a sibling idea advances the chat revision', () => {
    db = database(); installCoordinatorConversationSchema(db);
    const repo = new CoordinatorConversationsRepository(db, clock);
    const opened = repo.open(scope);
    if (opened.kind !== 'created') throw new Error('expected conversation');
    const first = repo.addGoal({ ...scope, expectedControlRevision: 1, commandKey: 'first', objective: 'First bounded goal' });
    if (first.kind !== 'created') throw new Error('expected first goal');
    expect(repo.linkGoal({
      ...scope, expectedControlRevision: 2, goalId: first.goal.id, workstreamId: 'workstream-1',
    }).kind).toBe('updated');
    const finite = { ...authority(first.goal.id), maxTurns: 2 as const };
    expect(repo.setContinuationAuthority({ ...scope, expectedControlRevision: 3, authority: finite }).kind).toBe('updated');
    expect(repo.reserveContinuationTurn({
      ...scope, expectedControlRevision: 4, expectedGoalRevision: 2,
      authorizationId: finite.authorizationId, expectedConsumedTurns: 0, workstreamRevision: 1,
    }).kind).toBe('updated');
    const withFirstTurn = repo.get(scope);
    if (withFirstTurn.kind !== 'found') throw new Error('expected first reservation');
    expect(repo.addGoal({
      ...scope, expectedControlRevision: withFirstTurn.conversation.controlRevision,
      commandKey: 'second', objective: 'Independent second idea',
    }).kind).toBe('created');
    // `expectedControlRevision: 5` is now stale because the sibling addition
    // advanced the chat UI. The first goal's durable revision is unchanged.
    expect(repo.reserveContinuationTurn({
      ...scope, expectedControlRevision: 5, expectedGoalRevision: 2,
      authorizationId: finite.authorizationId, expectedConsumedTurns: 1, workstreamRevision: 1,
    })).toMatchObject({ kind: 'updated', conversation: { continuations: [{ consumedTurns: 2 }] } });
  });

  it('refuses to consume an ordinal when the durable parent permission or approval changed after selection', () => {
    db = database(); installCoordinatorConversationSchema(db);
    const repo = new CoordinatorConversationsRepository(db, clock);
    expect(repo.open(scope).kind).toBe('created');
    const goal = repo.addGoal({ ...scope, expectedControlRevision: 1, commandKey: 'permission-goal', objective: 'Permission-fenced goal' });
    if (goal.kind !== 'created') throw new Error('expected goal');
    expect(repo.linkGoal({
      ...scope, expectedControlRevision: 2, goalId: goal.goal.id, workstreamId: 'workstream-1',
    }).kind).toBe('updated');
    const finite = authority(goal.goal.id);
    expect(repo.setContinuationAuthority({ ...scope, expectedControlRevision: 3, authority: finite }).kind).toBe('updated');

    db.prepare(`UPDATE agent_sessions
      SET permission_mode='bypassPermissions', approval_bypass_explicit=1 WHERE id=?`).run(scope.sessionId);
    const denied = repo.reserveContinuationTurn({
      ...scope, expectedControlRevision: 4, expectedGoalRevision: 2,
      authorizationId: finite.authorizationId, expectedConsumedTurns: 0, workstreamRevision: 1,
    });
    expect(denied.kind).toBe('authority_conflict');
    expect(repo.get(scope)).toMatchObject({
      kind: 'found', conversation: { continuations: [{ status: 'authorized', consumedTurns: 0 }] },
    });

    // A restrictive change is equally non-portable. Restoring the exact
    // acknowledged tuple is the only way this already-issued record may use
    // its first ordinal; a changed tuple requires a fresh service admission.
    db.prepare(`UPDATE agent_sessions
      SET permission_mode='plan', approval_bypass_explicit=0 WHERE id=?`).run(scope.sessionId);
    expect(repo.reserveContinuationTurn({
      ...scope, expectedControlRevision: 4, expectedGoalRevision: 2,
      authorizationId: finite.authorizationId, expectedConsumedTurns: 0, workstreamRevision: 1,
    }).kind).toBe('authority_conflict');
    expect(repo.get(scope)).toMatchObject({
      kind: 'found', conversation: { continuations: [{ status: 'authorized', consumedTurns: 0 }] },
    });
  });
});
