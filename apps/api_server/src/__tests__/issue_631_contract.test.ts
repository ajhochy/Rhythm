/**
 * Acceptance-contract tests for issue #631
 * "Follow-up #610: slash-command popover opens but command list is empty"
 *
 * Root cause: GET /opencode/commands is a hard-coded placeholder returning [].
 * The opencode SDK (@opencode-ai/sdk) exposes client.command.list() which
 * returns Array<Command> ({ name, description, agent?, model?, template, subtask? }).
 *
 * Fix required:
 *   1. OpencodeClientService.listCommands() — new method that:
 *      - Returns [] when !this.isReady (mirror guard style of listProviders)
 *      - Calls this.client.command.list(), unwraps result with the same
 *        { data, error } envelope pattern used by other methods
 *      - Maps each Command to { name, description } (drop other fields)
 *      - Wraps in try/catch, returns [] on error
 *   2. GET /opencode/commands in app.ts — calls await opencodeClient.listCommands()
 *      and returns the array; removes the stale hard-coded [] comment
 *
 * These tests MUST fail before the fix and pass after it.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { AddressInfo } from 'node:net';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';

// ---------------------------------------------------------------------------
// Mock opencode engine. We control command.list() per test.
// Use vi.hoisted so the spy factory is available inside vi.mock().
// ---------------------------------------------------------------------------
const { commandListSpy } = vi.hoisted(() => ({
  commandListSpy: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => {
  let _ready = true;
  const mockCommandClient = {
    list: commandListSpy,
  };
  const mockClient = {
    get isReady() { return _ready; },
    // Exposed for per-test override
    set isReady(v: boolean) { _ready = v; },
    listProviders: vi.fn().mockResolvedValue(['anthropic']),
    listAuthedProviders: vi.fn().mockResolvedValue(['anthropic']),
    statusMessage: 'Opencode SDK ready',
    createSession: vi.fn().mockResolvedValue({ id: 'sdk-session-631' }),
    setAuth: vi.fn().mockResolvedValue(true),
    promptAsync: vi.fn().mockResolvedValue(true),
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    ensureReady: vi.fn().mockImplementation(async () => _ready),
    // listCommands is the method under test — not mocked here, exercised via the real service
    command: mockCommandClient,
  };
  return {
    opencodeClient: mockClient,
    opencodeSessionMap: new Map<string, string>(),
  };
});

vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: {
    streamSession: vi.fn().mockResolvedValue(undefined),
    stopStream: vi.fn(),
    dispose: vi.fn(),
    clearPendingPermission: vi.fn(),
  },
}));

vi.mock('../services/ws_gateway', () => ({
  broadcast: vi.fn(),
  broadcastSessionUpdated: vi.fn(),
  broadcastSessionRemoved: vi.fn(),
}));

// ---------------------------------------------------------------------------
// App + DB helpers
// ---------------------------------------------------------------------------
import { createApp } from '../app';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

// ---------------------------------------------------------------------------
// Unit tests for OpencodeClientService.listCommands()
//
// We test the method directly by importing the real class and constructing
// an instance with a controlled client underneath (via monkey-patching the
// private `client` field, the same pattern used in opencode_client_service.test.ts).
// ---------------------------------------------------------------------------

import { OpencodeClientService } from '../services/opencode_client_service';

describe('OpencodeClientService.listCommands() — issue #631', () => {
  let service: OpencodeClientService;

  beforeEach(() => {
    commandListSpy.mockClear();
    service = new OpencodeClientService();
  });

  // -------------------------------------------------------------------------
  // c1 — returns [] when not ready
  //
  // FAILS today: listCommands does not exist on OpencodeClientService.
  // TypeError: service.listCommands is not a function
  //
  // PASSES after fix: method exists and returns [] when client is null.
  // -------------------------------------------------------------------------

  it('issue-631-c1: listCommands returns [] when not ready', async () => {
    // Service is freshly constructed — status is 'uninitialized', client is null.
    // @ts-expect-error accessing private field for test
    expect(service.client).toBeNull();

    // CONTRACT: must return [] without throwing when not ready.
    const result = await service.listCommands();
    expect(result).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // c2 — maps SDK commands to { name, description }
  //
  // FAILS today: listCommands does not exist.
  //
  // PASSES after fix: method calls client.command.list(), unwraps the
  // { data: Array<Command> } envelope, and returns mapped objects with only
  // name and description (template, agent, model, subtask are dropped).
  // -------------------------------------------------------------------------

  it('issue-631-c2: listCommands maps SDK commands to {name, description}', async () => {
    // Inject a fake client with two commands that have extra fields.
    const fakeCommands = [
      {
        name: 'review',
        description: 'Review the current diff',
        agent: 'claude-code',
        model: 'claude-opus-4-7',
        template: 'Please review: {{input}}',
        subtask: false,
      },
      {
        name: 'commit',
        description: undefined,
        template: 'Commit with message: {{input}}',
      },
    ];
    commandListSpy.mockResolvedValueOnce({ data: fakeCommands, error: undefined });

    // Force the service into a ready state with a fake client.
    service['client'] = { command: { list: commandListSpy } } as never;
    service['status'] = 'ready' as never;

    const result = await service.listCommands();

    // CONTRACT: must return exactly the two commands, mapped to {name, description}.
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: 'review', description: 'Review the current diff' });
    // Command with no description — must still be present, description may be undefined.
    expect(result[1].name).toBe('commit');
    // CONTRACT: extra fields (template, agent, model, subtask) must NOT be present.
    expect(result[0]).not.toHaveProperty('template');
    expect(result[0]).not.toHaveProperty('agent');
    expect(result[0]).not.toHaveProperty('model');
    expect(result[0]).not.toHaveProperty('subtask');
  });

  // -------------------------------------------------------------------------
  // c3 — returns [] on SDK error (resilient)
  //
  // FAILS today: listCommands does not exist.
  //
  // PASSES after fix: try/catch swallows the error and returns [].
  // -------------------------------------------------------------------------

  it('issue-631-c3: listCommands returns [] on SDK error', async () => {
    commandListSpy.mockRejectedValueOnce(new Error('SDK command.list failed'));

    // Force service into ready state.
    service['client'] = { command: { list: commandListSpy } } as never;
    service['status'] = 'ready' as never;

    // CONTRACT: must not throw — must return [] silently.
    const result = await service.listCommands();
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Integration test: GET /opencode/commands route
// ---------------------------------------------------------------------------

describe('GET /opencode/commands — issue #631', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;

  beforeEach(async () => {
    commandListSpy.mockClear();
    setDb(makeDb());

    const server = createApp().listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
    closeServer = () =>
      new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res())));
  });

  afterEach(async () => {
    await closeServer();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // c4 — GET /opencode/commands returns commands from SDK (not hard-coded [])
  //
  // FAILS today: route is hard-coded `res.json([])` — it never calls listCommands().
  // Even if listCommands() were somehow called, it doesn't exist yet.
  //
  // After fix:
  //   - opencodeClient.listCommands() is called (method exists)
  //   - The route returns the mapped array
  //
  // The mock for opencodeClient does NOT provide listCommands() — only the
  // real app's opencodeClient (imported via opencode_engine) is used.
  // We patch the mock client with a listCommands spy that returns two commands.
  // -------------------------------------------------------------------------

  it('issue-631-c4: GET /opencode/commands returns commands from SDK', async () => {
    // Patch the mocked opencodeClient to include listCommands.
    const { opencodeClient } = await import('../services/opencode_engine');
    const fakeResult = [
      { name: 'review', description: 'Review the diff' },
      { name: 'commit', description: undefined },
    ];
    // Attach listCommands to the mock client so the route can call it.
    (opencodeClient as unknown as Record<string, unknown>)['listCommands'] = vi
      .fn()
      .mockResolvedValue(fakeResult);

    const res = await fetch(`${baseUrl}/opencode/commands`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];

    // CONTRACT: must return the mapped array (not hard-coded []).
    expect(body).toHaveLength(2);
    expect((body[0] as { name: string }).name).toBe('review');
    expect((body[1] as { name: string }).name).toBe('commit');

    // CONTRACT: listCommands was called (not a hard-coded []).
    const listCommandsMock = (opencodeClient as unknown as Record<string, unknown>)['listCommands'] as ReturnType<typeof vi.fn>;
    expect(listCommandsMock).toHaveBeenCalledOnce();
  });
});
