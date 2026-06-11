/**
 * Acceptance-contract tests for issue #677
 * "Expose build commit in /health so Synology deploys are verifiable"
 *
 * c1: GET /health returns the build commit (and builtAt) when the image's
 *     build-info env vars are set.
 * c2: Local/dev runs without the env vars return commit: 'dev'.
 *
 * Both MUST FAIL on the current health_controller.ts (returns only
 * {status, service}) and PASS after the fix.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { AddressInfo } from 'node:net';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';

vi.mock('../services/opencode_engine', () => {
  const mockClient = {
    isReady: true,
    listProviders: vi.fn().mockResolvedValue([]),
    listAuthedProviders: vi.fn().mockResolvedValue([]),
    statusMessage: 'Opencode SDK ready',
    createSession: vi.fn().mockResolvedValue({ id: 'sdk-session-677' }),
    setAuth: vi.fn().mockResolvedValue(true),
    prompt: vi.fn().mockResolvedValue({}),
    promptAsync: vi.fn().mockResolvedValue(true),
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    ensureReady: vi.fn().mockResolvedValue(true),
  };
  return { opencodeClient: mockClient, opencodeSessionMap: new Map<string, string>() };
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

import { createApp } from '../app';

const COMMIT = 'abc1234def5678';
const BUILT_AT = '2026-06-11T16:00:00Z';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('health route — issue #677: build commit in /health', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  const savedCommit = process.env.RHYTHM_BUILD_COMMIT;
  const savedBuiltAt = process.env.RHYTHM_BUILD_TIME;

  beforeEach(async () => {
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
    if (savedCommit === undefined) delete process.env.RHYTHM_BUILD_COMMIT;
    else process.env.RHYTHM_BUILD_COMMIT = savedCommit;
    if (savedBuiltAt === undefined) delete process.env.RHYTHM_BUILD_TIME;
    else process.env.RHYTHM_BUILD_TIME = savedBuiltAt;
    vi.clearAllMocks();
  });

  it('issue-677-c1: /health returns commit and builtAt from build-info env vars', async () => {
    process.env.RHYTHM_BUILD_COMMIT = COMMIT;
    process.env.RHYTHM_BUILD_TIME = BUILT_AT;

    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe('ok');
    expect(body.commit).toBe(COMMIT);
    expect(body.builtAt).toBe(BUILT_AT);
  });

  it("issue-677-c2: /health returns commit 'dev' when build-info env vars are unset", async () => {
    delete process.env.RHYTHM_BUILD_COMMIT;
    delete process.env.RHYTHM_BUILD_TIME;

    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.commit).toBe('dev');
    expect(body).not.toHaveProperty('builtAt');
  });
});
