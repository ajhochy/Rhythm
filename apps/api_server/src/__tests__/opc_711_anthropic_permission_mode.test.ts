/**
 * Issue #711 — Claude/anthropic path: agent tool calls (bash/write) don't execute.
 *
 * Root cause: ws_gateway.ts read the session's cwd/agentKind/model/thinking/fastMode
 * fields but did NOT read permissionMode. The `sdkOpts` object forwarded to
 * promptAsync therefore never included permissionMode, so the opencode server
 * enforced its own per-tool permission gate regardless of the Rhythm session's
 * stored permissionMode. Claude/anthropic sessions that call tools (bash, write)
 * were silently blocked waiting for user permission approval, while openrouter
 * free sessions (chat-only models that never call tools) appeared to "work"
 * because they never triggered tool-use at all.
 *
 * Secondary fix: OpencodeClientService.promptAsync incorrectly treated a valid
 * HTTP 204 No Content response (the opencode server's success reply for
 * promptAsync) as a "silent no-op" (the OpenRouter unknown-model path). For
 * Claude/anthropic, promptAsync returns 204 on success; the `!raw.data` check
 * fired and logged a misleading "model may not be supported" warning. The fix
 * checks the HTTP response status to distinguish 204-success from true no-ops.
 *
 * c1 — permissionMode forwarded in sdkOpts:
 *        When the session has permissionMode='bypassPermissions',
 *        handleInputFrame includes { permissionMode: 'bypassPermissions' }
 *        in the sdkOpts object passed to promptAsync (5th arg).
 *
 * c2 — default permissionMode not forwarded:
 *        When permissionMode='default' (the DB default), no permissionMode
 *        key appears in sdkOpts (backwards-compatible with callers that
 *        only read expected keys).
 *
 * c3 — acceptEdits permissionMode forwarded:
 *        When permissionMode='acceptEdits', the value is included in sdkOpts.
 *
 * c4 — promptAsync returns true for 204 void (anthropic success):
 *        OpencodeClientService.promptAsync returns true (not false) when the
 *        real SDK returns HTTP 204 with no body — the anthropic success case.
 *
 * Run with:
 *   cd apps/api_server && npx vitest run src/__tests__/opc_711_anthropic_permission_mode.test.ts
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import os from 'os';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { OpencodeClientService } from '../services/opencode_client_service';

// ---------------------------------------------------------------------------
// Shared mocks (hoisted so vi.mock factories can reference them)
// ---------------------------------------------------------------------------

const {
  promptAsyncSpy,
  sessionMap,
  wsSendMock,
} = vi.hoisted(() => ({
  promptAsyncSpy: vi.fn().mockResolvedValue(true),
  sessionMap: new Map<string, string>(),
  wsSendMock: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    promptAsync: promptAsyncSpy,
    createSession: vi.fn().mockResolvedValue(null),
    getSession: vi.fn().mockResolvedValue(null),
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    dispatchCommand: vi.fn().mockResolvedValue(null),
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

vi.mock('../services/agent_model_resolver', () => ({
  resolveModelForSessionTurn: vi.fn().mockResolvedValue({
    providerID: 'anthropic',
    modelID: 'claude-opus-4-7',
  }),
}));

// ---------------------------------------------------------------------------
// Import the handler under test (after mocks are set up)
// ---------------------------------------------------------------------------

import { handleInputFrame } from '../services/ws_gateway';

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
  return {
    send: wsSendMock,
    readyState: 1, /* WebSocket.OPEN */
  } as unknown as import('ws').WebSocket;
}

// ---------------------------------------------------------------------------
// Tests — c1/c2/c3: permissionMode forwarding in sdkOpts
// ---------------------------------------------------------------------------

