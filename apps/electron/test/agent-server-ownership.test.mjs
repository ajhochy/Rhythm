import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { SourceTextModule, SyntheticModule } from 'node:vm';
import test from 'node:test';

// Keep this suite's timeout case fast; production defaults to a first-launch-tolerant budget.
process.env.RHYTHM_AGENT_READY_BUDGET_MS = '8000';
import { portAvailable } from '../src/agent-server.mjs';

// Real service, fake OS boundaries only: never probe or signal the desktop runtime.
async function fixture({ occupied = [], healthy = true, mkdirError = false, spawnError = false, graceful = true, exitDelayMs = 0, lingerEnginePortMs = 0, relayConfigurationProvider } = {}) {
  const signals = [], probes = [], commands = [], snapshots = [], spawnOptions = [];
  const occupiedPorts = new Set(occupied);
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  child.kill = (signal) => {
    signals.push(signal);
    if (graceful || signal === 'SIGKILL') {
      if (lingerEnginePortMs > 0) {
        occupiedPorts.add(4096);
        setTimeout(() => occupiedPorts.delete(4096), lingerEnginePortMs);
      }
      setTimeout(() => child.emit('exit', 0), exitDelayMs);
    }
    return true;
  };
  let spawns = 0;
  const source = await readFile(new URL('../src/agent-server.mjs', import.meta.url), 'utf8');
  const module = new SourceTextModule(source, { initializeImportMeta(meta) { meta.url = new URL('../src/agent-server.mjs', import.meta.url).href; } });
  await module.link(async (name) => {
    let exports;
    if (name === './human-approval-main-signer.mjs') exports = { capabilityMaterial: async () => ({ humanApprovalPublicKey: 'key', humanApprovalCapabilitySha256: 'hash' }) };
    else {
      exports = { ...await import(name) };
      if (name === 'node:child_process') Object.assign(exports, {
        execFile: (cmd, args, cb) => { commands.push(cmd); cb(null, '', ''); },
        spawn: (_command, _args, options) => { spawns++; spawnOptions.push(options); if (spawnError) setImmediate(() => child.emit('error', new Error('ENOENT'))); return child; },
      });
      if (name === 'node:fs') exports.existsSync = () => true;
      if (name === 'node:fs/promises') exports.mkdir = async () => { if (mkdirError) throw new Error('EACCES'); };
      if (name === 'node:net') exports.createServer = () => {
        const server = new EventEmitter();
        server.listen = ({ port }, cb) => { probes.push(port); queueMicrotask(() => occupiedPorts.has(port) ? server.emit('error', Object.assign(new Error('occupied'), { code: 'EADDRINUSE' })) : cb()); return server; };
        server.close = (cb) => cb();
        return server;
      };
    }
    return new SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); });
  });
  await module.evaluate();
  const service = new module.namespace.AgentServerService({ relayConfigurationProvider });
  service.onStatusChange((s) => snapshots.push(s));
  return { service, child, signals, probes, commands, snapshots, spawnOptions, healthy, setOccupied: (ports) => { occupiedPorts.clear(); for (const port of ports) occupiedPorts.add(port); }, spawns: () => spawns };
}

test('relay restoration: an owned local runtime receives the restored cloud session without exposing it through status', async (t) => {
  const f = await fixture({
    relayConfigurationProvider: async () => ({ token: 'fixture-restored-session', productionApiBase: 'https://team.example/tenant' }),
  });
  t.mock.method(globalThis, 'fetch', async (url) => ({ ok: true, json: async () => String(url).endsWith('/global/health') ? { healthy: true, version: 'test' } : { status: 'ok', service: 'rhythm-api-server' } }));

  assert.equal((await f.service.start()).status, 'ready');
  const env = f.spawnOptions.at(-1)?.env;
  assert.equal(env?.RHYTHM_RELAY_URLS, 'wss://team.example/tenant/relay/uplink');
  assert.equal(env?.RHYTHM_RELAY_BEARER, 'fixture-restored-session');
  assert.doesNotMatch(env?.RHYTHM_RELAY_URLS ?? '', /vcrcapps\.com/);
  assert.doesNotMatch(JSON.stringify(f.snapshots), /fixture-restored-session/);
  await f.service.stopGracefully();
});

