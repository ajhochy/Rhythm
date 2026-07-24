/**
 * Unit tests for syncOpencodeAgentProfiles (agent_profile_sync.ts)
 *
 * Regression for the live bug: running the OpenCode → agent_configs sync wiped a
 * profile's Rhythm overlay allowlist fields (Secretary lost its allowed_mcps_json
 * and had to be re-PATCHed). The three overlay JSON columns are USER-OWNED and
 * must NEVER be overwritten on UPDATE of an existing row:
 *
 *   - allowed_mcps_json
 *   - allowed_skills_json
 *   - allowed_delegates_json
 *
 * They may take importer defaults on FIRST INSERT only; subsequent syncs must
 * preserve whatever the user set in the designer. Engine-derived fields
 * (ocAgent, sessionSelectable incl. the dev front-door overrides) must still
 * refresh on every sync.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';
import { syncOpencodeAgentProfiles } from '../agent_profile_sync';
import type { SdkAgent } from '@opencode-ai/sdk';

// #1135 — the delete-stale-on-disable reconcile pass (below) needs a real,
// writable-but-throwaway HOME so it can observe an actual on-disk .md being
// removed. Every other describe block in this file never touches the
// filesystem (isTestEnv() keeps opencode_agent_writer's writes gated off by
// default), so redirecting os.homedir() here is safe for the rest of the file.
const homeState = vi.hoisted(() => ({ home: '' }));
vi.mock('os', () => {
  const homedir = () => homeState.home;
  return { default: { homedir }, homedir };
});
import { writeAgentProfileFile } from '../opencode_agent_writer';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  return db;
}

/** Minimal prefetched opencode agent (only the fields the sync reads). */
function ocAgent(
  name: string,
  mode: 'primary' | 'subagent' = 'subagent',
  extra: { prompt?: string; model?: string; permission?: Record<string, unknown> } = {},
): SdkAgent {
  return {
    name,
    mode,
    builtIn: false,
    ...extra,
  } as unknown as SdkAgent;
}

