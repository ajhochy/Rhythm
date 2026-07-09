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

const reloadSkills = vi.fn().mockResolvedValue([]);
const reloadConfig = vi.fn().mockResolvedValue(true);

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    reloadSkills: (...args: unknown[]) => reloadSkills(...args),
    reloadConfig: (...args: unknown[]) => reloadConfig(...args),
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
  });

  it('AGENT_LOCAL unset → requires a bearer token (401)', async () => {
    const app = await makeApp(false);
    close = app.close;

    const res = await fetch(`${app.baseUrl}/system/refresh`, { method: 'POST' });
    expect(res.status).toBe(401);
    expect(reloadSkills).not.toHaveBeenCalled();
    expect(reloadConfig).not.toHaveBeenCalled();
  });
});
