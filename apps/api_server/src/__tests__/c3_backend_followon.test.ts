/**
 * C3 correction E1/E3: committed canonical producers dirty the root's existing
 * agent_sessions outbox record IN THE SAME transaction and publish an
 * identity-only hint only after the OUTER commit, only for changed writes.
 * Real migrated SQLite, real repositories/bridge, the singleton hub.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { env } from '../config/env';
import { getDb, setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { CoordinatorConversationsRepository } from '../repositories/coordinator_conversations_repository';
import {
  COORDINATOR_CHANGED_EVENT,
  opencodeEventHub,
  type GlobalEventEnvelope,
} from '../services/opencode_event_hub';

const { sessionMap, subscribeGlobalSpy } = vi.hoisted(() => ({
  sessionMap: new Map<string, string>(),
  subscribeGlobalSpy: vi.fn(),
}));
vi.mock('../services/ws_gateway', () => ({ broadcast: vi.fn(), broadcastSessionUpdated: vi.fn() }));
vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    subscribeToGlobalEvents: (...a: unknown[]) => subscribeGlobalSpy(...a),
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    getSessionStatuses: vi.fn().mockResolvedValue({}),
    listQuestions: vi.fn().mockResolvedValue([]),
    listPermissions: vi.fn().mockResolvedValue([]),
  },
  opencodeSessionMap: sessionMap,
}));

import { OpencodeStreamBridge } from '../services/opencode_stream_bridge';

const OWNER = 7;
const PROJECT = 'project-c3-followon';
const NOW = new Date('2026-10-06T12:00:00.000Z');
let root: string;
let repo: CoordinatorConversationsRepository;
let sessions: AgentSessionsRepository;
const scope = () => ({ ownerUserId: OWNER, projectId: PROJECT, sessionId: 'root' });

function insertSession(id: string, over: Record<string, unknown> = {}): void {
  const created = sessions.insert({
    agentKind: 'claude-code', taskId: null, cwd: root, name: id, profileId: 'profile-1',
  } as never);
  getDb().prepare('UPDATE agent_sessions SET id=?, owner_user_id=?, project_id=? WHERE id=?')
    .run(id, OWNER, PROJECT, created.id);
  for (const [column, value] of Object.entries(over)) {
    getDb().prepare(`UPDATE agent_sessions SET ${column}=? WHERE id=?`).run(value, id);
  }
}

const outboxRows = (): Array<{ tbl: string; pk: string }> =>
  getDb().prepare('SELECT tbl, pk FROM relay_outbox ORDER BY seq').all() as Array<{ tbl: string; pk: string }>;
const sessionOutbox = (pk: string): number => outboxRows().filter((row) => row.tbl === 'agent_sessions' && row.pk === pk).length;

function collect(): { events: GlobalEventEnvelope[]; stop(): Promise<void> } {
  const subscription = opencodeEventHub.subscribe(256);
  const events: GlobalEventEnvelope[] = [];
  const draining = (async () => { for await (const envelope of subscription.stream) events.push(envelope); })();
  return { events, stop: async () => { subscription.close(); await draining; } };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
const hintsOf = (events: GlobalEventEnvelope[]) =>
  events.filter((event) => (event.payload as { type?: string }).type === COORDINATOR_CHANGED_EVENT);

function authority(goalId: string) {
  return {
    schemaVersion: 5 as const,
    authorizationId: 'authorization-1',
    authorizationCommandKey: 'authorization-command-1',
    goalId,
    projectId: PROJECT,
    workstreamId: 'workstream-1',
    goalRevision: 2,
    parentSessionId: 'root',
    profileId: 'profile-1',
    profileRevision: 1,
    workstreamRevision: 1,
    issuedFromControlRevision: 3,
    issuedAt: NOW.toISOString(),
    expiresAt: '2026-10-06T12:30:00.000Z',
    requestedModel: { providerId: 'provider', modelId: 'model', mode: 'fixed' as const },
    permissionAuthority: {
      schemaVersion: 1 as const,
      parent: { sessionId: 'root', permissionMode: 'default' as const, approvalBypassExplicit: false },
      worker: { parentSessionId: 'root', permissionMode: 'default' as const, managedReadOnly: true as const },
    },
    maxTurns: 2 as const,
    consumedTurns: 0 as const,
    totalTokenAuthorization: 512,
    maxWallTimeSeconds: 300,
    acknowledgement: {
      schemaVersion: 1 as const,
      actorUserId: OWNER,
      acknowledgedAt: NOW.toISOString(),
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

const originalRelayUrls = (env as { relayUrls: string[] }).relayUrls;

beforeEach(() => {
  const db = new Database(':memory:');
  runMigrations(db);
  db.pragma('foreign_keys = OFF');
  setDb(db);
  // Replication is enabled exactly as in production: relay URLs configured, not the relay role.
  (env as { relayUrls: string[] }).relayUrls = ['wss://relay.example.test'];
  root = realpathSync(mkdtempSync(join(tmpdir(), 'c3-followon-')));
  db.prepare(`INSERT INTO projects (id, name, cwd, created_at) VALUES (?, 'P', ?, ?)`).run(PROJECT, root, NOW.toISOString());
  sessions = new AgentSessionsRepository();
  insertSession('root', { sdk_session_id: 'ses_root' });
  repo = new CoordinatorConversationsRepository(db, () => NOW);
  expect(repo.designatePrimaryOwnerRoot(scope()).kind).toBe('found');
  db.prepare('DELETE FROM relay_outbox').run();
  sessionMap.clear();
  opencodeEventHub.setLive(false);
});

afterEach(() => {
  (env as { relayUrls: string[] }).relayUrls = originalRelayUrls;
  vi.restoreAllMocks();
});

describe('E3 committed metadata producers: same-transaction outbox, post-commit hint, changed writes only', () => {
  it('dirties the root agent_sessions outbox in the same transaction as the write', async () => {
    const goal = repo.addGoal({ ...scope(), expectedControlRevision: 1, commandKey: 'g1', objective: 'private objective' });
    expect(goal.kind).toBe('created');
    expect(sessionOutbox('root')).toBe(1);
    // A replay writes nothing and dirties nothing more.
    getDb().prepare('DELETE FROM relay_outbox').run();
    expect(repo.addGoal({ ...scope(), expectedControlRevision: 1, commandKey: 'g1', objective: 'private objective' }).kind).toBe('replay');
    expect(outboxRows()).toEqual([]);
  });

  it('rolls the outbox record and the hint back together when the outer transaction fails', async () => {
    getDb().exec(`CREATE TRIGGER c3_force_abort BEFORE UPDATE OF coordinator_conversation_json ON agent_sessions
      BEGIN SELECT RAISE(ABORT, 'forced'); END`);
    const hub = collect();
    const result = repo.recordStatusMessage({ ...scope(), expectedControlRevision: 1, commandKey: 's1', message: 'status please' });
    await tick();
    await hub.stop();
    expect(result.kind).not.toBe('stored');
    expect(outboxRows()).toEqual([]);
    expect(hintsOf(hub.events)).toHaveLength(0);
    expect(getDb().prepare(`SELECT COUNT(*) AS n FROM agent_session_messages WHERE session_id='root'`).get()).toMatchObject({ n: 0 });
  });

  it('publishes foreground reservation and settlement once each, never for replays or holds', async () => {
    const hub = collect();
    const write = { ...scope(), expectedControlRevision: 1, commandKey: 'fg', message: 'literal body must not leak' };
    expect(repo.reserveForegroundMessage(write).kind).toBe('reserved');
    expect(repo.reserveForegroundMessage(write).kind).toBe('uncertain'); // replay of a reserved command: no write
    expect(repo.settleForegroundMessage({ ...scope(), commandKey: 'fg', message: write.message, outcome: 'accepted' }).kind).toBe('accepted');
    expect(repo.settleForegroundMessage({ ...scope(), commandKey: 'fg', message: write.message, outcome: 'accepted' }).kind).toBe('accepted'); // no write
    expect(repo.reserveForegroundMessage({ ...write, message: 'different payload' }).kind).toBe('command_conflict');
    await tick();
    await hub.stop();
    expect(hintsOf(hub.events)).toHaveLength(2);
    expect(JSON.stringify(hub.events)).not.toContain('literal body must not leak');
    expect(sessionOutbox('root')).toBe(1); // coalesced to one pending record
  });

  it('publishes delegation reservation and dispatch settlement, not their replays', async () => {
    const goal = repo.addGoal({ ...scope(), expectedControlRevision: 1, commandKey: 'g1', objective: 'Fix it' });
    if (goal.kind !== 'created') throw new Error('goal');
    const hub = collect();
    const reserve = { ...scope(), expectedControlRevision: 2, commandKey: 'd1', goalId: goal.goal.id, parentSdkSessionId: 'ses_root' };
    expect(repo.reserveGoalDelegation(reserve).kind).toBe('reserved');
    const settle = { ...scope(), expectedControlRevision: 3, commandKey: 'd1', goalId: goal.goal.id, outcome: 'dispatched' as const, delegationId: 'dg-1', childSessionId: 'child-1' };
    expect(repo.settleGoalDelegation(settle).kind).toBe('dispatched');
    expect(repo.settleGoalDelegation(settle).kind).toBe('dispatched_replay');
    await tick();
    await hub.stop();
    expect(hintsOf(hub.events)).toHaveLength(2);
  });

  it('publishes one hint for one actual terminal continuation reservation; replay and no-write stay silent', async () => {
    const goal = repo.addGoal({ ...scope(), expectedControlRevision: 1, commandKey: 'g1', objective: 'Finite goal' });
    if (goal.kind !== 'created') throw new Error('goal');
    expect(repo.linkGoal({ ...scope(), expectedControlRevision: 2, goalId: goal.goal.id, workstreamId: 'workstream-1' }).kind).toBe('updated');
    const finite = authority(goal.goal.id);
    expect(repo.setContinuationAuthority({ ...scope(), expectedControlRevision: 3, authority: finite }).kind).toBe('updated');
    getDb().prepare('UPDATE agent_sessions SET profile_id=? WHERE id=?').run('profile-1', 'root');
    getDb().prepare('DELETE FROM relay_outbox').run();

    const hub = collect();
    const reserve = {
      ...scope(), expectedControlRevision: 4, expectedGoalRevision: 2,
      authorizationId: finite.authorizationId, expectedConsumedTurns: 0, workstreamRevision: 1,
    };
    expect(repo.reserveContinuationTurn(reserve).kind).toBe('updated');
    expect(sessionOutbox('root')).toBe(1);
    const afterCommit = hintsOf(hub.events).length;
    // Same reservation again: stale revision/consumed turns, no durable write.
    expect(repo.reserveContinuationTurn(reserve).kind).not.toBe('updated');
    // A hold without a write (changed parent permission).
    getDb().prepare(`UPDATE agent_sessions SET permission_mode='bypassPermissions', approval_bypass_explicit=1 WHERE id='root'`).run();
    expect(repo.reserveContinuationTurn({ ...reserve, expectedControlRevision: 5, expectedConsumedTurns: 1 }).kind).toBe('authority_conflict');
    await tick();
    await hub.stop();
    expect(afterCommit).toBeLessThanOrEqual(1);
    expect(hintsOf(hub.events)).toHaveLength(1);
  });

  it('a publication failure never undoes, repeats or misreports a committed write', async () => {
    vi.spyOn(repo, 'findCanonicalNotificationScope').mockImplementation(() => { throw new Error('lookup down'); });
    const input = { ...scope(), expectedControlRevision: 1, commandKey: 'g1', objective: 'goal' };
    expect(repo.addGoal(input).kind).toBe('created');
    expect(sessionOutbox('root')).toBe(1);
    expect(repo.addGoal(input).kind).toBe('replay');
  });

  it('output-only bridge writes dirty the root outbox in the same transaction; ordinary and child chats do not', () => {
    const messages = new AgentSessionMessagesRepository();
    insertSession('ordinary');
    insertSession('child', { parent_session_id: 'root' });
    const part = { id: 'prt_1', messageID: 'msg_1', type: 'text', text: 'hello' };
    messages.upsertPart('root', 'msg_1', part);
    expect(sessionOutbox('root')).toBe(1);
    getDb().prepare('DELETE FROM relay_outbox').run();
    expect(messages.applyPartDelta('root', 'msg_1', 'prt_1', 'text', ' more')).toBe(true);
    expect(sessionOutbox('root')).toBe(1); // a delta alone dirties the root, not the per-token message row
    expect(outboxRows().some((row) => row.tbl === 'agent_session_messages')).toBe(false);
    getDb().prepare('DELETE FROM relay_outbox').run();
    messages.upsertMessageInfo('root', 'msg_2', 'output', null, null, '{}');
    messages.append('root', 'system', 'Error: x', 'Error: x');
    expect(sessionOutbox('root')).toBe(1);
    getDb().prepare('DELETE FROM relay_outbox').run();
    expect(messages.applyPartDelta('root', 'msg_1', 'missing', 'text', 'x')).toBe(false); // no-op: no dirty
    messages.upsertPart('ordinary', 'msg_o', part);
    messages.applyPartDelta('ordinary', 'msg_o', 'prt_1', 'text', 'x');
    messages.upsertPart('child', 'msg_c', part);
    messages.append('child', 'system', 'Error: child', 'Error: child');
    expect(sessionOutbox('ordinary')).toBe(0);
    expect(sessionOutbox('child')).toBe(0);
    expect(sessionOutbox('root')).toBe(0);
  });

  it.each(['commit', 'rollback'] as const)('Sol: caller-owned %s never publishes an inner-savepoint hint', async (outcome) => {
    const hub = collect();
    const during: boolean[] = [];
    const originalPublish = opencodeEventHub.publish.bind(opencodeEventHub);
    vi.spyOn(opencodeEventHub, 'publish').mockImplementation((envelope) => {
      if ((envelope.payload as { type?: string }).type === COORDINATOR_CHANGED_EVENT) during.push(getDb().inTransaction);
      originalPublish(envelope);
    });
    const action = () => getDb().transaction(() => {
      expect(repo.recordStatusMessage({ ...scope(), expectedControlRevision: 1, commandKey: 'outer-status', message: 'read status' }).kind).toBe('stored');
      if (outcome === 'rollback') throw new Error('caller rollback');
    })();
    if (outcome === 'rollback') expect(action).toThrow('caller rollback');
    else action();
    await tick();
    await hub.stop();
    expect(getDb().prepare(`SELECT COUNT(*) AS n FROM agent_session_messages WHERE session_id='root'`).get()).toMatchObject({ n: outcome === 'commit' ? 1 : 0 });
    expect(sessionOutbox('root')).toBe(outcome === 'commit' ? 1 : 0);
    expect.soft(during, 'publication must not run while a caller-owned outer transaction is open').toEqual([]);
    expect(hintsOf(hub.events), 'unowned commit has no post-commit publication hook; rollback must never leave a hint').toHaveLength(0);
  });

  it('a later independent owned operation never flushes an old unowned or rolled-back batch', async () => {
    const pending = () => (repo as unknown as { pendingCommits: Map<string, unknown> }).pendingCommits.size;
    const hub = collect();
    // Caller-owned rollback, then caller-owned commit: both batches are discarded at top-level exit.
    expect(() => getDb().transaction(() => {
      repo.recordStatusMessage({ ...scope(), expectedControlRevision: 1, commandKey: 'rolled-back', message: 'a' });
      throw new Error('caller rollback');
    })()).toThrow('caller rollback');
    expect(pending()).toBe(0);
    getDb().transaction(() => {
      expect(repo.recordStatusMessage({ ...scope(), expectedControlRevision: 1, commandKey: 'caller-commit', message: 'b' }).kind).toBe('stored');
    })();
    expect(pending()).toBe(0);
    // A later repository-owned operation that writes nothing (exact replay) flushes nothing old.
    expect(repo.recordStatusMessage({ ...scope(), expectedControlRevision: 1, commandKey: 'caller-commit', message: 'b' }).kind).toBe('replay');
    await tick();
    expect(hintsOf(hub.events)).toHaveLength(0);
    // A later independent owned write publishes exactly its own single hint after its own commit.
    expect(repo.addGoal({ ...scope(), expectedControlRevision: 1, commandKey: 'independent', objective: 'later goal' }).kind).toBe('created');
    expect(repo.recordStatusMessage({ ...scope(), expectedControlRevision: 2, commandKey: 'owned-status', message: 'c' }).kind).toBe('stored');
    await tick();
    await hub.stop();
    expect(hintsOf(hub.events)).toHaveLength(2);
    expect(pending()).toBe(0);
  });
});

describe('E1 root error hint immediately after the canonical append', () => {
  async function run(frames: unknown[]): Promise<GlobalEventEnvelope[]> {
    subscribeGlobalSpy.mockResolvedValueOnce({ abort: () => {}, stream: (async function* () { for (const f of frames) yield f as never; })() });
    subscribeGlobalSpy.mockResolvedValue({ abort: () => {}, stream: (async function* () {})() });
    const hub = collect();
    await new OpencodeStreamBridge().ensureGlobalStream();
    await tick();
    await hub.stop();
    return hub.events;
  }
  const errorFrame = (sessionID: string) => ({
    type: 'session.error', __directory: root,
    properties: { sessionID, error: { name: 'UnknownError', data: { message: 'synthetic error' } } },
  });

  beforeEach(() => {
    process.env.RHYTHM_SSE_GLOBAL = '1';
    for (const [local, sdk] of [['root', 'ses_root'], ['ordinary', 'ses_ordinary'], ['child', 'ses_child']] as const) {
      if (local !== 'root') insertSession(local, local === 'child' ? { parent_session_id: 'root' } : {});
      sessions.setSdkSessionId(local, sdk);
      sessionMap.set(local, sdk);
    }
  });
  afterEach(() => { delete process.env.RHYTHM_SSE_GLOBAL; });

  it('hints even when later status work throws, and dirties the root outbox', async () => {
    vi.spyOn(AgentSessionsRepository.prototype, 'setErrorStatus').mockImplementation(() => { throw new Error('status failed after commit'); });
    getDb().prepare('DELETE FROM relay_outbox').run();
    const events = await run([errorFrame('ses_root')]);
    expect(hintsOf(events)).toHaveLength(1);
    expect(getDb().prepare(`SELECT COUNT(*) AS n FROM agent_session_messages WHERE session_id='root' AND role='system'`).get()).toMatchObject({ n: 1 });
    expect(sessionOutbox('root')).toBe(1);
  });

  it('ordinary and child errors stay silent', async () => {
    expect(hintsOf(await run([errorFrame('ses_ordinary'), errorFrame('ses_child')]))).toHaveLength(0);
  });

  it('a failed append stays silent', async () => {
    vi.spyOn(AgentSessionMessagesRepository.prototype, 'append').mockImplementation(() => { throw new Error('append failed'); });
    expect(hintsOf(await run([errorFrame('ses_root')]))).toHaveLength(0);
  });
});
