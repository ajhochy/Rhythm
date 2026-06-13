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
import type { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AppError } from '../errors/app_error';

// ---------------------------------------------------------------------------
// Spy stubs – must be declared before vi.mock() so they are hoisted
// ---------------------------------------------------------------------------

const {
  listMcpSpy,
  addMcpSpy,
  connectMcpSpy,
  disconnectMcpSpy,
  removeMcpSpy,
} = vi.hoisted(() => ({
  listMcpSpy: vi.fn(),
  addMcpSpy: vi.fn(),
  connectMcpSpy: vi.fn(),
  disconnectMcpSpy: vi.fn(),
  removeMcpSpy: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    listMcp: listMcpSpy,
    addMcp: addMcpSpy,
    connectMcp: connectMcpSpy,
    disconnectMcp: disconnectMcpSpy,
    removeMcp: removeMcpSpy,
    statusMessage: 'ready',
    listCommands: vi.fn().mockResolvedValue([]),
  },
  opencodeSessionMap: new Map(),
}));

// auth middleware bypass
vi.mock('../config/env', () => ({
  env: {
    agentLocal: true,
    corsAllowedOrigins: [],
    jwtSecret: 'test-secret',
  },
}));

import { createApp } from '../app';

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
    setDb((() => {
      const db = new Database(':memory:');
      db.pragma('foreign_keys = ON');
      runMigrations(db);
      return db;
    })());
    const server = createApp().listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise<void>((res, rej) =>
      server.close((e) => (e ? rej(e) : res())),
    );
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
    connectMcpSpy.mockResolvedValueOnce(true);

    const res = await fetch(`${baseUrl}/opencode/mcp/rhythm-mcp/connect`, {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    expect(connectMcpSpy).toHaveBeenCalledOnce();
    expect(connectMcpSpy).toHaveBeenCalledWith('rhythm-mcp');
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
