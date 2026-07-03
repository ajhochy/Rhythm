/**
 * #789 (mcp-unify-05) — agent_profile_sync normalizes the DERIVED default
 * allowed_mcps_json to an exact LIVE engine id before persisting it.
 *
 * The importer default is `["rhythm"]`. Under #765 a scope name only enforces
 * anything if it EXACTLY equals a live engine id; a drifted name (e.g. the live
 * engine registered the rhythm MCP as `rhythm-mcp`) would silently scope to
 * nothing. This guard proves the sync routes its derived default through
 * `normalizeDerivedAllowedMcps` against the live `listMcp()` ids.
 *
 * Mirrors agent_profile_sync_skill_alignment.test.ts (the skill analogue) and
 * keeps the same fail-safe contract: an unavailable engine (empty live set, or
 * a throwing listMcp) leaves the default unchanged rather than emptying it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';
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

describe('agent_profile_sync — live MCP-name alignment (#789)', () => {
  let repo: AgentConfigsRepository;

  beforeEach(() => {
    setDb(makeDb());
    repo = new AgentConfigsRepository();
    vi.clearAllMocks();
    listSkills.mockResolvedValue([]); // skills irrelevant here
  });

  it('AC#1: normalizes the derived "rhythm" default to the live id `rhythm-mcp`', async () => {
    // Live engine registered the brokered server under a drifted id. obsidian is
    // also live so the second default name survives unchanged.
    listMcp.mockResolvedValue({
      'rhythm-mcp': { status: 'connected' },
      obsidian: { status: 'connected' },
    });

    await syncOpencodeAgentProfiles([ocAgent('newcomer')]);

    const row = repo.getById('newcomer')!;
    expect(JSON.parse(row.allowedMcpsJson!) as string[]).toEqual(['rhythm-mcp', 'obsidian']);
  });

  it('keeps the derived default verbatim when "rhythm"/"obsidian" are already live ids', async () => {
    listMcp.mockResolvedValue({
      rhythm: { status: 'connected' },
      obsidian: { status: 'connected' },
      'ableton-mcp': { status: 'connected' },
    });

    await syncOpencodeAgentProfiles([ocAgent('newcomer')]);

    const row = repo.getById('newcomer')!;
    expect(JSON.parse(row.allowedMcpsJson!) as string[]).toEqual(['rhythm', 'obsidian']);
  });

  it('drops "obsidian" from the default when it is absent from the live set, keeping "rhythm"', async () => {
    // Only rhythm is live → the importer default drops the dead obsidian name
    // (loudly warned) rather than persisting a name that scopes to nothing.
    listMcp.mockResolvedValue({ rhythm: { status: 'connected' } });

    await syncOpencodeAgentProfiles([ocAgent('newcomer')]);

    const row = repo.getById('newcomer')!;
    expect(JSON.parse(row.allowedMcpsJson!) as string[]).toEqual(['rhythm']);
  });

  it('falls back to the raw default when the engine is unavailable (empty live set)', async () => {
    listMcp.mockResolvedValue({}); // engine up but no servers → empty live set

    await syncOpencodeAgentProfiles([ocAgent('newcomer')]);

    const row = repo.getById('newcomer')!;
    // Empty live set ⇒ skip normalization ⇒ raw curated default preserved
    // (never emptied). #842 widened the default to rhythm+obsidian+pdf-tools.
    expect(JSON.parse(row.allowedMcpsJson!) as string[]).toEqual(['rhythm', 'obsidian', 'pdf-tools']);
  });

  it('falls back to the raw default when listMcp throws (engine not ready)', async () => {
    listMcp.mockRejectedValue(new Error('not ready'));

    await syncOpencodeAgentProfiles([ocAgent('newcomer')]);

    const row = repo.getById('newcomer')!;
    expect(JSON.parse(row.allowedMcpsJson!) as string[]).toEqual(['rhythm', 'obsidian', 'pdf-tools']);
  });

  it('AC#2 back-compat: a user-set allowed_mcps_json is NEVER rewritten on re-sync', async () => {
    // User scoped Secretary to a name that has since drifted out of the live set.
    repo.insert({
      id: 'secretary',
      label: 'Secretary',
      icon: 'assets/agents/opencode.png',
      isAgent: true,
      enabled: true,
      ocAgent: 'secretary',
      sessionSelectable: false,
      allowedMcpsJson: '["ableton","rhythm"]',
      sortOrder: 100,
    });
    listMcp.mockResolvedValue({
      rhythm: { status: 'connected' },
      'ableton-mcp': { status: 'connected' },
    });

    await syncOpencodeAgentProfiles([ocAgent('secretary')]);

    const row = repo.getById('secretary')!;
    // The user-authored row is preserved EXACTLY — `ableton` is not silently
    // rewritten to `ableton-mcp`. It is surfaced as stale by the #785 guard so
    // the user can re-pick; scoping falls back safely (no crash).
    expect(row.allowedMcpsJson).toBe('["ableton","rhythm"]');
  });
});
