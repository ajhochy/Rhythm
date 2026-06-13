/**
 * OPC-M1-6 Terminal command-runner (session.shell) — server-side contract.
 * Issue #709, criterion c1.
 *
 * c1a — POST /agent-sessions/:id/shell { command } invokes client.session.shell
 *       with the command + the resolved model (real model shape {providerID,
 *       modelID}) and returns { messageId }. The SDK spy is called with the
 *       real SessionShellData body shape.
 *
 * c1b — Empty command → 400 (controller guard, before SDK call).
 *
 * c1c — SDK error → AppError 502 forwarded via next(), never swallowed.
 *
 * c1d — No active SDK mapping → 400.
 *
 * Run with:
 *   cd apps/api_server && npx vitest run src/__tests__/opc_m1_6_terminal_command_runner.test.ts
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import os from 'os';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

// ---------------------------------------------------------------------------
// Shared mocks — hoisted so they are available to vi.mock factories
// ---------------------------------------------------------------------------

const {
  broadcastSpy,
  broadcastSessionUpdatedSpy,
  sessionMap,
  shellSpy,
  listAuthedProvidersSpy,
} = vi.hoisted(() => ({
  broadcastSpy: vi.fn(),
  broadcastSessionUpdatedSpy: vi.fn(),
  sessionMap: new Map<string, string>(),
  shellSpy: vi.fn(),
  listAuthedProvidersSpy: vi.fn().mockResolvedValue(['anthropic']),
}));

vi.mock('../services/ws_gateway', () => ({
  broadcast: (msg: unknown) => broadcastSpy(msg),
  broadcastSessionUpdated: (session: unknown) => broadcastSessionUpdatedSpy(session),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    runShell: shellSpy,
    summarizeSession: vi.fn().mockResolvedValue(true),
    revertSession: vi.fn().mockResolvedValue(null),
    unrevertSession: vi.fn().mockResolvedValue(null),
    getSessionDiff: vi.fn().mockResolvedValue([]),
    createSession: vi.fn().mockResolvedValue(null),
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    clearErrorStatus: vi.fn(),
    getSession: vi.fn().mockResolvedValue(null),
    promptAsync: vi.fn().mockResolvedValue(false),
    listAuthedProviders: listAuthedProvidersSpy,
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
  query: Record<string, string> = {},
): Request {
  return { params, body, query, headers: {} } as unknown as Request;
}

function makeRes(): {
  json: ReturnType<typeof vi.fn>;
  statusFn: ReturnType<typeof vi.fn>;
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
  return { json, statusFn, end, res };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('issue-709-c1: shell route contracts', () => {
  let sessionsRepo: AgentSessionsRepository;
  let controller: AgentSessionsController;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionMap.clear();
    listAuthedProvidersSpy.mockResolvedValue(['anthropic']);
    const db = makeDb();
    void db;
    sessionsRepo = new AgentSessionsRepository();
    controller = new AgentSessionsController();
  });

  // ── c1a: happy path — shell called with command + resolved model ──────────

  it('issue-709-c1a: shell route calls runShell(sdkId, command) and returns { messageId }', async () => {
    const sdkId = 'sdk-session-shell-abc';
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'ShellTest',
    });
    sessionMap.set(session.id, sdkId);

    // Resolved model: anthropic is authed → first route for claude-code agent.
    const expectedModel = { providerID: 'anthropic', modelID: 'claude-opus-4-7' };
    const mockMessageId = 'msg-shell-001';
    shellSpy.mockResolvedValueOnce({ messageId: mockMessageId });

    const { res } = makeRes();
    const next = vi.fn();

    await controller.shell(
      makeReq({ id: session.id }, { command: 'ls -la' }),
      res,
      next as NextFunction,
    );

    expect(next).not.toHaveBeenCalled();
    expect(shellSpy).toHaveBeenCalledOnce();
    // Verify called with sdkId, command, and resolved model.
    const [calledSdkId, calledCommand, calledModel] = shellSpy.mock.calls[0] as [
      string, string, { providerID: string; modelID: string } | undefined
    ];
    expect(calledSdkId).toBe(sdkId);
    expect(calledCommand).toBe('ls -la');
    // Model must have the real shape: { providerID, modelID }.
    expect(calledModel).toMatchObject(expectedModel);

    const jsonCalls = (res.json as ReturnType<typeof vi.fn>).mock.calls;
    expect(jsonCalls).toHaveLength(1);
    expect(jsonCalls[0][0]).toMatchObject({ messageId: mockMessageId });
  });

  // ── c1b: empty command → 400 ──────────────────────────────────────────────

  it('issue-709-c1b: empty command → 400 via next(AppError), shell never called', async () => {
    const sdkId = 'sdk-session-shell-empty';
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'ShellEmpty',
    });
    sessionMap.set(session.id, sdkId);

    const { res } = makeRes();
    const next = vi.fn();

    await controller.shell(
      makeReq({ id: session.id }, { command: '' }),
      res,
      next as NextFunction,
    );

    expect(next).toHaveBeenCalledOnce();
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0] as { statusCode?: number };
    expect(err).toBeDefined();
    expect(err.statusCode).toBe(400);
    expect(shellSpy).not.toHaveBeenCalled();
  });

  // ── c1c: SDK error → AppError 502 via next(), never swallowed ────────────

  it('issue-709-c1c: SDK error → AppError 502 forwarded via next(), never swallowed', async () => {
    const sdkId = 'sdk-session-shell-error';
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'ShellError',
    });
    sessionMap.set(session.id, sdkId);

    const sdkError = Object.assign(
      new Error(`runShell failed for session ${sdkId}: {"code":500}`),
      { statusCode: 502, code: 'SDK_ERROR' },
    );
    shellSpy.mockRejectedValueOnce(sdkError);

    const { res } = makeRes();
    const next = vi.fn();

    await controller.shell(
      makeReq({ id: session.id }, { command: 'echo hello' }),
      res,
      next as NextFunction,
    );

    expect(next).toHaveBeenCalledOnce();
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0] as Error & { statusCode?: number };
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(502);
    // No success JSON emitted.
    const jsonCalls = (res.json as ReturnType<typeof vi.fn>).mock.calls;
    expect(jsonCalls).toHaveLength(0);
  });

  // ── c1d: no SDK mapping → 400 ────────────────────────────────────────────

  it('issue-709-c1d: no active SDK mapping → 400 via next(AppError)', async () => {
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'ShellNoMap',
    });
    // Intentionally not setting sessionMap entry for this session.

    const { res } = makeRes();
    const next = vi.fn();

    await controller.shell(
      makeReq({ id: session.id }, { command: 'ls' }),
      res,
      next as NextFunction,
    );

    expect(next).toHaveBeenCalledOnce();
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0] as { statusCode?: number };
    expect(err).toBeDefined();
    expect(err.statusCode).toBe(400);
    expect(shellSpy).not.toHaveBeenCalled();
  });
});
