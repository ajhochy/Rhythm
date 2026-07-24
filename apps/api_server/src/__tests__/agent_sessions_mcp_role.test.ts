/**
 * Acceptance-contract tests for C1 — MCP Role Session Gating
 *
 * POST /agent-sessions now accepts an optional `mcpRole` string that scopes
 * the session to a .mcp-roles/<role>.mcp.json allowlist at init time.
 *
 * Criteria covered:
 *   (a) Known role → the resolved allowlist is passed to opencodeClient.createSession()
 *   (b) Unknown role → HTTP 400; no session created
 *   (c) Path-traversal role name (e.g. "../foo") → HTTP 400
 *   (d) No mcpRole → session created with existing behavior (no regression)
 *
 * Security invariant (per spec): unknown/invalid role MUST 400 — no silent
 * fallback to full tools.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { startTestServer } from './helpers/real_server';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';

// ── AGENT_LOCAL bypass + spy extraction ──────────────────────────────────────
// vi.hoisted runs before any import (including env.ts), so setting
// AGENT_LOCAL=true here is the only reliable way to bypass requireAuth.
// We also capture mockCreateSession here so vi.mock factories (also hoisted)
// can reference it without a "variable used before init" TDZ error.
const { mockCreateSession } = vi.hoisted(() => {
  process.env.AGENT_LOCAL = 'true';
  // Point MCP_ROLES_DIR at the real .mcp-roles/ in the repo root.
  // Use require('path') + require('path').resolve because the `path` ESM
  // import binding is not yet initialised at vi.hoisted() evaluation time.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePath = require('path') as typeof import('path');
  process.env.MCP_ROLES_DIR = nodePath.resolve(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    '.mcp-roles',
  );
  return {
    mockCreateSession: vi.fn().mockResolvedValue({ id: 'sdk-session-mcp-role-test' }),
  };
});

vi.mock('../services/opencode_engine', () => {
  const mockClient = {
    isReady: true,
    statusMessage: 'Opencode SDK ready',
    listAuthedProviders: vi.fn().mockResolvedValue([]),
    createSession: mockCreateSession,
    ensureReady: vi.fn().mockResolvedValue(true),
    setAuth: vi.fn().mockResolvedValue(true),
    prompt: vi.fn().mockResolvedValue({}),
    promptAsync: vi.fn().mockResolvedValue(true),
    subscribeToEvents: vi.fn().mockResolvedValue(null),
  };
  return {
    opencodeClient: mockClient,
    opencodeSessionMap: new Map<string, string>(),
  };
});

vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: {
    streamSession: vi.fn().mockResolvedValue(undefined),
    stopStream: vi.fn(),
    clearErrorStatus: vi.fn(),
    dispose: vi.fn(),
  },
}));

vi.mock('../services/ws_gateway', () => ({
  broadcast: vi.fn(),
  broadcastSessionUpdated: vi.fn(),
  broadcastSessionRemoved: vi.fn(),
}));

import { createApp } from '../app';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

const BASE_PAYLOAD = {
  agentId: 'claude-code',
  cwd: os.homedir(),
  name: 'Test Session',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /agent-sessions — C1 mcpRole gating', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;

  beforeEach(async () => {
    setDb(makeDb());
    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
    vi.clearAllMocks();
    // Restore isReady so the closure isn't poisoned across tests.
    const { opencodeClient } = await import('../services/opencode_engine');
    (opencodeClient as { isReady: boolean }).isReady = true;
  });

  // ── (a) Known role → allowlist passed to SDK init ─────────────────────────

  it('C1-a: known mcpRole "church-admin" → createSession called with resolved allowlist', async () => {
    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...BASE_PAYLOAD, mcpRole: 'church-admin' }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;

    // Session row should carry the resolved role name.
    expect(body.mcpRole).toBe('church-admin');
    // mcpAllowedToolsJson should be a non-empty JSON string.
    expect(typeof body.mcpAllowedToolsJson).toBe('string');
    const allowedTools = JSON.parse(body.mcpAllowedToolsJson as string) as Record<string, string[]>;
    // church-admin.mcp.json has a "rhythm" server with allowedTools.
    expect(Array.isArray(allowedTools['rhythm'])).toBe(true);
    expect(allowedTools['rhythm'].length).toBeGreaterThan(0);

    // The resolved mcpRoleConfig MUST have been passed to createSession.
    expect(mockCreateSession).toHaveBeenCalledOnce();
    const [, , mcpRoleConfig] = mockCreateSession.mock.calls[0] as [
      string,
      string,
      { role: string; mcpServers: Record<string, unknown>; allowedToolsJson: string } | undefined,
    ];
    expect(mcpRoleConfig).toBeDefined();
    expect(mcpRoleConfig?.role).toBe('church-admin');
    expect(typeof mcpRoleConfig?.mcpServers).toBe('object');
    expect(typeof mcpRoleConfig?.allowedToolsJson).toBe('string');
  });

  // ── (a2) #1154 regression — secretary/email-assistant/graphic-designer ────
  // resolve via MCP_ROLES_DIR the same way church-admin does above. #1154's
  // bug was that the shipped .app never set MCP_ROLES_DIR at all (fixed in
  // ApiServerService.buildApiServerEnvironment); the server-side resolution
  // exercised here was already correct given a correct env var, which is
  // exactly what this suite pins down.
  it.each(['secretary', 'email-assistant', 'graphic-designer'])(
    'C1-a2: known mcpRole %s resolves via MCP_ROLES_DIR (no "Unknown mcpRole" 400)',
    async (role) => {
      const res = await fetch(`${baseUrl}/agent-sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...BASE_PAYLOAD, mcpRole: role }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.mcpRole).toBe(role);
    },
  );

  // ── (b) Unknown role → 400, no session created ────────────────────────────

  it('C1-b: unknown mcpRole → HTTP 400 and no session created', async () => {
    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...BASE_PAYLOAD, mcpRole: 'no-such-role-xyz' }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    // Error shape from errorHandler: { error: { code, message } }
    const errorObj = body.error as Record<string, string>;
    expect(typeof errorObj.message).toBe('string');
    expect(errorObj.message.toLowerCase()).toContain('unknown mcp');

    // createSession must NOT have been called — session was rejected before SDK creation.
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  // ── (c) Path-traversal role name → 400 ───────────────────────────────────

  it('C1-c: path-traversal mcpRole "../foo" → HTTP 400', async () => {
    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...BASE_PAYLOAD, mcpRole: '../foo' }),
    });

    expect(res.status).toBe(400);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('C1-c2: role with slash "subdir/role" → HTTP 400', async () => {
    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...BASE_PAYLOAD, mcpRole: 'subdir/role' }),
    });

    expect(res.status).toBe(400);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('C1-c3: role with dots "church..admin" → HTTP 400', async () => {
    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...BASE_PAYLOAD, mcpRole: 'church..admin' }),
    });

    expect(res.status).toBe(400);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  // ── (d) No mcpRole → unchanged behavior ──────────────────────────────────

  it('C1-d: no mcpRole → session created normally with existing behavior', async () => {
    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(BASE_PAYLOAD),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.mcpRole).toBeNull();
    expect(body.mcpAllowedToolsJson).toBeNull();

    // createSession called without a third argument (mcpRoleConfig = undefined).
    expect(mockCreateSession).toHaveBeenCalledOnce();
    const [, , mcpRoleConfig] = mockCreateSession.mock.calls[0] as [
      string,
      string,
      unknown,
    ];
    expect(mcpRoleConfig).toBeUndefined();
  });

  // ── (d2) Explicit null mcpRole → treated as absent ───────────────────────

  it('C1-d2: explicit null mcpRole → same as omitting it (no role applied)', async () => {
    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...BASE_PAYLOAD, mcpRole: null }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.mcpRole).toBeNull();
  });

  // ── (e) Non-string mcpRole → 400 ─────────────────────────────────────────

  it('C1-e: non-string mcpRole (number) → HTTP 400', async () => {
    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...BASE_PAYLOAD, mcpRole: 42 }),
    });

    expect(res.status).toBe(400);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });
});
