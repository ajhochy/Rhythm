/**
 * Contract tests for OPC-M1-1: Typed SDK wrappers replace duck-typing.
 *
 * RED-FIRST: these tests must fail on the unmodified codebase because
 * - the wrapper methods (getSessionDiff, respondToPermission, dispatchCommand,
 *   listMessages, getTodo, revertSession, unrevertSession, summarizeSession,
 *   forkSession, listChildren, listMcp, connectMcp, disconnectMcp) do not yet
 *   exist on OpencodeClientService.
 * - diffSession duck-typing still present in agent_sessions_controller.
 *
 * Contract file: docs/ai/contracts/issue-685.json
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpencodeClientService } from '../services/opencode_client_service';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a minimal SDK client object that mirrors the v1.14.49 structure:
 * client.session is a class instance with method properties.
 * client.postSessionIdPermissionsPermissionId is on the top-level client.
 * client.mcp is a class instance with status/connect/disconnect methods.
 */
function makeRealSdkClient() {
  const session = {
    diff: vi.fn(),
    command: vi.fn(),
    revert: vi.fn(),
    unrevert: vi.fn(),
    summarize: vi.fn(),
    todo: vi.fn(),
    fork: vi.fn(),
    children: vi.fn(),
    messages: vi.fn(),
    list: vi.fn(),
    create: vi.fn(),
    prompt: vi.fn(),
    promptAsync: vi.fn(),
    status: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    abort: vi.fn(),
  };
  const mcp = {
    status: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const client = {
    session,
    mcp,
    postSessionIdPermissionsPermissionId: vi.fn(),
    config: { providers: vi.fn() },
    provider: {
      list: vi.fn(),
      auth: vi.fn(),
      oauth: { authorize: vi.fn(), callback: vi.fn() },
    },
    auth: { set: vi.fn() },
    event: { subscribe: vi.fn() },
    command: { list: vi.fn() },
  };
  return client;
}

/** Inject a pre-built SDK client into OpencodeClientService private fields. */
function injectClient(
  svc: OpencodeClientService,
  client: ReturnType<typeof makeRealSdkClient>,
) {
  // Access private fields for test injection
  (svc as unknown as Record<string, unknown>)['status'] = 'ready';
  (svc as unknown as Record<string, unknown>)['client'] = client;
}

// ── issue-685-c1: no duck-typing patterns remain ──────────────────────────────

describe('issue-685-c1: no duck-typing patterns remain in SDK integration code', () => {
  it('zero diffSession references in agent_sessions_controller.ts', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const controllerPath = join(
      __dirname,
      '../controllers/agent_sessions_controller.ts',
    );
    const source = readFileSync(controllerPath, 'utf8');
    expect(source).not.toMatch(/diffSession/);
  });

  it('ZERO `as unknown as` occurrences anywhere in opencode_client_service.ts (whole-file, no allowlist)', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const svcPath = join(__dirname, '../services/opencode_client_service.ts');
    const source = readFileSync(svcPath, 'utf8');
    // Count every occurrence — allowlist is intentionally empty.
    // The d.ts envelope types make these casts unnecessary; any re-introduction
    // is a regression of the bug class issue #685 was filed to kill.
    const matches = source.match(/as unknown as/g);
    expect(matches).toBeNull();
  });

  it('zero `as unknown as` casts on SDK objects in opencode_client_service.ts that target session sub-objects', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const svcPath = join(__dirname, '../services/opencode_client_service.ts');
    const source = readFileSync(svcPath, 'utf8');
    // The forbidden pattern: casting client.session (or a named sub-property)
    // to unknown in order to probe for duck-typed methods.
    // Pattern: `(this.client.session as unknown as` or `sessionClient['permission']`
    expect(source).not.toMatch(/sessionClient\s*\[\s*['"]permission['"]\s*\]/);
    expect(source).not.toMatch(/as unknown as\s*\{\s*respond\?/);
  });

  it('getDiff in agent_sessions_controller.ts calls getSessionDiff (not diffSession)', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const source = readFileSync(
      join(__dirname, '../controllers/agent_sessions_controller.ts'),
      'utf8',
    );
    // Must use the typed wrapper
    expect(source).toMatch(/getSessionDiff/);
  });
});

// ── issue-685-c2: getSessionDiff ─────────────────────────────────────────────

describe('issue-685-c2: getSessionDiff invokes SDK method with correct arguments and returns payload', () => {
  let svc: OpencodeClientService;
  let sdkClient: ReturnType<typeof makeRealSdkClient>;

  beforeEach(() => {
    svc = new OpencodeClientService();
    sdkClient = makeRealSdkClient();
    injectClient(svc, sdkClient);
  });

  it('calls session.diff with path: { id: sdkId } and returns data array', async () => {
    const expectedDiffs = [
      { file: 'README.md', before: 'old', after: 'new', additions: 1, deletions: 0 },
    ];
    sdkClient.session.diff.mockResolvedValue({ data: expectedDiffs });

    const result = await svc.getSessionDiff('sdk-session-abc');

    expect(sdkClient.session.diff).toHaveBeenCalledTimes(1);
    const call = sdkClient.session.diff.mock.calls[0]![0] as { path: { id: string } };
    expect(call.path.id).toBe('sdk-session-abc');
    expect(result).toEqual(expectedDiffs);
  });

  it('returns empty array when SDK returns data: null (no diffs — success with empty payload)', async () => {
    sdkClient.session.diff.mockResolvedValue({ data: null });
    const result = await svc.getSessionDiff('sdk-session-xyz');
    expect(result).toEqual([]);
  });

  it('THROWS (does not return []) when SDK returns an error envelope', async () => {
    // This is the key regression guard: a silent return of [] was the bug.
    sdkClient.session.diff.mockResolvedValue({ error: { message: 'session not found' } });
    await expect(svc.getSessionDiff('sdk-session-err-envelope')).rejects.toThrow();
  });

  it('THROWS (does not return []) when SDK rejects with an exception', async () => {
    sdkClient.session.diff.mockRejectedValue(new Error('Network error'));
    await expect(svc.getSessionDiff('sdk-session-err-throw')).rejects.toThrow('Network error');
  });
});

// ── issue-685-c3: respondToPermission ────────────────────────────────────────

describe('issue-685-c3: respondToPermission throws descriptive error when SDK method missing', () => {
  let svc: OpencodeClientService;
  let sdkClient: ReturnType<typeof makeRealSdkClient>;

  beforeEach(() => {
    svc = new OpencodeClientService();
    sdkClient = makeRealSdkClient();
    injectClient(svc, sdkClient);
  });

  it('calls postSessionIdPermissionsPermissionId with correct shape', async () => {
    sdkClient.postSessionIdPermissionsPermissionId.mockResolvedValue({ data: true });

    await svc.respondToPermission('sdk-id-1', 'perm-id-1', 'once');

    expect(sdkClient.postSessionIdPermissionsPermissionId).toHaveBeenCalledTimes(1);
    const call = sdkClient.postSessionIdPermissionsPermissionId.mock
      .calls[0]![0] as {
      path: { id: string; permissionID: string };
      body: { response: string };
    };
    expect(call.path.id).toBe('sdk-id-1');
    expect(call.path.permissionID).toBe('perm-id-1');
    expect(call.body.response).toBe('once');
  });

  it('passes the directory query when given (opencode scopes permissions per dir)', async () => {
    sdkClient.postSessionIdPermissionsPermissionId.mockResolvedValue({ data: true });
    await svc.respondToPermission('sdk-id-d', 'perm-d', 'once', '/Users/me/proj');
    const call = sdkClient.postSessionIdPermissionsPermissionId.mock
      .calls[0]![0] as { query?: { directory?: string } };
    // Without directory the response doesn't reach the right session and the
    // gated tool hangs even after Allow.
    expect(call.query?.directory).toBe('/Users/me/proj');
  });

  it('passes feedback/decision variants correctly', async () => {
    sdkClient.postSessionIdPermissionsPermissionId.mockResolvedValue({ data: true });

    await svc.respondToPermission('sdk-id-2', 'perm-id-2', 'always');

    const call = sdkClient.postSessionIdPermissionsPermissionId.mock
      .calls[0]![0] as { body: { response: string } };
    expect(call.body.response).toBe('always');
  });

  it('THROWS a descriptive error containing the method name when method is missing', async () => {
    // Remove the permission method from the client
    const clientWithoutPermission = {
      ...sdkClient,
      postSessionIdPermissionsPermissionId: undefined as unknown,
    };
    injectClient(svc, clientWithoutPermission as ReturnType<typeof makeRealSdkClient>);

    await expect(
      svc.respondToPermission('sdk-id-3', 'perm-id-3', 'once'),
    ).rejects.toThrow(/postSessionIdPermissionsPermissionId/);
  });
});

// ── issue-685-c4: dispatchCommand ─────────────────────────────────────────────

describe('issue-685-c4: dispatchCommand invokes SDK with command and args', () => {
  let svc: OpencodeClientService;
  let sdkClient: ReturnType<typeof makeRealSdkClient>;

  beforeEach(() => {
    svc = new OpencodeClientService();
    sdkClient = makeRealSdkClient();
    injectClient(svc, sdkClient);
  });

  it('calls session.command with path.id and body.{command, arguments}', async () => {
    const expectedResponse = {
      data: { info: { id: 'msg-1', sessionID: 'sdk-1', role: 'assistant' }, parts: [] },
    };
    sdkClient.session.command.mockResolvedValue(expectedResponse);

    await svc.dispatchCommand('sdk-id-cmd', '/help', '--verbose');

    expect(sdkClient.session.command).toHaveBeenCalledTimes(1);
    const call = sdkClient.session.command.mock.calls[0]![0] as {
      path: { id: string };
      body: { command: string; arguments: string };
    };
    expect(call.path.id).toBe('sdk-id-cmd');
    expect(call.body.command).toBe('/help');
    expect(call.body.arguments).toBe('--verbose');
  });
});

// ── issue-685-c5: wrappers reject before SDK initialization ───────────────────

describe('issue-685-c5: wrappers reject before SDK initialization with engine-not-ready error', () => {
  let svc: OpencodeClientService;

  beforeEach(() => {
    svc = new OpencodeClientService();
    // Deliberately NOT calling injectClient — service stays uninitialized
  });

  it('getSessionDiff rejects with engine-not-ready AppError when uninitialized', async () => {
    await expect(svc.getSessionDiff('sdk-id')).rejects.toThrow();
  });

  it('respondToPermission rejects with engine-not-ready AppError when uninitialized', async () => {
    await expect(svc.respondToPermission('sdk-id', 'perm-id', 'once')).rejects.toThrow();
  });

  it('dispatchCommand rejects with engine-not-ready AppError when uninitialized', async () => {
    await expect(svc.dispatchCommand('sdk-id', '/help', '')).rejects.toThrow();
  });

  it('listMessages rejects with engine-not-ready AppError when uninitialized', async () => {
    await expect(svc.listMessages('sdk-id')).rejects.toThrow();
  });

  it('getTodo rejects with engine-not-ready AppError when uninitialized', async () => {
    await expect(svc.getTodo('sdk-id')).rejects.toThrow();
  });

  it('revertSession rejects with engine-not-ready AppError when uninitialized', async () => {
    await expect(svc.revertSession('sdk-id')).rejects.toThrow();
  });

  it('unrevertSession rejects with engine-not-ready AppError when uninitialized', async () => {
    await expect(svc.unrevertSession('sdk-id')).rejects.toThrow();
  });

  it('summarizeSession rejects with engine-not-ready AppError when uninitialized', async () => {
    await expect(
      svc.summarizeSession('sdk-id', {
        providerID: 'anthropic',
        modelID: 'claude-x',
      }),
    ).rejects.toThrow();
  });

  it('forkSession rejects with engine-not-ready AppError when uninitialized', async () => {
    await expect(svc.forkSession('sdk-id')).rejects.toThrow();
  });

  it('listChildren rejects with engine-not-ready AppError when uninitialized', async () => {
    await expect(svc.listChildren('sdk-id')).rejects.toThrow();
  });

  it('listMcp rejects with engine-not-ready AppError when uninitialized', async () => {
    await expect(svc.listMcp()).rejects.toThrow();
  });

  it('connectMcp rejects with engine-not-ready AppError when uninitialized', async () => {
    await expect(svc.connectMcp('my-server')).rejects.toThrow();
  });

  it('disconnectMcp rejects with engine-not-ready AppError when uninitialized', async () => {
    await expect(svc.disconnectMcp('my-server')).rejects.toThrow();
  });

  it('error message contains "engine not ready" or "not initialized"', async () => {
    try {
      await svc.getSessionDiff('sdk-id');
      expect.fail('should have thrown');
    } catch (err) {
      expect(String(err)).toMatch(/not (ready|initialized)|engine/i);
    }
  });
});

// ── Additional wrappers: listMessages, getTodo, revertSession, etc. ────────────

describe('wrapper method shapes (M3/M4 readiness)', () => {
  let svc: OpencodeClientService;
  let sdkClient: ReturnType<typeof makeRealSdkClient>;

  beforeEach(() => {
    svc = new OpencodeClientService();
    sdkClient = makeRealSdkClient();
    injectClient(svc, sdkClient);
  });

  it('listMessages calls session.messages with path.id', async () => {
    sdkClient.session.messages.mockResolvedValue({ data: [] });
    await svc.listMessages('sdk-msg-id');
    expect(sdkClient.session.messages).toHaveBeenCalledWith(
      expect.objectContaining({ path: { id: 'sdk-msg-id' } }),
    );
  });

  it('getTodo calls session.todo with path.id', async () => {
    sdkClient.session.todo.mockResolvedValue({ data: [] });
    await svc.getTodo('sdk-todo-id');
    expect(sdkClient.session.todo).toHaveBeenCalledWith(
      expect.objectContaining({ path: { id: 'sdk-todo-id' } }),
    );
  });

  it('revertSession calls session.revert with path.id and optional messageId', async () => {
    sdkClient.session.revert.mockResolvedValue({ data: { id: 'sdk-revert-id' } });
    await svc.revertSession('sdk-revert-id', 'msg-111');
    expect(sdkClient.session.revert).toHaveBeenCalledTimes(1);
    const call = sdkClient.session.revert.mock.calls[0]![0] as {
      path: { id: string };
      body: { messageID: string };
    };
    expect(call.path.id).toBe('sdk-revert-id');
    expect(call.body.messageID).toBe('msg-111');
  });

  it('unrevertSession calls session.unrevert with path.id', async () => {
    sdkClient.session.unrevert.mockResolvedValue({ data: { id: 'sdk-unrevert-id' } });
    await svc.unrevertSession('sdk-unrevert-id');
    expect(sdkClient.session.unrevert).toHaveBeenCalledWith(
      expect.objectContaining({ path: { id: 'sdk-unrevert-id' } }),
    );
  });

  it('summarizeSession calls session.summarize with path.id AND the model body (OPC-M3-3)', async () => {
    sdkClient.session.summarize.mockResolvedValue({ data: true });
    await svc.summarizeSession('sdk-sum-id', {
      providerID: 'anthropic',
      modelID: 'claude-x',
    });
    expect(sdkClient.session.summarize).toHaveBeenCalledTimes(1);
    const call = sdkClient.session.summarize.mock.calls[0]![0] as {
      path: { id: string };
      body: { providerID: string; modelID: string };
    };
    expect(call.path.id).toBe('sdk-sum-id');
    // session.summarize REQUIRES the model body — omitting it errored with
    // "expected string, received undefined" at runtime.
    expect(call.body).toEqual({ providerID: 'anthropic', modelID: 'claude-x' });
  });

  it('forkSession calls session.fork with path.id and optional messageID', async () => {
    sdkClient.session.fork.mockResolvedValue({ data: { id: 'forked-session' } });
    await svc.forkSession('sdk-fork-id', 'msg-fork-1');
    const call = sdkClient.session.fork.mock.calls[0]![0] as {
      path: { id: string };
      body: { messageID: string };
    };
    expect(call.path.id).toBe('sdk-fork-id');
    expect(call.body.messageID).toBe('msg-fork-1');
  });

  it('listChildren calls session.children with path.id', async () => {
    sdkClient.session.children.mockResolvedValue({ data: [] });
    await svc.listChildren('sdk-parent-id');
    expect(sdkClient.session.children).toHaveBeenCalledWith(
      expect.objectContaining({ path: { id: 'sdk-parent-id' } }),
    );
  });

  it('listMcp calls mcp.status and returns the data map', async () => {
    const mcpMap = { 'my-server': { type: 'connected', id: 'my-server' } };
    sdkClient.mcp.status.mockResolvedValue({ data: mcpMap });
    const result = await svc.listMcp();
    expect(sdkClient.mcp.status).toHaveBeenCalledTimes(1);
    expect(result).toEqual(mcpMap);
  });

  it('connectMcp calls mcp.connect with path.name', async () => {
    sdkClient.mcp.connect.mockResolvedValue({ data: true });
    await svc.connectMcp('my-mcp-server');
    expect(sdkClient.mcp.connect).toHaveBeenCalledWith(
      expect.objectContaining({ path: { name: 'my-mcp-server' } }),
    );
  });

  it('disconnectMcp calls mcp.disconnect with path.name', async () => {
    sdkClient.mcp.disconnect.mockResolvedValue({ data: true });
    await svc.disconnectMcp('my-mcp-server');
    expect(sdkClient.mcp.disconnect).toHaveBeenCalledWith(
      expect.objectContaining({ path: { name: 'my-mcp-server' } }),
    );
  });
});

// ── issue-716: addMcp persists to opencode.json before calling the SDK ───────

describe('issue-716: addMcp persists new server to opencode.json before calling SDK', () => {
  let svc: OpencodeClientService;
  let sdkClient: ReturnType<typeof makeRealSdkClient> & { mcp: { add: ReturnType<typeof vi.fn> } };

  beforeEach(() => {
    svc = new OpencodeClientService();
    // Extend the fake client with the mcp.add method that addMcp needs.
    const base = makeRealSdkClient();
    sdkClient = {
      ...base,
      mcp: { ...base.mcp, add: vi.fn() },
    } as ReturnType<typeof makeRealSdkClient> & { mcp: { add: ReturnType<typeof vi.fn> } };
    injectClient(svc, sdkClient as unknown as ReturnType<typeof makeRealSdkClient>);
  });

  it('writes the new server to opencode.json and calls mcp.add with name+config', async () => {
    const updatedMap = { 'test-server': { status: 'connected' }, 'rhythm': { status: 'connected' } };
    sdkClient.mcp.add.mockResolvedValue({ data: updatedMap });

    // Use a temp dir so we don't touch the real config.
    const os = await import('os');
    const path = await import('path');
    const fs = await import('fs');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-test-'));
    const configPath = path.join(tmpDir, 'opencode.json');

    // Stub homedir so the service writes to our tmpDir.
    const originalHomedir = os.homedir;
    // The service uses require('os').homedir(), so we patch the module cache.
    const osMod = require('os') as typeof import('os');
    const origHomedirFn = osMod.homedir;
    osMod.homedir = () => tmpDir;

    try {
      const config = { type: 'local' as const, command: ['npx', '-y', 'test-mcp'] };
      const result = await svc.addMcp('test-server', config);

      // The SDK was called with the right arguments.
      expect(sdkClient.mcp.add).toHaveBeenCalledOnce();
      const addCall = sdkClient.mcp.add.mock.calls[0]![0] as {
        body: { name: string; config: unknown };
      };
      expect(addCall.body.name).toBe('test-server');
      expect(addCall.body.config).toEqual(config);

      // opencode.json was written with the new server.
      const writtenPath = path.join(tmpDir, '.config', 'opencode', 'opencode.json');
      expect(fs.existsSync(writtenPath)).toBe(true);
      const written = JSON.parse(fs.readFileSync(writtenPath, 'utf8')) as Record<string, unknown>;
      const mcp = written.mcp as Record<string, unknown>;
      expect(mcp).toHaveProperty('test-server');
      expect((mcp['test-server'] as Record<string, unknown>).type).toBe('local');

      // The return value from the SDK is forwarded.
      expect(result).toEqual(updatedMap);
    } finally {
      osMod.homedir = origHomedirFn;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('preserves existing servers in opencode.json when adding a new one', async () => {
    sdkClient.mcp.add.mockResolvedValue({ data: { 'existing': { status: 'connected' }, 'new-server': { status: 'connected' } } });

    const os = await import('os');
    const path = await import('path');
    const fs = await import('fs');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-test2-'));
    const configDir = path.join(tmpDir, '.config', 'opencode');
    fs.mkdirSync(configDir, { recursive: true });
    // Pre-write an existing config with one server already in it.
    const existingConfig = {
      mcp: {
        existing: { type: 'local', command: ['npx', 'existing-server'] },
      },
    };
    fs.writeFileSync(
      path.join(configDir, 'opencode.json'),
      JSON.stringify(existingConfig, null, 2),
    );

    const osMod = require('os') as typeof import('os');
    const origHomedirFn = osMod.homedir;
    osMod.homedir = () => tmpDir;

    try {
      await svc.addMcp('new-server', { type: 'local', command: ['npx', 'new-server'] });

      const written = JSON.parse(
        fs.readFileSync(path.join(configDir, 'opencode.json'), 'utf8'),
      ) as Record<string, unknown>;
      const mcp = written.mcp as Record<string, unknown>;
      // Both old and new entries must be present.
      expect(mcp).toHaveProperty('existing');
      expect(mcp).toHaveProperty('new-server');
    } finally {
      osMod.homedir = origHomedirFn;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws AppError when SDK mcp.add returns an error envelope (after persisting)', async () => {
    sdkClient.mcp.add.mockResolvedValue({ error: { message: 'bad request' } });

    const os = await import('os');
    const path = await import('path');
    const fs = await import('fs');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opc-test3-'));

    const osMod = require('os') as typeof import('os');
    const origHomedirFn = osMod.homedir;
    osMod.homedir = () => tmpDir;

    try {
      await expect(
        svc.addMcp('bad-server', { type: 'local', command: ['npx', 'bad'] }),
      ).rejects.toMatchObject({ statusCode: 502 });
    } finally {
      osMod.homedir = origHomedirFn;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── issue-689 repair: getSession discriminates gone vs transport failure ─────

describe('issue-689 repair: getSession gone-vs-transport discrimination', () => {
  let svc: OpencodeClientService;
  let sdkClient: ReturnType<typeof makeRealSdkClient>;

  beforeEach(() => {
    svc = new OpencodeClientService();
    sdkClient = makeRealSdkClient();
    injectClient(svc, sdkClient);
  });

  it('error envelope (engine answered, id unknown) returns null — genuinely gone', async () => {
    sdkClient.session.get.mockResolvedValue({ error: { message: 'not found' } });
    await expect(svc.getSession('ses_gone')).resolves.toBeNull();
  });

  it('thrown transport error rethrows AppError 502 — never null (would 410 a live session)', async () => {
    sdkClient.session.get.mockRejectedValue(new Error('socket hang up'));
    await expect(svc.getSession('ses_live')).rejects.toMatchObject({
      statusCode: 502,
      message: expect.stringContaining('transport failure'),
    });
  });
});
