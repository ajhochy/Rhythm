/**
 * Synology relay role — Phase 0 (docs/ai/plan-synology-relay.md).
 *
 * RHYTHM_ROLE=relay is the NAS relay container: it must never run the agent
 * runtime (no engine spawn, no scheduler, no 4002 mobile gateway) and must be
 * the ONLY role that mounts the phone-facing /relay surface.
 *
 * Harness mirrors issue_755_role_separation.test.ts: fresh module graph per
 * role via vi.resetModules + vi.stubEnv, real HTTP requests against the real
 * app.
 */
import { vi, describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { AddressInfo } from 'node:net';

async function makeApp(role: string): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  vi.resetModules();
  vi.stubEnv('RHYTHM_ROLE', role);
  vi.stubEnv('AGENT_LOCAL', 'true');

  const { setDb } = await import('../database/db');
  const { runMigrations } = await import('../database/migrations');
  const db = new Database(':memory:');
  runMigrations(db);
  setDb(db);

  const { createApp } = await import('../app');
  const server = createApp().listen(0);
  server.maxRequestsPerSocket = 1;
  await new Promise<void>((r) => server.once('listening', () => r()));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((res, rej) =>
        server.close((e) => (e ? rej(e) : res())),
      ),
  };
}

describe('relay role — env flags', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('role="relay" disables agent execution and sets isRelayRole', async () => {
    vi.stubEnv('RHYTHM_ROLE', 'relay');
    const { env } = await import('../config/env');
    expect(env.role).toBe('relay');
    expect(env.agentExecutionEnabled).toBe(false);
    expect(env.isRelayRole).toBe(true);
  });

  it('every other role has isRelayRole=false', async () => {
    for (const role of ['', 'all', 'local', 'cloud']) {
      vi.resetModules();
      vi.stubEnv('RHYTHM_ROLE', role);
      const { env } = await import('../config/env');
      expect(env.isRelayRole, `role="${role}"`).toBe(false);
    }
  });

  it('RHYTHM_RELAY_URLS parses as a trimmed ordered list, empty when unset', async () => {
    vi.stubEnv(
      'RHYTHM_RELAY_URLS',
      ' ws://nas.local:4010/relay/uplink , wss://api.vcrcapps.com/relay/uplink ,',
    );
    const { env } = await import('../config/env');
    expect(env.relayUrls).toEqual([
      'ws://nas.local:4010/relay/uplink',
      'wss://api.vcrcapps.com/relay/uplink',
    ]);

    vi.resetModules();
    vi.stubEnv('RHYTHM_RELAY_URLS', '');
    const { env: envUnset } = await import('../config/env');
    expect(envUnset.relayUrls).toEqual([]);
  });
});

describe('relay role — route registration', () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (close) await close();
    close = undefined;
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('relay role serves /relay/health and reports macOnline', async () => {
    const app = await makeApp('relay');
    close = app.close;
    const response = await fetch(`${app.baseUrl}/relay/health`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      role: string;
      macOnline: boolean;
    };
    expect(body.status).toBe('ok');
    expect(body.role).toBe('relay');
    expect(body.macOnline).toBe(false);
  });

  it('relay role does NOT register agent-execution routes', async () => {
    const app = await makeApp('relay');
    close = app.close;
    const response = await fetch(`${app.baseUrl}/agents/capabilities`);
    expect(response.status).toBe(404);
  });

  it('relay role keeps always-on core routes', async () => {
    const app = await makeApp('relay');
    close = app.close;
    const response = await fetch(`${app.baseUrl}/health`);
    expect(response.status).toBe(200);
  });

  it('non-relay roles 404 the /relay surface', async () => {
    for (const role of ['all', 'cloud']) {
      const app = await makeApp(role);
      const response = await fetch(`${app.baseUrl}/relay/health`);
      expect(response.status, `role="${role}"`).toBe(404);
      await app.close();
    }
  });
});
