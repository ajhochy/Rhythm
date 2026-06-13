/**
 * OPC-M2-4 Retry status surfacing + token/cost display — bridge-side contract.
 * Issue #693, criterion c1.
 *
 * c1 — Bridge maps a real-shape retry status event (SessionStatus.type='retry')
 *      to a WS frame with status `retrying` (NOT `idle`).
 *      Regression: idle and busy mappings remain unchanged.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';

import retryFixture from './fixtures/opencode_v1_14_49/session_status_retry.json';
import idleFixture from './fixtures/opencode_v1_14_49/session_status_idle.json';
import busyFixture from './fixtures/opencode_v1_14_49/session_status_busy.json';

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
  setDb(db);
  return db;
}

function relay(bridge: OpencodeStreamBridge, event: Record<string, unknown>): void {
  (bridge as unknown as { _relayEvent: (e: unknown) => void })._relayEvent(event);
}

function seedSessionWithMap(
  sessionsRepo: AgentSessionsRepository,
  sdkId: string,
): string {
  const session = sessionsRepo.insert({
    agentKind: 'claude-code',
    taskId: null,
    taskTitle: null,
    cwd: '/tmp',
    name: 'test',
  });
  sessionMap.set(session.id, sdkId);
  return session.id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('issue-693-c1: retry / idle / busy WS status mapping', () => {
  let sessionsRepo: AgentSessionsRepository;
  let messagesRepo: AgentSessionMessagesRepository;
  let bridge: OpencodeStreamBridge;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionMap.clear();
    const db = makeDb();
    sessionsRepo = new AgentSessionsRepository();
    messagesRepo = new AgentSessionMessagesRepository();
    // Satisfy TypeScript — repos use getDb() internally.
    void db;
    bridge = new OpencodeStreamBridge();
  });

  it('issue-693-c1: retry status event maps to WS frame with status retrying (not idle); idle/busy regression', () => {
    const sdkId = retryFixture.properties.sessionID;
    const localId = seedSessionWithMap(sessionsRepo, sdkId);

    // --- RETRY: must emit status='retrying', NOT 'idle' ---
    relay(bridge, retryFixture as unknown as Record<string, unknown>);

    const retryCalls = broadcastSpy.mock.calls.filter(
      (c: unknown[]) => (c[0] as { type: string }).type === 'session.status',
    );
    expect(retryCalls).toHaveLength(1);
    const retryFrame = retryCalls[0][0] as Record<string, unknown>;
    expect(retryFrame.id).toBe(localId);
    // MUST NOT be 'idle' — this is the core criterion.
    expect(retryFrame.status).not.toBe('idle');
    expect(retryFrame.status).toBe('retrying');
    // attempt + reason must be forwarded.
    expect(retryFrame.attempt).toBe(2);
    expect(retryFrame.reason).toBe('Rate limit exceeded. Retrying in 5s.');

    broadcastSpy.mockClear();

    // --- IDLE regression: must emit working=false, status='idle' ---
    relay(bridge, idleFixture as unknown as Record<string, unknown>);

    const idleCalls = broadcastSpy.mock.calls.filter(
      (c: unknown[]) => (c[0] as { type: string }).type === 'session.status',
    );
    expect(idleCalls.length).toBeGreaterThanOrEqual(1);
    const idleFrame = idleCalls[0][0] as Record<string, unknown>;
    expect(idleFrame.id).toBe(localId);
    expect(idleFrame.working).toBe(false);
    expect(idleFrame.status).toBe('idle');

    broadcastSpy.mockClear();

    // --- BUSY regression: must emit working=true, status='busy' ---
    relay(bridge, busyFixture as unknown as Record<string, unknown>);

    const busyCalls = broadcastSpy.mock.calls.filter(
      (c: unknown[]) => (c[0] as { type: string }).type === 'session.status',
    );
    expect(busyCalls.length).toBeGreaterThanOrEqual(1);
    const busyFrame = busyCalls[0][0] as Record<string, unknown>;
    expect(busyFrame.id).toBe(localId);
    expect(busyFrame.working).toBe(true);
    expect(busyFrame.status).toBe('busy');
  });
});
