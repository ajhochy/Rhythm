/**
 * Acceptance-contract tests for issue #636
 * "OpenRouter Gemini 3 Flash silent-close"
 *
 * Bug: when `session.idle` fires with ZERO `message.part.delta` frames since
 * the last user input the bridge only broadcasts `{type:'session.status',
 * working:false}`.  The Flutter client has no way to tell the user the model
 * produced nothing — it just silently stops the spinner.
 *
 * Fix contract: the bridge MUST also broadcast an `{v:1, type:'error', id,
 * message}` frame whenever idle arrives with an empty pendingText buffer.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be established before the import of the bridge.
// ---------------------------------------------------------------------------

const { broadcastSpy, sessionMap } = vi.hoisted(() => ({
  broadcastSpy: vi.fn(),
  sessionMap: new Map<string, string>(),
}));

vi.mock('../services/ws_gateway', () => ({
  broadcast: (msg: unknown) => broadcastSpy(msg),
  broadcastSessionUpdated: vi.fn(),
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

function relayOn(bridge: OpencodeStreamBridge) {
  return (event: Record<string, unknown>): void => {
    (bridge as unknown as { _relayEvent: (e: unknown) => void })._relayEvent(
      event,
    );
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('OpencodeStreamBridge — issue #636 silent-close contract', () => {
  let bridge: OpencodeStreamBridge;
  let relay: (event: Record<string, unknown>) => void;
  const SDK_ID = 'sdk-636-1';
  let localId: string;

  beforeEach(() => {
    setDb(makeDb());
    sessionMap.clear();
    broadcastSpy.mockClear();

    bridge = new OpencodeStreamBridge();
    relay = relayOn(bridge);

    // Seed a real agent-session row so updateStatus / updatePreview don't throw.
    const repo = new AgentSessionsRepository();
    repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: '/tmp',
      name: 'issue-636-test',
    });
    localId = repo.listActive()[0].id;
    sessionMap.set(localId, SDK_ID);
  });

  // -------------------------------------------------------------------------
  // c1 — zero tokens → error frame must be broadcast
  // -------------------------------------------------------------------------

  it('issue-636-c1: session.idle with zero tokens broadcasts an error frame', () => {
    // Emit session.created so the bridge registers the session.
    relay({
      type: 'session.created',
      properties: { sessionID: SDK_ID },
    });

    // No message.part.delta — simulate a silent/empty model turn.

    relay({
      type: 'session.idle',
      properties: { sessionID: SDK_ID },
    });

    const allMessages = broadcastSpy.mock.calls.map(
      (c) => c[0] as Record<string, unknown>,
    );

    const errorFrame = allMessages.find((m) => m.type === 'error');

    // THE FAILING ASSERTION BEFORE THE FIX:
    // The bridge currently broadcasts only session.status — no error frame.
    expect(errorFrame).toBeDefined();
    expect(typeof errorFrame?.message).toBe('string');
    expect((errorFrame?.message as string).length).toBeGreaterThan(0);
    expect(errorFrame?.id).toBe(localId);
    expect(errorFrame?.v).toBe(1);
  });

  // -------------------------------------------------------------------------
  // c1-regression — tokens present → NO error frame
  // -------------------------------------------------------------------------

  it('issue-636-c1-regression: session.idle after tokens — no error frame', () => {
    relay({
      type: 'session.created',
      properties: { sessionID: SDK_ID },
    });

    // Simulate a normal turn with token output.
    relay({
      type: 'message.part.delta',
      properties: {
        part: { sessionID: SDK_ID },
        delta: 'Here is the answer.',
        field: 'text',
      },
    });

    relay({
      type: 'session.idle',
      properties: { sessionID: SDK_ID },
    });

    const allMessages = broadcastSpy.mock.calls.map(
      (c) => c[0] as Record<string, unknown>,
    );

    const errorFrame = allMessages.find((m) => m.type === 'error');

    // Normal completions must NOT trigger an error frame.
    expect(errorFrame).toBeUndefined();
  });
});
