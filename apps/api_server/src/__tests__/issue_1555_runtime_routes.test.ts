import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { startTestServer } from './helpers/real_server';

// Each case deliberately reloads the real app graph so env/auth changes cannot leak between routes.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const mocks = vi.hoisted(() => ({
  getEngineIdentity: vi.fn(),
  reloadCredentials: vi.fn(),
  ensureReady: vi.fn(),
  pendingPermissions: [] as Array<{
    sessionId: string;
    permissionId: string;
    toolName: string;
    summary: string;
  }>,
}));

vi.mock('../services/opencode_engine', () => ({
  OPENCODE_ENGINE_PORT: 7441,
  opencodeClient: {
    isReady: true,
    statusMessage: 'Opencode SDK ready',
    websearchConfigured: false,
    getEngineIdentity: (...args: unknown[]) => mocks.getEngineIdentity(...args),
    reloadCredentials: (...args: unknown[]) => mocks.reloadCredentials(...args),
    ensureReady: (...args: unknown[]) => mocks.ensureReady(...args),
  },
}));

vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: {
    isLive: true,
    listPendingPermissions: () => mocks.pendingPermissions,
    suspendGlobalStreamForLiveTest: vi.fn(),
    resumeGlobalStreamForLiveTest: vi.fn(),
  },
}));

async function makeApp(options: {
  agentLocal?: boolean;
  restartTimeoutMs?: number;
} = {}) {
  vi.resetModules();
  vi.stubEnv('AGENT_LOCAL', options.agentLocal === false ? '' : 'true');
  vi.stubEnv('PORT', '7440');
  vi.stubEnv('RHYTHM_OPENCODE_ENGINE_PORT', '7441');
  vi.stubEnv('RHYTHM_ENGINE_RESTART_TIMEOUT_MS', String(options.restartTimeoutMs ?? 1_000));

  const { setDb } = await import('../database/db');
  const { runMigrations } = await import('../database/migrations');
  const db = new Database(':memory:');
  runMigrations(db);
  setDb(db);

  const { createApp } = await import('../app');
  const server = await startTestServer(createApp());
  return { ...server, db };
}

