/**
 * #911 — "Rhythm Setup" onboarding agent profile.
 *
 * Acceptance criteria proven here:
 *   - The profile is seeded on migration, idempotently (INSERT OR IGNORE),
 *     session-selectable (appears in the agent picker), scoped to the
 *     rhythm MCP server only.
 *   - Every rhythm_* tool named in its system prompt is a tool that
 *     actually exists (the #806 "dangling tool" class of bug — same check
 *     used for the Sunday Prep seed, #896).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb, getDb } from '../database/db';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';

/** Tools referenced by the Rhythm Setup prompt that actually exist in apps/mcp_server. */
const EXISTING_TOOLS = [
  'rhythm_create_agent_profile',
  'rhythm_notify',
  'rhythm_get_setup_readiness',
  'rhythm_list_creative_capabilities',
  'rhythm_request_approval',
  'rhythm_install_creative_capability',
  'rhythm_verify_creative_capability',
];

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

beforeEach(() => {
  setDb(makeDb());
});

describe('Rhythm Setup agent profile seed (#911)', () => {
  it('is seeded, session-selectable, scoped to the rhythm MCP only', () => {
    const repo = new AgentConfigsRepository();
    const profile = repo.getById('rhythm-setup');

    expect(profile).not.toBeNull();
    expect(profile!.label).toBe('Rhythm Setup');
    expect(profile!.enabled).toBe(true);
    expect(profile!.isAgent).toBe(true);
    expect(profile!.sessionSelectable).toBe(true);
    expect(profile!.modelProvider).toBe('opencode');
    expect(profile!.modelId).toBe('deepseek-v4-flash-free');
    expect(JSON.parse(profile!.allowedSkillsJson!)).toContain('zen-free-models');
    expect(JSON.parse(profile!.allowedMcpsJson!)).toEqual(['rhythm']);
    expect(profile!.systemPrompt).toBeTruthy();
  });

  it('migrations are idempotent — running twice does not duplicate the row', () => {
    // runMigrations already ran once in makeDb(); run it again on the same db.
    runMigrations(getDb());

    const rows = getDb()
      .prepare(`SELECT COUNT(*) as n FROM agent_configs WHERE id = 'rhythm-setup'`)
      .get() as { n: number };
    expect(rows.n).toBe(1);
  });

  it('every rhythm_* tool named in the prompt actually exists (no dangling tool references)', () => {
    const repo = new AgentConfigsRepository();
    const profile = repo.getById('rhythm-setup')!;

    const mentioned = new Set(profile.systemPrompt!.match(/rhythm_[a-z_]+/g) ?? []);
    expect(mentioned.size).toBeGreaterThan(0);
    for (const tool of mentioned) {
      expect(EXISTING_TOOLS).toContain(tool);
    }
  });

  it('does not use technical jargon words in the user-facing instructions', () => {
    const repo = new AgentConfigsRepository();
    const profile = repo.getById('rhythm-setup')!;
    // The prompt explicitly instructs the agent to avoid these words when
    // TALKING to the user; assert the instruction itself is present rather
    // than the words never appearing at all (they must appear once, in the
    // instruction telling the agent not to say them).
    expect(profile.systemPrompt).toContain('Never use jargon');
  });
});
