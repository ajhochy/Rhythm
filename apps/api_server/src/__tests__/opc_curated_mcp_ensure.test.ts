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
import Database from 'better-sqlite3';
import { OpencodeClientService } from '../services/opencode_client_service';
import { CURATED_MCP_SERVERS } from '../config/curated_mcp_servers';
import { startTestServer } from './helpers/real_server';

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
      env: { agentLocal: true, agentExecutionEnabled: true, role: 'local', corsAllowedOrigins: [], jwtSecret: 'test-secret' },
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
    ({ baseUrl, close } = await startTestServer(createApp()));
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

// ─────────────────────────────────────────────────────────────────────────────
// Verified catalog pin — the curated registry is pinned to the verified set
// (5 entries) and shapes are correct. google-workspace + planning-center were
// dropped (no installable npm package; the rhythm MCP already brokers
// Gmail/Calendar + PCO). See docs/ai/decisions.md (2026-06-17).
//
// Acceptance criteria:
//   c1 — exactly 5 entries with the expected id set (no google/pco).
//   c2 — canva + notion are remote with non-empty url, no command, requiredEnv:[].
//   c3 — stripe/mailchimp/pdf-tools are local with non-empty command argv, no url.
//   c4 — every entry has requiredEnv: string[] with the verified keys.
//   c5 — ensuring the full set on an empty config writes all entries; a second
//        run is a byte-identical no-op (changed:false). Remote entries persist
//        as {type:'remote',url}.
// ─────────────────────────────────────────────────────────────────────────────
describe('Verified curated registry completeness + shape', () => {
  it('c1: contains exactly 5 entries with the expected id set (no google/pco)', () => {
    expect(CURATED_MCP_SERVERS).toHaveLength(5);
    const ids = CURATED_MCP_SERVERS.map((s) => s.id).sort();
    expect(ids).toEqual(
      ['canva', 'mailchimp', 'notion', 'pdf-tools', 'stripe'].sort(),
    );
    // Dropped entries are gone.
    expect(ids).not.toContain('google-workspace');
    expect(ids).not.toContain('planning-center');
  });

  it('c2: canva + notion are remote with non-empty url, no command, requiredEnv:[]', () => {
    for (const id of ['canva', 'notion']) {
      const s = CURATED_MCP_SERVERS.find((x) => x.id === id)!;
      expect(s.type).toBe('remote');
      expect(typeof s.url).toBe('string');
      expect(s.url!.length).toBeGreaterThan(0);
      expect(s.command).toBeUndefined();
      expect(s.requiredEnv).toEqual([]);
    }
  });

  it('c3: stripe/mailchimp/pdf-tools are local with non-empty command argv, no url', () => {
    for (const id of ['stripe', 'mailchimp', 'pdf-tools']) {
      const s = CURATED_MCP_SERVERS.find((x) => x.id === id)!;
      expect(s.type).toBe('local');
      expect(Array.isArray(s.command)).toBe(true);
      expect(s.command!.length).toBeGreaterThan(0);
      expect(s.url).toBeUndefined();
    }
    // pdf-tools must launch the stdio transport (the missing `--stdio` was the
    // prior "Connection closed" cause).
    const pdf = CURATED_MCP_SERVERS.find((s) => s.id === 'pdf-tools')!;
    expect(pdf.command).toEqual([
      'npx',
      '-y',
      '--silent',
      '@modelcontextprotocol/server-pdf',
      '--stdio',
    ]);
    // No curated entry is token-bridged anymore.
    expect(CURATED_MCP_SERVERS.every((s) => s.tokenProvider == null)).toBe(true);
  });

  it('c4: every entry has a string[] requiredEnv with the expected keys', () => {
    for (const s of CURATED_MCP_SERVERS) {
      expect(Array.isArray(s.requiredEnv)).toBe(true);
      for (const key of s.requiredEnv) expect(typeof key).toBe('string');
    }
    const byId = (id: string) =>
      CURATED_MCP_SERVERS.find((s) => s.id === id)!.requiredEnv;
    // pdf-tools is zero-auth — must NOT be gated behind the needs-credentials UI.
    expect(byId('pdf-tools')).toEqual([]);
    expect(byId('canva')).toEqual([]);
    expect(byId('notion')).toEqual([]);
    expect(byId('stripe')).toEqual(['STRIPE_SECRET_KEY']);
    expect(byId('mailchimp')).toEqual(['MAILCHIMP_API_KEY']);
  });
});

describe('Verified ensure writes the full set then no-ops (c5)', () => {
  let dir: string;
  let configPath: string;
  let svc: OpencodeClientService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'opencode-curated-full-'));
    configPath = join(dir, 'opencode.json');
    svc = new OpencodeClientService();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('c5: empty config → all non-bridged entries written; remote persists as {type,url}', async () => {
    const result = await svc.ensureCuratedMcps({ configPath, register: false });
    expect(result.changed).toBe(true);

    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));

    // Local zero-auth + API-key servers all written.
    expect(parsed.mcp['pdf-tools'].command).toEqual(PDF.command);
    const stripe = CURATED_MCP_SERVERS.find((s) => s.id === 'stripe')!;
    expect(parsed.mcp['stripe']).toEqual({
      type: 'local',
      command: stripe.command,
    });
    const mailchimp = CURATED_MCP_SERVERS.find((s) => s.id === 'mailchimp')!;
    expect(parsed.mcp['mailchimp']).toEqual({
      type: 'local',
      command: mailchimp.command,
    });

    // Remote entries persist as {type:'remote',url} — no command.
    const canva = CURATED_MCP_SERVERS.find((s) => s.id === 'canva')!;
    expect(parsed.mcp['canva']).toEqual({ type: 'remote', url: canva.url });
    const notion = CURATED_MCP_SERVERS.find((s) => s.id === 'notion')!;
    expect(parsed.mcp['notion']).toEqual({ type: 'remote', url: notion.url });

    // Dropped servers (google-workspace, planning-center) are never written.
    expect(parsed.mcp['google-workspace']).toBeUndefined();
    expect(parsed.mcp['planning-center']).toBeUndefined();
    expect(result.servers.some((s) => s.id === 'google-workspace')).toBe(false);
    expect(result.servers.some((s) => s.id === 'planning-center')).toBe(false);
  });

  it('c5: second run is a byte-identical no-op (changed:false)', async () => {
    await svc.ensureCuratedMcps({ configPath, register: false });
    const before = readFileSync(configPath, 'utf8');

    const result = await svc.ensureCuratedMcps({ configPath, register: false });
    expect(result.changed).toBe(false);
    const after = readFileSync(configPath, 'utf8');
    expect(after).toBe(before);
  });
});
