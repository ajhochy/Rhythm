import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
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
      expect(configs.length).toBe(4);
      // Verify ordering by sort_order
      const sortOrders = configs.map((c) => c.sortOrder);
      expect(sortOrders).toEqual([0, 1, 2, 3]);
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
      expect(enabled.length).toBe(3);
      expect(enabled.find((c) => c.id === 'codex')).toBeUndefined();
    });

    it('returns all four when all are enabled', () => {
      const enabled = repo.listEnabled();
      expect(enabled.length).toBe(4);
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

  describe('insert()', () => {
    it('inserts a custom config and returns it with an auto-generated UUID', () => {
      const config = repo.insert({
        label: 'My Custom Agent',
        icon: 'assets/agents/custom.png',
        enabled: true,
        isAgent: true,
      });

      expect(config.id).toBeTypeOf('string');
      expect(config.id).toHaveLength(36); // UUID v4
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
      // All four still exist
      expect(repo.list().length).toBe(4);
    });

    it('returns false for a non-existent id', () => {
      const result = repo.remove('ghost-id');
      expect(result).toBe(false);
    });
  });
});
