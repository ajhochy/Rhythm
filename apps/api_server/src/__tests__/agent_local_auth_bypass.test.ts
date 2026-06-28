/**
 * Regression guard for the AGENT_LOCAL auth bypass on agent-local routers.
 *
 * Bug (fixed in d315aa9): agent-schedules/memory/webhooks/research (and the
 * newer cookbook/designs/gmail-signals) used unconditional
 * `router.use(requireAuth)`, so on the local agent server (AGENT_LOCAL=true,
 * where the Flutter data sources send NO bearer token) every request 401'd
 * with "Missing bearer token". The correct pattern, shared with
 * agent_sessions/agent_configs/etc., is `if (!env.agentLocal) router.use(requireAuth)`.
 *
 * These tests lock both halves of that contract:
 *   • AGENT_LOCAL=true  → agent-local routes are reachable WITHOUT a token (no 401)
 *   • AGENT_LOCAL unset → the same routes still require a token (401)
 *
 * Routers read `env.agentLocal` at import time, so each case sets the env var
 * and `vi.resetModules()` BEFORE importing the app to get a fresh module graph.
 */
import { vi, describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { startTestServer } from './helpers/real_server';

// Routes that hit the LOCAL agent server from Flutter with no bearer token.
const AGENT_LOCAL_ROUTES = [
  '/agent-schedules',
  '/agent-memory',
  '/agent-webhooks',
  '/agent-research',
  '/agent-cookbook',
  '/agent-designs',
];

async function makeApp(agentLocal: boolean): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  vi.resetModules();
  vi.stubEnv('AGENT_LOCAL', agentLocal ? 'true' : '');

  // Fresh module graph: db + migrations + app must all be the post-reset copies
  // so setDb targets the same instance the routes read, and the routers re-read
  // env.agentLocal at import.
  const { setDb } = await import('../database/db');
  const { runMigrations } = await import('../database/migrations');
  const db = new Database(':memory:');
  runMigrations(db);
  setDb(db);

  const { createApp } = await import('../app');
  const { baseUrl, close } = await startTestServer(createApp());
  return { baseUrl, close };
}

describe('AGENT_LOCAL auth bypass on agent-local routers', () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (close) await close();
    close = undefined;
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('AGENT_LOCAL=true → agent-local routes are reachable WITHOUT a bearer token (no 401)', async () => {
    const app = await makeApp(true);
    close = app.close;

    for (const route of AGENT_LOCAL_ROUTES) {
      const res = await fetch(`${app.baseUrl}${route}`);
      expect(
        res.status,
        `${route} should NOT 401 under AGENT_LOCAL=true (got ${res.status})`,
      ).not.toBe(401);
      // The list endpoints return 200 (an array — possibly empty) on a fresh DB.
      expect(res.status).toBe(200);
    }
  });

  it('AGENT_LOCAL unset → agent-local routes still require a bearer token (401)', async () => {
    const app = await makeApp(false);
    close = app.close;

    for (const route of AGENT_LOCAL_ROUTES) {
      const res = await fetch(`${app.baseUrl}${route}`);
      expect(
        res.status,
        `${route} should require auth when AGENT_LOCAL is unset (got ${res.status})`,
      ).toBe(401);
    }
  });
});