describe('syncOpencodeAgentProfiles — overlay-field preservation', () => {
  let repo: AgentConfigsRepository;

  beforeEach(() => {
    setDb(makeDb());
    repo = new AgentConfigsRepository();
  });

  it('preserves user mcps/skills overlays but reconciles Secretary\'s delegate roster to the role file on re-sync (#889)', async () => {
    // A user scoped "Secretary" in the designer. mcps/skills stay user-owned;
    // the delegate roster is role-file-managed (#889 — Secretary delegates to
    // church specialists via rhythm_delegate, so a stray 'coding-agent' entry
    // is reconciled away to the canonical `.mcp-roles/secretary.mcp.json`
    // roster, not preserved). Other managers' overrides still survive — see the
    // workflow-orchestrator case below.
    repo.insert({
      id: 'secretary',
      label: 'Secretary',
      icon: 'assets/agents/opencode.png',
      isAgent: true,
      enabled: true,
      ocAgent: 'secretary',
      sessionSelectable: false,
      allowedMcpsJson: '["rhythm","gmail-work","pco-services"]',
      allowedSkillsJson: '["smoke-test","verification-gate"]',
      allowedDelegatesJson: '["coding-agent"]',
      sortOrder: 100,
    });

    await syncOpencodeAgentProfiles([ocAgent('secretary')]);

    const after = repo.getById('secretary')!;
    // User-owned overlays survive.
    expect(after.allowedMcpsJson).toBe('["rhythm","gmail-work","pco-services"]');
    expect(after.allowedSkillsJson).toBe('["smoke-test","verification-gate"]');
    // Delegate roster is reconciled to the canonical role-file roster, NOT the
    // stray user value.
    expect(after.allowedDelegatesJson).not.toBe('["coding-agent"]');
    const delegates = JSON.parse(after.allowedDelegatesJson!) as string[];
    expect(delegates).toContain('theologian');
    expect(delegates).not.toContain('coding-agent');
  });

  it('still preserves user-set model + systemPrompt on re-sync (UPDATE)', async () => {
    repo.insert({
      id: 'secretary',
      label: 'Secretary',
      icon: 'assets/agents/opencode.png',
      isAgent: true,
      enabled: true,
      ocAgent: 'secretary',
      sessionSelectable: false,
      systemPrompt: 'User-edited prompt',
      modelProvider: 'anthropic',
      modelId: 'claude-opus-4-8',
      sortOrder: 100,
    });

    await syncOpencodeAgentProfiles([
      ocAgent('secretary', 'subagent', {
        prompt: 'Engine prompt that must NOT clobber the user value',
        model: 'anthropic/claude-haiku-4-5',
      }),
    ]);

    const after = repo.getById('secretary')!;
    expect(after.systemPrompt).toBe('User-edited prompt');
    expect(after.modelProvider).toBe('anthropic');
    expect(after.modelId).toBe('claude-opus-4-8');
  });

  it('refreshes engine-derived ocAgent on every sync; sessionSelectable is user-owned', async () => {
    repo.insert({
      id: 'workflow-orchestrator',
      label: 'Workflow Orchestrator',
      icon: 'assets/agents/opencode.png',
      isAgent: true,
      enabled: true,
      ocAgent: 'stale-handle', // internal routing field the sync should repair
      sessionSelectable: false, // USER-OWNED — a demotion must survive every sync
      allowedDelegatesJson: '["custom-delegate"]', // user override must survive
      sortOrder: 100,
    });

    await syncOpencodeAgentProfiles([ocAgent('workflow-orchestrator', 'primary')]);

    const after = repo.getById('workflow-orchestrator')!;
    // session_selectable is user-owned after first insert: the sync must not
    // recompute it on existing rows — recomputing on every picker refresh
    // (including the dev front-door force) was the #1039-family silent-revert
    // bug.
    expect(after.sessionSelectable).toBe(false);
    // ocAgent is engine-internal (always the projected file handle) — still
    // repaired when stale.
    expect(after.ocAgent).toBe('workflow-orchestrator');
    // …and the user's delegate override is preserved, not regenerated.
    expect(after.allowedDelegatesJson).toBe('["custom-delegate"]');
  });

  it('imports a brand-new opencode agent with ocAgent + sessionSelectable set', async () => {
    await syncOpencodeAgentProfiles([ocAgent('newcomer', 'primary')]);

    const created = repo.getById('newcomer')!;
    expect(created).not.toBeNull();
    expect(created.ocAgent).toBe('newcomer');
    // primary + non-internal + not a secondary front-door → selectable.
    expect(created.sessionSelectable).toBe(true);
    // First-insert importer defaults apply. The engine is not mocked here so
    // listMcp() yields an empty live set → normalize/validate skip → the raw
    // curated default is persisted verbatim (#842 — rhythm + obsidian +
    // pdf-tools default for generic/non-roled profiles).
    expect(created.allowedMcpsJson).toBe('["rhythm","obsidian","pdf-tools"]');
  });

  it('keeps dev front-door secondaries out of the picker on sync', async () => {
    await syncOpencodeAgentProfiles([ocAgent('plan', 'primary')]);

    const created = repo.getById('plan')!;
    expect(created.sessionSelectable).toBe(false);
  });
});

