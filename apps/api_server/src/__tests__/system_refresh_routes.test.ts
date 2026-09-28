/**
 * system_refresh_routes.test.ts — #948: POST /system/refresh
 *
 * Locks two contracts:
 *   • the endpoint calls opencodeClient.reloadSkills and returns the refreshed
 *     cache list (so a config-repair agent can hot-reload skills without a
 *     server restart);
 *   • AGENT_LOCAL bypass + requireAuth gate matches every other agent surface
 *     (loopback = trust boundary on :4001; real Bearer token required on prod).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { startTestServer } from './helpers/real_server';

const { configuredSnapshot } = vi.hoisted(() => ({ configuredSnapshot: vi.fn(() => JSON.stringify({ provider: {} })) }));
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  return {
    ...real,
    readFileSync: (path: string, encoding: BufferEncoding) =>
      path.endsWith('/.config/opencode/opencode.json')
        ? configuredSnapshot()
        : real.readFileSync(path, encoding),
  };
});

const reloadSkills = vi.fn().mockResolvedValue([]);
const reloadConfig = vi.fn().mockResolvedValue(true);
const listProviders = vi.fn().mockResolvedValue([]);
const providerSnapshot = vi.fn().mockResolvedValue({ providers: [] });

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    reloadSkills: (...args: unknown[]) => reloadSkills(...args),
    reloadConfig: (...args: unknown[]) => reloadConfig(...args),
    listProviders: (...args: unknown[]) => listProviders(...args),
    providerSnapshot: (...args: unknown[]) => providerSnapshot(...args),
    resetProbeCache: vi.fn(),
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

describe('POST /system/refresh — #948', () => {
  let close: (() => Promise<void>) | undefined;

  beforeEach(() => {
    reloadSkills.mockClear();
    reloadConfig.mockClear();
    configuredSnapshot.mockReturnValue(JSON.stringify({ provider: {} }));
    listProviders.mockResolvedValue([]);
    providerSnapshot.mockResolvedValue({ providers: [] });
  });

  afterEach(async () => {
    if (close) await close();
    close = undefined;
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('AGENT_LOCAL=true → reloads skills + agent profiles and reports both caches', async () => {
    const app = await makeApp(true);
    close = app.close;

    const res = await fetch(`${app.baseUrl}/system/refresh`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(reloadSkills).toHaveBeenCalledTimes(1);
    expect(reloadConfig).toHaveBeenCalledTimes(1);
    const body = (await res.json()) as { status: string; refreshed: string[] };
    expect(body.status).toBe('ok');
    expect(body.refreshed).toEqual(['skills', 'agent-profiles']);
  }, 120_000);

  it('AGENT_LOCAL unset → requires a bearer token (401)', async () => {
    const app = await makeApp(false);
    close = app.close;

    const res = await fetch(`${app.baseUrl}/system/refresh`, { method: 'POST' });
    expect(res.status).toBe(401);
    expect(reloadSkills).not.toHaveBeenCalled();
    expect(reloadConfig).not.toHaveBeenCalled();
  });

  it('1572:1572-S1:12 reports reload_failed when config reload returns false', async () => {
    // Regression: reloadConfig(false) is claimed as a successful agent-profile refresh.
    reloadConfig.mockResolvedValueOnce(false);
    const app = await makeApp(true);
    close = app.close;
    const res = await fetch(`${app.baseUrl}/system/refresh`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; reason: string; refreshed: string[]; restart_required: boolean };
    expect(body).toEqual(expect.objectContaining({
      status: 'restart_required', restart_required: true, reason: 'reload_failed',
    }));
    expect(body.refreshed).not.toContain('agent-profiles');
  });

  it('1572:1572-S1:13 reports provider_drift when configuration declares a provider missing from the engine', async () => {
    // Regression: a successful reload boolean falsely claims a new provider is active.
    configuredSnapshot.mockReturnValue(JSON.stringify({ provider: {
      'new-mesh': { options: { apiKey: 'private-secret' }, models: { 'my-model': {} } },
    } }));
    const app = await makeApp(true);
    close = app.close;
    const res = await fetch(`${app.baseUrl}/system/refresh`, { method: 'POST' });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('private-secret');
    const body = JSON.parse(text) as { status: string; reason: string; restart_required: boolean; refreshed: string[] };
    expect(body).toEqual(expect.objectContaining({
      status: 'restart_required', restart_required: true, reason: 'provider_drift',
    }));
    expect(body.refreshed).toContain('agent-profiles');
    expect(body.refreshed).not.toContain('providers');
  });

  it('issue-1572-c17: refresh reports unknown on unavailable config and never claims provider refresh', async () => {
    configuredSnapshot.mockImplementationOnce(() => { throw new Error('missing config'); });
    const app = await makeApp(true);
    close = app.close;
    const response = await fetch(`${app.baseUrl}/system/refresh`, { method: 'POST' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({
      status: 'unknown', reason: 'config_unavailable', restart_required: null,
      refreshed: ['skills', 'agent-profiles'],
    }));
  });

  it('issue-1572-c17: changed provider options require restart despite unchanged engine digest', async () => {
    providerSnapshot.mockResolvedValue({ providers: [{ id: 'mesh', connected: true, digest: 'same', models: [] }] });
    configuredSnapshot.mockReturnValue(JSON.stringify({ provider: { mesh: { options: { baseURL: 'http://127.0.0.1:6711' } } } }));
    const app = await makeApp(true);
    close = app.close;
    const first = await (await fetch(`${app.baseUrl}/system/config/status`)).json() as { restart_required: boolean };
    expect(first.restart_required).toBe(false);
    configuredSnapshot.mockReturnValue(JSON.stringify({ provider: { mesh: { options: { baseURL: 'http://127.0.0.1:6712' } } } }));
    const second = await (await fetch(`${app.baseUrl}/system/refresh`, { method: 'POST' })).json() as { restart_required: boolean; reason: string; refreshed: string[] };
    expect(second).toEqual(expect.objectContaining({ status: 'restart_required', restart_required: true, reason: 'config_changed' }));
    expect(second.refreshed).toContain('agent-profiles');
    expect(second.refreshed).not.toContain('providers');
  });

  it('review:review-findings.md:118 first refresh detects options changed after the engine boot baseline', async () => {
    providerSnapshot.mockResolvedValue({ providers: [{ id: 'mesh', connected: true, digest: 'booted-6711', models: [] }] });
    configuredSnapshot.mockReturnValue(JSON.stringify({ provider: { mesh: { options: { baseURL: 'http://127.0.0.1:6711' } } } }));
    const app = await makeApp(true);
    close = app.close;
    const { captureProviderConfigBaseline } = await import('../routes/system_routes');
    await captureProviderConfigBaseline();

    configuredSnapshot.mockReturnValue(JSON.stringify({ provider: { mesh: { options: { baseURL: 'http://127.0.0.1:6712' } } } }));
    const response = await fetch(`${app.baseUrl}/system/refresh`, { method: 'POST' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({
      status: 'restart_required', restart_required: true, reason: 'config_changed',
    }));
  });

  it('issue-1572-c17: an engine digest change clears baseURL restart drift', async () => {
    providerSnapshot.mockResolvedValue({ providers: [{ id: 'mesh', connected: true, digest: 'before', models: [] }] });
    configuredSnapshot.mockReturnValue(JSON.stringify({ provider: { mesh: { options: { baseURL: 'http://127.0.0.1:6711' } } } }));
    const app = await makeApp(true);
    close = app.close;
    expect(await (await fetch(`${app.baseUrl}/system/config/status`)).json()).toEqual({
      restart_required: false, reason: 'in_sync',
    });

    configuredSnapshot.mockReturnValue(JSON.stringify({ provider: { mesh: { options: { baseURL: 'http://127.0.0.1:6712' } } } }));
    expect(await (await fetch(`${app.baseUrl}/system/refresh`, { method: 'POST' })).json()).toEqual(expect.objectContaining({
      restart_required: true, reason: 'config_changed',
    }));

    providerSnapshot.mockResolvedValue({ providers: [{ id: 'mesh', connected: true, digest: 'after', models: [] }] });
    expect(await (await fetch(`${app.baseUrl}/system/config/status`)).json()).toEqual({
      restart_required: false, reason: 'in_sync',
    });
  });

  it('issue-1572-c17: disabled provider missing in engine does not falsely demand restart', async () => {
    configuredSnapshot.mockReturnValue(JSON.stringify({ disabled_providers: ['mesh'], provider: { mesh: { models: { x: {} } } } }));
    const app = await makeApp(true);
    close = app.close;
    const result = await (await fetch(`${app.baseUrl}/system/config/status`)).json();
    expect(result).toEqual({ restart_required: false, reason: 'in_sync' });
  });
});