describe('issue-711: permissionMode forwarded in sdkOpts from handleInputFrame', () => {
  let sessionsRepo: AgentSessionsRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionMap.clear();
    makeDb();
    sessionsRepo = new AgentSessionsRepository();
  });

  it('c1: bypassPermissions — sdkOpts includes permissionMode: bypassPermissions', async () => {
    // CONTRACT TEST — must fail before the fix (pre-fix sdkOpts never had
    // permissionMode, so the opencode server enforced tool gates regardless
    // of the Rhythm session permissionMode, leaving Claude sessions stuck).
    const sdkId = 'sdk-711-bypass';
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'PermBypassTest',
    });
    // Set the session to bypassPermissions mode (simulates the user having
    // turned off tool-use confirmation in the session settings).
    sessionsRepo.updatePermissionMode(session.id, 'bypassPermissions');
    sessionMap.set(session.id, sdkId);

    const ws = makeFakeWs();
    await handleInputFrame(ws, {
      v: 1,
      type: 'session.input',
      id: session.id,
      data: 'ls -la',
    });

    expect(promptAsyncSpy).toHaveBeenCalledOnce();
    // 5th argument to promptAsync is sdkOpts.
    const [, , , , sdkOpts] = promptAsyncSpy.mock.calls[0] as [
      string, string, unknown, unknown, Record<string, unknown> | undefined,
    ];

    expect(sdkOpts, 'sdkOpts must be present when permissionMode is not default').toBeDefined();
    expect(sdkOpts!.permissionMode).toBe('bypassPermissions');
  });

  it('c2: default permissionMode — sdkOpts does NOT include permissionMode key', async () => {
    // Regression guard: for sessions at the default permission mode, the
    // sdkOpts must not include a permissionMode key (backwards-compat).
    const sdkId = 'sdk-711-default';
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'PermDefaultTest',
    });
    // permissionMode defaults to 'default' — no explicit update needed.
    sessionMap.set(session.id, sdkId);

    const ws = makeFakeWs();
    await handleInputFrame(ws, {
      v: 1,
      type: 'session.input',
      id: session.id,
      data: 'hello',
    });

    expect(promptAsyncSpy).toHaveBeenCalledOnce();
    const [, , , , sdkOpts] = promptAsyncSpy.mock.calls[0] as [
      string, string, unknown, unknown, Record<string, unknown> | undefined,
    ];

    // sdkOpts may be undefined (no thinking/fastMode/agent/permissionMode)
    // or defined but MUST NOT have a permissionMode key when mode is 'default'.
    if (sdkOpts !== undefined) {
      expect(sdkOpts).not.toHaveProperty('permissionMode');
    }
  });

  it('c3: acceptEdits permissionMode — sdkOpts includes permissionMode: acceptEdits', async () => {
    const sdkId = 'sdk-711-accept-edits';
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'PermAcceptEditsTest',
    });
    sessionsRepo.updatePermissionMode(session.id, 'acceptEdits');
    sessionMap.set(session.id, sdkId);

    const ws = makeFakeWs();
    await handleInputFrame(ws, {
      v: 1,
      type: 'session.input',
      id: session.id,
      data: 'edit file.ts',
    });

    expect(promptAsyncSpy).toHaveBeenCalledOnce();
    const [, , , , sdkOpts] = promptAsyncSpy.mock.calls[0] as [
      string, string, unknown, unknown, Record<string, unknown> | undefined,
    ];

    expect(sdkOpts).toBeDefined();
    expect(sdkOpts!.permissionMode).toBe('acceptEdits');
  });
});

// ---------------------------------------------------------------------------
// Tests — c4: promptAsync 204 void handling (anthropic success path)
// ---------------------------------------------------------------------------

describe('issue-711-c4: promptAsync returns true for HTTP 204 void (anthropic success)', () => {
  it('returns true when SDK response has HTTP 204 and no data (anthropic success path)', async () => {
    // CONTRACT TEST — must fail against the pre-fix code which returned
    // false for any response with !raw.data, including valid 204 replies.
    const svc = new OpencodeClientService();
    // Inject a fake client that simulates the 204 No Content response
    // that opencode returns for a successfully enqueued promptAsync call
    // (the anthropic provider path).
    (svc as unknown as { client: unknown }).client = {
      session: {
        // hey-api 'fields' mode: wraps the 204 as { data: undefined, error: undefined,
        // response: Response(204) }. Simulate this shape.
        promptAsync: async () => ({
          data: undefined,
          error: undefined,
          response: { status: 204 },
        }),
      },
    };

    const result = await svc.promptAsync(
      'sid-anthropic',
      'ls -la',
      { providerID: 'anthropic', modelID: 'claude-opus-4-7' },
    );

    // 204 is a genuine success — the prompt was enqueued, not dropped.
    expect(result).toBe(true);
  });

  it('returns false when SDK response has no data and no HTTP status (openrouter silent no-op)', async () => {
    // Regression guard for issue #632: openrouter returns {} (HTTP 200 with
    // empty body) for unrecognised model ids. This must still be treated as
    // failure so the caller surfaces an error rather than hanging silently.
    const svc = new OpencodeClientService();
    (svc as unknown as { client: unknown }).client = {
      session: {
        // Empty object — no data, no error, no response (the OpenRouter no-op).
        promptAsync: async () => ({}),
      },
    };

    const result = await svc.promptAsync(
      'sid-openrouter',
      'hello',
      { providerID: 'openrouter', modelID: 'bogus/unknown-model' },
    );

    expect(result).toBe(false);
  });

  it('returns true when SDK response includes a data envelope (non-void path)', async () => {
    // Regression guard: providers that return an actual data object are still
    // treated as success.
    const svc = new OpencodeClientService();
    (svc as unknown as { client: unknown }).client = {
      session: {
        promptAsync: async () => ({ data: { ok: true } }),
      },
    };

    const result = await svc.promptAsync(
      'sid-data',
      'hello',
      { providerID: 'anthropic', modelID: 'claude-opus-4-7' },
    );

    expect(result).toBe(true);
  });
});
