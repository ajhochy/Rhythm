import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { getDb, setDb } from '../database/db';
import { AgentConfigsRepository } from './agent_configs_repository';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('AgentConfigsRepository', () => {
  let repo: AgentConfigsRepository;

  beforeEach(() => {
    setDb(makeDb());
    repo = new AgentConfigsRepository();
  });

  describe('list()', () => {
    it('returns all rows ordered by sort_order, label', () => {
      const configs = repo.list();
      // 4 presets (sort_order 0-3) + config-doctor (#900) + rhythm-setup
      // (#911), both sort_order=5, ordered alphabetically by label as the tiebreak.
      expect(configs.length).toBe(6);
      const sortOrders = configs.map((c) => c.sortOrder);
      expect(sortOrders).toEqual([0, 1, 2, 3, 5, 5]);
      const lastTwoLabels = configs.slice(-2).map((c) => c.label);
      expect(lastTwoLabels).toEqual(['Config Doctor', 'Rhythm Setup']);
    });

    it('returns booleans (not 0/1 integers)', () => {
      const configs = repo.list();
      for (const c of configs) {
        expect(typeof c.enabled).toBe('boolean');
        expect(typeof c.isAgent).toBe('boolean');
      }
    });

    it('does not expose legacy CLI fields on the read model (issue #581)', () => {
      const configs = repo.list();
      for (const c of configs) {
        expect(c.command).toBeUndefined();
        expect(c.canResume).toBeUndefined();
        expect(c.resumeCommand).toBeUndefined();
        expect(c.sessionIdPattern).toBeUndefined();
        expect(c.outputMarker).toBeUndefined();
      }
    });
  });

  describe('listEnabled()', () => {
    it('returns only enabled rows', () => {
      // Disable one preset via direct SQL (bypassing preset-delete protection)
      const db = new Database(':memory:');
      db.pragma('foreign_keys = ON');
      runMigrations(db);
      setDb(db);
      repo = new AgentConfigsRepository();

      db.prepare(`UPDATE agent_configs SET enabled = 0 WHERE id = 'codex'`).run();

      const enabled = repo.listEnabled();
      expect(enabled.length).toBe(5);
      expect(enabled.find((c) => c.id === 'codex')).toBeUndefined();
    });

    it('returns all six when all are enabled', () => {
      const enabled = repo.listEnabled();
      expect(enabled.length).toBe(6);
    });

    it('excludes security-locked rows even if enabled drifts back to 1', () => {
      repo.lockForSecurity('codex', 'audit finding', 'reviewer');
      getDb().prepare(`UPDATE agent_configs SET enabled = 1 WHERE id = 'codex'`).run();

      expect(repo.getById('codex')).toMatchObject({ enabled: true, locked: true });
      expect(repo.listEnabled().find((config) => config.id === 'codex')).toBeUndefined();
    });
  });

  describe('getById()', () => {
    it('returns the correct config by id', () => {
      const config = repo.getById('claude-code');
      expect(config).not.toBeNull();
      expect(config?.label).toBe('Claude Code');
      expect(config?.presetId).toBe('claude-code');
    });

    it('returns null for non-existent id', () => {
      const result = repo.getById('does-not-exist');
      expect(result).toBeNull();
    });
  });

  describe('compareAndSetScopeField()', () => {
    it('updates exactly one allowlist column only when the prior value matches', () => {
      const config = repo.insert({
        label: 'CAS scope',
        icon: 'shield',
        allowedMcpsJson: JSON.stringify(['x', 'y']),
        allowedSkillsJson: JSON.stringify(['skill-a']),
      });

      const updated = repo.compareAndSetScopeField(
        config.id,
        'allowedMcpsJson',
        JSON.stringify(['x', 'y']),
        JSON.stringify(['y']),
      );

      expect(updated?.allowedMcpsJson).toBe(JSON.stringify(['y']));
      expect(updated?.allowedSkillsJson).toBe(JSON.stringify(['skill-a']));
    });

    it('returns null and writes nothing on stale or null-mismatched expectations', () => {
      const config = repo.insert({
        label: 'CAS miss',
        icon: 'shield',
        allowedMcpsJson: JSON.stringify(['x', 'y']),
      });

      expect(
        repo.compareAndSetScopeField(config.id, 'allowedMcpsJson', null, JSON.stringify(['y'])),
      ).toBeNull();
      expect(
        repo.compareAndSetScopeField(
          config.id,
          'allowedMcpsJson',
          JSON.stringify(['stale']),
          JSON.stringify(['y']),
        ),
      ).toBeNull();
      expect(repo.getById(config.id)?.allowedMcpsJson).toBe(JSON.stringify(['x', 'y']));
    });

    it('rejects any runtime field outside the fixed scope-column allowlist', () => {
      const config = repo.insert({ label: 'CAS field guard', icon: 'shield' });
      expect(() =>
        repo.compareAndSetScopeField(
          config.id,
          'systemPrompt' as 'allowedMcpsJson',
          null,
          'hostile',
        ),
      ).toThrow(/Unsupported agent config scope field/);
      expect(repo.getById(config.id)?.systemPrompt).toBeNull();
    });
  });

  describe('insert()', () => {
    it('inserts a config with no id and derives a human-readable slug from the label (#960)', () => {
      const config = repo.insert({
        label: 'My Custom Agent',
        icon: 'assets/agents/custom.png',
        enabled: true,
        isAgent: true,
      });

      expect(config.id).toBeTypeOf('string');
      // #960: no-id insert derives a slug from the label — NOT a bare UUID.
      expect(config.id).toBe('my-custom-agent');
      expect(config.label).toBe('My Custom Agent');
      expect(config.enabled).toBe(true);
      expect(config.isAgent).toBe(true);
      expect(config.presetId).toBeNull();
      expect(config.createdAt).toBeTypeOf('string');
      expect(config.updatedAt).toBeTypeOf('string');
    });

    it('uses a provided id (e.g. preset_id as id for presets)', () => {
      const config = repo.insert({
        id: 'my-preset-id',
        label: 'Preset Agent',
        icon: 'assets/agents/preset.png',
        presetId: 'my-preset-id',
      });

      expect(config.id).toBe('my-preset-id');
      expect(config.presetId).toBe('my-preset-id');
    });

    it('defaults enabled to true when not specified', () => {
      const config = repo.insert({
        label: 'Default Enabled',
        icon: 'assets/agents/default.png',
      });
      expect(config.enabled).toBe(true);
    });

    it('stores disabled=false correctly', () => {
      const config = repo.insert({
        label: 'Disabled Agent',
        icon: 'assets/agents/disabled.png',
        enabled: false,
      });
      expect(config.enabled).toBe(false);
    });

    it('stores sortOrder correctly', () => {
      const config = repo.insert({
        label: 'Sorted',
        icon: 'assets/agents/sorted.png',
        sortOrder: 10,
      });
      expect(config.sortOrder).toBe(10);
    });

    it('issue-P4-manager-delegation-c2: round-trips allowedDelegatesJson on insert', () => {
      const delegates = JSON.stringify(['coding-agent']);
      const config = repo.insert({
        label: 'Manager',
        icon: 'assets/agents/manager.png',
        isManager: true,
        allowedDelegatesJson: delegates,
      });

      expect(config.allowedDelegatesJson).toBe(delegates);
      expect(repo.getById(config.id)?.allowedDelegatesJson).toBe(delegates);
    });

    it('round-trips corePermissionsJson on insert', () => {
      const corePermissions = JSON.stringify({ skill: 'allow', read: 'allow', bash: 'ask' });
      const config = repo.insert({
        label: 'Core Permission Agent',
        icon: 'assets/agents/core.png',
        corePermissionsJson: corePermissions,
      });

      expect(config.corePermissionsJson).toBe(corePermissions);
      expect(repo.getById(config.id)?.corePermissionsJson).toBe(corePermissions);
    });

    it('ignores legacy CLI fields if a stale client sends them (issue #581)', () => {
      const config = repo.insert({
        label: 'Stale Client',
        icon: 'assets/agents/stale.png',
        // Legacy fields — should be silently ignored on write
        command: 'stalecmd',
        canResume: true,
        resumeCommand: 'stalecmd --resume {{sessionId}}',
        sessionIdPattern: 'Session: ([a-f0-9-]+)',
        outputMarker: '>>',
      });
      // None of the legacy fields should be echoed back on the read shape.
      expect(config.command).toBeUndefined();
      expect(config.canResume).toBeUndefined();
      expect(config.resumeCommand).toBeUndefined();
      expect(config.sessionIdPattern).toBeUndefined();
      expect(config.outputMarker).toBeUndefined();
    });
  });

  describe('update()', () => {
    it('updates a custom config field', () => {
      const created = repo.insert({
        label: 'Old Label',
        icon: 'assets/agents/old.png',
      });

      const updated = repo.update(created.id, { label: 'New Label' });
      expect(updated).not.toBeNull();
      expect(updated?.label).toBe('New Label');
      expect(updated?.icon).toBe('assets/agents/old.png'); // unchanged
    });

    it('can disable a preset (enabled = false)', () => {
      const updated = repo.update('claude-code', { enabled: false });
      expect(updated).not.toBeNull();
      expect(updated?.enabled).toBe(false);
      expect(updated?.presetId).toBe('claude-code'); // preset_id untouched
    });

    it('returns null for a non-existent id', () => {
      const result = repo.update('no-such-id', { label: 'X' });
      expect(result).toBeNull();
    });

    it('sets updated_at to a newer value', async () => {
      const created = repo.insert({
        label: 'Timestamp Test',
        icon: 'assets/agents/ts.png',
      });

      // Small delay to ensure timestamp differs
      await new Promise((r) => setTimeout(r, 10));
      const updated = repo.update(created.id, { label: 'Updated' });
      expect(updated?.updatedAt).toBeTypeOf('string');
    });

    it('issue-P4-manager-delegation-c2: round-trips allowedDelegatesJson on update', () => {
      const created = repo.insert({
        label: 'Delegation Update',
        icon: 'assets/agents/delegation.png',
      });
      const delegates = JSON.stringify(['coding-agent', 'verification-gate']);

      const updated = repo.update(created.id, { allowedDelegatesJson: delegates });

      expect(updated?.allowedDelegatesJson).toBe(delegates);
      expect(repo.getById(created.id)?.allowedDelegatesJson).toBe(delegates);
    });

    it('round-trips and clears corePermissionsJson on update', () => {
      const created = repo.insert({
        label: 'Core Permission Update',
        icon: 'assets/agents/core.png',
      });

      expect(repo.update(created.id, { corePermissionsJson: '{"bash":"ask"}' })?.corePermissionsJson).toBe('{"bash":"ask"}');
      expect(repo.update(created.id, { corePermissionsJson: null })?.corePermissionsJson).toBeNull();
    });

    it('ignores legacy CLI fields on update if a stale client sends them (issue #581)', () => {
      const created = repo.insert({
        label: 'Stale Update',
        icon: 'assets/agents/stale.png',
      });

      const updated = repo.update(created.id, {
        label: 'After Update',
        // Legacy fields — should be silently ignored
        command: 'newcmd',
        canResume: true,
        resumeCommand: 'newcmd --resume {{sessionId}}',
        sessionIdPattern: 'Session: ([a-f0-9-]+)',
        outputMarker: '>>',
      });
      expect(updated?.label).toBe('After Update');
      expect(updated?.command).toBeUndefined();
      expect(updated?.canResume).toBeUndefined();
      expect(updated?.resumeCommand).toBeUndefined();
      expect(updated?.sessionIdPattern).toBeUndefined();
      expect(updated?.outputMarker).toBeUndefined();
    });
  });

  describe('remove()', () => {
    it('deletes a custom config and returns true', () => {
      const created = repo.insert({
        label: 'To Delete',
        icon: 'assets/agents/delete.png',
      });

      const result = repo.remove(created.id);
      expect(result).toBe(true);
      expect(repo.getById(created.id)).toBeNull();
    });

    it('refuses to delete a built-in preset and returns false', () => {
      const result = repo.remove('claude-code');
      expect(result).toBe(false);
      expect(repo.getById('claude-code')).not.toBeNull();
    });

    it('refuses to delete any preset row', () => {
      for (const id of ['claude-code', 'codex', 'gemini-cli', 'opencode']) {
        expect(repo.remove(id)).toBe(false);
      }
      // All four presets plus Config Doctor and Rhythm Setup still exist
      expect(repo.list().length).toBe(6);
    });

    it('returns false for a non-existent id', () => {
      const result = repo.remove('ghost-id');
      expect(result).toBe(false);
    });
  });

  // #1088 — schedulable decoupled from sessionSelectable (picker visibility).
  describe('schedulable (#1088)', () => {
    it('inherits sessionSelectable when no explicit override is given', () => {
      const visible = repo.insert({ label: 'Visible', icon: 'a', sessionSelectable: true });
      const hidden = repo.insert({ label: 'Hidden', icon: 'a', sessionSelectable: false });
      expect(visible.schedulable).toBe(true);
      expect(visible.schedulableOverride).toBeNull();
      expect(hidden.schedulable).toBe(false);
      expect(hidden.schedulableOverride).toBeNull();
    });

    it('a hidden profile can be made explicitly schedulable without becoming picker-visible', () => {
      const created = repo.insert({
        label: 'Hidden Specialist',
        icon: 'a',
        sessionSelectable: false,
        schedulable: true,
      });
      expect(created.sessionSelectable).toBe(false);
      expect(created.schedulable).toBe(true);
      expect(created.schedulableOverride).toBe(true);
    });

    it('an explicit false override can make a visible profile non-schedulable', () => {
      const created = repo.insert({
        label: 'Visible Non-Schedulable',
        icon: 'a',
        sessionSelectable: true,
        schedulable: false,
      });
      expect(created.sessionSelectable).toBe(true);
      expect(created.schedulable).toBe(false);
    });

    it('patch(schedulable: null) clears the override back to inherit', () => {
      const created = repo.insert({
        label: 'Toggle',
        icon: 'a',
        sessionSelectable: false,
        schedulable: true,
      });
      expect(created.schedulable).toBe(true);
      const cleared = repo.update(created.id, { schedulable: null });
      expect(cleared!.schedulableOverride).toBeNull();
      expect(cleared!.schedulable).toBe(false); // falls back to sessionSelectable=false
    });

    it('patch(schedulable: true) overrides a hidden profile independent of sessionSelectable', () => {
      const created = repo.insert({ label: 'Toggle2', icon: 'a', sessionSelectable: false });
      expect(created.schedulable).toBe(false);
      const updated = repo.update(created.id, { schedulable: true });
      expect(updated!.sessionSelectable).toBe(false);
      expect(updated!.schedulable).toBe(true);
    });
  });

  // #1094 — OpenAI native image_generation capability grant.
  describe('imageGenerationEnabled (#1094)', () => {
    it('defaults to false', () => {
      const created = repo.insert({ label: 'No Image Gen', icon: 'a' });
      expect(created.imageGenerationEnabled).toBe(false);
    });

    it('round-trips true through insert', () => {
      const created = repo.insert({ label: 'Image Gen', icon: 'a', imageGenerationEnabled: true });
      expect(created.imageGenerationEnabled).toBe(true);
    });

    it('round-trips through patch', () => {
      const created = repo.insert({ label: 'Toggle Image Gen', icon: 'a' });
      const updated = repo.update(created.id, { imageGenerationEnabled: true });
      expect(updated!.imageGenerationEnabled).toBe(true);
      const reverted = repo.update(created.id, { imageGenerationEnabled: false });
      expect(reverted!.imageGenerationEnabled).toBe(false);
    });
  });

  // #1118 — per-profile reasoning effort / thinking budget.
  describe('reasoningEffort (#1118)', () => {
    it('defaults to null', () => {
      const created = repo.insert({ label: 'No Effort', icon: 'a' });
      expect(created.reasoningEffort).toBeNull();
    });

    it('round-trips a value through insert', () => {
      const created = repo.insert({ label: 'High Effort', icon: 'a', reasoningEffort: 'high' });
      expect(created.reasoningEffort).toBe('high');
    });

    it('round-trips through patch, and null clears it back to provider default', () => {
      const created = repo.insert({ label: 'Toggle Effort', icon: 'a' });
      const updated = repo.update(created.id, { reasoningEffort: 'low' });
      expect(updated!.reasoningEffort).toBe('low');
      const cleared = repo.update(created.id, { reasoningEffort: null });
      expect(cleared!.reasoningEffort).toBeNull();
    });
  });
});
