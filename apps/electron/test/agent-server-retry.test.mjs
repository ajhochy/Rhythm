import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { SourceTextModule, SyntheticModule } from 'node:vm';
import test from 'node:test';

// #1584 + launch-hang: Retry after healthCheckTimeout must respawn; a hung pre-spawn step must fail bounded.
process.env.RHYTHM_AGENT_READY_BUDGET_MS = '400';
process.env.RHYTHM_AGENT_PRESPAWN_BUDGET_MS = '300';

// Real service, fake OS boundaries only: never probe or signal the desktop runtime.
async function fixture({ occupied = [], healthy = true, mkdirError = false, spawnError = false, graceful = true, exitDelayMs = 0, lingerEnginePortMs = 0, relayConfigurationProvider, capabilityHang = false, mkdirHang = false } = {}) {
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
    if (name === './human-approval-main-signer.mjs') exports = { capabilityMaterial: () => capabilityHang ? new Promise(() => {}) : Promise.resolve({ humanApprovalPublicKey: 'key', humanApprovalCapabilitySha256: 'hash' }) };
    else {
      exports = { ...await import(name) };
      if (name === 'node:child_process') Object.assign(exports, {
        execFile: (cmd, args, cb) => { commands.push(cmd); cb(null, '', ''); },
        spawn: (_command, _args, options) => { spawns++; spawnOptions.push(options); if (spawnError) setImmediate(() => child.emit('error', new Error('ENOENT'))); return child; },
      });
      if (name === 'node:fs') exports.existsSync = () => true;
      if (name === 'node:fs/promises') exports.mkdir = async () => { if (mkdirError) throw new Error('EACCES'); if (mkdirHang) await new Promise(() => {}); };
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

const rhythmHealth = (isHealthy) => async (url) => isHealthy()
  ? { ok: true, json: async () => String(url).endsWith('/global/health') ? { healthy: true, version: 'test' } : { status: 'ok', service: 'rhythm-api-server' } }
  : { ok: false, json: async () => ({}) };

test('1584: Retry from the failure dialog after healthCheckTimeout spawns a fresh generation', async (t) => {
  // The killed runtime's engine grandchild briefly keeps 4096 bound after the timeout stop.
  const f = await fixture({ lingerEnginePortMs: 150 });
  let healthy = false;
  t.mock.method(globalThis, 'fetch', rhythmHealth(() => healthy));
  /** @type {Promise<unknown> | undefined} */
  let retried;
  f.service.onStatusChange((snapshot) => {
    // main.mjs: a parentless macOS alert resolves synchronously, so Retry lands before start() settles.
    if (snapshot.failureReason === 'healthCheckTimeout' && !retried) retried = Promise.resolve({ response: 0 }).then(() => { healthy = true; return f.service.restart(); });
  });

  assert.equal((await f.service.start()).failureReason, 'healthCheckTimeout');
  assert.ok(retried, 'failure published a Retry');
  assert.deepEqual(await retried, { ok: true });
  assert.equal(f.spawns(), 2, 'Retry spawned exactly one replacement');
  assert.equal(f.service.status.status, 'ready');
  assert.equal(f.service.status.owned, true);
  await f.service.stopGracefully();
});

test('launch hang: a hung approval-identity read fails bounded instead of wedging startup', async (t) => {
  const f = await fixture({ capabilityHang: true });
  t.mock.method(globalThis, 'fetch', rhythmHealth(() => true));
  const began = Date.now();
  const status = await f.service.start();
  assert.ok(Date.now() - began < 2_000, 'bounded by the pre-spawn budget');
  assert.equal(status.status, 'failed');
  assert.equal(status.failureReason, 'approvalCredentialsUnavailable');
  assert.match(status.stderrTail ?? '', /stalled reading the approval identity/);
  assert.equal(f.spawns(), 0);
});

test('launch hang: a hung filesystem step fails bounded with the stalled step named', async (t) => {
  const f = await fixture({ mkdirHang: true });
  t.mock.method(globalThis, 'fetch', rhythmHealth(() => true));
  const status = await f.service.start();
  assert.equal(status.failureReason, 'startupFailed');
  assert.match(status.errorMessage ?? '', /stalled while creating the data folder.*Retry/);
  assert.equal(f.spawns(), 0);
});

test('launch hang: a hung relay settings read disables only the relay and still spawns', async (t) => {
  const f = await fixture({ relayConfigurationProvider: () => new Promise(() => {}) });
  t.mock.method(globalThis, 'fetch', rhythmHealth(() => true));
  assert.equal((await f.service.start()).status, 'ready');
  assert.equal(f.spawns(), 1);
  assert.equal(f.spawnOptions.at(-1)?.env?.RHYTHM_RELAY_BEARER, undefined);
  await f.service.stopGracefully();
});
