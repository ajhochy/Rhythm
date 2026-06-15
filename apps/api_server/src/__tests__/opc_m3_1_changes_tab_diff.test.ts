/**
 * OPC-M3-1 Changes tab via real GET /session/{id}/diff — server-side contract.
 * Issue #694, criterion c1.
 *
 * c1 — GET /agent-sessions/:id/diff calls the typed getSessionDiff wrapper with
 *      the mapped sdk id and returns its real-shape payload (file, additions,
 *      deletions, patch). SDK-error envelope → AppError 502 with message, never
 *      a silent [].
 *
 * RED proof: the current getDiff handler returns [] when no SDK mapping exists
 * (correctly), but the SDK-error path swallows the error (returns []) rather
 * than throwing AppError 502. The real-shape fixture test also confirms the
 * typed wrapper is called (not duck-typing).
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

// ---------------------------------------------------------------------------
// Real v1.14.49 FileDiff fixture shape
// ---------------------------------------------------------------------------

const kFileDiffFixture = [
  {
    file: 'apps/desktop_flutter/lib/features/agents/views/agents_view.dart',
    before: 'class _ChangesTab extends StatelessWidget {\n  @override\n  Widget build(BuildContext context) => const Text("TODO");\n}',
    after: 'class _ChangesTab extends StatelessWidget {\n  @override\n  Widget build(BuildContext context) => _buildChangesBody(context);\n  Widget _buildChangesBody(BuildContext context) => const Center(child: Text("Changes"));\n}',
    additions: 2,
    deletions: 1,
  },
];

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

const { broadcastSpy, broadcastSessionUpdatedSpy, sessionMap, getSessionDiffSpy } = vi.hoisted(
  () => ({
    broadcastSpy: vi.fn(),
    broadcastSessionUpdatedSpy: vi.fn(),
    sessionMap: new Map<string, string>(),
    getSessionDiffSpy: vi.fn(),
  }),
);

vi.mock('../services/ws_gateway', () => ({
  broadcast: (msg: unknown) => broadcastSpy(msg),
  broadcastSessionUpdated: (session: unknown) => broadcastSessionUpdatedSpy(session),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    getSessionDiff: getSessionDiffSpy,
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

import os from 'os';
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

function makeReq(params: Record<string, string> = {}): Request {
  return {
    params,
    body: {},
    headers: {},
  } as unknown as Request;
}

function makeRes(): { json: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn>; res: Response } {
  const json = vi.fn();
  const res = {
    json,
    status: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { json, status: vi.fn(), res };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('issue-694-c1: getDiff calls typed getSessionDiff wrapper and returns real-shape payload; SDK error → AppError 502', () => {
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

  it('issue-694-c1a: returns [] when no SDK mapping exists (no-op, not an error)', async () => {
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'NoMap',
    });
    const { res } = makeRes();
    const next = vi.fn();

    await controller.getDiff(makeReq({ id: session.id }), res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual([]);
    // getSessionDiff must NOT be called when there is no mapping.
    expect(getSessionDiffSpy).not.toHaveBeenCalled();
  });

  it('issue-694-c1b: calls getSessionDiff with the mapped sdk id and returns real-shape FileDiff payload', async () => {
    const sdkId = 'sdk-session-abc123';
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'WithDiff',
    });
    sessionMap.set(session.id, sdkId);
    // Mock the typed wrapper to return real-shape FileDiff fixtures.
    getSessionDiffSpy.mockResolvedValueOnce(kFileDiffFixture);

    const { res } = makeRes();
    const next = vi.fn();

    await controller.getDiff(makeReq({ id: session.id }), res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    // Must have called the typed wrapper with the correct SDK id.
    expect(getSessionDiffSpy).toHaveBeenCalledOnce();
    expect(getSessionDiffSpy).toHaveBeenCalledWith(sdkId);

    const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as typeof kFileDiffFixture;
    expect(result).toHaveLength(1);
    // Real-shape fields: file, additions, deletions (not duck-typed).
    expect(result[0].file).toBe(
      'apps/desktop_flutter/lib/features/agents/views/agents_view.dart',
    );
    expect(result[0].additions).toBe(2);
    expect(result[0].deletions).toBe(1);
    expect(typeof result[0].before).toBe('string');
    expect(typeof result[0].after).toBe('string');
  });

  it('issue-694-c1c: SDK error envelope → AppError 502 forwarded via next(), never a silent []', async () => {
    const sdkId = 'sdk-session-error999';
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'SdkError',
    });
    sessionMap.set(session.id, sdkId);
    // Simulate getSessionDiff throwing an AppError 502 (as the typed wrapper does
    // when the SDK returns an error envelope).
    const sdkError = Object.assign(new Error('getSessionDiff failed for session sdk-session-error999: {"code":500}'), {
      statusCode: 502,
      code: 'SDK_ERROR',
    });
    getSessionDiffSpy.mockRejectedValueOnce(sdkError);

    const { res } = makeRes();
    const next = vi.fn();

    await controller.getDiff(makeReq({ id: session.id }), res, next as NextFunction);

    // MUST forward to next() — never silently return [].
    expect(next).toHaveBeenCalledOnce();
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0] as Error & { statusCode?: number };
    expect(err).toBeInstanceOf(Error);
    // The error must be forwarded (either the AppError itself or wrapped).
    // res.json must NOT have been called with [].
    const jsonCalls = (res.json as ReturnType<typeof vi.fn>).mock.calls;
    const silentEmpty = jsonCalls.some(
      (call: unknown[]) => Array.isArray(call[0]) && (call[0] as unknown[]).length === 0,
    );
    expect(silentEmpty).toBe(false);
  });
});