// #858 — a sync pass must repair rows whose oc_agent is stale (empty, or a
// UUID that no longer matches the row's own id — e.g. copied from another
// row). These rows are NOT reachable via the engine-agents loop (their id is
// a UUID that the engine has never reported as a live agent name), so the
// only way to converge oc_agent is a dedicated backfill pass over every
// enabled agent_configs row.
describe('syncOpencodeAgentProfiles — #858 oc_agent backfill', () => {
  let repo: AgentConfigsRepository;

  beforeEach(() => {
    setDb(makeDb());
    repo = new AgentConfigsRepository();
  });

  it('backfills a NULL oc_agent to the row id for a UUID-keyed profile never reported by the engine', async () => {
    const uuidId = '44444444-4444-4444-8444-444444444444';
    repo.insert({
      id: uuidId,
      label: 'AI Trend Researcher',
      icon: '',
      isAgent: true,
      enabled: true,
      // ocAgent intentionally omitted — simulates a designer-created profile
      // that has never round-tripped through the opencode agent-file writer.
      sessionSelectable: true,
      sortOrder: 100,
    });

    // The engine reports no agents at all this pass (e.g. still starting up,
    // or this profile's .md file hasn't been picked up yet).
    await syncOpencodeAgentProfiles([]);

    const after = repo.getById(uuidId)!;
    expect(after.ocAgent).toBe(uuidId);
  });

  it('backfills an oc_agent that does not match the row id (stale/incorrect value)', async () => {
    const uuidId = '55555555-5555-4555-8555-555555555555';
    repo.insert({
      id: uuidId,
      label: 'Org Optimizer Discovery',
      icon: '',
      isAgent: true,
      enabled: true,
      ocAgent: 'some-other-agents-uuid-leaked-in-by-mistake',
      sessionSelectable: true,
      sortOrder: 100,
    });

    await syncOpencodeAgentProfiles([]);

    const after = repo.getById(uuidId)!;
    expect(after.ocAgent).toBe(uuidId);
  });

  it('does NOT touch a slug-keyed profile whose oc_agent already equals a live engine agent name', async () => {
    repo.insert({
      id: 'secretary',
      label: 'Secretary',
      icon: '',
      isAgent: true,
      enabled: true,
      ocAgent: 'secretary',
      sessionSelectable: false,
      sortOrder: 100,
    });

    await syncOpencodeAgentProfiles([ocAgent('secretary')]);

    const after = repo.getById('secretary')!;
    expect(after.ocAgent).toBe('secretary');
  });

  it('does not backfill a disabled profile', async () => {
    const uuidId = '66666666-6666-4666-8666-666666666666';
    repo.insert({
      id: uuidId,
      label: 'Disabled Custom Agent',
      icon: '',
      isAgent: true,
      enabled: false,
      sessionSelectable: true,
      sortOrder: 100,
    });

    await syncOpencodeAgentProfiles([]);

    const after = repo.getById(uuidId)!;
    expect(after.ocAgent).toBeNull();
  });

  it('does not backfill a CLI model-selector preset (claude-code) — it is not a projectable opencode agent', async () => {
    // claude-code is seeded by migrations with oc_agent NULL (it is a model
    // selector, not an opencode agent — see opencode_agent_writer's
    // CLI_MODEL_PRESETS exclusion). The backfill must leave it untouched;
    // downstream callers already fall back id-for-null on this specific row.
    await syncOpencodeAgentProfiles([]);

    const after = repo.getById('claude-code')!;
    expect(after.ocAgent).toBeNull();
  });
});

// #900 — a profile row inserted without ever calling writeAgentProfileFile has no
// ~/.config/opencode/agents/<id>.md, so any session routed to it crashes with
// "UnknownError: UnknownError" (agent-registry lookup failure). The sync must
// self-heal these by re-projecting the missing file. writeAgentProfileFile/
// isAgentProfileFileMissing are file-write gated off under vitest (isTestEnv()),
// so this test only proves the pass runs over every enabled row without throwing —
// the file-write itself is covered by the writer module's own gating contract.
describe('syncOpencodeAgentProfiles — #900 orphaned agent-file self-heal', () => {
  let repo: AgentConfigsRepository;

  beforeEach(() => {
    setDb(makeDb());
    repo = new AgentConfigsRepository();
  });

  it('does not throw when an enabled projectable profile has no on-disk agent file', async () => {
    repo.insert({
      id: 'orphaned-duplicate',
      label: 'AI Trend Researcher',
      icon: '',
      isAgent: true,
      enabled: true,
      ocAgent: 'orphaned-duplicate',
      sessionSelectable: true,
      sortOrder: 100,
    });

    await expect(syncOpencodeAgentProfiles([])).resolves.toEqual({ synced: 0 });
  });

  it('skips disabled rows without throwing', async () => {
    repo.insert({
      id: 'disabled-orphan',
      label: 'Disabled Orphan',
      icon: '',
      isAgent: true,
      enabled: false,
      sessionSelectable: true,
      sortOrder: 100,
    });

    await expect(syncOpencodeAgentProfiles([])).resolves.toEqual({ synced: 0 });
  });
});