for (const healthy of [false, true]) for (const port of [4001, 4096]) {
  test(`e11-c1: occupied ${port}, foreign health=${healthy}, is never adopted or signaled`, async (t) => {
    const f = await fixture({ occupied: [port], healthy });
    const kill = t.mock.method(process, 'kill', () => { throw new Error('must never signal a discovered PID'); });
    t.mock.method(globalThis, 'fetch', async () => ({ ok: healthy }));
    const status = await f.service.start();
    assert.equal(status.failureReason, 'portConflict');
    assert.match(status.errorMessage, new RegExp(`${port}.*[Qq]uit.*[Rr]eopen`));
    await f.service.stopGracefully(); f.service.stop();
    assert.equal(f.spawns(), 0); assert.deepEqual(f.signals, []); assert.deepEqual(f.commands, []);
    assert.equal(kill.mock.callCount(), 0);
  });
}

test('e11-c2: async spawn error is handled and never becomes ready', async (t) => {
  const f = await fixture({ spawnError: true });
  t.mock.method(globalThis, 'fetch', async (url) => ({ ok: true, json: async () => String(url).endsWith('/global/health') ? { healthy: true, version: 'test' } : { status: 'ok', service: 'rhythm-api-server' } }));
  const pending = f.service.start();
  // Assertion catches missing error handler before emitting would crash the process.
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(f.child.listenerCount('error') > 0 || f.service.status.failureReason === 'spawnThrew');
  assert.equal((await pending).failureReason, 'spawnThrew');
  assert.equal(f.service.status.status, 'failed');
});

test('e11-c3: exit after ready clears ownership and publishes failure', async (t) => {
  const f = await fixture(); t.mock.method(globalThis, 'fetch', async (url) => ({ ok: true, json: async () => String(url).endsWith('/global/health') ? { healthy: true, version: 'test' } : { status: 'ok', service: 'rhythm-api-server' } }));
  assert.equal((await f.service.start()).status, 'ready');
  f.child.emit('exit', 7);
  assert.equal(f.snapshots.at(-1).failureReason, 'lostConnection');
  await f.service.stopGracefully();
  assert.deepEqual(f.signals, []);
  assert.equal(f.child.listenerCount('exit'), 0);
});

test('e11-c4: rejected filesystem startup resolves actionable failed state', async (t) => {
  const f = await fixture({ mkdirError: true }); t.mock.method(globalThis, 'fetch', async () => ({ ok: false }));
  assert.equal((await f.service.start()).failureReason, 'startupFailed');
  assert.match(f.service.status.errorMessage, /[Rr]eopen/);
  assert.equal(f.spawns(), 0);
});

for (const graceful of [true, false]) test(`e11-c5: owned stop graceful=${graceful} signals exact child and cleans listeners`, async (t) => {
  const f = await fixture({ graceful }); t.mock.method(globalThis, 'fetch', async (url) => ({ ok: true, json: async () => String(url).endsWith('/global/health') ? { healthy: true, version: 'test' } : { status: 'ok', service: 'rhythm-api-server' } }));
  await f.service.start();
  await f.service.stopGracefully();
  assert.deepEqual(f.signals, graceful ? ['SIGTERM'] : ['SIGTERM', 'SIGKILL']);
  assert.equal(f.service.status.status, 'stopped');
  for (const event of ['exit', 'error']) assert.equal(f.child.listenerCount(event), 0);
  assert.equal(f.child.stdout.listenerCount('data'), 0); assert.equal(f.child.stderr.listenerCount('data'), 0);
  await f.service.stopGracefully(); assert.equal(f.signals.length, graceful ? 1 : 2);
});

test('e11-c7: repeated start owns one child; timeout is bounded, stops child, never auto-retries', async (t) => {
  const f = await fixture();
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => {
    await new Promise((r) => {
      const socketTimer = setTimeout(r, 2_500);
      signal.addEventListener('abort', () => { clearTimeout(socketTimer); r(); }, { once: true });
    });
    return { ok: false };
  });
  const began = Date.now();
  const [first, second] = await Promise.all([f.service.start(), f.service.start()]);
  assert.equal(first.failureReason, 'healthCheckTimeout');
  assert.equal(second.failureReason, 'healthCheckTimeout');
  assert.ok(Date.now() - began < 12_000, 'bounded wall deadline (budget + one diagnostic probe), not 40 * (2s fetch + 200ms)');
  assert.equal(f.spawns(), 1);
  assert.deepEqual(f.signals, ['SIGTERM']);
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(f.spawns(), 1);
});

