import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { EngraphManager } from '../services/engraph_manager';
import { EngraphManagerConfigStore } from '../services/engraph_manager_config_store';

const binary = join(__dirname, 'fixtures', 'fake_engraph_bin.js');
const resistantBinary = join(__dirname, 'fixtures', 'fake_engraph_resistant.js');
const originalEnv = { ...process.env };
let dir: string;
let managers: EngraphManager[] = [];
const foreignProcesses: ChildProcess[] = [];

afterEach(async () => {
  for (const manager of managers) await manager.disable();
  managers = [];
  for (const child of foreignProcesses.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    }
  }
  process.env = { ...originalEnv };
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function manager(home: string, executablePath = binary) {
  const store = new EngraphManagerConfigStore(join(dir, `config-${managers.length}.json`));
  store.write({ enabled: true, executablePath });
  const instance = new EngraphManager({ configStore: store, homeDir: home });
  managers.push(instance);
  return instance;
}

async function waitFor<T>(read: () => T, accept: (value: T) => boolean, timeoutMs = 8_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (accept(value)) return value;
    if (Date.now() >= deadline) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (err) { return (err as NodeJS.ErrnoException).code !== 'ESRCH'; }
}

function osProcessList() {
  const output = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,lstart=,command='], { encoding: 'utf8' });
  return output.split('\n').flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/);
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), start: match[4], command: match[5] }] : [];
  });
}

async function allocateLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('loopback port allocation failed');
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

it('issue-1574-c3: an unmarked legacy server on its previous random port is reported for manual inspection and left alive', async () => {
  dir = mkdtempSync(join(tmpdir(), 'issue-1574-old-port-'));
  const home = join(dir, 'manager-home');
  const legacyHome = join(dir, 'legacy-home');
  process.env.MEMORY_VAULT_PATH = join(dir, 'vault');
  process.env.MEMORY_VAULT_SUBDIR = 'AGENT-MEMORY';
  mkdirSync(join(dir, 'vault', 'AGENT-MEMORY'), { recursive: true });
  const currentPort = await allocateLoopbackPort();
  let legacyPort = await allocateLoopbackPort();
  while (legacyPort === currentPort) legacyPort = await allocateLoopbackPort();
  mkdirSync(join(home, '.engraph'), { recursive: true });
  writeFileSync(join(home, '.engraph', 'config.toml'), `port = ${currentPort}\nkey = "fixture-key"\n`);
  mkdirSync(join(legacyHome, '.engraph'), { recursive: true });
  writeFileSync(join(legacyHome, '.engraph', 'config.toml'), `port = ${legacyPort}\nkey = "fixture-key"\n`);

  // This child is the only foreign process in the fixture. It uses the checked-in
  // fake CLI and a temporary HOME; manager status must only report it.
  const legacy = spawn(binary, [
    'serve', '--http', '--read-only', '--port', String(legacyPort), '--host', '127.0.0.1',
  ], { env: { ...process.env, HOME: legacyHome }, stdio: 'ignore' });
  foreignProcesses.push(legacy);
  await waitFor(() => !!legacy.pid && pidAlive(legacy.pid), (alive) => alive);

  const instance = manager(home);
  const status = instance.getStatus();
  expect(legacy.pid && pidAlive(legacy.pid)).toBe(true);
  expect(status.backends).toEqual(expect.arrayContaining([
    expect.objectContaining({ pid: legacy.pid, classification: 'stray', state: 'unknown', action: 'inspect-manually' }),
  ]));
  expect(status.backendOwnership).toBe('foreign');
  expect(await instance.enable()).toEqual({ ok: false, reason: 'spawn_failed' });
  expect(legacy.pid && pidAlive(legacy.pid)).toBe(true);
});

it('issue-1574-c1: another manager must not accumulate a second child for the same approved root', async () => {
  dir = mkdtempSync(join(tmpdir(), 'issue-1574-'));
  process.env.MEMORY_VAULT_PATH = join(dir, 'vault');
  process.env.MEMORY_VAULT_SUBDIR = 'AGENT-MEMORY';
  mkdirSync(join(dir, 'vault', 'AGENT-MEMORY'), { recursive: true });
  const home = join(dir, 'home');
  const first = manager(home);
  expect(await first.enable()).toEqual({ ok: true });
  expect(first.getStatus().backendCount).toBe(1);
  const second = manager(home);
  expect(await second.enable()).toEqual({ ok: true });
  expect(second.getStatus()).toMatchObject({ backendCount: 1, backendOwnership: 'reused' });
  await second.disable();
  expect(first.getStatus().backendCount).toBe(0);
  expect(second.getStatus()).toMatchObject({ backendCount: 0, backendOwnership: 'none' });
});

