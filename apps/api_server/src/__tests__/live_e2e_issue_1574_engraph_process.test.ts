/** #1574: real OS relay, real authenticated HTTP, synthetic vault and fake CLI. */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, lstatSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { EngraphManager } from '../services/engraph_manager';
import { EngraphManagerConfigStore } from '../services/engraph_manager_config_store';

const requested = process.env.RHYTHM_1574_FIXTURE_ROOT;
// Never let a typo point lifecycle tests at an Application Support HOME.
const sandbox = requested && existsSync(requested) ? realpathSync(requested) : '';
const safe = (sandbox.startsWith('/private/tmp/') || sandbox.startsWith('/var/folders/')) &&
  !sandbox.includes(`${sep}Application Support${sep}`) && !sandbox.includes(`${sep}Rhythm${sep}`) &&
  lstatSync(sandbox).isDirectory() && sandbox !== realpathSync('/private/tmp');
const live = process.env.RHYTHM_LIVE_E2E === '1' && safe;
const normal = join(__dirname, 'fixtures', 'fake_engraph_bin.js');
const resistant = join(__dirname, 'fixtures', 'fake_engraph_resistant.js');
let root: string | undefined;
let parent: ChildProcess | undefined;
let manager: EngraphManager | undefined;
const oldEnv = { ...process.env };

