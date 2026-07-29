/**
 * OPC-M4-3 MCP server management UI — server-side contract tests.
 * Issue #702, criterion c1.
 *
 * c1 — GET /opencode/mcp returns the SDK's MCP server list (vitest spy +
 *      real-shape fixture: name, type, connection status);
 *      POST /opencode/mcp (add), POST /opencode/mcp/:name/connect,
 *      POST /opencode/mcp/:name/disconnect, DELETE /opencode/mcp/:name
 *      each invoke the corresponding typed wrapper;
 *      SDK errors → AppError with message.
 *
 * Run with:
 *   cd apps/api_server && npx vitest run src/__tests__/opc_m4_3_mcp_routes.test.ts
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AppError } from '../errors/app_error';

// ---------------------------------------------------------------------------
// Spy stubs – must be declared before vi.mock() so they are hoisted
// ---------------------------------------------------------------------------

const {
  listMcpSpy,
  listToolIdsSpy,
  addMcpSpy,
  connectMcpSpy,
  disconnectMcpSpy,
  removeMcpSpy,
  getPersistedMcpConfigsSpy,
} = vi.hoisted(() => ({
  listMcpSpy: vi.fn(),
  listToolIdsSpy: vi.fn(),
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
    listToolIds: listToolIdsSpy,
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

// auth middleware bypass
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
import { startTestServer } from './helpers/real_server';

// ---------------------------------------------------------------------------
// Real-shape MCP status fixture
// ---------------------------------------------------------------------------
const MCP_STATUS_FIXTURE: Record<string, { status: string; error?: string }> = {
  'rhythm-mcp': { status: 'connected' },
  'my-remote-mcp': { status: 'disconnected' },
  'broken-mcp': { status: 'failed', error: 'connection refused' },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('issue-702-c1: MCP route contracts', () => {
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeEach(async () => {
    vi.clearAllMocks();
    getPersistedMcpConfigsSpy.mockResolvedValue({});
    listToolIdsSpy.mockResolvedValue([]);
    setDb((() => {
      const db = new Database(':memory:');
      db.pragma('foreign_keys = ON');
      runMigrations(db);
      return db;
    })());
    const { baseUrl: b, close: c } = await startTestServer(createApp());
    baseUrl = b;
    close = c;
  });

  afterEach(async () => {
    await close();
  });

  // ── GET /opencode/mcp — list ─────────────────────────────────────────────

  it('issue-702-c1a: GET /opencode/mcp invokes listMcp and returns status array with real-shape fixture', async () => {
    listMcpSpy.mockResolvedValueOnce(MCP_STATUS_FIXTURE);

    const res = await fetch(`${baseUrl}/opencode/mcp`);
    expect(res.status).toBe(200);
    expect(listMcpSpy).toHaveBeenCalledOnce();

    const body = await res.json() as Array<{ name: string; status: string; error?: string }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(3);

    const connected = body.find((e) => e.name === 'rhythm-mcp');
    expect(connected).toBeDefined();
    expect(connected!.status).toBe('connected');

    const disconnected = body.find((e) => e.name === 'my-remote-mcp');
    expect(disconnected).toBeDefined();
    expect(disconnected!.status).toBe('disconnected');

    const failed = body.find((e) => e.name === 'broken-mcp');
    expect(failed).toBeDefined();
    expect(failed!.status).toBe('failed');
    expect(failed!.error).toBe('connection refused');
  });

  it('issue-702-c1b: GET /opencode/mcp — SDK error → 502 AppError', async () => {
    const sdkErr = new AppError(502, 'SDK_ERROR', 'listMcp failed: {"code":500}');
    listMcpSpy.mockRejectedValueOnce(sdkErr);

    const res = await fetch(`${baseUrl}/opencode/mcp`);
    expect(res.status).toBe(502);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');
  });

  // ── POST /opencode/mcp — add ─────────────────────────────────────────────

  it('issue-702-c1c: POST /opencode/mcp invokes addMcp with name and config, returns 200', async () => {
    const updated = { 'new-mcp': { status: 'connected' } };
    addMcpSpy.mockResolvedValueOnce(updated);

    const res = await fetch(`${baseUrl}/opencode/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'new-mcp', command: 'npx -y my-mcp-server' }),
    });

    expect(res.status).toBe(200);
    expect(addMcpSpy).toHaveBeenCalledOnce();
    const [nameArg, configArg] = addMcpSpy.mock.calls[0] as [string, unknown];
    expect(nameArg).toBe('new-mcp');
    expect(configArg).toBeDefined();
  });

  it('issue-702-c1d: POST /opencode/mcp — missing name → 400', async () => {
    const res = await fetch(`${baseUrl}/opencode/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'npx my-mcp' }),
    });

    expect(res.status).toBe(400);
    expect(addMcpSpy).not.toHaveBeenCalled();
  });

  it('issue-702-c1e: POST /opencode/mcp — missing command and url → 400', async () => {
    const res = await fetch(`${baseUrl}/opencode/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'bad-mcp' }),
    });

    expect(res.status).toBe(400);
    expect(addMcpSpy).not.toHaveBeenCalled();
  });

  it('issue-702-c1f: POST /opencode/mcp — SDK error → AppError forwarded', async () => {
    const sdkErr = new AppError(502, 'SDK_ERROR', 'addMcp failed: {"code":400}');
    addMcpSpy.mockRejectedValueOnce(sdkErr);

    const res = await fetch(`${baseUrl}/opencode/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'new-mcp', command: 'npx my-mcp' }),
    });

    expect(res.status).toBe(502);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');
  });

  // ── POST /opencode/mcp/:name/connect ────────────────────────────────────

  it('issue-702-c1g: POST /opencode/mcp/:name/connect invokes connectMcp with correct name', async () => {
    connectMcpSpy.mockResolvedValueOnce({ connected: true });

    const res = await fetch(`${baseUrl}/opencode/mcp/rhythm-mcp/connect`, {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    expect(connectMcpSpy).toHaveBeenCalledOnce();
    expect(connectMcpSpy).toHaveBeenCalledWith('rhythm-mcp');
    const body = (await res.json()) as { ok: boolean; authorizationUrl: string | null };
    expect(body.ok).toBe(true);
    // Already authed → no consent URL.
    expect(body.authorizationUrl).toBeNull();
  });

  it('mcp-oauth-c1: POST /opencode/mcp/:name/connect returns authorizationUrl when the server needs OAuth', async () => {
    connectMcpSpy.mockResolvedValueOnce({
      connected: false,
      authorizationUrl: 'https://provider/oauth?x',
    });

    const res = await fetch(`${baseUrl}/opencode/mcp/canva/connect`, {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    expect(connectMcpSpy).toHaveBeenCalledWith('canva');
    const body = (await res.json()) as { ok: boolean; authorizationUrl: string | null };
    expect(body.ok).toBe(false);
    expect(body.authorizationUrl).toBe('https://provider/oauth?x');
  });

  it('issue-702-c1h: POST /opencode/mcp/:name/connect — SDK error → AppError', async () => {
    const sdkErr = new AppError(502, 'SDK_ERROR', 'connectMcp failed: {"code":500}');
    connectMcpSpy.mockRejectedValueOnce(sdkErr);

    const res = await fetch(`${baseUrl}/opencode/mcp/rhythm-mcp/connect`, {
      method: 'POST',
    });
    expect(res.status).toBe(502);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');
  });

  // ── POST /opencode/mcp/:name/disconnect ─────────────────────────────────

  it('issue-702-c1i: POST /opencode/mcp/:name/disconnect invokes disconnectMcp with correct name', async () => {
    disconnectMcpSpy.mockResolvedValueOnce(true);

    const res = await fetch(`${baseUrl}/opencode/mcp/rhythm-mcp/disconnect`, {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    expect(disconnectMcpSpy).toHaveBeenCalledOnce();
    expect(disconnectMcpSpy).toHaveBeenCalledWith('rhythm-mcp');
  });

  it('issue-702-c1j: POST /opencode/mcp/:name/disconnect — SDK error → AppError', async () => {
    const sdkErr = new AppError(502, 'SDK_ERROR', 'disconnectMcp failed: {"code":500}');
    disconnectMcpSpy.mockRejectedValueOnce(sdkErr);

    const res = await fetch(`${baseUrl}/opencode/mcp/rhythm-mcp/disconnect`, {
      method: 'POST',
    });
    expect(res.status).toBe(502);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');
  });

  // ── DELETE /opencode/mcp/:name ───────────────────────────────────────────

  it('issue-702-c1k: DELETE /opencode/mcp/:name invokes removeMcp with correct name', async () => {
    removeMcpSpy.mockResolvedValueOnce(undefined);

    const res = await fetch(`${baseUrl}/opencode/mcp/rhythm-mcp`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(204);
    expect(removeMcpSpy).toHaveBeenCalledOnce();
    expect(removeMcpSpy).toHaveBeenCalledWith('rhythm-mcp');
  });

  it('issue-702-c1l: DELETE /opencode/mcp/:name — SDK error → AppError', async () => {
    const sdkErr = new AppError(502, 'SDK_ERROR', 'removeMcp failed: {"code":500}');
    removeMcpSpy.mockRejectedValueOnce(sdkErr);

    const res = await fetch(`${baseUrl}/opencode/mcp/rhythm-mcp`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(502);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');
  });
});

describe('issue-mcp-1: env-map plumbing + entry surfacing', () => {
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeEach(async () => {
    vi.clearAllMocks();
    setDb((() => {
      const db = new Database(':memory:');
      db.pragma('foreign_keys = ON');
      runMigrations(db);
      return db;
    })());
    const { baseUrl: b, close: c } = await startTestServer(createApp());
    baseUrl = b;
    close = c;
    // Default: no persisted configs
    getPersistedMcpConfigsSpy.mockResolvedValue({});
  });

  afterEach(async () => {
    await close();
  });

  // c1: environment map persisted (route passes environment in config to addMcp)
  it('mcp-1-c1: POST /opencode/mcp persists environment map', async () => {
    addMcpSpy.mockResolvedValueOnce({});

    const res = await fetch(`${baseUrl}/opencode/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'env-mcp',
        command: 'npx my-server',
        environment: { API_KEY: 'secret', ANOTHER: 'val' },
      }),
    });

    expect(res.status).toBe(200);
    expect(addMcpSpy).toHaveBeenCalledOnce();
    const [nameArg, configArg] = addMcpSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(nameArg).toBe('env-mcp');
    expect(configArg).toMatchObject({
      type: 'local',
      environment: { API_KEY: 'secret', ANOTHER: 'val' },
    });
  });

  // c2: remote type support
  it('mcp-1-c2: POST /opencode/mcp with remote type persists correctly', async () => {
    addMcpSpy.mockResolvedValueOnce({});

    const res = await fetch(`${baseUrl}/opencode/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'remote-mcp',
        url: 'https://example.com/mcp',
        type: 'remote',
      }),
    });

    expect(res.status).toBe(200);
    expect(addMcpSpy).toHaveBeenCalledOnce();
    const [nameArg, configArg] = addMcpSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(nameArg).toBe('remote-mcp');
    expect(configArg).toMatchObject({ type: 'remote', url: 'https://example.com/mcp' });
    expect(configArg).not.toHaveProperty('command');
  });

  // c3: neither command nor url → 400
  it('mcp-1-c3: POST /opencode/mcp without command/url returns 400', async () => {
    const res = await fetch(`${baseUrl}/opencode/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'bad-mcp' }),
    });

    expect(res.status).toBe(400);
    expect(addMcpSpy).not.toHaveBeenCalled();
  });

  // c4: GET exposes environment keys (redacted) and needsCredentials
  it('mcp-1-c4: GET /opencode/mcp exposes environment keys and needsCredentials', async () => {
    listMcpSpy.mockResolvedValueOnce({
      'env-mcp': { status: 'connected' },
      'needs-auth-mcp': { status: 'needs_auth' },
      'no-env-mcp': { status: 'connected' },
    });
    getPersistedMcpConfigsSpy.mockResolvedValueOnce({
      'env-mcp': {
        type: 'local',
        command: ['npx', 'my-server'],
        environment: { API_KEY: 'secret', EMPTY_KEY: '' },
      },
      'needs-auth-mcp': { type: 'remote', url: 'https://example.com' },
      'no-env-mcp': { type: 'local', command: ['npx', 'no-env'] },
    });

    const res = await fetch(`${baseUrl}/opencode/mcp`);
    expect(res.status).toBe(200);

    const body = await res.json() as Array<{
      name: string;
      status: string;
      environment?: Record<string, string>;
      needsCredentials: boolean;
    }>;

    // env-mcp: has environment, one empty value → needsCredentials true; values redacted
    const envEntry = body.find((e) => e.name === 'env-mcp');
    expect(envEntry).toBeDefined();
    expect(envEntry!.environment).toBeDefined();
    expect(Object.keys(envEntry!.environment!)).toContain('API_KEY');
    expect(Object.keys(envEntry!.environment!)).toContain('EMPTY_KEY');
    // Values must NOT contain real secrets
    expect(Object.values(envEntry!.environment!)).not.toContain('secret');
    expect(envEntry!.needsCredentials).toBe(true); // EMPTY_KEY is empty

    // needs-auth-mcp: SDK says needs_auth → needsCredentials true
    const authEntry = body.find((e) => e.name === 'needs-auth-mcp');
    expect(authEntry).toBeDefined();
    expect(authEntry!.needsCredentials).toBe(true);

    // no-env-mcp: no environment in config → no environment key, needsCredentials false
    const noEnvEntry = body.find((e) => e.name === 'no-env-mcp');
    expect(noEnvEntry).toBeDefined();
    expect(noEnvEntry!.environment).toBeUndefined();
    expect(noEnvEntry!.needsCredentials).toBe(false);
  });

  it('issue-1236-c3: GET /opencode/mcp groups granular tool ids by server', async () => {
    listMcpSpy.mockResolvedValueOnce({
      rhythm: { status: 'connected' },
      'pco-services': { status: 'connected' },
    });
    listToolIdsSpy.mockResolvedValueOnce([
      'read',
      'rhythm_list_tasks',
      'rhythm_create_task',
      'pco-services_list_services',
    ]);

    const res = await fetch(`${baseUrl}/opencode/mcp`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ name: string; tools: string[] }>;
    expect(body.find((entry) => entry.name === 'rhythm')?.tools).toEqual([
      'create_task',
      'list_tasks',
    ]);
    expect(body.find((entry) => entry.name === 'pco-services')?.tools).toEqual([
      'list_services',
    ]);
  });
});

// ── #786 — provenance flag derived from live list × curated catalog ──────────
describe('issue-786: GET /opencode/mcp provenance (source) flag', () => {
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeEach(async () => {
    vi.clearAllMocks();
    setDb((() => {
      const db = new Database(':memory:');
      db.pragma('foreign_keys = ON');
      runMigrations(db);
      return db;
    })());
    const { baseUrl: b, close: c } = await startTestServer(createApp());
    baseUrl = b;
    close = c;
    getPersistedMcpConfigsSpy.mockResolvedValue({});
  });

  afterEach(async () => {
    await close();
  });

  it('786-c1: tags curated (by id), rhythm, and adhoc servers; foo is adhoc; set unchanged', async () => {
    // Live engine list: a curated catalog id (stripe), the rhythm MCP,
    // an unknown adhoc server, and the `foo` test server.
    listMcpSpy.mockResolvedValueOnce({
      stripe: { status: 'connected' },
      rhythm: { status: 'connected' },
      'my-adhoc-mcp': { status: 'disconnected' },
      foo: { status: 'connected' },
    });

    const res = await fetch(`${baseUrl}/opencode/mcp`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Array<{ name: string; source: string }>;

    // AC2 — no-server-lost: same names, same count as the live list.
    expect(body).toHaveLength(4);
    expect(new Set(body.map((e) => e.name))).toEqual(
      new Set(['stripe', 'rhythm', 'my-adhoc-mcp', 'foo']),
    );

    // AC1 — curated catalog match (by id) → 'curated'.
    expect(body.find((e) => e.name === 'stripe')!.source).toBe('curated');
    // Three-way split — the brokered rhythm MCP → 'rhythm'.
    expect(body.find((e) => e.name === 'rhythm')!.source).toBe('rhythm');
    // AC3 — present in live list but absent from catalog → 'adhoc'.
    expect(body.find((e) => e.name === 'my-adhoc-mcp')!.source).toBe('adhoc');
    // AC4 — the `foo` test server is never 'curated'.
    expect(body.find((e) => e.name === 'foo')!.source).toBe('adhoc');
  });

  it('786-c2: curated match by human-readable name also tags curated', async () => {
    listMcpSpy.mockResolvedValueOnce({
      Stripe: { status: 'connected' }, // CURATED_MCP_SERVERS[].name
    });

    const res = await fetch(`${baseUrl}/opencode/mcp`);
    const body = (await res.json()) as Array<{ name: string; source: string }>;
    expect(body.find((e) => e.name === 'Stripe')!.source).toBe('curated');
  });
});
