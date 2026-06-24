/**
 * CONTRACT TESTS — scope-inherit (scope inheritance) at the resolveProfileScope
 * helper level. Mirrors interactive_scope_parity.test.ts: real in-memory DB +
 * mocked opencode_engine, asserting on the helper's resolved scope.
 *
 *   - scope-c4: skill scope follows task-override > profile precedence (NEW seam)
 *   - scope-c2: profile scope is resolved LIVE — editing the profile changes the
 *             resolved scope on the next call with no task/override change.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    get isReady() { return true; },
    createSession: vi.fn().mockResolvedValue({ id: 'sdk-session-scope-inherit' }),
    listAuthedProviders: vi.fn().mockResolvedValue([]),
  },
  opencodeSessionMap: new Map<string, string>(),
}));

import { resolveProfileScope } from '../services/agent_profile_scope';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('scope-inherit: scope inheritance via resolveProfileScope', () => {
  beforeEach(() => {
    setDb(makeDb());
    vi.clearAllMocks();
  });

  // Regression: the skills allowlist has no override seam → a task can never
  // narrow its skills below the profile's, breaking the "task override" rule.
  it('scope-c4: allowedSkillsJsonOverride takes precedence over the profile allowed_skills_json', async () => {
    new AgentConfigsRepository().insert({
      id: 'skills-profile',
      label: 'Skills profile',
      icon: '🧠',
      allowedSkillsJson: JSON.stringify(['profile-skill']),
      allowedMcpsJson: null,
    });

    // No override → inherit the profile's skills.
    const inherited = await resolveProfileScope('skills-profile');
    expect(inherited.allowedSkillsJson).toBe(JSON.stringify(['profile-skill']));

    // Explicit task-level skills override → task wins.
    const overridden = await resolveProfileScope('skills-profile', {
      allowedSkillsJsonOverride: JSON.stringify(['task-skill']),
    });
    expect(overridden.allowedSkillsJson).toBe(JSON.stringify(['task-skill']));
  });

  // Regression: scope is snapshotted at task-create time instead of resolved
  // live → editing the profile no longer affects existing scheduled tasks.
  it('scope-c2: editing the profile changes the resolved MCP scope on the next call (no override)', async () => {
    const repo = new AgentConfigsRepository();
    repo.insert({
      id: 'live-profile',
      label: 'Live profile',
      icon: '🔁',
      allowedMcpsJson: JSON.stringify(['rhythm']),
    });

    const before = await resolveProfileScope('live-profile');
    expect(Object.keys(before.mcpRoleConfig!.mcpServers)).toEqual(['rhythm']);

    // Operator edits the profile scope — the task is untouched.
    repo.update('live-profile', { allowedMcpsJson: JSON.stringify(['gmail-personal']) });

    const after = await resolveProfileScope('live-profile');
    expect(Object.keys(after.mcpRoleConfig!.mcpServers)).toEqual(['gmail-personal']);
    expect(Object.keys(after.mcpRoleConfig!.mcpServers)).not.toContain('rhythm');
  });
});
