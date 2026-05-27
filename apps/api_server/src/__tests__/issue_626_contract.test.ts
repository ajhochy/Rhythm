/**
 * Acceptance-contract / regression tests for issue #626
 * "emit session.updated on opencode stream bridge status transitions"
 *
 * Contract: after the bridge persists a status transition via
 * `sessionsRepo.updateStatus(...)`, it MUST call `broadcastSessionUpdated`
 * with the refreshed session row so connected WS clients see the chip flip
 * idle → working → idle without a REST poll.
 *
 * This behaviour landed with the #605 WS-events work (commit 163c7a6); these
 * tests lock it in so the broadcast cannot be silently dropped from the
 * bridge again.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be established before the import of the bridge.
// ---------------------------------------------------------------------------

const { broadcastSpy, sessionUpdatedSpy, sessionMap } = vi.hoisted(() => ({
  broadcastSpy: vi.fn(),
  sessionUpdatedSpy: vi.fn(),
  sessionMap: new Map<string, string>(),
}));

vi.mock('../services/ws_gateway', () => ({
  broadcast: (msg: unknown) => broadcastSpy(msg),
  broadcastSessionUpdated: (session: unknown) => sessionUpdatedSpy(session),
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

describe('OpencodeStreamBridge — issue #626 session.updated broadcast contract', () => {
  let bridge: OpencodeStreamBridge;
  let relay: (event: Record<string, unknown>) => void;
  const SDK_ID = 'sdk-626-1';
  let localId: string;

  beforeEach(() => {
    setDb(makeDb());
    sessionMap.clear();
    broadcastSpy.mockClear();
    sessionUpdatedSpy.mockClear();

    bridge = new OpencodeStreamBridge();
    relay = relayOn(bridge);

    const repo = new AgentSessionsRepository();
    repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: '/tmp',
      name: 'issue-626-test',
    });
    localId = repo.listActive()[0].id;
    sessionMap.set(localId, SDK_ID);
  });

  // -------------------------------------------------------------------------
  // c1 — busy status transition broadcasts the refreshed session
  // -------------------------------------------------------------------------

  it('issue-626-c1: session.status busy broadcasts session.updated with status working', () => {
    relay({ type: 'session.created', properties: { sessionID: SDK_ID } });
    sessionUpdatedSpy.mockClear();

    relay({
      type: 'session.status',
      properties: { sessionID: SDK_ID, status: { type: 'busy' } },
    });

    expect(sessionUpdatedSpy).toHaveBeenCalled();
    const session = sessionUpdatedSpy.mock.calls.at(-1)?.[0] as {
      id: string;
      status: string;
    };
    expect(session.id).toBe(localId);
    expect(session.status).toBe('working');
  });

  // -------------------------------------------------------------------------
  // c2 — idle transition broadcasts the refreshed session
  // -------------------------------------------------------------------------

  it('issue-626-c2: session.idle broadcasts session.updated with status idle', () => {
    relay({ type: 'session.created', properties: { sessionID: SDK_ID } });
    sessionUpdatedSpy.mockClear();

    relay({ type: 'session.idle', properties: { sessionID: SDK_ID } });

    expect(sessionUpdatedSpy).toHaveBeenCalled();
    const session = sessionUpdatedSpy.mock.calls.at(-1)?.[0] as {
      id: string;
      status: string;
    };
    expect(session.id).toBe(localId);
    expect(session.status).toBe('idle');
  });
});
