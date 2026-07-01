/**
 * #785 — MCP names-alignment + no-server-lost guards (the MCP analogue of
 * skill_names_alignment.test.ts).
 *
 * Two invariants, both silent when violated:
 *
 *  1. NAMES ALIGNMENT — every name in a persisted/derived `allowed_mcps_json`
 *     (the importer default `["rhythm"]`, and any agent_profile_sync-derived MCP
 *     scope) MUST exist in the engine's live `GET /opencode/mcp` id set. A name
 *     that is absent silently scopes a #765 per-session allowlist to NOTHING —
 *     the #781 hazard: `ableton` when the live id is `ableton-mcp`, `nfl-mcp`
 *     vs `nfl_mcp`, or a leaked test-only `foo`.
 *
 *  2. NO SERVER LOST — the GET /opencode/mcp provenance/enrichment mapping
 *     (findCuratedServer → requiredEnv/needsCredentials/env-redaction) must be
 *     ADDITIVE. The set of server names coming OUT of the route must equal the
 *     set of names in the raw `listMcp()` status map coming IN — no configured
 *     server may disappear through the proxy.
 *
 * The full end-to-end version runs against the real binary in
 * tools/release/smoke_mcp_alignment.sh; this is the fast in-CI guard.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { startTestServer } from './helpers/real_server';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';

const listMcp = vi.fn();
const getPersistedMcpConfigs = vi.fn();

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    statusMessage: 'ready',
    listMcp: (...a: unknown[]) => listMcp(...a),
    getPersistedMcpConfigs: (...a: unknown[]) => getPersistedMcpConfigs(...a),
  },
  opencodeSessionMap: new Map(),
}));

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

/**
 * The #785 / #775 alignment check, factored so prod intent and this test agree:
 * every name in an `allowed_mcps_json` array must appear in the live MCP id set.
 * A name absent from the live set is "dead" — it silently matches no server.
 */
function allowlistAlignsWithLive(
  allowlist: string[],
  liveNames: Set<string>,
): { ok: boolean; dead: string[] } {
  const dead = allowlist.filter((n) => !liveNames.has(n));
  return { ok: dead.length === 0, dead };
}

/** The importer default that agent_profile_sync writes for sortOrder=100 profiles. */
const IMPORTER_DEFAULT_ALLOWED_MCPS_JSON = '["rhythm"]';

describe('MCP names alignment + no-server-lost (#785 / #781 / #765)', () => {
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeEach(async () => {
    setDb(makeDb());
    getPersistedMcpConfigs.mockResolvedValue({});
    const { createApp } = await import('../app');
    const started = await startTestServer(createApp());
    baseUrl = started.baseUrl;
    close = started.close;
  });
  afterEach(async () => {
    await close();
    vi.clearAllMocks();
  });

  /** Fetch the live MCP id set from the proxy (the source the picker + sync use). */
  async function liveMcpNames(): Promise<Set<string>> {
    const res = await fetch(`${baseUrl}/opencode/mcp`);
    const body = (await res.json()) as Array<{ name: string }>;
    return new Set(body.map((s) => s.name));
  }

  it('GET /opencode/mcp mirrors the live listMcp() server ids exactly (no server lost)', async () => {
    // Raw status map keyed by server name, as the engine returns it.
    listMcp.mockResolvedValue({
      rhythm: { status: 'connected' },
      'ableton-mcp': { status: 'connected' },
      nfl_mcp: { status: 'disconnected' },
    });

    const res = await fetch(`${baseUrl}/opencode/mcp`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ name: string }>;

    // NO SERVER LOST: the set OUT equals the set IN — the enrichment mapping
    // (curated lookup / requiredEnv / needsCredentials) drops nothing.
    expect(new Set(body.map((s) => s.name))).toEqual(
      new Set(['rhythm', 'ableton-mcp', 'nfl_mcp']),
    );
  });

  it('the IN id set is a subset of the OUT id set — provenance mapping never drops a server', async () => {
    const inputMap: Record<string, { status: string }> = {
      rhythm: { status: 'connected' },
      'ableton-mcp': { status: 'connected' },
      nfl_mcp: { status: 'connected' },
      'some-uncurated-server': { status: 'disconnected' },
    };
    listMcp.mockResolvedValue(inputMap);

    const before = new Set(Object.keys(inputMap));
    const after = await liveMcpNames();
    // Subset check (AC#3): every configured server survives the mapping.
    for (const name of before) {
      expect(after.has(name)).toBe(true);
    }
    expect(after).toEqual(before);
  });

  it('the importer-default allowed_mcps_json ("rhythm") aligns with the live id set', async () => {
    listMcp.mockResolvedValue({
      rhythm: { status: 'connected' },
      'ableton-mcp': { status: 'connected' },
    });
    const live = await liveMcpNames();

    const defaults = JSON.parse(IMPORTER_DEFAULT_ALLOWED_MCPS_JSON) as string[];
    const result = allowlistAlignsWithLive(defaults, live);
    expect(result.ok, `dead names: ${result.dead.join(', ')}`).toBe(true);
  });

  it('a persisted agent profile allowed_mcps_json must be a subset of the live id set', async () => {
    listMcp.mockResolvedValue({
      rhythm: { status: 'connected' },
      'ableton-mcp': { status: 'connected' },
      nfl_mcp: { status: 'connected' },
    });
    const live = await liveMcpNames();

    // Persist a profile whose MCP scope uses ONLY live ids — must align.
    const repo = new AgentConfigsRepository();
    repo.insert({
      id: 'secretary',
      label: 'Secretary',
      icon: 'robot',
      allowedMcpsJson: JSON.stringify(['rhythm', 'ableton-mcp']),
    });

    const row = repo.getById('secretary')!;
    const stored = JSON.parse(row.allowedMcpsJson!) as string[];
    const result = allowlistAlignsWithLive(stored, live);
    expect(result.ok, `dead names: ${result.dead.join(', ')}`).toBe(true);
  });

  it('BOUNDARY — a stale alias or a leaked test-only server FAILS the alignment check (#781)', async () => {
    // Live engine uses the canonical hyphen/underscore ids.
    const live = new Set(['rhythm', 'ableton-mcp', 'nfl_mcp']);

    // #781 hazard 1: `ableton` display name vs the live `ableton-mcp` id.
    const staleAbleton = allowlistAlignsWithLive(['ableton'], live);
    expect(staleAbleton.ok).toBe(false);
    expect(staleAbleton.dead).toEqual(['ableton']);

    // #781 hazard 2: `nfl-mcp` (hyphen) vs the live `nfl_mcp` (underscore) id.
    const staleNfl = allowlistAlignsWithLive(['nfl-mcp'], live);
    expect(staleNfl.ok).toBe(false);
    expect(staleNfl.dead).toEqual(['nfl-mcp']);

    // A leaked test-only `foo` server is flagged too.
    const leaked = allowlistAlignsWithLive(['rhythm', 'foo'], live);
    expect(leaked.ok).toBe(false);
    expect(leaked.dead).toEqual(['foo']);
  });
});
