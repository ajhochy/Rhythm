/**
 * #1096 WP1 — unit tests for the device-local Engraph backend manager:
 * binary discovery/validation, path/root confinement, persisted config
 * round-trip, command construction without a shell, ownership matching, and
 * sanitized errors.
 */
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, chmodSync, readFileSync, rmSync, statSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EngraphManager,
  discoverEngraphCandidates,
  validateEngraphBinary,
  isWithinApprovedMemoryRoot,
  isExecutableFile,
  sanitizeErrorMessage,
  type EngraphManagerDeps,
} from '../services/engraph_manager';
import { EngraphManagerConfigStore } from '../services/engraph_manager_config_store';

function writeExecutable(p: string, contents = '#!/bin/sh\nexit 0\n'): void {
  writeFileSync(p, contents, { mode: 0o755 });
  chmodSync(p, 0o755);
}

describe('discoverEngraphCandidates', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'engraph-discover-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('finds an executable named engraph on PATH and reports its source', () => {
    const binDir = join(dir, 'bin');
    mkdirSync(binDir);
    writeExecutable(join(binDir, 'engraph'));
    const found = discoverEngraphCandidates(binDir, []);
    expect(found).toEqual([{ path: join(binDir, 'engraph'), source: 'path' }]);
  });

  it('ignores a non-executable file named engraph', () => {
    const binDir = join(dir, 'bin');
    mkdirSync(binDir);
    writeFileSync(join(binDir, 'engraph'), 'not executable');
    expect(discoverEngraphCandidates(binDir, [])).toEqual([]);
  });

  it('returns no candidates when PATH is empty and Homebrew locations are absent', () => {
    expect(discoverEngraphCandidates('', [])).toEqual([]);
  });
});

describe('validateEngraphBinary', () => {
  let dir: string;
  // realpathSync: macOS's tmpdir() is under /var, a symlink to /private/var —
  // resolve it up front so path comparisons below match what
  // validateEngraphBinary itself resolves internally.
  beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), 'engraph-validate-'))); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('accepts a binary that reports "engraph <version>" on --version', async () => {
    const bin = join(dir, 'engraph');
    writeExecutable(bin);
    const execFileImpl = vi.fn().mockResolvedValue({ stdout: 'engraph 1.7.2\n', stderr: '' });
    const result = await validateEngraphBinary(bin, execFileImpl);
    expect(result).toEqual({ ok: true, version: '1.7.2' });
    expect(execFileImpl).toHaveBeenCalledWith(bin, ['--version'], expect.objectContaining({ timeout: expect.any(Number) }));
  });

  it('rejects a nonexistent path', async () => {
    const result = await validateEngraphBinary(join(dir, 'nope'), vi.fn());
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('rejects a path that is not executable', async () => {
    const p = join(dir, 'not-exec');
    writeFileSync(p, 'hi');
    const result = await validateEngraphBinary(p, vi.fn());
    expect(result).toEqual({ ok: false, reason: 'not_executable' });
  });

  it('rejects output that does not match "engraph <semver>" — refuses an arbitrary/malicious executable', async () => {
    const bin = join(dir, 'not-engraph');
    writeExecutable(bin);
    const execFileImpl = vi.fn().mockResolvedValue({ stdout: 'rm -rf /\n', stderr: '' });
    expect(await validateEngraphBinary(bin, execFileImpl)).toEqual({ ok: false, reason: 'unexpected_output' });
  });

  it('rejects a binary whose --version invocation fails/hangs', async () => {
    const bin = join(dir, 'engraph');
    writeExecutable(bin);
    const execFileImpl = vi.fn().mockRejectedValue(new Error('timed out'));
    expect(await validateEngraphBinary(bin, execFileImpl)).toEqual({ ok: false, reason: 'exec_failed' });
  });

  it('resolves a symlink before validating (does not trust the link path blindly)', async () => {
    const real = join(dir, 'real-engraph');
    writeExecutable(real);
    const link = join(dir, 'link-to-engraph');
    symlinkSync(real, link);
    const execFileImpl = vi.fn().mockResolvedValue({ stdout: 'engraph 1.7.2\n', stderr: '' });
    const result = await validateEngraphBinary(link, execFileImpl);
    expect(result).toEqual({ ok: true, version: '1.7.2' });
    // Called with the REAL (resolved) path, not the symlink path.
    expect(execFileImpl).toHaveBeenCalledWith(real, ['--version'], expect.anything());
  });
});

