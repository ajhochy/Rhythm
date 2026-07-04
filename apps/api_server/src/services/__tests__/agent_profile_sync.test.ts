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

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';
import { syncOpencodeAgentProfiles } from '../agent_profile_sync';
import type { SdkAgent } from '@opencode-ai/sdk';

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
  extra: { prompt?: string; model?: string } = {},
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

  it('refreshes engine-derived ocAgent + sessionSelectable on every sync', async () => {
    repo.insert({
      id: 'workflow-orchestrator',
      label: 'Workflow Orchestrator',
      icon: 'assets/agents/opencode.png',
      isAgent: true,
      enabled: true,
      ocAgent: 'workflow-orchestrator',
      sessionSelectable: false, // stale value the sync should correct to true
      allowedDelegatesJson: '["custom-delegate"]', // user override must survive
      sortOrder: 100,
    });

    await syncOpencodeAgentProfiles([ocAgent('workflow-orchestrator', 'primary')]);

    const after = repo.getById('workflow-orchestrator')!;
    // Dev front-door primary: forced selectable=true on every sync.
    expect(after.sessionSelectable).toBe(true);
    expect(after.ocAgent).toBe('workflow-orchestrator');
    // …but the user's delegate override is preserved, not regenerated.
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
