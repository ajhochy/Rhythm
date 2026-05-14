import { vi, describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

const { broadcastSpy, sessionMap } = vi.hoisted(() => ({
  broadcastSpy: vi.fn(),
  sessionMap: new Map<string, string>(),
}));

vi.mock('../services/ws_gateway', () => ({
  broadcast: (msg: unknown) => broadcastSpy(msg),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    subscribeToEvents: vi.fn().mockResolvedValue(null),
  },
  opencodeSessionMap: sessionMap,
}));

import { OpencodeStreamBridge } from '../services/opencode_stream_bridge';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('OpencodeStreamBridge — transcript.append emission', () => {
  let bridge: OpencodeStreamBridge;
  const LOCAL_ID = 'local-session-1';
  const SDK_ID = 'sdk-session-1';

  beforeEach(() => {
    setDb(makeDb());
    sessionMap.clear();
    sessionMap.set(LOCAL_ID, SDK_ID);
    broadcastSpy.mockClear();
    bridge = new OpencodeStreamBridge();

    // Seed an agent session row so updateStatus/updatePreview don't throw.
    const repo = new AgentSessionsRepository();
    repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: '/tmp',
      name: 'test',
    });
    // The repo generates its own id; overwrite our local handle via raw SQL
    // is overkill — instead reuse the inserted row's id by querying.
    const inserted = repo.listActive()[0];
    sessionMap.set(inserted.id, SDK_ID);
  });

  function relay(event: Record<string, unknown>): void {
    (bridge as unknown as {
      _relayEvent: (e: unknown) => void;
    })._relayEvent(event);
  }

  it('on session.idle broadcasts transcript.append with accumulated text', () => {
    const localId = sessionMap.keys().next().value as string;
    // Re-target sessionMap so only the seeded session participates.
    sessionMap.clear();
    sessionMap.set(localId, SDK_ID);

    relay({
      type: 'message.part.delta',
      properties: {
        part: { sessionID: SDK_ID },
        delta: 'Hello, ',
        field: 'text',
      },
    });
    relay({
      type: 'message.part.delta',
      properties: {
        part: { sessionID: SDK_ID },
        delta: 'world!',
        field: 'text',
      },
    });
    relay({
      type: 'session.idle',
      properties: { sessionID: SDK_ID },
    });

    const transcriptAppend = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((m) => m.type === 'transcript.append');
    expect(transcriptAppend).toBeDefined();
    expect(transcriptAppend?.id).toBe(localId);
    expect(transcriptAppend?.role).toBe('output');
    expect(transcriptAppend?.text).toBe('Hello, world!');
  });

  it('on session.error with partial text flushes a transcript.append before the error frame', () => {
    const localId = sessionMap.keys().next().value as string;
    sessionMap.clear();
    sessionMap.set(localId, SDK_ID);

    relay({
      type: 'message.part.delta',
      properties: {
        part: { sessionID: SDK_ID },
        delta: 'partial answer',
        field: 'text',
      },
    });
    relay({
      type: 'session.error',
      properties: {
        sessionID: SDK_ID,
        error: { data: { message: 'Key limit exceeded' } },
      },
    });

    const types = broadcastSpy.mock.calls.map(
      (c) => (c[0] as Record<string, unknown>).type,
    );
    const appendIdx = types.indexOf('transcript.append');
    const errorIdx = types.indexOf('error');
    expect(appendIdx).toBeGreaterThanOrEqual(0);
    expect(errorIdx).toBeGreaterThan(appendIdx);

    const partial = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((m) => m.type === 'transcript.append');
    expect(partial?.text).toBe('partial answer');
  });

  it('on session.idle with empty buffer does NOT broadcast transcript.append', () => {
    const localId = sessionMap.keys().next().value as string;
    sessionMap.clear();
    sessionMap.set(localId, SDK_ID);

    relay({
      type: 'session.idle',
      properties: { sessionID: SDK_ID },
    });

    const transcriptAppend = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((m) => m.type === 'transcript.append');
    expect(transcriptAppend).toBeUndefined();
  });
});
