/**
 * OPC-M3-4 — Slash commands dispatched via session.command WS frame.
 * Issue #697, criterion c1.
 *
 * Transport choice: WS `session.command` frame — follows the existing
 * `session.input` / `session.resize` WS handler pattern in ws_gateway.ts.
 * A REST route would require a round-trip outside the live WS connection and
 * would not match the fire-and-forget model used by promptAsync; the WS frame
 * keeps command dispatch on the same channel as text input.
 *
 * c1a — a `session.command` frame {id, command, arguments} invokes
 *        opencodeClient.dispatchCommand(sdkId, command, arguments) exactly once.
 * c1b — unknown local id (no DB row) → WS error frame sent back to the client.
 * c1c — known local id but no SDK mapping → WS error frame sent back.
 *
 * Run with:
 *   cd apps/api_server && npx vitest run src/__tests__/opc_m3_4_command_dispatch.test.ts
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import os from 'os';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

// ---------------------------------------------------------------------------
// Shared mocks (hoisted so vi.mock factories can use them)
// ---------------------------------------------------------------------------

const {
  dispatchCommandSpy,
  sessionMap,
  wsSendMock,
} = vi.hoisted(() => ({
  dispatchCommandSpy: vi.fn(),
  sessionMap: new Map<string, string>(),
  wsSendMock: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    dispatchCommand: dispatchCommandSpy,
    createSession: vi.fn().mockResolvedValue(null),
    getSession: vi.fn().mockResolvedValue(null),
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    promptAsync: vi.fn().mockResolvedValue(false),
  },
  opencodeSessionMap: sessionMap,
}));

vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: {
    streamSession: vi.fn(),
    stopStream: vi.fn(),
    clearErrorStatus: vi.fn(),
    getPendingPermission: vi.fn(),
    clearPendingPermission: vi.fn(),
  },
}));

// NOTE: do NOT mock ws_gateway here — handleCommandFrame IS the system under test.

// ---------------------------------------------------------------------------
// Import the gateway handler under test (after mocks are set up)
// ---------------------------------------------------------------------------

import { handleCommandFrame } from '../services/ws_gateway';

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

function makeFakeWs() {
  return { send: wsSendMock, readyState: 1 /* OPEN */ } as unknown as import('ws').WebSocket;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('issue-697-c1: session.command WS frame contracts', () => {
  let sessionsRepo: AgentSessionsRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionMap.clear();
    const db = makeDb();
    void db;
    sessionsRepo = new AgentSessionsRepository();
  });

  // ── c1a: happy path ────────────────────────────────────────────────────────

  it('issue-697-c1a: session.command dispatches dispatchCommand(sdkId, command, args)', async () => {
    const sdkId = 'sdk-cmd-test-abc';
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'CommandTest',
    });
    sessionMap.set(session.id, sdkId);

    const mockResult = {
      info: { id: 'msg-1', sessionID: sdkId, role: 'assistant' },
      parts: [],
    };
    dispatchCommandSpy.mockResolvedValueOnce(mockResult);

    const ws = makeFakeWs();
    await handleCommandFrame(ws, {
      v: 1,
      type: 'session.command',
      id: session.id,
      command: 'help',
      arguments: '',
    });

    expect(dispatchCommandSpy).toHaveBeenCalledOnce();
    expect(dispatchCommandSpy).toHaveBeenCalledWith(sdkId, 'help', '');
    // No WS error should be sent.
    const errorCalls = (wsSendMock as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => JSON.parse(c[0] as string) as { type: string })
      .filter((m) => m.type === 'error');
    expect(errorCalls).toHaveLength(0);
  });

  // ── c1b: unknown local id (no DB row) ─────────────────────────────────────

  it('issue-697-c1b: session.command for unknown local id sends WS error frame', async () => {
    const ws = makeFakeWs();
    await handleCommandFrame(ws, {
      v: 1,
      type: 'session.command',
      id: 'nonexistent-session-id',
      command: 'help',
      arguments: '',
    });

    expect(dispatchCommandSpy).not.toHaveBeenCalled();
    expect(wsSendMock).toHaveBeenCalledOnce();
    const sent = JSON.parse((wsSendMock as ReturnType<typeof vi.fn>).mock.calls[0][0] as string) as {
      type: string;
      id: string;
    };
    expect(sent.type).toBe('error');
    expect(sent.id).toBe('nonexistent-session-id');
  });

  // ── c1c: known session but no SDK mapping ─────────────────────────────────

  it('issue-697-c1c: session.command with no SDK mapping sends WS error frame', async () => {
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'NoMapCommand',
    });
    // sessionMap intentionally empty — no SDK mapping for this session.

    const ws = makeFakeWs();
    await handleCommandFrame(ws, {
      v: 1,
      type: 'session.command',
      id: session.id,
      command: 'help',
      arguments: '',
    });

    expect(dispatchCommandSpy).not.toHaveBeenCalled();
    expect(wsSendMock).toHaveBeenCalledOnce();
    const sent = JSON.parse((wsSendMock as ReturnType<typeof vi.fn>).mock.calls[0][0] as string) as {
      type: string;
      id: string;
    };
    expect(sent.type).toBe('error');
    expect(sent.id).toBe(session.id);
  });
});
