import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContext, runInContext, SourceTextModule, SyntheticModule } from 'node:vm';
import test from 'node:test';
import { createHermesSupervisor, hermesInstallDir, HERMES_INSTALL_COMMAND } from '../src/hermes-server.mjs';

const tick = () => new Promise((done) => setImmediate(done));
function fixture(t, options = {}) {
  const calls = [], snapshots = [], children = [], probes = [], logs = [];
  const spawn = (binary, args, settings) => {
    const child = Object.assign(new EventEmitter(), { pid: 200 + children.length, stdout: new EventEmitter(), stderr: new EventEmitter(), signals: [] });
    child.finish = (code = 0) => { child.exitCode = code; child.emit('exit', code); child.emit('close', code); };
    child.kill = (signal) => { child.signals.push(signal); if (options.graceful !== false || signal === 'SIGKILL') child.finish(); return true; };
    calls.push({ binary, args, settings }); children.push(child);
    queueMicrotask(() => {
      if (args[0] === '--version') { child.stdout.emit('data', 'Hermes 0.test\nsecond line\n'); child.finish(); }
      else if (binary === '/bin/zsh') { child.stdout.emit('data', args[2] === HERMES_INSTALL_COMMAND ? 'install output\n' : `${options.binaryPath ?? '/fixture/hermes'}\n`); child.stderr.emit('data', 'installer stderr\n'); child.finish(options.installExit ?? 0); }
      else options.onServe?.(child, settings.env.HERMES_DASHBOARD_SESSION_TOKEN);
    });
    return child;
  };
  const supervisor = createHermesSupervisor({
    env: {}, spawn, resolveBinary: async () => '/fixture/hermes',
    checkPort: async (port) => { probes.push(port); return true; },
    fetch: async () => ({ status: 200 }), hasBuiltWeb: () => false,
    log: (text) => logs.push(text),
    graceMs: 10, readyTimeoutMs: 70, pollMs: 2, commandTimeoutMs: 100,
    ...options,
  });
  supervisor.onStatus((status) => snapshots.push(status));
  t.after(() => supervisor.stop());
  return { supervisor, calls, snapshots, children, probes, logs };
}

test('Hermes disabled means no binary lookup, fetch, consent, or spawn for any operation', async (t) => {
  const nope = () => { assert.fail('disabled side effect'); };
  const f = fixture(t, { env: { RHYTHM_HERMES_ENABLED: '0' }, resolveBinary: nope, fetch: nope, showConsent: nope });
  for (const action of ['start', 'install', 'restart']) assert.deepEqual(await f.supervisor[action](), { state: 'disabled', port: 9121, url: 'http://127.0.0.1:9121' });
  await f.supervisor.stop();
  assert.equal(f.supervisor.getStatus().state, 'disabled'); assert.deepEqual(f.calls, []);
});

test('Hermes absent binary reports absent without spawning', async (t) => {
  const f = fixture(t, { resolveBinary: async () => null });
  assert.equal((await f.supervisor.start()).state, 'absent');
  assert.deepEqual(f.calls, []);
});

for (const built of [false, true]) test(`issue-1542-c1: Hermes uses exact pinned dashboard arguments, built dist=${built}`, async (t) => {
  const f = fixture(t, { hasBuiltWeb: () => built });
  const status = await f.supervisor.start();
  assert.deepEqual(status, { state: 'ready', port: 9121, url: 'http://127.0.0.1:9121', pid: 201, version: 'Hermes 0.test', binaryPath: '/fixture/hermes' });
  assert.deepEqual(f.calls.map(({ binary, args }) => ({ binary, args })), [
    { binary: '/fixture/hermes', args: ['--version'] },
    { binary: '/fixture/hermes', args: ['dashboard', '--port', '9121', '--host', '127.0.0.1', '--no-open', ...(built ? ['--skip-build'] : [])] },
  ]);
  assert.deepEqual(f.probes, [9121]);
  assert.deepEqual(f.calls[1].settings.stdio, ['ignore', 'pipe', 'pipe']);
});

for (const code of [200, 302, 401, 403, 404, 503]) test(`issue-1542-c4: Hermes health HTTP ${code} is listening without redirect following`, async (t) => {
  const f = fixture(t, { fetch: async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:9122/api/health'); assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'manual');
    return { status: code };
  }, env: { RHYTHM_HERMES_PORT: '9122' } });
  assert.equal((await f.supervisor.start()).state, 'ready');
});

