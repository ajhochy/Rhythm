/**
 * Issue #720 — Compaction divider doesn't render (bridge ignores
 * `session.compacted` event).
 *
 * opencode 1.14.40 signals compaction completion with a `session.compacted`
 * event ({ properties: { sessionID } }), NOT a live `compaction` message-part.
 * The bridge had no handler, so it fell through to the generic `event` relay
 * and the Flutter client never got a signal to clear the compacting spinner +
 * rehydrate the session so the persisted CompactionPart renders as the divider.
 *
 * Acceptance (from #720): after a compaction, the bridge relays a
 * `session.compacted` WS frame carrying the local session id; existing
 * message/part relay is unaffected.
 *
 * RED proof: no `case 'session.compacted'` exists in _relayEvent, so the event
 * is relayed as the generic `{ type: 'event', eventType: 'session.compacted' }`
 * frame — there is NO `{ type: 'session.compacted', id }` frame to find.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

// ---------------------------------------------------------------------------
// Shared mocks (same harness as opc_m3_5_todo_panel.test.ts)
// ---------------------------------------------------------------------------

const { broadcastSpy, broadcastSessionUpdatedSpy, sessionMap } = vi.hoisted(
  () => ({
    broadcastSpy: vi.fn(),
    broadcastSessionUpdatedSpy: vi.fn(),
    sessionMap: new Map<string, string>(),
  }),
);

vi.mock('../services/ws_gateway', () => ({
  broadcast: (msg: unknown) => broadcastSpy(msg),
  broadcastSessionUpdated: (session: unknown) =>
    broadcastSessionUpdatedSpy(session),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    createSession: vi.fn().mockResolvedValue(null),
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    clearErrorStatus: vi.fn(),
    getSession: vi.fn().mockResolvedValue(null),
    promptAsync: vi.fn().mockResolvedValue(false),
  },
  opencodeSessionMap: sessionMap,
}));

import os from 'os';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  return db;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('issue-720: bridge relays session.compacted SSE event as a WS frame', () => {
  let sessionsRepo: AgentSessionsRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionMap.clear();
    makeDb();
    sessionsRepo = new AgentSessionsRepository();
  });

  it('issue-720a: session.compacted is relayed with type=session.compacted and the LOCAL session id', async () => {
    const { OpencodeStreamBridge } = await import(
      '../services/opencode_stream_bridge'
    );
    const bridge = new OpencodeStreamBridge();

    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'CompactRelay',
    });
    const sdkId = 'sdk-compact-relay-001';
    sessionMap.set(session.id, sdkId);

    (bridge as unknown as { _relayEvent(e: unknown): void })._relayEvent({
      type: 'session.compacted',
      properties: { sessionID: sdkId },
    });

    const calls = broadcastSpy.mock.calls as [Record<string, unknown>][];
    const frame = calls.find((c) => c[0]?.type === 'session.compacted');
    expect(frame).toBeDefined();
    expect(frame![0].id).toBe(session.id);
    // It must NOT fall through to the generic relay.
    const generic = calls.find(
      (c) =>
        c[0]?.type === 'event' &&
        (c[0] as Record<string, unknown>).eventType === 'session.compacted',
    );
    expect(generic).toBeUndefined();
  });

  it('issue-720b: session.compacted for an unknown session still broadcasts with sdkId as fallback id', async () => {
    const { OpencodeStreamBridge } = await import(
      '../services/opencode_stream_bridge'
    );
    const bridge = new OpencodeStreamBridge();

    const unknownSdkId = 'sdk-unknown-compact-xyz';
    // No entry in sessionMap for this SDK id.

    (bridge as unknown as { _relayEvent(e: unknown): void })._relayEvent({
      type: 'session.compacted',
      properties: { sessionID: unknownSdkId },
    });

    const calls = broadcastSpy.mock.calls as [Record<string, unknown>][];
    const frame = calls.find((c) => c[0]?.type === 'session.compacted');
    expect(frame).toBeDefined();
    expect(frame![0].id).toBe(unknownSdkId);
  });

  it('issue-720c: existing message.part.updated relay is unaffected by the new case', async () => {
    const { OpencodeStreamBridge } = await import(
      '../services/opencode_stream_bridge'
    );
    const bridge = new OpencodeStreamBridge();

    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'PartRelay',
    });
    const sdkId = 'sdk-part-relay-002';
    sessionMap.set(session.id, sdkId);

    (bridge as unknown as { _relayEvent(e: unknown): void })._relayEvent({
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'prt_1',
          messageID: 'msg_1',
          sessionID: sdkId,
          type: 'text',
          text: 'hello',
        },
      },
    });

    const calls = broadcastSpy.mock.calls as [Record<string, unknown>][];
    const partFrame = calls.find((c) => c[0]?.type === 'message.part.updated');
    expect(partFrame).toBeDefined();
    expect(partFrame![0].id).toBe(session.id);
  });
});
