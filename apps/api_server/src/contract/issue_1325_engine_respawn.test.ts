import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

const {
  errorSpy,
  identityState,
  recoverySpy,
  statusesSpy,
  subscribeSpy,
} = vi.hoisted(() => ({
  errorSpy: vi.fn(),
  identityState: { bootId: 'boot-a', pid: 101, version: '1.14.49' },
  recoverySpy: vi.fn().mockResolvedValue({ parentsExamined: 0, claimsRemaining: 0 }),
  statusesSpy: vi.fn().mockResolvedValue({}),
  subscribeSpy: vi.fn(),
}));

vi.mock('../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: (...args: unknown[]) => errorSpy(...args),
  },
}));

vi.mock('../services/ws_gateway', () => ({
  broadcast: vi.fn(),
  broadcastSessionUpdated: vi.fn(),
}));

vi.mock('../services/async_delegation_completion_service', () => ({
  asyncDelegationCompletionService: {
    recoverAfterRestart: (...args: unknown[]) => recoverySpy(...args),
  },
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    getEngineIdentity: vi.fn(async () => ({ ...identityState })),
    getSessionStatuses: (...args: unknown[]) => statusesSpy(...args),
    listQuestions: vi.fn().mockResolvedValue([]),
    listPermissions: vi.fn().mockResolvedValue([]),
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    subscribeToGlobalEvents: (...args: unknown[]) => subscribeSpy(...args),
  },
  opencodeSessionMap: new Map<string, string>(),
}));

import { OpencodeClientService } from '../services/opencode_client_service';
import { buildOpencodeHealthPayload } from '../services/opencode_health';
import { OpencodeStreamBridge } from '../services/opencode_stream_bridge';

async function* stalledStream(): AsyncIterable<never> {
  await new Promise(() => {});
}

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('issue #1325 engine respawn recovery contract', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setDb(makeDb());
    identityState.bootId = 'boot-a';
    identityState.pid = 101;
    recoverySpy.mockClear();
    statusesSpy.mockReset().mockResolvedValue({});
    errorSpy.mockClear();
    subscribeSpy.mockReset().mockResolvedValue({
      abort: vi.fn(),
      stream: stalledStream(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('issue-1325-c1: engine boot identity change re-subscribes and reruns recovery', async () => {
    // Regression caught: api_server remains green while its SSE subscription
    // stays attached to the dead engine process after a respawn.
    const bridge = new OpencodeStreamBridge();
    await bridge.ensureGlobalStream();
    await (bridge as unknown as { checkEngineHealthNow(): Promise<void> })
      .checkEngineHealthNow();
    identityState.bootId = 'boot-b';
    identityState.pid = 202;
    await (bridge as unknown as { checkEngineHealthNow(): Promise<void> })
      .checkEngineHealthNow();

    expect(subscribeSpy).toHaveBeenCalledTimes(2);
    expect(recoverySpy).toHaveBeenCalledTimes(1);
    bridge.dispose();
  });

  it('issue-1325-c2: bridge liveness becomes false after the subscription is disposed', async () => {
    // Regression caught: /opencode/health can report ready based solely on the
    // engine even though the bridge has no live subscription.
    const bridge = new OpencodeStreamBridge();
    await bridge.ensureGlobalStream();
    expect((bridge as unknown as { isLive: boolean }).isLive).toBe(true);
    expect(buildOpencodeHealthPayload(
      { isReady: true, statusMessage: 'ready', websearchConfigured: false },
      bridge,
    ).status).toBe('ready');
    bridge.dispose();
    expect((bridge as unknown as { isLive: boolean }).isLive).toBe(false);
    expect(buildOpencodeHealthPayload(
      { isReady: true, statusMessage: 'ready', websearchConfigured: false },
      bridge,
    )).toMatchObject({
      status: 'unavailable',
      bridgeLive: false,
      message: expect.stringContaining('bridge unavailable'),
    });
  });

  it('issue-1325-c3: stale active engine logs an error and reattaches', async () => {
    // Regression caught: a busy engine with no new persisted messages remains
    // silently stranded forever when health HTTP and SSE heartbeats stay green.
    const sessions = new AgentSessionsRepository();
    const session = sessions.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp/issue-1325',
      name: 'Active session',
    });
    sessions.setSdkSessionId(session.id, 'ses-active');
    new AgentSessionMessagesRepository().append(
      session.id,
      'input',
      'old input',
      'old input',
    );
    statusesSpy.mockResolvedValue({ 'ses-active': { type: 'busy' } });

    const bridge = new OpencodeStreamBridge();
    await bridge.ensureGlobalStream();
    await (bridge as unknown as { checkEngineHealthNow(): Promise<void> })
      .checkEngineHealthNow();
    vi.setSystemTime(new Date(Date.now() + 6 * 60 * 1000));
    await (bridge as unknown as { checkEngineHealthNow(): Promise<void> })
      .checkEngineHealthNow();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('persisted no messages'),
    );
    expect(subscribeSpy).toHaveBeenCalledTimes(2);
    bridge.dispose();
  });

  it('issue-1325-c4: client reads pid and bootId from global health', async () => {
    // Regression caught: version-only health cannot distinguish two engine
    // processes running the same build.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        healthy: true,
        version: '1.14.49',
        pid: 4321,
        bootId: 'boot-4321',
      }), { status: 200 }),
    );
    const service = new OpencodeClientService();
    const identity = await (service as unknown as {
      getEngineIdentity(): Promise<unknown>;
    }).getEngineIdentity();

    expect(identity).toEqual({
      version: '1.14.49',
      pid: 4321,
      bootId: 'boot-4321',
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/global/health'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
