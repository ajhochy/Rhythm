/**
 * OPC-M3-3 Compaction (summarize) — server-side contract.
 * Issue #696, criterion c1.
 *
 * c1 — POST /agent-sessions/:id/summarize invokes the SDK summarize wrapper
 *      with the mapped sdk id (spy assert); errors surface as AppError via
 *      next(), never swallowed.
 *
 * Run with:
 *   cd apps/api_server && npx vitest run src/__tests__/opc_m3_3_compaction.test.ts
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import os from 'os';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

const {
  broadcastSpy,
  broadcastSessionUpdatedSpy,
  sessionMap,
  summarizeSessionSpy,
} = vi.hoisted(() => ({
  broadcastSpy: vi.fn(),
  broadcastSessionUpdatedSpy: vi.fn(),
  sessionMap: new Map<string, string>(),
  summarizeSessionSpy: vi.fn(),
}));

vi.mock('../services/ws_gateway', () => ({
  broadcast: (msg: unknown) => broadcastSpy(msg),
  broadcastSessionUpdated: (session: unknown) => broadcastSessionUpdatedSpy(session),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    summarizeSession: summarizeSessionSpy,
    revertSession: vi.fn().mockResolvedValue(null),
    unrevertSession: vi.fn().mockResolvedValue(null),
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

describe('issue-696-c1: summarize route contracts', () => {
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

  // ── c1a: happy path ────────────────────────────────────────────────────────

  it('issue-696-c1a: summarize calls summarizeSession(sdkId) and returns 204', async () => {
    const sdkId = 'sdk-session-summarize-abc';
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'SummarizeTest',
    });
    // session.summarize needs a model; the controller resolves it from the
    // session's last model first (updateFields persists provider/model).
    sessionsRepo.updateFields(session.id, {
      providerId: 'anthropic',
      modelId: 'claude-x',
    });
    sessionMap.set(session.id, sdkId);
    summarizeSessionSpy.mockResolvedValueOnce(true);

    const { res } = makeRes();
    const next = vi.fn();

    await controller.summarize(
      makeReq({ id: session.id }),
      res,
      next as NextFunction,
    );

    expect(next).not.toHaveBeenCalled();
    expect(summarizeSessionSpy).toHaveBeenCalledOnce();
    expect(summarizeSessionSpy).toHaveBeenCalledWith(sdkId, {
      providerID: 'anthropic',
      modelID: 'claude-x',
    });
    expect((res.status as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(204);
  });

  // ── c1b: no SDK mapping ────────────────────────────────────────────────────

  it('issue-696-c1b: summarize with no SDK mapping → 400 via next()', async () => {
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'NoMapSummarize',
    });
    // sessionMap intentionally empty — no SDK mapping for this session.

    const { res } = makeRes();
    const next = vi.fn();

    await controller.summarize(
      makeReq({ id: session.id }),
      res,
      next as NextFunction,
    );

    expect(next).toHaveBeenCalledOnce();
    expect(summarizeSessionSpy).not.toHaveBeenCalled();
  });

  // ── c1c: SDK error → AppError via next() ──────────────────────────────────

  it('issue-696-c1c: SDK error on summarize → AppError forwarded via next(), never swallowed', async () => {
    const sdkId = 'sdk-session-summarize-error';
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'SummarizeError',
    });
    sessionMap.set(session.id, sdkId);
    const sdkError = Object.assign(
      new Error(`summarizeSession failed for session ${sdkId}: {"code":500}`),
      { statusCode: 502, code: 'SDK_ERROR' },
    );
    summarizeSessionSpy.mockRejectedValueOnce(sdkError);

    const { res } = makeRes();
    const next = vi.fn();

    await controller.summarize(
      makeReq({ id: session.id }),
      res,
      next as NextFunction,
    );

    expect(next).toHaveBeenCalledOnce();
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0] as Error & { statusCode?: number };
    expect(err).toBeInstanceOf(Error);
    // Must NOT have responded with any success JSON.
    const jsonCalls = (res.json as ReturnType<typeof vi.fn>).mock.calls;
    expect(jsonCalls).toHaveLength(0);
  });
});