test('issue-1542-c3: Hermes mints a main-only token per child and redacts it from diagnostics', async (t) => {
  const f = fixture(t, {
    onServe: (child, token) => {
      child.stdout.emit('data', `dashboard token ${token}\n`);
      child.stderr.emit('data', `raw ${token}\nHERMES_DASHBOARD_SESSION_TOKEN=${token}\n`);
    },
  });
  const first = await f.supervisor.start();
  const firstToken = f.calls[1].settings.env.HERMES_DASHBOARD_SESSION_TOKEN;
  assert.match(firstToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(f.supervisor.getSessionToken(), firstToken);
  assert.equal(Object.hasOwn(f.calls[0].settings.env, 'HERMES_DASHBOARD_SESSION_TOKEN'), false, 'metadata command must not receive the token');
  assert.doesNotMatch(JSON.stringify(first), new RegExp(firstToken));
  assert.doesNotMatch(f.logs.join('\n'), new RegExp(firstToken));
  f.children[1].finish(7);
  assert.equal(f.supervisor.getSessionToken(), undefined);
  assert.doesNotMatch(JSON.stringify(f.supervisor.getStatus()), new RegExp(firstToken));
  const restarted = await f.supervisor.restart();
  const secondToken = f.calls[3].settings.env.HERMES_DASHBOARD_SESSION_TOKEN;
  assert.match(secondToken, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(secondToken, firstToken);
  assert.equal(f.supervisor.getSessionToken(), secondToken);
  assert.doesNotMatch(JSON.stringify(restarted), new RegExp(secondToken));
});

test('Hermes busy port fails exactly, with no adoption, roaming, or signaling', async (t) => {
  const f = fixture(t, { checkPort: async (port) => { assert.equal(port, 9121); return false; } });
  assert.equal((await f.supervisor.start()).reason, 'port-in-use');
  assert.equal(f.supervisor.getStatus().state, 'failed');
  await f.supervisor.stop(); assert.deepEqual(f.calls, []);
});

for (const port of ['0', '9119', '-1', 'no', '65536']) test(`Hermes rejects unsafe port ${port}`, async (t) => {
  const f = fixture(t, { env: { RHYTHM_HERMES_PORT: port } });
  assert.equal((await f.supervisor.start()).reason, 'invalid-port'); assert.deepEqual(f.calls, []);
});

for (const graceful of [true, false]) test(`Hermes stops only its child, graceful=${graceful}`, async (t) => {
  const f = fixture(t, { graceful, graceMs: 15 });
  await f.supervisor.start();
  const began = Date.now();
  await Promise.all([f.supervisor.stop(), f.supervisor.stop()]);
  assert.deepEqual(f.children[1].signals, graceful ? ['SIGTERM'] : ['SIGTERM', 'SIGKILL']);
  if (!graceful) assert.ok(Date.now() - began >= 14, 'SIGKILL must wait for the grace period');
  assert.deepEqual(f.children[0].signals, []);
  assert.deepEqual(f.supervisor.getStatus(), { state: 'stopped', port: 9121, url: 'http://127.0.0.1:9121' });
});

test('Hermes start is idempotent and subscriptions can unsubscribe', async (t) => {
  const f = fixture(t);
  const received = []; const off = f.supervisor.onStatus((s) => received.push(s));
  await Promise.all([f.supervisor.start(), f.supervisor.start()]);
  await f.supervisor.start();
  assert.equal(f.calls.length, 2); assert.equal(received.at(-1).state, 'ready');
  const count = received.length; off(); await f.supervisor.stop(); assert.equal(received.length, count);
  const copy = f.supervisor.getStatus(); copy.state = 'failed'; assert.equal(f.supervisor.getStatus().state, 'stopped');
});

test('Hermes timeout kills owned child and publishes the last 50 stderr lines, redacted', async (t) => {
  const f = fixture(t, {
    fetch: async () => { throw new Error('not listening'); },
    onServe: (child) => child.stderr.emit('data', Array.from({ length: 60 }, (_, i) => `line-${i}`).join('\n') + '\nAuthorization: Bearer secret-value\n'),
  });
  const status = await f.supervisor.start();
  assert.equal(status.state, 'failed'); assert.match(status.reason, /^readiness-timeout\nline-11\n/);
  assert.equal(status.reason.split('\n').length, 51); assert.match(status.reason, /line-59/);
  assert.doesNotMatch(status.reason, /secret-value/); assert.deepEqual(f.children[1].signals, ['SIGTERM']);
  assert.equal(status.pid, undefined);
});

test('Hermes stop during binary resolution prevents a late spawn', async (t) => {
  let resolve; const f = fixture(t, { resolveBinary: () => new Promise((done) => { resolve = done; }) });
  const pending = f.supervisor.start(); await f.supervisor.stop(); resolve('/fixture/hermes');
  assert.equal((await pending).state, 'stopped'); assert.deepEqual(f.calls, []);
});

test('Hermes stop during readiness cannot publish late ready', async (t) => {
  let respond; const f = fixture(t, { fetch: () => new Promise((done) => { respond = done; }) });
  const pending = f.supervisor.start(); await tick(); await f.supervisor.stop(); respond({ status: 200 });
  assert.equal((await pending).state, 'stopped'); assert.equal(f.snapshots.some((s) => s.state === 'ready'), false);
});

test('Hermes unexpected exit fails and restart replaces only the owned child', async (t) => {
  const f = fixture(t); await f.supervisor.start(); f.children[1].finish(7);
  assert.equal(f.supervisor.getStatus().reason, 'process-exited-7');
  const [a, b] = await Promise.all([f.supervisor.restart(), f.supervisor.restart()]);
  assert.equal(a.state, 'ready'); assert.equal(a.pid, b.pid); assert.notEqual(a.pid, 201);
  assert.equal(f.calls.length, 4); assert.deepEqual(f.children[1].signals, []);
});

test('Hermes async spawn errors settle as failed', async (t) => {
  const f = fixture(t, { onServe: (child) => { child.pid = undefined; child.emit('error', new Error('ENOENT')); child.emit('close', -2); } });
  assert.equal((await f.supervisor.start()).reason, 'spawn-failed');
  assert.equal(f.supervisor.getSessionToken(), undefined);
});

test('Hermes install defaults to cancellation and shows the literal official command', async (t) => {
  const f = fixture(t, { showConsent: async (options) => {
    assert.equal(options.defaultId, 0); assert.equal(options.cancelId, 0); assert.equal(options.buttons[0], 'Cancel');
    assert.ok(options.detail.includes(HERMES_INSTALL_COMMAND)); return { response: 0 };
  } });
  assert.equal((await f.supervisor.install()).state, 'stopped'); assert.deepEqual(f.calls, []);
  const noDialog = fixture(t); await noDialog.supervisor.install(); assert.deepEqual(noDialog.calls, []);
});

test('Hermes consent runs bootstrap in login shell, streams private log, re-resolves, then starts', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'rhythm-hermes-test-')); t.after(() => rm(directory, { recursive: true, force: true }));
  let resolutions = 0;
  const f = fixture(t, { installLogPath: join(directory, 'hermes-install.log'), showConsent: async () => ({ response: 1 }), resolveBinary: async () => { resolutions++; return resolutions === 1 ? null : '/fixture/hermes'; } });
  assert.equal((await f.supervisor.start()).state, 'absent');
  assert.equal((await f.supervisor.install()).state, 'ready'); assert.equal(resolutions, 2);
  assert.deepEqual(f.calls[0].args, ['-l', '-c', HERMES_INSTALL_COMMAND]); assert.equal(f.calls[0].binary, '/bin/zsh');
  const path = join(directory, 'hermes-install.log');
  assert.equal(await readFile(path, 'utf8'), 'install output\ninstaller stderr\n');
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test('Hermes quitting while native consent is open cancels the install', async (t) => {
  let consent; const f = fixture(t, { showConsent: () => new Promise((done) => { consent = done; }) });
  const pending = f.supervisor.install(); await f.supervisor.stop(); consent({ response: 1 });
  assert.equal((await pending).state, 'stopped'); assert.deepEqual(f.calls, []);
});

test('issue-1542-c2: Hermes skip-build checks hermes_cli/web_dist and ignores legacy web/dist', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'rhythm-hermes-path-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'custom-install');
  await mkdir(join(root, 'hermes_cli'), { recursive: true }); await mkdir(join(root, 'venv/bin'), { recursive: true });
  await mkdir(join(root, 'hermes_cli/web_dist'), { recursive: true }); await writeFile(join(root, 'hermes_cli/web_dist/index.html'), 'built');
  const binary = join(root, 'venv/bin/hermes'); await writeFile(binary, '#!/usr/bin/python3\n');
  await mkdir(join(directory, '.local/bin'), { recursive: true });
  const wrapper = join(directory, '.local/bin/hermes'); await writeFile(wrapper, `#!/bin/bash\nexec "${binary}" "$@"\n`);
  assert.equal(hermesInstallDir(wrapper, directory), await realpath(root));
  const link = join(directory, 'linked-hermes'); await symlink(binary, link); assert.equal(hermesInstallDir(link, directory), await realpath(root));
  for (const binaryPath of [wrapper, '/does-not-exist/hermes']) {
    const f = fixture(t, { env: { HOME: directory }, resolveBinary: undefined, binaryPath, hasBuiltWeb: undefined });
    const status = await f.supervisor.start();
    assert.equal(status.binaryPath, wrapper); assert.equal(status.state, 'ready');
    assert.deepEqual(f.calls[0].args, ['-l', '-c', 'command -v hermes']);
    assert.equal(f.calls.at(-1).args.at(-1), '--skip-build');
  }
  await rm(join(root, 'hermes_cli/web_dist/index.html'));
  await mkdir(join(root, 'web/dist'), { recursive: true }); await writeFile(join(root, 'web/dist/index.html'), 'legacy');
  const legacy = fixture(t, { env: { HOME: directory }, resolveBinary: undefined, binaryPath: wrapper, hasBuiltWeb: undefined });
  assert.equal((await legacy.supervisor.start()).state, 'ready');
  assert.equal(legacy.calls.at(-1).args.includes('--skip-build'), false);
});

