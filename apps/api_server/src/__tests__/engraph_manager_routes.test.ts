/**
 * #1096 WP1 — POST/GET /engraph-manager/*
 *
 * Locks:
 *   - AGENT_LOCAL bypass + requireAuth gate matches every other agent-local
 *     surface (loopback = trust boundary on :4001; real Bearer token
 *     required on hosted prod) — same contract as system_refresh_routes.test.ts.
 *   - No write/content-reading endpoint is exposed by this router — it only
 *     ever controls the manager's own lifecycle.
 *   - A malicious/garbage executable path passed to choose-binary is
 *     rejected, not persisted.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { startTestServer } from './helpers/real_server';

const getStatus = vi.fn().mockReturnValue({ enabled: false, state: 'disabled' });
const discover = vi.fn().mockReturnValue([]);
const chooseBinary = vi.fn().mockResolvedValue({ ok: true });
const enable = vi.fn().mockResolvedValue({ ok: true });
const disable = vi.fn().mockResolvedValue(undefined);
const checkHealthNow = vi.fn().mockResolvedValue({ ok: true, latencyMs: 12 });
const retry = vi.fn().mockResolvedValue({ ok: true });
const rebuild = vi.fn().mockResolvedValue({ ok: true });

vi.mock('../services/engraph_manager', () => ({
  engraphManager: {
    getStatus: (...a: unknown[]) => getStatus(...a),
    discover: (...a: unknown[]) => discover(...a),
    chooseBinary: (...a: unknown[]) => chooseBinary(...a),
    enable: (...a: unknown[]) => enable(...a),
    disable: (...a: unknown[]) => disable(...a),
    checkHealthNow: (...a: unknown[]) => checkHealthNow(...a),
    retry: (...a: unknown[]) => retry(...a),
    rebuild: (...a: unknown[]) => rebuild(...a),
  },
}));

async function makeApp(agentLocal: boolean) {
  vi.resetModules();
  vi.stubEnv('AGENT_LOCAL', agentLocal ? 'true' : '');
  const { setDb: setDbFresh } = await import('../database/db');
  const { runMigrations: runMigrationsFresh } = await import('../database/migrations');
  const db = new Database(':memory:');
  runMigrationsFresh(db);
  setDbFresh(db);
  const { createApp } = await import('../app');
  return startTestServer(createApp());
}

describe('/engraph-manager — auth convention', () => {
  let close: (() => Promise<void>) | undefined;

  beforeEach(() => {
    getStatus.mockClear(); discover.mockClear(); chooseBinary.mockClear();
    enable.mockClear(); disable.mockClear(); checkHealthNow.mockClear();
    retry.mockClear(); rebuild.mockClear();
  });
  afterEach(async () => {
    if (close) await close();
    close = undefined;
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const routes: Array<{ method: 'GET' | 'POST'; path: string }> = [
    { method: 'GET', path: '/status' },
    { method: 'GET', path: '/discover' },
    { method: 'POST', path: '/enable' },
    { method: 'POST', path: '/disable' },
    { method: 'POST', path: '/check-health' },
    { method: 'POST', path: '/retry' },
    { method: 'POST', path: '/rebuild' },
  ];

  it('AGENT_LOCAL=true → every action/status route is reachable without a bearer token', async () => {
    const app = await makeApp(true);
    close = app.close;
    for (const { method, path } of routes) {
      const res = await fetch(`${app.baseUrl}/engraph-manager${path}`, { method });
      expect(res.status, `${method} ${path}`).not.toBe(401);
    }
  });

  it('AGENT_LOCAL unset → every action/status route requires a bearer token (401)', async () => {
    const app = await makeApp(false);
    close = app.close;
    for (const { method, path } of routes) {
      const res = await fetch(`${app.baseUrl}/engraph-manager${path}`, { method });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
    expect(getStatus).not.toHaveBeenCalled();
    expect(enable).not.toHaveBeenCalled();
  });

  it('non-loopback caller with no token still gets 401 (loopback boundary + auth both apply on prod)', async () => {
    const app = await makeApp(false);
    close = app.close;
    const res = await fetch(`${app.baseUrl}/engraph-manager/status`, {
      headers: { 'x-forwarded-for': '203.0.113.9' },
    });
    expect(res.status).toBe(401);
  });

  it('enable/retry/rebuild respond immediately without waiting for the (slow) lifecycle action to finish', async () => {
    const app = await makeApp(true);
    close = app.close;

    let releaseEnable: () => void = () => {};
    const slowEnable = new Promise<{ ok: boolean }>((resolve) => {
      releaseEnable = () => resolve({ ok: true });
    });
    enable.mockReturnValueOnce(slowEnable);

    const start = Date.now();
    const res = await fetch(`${app.baseUrl}/engraph-manager/enable`, { method: 'POST' });
    const elapsedMs = Date.now() - start;
    expect(res.status).toBe(200);
    expect(elapsedMs).toBeLessThan(500); // the response did NOT wait on slowEnable
    const body = (await res.json()) as { accepted: boolean };
    expect(body.accepted).toBe(true);

    releaseEnable(); // let the background action resolve so it doesn't leak into other tests
    await slowEnable;
  });

  it('choose-binary requires a path in the body', async () => {
    const app = await makeApp(true);
    close = app.close;
    const res = await fetch(`${app.baseUrl}/engraph-manager/choose-binary`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(chooseBinary).not.toHaveBeenCalled();
  });

  it('exposes no write/content-reading endpoint — only the documented lifecycle actions', async () => {
    const app = await makeApp(true);
    close = app.close;
    for (const path of ['/search', '/read', '/create', '/note', '/content']) {
      const res = await fetch(`${app.baseUrl}/engraph-manager${path}`, { method: 'POST' });
      expect(res.status, path).toBe(404);
    }
    // The status/discover endpoints are GET-only (no mutation via GET).
    const putStatus = await fetch(`${app.baseUrl}/engraph-manager/status`, { method: 'PUT' });
    expect(putStatus.status).toBe(404);
  });
});

describe('/engraph-manager/choose-binary — malicious path rejection (real manager, no mock)', () => {
  let close: (() => Promise<void>) | undefined;
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'engraph-routes-cfg-'));
  });
  afterEach(async () => {
    if (close) await close();
    close = undefined;
    vi.unstubAllEnvs();
    vi.resetModules();
    rmSync(configDir, { recursive: true, force: true });
  });

  async function makeRealApp() {
    vi.resetModules();
    vi.doUnmock('../services/engraph_manager');
    vi.stubEnv('AGENT_LOCAL', 'true');
    vi.stubEnv('RHYTHM_ENGRAPH_MANAGER_CONFIG_FILE', join(configDir, 'config.json'));
    const { setDb: setDbFresh } = await import('../database/db');
    const { runMigrations: runMigrationsFresh } = await import('../database/migrations');
    const db = new Database(':memory:');
    runMigrationsFresh(db);
    setDbFresh(db);
    const { createApp } = await import('../app');
    return startTestServer(createApp());
  }

  it('rejects a path-traversal / nonexistent executable path and persists nothing', async () => {
    const app = await makeRealApp();
    close = app.close;

    const res = await fetch(`${app.baseUrl}/engraph-manager/choose-binary`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/tmp/../etc/passwd' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; reason?: string };
    expect(body.ok).toBe(false);

    const status = await fetch(`${app.baseUrl}/engraph-manager/status`);
    const statusBody = (await status.json()) as { executablePath: string | null };
    expect(statusBody.executablePath).toBeNull();
  });
});
