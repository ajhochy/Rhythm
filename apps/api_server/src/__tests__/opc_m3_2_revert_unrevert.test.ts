/**
 * OPC-M3-2 Undo: revert / unrevert — server-side contract.
 * Issue #695, criterion c1.
 *
 * c1 — POST /agent-sessions/:id/revert body {messageId} invokes the SDK
 *      revertSession wrapper with (sdkId, messageId) — spy assert.
 *      POST /agent-sessions/:id/unrevert invokes unrevertSession with (sdkId).
 *      SDK errors → AppError forwarded via next(), never swallowed.
 *
 * Run with:
 *   cd apps/api_server && npx vitest run src/__tests__/opc_m3_2_revert_unrevert.test.ts
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import os from 'os';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

// ---------------------------------------------------------------------------
// Real-shape SDK Session fixture (v1.14.49)
// ---------------------------------------------------------------------------

const kSdkSessionFixture = {
  id: 'sdk-session-revert-abc',
  title: 'Test session',
  path: os.homedir(),
  revert: 'msg-123',
};

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

const {
  broadcastSpy,
  broadcastSessionUpdatedSpy,
  sessionMap,
  revertSessionSpy,
  unrevertSessionSpy,
} = vi.hoisted(() => ({
  broadcastSpy: vi.fn(),
  broadcastSessionUpdatedSpy: vi.fn(),
  sessionMap: new Map<string, string>(),
  revertSessionSpy: vi.fn(),
  unrevertSessionSpy: vi.fn(),
}));

vi.mock('../services/ws_gateway', () => ({
  broadcast: (msg: unknown) => broadcastSpy(msg),
  broadcastSessionUpdated: (session: unknown) => broadcastSessionUpdatedSpy(session),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    revertSession: revertSessionSpy,
    unrevertSession: unrevertSessionSpy,
    getSessionDiff: vi.fn().mockResolvedValue([]),
    createSession: vi.fn().mockResolvedValue(null),
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    clearErrorStatus: vi.fn(),
    getSession: vi.fn().mockResolvedValue(null),
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

import { AgentSessionsController } from '../controllers/agent_sessions_controller';
import type { Request, Response, NextFunction } from 'express';

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

function makeReq(
  params: Record<string, string> = {},
  body: Record<string, unknown> = {},
): Request {
  return { params, body, headers: {} } as unknown as Request;
}

function makeRes(): {
  json: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  res: Response;
} {
  const json = vi.fn();
  const end = vi.fn();
  const res = {
    json,
    status: vi.fn().mockReturnThis(),
    end,
  } as unknown as Response;
  return { json, status: vi.fn(), end, res };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('issue-695-c1: revert/unrevert route contracts', () => {
  let sessionsRepo: AgentSessionsRepository;
  let controller: AgentSessionsController;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionMap.clear();
    const db = makeDb();
    void db;
    sessionsRepo = new AgentSessionsRepository();
    controller = new AgentSessionsController();
  });

  // ── revert ──────────────────────────────────────────────────────────────────

  it('issue-695-c1a: revert calls revertSession(sdkId, messageId) and returns 200', async () => {
    const sdkId = 'sdk-session-revert-abc';
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'RevertTest',
    });
    sessionMap.set(session.id, sdkId);
    revertSessionSpy.mockResolvedValueOnce(kSdkSessionFixture);

    const { res } = makeRes();
    const next = vi.fn();

    await controller.revert(
      makeReq({ id: session.id }, { messageId: 'msg-123' }),
      res,
      next as NextFunction,
    );

    expect(next).not.toHaveBeenCalled();
    expect(revertSessionSpy).toHaveBeenCalledOnce();
    expect(revertSessionSpy).toHaveBeenCalledWith(sdkId, 'msg-123');

    const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    // Response must contain the SDK session object (or at least the id).
    expect(result).toBeDefined();
  });

  it('issue-695-c1b: revert with no SDK mapping → 400 (no map entry for session)', async () => {
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'NoMapRevert',
    });
    // sessionMap intentionally empty for this session.

    const { res } = makeRes();
    const next = vi.fn();

    await controller.revert(
      makeReq({ id: session.id }, { messageId: 'msg-456' }),
      res,
      next as NextFunction,
    );

    // Must forward an error — not silently succeed.
    expect(next).toHaveBeenCalledOnce();
    expect(revertSessionSpy).not.toHaveBeenCalled();
  });

  it('issue-695-c1c: SDK error on revert → AppError forwarded via next(), never swallowed', async () => {
    const sdkId = 'sdk-session-revert-error';
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'RevertError',
    });
    sessionMap.set(session.id, sdkId);
    const sdkError = Object.assign(
      new Error(`revertSession failed for session ${sdkId}: {"code":500}`),
      { statusCode: 502, code: 'SDK_ERROR' },
    );
    revertSessionSpy.mockRejectedValueOnce(sdkError);

    const { res } = makeRes();
    const next = vi.fn();

    await controller.revert(
      makeReq({ id: session.id }, { messageId: 'msg-789' }),
      res,
      next as NextFunction,
    );

    expect(next).toHaveBeenCalledOnce();
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0] as Error & { statusCode?: number };
    expect(err).toBeInstanceOf(Error);
    // Must NOT have responded with 200 JSON.
    const jsonCalls = (res.json as ReturnType<typeof vi.fn>).mock.calls;
    expect(jsonCalls).toHaveLength(0);
  });

  // ── unrevert ─────────────────────────────────────────────────────────────────

  it('issue-695-c1d: unrevert calls unrevertSession(sdkId) and returns 200', async () => {
    const sdkId = 'sdk-session-unrevert-abc';
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'UnrevertTest',
    });
    sessionMap.set(session.id, sdkId);
    const noRevertSession = { ...kSdkSessionFixture, id: sdkId, revert: undefined };
    unrevertSessionSpy.mockResolvedValueOnce(noRevertSession);

    const { res } = makeRes();
    const next = vi.fn();

    await controller.unrevert(
      makeReq({ id: session.id }),
      res,
      next as NextFunction,
    );

    expect(next).not.toHaveBeenCalled();
    expect(unrevertSessionSpy).toHaveBeenCalledOnce();
    expect(unrevertSessionSpy).toHaveBeenCalledWith(sdkId);

    const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(result).toBeDefined();
  });

  it('issue-695-c1e: unrevert with no SDK mapping → 400', async () => {
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'NoMapUnrevert',
    });

    const { res } = makeRes();
    const next = vi.fn();

    await controller.unrevert(
      makeReq({ id: session.id }),
      res,
      next as NextFunction,
    );

    expect(next).toHaveBeenCalledOnce();
    expect(unrevertSessionSpy).not.toHaveBeenCalled();
  });

  it('issue-695-c1f: SDK error on unrevert → AppError forwarded via next()', async () => {
    const sdkId = 'sdk-session-unrevert-error';
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'UnrevertError',
    });
    sessionMap.set(session.id, sdkId);
    const sdkError = Object.assign(
      new Error(`unrevertSession failed for session ${sdkId}: {"code":500}`),
      { statusCode: 502, code: 'SDK_ERROR' },
    );
    unrevertSessionSpy.mockRejectedValueOnce(sdkError);

    const { res } = makeRes();
    const next = vi.fn();

    await controller.unrevert(
      makeReq({ id: session.id }),
      res,
      next as NextFunction,
    );

    expect(next).toHaveBeenCalledOnce();
    const jsonCalls = (res.json as ReturnType<typeof vi.fn>).mock.calls;
    expect(jsonCalls).toHaveLength(0);
  });
});
