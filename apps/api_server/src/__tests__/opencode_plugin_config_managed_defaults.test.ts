/**
 * #1071 (OCU-30) — ensureManagedDefaults contract tests.
 *
 * Verifies the managed opencode.json small_model/username/reference/
 * compaction/tool_output merge logic in isolation (no server spawn, no real
 * engine): RHYTHM-OWNED keys (small_model/username) stay current and skip
 * cleanly when unresolvable; reference entries are additive; compaction/
 * tool_output are absent-only and never clobber a user's own tuning.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const { mockResolveSmallModel, mockFindAllAsync } = vi.hoisted(() => ({
  mockResolveSmallModel: vi.fn(),
  mockFindAllAsync: vi.fn(),
}));

vi.mock('../services/agent_model_resolver', () => ({
  resolveSmallModel: mockResolveSmallModel,
}));

vi.mock('../repositories/users_repository', () => ({
  UsersRepository: class {
    static systemBotEmail = 'rhythm-bot@rhythm.local';
    findAllAsync = mockFindAllAsync;
  },
}));

import { ensureManagedDefaults } from '../services/opencode_plugin_config';

describe('ensureManagedDefaults', () => {
  let dir: string;
  let configPath: string;
  let vaultDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'managed-defaults-cfg-'));
    configPath = join(dir, 'opencode.json');
    vaultDir = mkdtempSync(join(tmpdir(), 'managed-defaults-vault-'));
    process.env.MEMORY_VAULT_PATH = vaultDir;
    mockResolveSmallModel.mockResolvedValue({ providerID: 'anthropic', modelID: 'claude-haiku-4-5' });
    mockFindAllAsync.mockResolvedValue([{ name: 'AJ', email: 'aj@example.com' }]);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(vaultDir, { recursive: true, force: true });
    delete process.env.MEMORY_VAULT_PATH;
    vi.clearAllMocks();
  });

  it('creates the config from scratch with all managed keys on a fresh machine', async () => {
    const changed = await ensureManagedDefaults(configPath);
    expect(changed).toBe(true);
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(parsed.small_model).toBe('anthropic/claude-haiku-4-5');
    expect(parsed.username).toBe('AJ');
    expect(parsed.reference.vault).toEqual({ path: vaultDir });
    expect(parsed.compaction).toEqual({ auto: true, prune: true });
    expect(parsed.tool_output).toEqual({ max_lines: 2000, max_bytes: 51200 });
  });

  it('skips small_model entirely (never writes/clears) when no candidate provider is authed', async () => {
    mockResolveSmallModel.mockResolvedValue(undefined);
    await ensureManagedDefaults(configPath);
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(parsed.small_model).toBeUndefined();
  });

  it('preserves user-edited compaction/tool_output values across restarts (absent-only)', async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({ compaction: { auto: false, tail_turns: 5 }, tool_output: { max_lines: 500 } }),
    );
    await ensureManagedDefaults(configPath);
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(parsed.compaction).toEqual({ auto: false, tail_turns: 5 });
    expect(parsed.tool_output).toEqual({ max_lines: 500 });
  });

  it('preserves a user-added reference alias entry untouched', async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({ reference: { 'my-repo': { repository: 'owner/repo' } } }),
    );
    await ensureManagedDefaults(configPath);
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(parsed.reference['my-repo']).toEqual({ repository: 'owner/repo' });
    expect(parsed.reference.vault).toEqual({ path: vaultDir });
  });

  it('does not register a vault reference when MEMORY_VAULT_PATH does not exist on disk', async () => {
    process.env.MEMORY_VAULT_PATH = join(tmpdir(), 'does-not-exist-vault-xyz');
    await ensureManagedDefaults(configPath);
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(parsed.reference?.vault).toBeUndefined();
  });

  it('is idempotent — a second call with nothing new to write reports unchanged', async () => {
    await ensureManagedDefaults(configPath);
    const second = await ensureManagedDefaults(configPath);
    expect(second).toBe(false);
  });

  it('username resolution failure is non-fatal — other keys still get written', async () => {
    mockFindAllAsync.mockRejectedValue(new Error('db unavailable'));
    const changed = await ensureManagedDefaults(configPath);
    expect(changed).toBe(true);
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(parsed.username).toBeUndefined();
    expect(parsed.small_model).toBe('anthropic/claude-haiku-4-5');
  });

  it('a malformed existing config is left alone (logged, no write)', async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(configPath, '{ not valid json');
    const changed = await ensureManagedDefaults(configPath);
    expect(changed).toBe(false);
    expect(readFileSync(configPath, 'utf8')).toBe('{ not valid json');
  });

  it('excludes the system bot row when resolving username', async () => {
    mockFindAllAsync.mockResolvedValue([
      { name: 'Rhythm Bot', email: 'rhythm-bot@rhythm.local' },
      { name: 'Real User', email: 'real@example.com' },
    ]);
    await ensureManagedDefaults(configPath);
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(parsed.username).toBe('Real User');
  });
});
