/**
 * CONTRACT — the memory vault DEFAULT must be the real Obsidian AGENT-MEMORY
 * vault, not the stale legacy `~/Documents/Memory-Vault`.
 *
 * Why this is a default and not just a documented env override: #885 wired
 * MEMORY_VAULT_PATH/MEMORY_VAULT_SUBDIR into the Flutter desktop spawn path
 * only. The Electron shell (apps/electron/src/agent-server.mjs) spawns the same
 * api_server and sets AGENT_LOCAL but NOT the vault vars, so it silently read
 * the 89-note legacy vault instead of the 376-note source of truth. Making the
 * default correct fixes every spawner — packaged app, Electron, dev, scripts.
 *
 * These tests mutate process.env, so they restore it in afterEach. They never
 * touch the real vault on disk — only path resolution is under test.
 */
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_MEMORY_VAULT_PATH,
  resolveMemoryDirPath,
  resolveMemoryVaultPath,
} from '../config/env.js';

const VAULT = 'MEMORY_VAULT_PATH';
const SUBDIR = 'MEMORY_VAULT_SUBDIR';

describe('memory vault default path (#885 follow-up)', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = { [VAULT]: process.env[VAULT], [SUBDIR]: process.env[SUBDIR] };
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  describe('with no env vars set (the packaged-app / Electron case)', () => {
    beforeEach(() => {
      delete process.env[VAULT];
      delete process.env[SUBDIR];
    });

    it('resolves the vault to the Obsidian AGENT-MEMORY dir', () => {
      expect(DEFAULT_MEMORY_VAULT_PATH).toBe(
        '~/Documents/Obsidian Vault/AGENT-MEMORY',
      );
      expect(resolveMemoryVaultPath()).toBe(
        path.join(os.homedir(), 'Documents', 'Obsidian Vault', 'AGENT-MEMORY'),
      );
    });

    it('never resolves to the stale legacy vault', () => {
      expect(resolveMemoryVaultPath()).not.toContain('Documents/Memory-Vault');
      expect(resolveMemoryDirPath()).not.toContain('Documents/Memory-Vault');
    });

    it('puts kind-folders at the vault root (empty subdir), not under memory/', () => {
      // The new default layout is AGENT-MEMORY/<kind>/<slug>.md — a `memory`
      // subdir here would write into a folder the real vault does not have.
      expect(resolveMemoryDirPath()).toBe(resolveMemoryVaultPath());
      expect(path.basename(resolveMemoryDirPath())).toBe('AGENT-MEMORY');
    });

    it('preserves the space in "Obsidian Vault" verbatim', () => {
      // A space is the classic way a path silently half-works. Assert it is
      // neither escaped, quoted, nor URL-encoded by path resolution.
      expect(resolveMemoryVaultPath()).toContain('Obsidian Vault');
      expect(resolveMemoryVaultPath()).not.toContain('Obsidian\\ Vault');
      expect(resolveMemoryVaultPath()).not.toContain('Obsidian%20Vault');
    });
  });

  describe('MEMORY_VAULT_PATH still overrides', () => {
    it('honours an explicit absolute path (the test-fixture case)', () => {
      const fixture = path.join(os.tmpdir(), 'rhythm-vault-fixture');
      process.env[VAULT] = fixture;
      delete process.env[SUBDIR];
      expect(resolveMemoryVaultPath()).toBe(fixture);
    });

    it('expands a leading ~ in an override', () => {
      process.env[VAULT] = '~/some-other-vault';
      expect(resolveMemoryVaultPath()).toBe(
        path.join(os.homedir(), 'some-other-vault'),
      );
    });

    it('keeps the legacy `memory` subdir when the path is set explicitly', () => {
      // Back-compat: every existing caller that points the vault somewhere
      // (tests, fixtures, the legacy vault) keeps <vault>/memory/<kind>/.
      const fixture = path.join(os.tmpdir(), 'rhythm-vault-fixture');
      process.env[VAULT] = fixture;
      delete process.env[SUBDIR];
      expect(resolveMemoryDirPath()).toBe(path.join(fixture, 'memory'));
    });

    it('lets an explicit MEMORY_VAULT_SUBDIR win over both defaults', () => {
      const fixture = path.join(os.tmpdir(), 'rhythm-vault-fixture');
      process.env[VAULT] = fixture;
      process.env[SUBDIR] = '';
      expect(resolveMemoryDirPath()).toBe(fixture);

      process.env[SUBDIR] = 'custom';
      expect(resolveMemoryDirPath()).toBe(path.join(fixture, 'custom'));

      delete process.env[VAULT];
      process.env[SUBDIR] = 'memory';
      expect(resolveMemoryDirPath()).toBe(
        path.join(resolveMemoryVaultPath(), 'memory'),
      );
    });
  });
});