it('issue-1574-c3: foreign live marker is reported but never reaped or replaced', async () => {
  dir = mkdtempSync(join(tmpdir(), 'issue-1574-'));
  process.env.MEMORY_VAULT_PATH = join(dir, 'vault');
  process.env.MEMORY_VAULT_SUBDIR = 'AGENT-MEMORY';
  mkdirSync(join(dir, 'vault', 'AGENT-MEMORY'), { recursive: true });
  const first = manager(join(dir, 'owned-home'));
  expect(await first.enable()).toEqual({ ok: true });
  const foreign = join(dir, 'foreign-home');
  mkdirSync(join(foreign, '.engraph'), { recursive: true });
  const marker = join(foreign, '.engraph', 'serve.owner');
  writeFileSync(marker, readFileSync(join(dir, 'owned-home', '.engraph', 'serve.owner')));
  const second = manager(foreign);
  const status = second.getStatus();
  expect(status.backendCount).toBeGreaterThanOrEqual(1);
  expect(status).toMatchObject({ backendOwnership: 'foreign' });
  expect(status.backends).toEqual(expect.arrayContaining([
    expect.objectContaining({ classification: 'foreign', action: 'inspect-manually' }),
  ]));
  expect(await second.enable()).toEqual({ ok: false, reason: 'spawn_failed' });
  expect((await first.checkHealthNow()).ok).toBe(true);
  expect(readFileSync(marker, 'utf8')).toContain('"child"');
});

it('issue-1574-c1: a different approved root cannot adopt the existing child', async () => {
  dir = mkdtempSync(join(tmpdir(), 'issue-1574-'));
  process.env.MEMORY_VAULT_PATH = join(dir, 'first-vault');
  process.env.MEMORY_VAULT_SUBDIR = 'AGENT-MEMORY';
  mkdirSync(join(dir, 'first-vault', 'AGENT-MEMORY'), { recursive: true });
  const home = join(dir, 'home');
  const first = manager(home);
  expect(await first.enable()).toEqual({ ok: true });
  process.env.MEMORY_VAULT_PATH = join(dir, 'second-vault');
  mkdirSync(join(dir, 'second-vault', 'AGENT-MEMORY'), { recursive: true });
  const second = manager(home);
  expect(await second.enable()).toEqual({ ok: false, reason: 'spawn_failed' });
  expect(second.getStatus()).toMatchObject({ backendCount: 1, backendOwnership: 'foreign' });
  expect((await first.checkHealthNow()).ok).toBe(true);
});

it('issue-1574-c2: disable during indexing must cancel the late start and release its reservation', async () => {
  dir = mkdtempSync(join(tmpdir(), 'issue-1574-'));
  process.env.MEMORY_VAULT_PATH = join(dir, 'vault');
  process.env.MEMORY_VAULT_SUBDIR = 'AGENT-MEMORY';
  mkdirSync(join(dir, 'vault', 'AGENT-MEMORY'), { recursive: true });
  let release!: () => void;
  let entered!: () => void;
  const indexing = new Promise<void>((resolve) => { release = resolve; });
  const indexed = new Promise<void>((resolve) => { entered = resolve; });
  const store = new EngraphManagerConfigStore(join(dir, 'config.json'));
  store.write({ enabled: true, executablePath: binary });
  const home = join(dir, 'home');
  const instance = new EngraphManager({ configStore: store, homeDir: home, execFileImpl: async (_file, args) => {
    if (args[0] === 'index') { entered(); await indexing; }
    return { stdout: '', stderr: '' };
  } });
  managers.push(instance);
  const starting = instance.enable();
  await indexed;
  const disabling = instance.disable();
  release();
  await disabling;
  expect(await starting).toMatchObject({ ok: false });
  expect(instance.getStatus()).toMatchObject({ enabled: false, state: 'disabled', backendCount: 0 });
  expect(existsSync(join(home, '.engraph', 'serve.owner'))).toBe(false);
});

