/**
 * OPC-M3-6 Subagent child-session navigation — server-side contract.
 * Issue #699, criterion c1.
 *
 * c1a — GET /agent-sessions/:id/children calls the typed listChildren wrapper
 *       with the mapped SDK session id and returns child Session summaries.
 *       No SDK mapping → returns []. SDK error → AppError 502 via next().
 *
 * c1b — GET /agent-sessions/:id/children/:childSdkId/messages calls the typed
 *       listMessages wrapper with the childSdkId and returns messages in the
 *       same structured shape as M1-2's GET /agent-sessions/:id/messages.
 *       Unknown parent session → 404. SDK error → AppError 502 via next().
 *
 * RED proof: neither route nor controller methods exist yet.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

// ---------------------------------------------------------------------------
// Real v1.14.49 Session fixture
// ---------------------------------------------------------------------------

const kChildSessionFixture = [
  {
    id: 'sdk-child-session-001',
    projectID: 'proj-1',
    directory: '/tmp/repo',
    title: 'Child task: fix the bug',
    version: '1.0.0',
    time: { created: 1700000000000, updated: 1700000001000 },
  },
  {
    id: 'sdk-child-session-002',
    projectID: 'proj-1',
    directory: '/tmp/repo',
    title: 'Child task: write tests',
    version: '1.0.0',
    time: { created: 1700000002000, updated: 1700000003000 },
  },
];

// Real v1.14.49 Message fixture (what SDK listMessages returns).
const kChildMessagesFixture = [
  {
    id: 'msg-child-001',
    sessionID: 'sdk-child-session-001',
    role: 'user' as const,
    parts: [
      {
        id: 'part-child-text-001',
        sessionID: 'sdk-child-session-001',
        messageID: 'msg-child-001',
        type: 'text' as const,
        text: 'Fix the bug in auth.ts',
      },
    ],
    time: { created: 1700000000100 },
  },
  {
    id: 'msg-child-002',
    sessionID: 'sdk-child-session-001',
    role: 'assistant' as const,
    parts: [
      {
        id: 'part-child-text-002',
        sessionID: 'sdk-child-session-001',
        messageID: 'msg-child-002',
        type: 'text' as const,
        text: 'I found the bug in auth.ts line 42.',
      },
      {
        id: 'part-child-tool-001',
        sessionID: 'sdk-child-session-001',
        messageID: 'msg-child-002',
        type: 'tool' as const,
        name: 'edit',
        input: { filePath: 'auth.ts', oldContent: 'broken', newContent: 'fixed' },
      },
    ],
    time: { created: 1700000000200 },
  },
];

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

const {
  broadcastSpy,
  broadcastSessionUpdatedSpy,
  sessionMap,
  listChildrenSpy,
  listMessagesSpy,
} = vi.hoisted(() => ({
  broadcastSpy: vi.fn(),
  broadcastSessionUpdatedSpy: vi.fn(),
  sessionMap: new Map<string, string>(),
  listChildrenSpy: vi.fn(),
  listMessagesSpy: vi.fn(),
}));

vi.mock('../services/ws_gateway', () => ({
  broadcast: (msg: unknown) => broadcastSpy(msg),
  broadcastSessionUpdated: (session: unknown) =>
    broadcastSessionUpdatedSpy(session),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    listChildren: listChildrenSpy,
    listMessages: listMessagesSpy,
    createSession: vi.fn().mockResolvedValue(null),
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    clearErrorStatus: vi.fn(),
    getSession: vi.fn().mockResolvedValue(null),
    promptAsync: vi.fn().mockResolvedValue(false),
  },
  opencodeSessionMap: sessionMap,
}));

vi.mock('../services/opencode_stream_bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/opencode_stream_bridge')>();
  return {
    ...actual,
    streamBridge: {
      streamSession: vi.fn(),
      stopStream: vi.fn(),
      clearErrorStatus: vi.fn(),
      getPendingPermission: vi.fn(),
      clearPendingPermission: vi.fn(),
    },
  };
});

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
  return { params, body: {}, headers: {} } as unknown as Request;
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
    end,
    status: statusFn,
  } as unknown as Response;
  return { json, status: statusFn, end, res };
}

// ---------------------------------------------------------------------------
// c1a — GET /agent-sessions/:id/children controller tests
// ---------------------------------------------------------------------------

describe('issue-699-c1a: GET /agent-sessions/:id/children calls listChildren and returns child summaries', () => {
  let sessionsRepo: AgentSessionsRepository;
  let controller: AgentSessionsController;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionMap.clear();
    makeDb();
    sessionsRepo = new AgentSessionsRepository();
    controller = new AgentSessionsController();
  });

  it('issue-699-c1a-no-mapping: returns [] when no SDK mapping exists (session exists but not active)', async () => {
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'NoMapping',
    });
    const { res } = makeRes();
    const next = vi.fn();

    await controller.getChildren(makeReq({ id: session.id }), res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual([]);
    expect(listChildrenSpy).not.toHaveBeenCalled();
  });

  it('issue-699-c1a-happy-path: calls listChildren with mapped SDK id and returns child Session[] fixture', async () => {
    const sdkId = 'sdk-parent-session-abc123';
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'WithChildren',
    });
    sessionMap.set(session.id, sdkId);
    listChildrenSpy.mockResolvedValueOnce(kChildSessionFixture);

    const { res } = makeRes();
    const next = vi.fn();

    await controller.getChildren(makeReq({ id: session.id }), res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(listChildrenSpy).toHaveBeenCalledOnce();
    expect(listChildrenSpy).toHaveBeenCalledWith(sdkId);

    const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as typeof kChildSessionFixture;
    expect(result).toHaveLength(2);
    // Real-shape fields: id, title, directory, time.created.
    expect(result[0].id).toBe('sdk-child-session-001');
    expect(result[0].title).toBe('Child task: fix the bug');
    expect(result[1].id).toBe('sdk-child-session-002');
  });

  it('issue-699-c1a-unknown-session: 404 when the session row does not exist', async () => {
    const { res } = makeRes();
    const next = vi.fn();

    await controller.getChildren(makeReq({ id: 'does-not-exist' }), res, next as NextFunction);

    expect(next).toHaveBeenCalledOnce();
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0] as Error & { statusCode?: number };
    expect(err.statusCode).toBe(404);
  });

  it('issue-699-c1a-sdk-error: SDK error → AppError 502 forwarded via next(), never a silent []', async () => {
    const sdkId = 'sdk-parent-session-error999';
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'SdkError',
    });
    sessionMap.set(session.id, sdkId);
    const sdkError = Object.assign(
      new Error(`listChildren failed for session ${sdkId}: {"code":500}`),
      { statusCode: 502, code: 'SDK_ERROR' },
    );
    listChildrenSpy.mockRejectedValueOnce(sdkError);

    const { res } = makeRes();
    const next = vi.fn();

    await controller.getChildren(makeReq({ id: session.id }), res, next as NextFunction);

    expect(next).toHaveBeenCalledOnce();
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0] as Error;
    expect(err).toBeInstanceOf(Error);
    // Must never silently return [].
    const jsonCalls = (res.json as ReturnType<typeof vi.fn>).mock.calls;
    const silentEmpty = jsonCalls.some(
      (call: unknown[]) => Array.isArray(call[0]) && (call[0] as unknown[]).length === 0,
    );
    expect(silentEmpty).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// c1b — GET /agent-sessions/:id/children/:childSdkId/messages controller tests
// ---------------------------------------------------------------------------

describe('issue-699-c1b: GET /agent-sessions/:id/children/:childSdkId/messages returns structured messages (M1-2 shape)', () => {
  let sessionsRepo: AgentSessionsRepository;
  let controller: AgentSessionsController;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionMap.clear();
    makeDb();
    sessionsRepo = new AgentSessionsRepository();
    controller = new AgentSessionsController();
  });

  it('issue-699-c1b-happy-path: calls listMessages with childSdkId and returns structured M1-2 shaped messages', async () => {
    const parentSdkId = 'sdk-parent-session-xyz789';
    const childSdkId = 'sdk-child-session-001';
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'ParentSession',
    });
    sessionMap.set(session.id, parentSdkId);
    listMessagesSpy.mockResolvedValueOnce(kChildMessagesFixture);

    const { res } = makeRes();
    const next = vi.fn();

    await controller.getChildMessages(
      makeReq({ id: session.id, childSdkId }),
      res,
      next as NextFunction,
    );

    expect(next).not.toHaveBeenCalled();
    expect(listMessagesSpy).toHaveBeenCalledOnce();
    expect(listMessagesSpy).toHaveBeenCalledWith(childSdkId);

    const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      messages: unknown[];
    };
    // Must return { messages: [...] } wrapper — same shape as M1-2.
    expect(result).toHaveProperty('messages');
    expect(Array.isArray(result.messages)).toBe(true);
    expect(result.messages).toHaveLength(2);

    // Verify M1-2-compatible structured shape: sdkMessageId, role, parts.
    const m0 = result.messages[0] as Record<string, unknown>;
    expect(m0.sdkMessageId).toBe('msg-child-001');
    expect(m0.role).toBe('input'); // user → input to match M1-2 convention
    expect(Array.isArray(m0.parts)).toBe(true);
    const parts0 = m0.parts as Array<Record<string, unknown>>;
    expect(parts0[0].type).toBe('text');
    expect(parts0[0].text).toBe('Fix the bug in auth.ts');

    const m1 = result.messages[1] as Record<string, unknown>;
    expect(m1.sdkMessageId).toBe('msg-child-002');
    expect(m1.role).toBe('output'); // assistant → output
    const parts1 = m1.parts as Array<Record<string, unknown>>;
    expect(parts1).toHaveLength(2);
    expect(parts1[1].type).toBe('tool');
  });

  it('issue-699-c1b-unknown-parent: 404 when parent session row does not exist', async () => {
    const { res } = makeRes();
    const next = vi.fn();

    await controller.getChildMessages(
      makeReq({ id: 'does-not-exist', childSdkId: 'sdk-child-session-001' }),
      res,
      next as NextFunction,
    );

    expect(next).toHaveBeenCalledOnce();
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0] as Error & { statusCode?: number };
    expect(err.statusCode).toBe(404);
  });

  it('issue-699-c1b-sdk-error: SDK error → AppError 502 forwarded via next()', async () => {
    const parentSdkId = 'sdk-parent-session-err001';
    const childSdkId = 'sdk-child-session-err001';
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'SdkErrorParent',
    });
    sessionMap.set(session.id, parentSdkId);
    const sdkError = Object.assign(
      new Error(`listMessages failed for session ${childSdkId}: {"code":500}`),
      { statusCode: 502, code: 'SDK_ERROR' },
    );
    listMessagesSpy.mockRejectedValueOnce(sdkError);

    const { res } = makeRes();
    const next = vi.fn();

    await controller.getChildMessages(
      makeReq({ id: session.id, childSdkId }),
      res,
      next as NextFunction,
    );

    expect(next).toHaveBeenCalledOnce();
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0] as Error;
    expect(err).toBeInstanceOf(Error);
  });
});