// #1073 (OCU-32) — profile sync reads the engine's resolved permission block
// back into corePermissionsJson, backfill-only (never clobbers a designer edit).
describe('syncOpencodeAgentProfiles — permission block sync-back (#1073)', () => {
  let repo: AgentConfigsRepository;

  beforeEach(() => {
    setDb(makeDb());
    repo = new AgentConfigsRepository();
  });

  it('seeds corePermissionsJson from the engine on first import, including arbitrary keys + pattern maps', async () => {
    await syncOpencodeAgentProfiles([
      ocAgent('new-perm-agent', 'primary', {
        permission: { websearch: 'deny', external_directory: { '/tmp/*': 'allow', '*': 'deny' } },
      }),
    ]);

    const created = repo.getById('new-perm-agent')!;
    expect(JSON.parse(created.corePermissionsJson!)).toEqual({
      websearch: 'deny',
      external_directory: { '/tmp/*': 'allow', '*': 'deny' },
    });
  });

  it('does not set corePermissionsJson when the engine reports no permission block', async () => {
    await syncOpencodeAgentProfiles([ocAgent('no-perm-agent', 'primary', {})]);
    expect(repo.getById('no-perm-agent')!.corePermissionsJson).toBeNull();
  });

  it('backfills corePermissionsJson on re-sync only when it is currently null', async () => {
    repo.insert({
      id: 'backfill-agent',
      label: 'Backfill Agent',
      icon: '',
      isAgent: true,
      enabled: true,
      ocAgent: 'backfill-agent',
      sessionSelectable: true,
      corePermissionsJson: null,
      sortOrder: 100,
    });

    await syncOpencodeAgentProfiles([
      ocAgent('backfill-agent', 'primary', { permission: { skill: 'allow' } }),
    ]);

    expect(JSON.parse(repo.getById('backfill-agent')!.corePermissionsJson!)).toEqual({ skill: 'allow' });
  });

  it('NEVER overwrites a user-set corePermissionsJson on re-sync — even when the engine reports a different block', async () => {
    repo.insert({
      id: 'user-owned-perm-agent',
      label: 'User Owned Perm Agent',
      icon: '',
      isAgent: true,
      enabled: true,
      ocAgent: 'user-owned-perm-agent',
      sessionSelectable: true,
      corePermissionsJson: JSON.stringify({ bash: 'ask' }),
      sortOrder: 100,
    });

    await syncOpencodeAgentProfiles([
      ocAgent('user-owned-perm-agent', 'primary', { permission: { websearch: 'deny' } }),
    ]);

    expect(JSON.parse(repo.getById('user-owned-perm-agent')!.corePermissionsJson!)).toEqual({ bash: 'ask' });
  });
});

// #1135 — belt-and-braces reconcile: a row that is now DISABLED must have its
// stale ~/.config/opencode/agents/<id>.md deleted at every sync, catching rows
// left stale on disk (disabled before this fix shipped, or by a path that
// bypassed the PATCH controller's state-aware write). Needs the real
// VITEST=false / mocked-homedir harness (see opencode_agent_writer_projection.test.ts)
// since opencode_agent_writer's write/delete paths gate off under vitest by default.
describe('syncOpencodeAgentProfiles — #1135 delete-stale-on-disable reconcile', () => {
  let repo: AgentConfigsRepository;
  const originalVitest = process.env.VITEST;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    setDb(makeDb());
    repo = new AgentConfigsRepository();
    homeState.home = join('/tmp', `rhythm-agent-sync-${randomUUID()}`);
    process.env.VITEST = 'false';
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env.VITEST = originalVitest;
    process.env.NODE_ENV = originalNodeEnv;
    if (homeState.home) rmSync(homeState.home, { recursive: true, force: true });
    homeState.home = '';
  });

  const projectedPath = (id: string) =>
    join(homeState.home, '.config', 'opencode', 'agents', `${id}.md`);

  it('deletes the on-disk .md of a disabled projectable row', async () => {
    repo.insert({
      id: 'stale-disabled-agent',
      label: 'Stale Disabled Agent',
      icon: '',
      isAgent: true,
      enabled: true,
      ocAgent: 'stale-disabled-agent',
      sessionSelectable: true,
      sortOrder: 100,
    });
    writeAgentProfileFile(repo.getById('stale-disabled-agent')!);
    expect(existsSync(projectedPath('stale-disabled-agent'))).toBe(true);

    // Disabled directly at the DB layer (not via the PATCH state-aware call)
    // — the exact "file left stale by a path other than the PATCH controller"
    // scenario this reconcile pass exists to catch.
    repo.update('stale-disabled-agent', { enabled: false });

    await syncOpencodeAgentProfiles([]);

    expect(existsSync(projectedPath('stale-disabled-agent'))).toBe(false);
  });

  it("leaves an enabled row's file intact", async () => {
    repo.insert({
      id: 'still-enabled-agent',
      label: 'Still Enabled Agent',
      icon: '',
      isAgent: true,
      enabled: true,
      ocAgent: 'still-enabled-agent',
      sessionSelectable: true,
      sortOrder: 100,
    });
    writeAgentProfileFile(repo.getById('still-enabled-agent')!);
    expect(existsSync(projectedPath('still-enabled-agent'))).toBe(true);

    await syncOpencodeAgentProfiles([]);

    expect(existsSync(projectedPath('still-enabled-agent'))).toBe(true);
  });
});