it('issue-1574-c1: racing same-process managers wait for one real backend', async () => {
  dir = mkdtempSync(join(tmpdir(), 'issue-1574-'));
  process.env.MEMORY_VAULT_PATH = join(dir, 'vault');
  process.env.MEMORY_VAULT_SUBDIR = 'AGENT-MEMORY';
  mkdirSync(join(dir, 'vault', 'AGENT-MEMORY'), { recursive: true });
  const home = join(dir, 'home');
  const first = manager(home), second = manager(home);
  expect(await Promise.all([first.enable(), second.enable()])).toEqual([{ ok: true }, { ok: true }]);
  expect(first.getStatus().backendCount + second.getStatus().backendCount).toBe(2); // two views, one backend
  expect(new Set([first.getStatus().backendOwnership, second.getStatus().backendOwnership])).toEqual(new Set(['owned', 'reused']));
  await second.disable();
  expect(first.getStatus().backendCount).toBe(0);
});

it('issue-1574-c1: one unavailable OS identity probe after authenticated health does not discard the owned backend', async () => {
  dir = mkdtempSync(join(tmpdir(), 'issue-1574-probe-'));
  process.env.MEMORY_VAULT_PATH = join(dir, 'vault');
  process.env.MEMORY_VAULT_SUBDIR = 'AGENT-MEMORY';
  mkdirSync(join(dir, 'vault', 'AGENT-MEMORY'), { recursive: true });
  const home = join(dir, 'home');
  const lock = join(home, '.engraph', 'serve.owner');
  const store = new EngraphManagerConfigStore(join(dir, 'config-probe.json'));
  store.write({ enabled: true, executablePath: binary });
  let probeMisses = 0;
  const first = new EngraphManager({ configStore: store, homeDir: home, processListSync: () => {
    if (existsSync(lock)) {
      const marker = JSON.parse(readFileSync(lock, 'utf8')) as { relay?: { pid: number }; child?: { pid: number } };
      if (marker.relay && marker.child && probeMisses++ === 0) return [];
    }
    return osProcessList();
  } });
  managers.push(first);
  const second = manager(home);
  expect(await Promise.all([first.enable(), second.enable()])).toEqual([{ ok: true }, { ok: true }]);
  expect(probeMisses).toBeGreaterThanOrEqual(1);
  expect(new Set([first.getStatus().backendOwnership, second.getStatus().backendOwnership])).toEqual(new Set(['owned', 'reused']));
});

it('issue-1574-c1: persistently unavailable OS identity remains unowned and fails closed', async () => {
  dir = mkdtempSync(join(tmpdir(), 'issue-1574-probe-'));
  process.env.MEMORY_VAULT_PATH = join(dir, 'vault');
  process.env.MEMORY_VAULT_SUBDIR = 'AGENT-MEMORY';
  mkdirSync(join(dir, 'vault', 'AGENT-MEMORY'), { recursive: true });
  const store = new EngraphManagerConfigStore(join(dir, 'config.json'));
  store.write({ enabled: true, executablePath: binary });
  const instance = new EngraphManager({ configStore: store, homeDir: join(dir, 'home'), processListSync: () => [] });
  managers.push(instance);
  expect(await instance.enable()).toEqual({ ok: false, reason: 'spawn_failed' });
  expect(instance.getStatus()).toMatchObject({ state: 'error', backendOwnership: 'none', lastFailureCategory: 'spawn_failed',
    lastFailureMessage: 'managed backend identity could not be verified (relay_probe_unavailable)' });
});