describe('path/root confinement (isWithinApprovedMemoryRoot)', () => {
  let vaultDir: string;
  let memoryRoot: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vaultDir = mkdtempSync(join(tmpdir(), 'engraph-vault-'));
    memoryRoot = join(vaultDir, 'AGENT-MEMORY');
    mkdirSync(memoryRoot, { recursive: true });
    process.env.MEMORY_VAULT_PATH = vaultDir;
    process.env.MEMORY_VAULT_SUBDIR = 'AGENT-MEMORY';
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(vaultDir, { recursive: true, force: true });
  });

  it('accepts exactly the approved canonical root', () => {
    expect(isWithinApprovedMemoryRoot(memoryRoot)).toBe(true);
  });

  it('rejects the parent (whole-vault) directory', () => {
    expect(isWithinApprovedMemoryRoot(vaultDir)).toBe(false);
  });

  it('rejects path traversal out of the approved root', () => {
    expect(isWithinApprovedMemoryRoot(join(memoryRoot, '..', '..'))).toBe(false);
  });

  it('rejects a sibling folder posing as the approved root', () => {
    const sibling = join(vaultDir, 'OTHER-STUFF');
    mkdirSync(sibling);
    expect(isWithinApprovedMemoryRoot(sibling)).toBe(false);
  });

  it('rejects a symlink that escapes the approved root', () => {
    const outside = mkdtempSync(join(tmpdir(), 'engraph-outside-'));
    const escapeLink = join(memoryRoot, 'escape-link');
    symlinkSync(outside, escapeLink);
    expect(isWithinApprovedMemoryRoot(escapeLink)).toBe(false);
    rmSync(outside, { recursive: true, force: true });
  });

  it('rejects a nonexistent path', () => {
    expect(isWithinApprovedMemoryRoot(join(memoryRoot, 'does-not-exist'))).toBe(false);
  });
});

describe('EngraphManagerConfigStore round-trip', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'engraph-cfg-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads defaults (disabled, no binary) when no file exists yet', () => {
    const store = new EngraphManagerConfigStore(join(dir, 'config.json'));
    expect(store.read()).toMatchObject({ enabled: false, executablePath: null, state: 'disabled' });
  });

  it('persists a patch and reads it back exactly', () => {
    const store = new EngraphManagerConfigStore(join(dir, 'config.json'));
    store.write({ enabled: true, executablePath: '/opt/homebrew/bin/engraph', discoverySource: 'homebrew', state: 'ready' });
    const read = store.read();
    expect(read.enabled).toBe(true);
    expect(read.executablePath).toBe('/opt/homebrew/bin/engraph');
    expect(read.discoverySource).toBe('homebrew');
    expect(read.state).toBe('ready');
  });

  it('never accepts an unknown discoverySource/state/failureCategory from a corrupted file', () => {
    const path = join(dir, 'config.json');
    writeFileSync(path, JSON.stringify({ enabled: true, discoverySource: 'malicious', state: 'hacked', lastFailureCategory: 'nope' }));
    const store = new EngraphManagerConfigStore(path);
    const read = store.read();
    expect(read.discoverySource).toBeNull();
    expect(read.state).toBe('disabled');
    expect(read.lastFailureCategory).toBeNull();
  });

  it('writes the file with mode 0600 (no group/other read access)', () => {
    const path = join(dir, 'config.json');
    const store = new EngraphManagerConfigStore(path);
    store.write({ enabled: true });
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('never contains a secret/API-key-shaped field', () => {
    const store = new EngraphManagerConfigStore(join(dir, 'config.json'));
    store.write({ enabled: true, executablePath: '/usr/local/bin/engraph' });
    const raw = readFileSync(store.path, 'utf8');
    expect(raw).not.toMatch(/eg_[a-f0-9]{10,}/i);
    expect(raw).not.toMatch(/"apiKey"|"api_key"|"secret"/i);
  });
});

