/**
 * MCP remote-OAuth workaround — route contract tests.
 *
 * Spec: docs/superpowers/specs/2026-06-17-mcp-remote-oauth-workaround.md
 *
 *   POST /opencode/mcp/:name/oauth/start  → { authorizationUrl }
 *   GET  /opencode/mcp/:name/oauth/status → { status }
 *
 * The McpOAuthService is mocked; these tests assert the routes resolve the
 * curated serverUrl for :name, call the service, and shape the response.
 *
 * Run with:
 *   cd apps/api_server && npx vitest run src/__tests__/opc_mcp_oauth_routes.test.ts
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';

const { startSpy, statusSpy } = vi.hoisted(() => ({
  startSpy: vi.fn(),
  statusSpy: vi.fn(),
}));

// The opencode engine is imported transitively by the router; stub it.
vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    listMcp: vi.fn().mockResolvedValue({}),
    getPersistedMcpConfigs: vi.fn().mockResolvedValue({}),
    reconnectMcp: vi.fn().mockResolvedValue(true),
    statusMessage: 'ready',
  },
  opencodeSessionMap: new Map(),
}));

// Mock the OAuth service singleton the routes consume.
vi.mock('../services/mcp_oauth_engine', () => ({
  mcpOAuthService: {
    start: startSpy,
    status: statusSpy,
  },
}));

vi.mock('../config/env', () => ({
  env: {
    agentLocal: true,
    corsAllowedOrigins: [],
    jwtSecret: 'test-secret',
  },
}));

import { createApp } from '../app';
import { startTestServer } from './helpers/real_server';

describe('mcp-oauth routes', () => {
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
  });

  afterEach(async () => {
    await close();
  });

  it('POST /opencode/mcp/:name/oauth/start resolves the curated serverUrl and returns authorizationUrl', async () => {
    startSpy.mockResolvedValueOnce({ authorizationUrl: 'https://provider/authorize?x=1' });

    const res = await fetch(`${baseUrl}/opencode/mcp/canva/oauth/start`, {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    expect(startSpy).toHaveBeenCalledOnce();
    const [nameArg, urlArg] = startSpy.mock.calls[0] as [string, string];
    expect(nameArg).toBe('canva');
    // canva's curated remote URL
    expect(urlArg).toBe('https://mcp.canva.com/mcp');

    const body = (await res.json()) as { authorizationUrl: string };
    expect(body.authorizationUrl).toBe('https://provider/authorize?x=1');
  });

  it('POST /opencode/mcp/:name/oauth/start → 400 when the server is not a known remote OAuth server', async () => {
    const res = await fetch(`${baseUrl}/opencode/mcp/not-a-real-server/oauth/start`, {
      method: 'POST',
    });
    expect(res.status).toBe(400);
    expect(startSpy).not.toHaveBeenCalled();
  });

  it('GET /opencode/mcp/:name/oauth/status returns the current status string', async () => {
    statusSpy.mockReturnValueOnce('connected');

    const res = await fetch(`${baseUrl}/opencode/mcp/canva/oauth/status`);
    expect(res.status).toBe(200);
    expect(statusSpy).toHaveBeenCalledWith('canva');
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('connected');
  });
});