it('issue-1574-c1: a conflicting child start identity fails immediately without retrying', async () => {
  dir = mkdtempSync(join(tmpdir(), 'issue-1574-mismatch-'));
  process.env.MEMORY_VAULT_PATH = join(dir, 'vault');
  process.env.MEMORY_VAULT_SUBDIR = 'AGENT-MEMORY';
  mkdirSync(join(dir, 'vault', 'AGENT-MEMORY'), { recursive: true });
  const home = join(dir, 'home');
  const lock = join(home, '.engraph', 'serve.owner');
  const store = new EngraphManagerConfigStore(join(dir, 'config.json'));
  store.write({ enabled: true, executablePath: binary });
  let finalProbes = 0;
  const instance = new EngraphManager({ configStore: store, homeDir: home, processListSync: () => {
    const processes = osProcessList();
    if (!existsSync(lock)) return processes;
    const marker = JSON.parse(readFileSync(lock, 'utf8')) as { relay?: { pid: number }; child?: { pid: number } };
    if (!marker.relay || !marker.child) return processes;
    finalProbes++;
    return processes.map((process) => process.pid === marker.child!.pid ? { ...process, start: 'wrong-start' } : process);
  } });
  managers.push(instance);
  expect(await instance.enable()).toEqual({ ok: false, reason: 'spawn_failed' });
  expect(finalProbes).toBe(1);
  expect(instance.getStatus().lastFailureMessage).toBe('managed backend identity could not be verified (child_identity_mismatch)');
});

it('issue-1574-c1: a reuser becomes the current owner after the old owner stops and disable reaps its child', async () => {
  dir = mkdtempSync(join(tmpdir(), 'issue-1574-'));
  process.env.MEMORY_VAULT_PATH = join(dir, 'vault');
  process.env.MEMORY_VAULT_SUBDIR = 'AGENT-MEMORY';
  mkdirSync(join(dir, 'vault', 'AGENT-MEMORY'), { recursive: true });
  const home = join(dir, 'home');
  const first = manager(home);
  const second = manager(home);
  expect(await first.enable()).toEqual({ ok: true });
  expect(await second.enable()).toEqual({ ok: true });
  expect(second.getStatus().backendOwnership).toBe('reused');

  await first.disable();
  expect(second.getStatus()).toMatchObject({ backendCount: 0, backendOwnership: 'none' });
  expect(await second.retry()).toEqual({ ok: true });
  const restarted = second.getStatus();
  expect(restarted).toMatchObject({ backendCount: 1, backendOwnership: 'owned' });
  expect(restarted.backends).toEqual([
    expect.objectContaining({ classification: 'owned', state: 'healthy', action: 'disable' }),
  ]);
  const pid = restarted.backends[0].pid;
  expect(pidAlive(pid)).toBe(true);

  await second.disable();
  expect(second.getStatus()).toMatchObject({ backendCount: 0, backendOwnership: 'none' });
  expect(existsSync(join(home, '.engraph', 'serve.owner'))).toBe(false);
  expect(await waitFor(() => pidAlive(pid), (alive) => !alive)).toBe(false);
});

it('issue-1574-c2: a live recorded index child keeps its reservation and is reaped through its detached relay', async () => {
  dir = mkdtempSync(join(tmpdir(), 'issue-1574-'));
  process.env.MEMORY_VAULT_PATH = join(dir, 'vault');
  process.env.MEMORY_VAULT_SUBDIR = 'AGENT-MEMORY';
  mkdirSync(join(dir, 'vault', 'AGENT-MEMORY'), { recursive: true });
  const home = join(dir, 'home');
  mkdirSync(join(home, '.engraph'), { recursive: true });
  writeFileSync(join(home, '.engraph', 'test-index-delay-ms'), '6000');
  const first = manager(home, resistantBinary);
  const starting = first.enable();
  const lock = join(home, '.engraph', 'serve.owner');
  const marker = await waitFor(
    () => existsSync(lock) ? JSON.parse(readFileSync(lock, 'utf8')) : null,
    (value) => !!value?.indexRelay && !!value?.indexChild,
  );
  expect(marker.indexRelay.pgid).toBe(marker.indexRelay.pid);
  expect(marker.indexChild.pgid).toBe(marker.indexRelay.pid);
  expect(pidAlive(marker.indexChild.pid)).toBe(true);
  const ready = join(home, '.engraph', 'test-index-term-ready');
  await waitFor(() => existsSync(ready) ? readFileSync(ready, 'utf8') : '',
    (pid) => pid === String(marker.indexChild.pid));

  const shutdown = first.shutdown();
  const termReceived = join(home, '.engraph', 'test-index-term-received');
  await waitFor(() => existsSync(termReceived) ? readFileSync(termReceived, 'utf8') : '',
    (pid) => pid === String(marker.indexChild.pid));
  expect(JSON.parse(readFileSync(lock, 'utf8')).indexChild.pid).toBe(marker.indexChild.pid);
  expect(pidAlive(marker.indexChild.pid)).toBe(true);
  await shutdown;
  expect((await starting).ok).toBe(false);
  expect(await waitFor(() => pidAlive(marker.indexChild.pid), (alive) => !alive)).toBe(false);
  expect(existsSync(lock)).toBe(false);
});