describe('issue #1555 runtime routes', () => {
  let close: (() => Promise<void>) | undefined;

  beforeEach(() => {
    mocks.getEngineIdentity.mockReset().mockResolvedValue({
      pid: 1234,
      bootId: 'boot-A',
      version: '1.14.49',
    });
    mocks.reloadCredentials.mockReset().mockResolvedValue(undefined);
    mocks.ensureReady.mockReset().mockResolvedValue(true);
    mocks.pendingPermissions = [];
  });

  afterEach(async () => {
    if (close) await close();
    close = undefined;
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('1555:api-runtime-read-and-engine-restart:1 returns real runtime facts locally', async () => {
    const app = await makeApp();
    close = app.close;

    const response = await fetch(`${app.baseUrl}/opencode/runtime`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      engine: {
        port: 7441,
        pid: 1234,
        bootId: 'boot-A',
        version: '1.14.49',
        status: 'ready',
        bridgeLive: true,
      },
      api: { port: 7440 },
      remoteOverride: null,
    });
  });

  it('1555:api-runtime-read-and-engine-restart:2 requires auth outside AGENT_LOCAL', async () => {
    const app = await makeApp({ agentLocal: false });
    close = app.close;

    const response = await fetch(`${app.baseUrl}/opencode/runtime`);
    expect(response.status).toBe(401);
  });

  it('1555:api-runtime-read-and-engine-restart:3 reports an unavailable engine identity', async () => {
    mocks.getEngineIdentity.mockResolvedValue(null);
    const app = await makeApp();
    close = app.close;

    const response = await fetch(`${app.baseUrl}/opencode/runtime`);
    expect(response.status).toBe(200);
    const body = await response.json() as {
      engine: { status: string; pid: number | null; bootId: string | null };
    };
    expect(body.engine).toMatchObject({
      status: 'unavailable',
      pid: null,
      bootId: null,
    });
  });

  it('1555:api-runtime-read-and-engine-restart:4 restarts only the engine and proves a new boot', async () => {
    mocks.getEngineIdentity
      .mockResolvedValueOnce({ pid: 1234, bootId: 'A', version: '1.14.49' })
      .mockResolvedValueOnce({ pid: 5678, bootId: 'B', version: '1.14.49' });
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const app = await makeApp();
    close = app.close;

    const response = await fetch(`${app.baseUrl}/system/restart-engine`, { method: 'POST' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ready',
      bootId: 'B',
      previousBootId: 'A',
    });
    expect(mocks.reloadCredentials).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
    exit.mockRestore();
  });

  it('1555:api-runtime-read-and-engine-restart:5 refuses active sessions and pending permissions before teardown', async () => {
    mocks.pendingPermissions = [{
      sessionId: 'permission-session',
      permissionId: 'permission-7',
      toolName: 'bash',
      summary: 'Approve deployment',
    }];
    const app = await makeApp();
    close = app.close;
    app.db.prepare(
      `INSERT INTO agent_sessions (id, agent_kind, status, cwd, name)
       VALUES ('working-session', 'build', 'working', '/tmp', 'Working agent')`,
    ).run();

    const response = await fetch(`${app.baseUrl}/system/restart-engine`, { method: 'POST' });
    expect(response.status).toBe(409);
    const body = await response.json() as { blockers: Array<Record<string, unknown>> };
    expect(body.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'session', id: 'working-session', status: 'working' }),
      expect.objectContaining({
        type: 'permission',
        sessionId: 'permission-session',
        permissionId: 'permission-7',
      }),
    ]));
    expect(mocks.reloadCredentials).not.toHaveBeenCalled();
  });

  it('1555:api-runtime-read-and-engine-restart:6 returns 503 on a bounded timeout and keeps health usable', async () => {
    mocks.reloadCredentials.mockImplementation(() => new Promise<void>(() => {}));
    const app = await makeApp({ restartTimeoutMs: 10 });
    close = app.close;

    const response = await fetch(`${app.baseUrl}/system/restart-engine`, { method: 'POST' });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: 'unavailable',
      statusMessage: 'Opencode SDK ready',
    });
    expect((await fetch(`${app.baseUrl}/health`)).status).toBe(200);
  });

  it('1555:api-runtime-read-and-engine-restart:7 serializes concurrent restarts', async () => {
    let release!: () => void;
    mocks.reloadCredentials.mockImplementationOnce(
      () => new Promise<void>((resolve) => { release = resolve; }),
    );
    mocks.getEngineIdentity
      .mockResolvedValueOnce({ pid: 1234, bootId: 'A', version: '1.14.49' })
      .mockResolvedValueOnce({ pid: 5678, bootId: 'B', version: '1.14.49' });
    const app = await makeApp();
    close = app.close;

    const first = fetch(`${app.baseUrl}/system/restart-engine`, { method: 'POST' });
    await vi.waitFor(() => expect(mocks.reloadCredentials).toHaveBeenCalledTimes(1));
    const second = await fetch(`${app.baseUrl}/system/restart-engine`, { method: 'POST' });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ reason: 'restart in progress' });
    release();
    expect((await first).status).toBe(200);
    expect(mocks.reloadCredentials).toHaveBeenCalledTimes(1);
  });

  it('1555:api-runtime-read-and-engine-restart:8 does not add PATCH runtime state', async () => {
    const app = await makeApp();
    close = app.close;

    const response = await fetch(`${app.baseUrl}/opencode/runtime`, { method: 'PATCH' });
    expect(response.status).toBe(404);
  });

  it('review:system_routes.ts:46 rechecks blockers after identity lookup and before teardown', async () => {
    let releaseIdentity!: (identity: { pid: number; bootId: string; version: string }) => void;
    mocks.getEngineIdentity.mockImplementationOnce(
      () => new Promise((resolve) => { releaseIdentity = resolve; }),
    );
    const app = await makeApp();
    close = app.close;

    const pending = fetch(`${app.baseUrl}/system/restart-engine`, { method: 'POST' });
    await vi.waitFor(() => expect(mocks.getEngineIdentity).toHaveBeenCalledTimes(1));
    app.db.prepare(
      `INSERT INTO agent_sessions (id, agent_kind, status, cwd, name)
       VALUES ('late-working-session', 'build', 'working', '/tmp', 'Late working agent')`,
    ).run();
    releaseIdentity({ pid: 1234, bootId: 'A', version: '1.14.49' });

    const response = await pending;
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      status: 'blocked',
      blockers: [expect.objectContaining({ id: 'late-working-session', status: 'working' })],
    });
    expect(mocks.reloadCredentials).not.toHaveBeenCalled();
  });
});
