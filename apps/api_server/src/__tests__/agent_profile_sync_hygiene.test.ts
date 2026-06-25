/**
 * P3 — agent_profile_sync hygiene tests.
 *
 * Tests that syncOpencodeAgentProfiles populates model_provider/model_id,
 * allowed_mcps_json, and allowed_skills_json for imported rows (sortOrder=100),
 * and that exactly one dev front-door agent is session_selectable=true.
 *
 * No live opencode process needed — fixtures are injected via `prefetched`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { syncOpencodeAgentProfiles } from '../services/agent_profile_sync';

// ---------------------------------------------------------------------------
// Minimal SdkAgent fixture factory
// ---------------------------------------------------------------------------
type FixtureAgent = {
  name: string;
  mode: string;
  builtIn: boolean;
  prompt?: string;
  model?: string;
};

/** Build a small fixture registry of AI-Workflow agents (no model, primary mode). */
function makeWorkflowAgents(): FixtureAgent[] {
  return [
    // The three dev front-doors — only workflow-orchestrator should end up selectable
    { name: 'workflow-orchestrator', mode: 'primary', builtIn: false },
    { name: 'superpowers', mode: 'primary', builtIn: false },
    { name: 'plan', mode: 'primary', builtIn: false },
    // Workflow-chain specialists (subagent mode matches production agent definitions)
    { name: 'coding-agent', mode: 'subagent', builtIn: false },
    { name: 'verification-gate', mode: 'subagent', builtIn: false },
    { name: 'failure-triage', mode: 'subagent', builtIn: false },
    { name: 'smoke-test-writer', mode: 'subagent', builtIn: false },
    { name: 'project-state-updater', mode: 'subagent', builtIn: false },
    { name: 'workflow-retrospective', mode: 'subagent', builtIn: false },
    // One agent with a Tier 2 mention in its prompt
    {
      name: 'issue-writer',
      mode: 'subagent',
      builtIn: false,
      prompt: 'You are a Tier 2 agent. Write GitHub issues.',
    },
    // One agent with a Tier 1 mention
    {
      name: 'planning-agent',
      mode: 'subagent',
      builtIn: false,
      prompt: 'You are a Tier 1 high-complexity planner.',
    },
    // One agent with a Tier 3 mention
    {
      name: 'smoke-test',
      mode: 'primary',
      builtIn: false,
      prompt: 'You are a Tier 3 lightweight checker.',
    },
    // A subagent (mode !== 'primary') not in any map → null allowedSkillsJson
    { name: 'some-subagent', mode: 'subagent', builtIn: false },
    // An internal primary that should not appear as selectable
    { name: 'compaction', mode: 'primary', builtIn: true },
  ];
}

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('syncOpencodeAgentProfiles hygiene (P3)', () => {
  beforeEach(() => {
    setDb(makeDb());
  });

  it('inserted rows carry non-null modelProvider + modelId', async () => {
    await syncOpencodeAgentProfiles(makeWorkflowAgents() as never);

    const repo = new AgentConfigsRepository();
    const inserted = repo.list().filter((r) => r.sortOrder === 100);

    // Every sortOrder=100 row must have a concrete model
    expect(inserted.length).toBeGreaterThan(0);
    for (const row of inserted) {
      expect(row.modelProvider, `${row.id} modelProvider should be non-null`).not.toBeNull();
      expect(row.modelId, `${row.id} modelId should be non-null`).not.toBeNull();
    }
  });

  it('inserted rows carry non-null allowed_mcps_json', async () => {
    await syncOpencodeAgentProfiles(makeWorkflowAgents() as never);

    const repo = new AgentConfigsRepository();
    const inserted = repo.list().filter((r) => r.sortOrder === 100);

    expect(inserted.length).toBeGreaterThan(0);
    for (const row of inserted) {
      expect(row.allowedMcpsJson, `${row.id} allowedMcpsJson should be non-null`).not.toBeNull();
    }
  });

  it('known workflow-chain agents carry non-null allowed_skills_json', async () => {
    await syncOpencodeAgentProfiles(makeWorkflowAgents() as never);

    const repo = new AgentConfigsRepository();
    // These agents are in AGENT_SKILL_ALLOWLIST_MAP and must have a non-null
    // allowedSkillsJson after sync.
    const knownAgents = [
      'workflow-orchestrator',
      'planning-agent',
      'issue-writer',
      'coding-agent',
      'verification-gate',
      'failure-triage',
      'smoke-test-writer',
      'project-state-updater',
      'workflow-retrospective',
    ];
    for (const agentId of knownAgents) {
      const row = repo.getById(agentId);
      expect(row, `${agentId} should exist after sync`).not.toBeNull();
      expect(
        row!.allowedSkillsJson,
        `${agentId} allowedSkillsJson should be non-null`,
      ).not.toBeNull();
      // Must be a valid JSON array
      expect(
        () => JSON.parse(row!.allowedSkillsJson!),
        `${agentId} allowedSkillsJson should parse as JSON`,
      ).not.toThrow();
      const parsed = JSON.parse(row!.allowedSkillsJson!);
      expect(Array.isArray(parsed), `${agentId} allowedSkillsJson should be an array`).toBe(true);
    }
  });

  it('specialist allowlist contains its own skill name', async () => {
    await syncOpencodeAgentProfiles(makeWorkflowAgents() as never);

    const repo = new AgentConfigsRepository();
    // Each specialist should have its own skill name in the allowlist.
    // workflow-orchestrator includes all chain skills (broader set).
    const specialists: Array<{ id: string; skill: string }> = [
      { id: 'coding-agent', skill: 'coding-agent' },
      { id: 'verification-gate', skill: 'verification-gate' },
      { id: 'failure-triage', skill: 'failure-triage' },
      { id: 'planning-agent', skill: 'planning-agent' },
      { id: 'issue-writer', skill: 'issue-writer' },
      { id: 'project-state-updater', skill: 'project-state-updater' },
      { id: 'workflow-orchestrator', skill: 'workflow-orchestrator' },
    ];
    for (const { id, skill } of specialists) {
      const row = repo.getById(id);
      expect(row, `${id} should exist`).not.toBeNull();
      const parsed: unknown = JSON.parse(row!.allowedSkillsJson!);
      expect(Array.isArray(parsed)).toBe(true);
      expect(
        (parsed as string[]).includes(skill),
        `${id} allowedSkillsJson should include '${skill}'`,
      ).toBe(true);
    }
  });

  it('re-sync backfills allowed_skills_json on pre-existing null rows', async () => {
    // First sync inserts all rows
    await syncOpencodeAgentProfiles(makeWorkflowAgents() as never);

    // Manually null out allowedSkillsJson on a known agent (simulating an old row)
    const repo = new AgentConfigsRepository();
    repo.update('coding-agent', { allowedSkillsJson: null });
    const afterNull = repo.getById('coding-agent');
    expect(afterNull?.allowedSkillsJson).toBeNull();

    // Second sync must backfill it
    await syncOpencodeAgentProfiles(makeWorkflowAgents() as never);

    const afterResync = repo.getById('coding-agent');
    expect(
      afterResync?.allowedSkillsJson,
      'coding-agent allowedSkillsJson should be backfilled on re-sync',
    ).not.toBeNull();
    const parsed: unknown = JSON.parse(afterResync!.allowedSkillsJson!);
    expect(Array.isArray(parsed)).toBe(true);
    expect((parsed as string[]).includes('coding-agent')).toBe(true);
  });

  it('exactly one dev front-door is sessionSelectable=true after sync', async () => {
    await syncOpencodeAgentProfiles(makeWorkflowAgents() as never);

    const repo = new AgentConfigsRepository();
    const frontDoorNames = ['workflow-orchestrator', 'superpowers', 'plan'];
    const frontDoors = repo.list().filter((r) => frontDoorNames.includes(r.id));

    // All three should be present
    expect(frontDoors.length).toBe(3);

    const selectable = frontDoors.filter((r) => r.sessionSelectable);
    expect(selectable.length).toBe(1);
    expect(selectable[0].id).toBe('workflow-orchestrator');
  });

  it('issue-P4-manager-delegation-c6: imports workflow-orchestrator as manager with allowed delegates', async () => {
    await syncOpencodeAgentProfiles(makeWorkflowAgents() as never);

    const repo = new AgentConfigsRepository();
    const row = repo.getById('workflow-orchestrator');

    expect(row).not.toBeNull();
    expect(row!.isManager).toBe(true);
    expect(row!.allowedDelegatesJson).not.toBeNull();
    const parsed: unknown = JSON.parse(row!.allowedDelegatesJson!);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toContain('coding-agent');
    expect(parsed).toContain('verification-gate');
    expect(parsed).not.toContain('workflow-orchestrator');
  });

  it('issue-P4-manager-delegation-c6: re-sync preserves a user-edited manager delegation override', async () => {
    // allowed_delegates_json is a USER-OWNED overlay field. Once a user scopes a
    // manager's delegates in the designer, re-sync must NEVER regenerate it from
    // the importer-derived list — otherwise the sync silently un-scopes the
    // profile (the live bug that wiped Secretary's allowlist).
    await syncOpencodeAgentProfiles(makeWorkflowAgents() as never);

    const repo = new AgentConfigsRepository();
    repo.update('workflow-orchestrator', {
      allowedDelegatesJson: JSON.stringify(['custom-target']),
    });

    await syncOpencodeAgentProfiles(makeWorkflowAgents() as never);

    const row = repo.getById('workflow-orchestrator');
    const parsed: unknown = JSON.parse(row!.allowedDelegatesJson!);
    expect(parsed).toEqual(['custom-target']);
  });

  it('re-sync preserves user-edited label on existing row', async () => {
    // First sync — inserts
    await syncOpencodeAgentProfiles(makeWorkflowAgents() as never);

    // User edits the label
    const repo = new AgentConfigsRepository();
    repo.update('coding-agent', { label: 'My Custom Coder' });

    // Second sync — must not clobber the label
    await syncOpencodeAgentProfiles(makeWorkflowAgents() as never);

    const after = repo.getById('coding-agent');
    expect(after?.label).toBe('My Custom Coder');
  });

  it('tier 1 prompt → anthropic/claude-opus model family', async () => {
    await syncOpencodeAgentProfiles(makeWorkflowAgents() as never);

    const repo = new AgentConfigsRepository();
    const row = repo.getById('planning-agent');
    expect(row).not.toBeNull();
    // Tier 1 maps to claude-opus family (provider: anthropic)
    expect(row!.modelProvider).toBe('anthropic');
    expect(row!.modelId).toMatch(/claude-opus/);
  });

  it('tier 2 prompt → anthropic/claude-sonnet model family', async () => {
    await syncOpencodeAgentProfiles(makeWorkflowAgents() as never);

    const repo = new AgentConfigsRepository();
    const row = repo.getById('issue-writer');
    expect(row).not.toBeNull();
    // Tier 2 maps to claude-sonnet family (provider: anthropic)
    expect(row!.modelProvider).toBe('anthropic');
    expect(row!.modelId).toMatch(/claude-sonnet/);
  });

  it('tier 3 prompt → anthropic/claude-haiku model family', async () => {
    await syncOpencodeAgentProfiles(makeWorkflowAgents() as never);

    const repo = new AgentConfigsRepository();
    const row = repo.getById('smoke-test');
    expect(row).not.toBeNull();
    // Tier 3 maps to claude-haiku family (provider: anthropic)
    expect(row!.modelProvider).toBe('anthropic');
    expect(row!.modelId).toMatch(/claude-haiku/);
  });

  it('no-tier prompt falls back to Tier 2 default model', async () => {
    await syncOpencodeAgentProfiles(makeWorkflowAgents() as never);

    const repo = new AgentConfigsRepository();
    // 'coding-agent' has no prompt / no tier mention → should default to Tier 2
    const row = repo.getById('coding-agent');
    expect(row).not.toBeNull();
    expect(row!.modelProvider).toBe('anthropic');
    expect(row!.modelId).toMatch(/claude-sonnet/);
  });
});