const wait = async (predicate: () => boolean, label: string) => {
  for (let n = 0; n < 100; n++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`fake backend did not reach ${label}`);
};
const alive = (pid: number, start: string) => {
  try { return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8', timeout: 1000 }).trim() === start; }
  catch { return false; }
};
type Marker = { nonce: string; state: string; relay: { pid: number; start: string }; child: { pid: number; start: string } };
const marker = (lock: string): Marker => JSON.parse(readFileSync(lock, 'utf8')) as Marker;
const gone = async (lock: string, owned: Marker) => {
  await wait(() => !alive(owned.relay.pid, owned.relay.start) && !alive(owned.child.pid, owned.child.start), 'zero owned survivors');
  await wait(() => !existsSync(lock), 'released marker');
  expect(alive(owned.relay.pid, owned.relay.start)).toBe(false);
  expect(alive(owned.child.pid, owned.child.start)).toBe(false);
};
afterEach(async () => {
  if (manager) await manager.disable();
  manager = undefined;
  if (parent && parent.exitCode === null) parent.kill('SIGKILL'); // exact synthetic driver handle only
  parent = undefined;
  process.env = { ...oldEnv };
  if (root && !['disable', 'late', 'resistant', 'shutdown', 'parent', 'parent-resistant', 'parent-index'].some((name) =>
    existsSync(join(root!, name, '.engraph', 'serve.owner')))) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

it.skipIf(!live)('issue-1574-c2: disable, late start, resistant TERM, shutdown and SIGKILL parent leave zero owned survivors', async () => {
  root = mkdtempSync(join(sandbox, 'engraph-1574-'));
  mkdirSync(join(root, 'vault', 'AGENT-MEMORY'), { recursive: true });
  process.env.MEMORY_VAULT_PATH = join(root, 'vault');
  process.env.MEMORY_VAULT_SUBDIR = 'AGENT-MEMORY';
  for (const [name, binary] of [['disable', normal], ['late', resistant], ['resistant', resistant], ['shutdown', normal], ['parent', normal], ['parent-resistant', resistant]] as const) {
    const home = join(root, name);
    const lock = join(home, '.engraph', 'serve.owner');
    const config = join(root, `${name}.json`);
    const store = new EngraphManagerConfigStore(config);
    store.write({ enabled: true, executablePath: binary });
    const env = { ...process.env };
    if (name === 'late') {
      mkdirSync(join(home, '.engraph'), { recursive: true });
      writeFileSync(join(home, '.engraph', 'test-serve-delay-ms'), '1500');
    }
    if (name.startsWith('parent')) {
      const script = `
        const { EngraphManager } = require(${JSON.stringify(join(__dirname, '..', 'services', 'engraph_manager'))});
        const { EngraphManagerConfigStore } = require(${JSON.stringify(join(__dirname, '..', 'services', 'engraph_manager_config_store'))});
        const m = new EngraphManager({ homeDir: ${JSON.stringify(home)}, configStore: new EngraphManagerConfigStore(${JSON.stringify(config)}) });
        m.enable().then(r => { if (!r.ok) process.exit(2); process.stdout.write('READY\\n'); });
      `;
      parent = spawn(process.execPath, ['-r', require.resolve('tsx/cjs'), '-e', script], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      await wait(() => existsSync(lock) && marker(lock).state === 'serving', `${name} serving`);
      const owned = marker(lock);
      expect(owned.nonce).toMatch(/^[a-f0-9]{48}$/);
      expect(alive(owned.child.pid, owned.child.start)).toBe(true);
      parent.kill('SIGKILL');
      await gone(lock, owned);
      parent = undefined;
    } else {
      manager = new EngraphManager({ configStore: store, homeDir: home });
      const starting = manager.enable();
      await wait(() => existsSync(lock) && !!marker(lock).child, `${name} relay`);
      const owned = marker(lock);
      expect(owned.nonce).toMatch(/^[a-f0-9]{48}$/);
      expect(alive(owned.child.pid, owned.child.start)).toBe(true);
      if (name === 'late') {
        await manager.disable();
        expect((await starting).ok).toBe(false);
      } else {
        expect(await starting).toEqual({ ok: true });
        if (name === 'shutdown') await manager.shutdown();
        else await manager.disable();
      }
      await gone(lock, owned);
      manager = undefined;
    }
  }
}, 240_000);

it.skipIf(!live)('issue-1574-c2: an indexing child and relay exit after their manager parent is killed', async () => {
  root = mkdtempSync(join(sandbox, 'engraph-1574-index-parent-'));
  const home = join(root, 'parent-index');
  const lock = join(home, '.engraph', 'serve.owner');
  const config = join(root, 'parent-index.json');
  mkdirSync(join(root, 'vault', 'AGENT-MEMORY'), { recursive: true });
  mkdirSync(join(home, '.engraph'), { recursive: true });
  writeFileSync(join(home, '.engraph', 'test-index-delay-ms'), '8000');
  process.env.MEMORY_VAULT_PATH = join(root, 'vault');
  process.env.MEMORY_VAULT_SUBDIR = 'AGENT-MEMORY';
  const store = new EngraphManagerConfigStore(config);
  store.write({ enabled: true, executablePath: resistant });
  const script = `
    const { EngraphManager } = require(${JSON.stringify(join(__dirname, '..', 'services', 'engraph_manager'))});
    const { EngraphManagerConfigStore } = require(${JSON.stringify(join(__dirname, '..', 'services', 'engraph_manager_config_store'))});
    const manager = new EngraphManager({ homeDir: ${JSON.stringify(home)}, configStore: new EngraphManagerConfigStore(${JSON.stringify(config)}) });
    manager.enable().then(result => { if (!result.ok) process.exit(2); });
  `;
  parent = spawn(process.execPath, ['-r', require.resolve('tsx/cjs'), '-e', script], {
    env: { ...process.env, HOME: home }, stdio: 'ignore',
  });
  await wait(() => {
    if (!existsSync(lock)) return false;
    const current = JSON.parse(readFileSync(lock, 'utf8'));
    return current.state === 'starting' && !!current.indexRelay && !!current.indexChild;
  }, 'index relay and child');
  const indexing = JSON.parse(readFileSync(lock, 'utf8')) as {
    nonce: string;
    indexRelay: { pid: number; start: string };
    indexChild: { pid: number; start: string };
  };
  expect(alive(indexing.indexRelay.pid, indexing.indexRelay.start)).toBe(true);
  expect(alive(indexing.indexChild.pid, indexing.indexChild.start)).toBe(true);

  // This SIGKILL targets only the test-owned manager driver, never a user's process.
  parent.kill('SIGKILL');
  await new Promise<void>((resolve) => parent?.once('exit', () => resolve()));
  await wait(() => !alive(indexing.indexChild.pid, indexing.indexChild.start) &&
    !alive(indexing.indexRelay.pid, indexing.indexRelay.start), 'zero indexing survivors');
  expect(alive(indexing.indexChild.pid, indexing.indexChild.start)).toBe(false);
  expect(alive(indexing.indexRelay.pid, indexing.indexRelay.start)).toBe(false);
  const released = JSON.parse(readFileSync(lock, 'utf8')) as Record<string, unknown>;
  expect(released).toMatchObject({ nonce: indexing.nonce, state: 'starting' });
  expect(released).not.toHaveProperty('indexRelay');
  expect(released).not.toHaveProperty('indexChild');
  expect(released).not.toHaveProperty('child');
  expect(released).not.toHaveProperty('relay');
  // Remove only the nonce-matching, childless marker produced by this fixture.
  rmSync(lock);
  parent = undefined;
}, 30_000);
