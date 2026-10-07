/**
 * C3 — canonical coordinator change hint, SQLite → hub → project SSE.
 *
 * One focused seam test over real migrations: the repository lookup, the
 * service/bridge commit producers, the reserved-type raw rejection and the
 * delivery guard. Identity-only; no bodies, SDK selectors or ordering claims.
 */
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { getDb, setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { CoordinatorConversationsRepository } from '../repositories/coordinator_conversations_repository';
import {
  COORDINATOR_CHANGED_EVENT,
  opencodeEventHub,
  type GlobalEventEnvelope,
} from '../services/opencode_event_hub';
import { MobileSseProxy } from '../services/mobile_sse_proxy';
import { CoordinatorConversationService } from '../services/coordinator_conversation_service';
import { shapeMobileCoordinatorChanged } from '../services/mobile_opencode_security';

const { sessionMap, subscribeGlobalSpy } = vi.hoisted(() => ({
  sessionMap: new Map<string, string>(),
  subscribeGlobalSpy: vi.fn(),
}));

vi.mock('../services/ws_gateway', () => ({
  broadcast: vi.fn(),
  broadcastSessionUpdated: vi.fn(),
}));

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
let root: string;
let projectId: string;
let primaryId: string;
let sessions: AgentSessionsRepository;

function sessionRow(name: string, over: Partial<Record<string, unknown>> = {}): string {
  const session = sessions.insert({
    agentKind: 'claude-code', taskId: null, cwd: root, name, profileId: 'profile-1',
  } as never);
  getDb().prepare('UPDATE agent_sessions SET owner_user_id=?, project_id=? WHERE id=?')
    .run(OWNER, projectId, session.id);
  for (const [column, value] of Object.entries(over)) {
    getDb().prepare(`UPDATE agent_sessions SET ${column}=? WHERE id=?`).run(value, session.id);
  }
  return session.id;
}

beforeEach(() => {
  const db = new Database(':memory:');
  runMigrations(db);
  // Fixture rows name an owner/project without a users catalog.
  db.pragma('foreign_keys = OFF');
  setDb(db);
  root = realpathSync(mkdtempSync(join(tmpdir(), 'c3-notify-')));
  projectId = 'project-c3';
  db.prepare(`INSERT INTO projects (id, name, cwd, created_at) VALUES (?, 'P', ?, ?)`)
    .run(projectId, root, new Date().toISOString());
  sessions = new AgentSessionsRepository();
  primaryId = sessionRow('primary');
  const designated = new CoordinatorConversationsRepository().designatePrimaryOwnerRoot(
    { ownerUserId: OWNER, projectId, sessionId: primaryId },
    { allowUnboundSdk: true },
  );
  expect(designated.kind).toBe('found');
  sessionMap.clear();
  opencodeEventHub.setLive(false);
});

afterEach(() => {
  opencodeEventHub.setLive(false);
  vi.restoreAllMocks();
});

function collect(): { events: GlobalEventEnvelope[]; stop(): Promise<void> } {
  const subscription = opencodeEventHub.subscribe(64);
  const events: GlobalEventEnvelope[] = [];
  const draining = (async () => {
    for await (const envelope of subscription.stream) events.push(envelope);
  })();
  return { events, stop: async () => { subscription.close(); await draining; } };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

function service(): CoordinatorConversationService {
  return new CoordinatorConversationService({
    repository: new CoordinatorConversationsRepository(),
    context: {} as never,
  } as never);
}

describe('C3 notification scope lookup', () => {
  const lookup = (input: Parameters<CoordinatorConversationsRepository['findCanonicalNotificationScope']>[0]) =>
    new CoordinatorConversationsRepository().findCanonicalNotificationScope(input);

  it('qualifies an inert primary without any SDK binding', () => {
    const found = lookup({ sessionId: primaryId });
    expect(found).toMatchObject({
      directory: root, projectId, localSessionId: primaryId, ownerUserId: OWNER,
    });
    expect(found?.conversationId).toBeTruthy();
  });

  it('fails closed for archived, child, ordinary, foreign and rebound identities', () => {
    expect(lookup({ sessionId: primaryId, ownerUserId: 99 })).toBeNull();
    expect(lookup({ sessionId: primaryId, projectId: 'other' })).toBeNull();
    expect(lookup({ sessionId: sessionRow('ordinary') })).toBeNull();
    expect(lookup({ sessionId: 'missing' })).toBeNull();
    const child = sessionRow('child', { parent_session_id: primaryId });
    expect(lookup({ sessionId: child })).toBeNull();
    getDb().prepare('UPDATE projects SET archived_at=? WHERE id=?').run('2026-10-06', projectId);
    expect(lookup({ sessionId: primaryId })).toBeNull();
    getDb().prepare('UPDATE projects SET archived_at=NULL WHERE id=?').run(projectId);
    getDb().prepare('UPDATE agent_sessions SET archived_at=? WHERE id=?').run('2026-10-06', primaryId);
    expect(lookup({ sessionId: primaryId })).toBeNull();
  });
});

describe('C3 service commit producers', () => {
  const actor = OWNER as never;
  const base = { sessionId: '', projectId: '' };

  it('publishes once per committed command, never for replay/conflict, ids only', async () => {
    const svc = service();
    const hub = collect();
    const request = { ...base, sessionId: primaryId, projectId };
    const first = svc.addGoal(actor, { ...request, commandKey: 'k1', expectedControlRevision: 1, objective: 'secret goal body' });
    expect(first.kind).toBe('created');
    const replay = svc.addGoal(actor, { ...request, commandKey: 'k1', expectedControlRevision: 1, objective: 'secret goal body' });
    expect(replay.kind).toBe('replay');
    const stale = svc.addGoal(actor, { ...request, commandKey: 'k2', expectedControlRevision: 1, objective: 'other' });
    expect(stale.kind).toBe('revision_conflict');
    await tick();
    await hub.stop();
    expect(hub.events).toHaveLength(1);
    const envelope = hub.events[0];
    expect(envelope.directory).toBe(root);
    const payload = envelope.payload as { type: string; id: string; properties: Record<string, string> };
    expect(payload.type).toBe(COORDINATOR_CHANGED_EVENT);
    expect(Object.keys(payload.properties).sort()).toEqual(['conversationId', 'localSessionId', 'projectId']);
    expect(JSON.stringify(envelope)).not.toContain('secret goal body');
  });

  it('status input without a controlRevision change still publishes, with distinct ids', async () => {
    const svc = service();
    const hub = collect();
    const request = { ...base, sessionId: primaryId, projectId };
    for (const key of ['s1', 's2']) {
      // The status reply needs a context assembler this seam does not wire;
      // only the committed input row and its hint matter here.
      await svc.receiveMessage(actor, {
        ...request, commandKey: key, expectedControlRevision: 1,
        message: 'what did we do yesterday?',
      });
    }
    expect(
      new CoordinatorConversationsRepository().get({ ownerUserId: OWNER, projectId, sessionId: primaryId }),
    ).toMatchObject({ kind: 'found', conversation: { controlRevision: 1 } });
    await tick();
    await hub.stop();
    const ids = hub.events.map((e) => (e.payload as { id: string }).id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('a notification failure never changes or repeats the committed command', () => {
    const repository = new CoordinatorConversationsRepository();
    vi.spyOn(repository, 'findCanonicalNotificationScope').mockImplementation(() => {
      throw new Error('lookup down');
    });
    const svc = new CoordinatorConversationService({ repository, context: {} as never } as never);
    const request = { ...base, sessionId: primaryId, projectId };
    const input = { ...request, commandKey: 'k1', expectedControlRevision: 1, objective: 'goal' };
    expect(svc.addGoal(actor, input).kind).toBe('created');
    expect(svc.addGoal(actor, input).kind).toBe('replay');
  });
});

describe('C3 bridge producers and raw reserved-type rejection', () => {
  async function run(frames: unknown[]): Promise<GlobalEventEnvelope[]> {
    subscribeGlobalSpy.mockResolvedValueOnce({
      abort: () => {},
      stream: (async function* () { for (const f of frames) yield f as never; })(),
    });
    subscribeGlobalSpy.mockResolvedValue({ abort: () => {}, stream: (async function* () {})() });
    const hub = collect();
    await new OpencodeStreamBridge().ensureGlobalStream();
    await tick();
    await hub.stop();
    return hub.events;
  }
  const part = (sessionID: string, text: string) => ({
    type: 'message.part.updated',
    __directory: root,
    properties: { part: { id: 'prt_1', messageID: 'msg_1', sessionID, type: 'text', text } },
  });
  const changed = (events: GlobalEventEnvelope[]) =>
    events.filter((e) => (e.payload as { type: string }).type === COORDINATOR_CHANGED_EVENT);

  beforeEach(() => {
    process.env.RHYTHM_SSE_GLOBAL = '1';
    sessions.setSdkSessionId(primaryId, 'ses_primary');
    sessionMap.set(primaryId, 'ses_primary');
  });
  afterEach(() => { delete process.env.RHYTHM_SSE_GLOBAL; });

  it('two updates to the same message row publish distinct invalidations after commit', async () => {
    const events = await run([part('ses_primary', 'one'), part('ses_primary', 'two')]);
    const hints = changed(events);
    expect(hints).toHaveLength(2);
    const ids = hints.map((e) => (e.payload as { id: string }).id);
    expect(new Set(ids).size).toBe(2);
    expect(JSON.stringify(hints)).not.toContain('one');
  });

  it('child and ordinary output publish no root hint', async () => {
    const child = sessionRow('child', { parent_session_id: primaryId });
    sessions.setSdkSessionId(child, 'ses_child');
    const ordinary = sessionRow('ordinary');
    sessions.setSdkSessionId(ordinary, 'ses_ordinary');
    const events = await run([part('ses_child', 'c'), part('ses_ordinary', 'o')]);
    expect(changed(events)).toHaveLength(0);
  });

  it('a failed persistence write publishes no hint', async () => {
    getDb().prepare('DROP TABLE agent_session_messages').run();
    const events = await run([part('ses_primary', 'x')]);
    expect(changed(events)).toHaveLength(0);
  });

  it('Sol committed root system error append emits a canonical invalidation', async () => {
    const events = await run([{
      type: 'session.error', __directory: root,
      properties: { sessionID: 'ses_primary', error: { name: 'UnknownError', data: { message: 'synthetic error' } } },
    }]);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM agent_session_messages WHERE session_id=? AND role=?').get(primaryId, 'system')).toMatchObject({ n: 1 });
    expect(changed(events)).toHaveLength(1);
  });

  it('a raw engine frame cannot impersonate the reserved type', async () => {
    const events = await run([{
      type: COORDINATOR_CHANGED_EVENT,
      __directory: root,
      properties: { projectId, conversationId: 'x', localSessionId: primaryId },
    }]);
    expect(changed(events)).toHaveLength(0);
  });
});

describe('C3 mobile delivery guard', () => {
  const scopeOf = () => ({ id: projectId, root });

  function frameData(frames: string[]): Array<Record<string, any>> {
    return frames.filter((f) => f.includes('event: message')).map((f) =>
      JSON.parse(f.split('\n').find((l) => l.startsWith('data: '))!.slice(6)));
  }

  async function deliver(opts: {
    envelope?: unknown;
    userId?: number;
    sessionId?: string;
    mutate?: () => void;
    projectResolver?: (id: string) => { id: string; root: string };
    engineFrame?: string;
    produce?: () => void;
    isDeviceActive?: () => boolean;
  } = {}): Promise<Array<Record<string, any>>> {
    const written: string[] = [];
    const handlers = new Map<string, Array<() => void>>();
    const on = (e: string, h: () => void) => handlers.set(e, [...(handlers.get(e) ?? []), h]);
    const response = {
      statusCode: 0, writableEnded: false, writableLength: 0,
      setHeader: () => undefined, flushHeaders: () => undefined,
      write: (c: string) => { written.push(c); return true; },
      end: () => { response.writableEnded = true; },
      once: on, off: () => undefined,
    };
    const hubLive = opts.engineFrame === undefined;
    opencodeEventHub.setLive(hubLive);
    const proxy = new MobileSseProxy({
      ownershipRepository: {} as never,
      projectResolver: opts.projectResolver ?? ((id) => ({ id, root })),
      activeCheckIntervalMs: 60_000,
      fetchFn: (async () => new Response(opts.engineFrame ?? '', {
        status: 200, headers: { 'content-type': 'text/event-stream' },
      })) as never,
      reconnectBaseMs: 60_000,
    });
    const streamed = proxy.stream({
      request: { once: on, off: () => undefined } as never,
      response: response as never,
      project: scopeOf(),
      userId: opts.userId ?? OWNER,
      sessionId: opts.sessionId,
      preauthorizedSession: true,
      isDeviceActive: opts.isDeviceActive ?? (() => true),
    });
    await new Promise((r) => setImmediate(r));
    // Minted while the root is still current; the mutation lands in between
    // enqueue and delivery, as in a real race.
    const envelope = opts.envelope ?? (hubLive && !opts.produce ? hint() : undefined);
    opts.mutate?.();
    if (opts.produce) opts.produce();
    else if (hubLive) opencodeEventHub.publish(envelope as GlobalEventEnvelope);
    await tick();
    for (const h of handlers.get('close') ?? []) h();
    await streamed;
    getDb().prepare('UPDATE agent_sessions SET archived_at=NULL, owner_user_id=?, project_id=? WHERE id=?')
      .run(OWNER, projectId, primaryId);
    return frameData(written);
  }

  function hint(over: Record<string, unknown> = {}) {
    const found = new CoordinatorConversationsRepository().findCanonicalNotificationScope({ sessionId: primaryId })!;
    return {
      directory: root,
      payload: {
        type: COORDINATOR_CHANGED_EVENT,
        id: 'evt_1',
        properties: {
          projectId, conversationId: found.conversationId, localSessionId: primaryId, ...over,
        },
      },
    };
  }

  it('Sol actual SQLite command commit reaches hub and project SSE with only current identity', async () => {
    let created: unknown;
    const received = await deliver({ produce: () => {
      created = service().addGoal(OWNER as never, {
        sessionId: primaryId, projectId, commandKey: 'sol-real-seam',
        expectedControlRevision: 1, objective: 'private exact authored objective',
      });
    } });
    expect(created).toMatchObject({ kind: 'created' });
    const current = new CoordinatorConversationsRepository().get({ ownerUserId: OWNER, projectId, sessionId: primaryId });
    expect(current).toMatchObject({ kind: 'found', conversation: { goals: [{ objective: 'private exact authored objective' }] } });
    expect(received).toEqual([{
      directory: projectId,
      payload: { type: COORDINATOR_CHANGED_EVENT, id: expect.stringMatching(/^[A-Za-z0-9_-]{1,128}$/),
        properties: { projectId, conversationId: (current as any).conversation.id, localSessionId: primaryId } },
    }]);
    expect(JSON.stringify(received)).not.toContain('private exact authored objective');
    expect(JSON.stringify(received)).not.toContain('sessionID');
  });

  it('Sol queued real commit hint is dropped when its device is revoked before delivery', async () => {
    let active = true;
    const received = await deliver({ isDeviceActive: () => active, produce: () => {
      expect(service().addGoal(OWNER as never, {
        sessionId: primaryId, projectId, commandKey: 'sol-revocation',
        expectedControlRevision: 1, objective: 'committed before revocation',
      }).kind).toBe('created');
      active = false;
    } });
    expect(received).toEqual([]);
  });

  it('Sol actual relay opaque project root rejects valid Mac hint before authority lookup', () => {
    const lookup = vi.fn(() => new CoordinatorConversationsRepository().findCanonicalNotificationScope({ sessionId: primaryId }));
    expect(shapeMobileCoordinatorChanged(hint(), { id: projectId, root: '/' }, OWNER, lookup)).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
    expect(shapeMobileCoordinatorChanged(hint(), scopeOf(), OWNER, lookup)).not.toBeNull();
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('delivers the exact identity-only frame to the current owner/project feed', async () => {
    const received = await deliver();
    expect(received).toEqual([{
      directory: projectId,
      payload: {
        type: COORDINATOR_CHANGED_EVENT,
        id: 'evt_1',
        properties: {
          projectId,
          conversationId: expect.any(String),
          localSessionId: primaryId,
        },
      },
    }]);
  });

  it('drops stale, archived, rebound, foreign and body-bearing hints', async () => {
    expect(await deliver({ mutate: () => getDb().prepare('UPDATE agent_sessions SET archived_at=? WHERE id=?').run('x', primaryId) })).toEqual([]);
    expect(await deliver({ mutate: () => getDb().prepare('UPDATE agent_sessions SET owner_user_id=99 WHERE id=?').run(primaryId) })).toEqual([]);
    expect(await deliver({ mutate: () => getDb().prepare('UPDATE agent_sessions SET project_id=? WHERE id=?').run('elsewhere', primaryId) })).toEqual([]);
    expect(await deliver({ userId: 99 })).toEqual([]);
    expect(await deliver({ envelope: hint({ conversationId: 'stale-conversation' }) })).toEqual([]);
    expect(await deliver({ envelope: hint({ localSessionId: 'other-session' }) })).toEqual([]);
    const withBody = hint() as { payload: { properties: Record<string, unknown> } };
    withBody.payload.properties.text = 'private body';
    expect(await deliver({ envelope: withBody })).toEqual([]);
    const extra = hint() as { payload: Record<string, unknown> };
    extra.payload.sessionID = 'ses_primary';
    expect(await deliver({ envelope: extra })).toEqual([]);
    expect(await deliver({ projectResolver: () => ({ id: projectId, root: '/rebound' }) })).toEqual([]);
    expect(await deliver({ projectResolver: () => { throw new Error('gone'); } })).toEqual([]);
  });

  it('never serves the hint on the per-SDK-session feed or the engine fallback', async () => {
    expect(await deliver({ sessionId: 'ses_primary' })).toEqual([]);
    const spoof = `data: ${JSON.stringify(hint())}\n\n`;
    expect(await deliver({ engineFrame: spoof })).toEqual([]);
  });
});
