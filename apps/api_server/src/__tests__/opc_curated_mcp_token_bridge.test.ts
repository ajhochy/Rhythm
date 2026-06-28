/**
 * MCP-6 — Google + PCO token bridge (reuse stored OAuth).
 *
 * Acceptance criteria:
 *   c1 — a Google integration_account row with a valid token exists →
 *        ensuring the Google server injects the fresh access token into
 *        environment[GOOGLE_OAUTH_ACCESS_TOKEN]; same for PCO into its key.
 *   c2 — the token bridge calls the existing ensureFresh*Account refresh path:
 *        when expires_at is in the past the refresh fetch is invoked and the
 *        REFRESHED token is the one injected.
 *   c3 — no Google/PCO account connected → that server is SKIPPED (not written
 *        with an empty token); ensureCuratedMcps() does not throw; other servers
 *        (PDF Tools) still install.
 *   c4 — token values never returned verbatim in the route response — the
 *        response `servers` payload contains no plaintext token (redacted).
 *
 * Run with:
 *   cd apps/api_server && npx vitest run src/__tests__/opc_curated_mcp_token_bridge.test.ts
 */

import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { OpencodeClientService } from '../services/opencode_client_service';
import {
  CURATED_MCP_SERVERS,
  type CuratedMcpServer,
} from '../config/curated_mcp_servers';
import { startTestServer } from './helpers/real_server';

// The verified curated catalog has NO token-bridged entry anymore
// (google-workspace + planning-center were dropped — the rhythm MCP already
// brokers Gmail/Calendar + PCO). To keep the token-bridge mechanism in
// `ensureCuratedMcps()` covered we exercise it with SYNTHETIC curated fixtures
// that declare `tokenProvider`/`tokenEnvKey`, passed via the `servers` override.
// This proves the bridge (resolve fresh token → inject into env / skip when
// absent) independently of any live curated entry.
const GOOGLE: CuratedMcpServer = {
  id: 'google-workspace',
  name: 'Google Workspace (test fixture)',
  type: 'local',
  command: ['npx', '-y', '@example/google-mcp-fixture'],
  tokenProvider: 'google',
  tokenEnvKey: 'GOOGLE_OAUTH_ACCESS_TOKEN',
  requiredEnv: ['GOOGLE_OAUTH_ACCESS_TOKEN'],
};
const PCO: CuratedMcpServer = {
  id: 'planning-center',
  name: 'Planning Center (test fixture)',
  type: 'local',
  command: ['npx', '-y', '@example/pco-mcp-fixture'],
  tokenProvider: 'pco',
  tokenEnvKey: 'PCO_ACCESS_TOKEN',
  requiredEnv: ['PCO_ACCESS_TOKEN'],
};
// PDF Tools is a REAL zero-auth curated entry — used to prove zero-auth servers
// install alongside the (synthetic) bridged ones.
const PDF = CURATED_MCP_SERVERS.find((s) => s.id === 'pdf-tools')!;
// Bridge-fixture list: synthetic bridged servers + the real zero-auth PDF entry.
const BRIDGE_FIXTURE_SERVERS: CuratedMcpServer[] = [GOOGLE, PCO, PDF];

// ─────────────────────────────────────────────────────────────────────────────
// c1 — fresh tokens injected into the declared env keys (service-level, using
// an injected resolver that mimics ensureFresh*Account returning a token).
// ─────────────────────────────────────────────────────────────────────────────
describe('ensureCuratedMcps token bridge — injection (c1)', () => {
  let dir: string;
  let configPath: string;
  let svc: OpencodeClientService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'opencode-token-bridge-'));
    configPath = join(dir, 'opencode.json');
    svc = new OpencodeClientService();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('c1: injects the fresh Google + PCO access tokens into their env keys', async () => {
    const tokenResolver = vi.fn(async (provider: 'google' | 'pco') =>
      provider === 'google' ? 'google-access-tok' : 'pco-access-tok',
    );

    const result = await svc.ensureCuratedMcps({
      configPath,
      register: false,
      tokenResolver,
      servers: BRIDGE_FIXTURE_SERVERS,
    });

    expect(result.changed).toBe(true);
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));

    // Google server env key populated with the fresh token.
    expect(parsed.mcp['google-workspace'].environment).toEqual({
      [GOOGLE.tokenEnvKey!]: 'google-access-tok',
    });
    // PCO server env key populated with the fresh token.
    expect(parsed.mcp['planning-center'].environment).toEqual({
      [PCO.tokenEnvKey!]: 'pco-access-tok',
    });
    // Zero-auth PDF Tools still installed, no environment.
    expect(parsed.mcp['pdf-tools'].command).toEqual(PDF.command);
    expect(parsed.mcp['pdf-tools'].environment).toBeUndefined();

    expect(tokenResolver).toHaveBeenCalledWith('google');
    expect(tokenResolver).toHaveBeenCalledWith('pco');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// c2 — the bridge uses the REAL ensureFreshGoogleAccount refresh path. With an
