/**
 * OPC-M3-5 Session todo panel — server-side contract.
 * Issue #698, criteria c1 and c2.
 *
 * c1 — GET /agent-sessions/:id/todo calls the typed getTodo wrapper with the
 *      mapped SDK session id and returns the real-shape Todo[] payload.
 *      No SDK mapping → returns []. SDK error → AppError 502 forwarded via next().
 *
 * c2 — The stream bridge relays a `todo.updated` SSE event as a WS frame
 *      carrying the local session id and the todo list from the event properties.
 *
 * RED proof: neither the route, controller method, nor bridge relay exist yet.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

// ---------------------------------------------------------------------------
// Real v1.14.49 Todo fixture shape
// ---------------------------------------------------------------------------

const kTodoFixture = [
  {
    id: 'todo-1',
    content: 'Implement the server route',
    status: 'completed',
    priority: 'high',
  },
  {
    id: 'todo-2',
    content: 'Write the Flutter widget',
    status: 'in-progress',
    priority: 'medium',
  },
  {
    id: 'todo-3',
    content: 'Wire WS relay',
    status: 'pending',
    priority: 'low',
  },
];

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

const {
  broadcastSpy,
  broadcastSessionUpdatedSpy,
  sessionMap,
  getTodoSpy,
} = vi.hoisted(() => ({
  broadcastSpy: vi.fn(),
  broadcastSessionUpdatedSpy: vi.fn(),
  sessionMap: new Map<string, string>(),
  getTodoSpy: vi.fn(),
}));

vi.mock('../services/ws_gateway', () => ({
  broadcast: (msg: unknown) => broadcastSpy(msg),
  broadcastSessionUpdated: (session: unknown) =>
    broadcastSessionUpdatedSpy(session),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    getTodo: getTodoSpy,
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
  res: Response;
} {
  const json = vi.fn();
  const res = {
    json,
    status: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { json, status: vi.fn(), res };
}

// ---------------------------------------------------------------------------
// c1 — GET /agent-sessions/:id/todo controller
// ---------------------------------------------------------------------------

describe('issue-698-c1: GET /agent-sessions/:id/todo calls getTodo wrapper and returns real-shape payload', () => {
  let sessionsRepo: AgentSessionsRepository;
  let controller: AgentSessionsController;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionMap.clear();
    makeDb();
    sessionsRepo = new AgentSessionsRepository();
    controller = new AgentSessionsController();
  });

  it('issue-698-c1a: returns [] when no SDK mapping exists (no-op, not an error)', async () => {
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'NoMap',
    });
    const { res } = makeRes();
    const next = vi.fn();

    await controller.getTodo(makeReq({ id: session.id }), res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual([]);
    expect(getTodoSpy).not.toHaveBeenCalled();
  });

  it('issue-698-c1b: calls getTodo with the mapped sdk id and returns real-shape Todo[] payload', async () => {
    const sdkId = 'sdk-session-todo-abc123';
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'WithTodos',
    });
    sessionMap.set(session.id, sdkId);
    getTodoSpy.mockResolvedValueOnce(kTodoFixture);

    const { res } = makeRes();
    const next = vi.fn();

    await controller.getTodo(makeReq({ id: session.id }), res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(getTodoSpy).toHaveBeenCalledOnce();
    expect(getTodoSpy).toHaveBeenCalledWith(sdkId);

    const result = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as typeof kTodoFixture;
    expect(result).toHaveLength(3);
    // Real-shape fields: id, content, status, priority.
    expect(result[0].id).toBe('todo-1');
    expect(result[0].content).toBe('Implement the server route');
    expect(result[0].status).toBe('completed');
    expect(result[0].priority).toBe('high');
    expect(result[1].status).toBe('in-progress');
    expect(result[2].status).toBe('pending');
  });

  it('issue-698-c1c: SDK error envelope → AppError 502 forwarded via next(), never a silent []', async () => {
    const sdkId = 'sdk-session-todo-error999';
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'SdkError',
    });
    sessionMap.set(session.id, sdkId);
    const sdkError = Object.assign(
      new Error('getTodo failed for session sdk-session-todo-error999: {"code":500}'),
      { statusCode: 502, code: 'SDK_ERROR' },
    );
    getTodoSpy.mockRejectedValueOnce(sdkError);

    const { res } = makeRes();
    const next = vi.fn();

    await controller.getTodo(makeReq({ id: session.id }), res, next as NextFunction);

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
// c2 — bridge relays todo.updated SSE as a WS frame
// ---------------------------------------------------------------------------

describe('issue-698-c2: bridge relays todo.updated SSE event as a WS frame with session id and todo list', () => {
  let sessionsRepo: AgentSessionsRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionMap.clear();
    makeDb();
    sessionsRepo = new AgentSessionsRepository();
  });

  it('issue-698-c2a: todo.updated event is relayed with type=todo.updated, local session id, and todo list', async () => {
    // Import the bridge after mocks are in place.
    const { OpencodeStreamBridge } = await import('../services/opencode_stream_bridge');
    const bridge = new OpencodeStreamBridge();

    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'TodoRelay',
    });
    const sdkId = 'sdk-todo-relay-001';
    sessionMap.set(session.id, sdkId);

    // Fire a synthetic todo.updated event through the bridge's internal relay.
    // We call the private _relayEvent via type-cast to avoid any public API.
    (bridge as unknown as { _relayEvent(e: unknown): void })._relayEvent({
      type: 'todo.updated',
      properties: {
        sessionID: sdkId,
        todos: kTodoFixture,
      },
    });

    // The broadcast must have been called with the correct WS frame.
    const calls = broadcastSpy.mock.calls as [Record<string, unknown>][];
    const todoFrame = calls.find((c) => c[0]?.type === 'todo.updated');
    expect(todoFrame).toBeDefined();
    expect(todoFrame![0].id).toBe(session.id);
    const todos = todoFrame![0].todos as typeof kTodoFixture;
    expect(todos).toHaveLength(3);
    expect(todos[0].status).toBe('completed');
    expect(todos[1].status).toBe('in-progress');
    expect(todos[2].status).toBe('pending');
  });

  it('issue-698-c2b: todo.updated for unknown session still broadcasts with sdkId as fallback id', async () => {
    const { OpencodeStreamBridge } = await import('../services/opencode_stream_bridge');
    const bridge = new OpencodeStreamBridge();

    const unknownSdkId = 'sdk-unknown-session-xyz';
    // No entry in sessionMap for this SDK id.

    (bridge as unknown as { _relayEvent(e: unknown): void })._relayEvent({
      type: 'todo.updated',
      properties: {
        sessionID: unknownSdkId,
        todos: kTodoFixture,
      },
    });

    const calls = broadcastSpy.mock.calls as [Record<string, unknown>][];
    const todoFrame = calls.find((c) => c[0]?.type === 'todo.updated');
    expect(todoFrame).toBeDefined();
    // Falls back to SDK id when no local mapping exists (consistent with other events).
    expect(todoFrame![0].id).toBe(unknownSdkId);
  });
});
