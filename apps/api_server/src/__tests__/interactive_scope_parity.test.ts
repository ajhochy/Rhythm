/**
 * P1a — Interactive session MCP scope parity tests
 *
 * Verifies that the interactive/WS path honours the agent profile's
 * allowed_mcps_json when creating an opencode session, matching the
 * behaviour already present on the scheduled/AgentRunner path.
 *
 * Strategy: mirror the spy/inject pattern from issue_738_agent_runner.test.ts
 * — mock opencode_engine so no real opencode process is involved, then assert
 * on the mcpRoleConfig argument passed to createSession.
 *
 * NOTE: The WS path calls resolveProfileScope() before calling createSession()
 * only on the FIRST message to a session that has no SDK mapping
 * (auto-resume / new session path). The three tests below exercise
 * resolveProfileScope() directly so that the assertion is against the helper
 * output rather than wiring a full WS frame.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';

// ── Hoist mock so it's available when vi.mock factory runs ────────────────────

const { mockCreateSession } = vi.hoisted(() => ({
  mockCreateSession: vi.fn().mockResolvedValue({ id: 'sdk-session-p1a-test' }),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    get isReady() { return true; },
    createSession: mockCreateSession,
    listAuthedProviders: vi.fn().mockResolvedValue([]),
  },
  opencodeSessionMap: new Map<string, string>(),
}));

import { resolveProfileScope } from '../services/agent_profile_scope';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { logger } from '../utils/logger';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function insertProfile(id: string, allowedMcpsJson: string | null) {
  return new AgentConfigsRepository().insert({
    id,
    label: `Test profile ${id}`,
    icon: '🤖',
    allowedMcpsJson,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('interactive session MCP scope (P1a)', () => {
  beforeEach(() => {
    setDb(makeDb());
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rhythm-only profile → mcpRoleConfig excludes gmail and pco', async () => {
    // Profile scoped to rhythm only (server-name list)
    insertProfile('rhythm-only', JSON.stringify(['rhythm']));

    const scope = await resolveProfileScope('rhythm-only');

    expect(scope.mcpRoleConfig).not.toBeNull();
    const servers = scope.mcpRoleConfig!.mcpServers;

    // rhythm is included
    expect(Object.keys(servers)).toContain('rhythm');
    // gmail-personal, gmail-work, pco-services are NOT included
    expect(Object.keys(servers)).not.toContain('gmail-personal');
    expect(Object.keys(servers)).not.toContain('gmail-work');
    expect(Object.keys(servers)).not.toContain('gmail');
    expect(Object.keys(servers)).not.toContain('pco-services');
    expect(Object.keys(servers)).not.toContain('pco');
  });

  it('gmail profile → mcpRoleConfig includes gmail', async () => {
    // Profile scoped to gmail-personal (server-name list)
    insertProfile('gmail-only', JSON.stringify(['gmail-personal']));

    const scope = await resolveProfileScope('gmail-only');

    expect(scope.mcpRoleConfig).not.toBeNull();
    const servers = scope.mcpRoleConfig!.mcpServers;

    // gmail-personal IS included
    expect(Object.keys(servers)).toContain('gmail-personal');
    // rhythm is NOT included
    expect(Object.keys(servers)).not.toContain('rhythm');
  });

  it('null allowed_mcps_json → mcpRoleConfig is null (no restriction)', async () => {
    // Profile with no MCP restriction
    insertProfile('unrestricted', null);

    const scope = await resolveProfileScope('unrestricted');

    expect(scope.mcpRoleConfig).toBeNull();
  });

  it('empty allowed_mcps_json array → explicit deny-all MCP scope', async () => {
    insertProfile('deny-all-mcp', JSON.stringify([]));

    const scope = await resolveProfileScope('deny-all-mcp');

    expect(scope.mcpRoleConfig).not.toBeNull();
    expect(scope.mcpRoleConfig!.mcpServers).toEqual({});
    expect(scope.mcpRoleConfig!.allowedToolsJson).toBe('[]');
  });

  it('malformed allowed_mcps_json → explicit deny-all MCP scope and loud log', async () => {
    const errSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    insertProfile('bad-mcp-json', '{not json');

    const scope = await resolveProfileScope('bad-mcp-json');

    expect(scope.mcpRoleConfig).not.toBeNull();
    expect(scope.mcpRoleConfig!.mcpServers).toEqual({});
    expect(scope.mcpRoleConfig!.allowedToolsJson).toBe('[]');
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('bad-mcp-json'),
      expect.stringContaining('{not json'),
    );
  });

  it('unknown/null agentConfigId → graceful fallback, null mcpRoleConfig', async () => {
    // No profile at all → falls through to defaults
    const scope = await resolveProfileScope(null);

    expect(scope.mcpRoleConfig).toBeNull();
    // model is still resolved to the hardcoded default
    expect(scope.model.providerID).toBe('anthropic');
    expect(scope.model.modelID).toBe('claude-sonnet-4-6');
  });

  it('allowedMcpsJsonOverride takes precedence over profile allowed_mcps_json', async () => {
    // Profile says "rhythm only", but scheduled task override says "gmail-personal only"
    insertProfile('rhythm-only-2', JSON.stringify(['rhythm']));

    const overrideJson = JSON.stringify({ 'gmail-personal': ['gmail_send'] });
    const scope = await resolveProfileScope('rhythm-only-2', {
      allowedMcpsJsonOverride: overrideJson,
    });

    expect(scope.mcpRoleConfig).not.toBeNull();
    const servers = scope.mcpRoleConfig!.mcpServers;
    // Override wins → gmail-personal is present, rhythm is absent
    expect(Object.keys(servers)).toContain('gmail-personal');
    expect(Object.keys(servers)).not.toContain('rhythm');
  });

  it('returns allowedSkillsJson, systemPrompt, and ocAgent from profile', async () => {
    new AgentConfigsRepository().insert({
      id: 'full-profile',
      label: 'Full',
      icon: '⚙️',
      systemPrompt: 'You are helpful.',
      allowedSkillsJson: '["skill-a","skill-b"]',
      ocAgent: 'build',
      allowedMcpsJson: null,
    });

    const scope = await resolveProfileScope('full-profile');

    expect(scope.systemPrompt).toBe('You are helpful.');
    expect(scope.allowedSkillsJson).toBe('["skill-a","skill-b"]');
    expect(scope.ocAgent).toBe('build');
  });

  it('malformed allowed_skills_json → deny-all skills JSON and loud log', async () => {
    const errSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    new AgentConfigsRepository().insert({
      id: 'bad-skills-json',
      label: 'Bad skills',
      icon: '⚙️',
      allowedSkillsJson: '{not json',
      allowedMcpsJson: null,
    });

    const scope = await resolveProfileScope('bad-skills-json');

    expect(scope.allowedSkillsJson).toBe('[]');
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('bad-skills-json'),
      expect.stringContaining('{not json'),
    );
  });
});

// ── #931: fail-closed / deny-all scope resolution is logged with id + name ──
//
// Bug this catches: a broken/deny-all scope row degrades the agent silently —
// the operator sees only opaque runtime "not permitted" errors, never a log
// line naming the offending profile. #931 requires malformed / fail-closed /
// deny-all scope resolutions to be logged with the profile id AND human name
// AND scope kind (mcp vs skill), so the row can be fixed without debugging the
// agent at runtime.
describe('scope diagnostics (#931)', () => {
  beforeEach(() => {
    setDb(makeDb());
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('malformed MCP scope log names the profile (id AND human label)', async () => {
    const errSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    new AgentConfigsRepository().insert({
      id: 'broken-mcp',
      label: 'Secretary Assistant',
      icon: '🤖',
      allowedMcpsJson: '{not json',
    });

    await resolveProfileScope('broken-mcp');

    const joined = errSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
    // id, human name, and scope kind must all be present in the same log path.
    expect(joined).toContain('broken-mcp');
    expect(joined).toContain('Secretary Assistant');
    expect(joined).toMatch(/MCP/);
  });

  it('deny-all MCP scope ([]) is logged with id + name + kind (was silent)', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    new AgentConfigsRepository().insert({
      id: 'denyall-mcp',
      label: 'Locked Down',
      icon: '🔒',
      allowedMcpsJson: '[]',
    });

    const scope = await resolveProfileScope('denyall-mcp');
    // Behavior unchanged: still deny-all.
    expect(scope.mcpRoleConfig!.mcpServers).toEqual({});

    const denyWarn = warnSpy.mock.calls
      .map((c) => c.map(String).join(' '))
      .find((line) => /deny-all/i.test(line) && /MCP/i.test(line));
    expect(denyWarn, 'expected a deny-all MCP warn line').toBeTruthy();
    expect(denyWarn).toContain('denyall-mcp');
    expect(denyWarn).toContain('Locked Down');
  });

  it('deny-all skill scope ([]) is logged with id + name + kind (was silent)', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    new AgentConfigsRepository().insert({
      id: 'denyall-skills',
      label: 'No Skills Agent',
      icon: '🔒',
      allowedSkillsJson: '[]',
      allowedMcpsJson: null,
    });

    const scope = await resolveProfileScope('denyall-skills');
    // Behavior unchanged: still deny-all (empty array preserved).
    expect(scope.allowedSkillsJson).toBe('[]');

    const denyWarn = warnSpy.mock.calls
      .map((c) => c.map(String).join(' '))
      .find((line) => /deny-all/i.test(line) && /skill/i.test(line));
    expect(denyWarn, 'expected a deny-all skill warn line').toBeTruthy();
    expect(denyWarn).toContain('denyall-skills');
    expect(denyWarn).toContain('No Skills Agent');
  });

  it('null (unrestricted) scope does NOT emit a deny-all warn (falsification guard)', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    new AgentConfigsRepository().insert({
      id: 'wide-open',
      label: 'Unrestricted',
      icon: '🌐',
      allowedMcpsJson: null,
      allowedSkillsJson: null,
    });

    await resolveProfileScope('wide-open');

    const denyWarn = warnSpy.mock.calls
      .map((c) => c.map(String).join(' '))
      .find((line) => /deny-all/i.test(line));
    expect(denyWarn).toBeUndefined();
  });
});