for (const host of ['127.0.0.1', '::1']) test(`e11-c1: real bind probe rejects an owned ephemeral ${host} non-HTTP listener without disturbing it`, async () => {
  const foreign = createServer();
  await new Promise((r) => foreign.listen(0, host, r));
  const { port } = foreign.address();
  try {
    assert.equal(await portAvailable(port), false);
    assert.equal(foreign.listening, true);
  } finally { await new Promise((r) => foreign.close(r)); }
  assert.equal(await portAvailable(port), true);
});

test('e11-c5: stopping during startup cannot publish late health as ready', async (t) => {
  const f = await fixture();
  const responses = [];
  const requested = new Promise((resolve) => {
    t.mock.method(globalThis, 'fetch', () => { resolve(); return new Promise((r) => { responses.push(r); }); });
  });
  const start = f.service.start();
  await requested;
  await f.service.stopGracefully();
  for (const respond of responses) respond({ ok: true, json: async () => ({ status: 'ok', service: 'rhythm-api-server', healthy: true, version: 'test' }) });
  assert.equal((await start).status, 'stopped');
  assert.equal(f.snapshots.some((s) => s.status === 'ready'), false);
  assert.deepEqual(f.signals, ['SIGTERM']);
});

test('existing healthy Rhythm API and engine are reused and survive Electron shutdown', async (t) => {
  const f = await fixture({ occupied: [4001, 4096] });
  t.mock.method(globalThis, 'fetch', async (url) => ({ ok: true, json: async () =>
    String(url).endsWith('/global/health') ? { healthy: true, version: 'rhythm-test' } : { status: 'ok', service: 'rhythm-api-server' } }));
  assert.equal((await f.service.start()).status, 'ready');
  assert.equal((await f.service.start()).status, 'ready');
  assert.equal(f.spawns(), 0);
  await f.service.stopGracefully(); f.service.stop();
  assert.deepEqual(f.signals, []);
  assert.equal(f.service.status.status, 'stopped');
});

test('HTTP 200 from unrelated servers is not accepted as Rhythm', async (t) => {
  const f = await fixture({ occupied: [4001, 4096] });
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ healthy: true, status: 'ok', service: 'other-service', version: '1' }) }));
  assert.equal((await f.service.start()).failureReason, 'portConflict');
  assert.equal(f.spawns(), 0);
  assert.deepEqual(f.signals, []);
});

test('1555:electron-local-runtime-restart-ipc:1 owned restart stops gracefully and starts one replacement without failure', async (t) => {
  const f = await fixture();
  t.mock.method(globalThis, 'fetch', async (url) => ({ ok: true, json: async () =>
    String(url).endsWith('/global/health') ? { healthy: true, version: 'test' } : { status: 'ok', service: 'rhythm-api-server' } }));
  assert.equal((await f.service.start()).status, 'ready');
  f.snapshots.length = 0;

  assert.deepEqual(await f.service.restart(), { ok: true });
  assert.deepEqual(f.signals, ['SIGTERM']);
  assert.equal(f.spawns(), 2, 'one initial child plus exactly one replacement');
  assert.deepEqual(f.snapshots.map((snapshot) => snapshot.status), ['stopping', 'stopped', 'starting', 'ready']);
  assert.equal(f.snapshots.some((snapshot) => snapshot.status === 'failed'), false);
});

test('1555:electron-local-runtime-restart-ipc:2 adopted runtime restart is refused without mutation', async (t) => {
  const f = await fixture({ occupied: [4001, 4096] });
  t.mock.method(globalThis, 'fetch', async (url) => ({ ok: true, json: async () =>
    String(url).endsWith('/global/health') ? { healthy: true, version: 'test' } : { status: 'ok', service: 'rhythm-api-server' } }));
  assert.equal((await f.service.start()).status, 'ready');
  const snapshots = f.snapshots.length;

  assert.deepEqual(await f.service.restart(), {
    ok: false,
    reason: 'adopted',
    code: 'runtime_unowned',
  });
  assert.equal(f.service.status.status, 'ready');
  assert.equal(f.service.status.owned, false);
  assert.equal(f.snapshots.length, snapshots);
  assert.deepEqual(f.signals, []);
  assert.equal(f.spawns(), 0);
});

