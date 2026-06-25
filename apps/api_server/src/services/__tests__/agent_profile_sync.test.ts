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

  it('preserves all three user-set overlay JSON fields on re-sync (UPDATE)', async () => {
    // Seed an existing profile with user-customised overlay allowlists, as if a
    // user had scoped "Secretary" in the designer.
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
    expect(after.allowedMcpsJson).toBe('["rhythm","gmail-work","pco-services"]');
    expect(after.allowedSkillsJson).toBe('["smoke-test","verification-gate"]');
    expect(after.allowedDelegatesJson).toBe('["coding-agent"]');
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
    // First-insert importer defaults apply.
    expect(created.allowedMcpsJson).toBe('["rhythm"]');
  });

  it('keeps dev front-door secondaries out of the picker on sync', async () => {
    await syncOpencodeAgentProfiles([ocAgent('plan', 'primary')]);

    const created = repo.getById('plan')!;
    expect(created.sessionSelectable).toBe(false);
  });
});
