/**
 * MCP-2 — ensureCuratedMcps() + curated registry + route.
 *
 * Acceptance criteria (issue MCP-2):
 *   c1 — ensure on config lacking PDF Tools → entry added, changed:true,
 *        file contains the {type:'local',command:[...]} entry.
 *   c2 — ensure again with identical config → changed:false, byte-identical file.
 *   c3 — a desired entry differs (env changed) → that entry rewritten;
 *        unrelated entries (incl. pre-seeded `rhythm`) preserved exactly.
 *   c4 — SDK live-register throws → {changed:true, registered:false, servers}
 *        does NOT throw; file write already succeeded.
 *   c5 — POST /opencode/mcp/curated/ensure → 200 {changed,registered,servers}
 *        with the PDF Tools entry; no secrets in response.
 *
 * Run with:
 *   cd apps/api_server && npx vitest run src/__tests__/opc_curated_mcp_ensure.test.ts
 */

import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import type { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';
import { OpencodeClientService } from '../services/opencode_client_service';
import { CURATED_MCP_SERVERS } from '../config/curated_mcp_servers';

// Desired opencode.json entry shape for the PDF Tools curated server.
const PDF = CURATED_MCP_SERVERS.find((s) => s.id === 'pdf-tools')!;
const PDF_ENTRY = {
  type: 'local',
  command: PDF.command,
};

describe('ensureCuratedMcps diff logic', () => {
  let dir: string;
  let configPath: string;
  let svc: OpencodeClientService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'opencode-curated-'));
    configPath = join(dir, 'opencode.json');
    svc = new OpencodeClientService();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('c1: adds PDF Tools when absent → changed:true, entry persisted', async () => {
    const result = await svc.ensureCuratedMcps({ configPath, register: false });
    expect(result.changed).toBe(true);
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(parsed.mcp['pdf-tools'].type).toBe('local');
    expect(parsed.mcp['pdf-tools'].command).toEqual(PDF.command);
    expect(result.servers.some((s) => s.id === 'pdf-tools')).toBe(true);
  });

  it('c2: identical config → changed:false, file byte-identical (no rewrite)', async () => {
    // First ensure to write the canonical file.
    await svc.ensureCuratedMcps({ configPath, register: false });
    const before = readFileSync(configPath, 'utf8');

    const result = await svc.ensureCuratedMcps({ configPath, register: false });
    expect(result.changed).toBe(false);
    const after = readFileSync(configPath, 'utf8');
    expect(after).toBe(before);
  });

  it('c3: changed entry rewritten; unrelated entries (incl. rhythm) preserved', async () => {
    mkdirSync(dirname(configPath), { recursive: true });
    const rhythmEntry = {
      type: 'local',
      command: ['npx', '-y', '@ajhochy/rhythm-mcp-server'],
      environment: { RHYTHM_API_TOKEN: 'tok-1' },
    };
    // Pre-seed rhythm + a STALE pdf-tools entry (different command) so the
    // desired entry differs and must be refreshed.
    writeFileSync(
      configPath,
      JSON.stringify({
        mcp: {
          rhythm: rhythmEntry,
          'pdf-tools': { type: 'local', command: ['old-pdf-command'] },
        },
      }),
      'utf8',
    );

    const result = await svc.ensureCuratedMcps({ configPath, register: false });
    expect(result.changed).toBe(true);

    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    // pdf-tools refreshed to the desired command.
    expect(parsed.mcp['pdf-tools'].command).toEqual(PDF.command);
    // rhythm preserved exactly.
    expect(parsed.mcp.rhythm).toEqual(rhythmEntry);
  });

  it('c4: live-register throws (register:true, no client) → registered:false, no throw, file written', async () => {
    // register:true but the service has no SDK client → requireClient() throws
    // inside the best-effort block. Must NOT propagate; file must be written.
    const result = await svc.ensureCuratedMcps({ configPath, register: true });
    expect(result.changed).toBe(true);
    expect(result.registered).toBe(false);
    expect(result.servers.length).toBeGreaterThan(0);
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(parsed.mcp['pdf-tools'].command).toEqual(PDF.command);
  });
});

describe('POST /opencode/mcp/curated/ensure route (c5)', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  const ensureCuratedMcpsSpy = vi.fn();

  beforeEach(async () => {
    vi.resetModules();
    ensureCuratedMcpsSpy.mockReset();

    vi.doMock('../services/opencode_engine', () => ({
      opencodeClient: {
        isReady: true,
        ensureCuratedMcps: ensureCuratedMcpsSpy,
        statusMessage: 'ready',
        listCommands: vi.fn().mockResolvedValue([]),
      },
      opencodeSessionMap: new Map(),
    }));
    vi.doMock('../config/env', () => ({
      env: { agentLocal: true, corsAllowedOrigins: [], jwtSecret: 'test-secret' },
    }));

    const { setDb } = await import('../database/db');
    const { runMigrations } = await import('../database/migrations');
    setDb((() => {
      const db = new Database(':memory:');
      db.pragma('foreign_keys = ON');
      runMigrations(db);
      return db;
    })());

    const { createApp } = await import('../app');
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
    vi.doUnmock('../services/opencode_engine');
    vi.doUnmock('../config/env');
  });

  it('c5: POST returns 200 {changed,registered,servers} with PDF Tools, no secrets', async () => {
    ensureCuratedMcpsSpy.mockResolvedValueOnce({
      changed: true,
      registered: false,
      servers: [{ id: 'pdf-tools', name: 'PDF Tools', type: 'local', command: PDF.command, requiredEnv: [] }],
    });

    const res = await fetch(`${baseUrl}/opencode/mcp/curated/ensure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    expect(res.status).toBe(200);
    expect(ensureCuratedMcpsSpy).toHaveBeenCalledOnce();

    const body = (await res.json()) as {
      changed: boolean;
      registered: boolean;
      servers: Array<{ id: string }>;
    };
    expect(body.changed).toBe(true);
    expect(body.registered).toBe(false);
    expect(body.servers.some((s) => s.id === 'pdf-tools')).toBe(true);

    // No secrets in the response (PDF Tools has none; assert nothing token-ish).
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/RHYTHM_API_TOKEN|secret|password/i);
  });
});