it('issue-1574-c3: an unmarked legacy serve process is visible and blocks a second spawn without being signaled', async () => {
  dir = mkdtempSync(join(tmpdir(), 'issue-1574-'));
  process.env.MEMORY_VAULT_PATH = join(dir, 'vault');
  process.env.MEMORY_VAULT_SUBDIR = 'AGENT-MEMORY';
  mkdirSync(join(dir, 'vault', 'AGENT-MEMORY'), { recursive: true });
  const home = join(dir, 'home');
  const first = manager(home);
  expect(await first.enable()).toEqual({ ok: true });
  const lock = join(home, '.engraph', 'serve.owner');
  const original = JSON.parse(readFileSync(lock, 'utf8'));
  rmSync(lock);

  const second = manager(home);
  const status = second.getStatus();
  expect(status.backendCount).toBeGreaterThanOrEqual(1);
  expect(status.backendOwnership).toBe('foreign');
  expect(status.backends).toEqual(expect.arrayContaining([
    expect.objectContaining({ pid: original.child.pid, classification: 'stray', state: 'unknown', action: 'inspect-manually' }),
  ]));
  expect(await second.enable()).toEqual({ ok: false, reason: 'spawn_failed' });
  expect(pidAlive(original.child.pid)).toBe(true);
  expect((await first.checkHealthNow()).ok).toBe(true);
});

it('issue-1574-c1: stale own starting marker is removed, but never signaled', async () => {
  dir = mkdtempSync(join(tmpdir(), 'issue-1574-'));
  process.env.MEMORY_VAULT_PATH = join(dir, 'vault');
  process.env.MEMORY_VAULT_SUBDIR = 'AGENT-MEMORY';
  mkdirSync(join(dir, 'vault', 'AGENT-MEMORY'), { recursive: true });
  const home = join(dir, 'home');
  const first = manager(home);
  expect(await first.enable()).toEqual({ ok: true });
  const lock = join(home, '.engraph', 'serve.owner');
  const old = JSON.parse(readFileSync(lock, 'utf8'));
  await first.disable();
  writeFileSync(lock, JSON.stringify({ ...old, state: 'starting', relay: undefined, child: undefined,
    owner: { ...old.owner, start: 'not-the-owner' } }));
  const next = manager(home);
  expect(next.getStatus().backendCount).toBe(0);
  expect(await next.enable()).toEqual({ ok: true });
  expect(next.getStatus().backendCount).toBe(1);
});

it('issue-1574-c2: shutdown awaits a cancelled index and leaves no reservation', async () => {
  dir = mkdtempSync(join(tmpdir(), 'issue-1574-'));
  process.env.MEMORY_VAULT_PATH = join(dir, 'vault');
  process.env.MEMORY_VAULT_SUBDIR = 'AGENT-MEMORY';
  mkdirSync(join(dir, 'vault', 'AGENT-MEMORY'), { recursive: true });
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((done) => { enter = done; });
  const indexing = new Promise<void>((done) => { release = done; });
  const store = new EngraphManagerConfigStore(join(dir, 'config.json'));
  store.write({ enabled: true, executablePath: binary });
  const home = join(dir, 'home');
  const instance = new EngraphManager({ configStore: store, homeDir: home, execFileImpl: async (_file, args) => {
    if (args[0] === 'index') { enter(); await indexing; }
    return { stdout: '', stderr: '' };
  } });
  managers.push(instance);
  const starting = instance.enable();
  await entered;
  const shutdown = instance.shutdown();
  release();
  await shutdown;
  expect((await starting).ok).toBe(false);
  expect(instance.getStatus().backendCount).toBe(0);
  expect(existsSync(join(home, '.engraph', 'serve.owner'))).toBe(false);
});

