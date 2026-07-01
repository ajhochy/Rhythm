/**
 * #788 — agent_profile_sync validates the importer-default + derived MCP scope
 * against the engine's LIVE server ids (from `listMcp()` / GET /opencode/mcp),
 * not just the static `["rhythm"]` constant.
 *
 * Guarantees (the MCP analogue of agent_profile_sync_skill_alignment.test.ts):
 *  - the default `["rhythm"]` is persisted as scope ONLY when `rhythm` is a live
 *    engine id; a default/derived name absent from the live set is DROPPED and
 *    logged loudly rather than silently persisted as dead scope (the #765 / #781
 *    hazard — a dead name scopes a per-session allowlist to NOTHING);
 *  - when the engine is unavailable (live set empty / listMcp throws) the sync
 *    falls back to its existing behavior (default `["rhythm"]`) WITHOUT crashing
 *    (AC#5 boundary) — never empties the default just because the engine was down.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';
import { logger } from '../../utils/logger';
import type { SdkAgent } from '@opencode-ai/sdk';

const listSkills = vi.fn();
const listMcp = vi.fn();

vi.mock('../opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    listSkills: (...args: unknown[]) => listSkills(...args),
    listMcp: (...args: unknown[]) => listMcp(...args),
  },
  opencodeSessionMap: new Map(),
}));

// Imported AFTER the mock is registered.
import { syncOpencodeAgentProfiles } from '../agent_profile_sync';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function ocAgent(name: string, mode: 'primary' | 'subagent' = 'subagent'): SdkAgent {
  return { name, mode, builtIn: false } as unknown as SdkAgent;
}

describe('agent_profile_sync — live MCP-name validation (#788)', () => {
  let repo: AgentConfigsRepository;

  beforeEach(() => {
    setDb(makeDb());
    repo = new AgentConfigsRepository();
    vi.clearAllMocks();
    // Skill side is out of scope here — keep it fail-open (empty live set).
    listSkills.mockResolvedValue([]);
  });

  it('persists only the live-aligned names of the importer default (rhythm live, obsidian absent → drops obsidian)', async () => {
    listMcp.mockResolvedValue({
      rhythm: { status: 'connected' },
      'ableton-mcp': { status: 'connected' },
    });

    await syncOpencodeAgentProfiles([ocAgent('newcomer', 'primary')]);

    const row = repo.getById('newcomer')!;
    // obsidian is not a live id in this mock → dropped; rhythm survives.
    expect(JSON.parse(row.allowedMcpsJson!)).toEqual(['rhythm']);
  });

  it('persists both default names when both are live ids', async () => {
    listMcp.mockResolvedValue({
      rhythm: { status: 'connected' },
      obsidian: { status: 'connected' },
    });

    await syncOpencodeAgentProfiles([ocAgent('newcomer', 'primary')]);

    const row = repo.getById('newcomer')!;
    expect(JSON.parse(row.allowedMcpsJson!)).toEqual(['rhythm', 'obsidian']);
  });

  it('does NOT silently persist a default MCP name absent from the live set — drops it and logs loudly', async () => {
    const warn = vi.spyOn(logger, 'warn');
    // Live engine has NEITHER `rhythm` NOR `obsidian` (both default names dead here).
    listMcp.mockResolvedValue({
      'ableton-mcp': { status: 'connected' },
      nfl_mcp: { status: 'connected' },
    });

    await syncOpencodeAgentProfiles([ocAgent('newcomer', 'primary')]);

    const row = repo.getById('newcomer')!;
    // The dead `rhythm` name is NOT persisted as scope — the row is left
    // unrestricted (null) rather than scoped to nothing.
    expect(row.allowedMcpsJson).toBeNull();
    // …and the drop is logged loudly (the #785 names-alignment guard relies on
    // this NOT silently persisting a dead name).
    expect(
      warn.mock.calls.some((c) =>
        String(c[0]).includes('MCP name(s) absent from the live engine server set'),
      ),
    ).toBe(true);
  });

  it('BOUNDARY — empty/unavailable live MCP set falls back to the default ["rhythm"] without crashing (AC#5)', async () => {
    // Engine momentarily down: listMcp throws. The sync must not crash and must
    // not empty the default scope just because the live set could not be read.
    listMcp.mockRejectedValue(new Error('engine not ready'));

    await expect(
      syncOpencodeAgentProfiles([ocAgent('newcomer', 'primary')]),
    ).resolves.toEqual({ synced: 1 });

    const row = repo.getById('newcomer')!;
    expect(JSON.parse(row.allowedMcpsJson!)).toEqual(['rhythm', 'obsidian']);
  });

  it('BOUNDARY — empty live set (engine returns no servers) also preserves the default', async () => {
    listMcp.mockResolvedValue({});

    await syncOpencodeAgentProfiles([ocAgent('newcomer', 'primary')]);

    const row = repo.getById('newcomer')!;
    expect(JSON.parse(row.allowedMcpsJson!)).toEqual(['rhythm', 'obsidian']);
  });
});