test('1555:electron-local-runtime-restart-ipc:3 status reports ownership without leaking relay credentials', async (t) => {
  const owned = await fixture({
    relayConfigurationProvider: async () => ({ token: 'never-in-snapshot', productionApiBase: 'https://team.example' }),
  });
  t.mock.method(globalThis, 'fetch', async (url) => ({ ok: true, json: async () =>
    String(url).endsWith('/global/health') ? { healthy: true, version: 'test' } : { status: 'ok', service: 'rhythm-api-server' } }));
  await owned.service.start();
  assert.equal(owned.service.status.owned, true);
  assert.doesNotMatch(JSON.stringify(owned.service.status), /never-in-snapshot/);

  const adopted = await fixture({ occupied: [4001, 4096] });
  await adopted.service.start();
  assert.equal(adopted.service.status.owned, false);
});

test('1555:electron-local-runtime-restart-ipc:4 concurrent restarts share one stop and one replacement', async (t) => {
  const f = await fixture();
  t.mock.method(globalThis, 'fetch', async (url) => ({ ok: true, json: async () =>
    String(url).endsWith('/global/health') ? { healthy: true, version: 'test' } : { status: 'ok', service: 'rhythm-api-server' } }));
  await f.service.start();

  const [first, second] = await Promise.all([f.service.restart(), f.service.restart()]);
  assert.deepEqual(first, { ok: true });
  assert.deepEqual(second, { ok: true });
  assert.deepEqual(f.signals, ['SIGTERM']);
  assert.equal(f.spawns(), 2);
});

test('review:agent-server.mjs:229 failed owned replacement remains retryable and is never called adopted', async (t) => {
  const f = await fixture();
  let healthy = true;
  t.mock.method(globalThis, 'fetch', async (url) => healthy
    ? { ok: true, json: async () => String(url).endsWith('/global/health') ? { healthy: true, version: 'test' } : { status: 'ok', service: 'rhythm-api-server' } }
    : { ok: false, json: async () => ({}) });
  assert.equal((await f.service.start()).status, 'ready');

  healthy = false;
  f.setOccupied([4001]);
  const failed = await f.service.restart();
  assert.equal(failed.ok, false);
  assert.equal(f.service.status.ownership, 'electron');
  assert.equal(f.service.status.owned, true);

  healthy = true;
  f.setOccupied([]);
  assert.deepEqual(await f.service.restart(), { ok: true });
  assert.equal(f.spawns(), 2, 'the retry starts one replacement after the failed attempt');
});

test('review:agent-server.mjs:433 restart during startup waits for the stale start before replacing it', async (t) => {
  const f = await fixture();
  let healthy = false;
  t.mock.method(globalThis, 'fetch', async (url) => healthy
    ? { ok: true, json: async () => String(url).endsWith('/global/health') ? { healthy: true, version: 'test' } : { status: 'ok', service: 'rhythm-api-server' } }
    : { ok: false, json: async () => ({}) });
  const initialStart = f.service.start();
  while (f.spawns() === 0) await new Promise((resolve) => setImmediate(resolve));

  const restarting = f.service.restart();
  healthy = true;
  assert.deepEqual(await restarting, { ok: true });
  await initialStart;
  assert.equal(f.spawns(), 2);
  assert.equal(f.service.status.status, 'ready');
});

test('review:agent-server.mjs:435 restart waits for the old engine port to be released', async (t) => {
  const f = await fixture({ lingerEnginePortMs: 40 });
  let healthy = true;
  t.mock.method(globalThis, 'fetch', async (url) => healthy
    ? { ok: true, json: async () => String(url).endsWith('/global/health') ? { healthy: true, version: 'test' } : { status: 'ok', service: 'rhythm-api-server' } }
    : { ok: false, json: async () => ({}) });
  assert.equal((await f.service.start()).status, 'ready');
  healthy = false;
  setTimeout(() => { healthy = true; }, 60);

  assert.deepEqual(await f.service.restart(), { ok: true });
  assert.equal(f.spawns(), 2);
  assert.equal(f.service.status.ownership, 'electron');
});

test('review:main.mjs:774 quit-time stop cancels an in-flight restart before replacement spawn', async (t) => {
  const f = await fixture({ exitDelayMs: 25 });
  t.mock.method(globalThis, 'fetch', async (url) => ({ ok: true, json: async () =>
    String(url).endsWith('/global/health') ? { healthy: true, version: 'test' } : { status: 'ok', service: 'rhythm-api-server' } }));
  assert.equal((await f.service.start()).status, 'ready');

  const restarting = f.service.restart();
  const stopping = f.service.stopForQuit();
  assert.deepEqual(await restarting, { ok: false, reason: 'shutting_down', code: 'shutting_down' });
  await stopping;
  assert.equal(f.spawns(), 1);
  assert.equal(f.service.status.status, 'stopped');
});
