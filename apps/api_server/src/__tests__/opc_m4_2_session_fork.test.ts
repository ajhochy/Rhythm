/**
 * OPC-M4-2 Session fork — server-side contract tests.
 * Issue #701, criteria c1–c3, c5.
 *
 * c1 — POST /agent-sessions/:id/fork body {messageId} invokes the SDK
 *      forkSession wrapper with (sdkId, messageId), inserts a local row
 *      with the new sdk_session_id, populates opencodeSessionMap, returns 201.
 *
 * c2 — The forked session's persisted messages equal the parent's messages
 *      up to and including the fork message (DB assert; parts_json intact).
 *
 * c3 — SDK fork failure → AppError forwarded via next(); no local row
 *      is left behind (rollback assert).
 *
 * c5 — Prompting the fork routes to the fork's SDK id (opencodeSessionMap
 *      contains fork local id → fork SDK id, not parent SDK id).
 *
 * Run with:
 *   cd apps/api_server && npx vitest run src/__tests__/opc_m4_2_session_fork.test.ts
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import os from 'os';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

const {
  broadcastSpy,
  broadcastSessionUpdatedSpy,
  sessionMap,
  forkSessionSpy,
  streamSessionSpy,
} = vi.hoisted(() => ({
  broadcastSpy: vi.fn(),
  broadcastSessionUpdatedSpy: vi.fn(),
  sessionMap: new Map<string, string>(),
  forkSessionSpy: vi.fn(),
  streamSessionSpy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/ws_gateway', () => ({
  broadcast: (msg: unknown) => broadcastSpy(msg),
  broadcastSessionUpdated: (session: unknown) => broadcastSessionUpdatedSpy(session),
  broadcastSessionRemoved: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    forkSession: forkSessionSpy,
    getSessionDiff: vi.fn().mockResolvedValue([]),
    createSession: vi.fn().mockResolvedValue(null),
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    clearErrorStatus: vi.fn(),
    getSession: vi.fn().mockResolvedValue(null),
    promptAsync: vi.fn().mockResolvedValue(false),
    ensureReady: vi.fn().mockResolvedValue(true),
    listAuthedProviders: vi.fn().mockResolvedValue([]),
    statusMessage: 'ready',
  },
  opencodeSessionMap: sessionMap,
}));

vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: {
    streamSession: streamSessionSpy,
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
  const statusFn = vi.fn().mockReturnThis();
  const res = {
    json,
    status: statusFn,
    end,
  } as unknown as Response;
  return { json, status: statusFn, end, res };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('issue-701: session fork route contracts', () => {
  let sessionsRepo: AgentSessionsRepository;
  let messagesRepo: AgentSessionMessagesRepository;
  let controller: AgentSessionsController;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionMap.clear();
    makeDb();
    sessionsRepo = new AgentSessionsRepository();
    messagesRepo = new AgentSessionMessagesRepository();
    controller = new AgentSessionsController();
  });

  // ── c1: fork inserts local row, maps SDK id, returns 201 ─────────────────────

  it('issue-701-c1: fork route inserts local row, maps SDK id, returns 201', async () => {
    const parentSdkId = 'sdk-parent-fork-abc';
    const forkSdkId = 'sdk-fork-abc-new';

    const parent = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'ForkParent',
    });
    sessionsRepo.setSdkSessionId(parent.id, parentSdkId);
    sessionMap.set(parent.id, parentSdkId);

    forkSessionSpy.mockResolvedValueOnce({
      id: forkSdkId,
      title: 'ForkParent (fork)',
      path: os.homedir(),
    });

    const { res } = makeRes();
    const next = vi.fn();

    await controller.fork(
      makeReq({ id: parent.id }, { messageId: 'msg-at-fork' }),
      res,
      next as NextFunction,
    );

    // Must not have called next(err).
    expect(next).not.toHaveBeenCalled();

    // SDK forkSession must have been called with (parentSdkId, 'msg-at-fork').
    expect(forkSessionSpy).toHaveBeenCalledOnce();
    expect(forkSessionSpy).toHaveBeenCalledWith(parentSdkId, 'msg-at-fork');

    // Response must be 201 with the new session object.
    expect((res.status as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(201);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(body).toBeDefined();
    expect(typeof body.id).toBe('string');

    // The new session must have a db row with the fork SDK id.
    const forkSession = sessionsRepo.findById(body.id as string);
    expect(forkSession).not.toBeNull();
    expect(forkSession?.sdkSessionId).toBe(forkSdkId);

    // opencodeSessionMap must map fork local id → fork SDK id.
    expect(sessionMap.get(forkSession!.id)).toBe(forkSdkId);

    // Fork name must follow the "<parent> (fork)" convention.
    expect(forkSession?.name).toBe('ForkParent (fork)');
  });

  // ── c2: copied messages with parts_json intact ───────────────────────────────

  it('issue-701-c2: forked session messages copied with parts_json intact', async () => {
    const parentSdkId = 'sdk-parent-msgs-abc';
    const forkSdkId = 'sdk-fork-msgs-new';

    const parent = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'MsgsParent',
    });
    sessionsRepo.setSdkSessionId(parent.id, parentSdkId);
    sessionMap.set(parent.id, parentSdkId);

    // Insert two parent messages, the fork point is msg-002.
    const parts1 = JSON.stringify([{ id: 'p1', type: 'text', text: 'hello world' }]);
    const parts2 = JSON.stringify([{ id: 'p2', type: 'text', text: 'response at fork' }]);
    const parts3 = JSON.stringify([{ id: 'p3', type: 'text', text: 'after fork point — must NOT be copied' }]);

    messagesRepo.upsertStructured(parent.id, 'msg-001', 'input', parts1, null, null);
    messagesRepo.upsertStructured(parent.id, 'msg-002', 'output', parts2, null, null);
    messagesRepo.upsertStructured(parent.id, 'msg-003', 'output', parts3, null, null);

    forkSessionSpy.mockResolvedValueOnce({
      id: forkSdkId,
      title: 'MsgsParent (fork)',
      path: os.homedir(),
    });

    const { res } = makeRes();
    const next = vi.fn();

    await controller.fork(
      makeReq({ id: parent.id }, { messageId: 'msg-002' }),
      res,
      next as NextFunction,
    );

    expect(next).not.toHaveBeenCalled();

    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    const forkId = body.id as string;

    // The fork must have messages up to and including msg-002, but NOT msg-003.
    const forkMessages = messagesRepo.listBySessionStructured(forkId, 200);
    expect(forkMessages).toHaveLength(2);

    // parts_json must be preserved.
    const msgIds = forkMessages.map((m) => m.sdkMessageId);
    expect(msgIds).toContain('msg-001');
    expect(msgIds).toContain('msg-002');
    expect(msgIds).not.toContain('msg-003');

    // parts_json round-trips intact.
    const msg1 = forkMessages.find((m) => m.sdkMessageId === 'msg-001')!;
    expect(msg1.parts).toEqual([{ id: 'p1', type: 'text', text: 'hello world' }]);
    const msg2 = forkMessages.find((m) => m.sdkMessageId === 'msg-002')!;
    expect(msg2.parts).toEqual([{ id: 'p2', type: 'text', text: 'response at fork' }]);
  });

  // ── c3: SDK fork failure → no orphan row ─────────────────────────────────────

  it('issue-701-c3: SDK fork failure → AppError forwarded via next(), no orphan row', async () => {
    const parentSdkId = 'sdk-parent-fail-abc';

    const parent = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'FailParent',
    });
    sessionsRepo.setSdkSessionId(parent.id, parentSdkId);
    sessionMap.set(parent.id, parentSdkId);

    const sdkError = Object.assign(
      new Error(`forkSession failed for session ${parentSdkId}: {"code":500}`),
      { statusCode: 502, code: 'SDK_ERROR' },
    );
    forkSessionSpy.mockRejectedValueOnce(sdkError);

    const allSessionsBefore = sessionsRepo.listAll(100);
    const countBefore = allSessionsBefore.length;

    const { res } = makeRes();
    const next = vi.fn();

    await controller.fork(
      makeReq({ id: parent.id }, { messageId: 'msg-xyz' }),
      res,
      next as NextFunction,
    );

    // Must forward error to next().
    expect(next).toHaveBeenCalledOnce();

    // Must NOT have responded with 201 JSON.
    expect((res.json as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);

    // No orphan session row must have been created.
    const allSessionsAfter = sessionsRepo.listAll(100);
    expect(allSessionsAfter.length).toBe(countBefore);

    // Map must still only contain the parent entry.
    expect(sessionMap.has(parent.id)).toBe(true);
    expect(sessionMap.size).toBe(1);
  });

  // ── c5: fork's SDK id is used for subsequent prompts ────────────────────────

  it('issue-701-c5: fork session map routes prompt to fork SDK id, not parent SDK id', async () => {
    const parentSdkId = 'sdk-parent-route-abc';
    const forkSdkId = 'sdk-fork-route-new';

    const parent = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'RouteParent',
    });
    sessionsRepo.setSdkSessionId(parent.id, parentSdkId);
    sessionMap.set(parent.id, parentSdkId);

    forkSessionSpy.mockResolvedValueOnce({
      id: forkSdkId,
      title: 'RouteParent (fork)',
      path: os.homedir(),
    });

    const { res } = makeRes();
    const next = vi.fn();

    await controller.fork(
      makeReq({ id: parent.id }, { messageId: 'msg-route' }),
      res,
      next as NextFunction,
    );

    expect(next).not.toHaveBeenCalled();

    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    const forkLocalId = body.id as string;

    // opencodeSessionMap[fork local id] === fork SDK id, NOT parent SDK id.
    expect(sessionMap.get(forkLocalId)).toBe(forkSdkId);
    expect(sessionMap.get(forkLocalId)).not.toBe(parentSdkId);

    // Parent mapping is unchanged.
    expect(sessionMap.get(parent.id)).toBe(parentSdkId);
  });
});
