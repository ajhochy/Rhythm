/**
 * #787 — Guard: the curated MCP catalog is an INSTALL-TEMPLATE + ENRICHMENT
 * layer ONLY. The single source of truth for "what MCP servers exist" is the
 * LIVE ENGINE list (GET /opencode/mcp, backed by `opencodeClient.listMcp()`).
 *
 * This suite pins the contract documented in the header of
 * src/config/curated_mcp_servers.ts and mirrors the skills source-of-truth
 * decision (materialize-on-install ↔ materialize-on-publish). It fails if a
 * route ever re-introduces `CURATED_MCP_SERVERS` (or a derivative) as a
 * standalone display/listing payload.
 *
 * Two complementary guards:
 *   g1 (behavioral) — GET /opencode/mcp returns EXACTLY the engine's live
 *       servers: a non-curated engine server appears; a curated server the
 *       engine does NOT report is ABSENT. A route that returned the catalog (or
 *       merged it into the listing) would surface canva/notion/etc. here and
 *       fail g1.
 *   g2 (boundary)  — ensureCuratedMcps stays idempotent (add-missing /
 *       refresh-changed / no-op-identical) AND skips token-bridged servers when
 *       no account is connected. (Idempotency is exercised in depth by
 *       opc_curated_mcp_ensure.test.ts; the skip-on-no-account path by
 *       opc_curated_mcp_token_bridge.test.ts — re-asserted here so the boundary
 *       is pinned alongside the display guard.)
 *   g3 (static)    — the MCP route module never ships the bare catalog array to
 *       a client (`res.json(CURATED_MCP_SERVERS)` or a `.map`/`.filter`
 *       derivative of it). Catches a display-source regression even if no
 *       behavioral fixture covers the offending route.
 *
 * Run with:
 *   cd apps/api_server && npx vitest run src/__tests__/curated_mcp_no_display.test.ts
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import {
  CURATED_MCP_SERVERS,
  type CuratedMcpServer,
} from '../config/curated_mcp_servers';
import { OpencodeClientService } from '../services/opencode_client_service';

// ---------------------------------------------------------------------------
// Engine spy stubs – hoisted before vi.mock(). The display list MUST come from
// listMcp(); the catalog only enriches each live entry with requiredEnv.
// ---------------------------------------------------------------------------

const { listMcpSpy, getPersistedMcpConfigsSpy } = vi.hoisted(() => ({
  listMcpSpy: vi.fn(),
  getPersistedMcpConfigsSpy: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    listMcp: listMcpSpy,
    addMcp: vi.fn(),
    connectMcp: vi.fn(),
    disconnectMcp: vi.fn(),
    removeMcp: vi.fn(),
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
import { startTestServer } from './helpers/real_server';

// ─────────────────────────────────────────────────────────────────────────────
// g1 — display always comes from the live engine list, never the catalog.
// ─────────────────────────────────────────────────────────────────────────────
describe('#787 g1: GET /opencode/mcp lists the live engine, not the catalog', () => {
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
    const { baseUrl: b, close: c } = await startTestServer(createApp());
    baseUrl = b;
    close = c;
  });

  afterEach(async () => {
    await close();
  });

  it('returns exactly the engine servers — a non-curated one appears, curated-but-unreported ones are absent', async () => {
    // The engine reports ONE server that is NOT in the curated catalog. If any
    // route returned the catalog (or merged it into the listing), the response
    // would also contain curated names the engine never reported (canva,
    // notion, stripe, mailchimp, pdf-tools) → this test would fail.
    listMcpSpy.mockResolvedValueOnce({
      'some-user-added-server': { status: 'connected' },
    });
    getPersistedMcpConfigsSpy.mockResolvedValueOnce({
      'some-user-added-server': { type: 'local', command: ['npx', 'whatever'] },
    });

    const res = await fetch(`${baseUrl}/opencode/mcp`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ name: string }>;
    const names = body.map((e) => e.name).sort();

    // The live (non-curated) engine server is present.
    expect(names).toEqual(['some-user-added-server']);

    // No curated catalog name leaked into the listing — display is engine-only.
    const curatedIds = CURATED_MCP_SERVERS.map((s) => s.id);
    for (const id of curatedIds) {
      expect(names).not.toContain(id);
    }
  });

  it('empty engine → empty listing, even though the catalog is non-empty', async () => {
    // The catalog has 5 entries; the engine reports none. The display must be
    // empty. A catalog-backed display source would return 5 here.
    expect(CURATED_MCP_SERVERS.length).toBeGreaterThan(0);
    listMcpSpy.mockResolvedValueOnce({});
    getPersistedMcpConfigsSpy.mockResolvedValueOnce({});

    const res = await fetch(`${baseUrl}/opencode/mcp`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<unknown>;
    expect(body).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// g2 — boundary: ensureCuratedMcps (materialize-on-install) stays idempotent and
// skips token-bridged servers when no account is connected. The deep coverage
// lives in opc_curated_mcp_ensure.test.ts (idempotency) and
// opc_curated_mcp_token_bridge.test.ts (skip path); these re-pin the boundary
// next to the display guard so #787's AC3 is asserted here directly.
// ─────────────────────────────────────────────────────────────────────────────
describe('#787 g2: ensureCuratedMcps boundary (materialize-on-install)', () => {
  let dir: string;
  let configPath: string;
  let svc: OpencodeClientService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'opc-787-ensure-'));
    configPath = join(dir, 'opencode.json');
    svc = new OpencodeClientService();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('idempotent: add-missing on first run, no-op-identical on the second', async () => {
    const first = await svc.ensureCuratedMcps({ configPath, register: false });
    expect(first.changed).toBe(true);
    const before = readFileSync(configPath, 'utf8');

    const second = await svc.ensureCuratedMcps({ configPath, register: false });
    expect(second.changed).toBe(false);
    const after = readFileSync(configPath, 'utf8');
    // Byte-identical: a no-op second run never rewrites the file.
    expect(after).toBe(before);
  });

  it('idempotent: refresh-changed rewrites only the drifted entry', async () => {
    // Seed a stale pdf-tools entry; ensure must refresh it to the curated def.
    const pdf = CURATED_MCP_SERVERS.find((s) => s.id === 'pdf-tools')!;
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        mcp: { 'pdf-tools': { type: 'local', command: ['stale-cmd'] } },
      }),
      'utf8',
    );

    const result = await svc.ensureCuratedMcps({ configPath, register: false });
    expect(result.changed).toBe(true);
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(parsed.mcp['pdf-tools'].command).toEqual(pdf.command);
  });

  it('skips a token-bridged server when no account is connected (resolver → null)', async () => {
    // Synthetic token-bridged fixture (the verified catalog has none). With a
    // resolver that returns null (no connected account), the bridged server is
    // SKIPPED entirely — never written with an empty placeholder token — while
    // a zero-auth server in the same set still installs.
    const bridged: CuratedMcpServer = {
      id: 'bridged-fixture',
      name: 'Bridged Fixture',
      type: 'local',
      command: ['npx', 'bridged'],
      requiredEnv: ['BRIDGED_TOKEN'],
      tokenProvider: 'google',
      tokenEnvKey: 'BRIDGED_TOKEN',
    };
    const zeroAuth: CuratedMcpServer = {
      id: 'zero-auth-fixture',
      name: 'Zero Auth Fixture',
      type: 'local',
      command: ['npx', 'zero-auth'],
      requiredEnv: [],
    };

    const tokenResolver = vi.fn(async () => null); // no account connected
    const result = await svc.ensureCuratedMcps({
      configPath,
      register: false,
      tokenResolver,
      servers: [bridged, zeroAuth],
    });

    expect(result.changed).toBe(true);
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    // Bridged server skipped (no connected account) — never written.
    expect(parsed.mcp['bridged-fixture']).toBeUndefined();
    expect(result.servers.some((s) => s.id === 'bridged-fixture')).toBe(false);
    // Zero-auth server in the same set still materialized.
    expect(parsed.mcp['zero-auth-fixture'].command).toEqual(zeroAuth.command);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// g3 — static guard: the MCP route module never ships the bare catalog array to
// a client. Catches a display-source regression on any route, even one no
// behavioral fixture exercises. The sanctioned uses are lookups
// (`CURATED_MCP_SERVERS.find(...)`); a `res.json(CURATED_MCP_SERVERS)` or a
// mapped/filtered derivative returned to the client is forbidden.
// ─────────────────────────────────────────────────────────────────────────────
describe('#787 g3: no route ships the catalog as a display payload', () => {
  const routeSrc = readFileSync(
    join(__dirname, '..', 'routes', 'opencode_mcp_routes.ts'),
    'utf8',
  );

  it('opencode_mcp_routes.ts never returns CURATED_MCP_SERVERS as a response body', () => {
    // res.json(CURATED_MCP_SERVERS) — direct dump of the catalog.
    expect(routeSrc).not.toMatch(/res\.json\(\s*CURATED_MCP_SERVERS/);
    // res.send(CURATED_MCP_SERVERS) — same, other sink.
    expect(routeSrc).not.toMatch(/res\.send\(\s*CURATED_MCP_SERVERS/);
    // A map/filter derivative shipped straight to the client.
    expect(routeSrc).not.toMatch(
      /res\.(json|send)\(\s*CURATED_MCP_SERVERS\s*\.\s*(map|filter)/,
    );
  });

  it('the only sanctioned catalog code uses are .find lookups (template/enrichment)', () => {
    // Every line referencing the catalog must be either the import binding, a
    // JSDoc/comment line, or a `.find(` lookup — the enrichment/template
    // boundary. A new reference that is none of those (e.g. a `.map`/`.filter`
    // returned to a client, or the bare array assigned into a response) fails
    // here and prompts a re-check of the #787 contract.
    const refLines = routeSrc
      .split('\n')
      .filter((l) => /CURATED_MCP_SERVERS/.test(l))
      .map((l) => l.trim())
      .filter((l) => l !== 'CURATED_MCP_SERVERS,') // import binding line
      .filter((l) => !l.startsWith('*') && !l.startsWith('//')); // comments

    // Sanity: the route really does reference the catalog (guards against the
    // filter silently matching nothing if the file is refactored).
    expect(refLines.length).toBeGreaterThan(0);

    // Each remaining usage must be a `.find(` lookup.
    for (const line of refLines) {
      expect(line).toMatch(/CURATED_MCP_SERVERS\.find\(/);
    }
  });
});
