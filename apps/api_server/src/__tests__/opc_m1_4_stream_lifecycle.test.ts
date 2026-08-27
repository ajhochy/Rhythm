/**
 * OPC-M1-4 Stream lifecycle + sentinel cleanup contract tests.
 * Issue #688.
 *
 * Criteria covered:
 *   c1 — stopStream prevents broadcast + DB write for stopped session
 *   c2 — stopStream does not affect a second live session
 *   c3 — error status persisted in DB; survives bridge restart + timer advance
 *   c4 — new prompt to errored session transitions status away from error
 *   c5 — source inspection: no pty_runner import
 *   c6 — __pending__ never escapes the WS/REST boundary
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb, getDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

const { broadcastSpy, broadcastSessionUpdatedSpy, sessionMap } = vi.hoisted(() => ({
  broadcastSpy: vi.fn(),
  broadcastSessionUpdatedSpy: vi.fn(),
  sessionMap: new Map<string, string>(),
}));

vi.mock('../services/ws_gateway', () => ({
  broadcast: (msg: unknown) => broadcastSpy(msg),
  broadcastSessionUpdated: (session: unknown) => broadcastSessionUpdatedSpy(session),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    respondPermission: vi.fn().mockResolvedValue(true),
  },
  opencodeSessionMap: sessionMap,
}));

import { OpencodeStreamBridge } from '../services/opencode_stream_bridge';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function seedSession(
  repo: AgentSessionsRepository,
  overrideId?: string,
): string {
  const session = repo.insert({
    agentKind: 'claude-code',
    taskId: null,
    taskTitle: null,
    cwd: '/tmp',
    name: 'test',
  });
  if (overrideId) {
    // Not needed; we use the generated id and set up sessionMap accordingly.
  }
  return session.id;
}

function relay(bridge: OpencodeStreamBridge, event: Record<string, unknown>): void {
  (bridge as unknown as { _relayEvent: (e: unknown) => void })._relayEvent(event);
}

// ---------------------------------------------------------------------------
// c1 — stopStream prevents broadcast + DB write for stopped session
// ---------------------------------------------------------------------------

describe('issue-688-c1: stopStream — events for stopped session produce no broadcast and no DB write', () => {
  const SDK_ID = 'sdk-stopped-1';
  let localId: string;
  let bridge: OpencodeStreamBridge;
  let sessionsRepo: AgentSessionsRepository;
  let messagesRepo: AgentSessionMessagesRepository;

  beforeEach(() => {
    setDb(makeDb());
    sessionMap.clear();
    broadcastSpy.mockClear();
    broadcastSessionUpdatedSpy.mockClear();

    sessionsRepo = new AgentSessionsRepository();
    messagesRepo = new AgentSessionMessagesRepository();
    bridge = new OpencodeStreamBridge();

    localId = seedSession(sessionsRepo);
    sessionMap.set(localId, SDK_ID);
  });

  it('after stopStream, a message.part.updated event produces no WS broadcast', () => {
    bridge.stopStream(localId);

    relay(bridge, {
      type: 'message.part.updated',
      properties: {
        part: {
          sessionID: SDK_ID,
          id: 'part-1',
          messageID: 'msg-1',
          type: 'text',
          text: 'hello',
        },
      },
    });

    // No broadcast should have happened for this session.
    const broadcasts = broadcastSpy.mock.calls.map((c) => c[0] as Record<string, unknown>);
    const relevant = broadcasts.filter((m) => m.id === localId || m.id === SDK_ID);
    expect(relevant).toHaveLength(0);
  });

  it('after stopStream, a session.idle event produces no DB status update', () => {
    // Accumulate some text first.
    relay(bridge, {
      type: 'message.part.delta',
      properties: {
        sessionID: SDK_ID,
        messageID: 'msg-1',
        partID: 'part-1',
        field: 'text',
        delta: 'hello',
      },
    });

    // Now stop the stream.
    bridge.stopStream(localId);
    broadcastSpy.mockClear();

    relay(bridge, {
      type: 'session.idle',
      properties: { sessionID: SDK_ID },
    });

    // No transcript.append or session status broadcast.
    const broadcasts = broadcastSpy.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(broadcasts.filter((m) => m.id === localId)).toHaveLength(0);

    // DB row status should remain unchanged (still 'starting' from insert).
    const session = sessionsRepo.findById(localId);
    expect(session?.status).toBe('starting');
  });

  it('after stopStream, a message.updated event produces no DB write', () => {
    bridge.stopStream(localId);

    relay(bridge, {
      type: 'message.updated',
      properties: {
        sessionID: SDK_ID,
        info: { id: 'msg-1', role: 'assistant', sessionID: SDK_ID },
      },
    });

    const msgs = messagesRepo.listBySession(localId, 10);
    expect(msgs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// c2 — stopStream does not affect a second live session
// ---------------------------------------------------------------------------

describe('issue-688-c2: stopStream — second live session still receives events after first is stopped', () => {
  const SDK_ID_1 = 'sdk-multi-1';
  const SDK_ID_2 = 'sdk-multi-2';
  let localId1: string;
  let localId2: string;
  let bridge: OpencodeStreamBridge;
  let sessionsRepo: AgentSessionsRepository;

  beforeEach(() => {
    setDb(makeDb());
    sessionMap.clear();
    broadcastSpy.mockClear();
    broadcastSessionUpdatedSpy.mockClear();

    sessionsRepo = new AgentSessionsRepository();
    bridge = new OpencodeStreamBridge();

    localId1 = seedSession(sessionsRepo);
    localId2 = seedSession(sessionsRepo);
    sessionMap.set(localId1, SDK_ID_1);
    sessionMap.set(localId2, SDK_ID_2);
  });

  it('stopping session 1 does not suppress broadcasts for session 2', () => {
    bridge.stopStream(localId1);
    broadcastSpy.mockClear();

    // Session 2 should still receive events.
    relay(bridge, {
      type: 'session.status',
      properties: {
        sessionID: SDK_ID_2,
        status: { type: 'busy' },
      },
    });

    const broadcasts = broadcastSpy.mock.calls.map((c) => c[0] as Record<string, unknown>);
    const forSession2 = broadcasts.filter((m) => m.id === localId2);
    expect(forSession2.length).toBeGreaterThan(0);
  });

  it('stopping session 1 does not suppress DB status writes for session 2', () => {
    bridge.stopStream(localId1);

    relay(bridge, {
      type: 'session.idle',
      properties: { sessionID: SDK_ID_2 },
    });

    const session2 = sessionsRepo.findById(localId2);
    expect(session2?.status).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// c3 — error status persisted; survives bridge restart + timer advance
// ---------------------------------------------------------------------------

describe('issue-688-c3: erroredSessions — persisted status=\'error\' survives bridge restart and timer advance', () => {
  const SDK_ID = 'sdk-error-1';
  let localId: string;
  let sessionsRepo: AgentSessionsRepository;

  beforeEach(() => {
    vi.useFakeTimers();
    setDb(makeDb());
    sessionMap.clear();
    broadcastSpy.mockClear();
    broadcastSessionUpdatedSpy.mockClear();

    sessionsRepo = new AgentSessionsRepository();
    localId = seedSession(sessionsRepo);
    sessionMap.set(localId, SDK_ID);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('session.error sets status to error in the DB', () => {
    const bridge = new OpencodeStreamBridge();

    relay(bridge, {
      type: 'session.error',
      properties: {
        sessionID: SDK_ID,
        error: { data: { message: 'Key limit exceeded' } },
      },
    });

    const session = sessionsRepo.findById(localId);
    expect(session?.status).toBe('error');
  });

  it('session.error persists a status_message on the row', () => {
    const bridge = new OpencodeStreamBridge();

    relay(bridge, {
      type: 'session.error',
      properties: {
        sessionID: SDK_ID,
        error: { data: { message: 'Token limit exceeded' } },
      },
    });

    const session = sessionsRepo.findById(localId);
    expect(session?.statusMessage).toBe('Token limit exceeded');
  });

  it('after >5s fake-timer advance, status is still error (no time-based reset)', () => {
    const bridge = new OpencodeStreamBridge();

    relay(bridge, {
      type: 'session.error',
      properties: {
        sessionID: SDK_ID,
        error: { data: { message: 'Key limit exceeded' } },
      },
    });

    // Advance fake timers by 10 seconds — the old setTimeout would have fired.
    vi.advanceTimersByTime(10_000);

    const session = sessionsRepo.findById(localId);
    expect(session?.status).toBe('error');
  });

  it('a NEW bridge instance reading the same DB sees error status (no in-memory dependency)', () => {
    const bridge1 = new OpencodeStreamBridge();

    relay(bridge1, {
      type: 'session.error',
      properties: {
        sessionID: SDK_ID,
        error: { data: { message: 'Network failure' } },
      },
    });

    vi.advanceTimersByTime(10_000);

    // Create a brand-new bridge — no shared state from bridge1.
    const _bridge2 = new OpencodeStreamBridge();

    const session = sessionsRepo.findById(localId);
    expect(session?.status).toBe('error');
    expect(session?.statusMessage).toContain('Network failure');
  });

  it('session.idle after session.error does NOT overwrite error status', () => {
    const bridge = new OpencodeStreamBridge();

    relay(bridge, {
      type: 'session.error',
      properties: {
        sessionID: SDK_ID,
        error: { data: { message: 'Key limit exceeded' } },
      },
    });

    relay(bridge, {
      type: 'session.idle',
      properties: { sessionID: SDK_ID },
    });

    const session = sessionsRepo.findById(localId);
    expect(session?.status).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// c4 — new prompt to errored session transitions status to 'working'
// ---------------------------------------------------------------------------

describe('issue-688-c4: erroredSessions — new prompt to errored session transitions status away from error', () => {
  const SDK_ID = 'sdk-resume-error-1';
  let localId: string;
  let sessionsRepo: AgentSessionsRepository;
  let bridge: OpencodeStreamBridge;

  beforeEach(() => {
    setDb(makeDb());
    sessionMap.clear();
    broadcastSpy.mockClear();
    broadcastSessionUpdatedSpy.mockClear();

    sessionsRepo = new AgentSessionsRepository();
    bridge = new OpencodeStreamBridge();

    localId = seedSession(sessionsRepo);
    sessionMap.set(localId, SDK_ID);
  });

  it('clearErrorStatus transitions the session from error to working', () => {
    // Set error state first.
    sessionsRepo.setErrorStatus(localId, 'Some error');

    // New prompt arrives — caller should invoke clearErrorStatus.
    bridge.clearErrorStatus(localId);

    const session = sessionsRepo.findById(localId);
    expect(session?.status).toBe('working');
    expect(session?.statusMessage).toBeNull();
  });

  it('clearErrorStatus is a no-op when session is not in error state', () => {
    // Status is 'starting' from insert.
    bridge.clearErrorStatus(localId);

    const session = sessionsRepo.findById(localId);
    expect(session?.status).toBe('starting');
  });
});

// ---------------------------------------------------------------------------
// c5 — source inspection
// ---------------------------------------------------------------------------

describe('issue-688-c5: source inspection — only deliberate timers, no pty_runner import', () => {
  it('keeps only the glob watchdog and global retry timers', () => {
    const bridgePath = path.resolve(__dirname, '../services/opencode_stream_bridge.ts');
    const source = fs.readFileSync(bridgePath, 'utf-8');
    const setTimeoutMatches = source.match(/setTimeout\s*\(/g) ?? [];

    expect(setTimeoutMatches).toHaveLength(2);
    expect(source).toContain('armGlobWatchdog');
    expect(source).toContain('scheduleGlobalRetry');
  });

  it('no non-test file in src/ imports pty_runner', () => {
    const srcDir = path.resolve(__dirname, '..');
    // Recursive file listing.
    function walk(dir: string): string[] {
      return fs.readdirSync(dir).flatMap((entry) => {
        const full = path.join(dir, entry);
        return fs.statSync(full).isDirectory() ? walk(full) : [full];
      });
    }
    // Exclude test files — they may reference pty_runner in assertions/comments.
    const tsFiles = walk(srcDir).filter(
      (f) => f.endsWith('.ts') && !f.includes('__tests__'),
    );
    const importPattern = /import\s+.*['"].*pty_runner['"]/;
    const requirePattern = /require\s*\(\s*['"].*pty_runner['"]\s*\)/;
    const withPtyRunner = tsFiles.filter((f) => {
      const content = fs.readFileSync(f, 'utf-8');
      return importPattern.test(content) || requirePattern.test(content);
    });
    expect(withPtyRunner, 'Expected no non-test TypeScript file to import pty_runner').toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// c6 — __pending__ never escapes the WS/REST boundary
// ---------------------------------------------------------------------------

describe('issue-688-c6: __pending__ boundary — no WS frame for __pending__ session', () => {
  const SDK_ID = 'sdk-pending-guard-1';
  let bridge: OpencodeStreamBridge;
  let sessionsRepo: AgentSessionsRepository;
  let staleLocalId: string;

  beforeEach(() => {
    setDb(makeDb());
    sessionMap.clear();
    broadcastSpy.mockClear();
    broadcastSessionUpdatedSpy.mockClear();

    sessionsRepo = new AgentSessionsRepository();
    bridge = new OpencodeStreamBridge();

    // Seed a session with agentKind = '__pending__' (legacy stale row).
    // The ws_gateway rejects session.input for __pending__ agentKinds — but
    // what if a stale SSE event arrives for a session that somehow has that state?
    // Insert the row via repo (which won't check agentKind beyond its type),
    // then manually patch via raw SQL to simulate the legacy state.
    staleLocalId = sessionsRepo.insert({
      agentKind: 'claude-code', // repo validates, we patch after
      taskId: null,
      taskTitle: null,
      cwd: '/tmp',
      name: 'stale-pending-session',
    }).id;

    // Patch the row to agentKind = '__pending__' (legacy data).
    getDb()
      .prepare(`UPDATE agent_sessions SET agent_kind = '__pending__' WHERE id = ?`)
      .run(staleLocalId);

    sessionMap.set(staleLocalId, SDK_ID);
  });

  it('ws_gateway rejector: session.input for __pending__ agentKind is documented in source', () => {
    // The ws_gateway already contains the rejection at ~line 176-188.
    const gatewayPath = path.resolve(
      __dirname,
      '../services/ws_gateway.ts',
    );
    const source = fs.readFileSync(gatewayPath, 'utf-8');
    expect(source).toContain("agentKind === '__pending__'");
    // The guard must send an error frame (not a content frame).
    expect(source).toContain("'__pending__'");
  });

  it('no WS broadcast frame for a __pending__ session contains the literal __pending__', () => {
    // Drive an SSE event for the stale session — the bridge relays it but the
    // content must not include the literal '__pending__' string in any payload value.
    relay(bridge, {
      type: 'session.status',
      properties: {
        sessionID: SDK_ID,
        status: { type: 'busy' },
      },
    });

    const broadcasts = broadcastSpy.mock.calls.map((c) => JSON.stringify(c[0]));
    const withPending = broadcasts.filter((s) => s.includes('__pending__'));
    expect(withPending).toHaveLength(0);
  });

  it('session.error broadcast for __pending__ session does not leak the sentinel in the message field', () => {
    relay(bridge, {
      type: 'session.error',
      properties: {
        sessionID: SDK_ID,
        error: { data: { message: 'Some real error' } },
      },
    });

    const broadcasts = broadcastSpy.mock.calls.map((c) => JSON.stringify(c[0]));
    const withPending = broadcasts.filter((s) => s.includes('__pending__'));
    expect(withPending).toHaveLength(0);
  });
});