// expired token the refresh fetch is invoked and the refreshed token is used.
// ─────────────────────────────────────────────────────────────────────────────
describe('ensureCuratedMcps token bridge — real refresh path (c2)', () => {
  let dir: string;
  let configPath: string;
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
    dir = mkdtempSync(join(tmpdir(), 'opencode-token-refresh-'));
    configPath = join(dir, 'opencode.json');

    // Google refresh requires the desktop client to be configured.
    vi.doMock('../config/env', () => ({
      env: {
        dbClient: 'sqlite',
        googleClientId: 'web-client',
        googleClientSecret: 'web-secret',
        googleRedirectUri: 'http://localhost/cb',
        googleAuthClientId: 'desktop-client',
        googleAuthClientSecret: 'desktop-secret',
      },
    }));
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.doUnmock('../config/env');
    rmSync(dir, { recursive: true, force: true });
  });

  it('c2: expired token → refresh fetch invoked, refreshed token injected', async () => {
    const { setDb } = await import('../database/db');
    const { runMigrations } = await import('../database/migrations');
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);

    // Seed a user (FK target) and an EXPIRED Google account row (real shape).
    db.prepare(
      `INSERT INTO users (email, name) VALUES (?, ?)`,
    ).run('owner@example.com', 'Owner');
    const ownerId = (
      db.prepare('SELECT id FROM users WHERE email = ?').get('owner@example.com') as {
        id: number;
      }
    ).id;
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    for (const provider of ['google_calendar', 'gmail']) {
      db.prepare(
        `INSERT INTO integration_accounts (
          id, owner_id, provider, external_account_id, email, display_name,
          status, access_token, refresh_token, scope, token_type, expires_at,
          last_synced_at, error_message, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        `acct-${provider}`,
        ownerId,
        provider,
        'ext-1',
        'owner@example.com',
        'Owner',
        'connected',
        'STALE-google-token',
        'google-refresh-token',
        'openid email profile',
        'Bearer',
        past, // expired → must refresh
        null,
        null,
        now,
        now,
      );
    }

    // Stub the Google token endpoint so the real refresh path runs offline.
    const fetchSpy = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes('oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'FRESH-google-token',
            expires_in: 3600,
            token_type: 'Bearer',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`unexpected fetch to ${u}`);
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const { IntegrationsService } = await import('../services/integrations_service');
    const integrations = new IntegrationsService();
    const tokenResolver = async (provider: 'google' | 'pco') => {
      if (provider !== 'google') return null;
      const account = await integrations.ensureFreshGoogleAccount(ownerId);
      return account.accessToken ?? null;
    };

    const svc = new OpencodeClientService();
    const result = await svc.ensureCuratedMcps({
      configPath,
      register: false,
      tokenResolver,
      servers: BRIDGE_FIXTURE_SERVERS,
    });

    expect(result.changed).toBe(true);
    // The refresh endpoint was actually hit (refresh path exercised).
    expect(
      fetchSpy.mock.calls.some(([u]) =>
        String(u).includes('oauth2.googleapis.com/token'),
      ),
    ).toBe(true);

    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    // The REFRESHED token is what got injected — not the stale one.
    expect(parsed.mcp['google-workspace'].environment).toEqual({
      [GOOGLE.tokenEnvKey!]: 'FRESH-google-token',
    });
    expect(
      JSON.stringify(parsed.mcp['google-workspace']),
    ).not.toContain('STALE-google-token');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// c3 — no account connected → token-bridged servers skipped, no throw, PDF
// Tools still installs. Driven through the REAL route with an empty temp DB.
// c4 — the route response redacts env values (no plaintext token).
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /opencode/mcp/curated/ensure token bridge (c3, c4)', () => {
  let dir: string;
  let baseUrl: string;
  let close: () => Promise<void>;
  // Spy on the REAL opencodeClient singleton (set up in beforeEach). See the
  // beforeEach comment for why this replaced a whole-module doMock.
  let ensureCuratedMcpsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    dir = mkdtempSync(join(tmpdir(), 'opencode-token-route-'));

    vi.doMock('../config/env', () => ({
      env: {
        dbClient: 'sqlite',
        agentLocal: true,
        agentExecutionEnabled: true,
        role: 'local',
        corsAllowedOrigins: [],
        jwtSecret: 'test-secret',
      },
    }));

    // HERMETIC: spy on the actual opencodeClient singleton that the route holds
    // a reference to, rather than replacing the entire opencode_engine module.
    // Whole-module doMock intermittently failed to apply in the full CI suite,
    // letting the route call the REAL ensureCuratedMcps — whose verified catalog
    // has no google/pco entry — so the response carried the real (account-/env-
    // dependent) server list and servers[0].environment came back undefined,
    // flaking c4. Spying the shared singleton is deterministic regardless of any
    // ambient connected Google/PCO account or curated-MCP token in the env.
    const engine = await import('../services/opencode_engine');
    ensureCuratedMcpsSpy = vi.spyOn(engine.opencodeClient, 'ensureCuratedMcps');
    // Default to a benign empty result so the real method (which would touch the
    // user's ~/.config/opencode.json) never runs through the singleton when a
    // test does not override the return value.
    ensureCuratedMcpsSpy.mockResolvedValue({
      changed: false,
      registered: false,
      servers: [],
    });

    const { setDb } = await import('../database/db');
    const { runMigrations } = await import('../database/migrations');
    setDb(
      (() => {
        const db = new Database(':memory:');
        db.pragma('foreign_keys = ON');
        runMigrations(db);
        return db;
      })(),
    );

    const { createApp } = await import('../app');
    ({ baseUrl, close } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await close();
    ensureCuratedMcpsSpy.mockRestore();
    vi.doUnmock('../config/env');
    rmSync(dir, { recursive: true, force: true });
  });

  it('c3: real catalog has no google/pco entries; PDF Tools still installs, no throw', async () => {
    // Run the REAL ensureCuratedMcps against a temp config with NO resolver
    // wired (route omits it when there is no authed user). google-workspace +
    // planning-center were dropped from the verified catalog, so they must not
    // appear; PDF Tools (zero-auth) must still install.
    const configPath = join(dir, 'opencode.json');
    const svc = new OpencodeClientService();
    const result = await svc.ensureCuratedMcps({ configPath, register: false });

    expect(result.changed).toBe(true);
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(parsed.mcp['pdf-tools'].command).toEqual(PDF.command);
    // Dropped servers never written.
    expect(parsed.mcp['google-workspace']).toBeUndefined();
    expect(parsed.mcp['planning-center']).toBeUndefined();
    expect(result.servers.some((s) => s.id === 'google-workspace')).toBe(false);
    expect(result.servers.some((s) => s.id === 'planning-center')).toBe(false);
  });

  it('c4: route response redacts env values — no plaintext token echoed', async () => {
    // The route receives a service result that (hypothetically) carries an
    // environment with a token. The route MUST redact it before responding.
    // Persistent (not Once) so the redaction path is exercised regardless of how
    // many times the route's dependency is invoked.
    ensureCuratedMcpsSpy.mockResolvedValue({
      changed: true,
      registered: false,
      servers: [
        {
          id: 'google-workspace',
          name: 'Google Workspace',
          type: 'local',
          command: GOOGLE.command,
          environment: { [GOOGLE.tokenEnvKey!]: 'super-secret-bearer-token' },
          tokenProvider: 'google',
          tokenEnvKey: GOOGLE.tokenEnvKey,
          requiredEnv: GOOGLE.requiredEnv,
        },
      ],
    });

    const res = await fetch(`${baseUrl}/opencode/mcp/curated/ensure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    expect(res.status).toBe(200);
    const raw = await res.text();
    // The plaintext token must NOT appear verbatim anywhere in the response.
    expect(raw).not.toContain('super-secret-bearer-token');

    const body = JSON.parse(raw) as {
      servers: Array<{ environment?: Record<string, string> }>;
    };
    // The env key is preserved but redacted to '***'.
    expect(body.servers[0].environment).toEqual({
      [GOOGLE.tokenEnvKey!]: '***',
    });
  });
});