describe('sanitizeErrorMessage', () => {
  it('redacts absolute filesystem paths', () => {
    expect(sanitizeErrorMessage(new Error('ENOENT: /Users/alice/Documents/Memory-Vault/secret.md not found')))
      .not.toContain('/Users/alice');
  });

  it('redacts an Engraph API key', () => {
    expect(sanitizeErrorMessage(new Error('auth failed for eg_abcdef0123456789abcdef0123456789')))
      .not.toContain('eg_abcdef0123456789abcdef0123456789');
  });

  it('truncates very long messages', () => {
    expect(sanitizeErrorMessage(new Error('x'.repeat(1000))).length).toBeLessThanOrEqual(300);
  });
});

describe('isExecutableFile', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'engraph-exec-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('is false for a directory even if it has the executable bit', () => {
    expect(isExecutableFile(dir)).toBe(false);
  });
});

/** Minimal fake ChildProcess: enough of the EventEmitter + kill() surface for
 *  the manager's process-ownership logic, without spawning a real process. */
class FakeChildProcess extends EventEmitter {
  pid = 4242;
  killed = false;
  kill = vi.fn((_signal?: string) => {
    this.killed = true;
    // Simulate the OS reporting the process gone shortly after signaling it.
    queueMicrotask(() => this.emit('exit', null, 'SIGTERM'));
    return true;
  });
}