it('issue-1574-c2: rebuild during an in-flight index starts a new generation rather than adopting the cancelled result', async () => {
  dir = mkdtempSync(join(tmpdir(), 'issue-1574-'));
  process.env.MEMORY_VAULT_PATH = join(dir, 'vault');
  process.env.MEMORY_VAULT_SUBDIR = 'AGENT-MEMORY';
  mkdirSync(join(dir, 'vault', 'AGENT-MEMORY'), { recursive: true });
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((done) => { enter = done; });
  const held = new Promise<void>((done) => { release = done; });
  let indexed = 0;
  const home = join(dir, 'home');
  const store = new EngraphManagerConfigStore(join(dir, 'config.json'));
  store.write({ enabled: true, executablePath: binary });
  const instance = new EngraphManager({ configStore: store, homeDir: home, execFileImpl: async (_file, args) => {
    if (args[0] === 'index') { indexed++; if (indexed === 1) { enter(); await held; } }
    return { stdout: '', stderr: '' };
  } });
  managers.push(instance);
  const first = instance.enable();
  await entered;
  const rebuilding = instance.rebuild();
  release();
  expect((await first).ok).toBe(false);
  expect(await rebuilding).toEqual({ ok: true });
  expect(indexed).toBe(2);
  expect(instance.getStatus()).toMatchObject({ backendCount: 1, backendOwnership: 'owned' });
  expect(JSON.parse(readFileSync(join(home, '.engraph', 'serve.owner'), 'utf8')).nonce).toMatch(/^[a-f0-9]{48}$/);
});

it('issue-1574-c2: shutdown closes starts synchronously even when enable races cleanup', async () => {
  dir = mkdtempSync(join(tmpdir(), 'issue-1574-'));
  process.env.MEMORY_VAULT_PATH = join(dir, 'vault');
  process.env.MEMORY_VAULT_SUBDIR = 'AGENT-MEMORY';
  mkdirSync(join(dir, 'vault', 'AGENT-MEMORY'), { recursive: true });
  const instance = manager(join(dir, 'home'));
  const shutdown = instance.shutdown();
  expect((await instance.enable()).ok).toBe(false);
  await shutdown;
  expect(instance.getStatus().backendCount).toBe(0);
  expect(existsSync(join(dir, 'home', '.engraph', 'serve.owner'))).toBe(false);
});

it('issue-1574-c1: a marker with a wrong child identity cannot be removed or adopted', async () => {
  dir = mkdtempSync(join(tmpdir(), 'issue-1574-'));
  process.env.MEMORY_VAULT_PATH = join(dir, 'vault');
  process.env.MEMORY_VAULT_SUBDIR = 'AGENT-MEMORY';
  mkdirSync(join(dir, 'vault', 'AGENT-MEMORY'), { recursive: true });
  const home = join(dir, 'home');
  const first = manager(home);
  expect(await first.enable()).toEqual({ ok: true });
  const lock = join(home, '.engraph', 'serve.owner');
  const original = JSON.parse(readFileSync(lock, 'utf8'));
  const wrong = { ...original, child: { ...original.child, start: 'recycled-or-unverified' }, owner: { ...original.owner, start: 'old-parent' } };
  writeFileSync(lock, JSON.stringify(wrong));
  const second = manager(home);
  expect(await second.enable()).toEqual({ ok: false, reason: 'spawn_failed' });
  expect(readFileSync(lock, 'utf8')).toBe(JSON.stringify(wrong));
  // Restore the exact verified marker so the test's own process can shut down.
  writeFileSync(lock, JSON.stringify(original));
});

it('issue-1574-c1: config write failure releases only the current starting reservation', async () => {
  dir = mkdtempSync(join(tmpdir(), 'issue-1574-'));
  process.env.MEMORY_VAULT_PATH = join(dir, 'vault');
  process.env.MEMORY_VAULT_SUBDIR = 'AGENT-MEMORY';
  mkdirSync(join(dir, 'vault', 'AGENT-MEMORY'), { recursive: true });
  const home = join(dir, 'home');
  mkdirSync(join(home, '.engraph', 'config.toml'), { recursive: true });
  const instance = manager(home);
  expect(await instance.enable()).toEqual({ ok: false, reason: 'permission_denied' });
  expect(instance.getStatus()).toMatchObject({ backendCount: 0, lastFailureCategory: 'permission_denied' });
  expect(existsSync(join(home, '.engraph', 'serve.owner'))).toBe(false);
});
