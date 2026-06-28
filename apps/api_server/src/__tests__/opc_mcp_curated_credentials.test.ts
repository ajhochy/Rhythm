/**
 * MCP-7 — credential entry for curated key-based MCP servers (stripe, mailchimp).
 *
 * Problem: stripe/mailchimp are curated LOCAL servers with `requiredEnv`
 * (STRIPE_SECRET_KEY, MAILCHIMP_API_KEY) but no key is injected at install (the
 * token bridge only injects Google/PCO). They persist WITHOUT those env keys, so
 * the GET /opencode/mcp `needsCredentials` check (which previously only fired
 * when an env VALUE was empty) never triggered. This suite pins:
 *
 *   1. GET /opencode/mcp surfaces `requiredEnv` per entry and flags curated
 *      key-based servers with missing-or-empty required env as needsCredentials.
 *   2. POST /opencode/mcp/:name/credentials accepts typed credentials for a
 *      curated local server, builds the config from the curated def, and calls
 *      addMcp (persist + reconnect).
 *
 * Run with:
 *   cd apps/api_server && npx vitest run src/__tests__/opc_mcp_curated_credentials.test.ts
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { CURATED_MCP_SERVERS } from '../config/curated_mcp_servers';

// ---------------------------------------------------------------------------
// Spy stubs – hoisted before vi.mock()
// ---------------------------------------------------------------------------

const {
  listMcpSpy,
  addMcpSpy,
  connectMcpSpy,
  disconnectMcpSpy,
  removeMcpSpy,
  getPersistedMcpConfigsSpy,
} = vi.hoisted(() => ({
  listMcpSpy: vi.fn(),
  addMcpSpy: vi.fn(),
  connectMcpSpy: vi.fn(),
  disconnectMcpSpy: vi.fn(),
  removeMcpSpy: vi.fn(),
  getPersistedMcpConfigsSpy: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    listMcp: listMcpSpy,
    addMcp: addMcpSpy,
    connectMcp: connectMcpSpy,
    disconnectMcp: disconnectMcpSpy,
    removeMcp: removeMcpSpy,
    getPersistedMcpConfigs: getPersistedMcpConfigsSpy,
    statusMessage: 'ready',
    listCommands: vi.fn().mockResolvedValue([]),
  },
  opencodeSessionMap: new Map(),
}));

// auth middleware bypass (AGENT_LOCAL posture, matching neighbors)
vi.mock('../config/env', () => ({
  env: {
    agentLocal: true,
    agentExecutionEnabled: true,
    role: 'local',
    corsAllowedOrigins: [],
    jwtSecret: 'test-secret',
  },
}));

import { createApp } from '../app';

// Curated command lookups (sourced from the catalog so the test never drifts).
const STRIPE = CURATED_MCP_SERVERS.find((s) => s.id === 'stripe')!;
const MAILCHIMP = CURATED_MCP_SERVERS.find((s) => s.id === 'mailchimp')!;

describe('mcp-7: curated key-based servers — needs-credentials + credentials endpoint', () => {
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeEach(async () => {
    vi.clearAllMocks();
    getPersistedMcpConfigsSpy.mockResolvedValue({});
    setDb((() => {
      const db = new Database(':memory:');
      db.pragma('foreign_keys = ON');
      runMigrations(db);
      return db;
    })());
    const server = createApp().listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () =>
      new Promise<void>((res, rej) =>
        server.close((e) => (e ? rej(e) : res())),
      );
  });

  afterEach(async () => {
    await close();
  });

  // ── GET /opencode/mcp — requiredEnv + curated needsCredentials ────────────

  it('mcp-7-c1: curated key-based server with NO persisted env → needsCredentials true, requiredEnv listed', async () => {
    listMcpSpy.mockResolvedValueOnce({
      stripe: { status: 'failed', error: 'Connection closed' },
    });
    // Persisted WITHOUT STRIPE_SECRET_KEY (the bug scenario): no environment map.
    getPersistedMcpConfigsSpy.mockResolvedValueOnce({
      stripe: { type: 'local', command: STRIPE.command },
    });

    const res = await fetch(`${baseUrl}/opencode/mcp`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Array<{
      name: string;
      requiredEnv: string[];
      needsCredentials: boolean;
    }>;
    const stripe = body.find((e) => e.name === 'stripe')!;
    expect(stripe).toBeDefined();
    expect(stripe.requiredEnv).toEqual(['STRIPE_SECRET_KEY']);
    expect(stripe.needsCredentials).toBe(true);
  });

  it('mcp-7-c2: curated key-based server WITH the key present+non-empty → needsCredentials false', async () => {
    listMcpSpy.mockResolvedValueOnce({
      stripe: { status: 'connected' },
    });
    getPersistedMcpConfigsSpy.mockResolvedValueOnce({
      stripe: {
        type: 'local',
        command: STRIPE.command,
        environment: { STRIPE_SECRET_KEY: 'sk_test_live' },
      },
    });

    const res = await fetch(`${baseUrl}/opencode/mcp`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      name: string;
      requiredEnv: string[];
      needsCredentials: boolean;
      environment?: Record<string, string>;
    }>;
    const stripe = body.find((e) => e.name === 'stripe')!;
    expect(stripe.requiredEnv).toEqual(['STRIPE_SECRET_KEY']);
    expect(stripe.needsCredentials).toBe(false);
    // Value must be redacted, never echoed verbatim.
    expect(Object.values(stripe.environment ?? {})).not.toContain('sk_test_live');
  });

  it('mcp-7-c3: non-curated server → requiredEnv [], existing empty-value behavior preserved', async () => {
    listMcpSpy.mockResolvedValueOnce({
      'env-mcp': { status: 'connected' },
      'no-env-mcp': { status: 'connected' },
    });
    getPersistedMcpConfigsSpy.mockResolvedValueOnce({
      'env-mcp': {
        type: 'local',
        command: ['npx', 'my-server'],
        environment: { API_KEY: 'secret', EMPTY_KEY: '' },
      },
      'no-env-mcp': { type: 'local', command: ['npx', 'no-env'] },
    });

    const res = await fetch(`${baseUrl}/opencode/mcp`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      name: string;
      requiredEnv: string[];
      needsCredentials: boolean;
    }>;

    const envEntry = body.find((e) => e.name === 'env-mcp')!;
    expect(envEntry.requiredEnv).toEqual([]);
    // Existing behavior: an empty env value still flags needsCredentials.
    expect(envEntry.needsCredentials).toBe(true);

    const noEnv = body.find((e) => e.name === 'no-env-mcp')!;
    expect(noEnv.requiredEnv).toEqual([]);
    expect(noEnv.needsCredentials).toBe(false);
  });

  it('mcp-7-c4: needs_auth remote server still needsCredentials true, requiredEnv []', async () => {
    listMcpSpy.mockResolvedValueOnce({
      canva: { status: 'needs_auth' },
    });
    getPersistedMcpConfigsSpy.mockResolvedValueOnce({
      canva: { type: 'remote', url: 'https://mcp.canva.com/mcp' },
    });

    const res = await fetch(`${baseUrl}/opencode/mcp`);
    const body = (await res.json()) as Array<{
      name: string;
      requiredEnv: string[];
      needsCredentials: boolean;
    }>;
    const canva = body.find((e) => e.name === 'canva')!;
    // canva is curated with requiredEnv [] → still [], needs_auth drives the flag.
    expect(canva.requiredEnv).toEqual([]);
    expect(canva.needsCredentials).toBe(true);
  });

  // ── POST /opencode/mcp/:name/credentials ──────────────────────────────────

  it('mcp-7-c5: valid stripe credentials → addMcp called with curated command + injected env', async () => {
    const updated = { stripe: { status: 'connected' } };
    addMcpSpy.mockResolvedValueOnce(updated);

    const res = await fetch(`${baseUrl}/opencode/mcp/stripe/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ environment: { STRIPE_SECRET_KEY: 'sk_test_x' } }),
    });

    expect(res.status).toBe(200);
    expect(addMcpSpy).toHaveBeenCalledOnce();
    const [nameArg, configArg] = addMcpSpy.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(nameArg).toBe('stripe');
    expect(configArg).toEqual({
      type: 'local',
      command: STRIPE.command,
      environment: { STRIPE_SECRET_KEY: 'sk_test_x' },
    });
  });

  it('mcp-7-c6: mailchimp credentials → addMcp called with curated command + injected env', async () => {
    addMcpSpy.mockResolvedValueOnce({ mailchimp: { status: 'connected' } });

    const res = await fetch(`${baseUrl}/opencode/mcp/mailchimp/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ environment: { MAILCHIMP_API_KEY: 'abc-us21' } }),
    });

    expect(res.status).toBe(200);
    const [nameArg, configArg] = addMcpSpy.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(nameArg).toBe('mailchimp');
    expect(configArg).toEqual({
      type: 'local',
      command: MAILCHIMP.command,
      environment: { MAILCHIMP_API_KEY: 'abc-us21' },
    });
  });

  it('mcp-7-c7: response redacts env values (never echoes the secret)', async () => {
    addMcpSpy.mockResolvedValueOnce({ stripe: { status: 'connected' } });

    const res = await fetch(`${baseUrl}/opencode/mcp/stripe/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ environment: { STRIPE_SECRET_KEY: 'sk_super_secret' } }),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('sk_super_secret');
  });

  it('mcp-7-c8: missing required key → 400 MISSING_CREDENTIALS, addMcp not called', async () => {
    const res = await fetch(`${baseUrl}/opencode/mcp/stripe/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ environment: {} }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(JSON.stringify(body)).toContain('MISSING_CREDENTIALS');
    expect(addMcpSpy).not.toHaveBeenCalled();
  });

  it('mcp-7-c9: empty-string required key → 400 MISSING_CREDENTIALS', async () => {
    const res = await fetch(`${baseUrl}/opencode/mcp/stripe/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ environment: { STRIPE_SECRET_KEY: '   ' } }),
    });

    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('MISSING_CREDENTIALS');
    expect(addMcpSpy).not.toHaveBeenCalled();
  });

  it('mcp-7-c10: unknown server → 404 NOT_CURATED', async () => {
    const res = await fetch(`${baseUrl}/opencode/mcp/not-a-server/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ environment: { FOO: 'bar' } }),
    });

    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).toContain('NOT_CURATED');
    expect(addMcpSpy).not.toHaveBeenCalled();
  });

  it('mcp-7-c11: curated remote server (no command) → 400 (not key-based)', async () => {
    const res = await fetch(`${baseUrl}/opencode/mcp/canva/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ environment: { FOO: 'bar' } }),
    });

    expect(res.status).toBe(400);
    expect(addMcpSpy).not.toHaveBeenCalled();
  });

  it('mcp-7-c12: extra non-required env keys are stripped before addMcp', async () => {
    addMcpSpy.mockResolvedValueOnce({ stripe: { status: 'connected' } });

    const res = await fetch(`${baseUrl}/opencode/mcp/stripe/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        environment: {
          STRIPE_SECRET_KEY: 'sk_test_x',
          PATH: '/evil',
          ARBITRARY: 'nope',
        },
      }),
    });

    expect(res.status).toBe(200);
    const [, configArg] = addMcpSpy.mock.calls[0] as [
      string,
      { environment: Record<string, string> },
    ];
    expect(Object.keys(configArg.environment)).toEqual(['STRIPE_SECRET_KEY']);
    expect(configArg.environment).not.toHaveProperty('PATH');
    expect(configArg.environment).not.toHaveProperty('ARBITRARY');
  });

  it('mcp-7-c13: lookup works by curated name as well as id', async () => {
    addMcpSpy.mockResolvedValueOnce({ stripe: { status: 'connected' } });

    // :name passed as the display name "Stripe" (not the id "stripe").
    const res = await fetch(`${baseUrl}/opencode/mcp/Stripe/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ environment: { STRIPE_SECRET_KEY: 'sk_test_x' } }),
    });

    expect(res.status).toBe(200);
    const [nameArg] = addMcpSpy.mock.calls[0] as [string, unknown];
    // Persisted under the curated id, regardless of how it was addressed.
    expect(nameArg).toBe('stripe');
  });
});