test('issue-1542-c5: Hermes contract records one coherent dashboard, token, readiness, and view contract', async () => {
  const contract = await readFile(new URL('../../../docs/ai/contracts/hermes-electron-contract.md', import.meta.url), 'utf8');
  assert.match(contract, /hermes dashboard --port <port> --host 127\.0\.0\.1 --no-open/);
  assert.match(contract, /hermes_cli\/web_dist\/index\.html/);
  assert.match(contract, /HERMES_DASHBOARD_SESSION_TOKEN/);
  assert.match(contract, /getSessionToken\(\)/);
  assert.match(contract, /GET .*\/api\/health/);
  assert.equal(contract.match(/^## View \+ intents$/gm)?.length, 1);
  assert.doesNotMatch(contract, /Launch is exactly `hermes serve/);
});

// Execute the actual preload with only Electron's host boundary replaced.
for (const flag of [undefined, '0', '1']) test(`Hermes frozen preload surface and unsubscribe, flag=${flag}`, async () => {
  const events = new EventEmitter(), calls = []; let bridge;
  const context = createContext({
    require: () => ({ contextBridge: { exposeInMainWorld: (_key, value) => { bridge = value; } }, ipcRenderer: {
      sendSync() {}, on: (...args) => events.on(...args), removeListener: (...args) => events.removeListener(...args),
      invoke: (channel, ...args) => { calls.push([channel, ...args]); return Promise.resolve({ state: 'disabled' }); },
    } }),
    process: { argv: [], env: { RHYTHM_HERMES_ENABLED: flag }, platform: 'darwin' }, window: { addEventListener() {} },
  });
  runInContext(await readFile(new URL('../src/preload.cjs', import.meta.url), 'utf8'), context);
  assert.equal(Object.isFrozen(bridge.hermes), true); assert.equal(bridge.hermes.enabled, flag !== '0');
  assert.deepEqual(Object.keys(bridge.hermes), ['enabled', 'getStatus', 'install', 'restart', 'onStatus']);
  await bridge.hermes.getStatus(); await bridge.hermes.install(); await bridge.hermes.restart();
  assert.deepEqual(calls, [['hermes:get-status'], ['hermes:install'], ['hermes:restart']]);
  const snapshots = []; const off = bridge.hermes.onStatus((status) => snapshots.push(status));
  events.emit('hermes:status', { secret: 'must not pass event' }, { state: 'ready' }); off();
  events.emit('hermes:status', {}, { state: 'failed' }); assert.deepEqual(snapshots, [{ state: 'ready' }]);
  assert.equal(events.listenerCount('hermes:status'), 0);
});

// Main-process wiring: real main module, fake Electron and lifecycle boundaries only.
async function mainFixture({ enabled = '1', argv = [] } = {}) {
  const calls = [], windows = [], handlers = new Map(), dialogs = []; let options, listener, releaseStop, boundSupervisor;
  let status = { state: enabled === '0' ? 'disabled' : 'stopped', port: 9121, url: 'http://127.0.0.1:9121' };
  const supervisor = {
    getStatus: () => status,
    getSessionToken: () => 'main-only-hermes-token',
    onStatus: (cb) => { listener = cb; },
    start: async () => { calls.push('start-hermes'); status = { ...status, state: 'ready' }; listener(status); return status; },
    install: async () => { calls.push('install-hermes'); return status; },
    restart: async () => { calls.push('restart-hermes'); return status; },
    stop: () => { calls.push('stop-hermes'); return new Promise((done) => { releaseStop = done; }); },
  };
  class Server { onStatusChange() {} async start() {} async stopGracefully() { calls.push('stop-agent'); } }
  class Window {
    static getAllWindows() { return windows; }
    constructor() {
      this.sent = [];
      this.webContents = Object.assign(new EventEmitter(), {
        send: (...args) => this.sent.push(args), isDestroyed: () => false, setWindowOpenHandler() {}, executeJavaScript: async () => {},
        mainFrame: { url: 'rhythm://app/index.html#/agents' },
      });
      windows.push(this);
    }
    isDestroyed() { return false; }
    async loadURL() { this.webContents.emit('did-finish-load'); }
  }
  const app = Object.assign(new EventEmitter(), {
    getPath: () => '/fixture', setPath() {}, requestSingleInstanceLock: () => true, isReady: () => false,
    whenReady: async () => {}, getVersion: () => 'test', quit: () => calls.push('quit'), exit() {},
  });
  const context = createContext({ process: Object.assign(new EventEmitter(), { argv, env: { RHYTHM_HERMES_ENABLED: enabled, RHYTHM_SHELL_USER_DATA: '/fixture' }, cwd: () => '/fixture', stderr: { write() {} } }), URL, Response, console });
  const file = new URL('../src/main.mjs', import.meta.url);
  const module = new SourceTextModule(await readFile(file, 'utf8'), { context, initializeImportMeta(meta) { meta.dirname = '/fixture'; } });
  await module.link(async (name) => {
    let values;
    if (name === 'electron') values = { app, BrowserWindow: Window, ipcMain: { on() {}, handle: (key, fn) => handlers.set(key, fn) }, net: {}, Notification: {}, protocol: { registerSchemesAsPrivileged() {}, handle() {} }, safeStorage: { isEncryptionAvailable: () => false }, session: { defaultSession: Object.assign(new EventEmitter(), { setPermissionRequestHandler() {} }) }, shell: {}, dialog: { showErrorBox() {}, showMessageBox: async (options) => { dialogs.push(options); return { response: 0 }; } } };
    else if (name === './agent-server.mjs') values = { AgentServerService: Server, AGENT_SERVER_BASE_URL: 'http://127.0.0.1:4001', AGENT_SERVER_ENGINE_PORT: 4096, electronDbPath: () => '/fixture/electron.db', legacyFlutterDbPath: () => '/fixture/legacy.db' };
    else if (name === './hermes-server.mjs') values = { createHermesSupervisor: (value) => { options = value; return supervisor; } };
    else if (name === './hermes-view.mjs') values = {
      registerHermesView: () => { calls.push('register-hermes-view'); },
      bindHermesViewSupervisor: (value) => { boundSupervisor = value; calls.push('bind-hermes-view'); },
    };
    else if (name === './production-api-config.mjs') values = { createProductionApiConfig: () => ({ load: () => 'https://example.invalid' }), createProductionApiSetHandler: () => () => {} };
    else { values = { ...await import(name.startsWith('.') ? new URL(name, file).href : name) }; if (name === 'node:fs') values.existsSync = () => true; }
    return new SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
  });
  await module.evaluate(); await tick();
  const event = { sender: windows[0].webContents, senderFrame: windows[0].webContents.mainFrame };
  return { calls, windows, handlers, app, options, dialogs, event, publish: (value) => listener(value), extraWindow: () => new Window(), release: () => releaseStop(), boundSupervisor: () => boundSupervisor, supervisor };
}

test('issue-1542-c7: Hermes main binds the native supervisor, authorizes IPC, broadcasts status, and awaits shutdown', async () => {
  const f = await mainFixture();
  assert.equal(f.boundSupervisor(), f.supervisor);
  assert.equal(f.boundSupervisor().getSessionToken(), 'main-only-hermes-token');
  assert.deepEqual(f.calls, ['register-hermes-view', 'bind-hermes-view', 'start-hermes']);
  assert.equal(f.options.installLogPath, '/fixture/hermes-install.log');
  for (const channel of ['hermes:get-status', 'hermes:install', 'hermes:restart']) {
    const handler = f.handlers.get(channel);
    assert.throws(() => handler({ sender: {}, senderFrame: f.event.senderFrame }), /Privileged IPC denied/);
    assert.throws(() => handler({ sender: f.event.sender, senderFrame: { url: 'http://127.0.0.1:9121' } }), /Privileged IPC denied/);
    assert.throws(() => handler(f.event, { command: 'arbitrary' }), /Invalid IPC payload/);
    assert.equal((await handler(f.event)).state, 'ready');
  }
  const second = f.extraWindow(); const snapshot = { state: 'failed', port: 9121, url: 'http://127.0.0.1:9121', reason: 'port-in-use' };
  f.publish(snapshot);
  for (const window of f.windows) assert.deepEqual(window.sent.at(-1), ['hermes:status', snapshot]);
  second.webContents.isDestroyed = () => true;
  f.publish({ ...snapshot, state: 'stopped' }); assert.equal(second.sent.length, 1);
  const choice = { defaultId: 0, cancelId: 0, detail: HERMES_INSTALL_COMMAND };
  await f.options.showConsent(choice); assert.deepEqual(f.dialogs, [choice]);
  let prevented = false; f.app.emit('before-quit', { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true); assert.ok(f.calls.includes('stop-agent')); assert.ok(f.calls.includes('stop-hermes')); assert.ok(!f.calls.includes('quit'));
  const installs = f.calls.filter((call) => call === 'install-hermes').length;
  await f.handlers.get('hermes:install')(f.event); assert.equal(f.calls.filter((call) => call === 'install-hermes').length, installs);
  f.release(); await tick(); assert.equal(f.calls.at(-1), 'quit');
});

test('Hermes main flag off does not start and returns disabled', async () => {
  const f = await mainFixture({ enabled: '0' });
  assert.ok(!f.calls.includes('start-hermes'));
  assert.equal(f.handlers.get('hermes:get-status')(f.event).state, 'disabled');
});

test('Hermes interactive smoke remains non-owning even for install/restart intents', async () => {
  const f = await mainFixture({ argv: ['--interactive-smoke'] });
  assert.deepEqual(f.calls, ['register-hermes-view', 'bind-hermes-view']);
  for (const channel of ['hermes:get-status', 'hermes:install', 'hermes:restart']) assert.equal((await f.handlers.get(channel)(f.event)).state, 'stopped');
  f.app.emit('before-quit', { preventDefault: () => assert.fail('non-owning smoke must not delay quit') });
  assert.deepEqual(f.calls, ['register-hermes-view', 'bind-hermes-view']);
});

test('Hermes failed installer does not start a server and retains output', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'rhythm-hermes-failed-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const f = fixture(t, { installExit: 9, installLogPath: join(directory, 'hermes-install.log'), showConsent: async () => ({ response: 1 }) });
  assert.equal((await f.supervisor.install()).reason, 'install-failed');
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].args[2], HERMES_INSTALL_COMMAND);
  assert.equal(await readFile(join(directory, 'hermes-install.log'), 'utf8'), 'install output\ninstaller stderr\n');
});

test('Hermes detects a port conflict reported after the preflight race', async (t) => {
  const f = fixture(t, { onServe: (child) => { child.stderr.emit('data', 'Address already in use\n'); child.finish(1); } });
  assert.equal((await f.supervisor.start()).reason, 'port-in-use');
  assert.equal(f.snapshots.some((s) => s.state === 'ready'), false);
});