describe('EngraphManager — process ownership + command construction', () => {
  let dir: string;
  let vaultDir: string;
  let memoryRoot: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'engraph-mgr-')));
    vaultDir = realpathSync(mkdtempSync(join(tmpdir(), 'engraph-mgr-vault-')));
    memoryRoot = join(vaultDir, 'AGENT-MEMORY');
    mkdirSync(memoryRoot, { recursive: true });
    process.env.MEMORY_VAULT_PATH = vaultDir;
    process.env.MEMORY_VAULT_SUBDIR = 'AGENT-MEMORY';
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(dir, { recursive: true, force: true });
    rmSync(vaultDir, { recursive: true, force: true });
  });

  function makeManager(overrides: Partial<{ execFileImpl: ReturnType<typeof vi.fn>; fetchImpl: ReturnType<typeof vi.fn> }> = {}) {
    const configStore = new EngraphManagerConfigStore(join(dir, 'config.json'));
    const spawned: FakeChildProcess[] = [];
    const spawnFn = vi.fn(() => {
      const child = new FakeChildProcess();
      spawned.push(child);
      return child as unknown as ReturnType<typeof import('node:child_process').spawn>;
    });
    const execFileImpl = overrides.execFileImpl ?? vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const fetchImpl = overrides.fetchImpl ?? vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    const manager = new EngraphManager({
      configStore, spawnFn: spawnFn as unknown as typeof import('node:child_process').spawn,
      execFileImpl: execFileImpl as unknown as EngraphManagerDeps['execFileImpl'],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      homeDir: join(dir, 'engraph-home'),
    });
    return { manager, configStore, spawnFn, execFileImpl, fetchImpl, spawned };
  }

  it('disable() is a no-op (never calls kill) when nothing was ever spawned', async () => {
    const { manager, spawnFn } = makeManager();
    await manager.disable();
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('a healthy start indexes and spawns with fixed argv (no shell), then check-health uses the generated key', async () => {
    const execFileImpl = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ file_path: 'fact/x.md' }]), { status: 200 }));
    const { manager, configStore, spawnFn } = makeManager({ execFileImpl, fetchImpl });
    configStore.write({ enabled: true, executablePath: process.execPath }); // any real executable path passes isExecutableFile

    const result = await manager.enable();
    expect(result.ok).toBe(true);

    // index: fixed argv, no shell — execFile never receives a shell string.
    expect(execFileImpl).toHaveBeenCalledWith(
      process.execPath,
      ['index', memoryRoot],
      expect.objectContaining({ env: expect.objectContaining({ HOME: join(dir, 'engraph-home') }) }),
    );
    // serve: fixed argv, --read-only, loopback host only.
    expect(spawnFn).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(['serve', '--http', '--read-only', '--host', '127.0.0.1']),
      expect.objectContaining({ env: expect.objectContaining({ HOME: join(dir, 'engraph-home') }) }),
    );
    // health check sent an Authorization header (authenticated, not just reachable).
    const [, fetchInit] = fetchImpl.mock.calls[0];
    expect((fetchInit.headers as Record<string, string>).authorization).toMatch(/^Bearer eg_[a-f0-9]+$/);

    expect(configStore.read().state).toBe('ready');
  });

  it('stop() kills ONLY the exact spawned ChildProcess, never an externally supplied identifier', async () => {
    const { manager, configStore, spawned } = makeManager();
    configStore.write({ enabled: true, executablePath: process.execPath });
    await manager.enable();
    expect(spawned).toHaveLength(1);

    await manager.disable();
    expect(spawned[0].kill).toHaveBeenCalledWith('SIGTERM');
    expect(spawned[0].kill).toHaveBeenCalledTimes(1);
  });

  it('a second disable() after the process already exited kills nothing (ownership already released)', async () => {
    const { manager, configStore, spawned } = makeManager();
    configStore.write({ enabled: true, executablePath: process.execPath });
    await manager.enable();
    await manager.disable();
    spawned[0].kill.mockClear();

    await manager.disable();
    expect(spawned[0].kill).not.toHaveBeenCalled();
  });

  it('never starts when disabled, and never spawns anything', async () => {
    const { manager, configStore, spawnFn } = makeManager();
    configStore.write({ enabled: false, executablePath: process.execPath });
    const result = await manager.retry();
    expect(result).toEqual({ ok: false, reason: 'disabled' });
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('fails closed with a sanitized message when the configured binary no longer exists', async () => {
    const { manager, configStore } = makeManager();
    configStore.write({ enabled: true, executablePath: join(dir, 'does-not-exist') });
    const result = await manager.enable();
    expect(result).toEqual({ ok: false, reason: 'binary_not_found' });
    expect(configStore.read().lastFailureCategory).toBe('binary_not_found');
  });

  it('getRetrievalClient() search()es to [] until a real health check has passed', async () => {
    const { manager } = makeManager();
    await expect(manager.getRetrievalClient().search('q', 5)).resolves.toEqual([]);
  });

  describe('getRetrievalClient() prompt-path latency budget (step 3)', () => {
    const originalBudgetEnv = process.env.AGENT_MEMORY_SEMANTIC_BUDGET_MS;
    afterEach(() => {
      if (originalBudgetEnv === undefined) delete process.env.AGENT_MEMORY_SEMANTIC_BUDGET_MS;
      else process.env.AGENT_MEMORY_SEMANTIC_BUDGET_MS = originalBudgetEnv;
    });

    it('constructs the not-ready fallback client with the env-configured budget', () => {
      process.env.AGENT_MEMORY_SEMANTIC_BUDGET_MS = '250';
      const { manager } = makeManager();
      const client = manager.getRetrievalClient();
      expect((client as unknown as { timeoutMs: number }).timeoutMs).toBe(250);
    });

    it('constructs the managed (ready) client with the env-configured budget', async () => {
      process.env.AGENT_MEMORY_SEMANTIC_BUDGET_MS = '250';
      const { manager, configStore } = makeManager();
      configStore.write({ enabled: true, executablePath: process.execPath });
      const result = await manager.enable();
      expect(result.ok).toBe(true);

      const client = manager.getRetrievalClient();
      expect((client as unknown as { timeoutMs: number }).timeoutMs).toBe(250);
    });

    it('falls back to the 500ms default when the env override is invalid', () => {
      process.env.AGENT_MEMORY_SEMANTIC_BUDGET_MS = 'garbage';
      const { manager } = makeManager();
      const client = manager.getRetrievalClient();
      expect((client as unknown as { timeoutMs: number }).timeoutMs).toBe(500);
    });
  });

  it('checkHealthNow() fails closed on a non-2xx (e.g. auth-rejected) response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"error":"unauthorized"}', { status: 401 }));
    const { manager, configStore } = makeManager({ fetchImpl });
    configStore.write({ enabled: true, executablePath: process.execPath });
    // Force a started-but-unhealthy state by calling checkHealthNow directly
    // is not possible pre-start (no port/key yet) — enable() itself will
    // fail closed and report permission_denied via the same health path.
    const result = await manager.enable();
    expect(result.ok).toBe(false);
    expect(configStore.read().lastFailureCategory).toBe('permission_denied');
  });
});

describe('anti-#1124 structural guarantee', () => {
  it('engraph_manager.ts never calls process.kill (only ever kills its own tracked ChildProcess handle)', () => {
    const source = readFileSync(join(__dirname, '..', 'services', 'engraph_manager.ts'), 'utf8');
    expect(source).not.toMatch(/\bprocess\.kill\(/);
  });
});
