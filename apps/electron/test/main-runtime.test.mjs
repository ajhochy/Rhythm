import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import test from 'node:test';

test('e11-c6: main catches rejected start and publishes current/changed failure through existing bridge', async () => {
  const handlers = new Map(), sent = [], dialogs = [];
  let service;
  class Server {
    constructor() { service = this; this.status = { status: 'starting' }; }
    onStatusChange(fn) { this.listener = fn; }
    async start() { throw new Error('filesystem rejected'); }
    reportStartupFailure() { this.status = { status: 'failed', failureReason: 'startupFailed', errorMessage: 'Reopen Rhythm to retry.' }; this.listener(this.status); }
  }
  const app = Object.assign(new EventEmitter(), {
    getPath: () => '/fixture', requestSingleInstanceLock: () => true, isReady: () => false,
    whenReady: async () => {}, getVersion: () => 'test', quit() {}, exit() {},
  });
  const contents = Object.assign(new EventEmitter(), { send: (...args) => sent.push(args), setWindowOpenHandler() {}, executeJavaScript: async () => {} });
  class Window { constructor() { this.webContents = contents; } isDestroyed() { return false; } async loadURL() { contents.emit('did-finish-load'); } }
  const context = createContext({ process: Object.assign(new EventEmitter(), { argv: [], env: {}, cwd: () => '/fixture', stderr: { write() {} } }), URL, Response, console });
  const file = new URL('../src/main.mjs', import.meta.url);
  const module = new SourceTextModule(await readFile(file, 'utf8'), { context, initializeImportMeta(meta) { meta.dirname = '/fixture'; } });
  await module.link(async (name) => {
    let values;
    if (name === 'electron') values = { app, BrowserWindow: Window, ipcMain: { on() {}, handle: (key, fn) => handlers.set(key, fn) }, net: {}, Notification: {}, protocol: { registerSchemesAsPrivileged() {}, handle() {} }, safeStorage: { isEncryptionAvailable: () => false }, session: { defaultSession: Object.assign(new EventEmitter(), { setPermissionRequestHandler() {} }) }, shell: {}, dialog: { showErrorBox: (...args) => dialogs.push(args), showMessageBox: async (options) => { dialogs.push([options.title, options.message, options.buttons]); return { response: 1 }; } } };
    else if (name === './agent-server.mjs') values = { AgentServerService: Server, AGENT_SERVER_BASE_URL: 'http://127.0.0.1:4001', AGENT_SERVER_ENGINE_PORT: 4096, electronDbPath: () => '/fixture/electron.db', legacyFlutterDbPath: () => '/fixture/legacy.db' };
    else if (name === './hermes-server.mjs') values = { createHermesSupervisor: () => ({ getStatus: () => ({ state: 'disabled', port: 9121, url: 'http://127.0.0.1:9121' }), onStatus() {}, async start() {}, async stop() {} }) };
    else if (name === './production-api-config.mjs') values = { createProductionApiConfig: () => ({ load: () => 'https://example.invalid' }), createProductionApiSetHandler: () => () => {} };
    else { values = { ...await import(name.startsWith('.') ? new URL(name, file).href : name) }; if (name === 'node:fs') values.existsSync = () => true; }
    return new SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
  });
  // Catch the old fire-and-forget rejection as evidence, without crashing the test runner.
  // A source assertion first prevents executing that known unsafe path in RED.
  assert.match(await readFile(file, 'utf8'), /agentServer\.start\(\)\.catch/);
  await module.evaluate();
  await new Promise((r) => setImmediate(r));
  assert.equal(handlers.get('rhythm:agent-server:status')().failureReason, 'startupFailed');
  assert.ok(sent.some(([channel, snapshot]) => channel === 'rhythm:agent-server:status-changed' && snapshot.failureReason === 'startupFailed'));
  service.listener(service.status);
  assert.ok(dialogs.some(([, message, buttons]) => /Reopen/.test(message) && buttons?.join(',') === 'Retry,Close'), 'failure must be visible with a retry action');
});

const tick = () => new Promise((done) => setImmediate(done));

// Execute the real main module while replacing only Electron, process, and child-service boundaries.
// This catches ownership regressions without opening a socket or launching Electron/Hermes.
async function hermesRuntimeFixture({ argv = ['--interactive-smoke'], enabled = '1' } = {}) {
  const calls = [], stdout = [], handlers = new Map(), windows = [];
  let listener, options, releaseStop;
  let status = { state: enabled === '0' ? 'disabled' : 'stopped', port: 9121, url: 'http://127.0.0.1:9121' };
  const supervisor = {
    getStatus: () => status,
    getSessionToken: () => 'fixture-token',
    onStatus: (callback) => { listener = callback; },
    start: async () => {
      calls.push('start-hermes');
      options.log('hermes child output');
      for (const state of ['starting', 'ready']) {
        status = { ...status, state };
        listener(status);
      }
      return status;
    },
    install: async () => { if (enabled !== '0') calls.push('install-hermes'); return status; },
    restart: async () => { if (enabled !== '0') calls.push('restart-hermes'); return status; },
    stop: () => {
      calls.push('stop-hermes');
      return new Promise((resolve) => { releaseStop = resolve; });
    },
  };
  class Server {
    constructor() { calls.push('construct-agent'); this.status = { status: 'stopped' }; }
    onStatusChange() {}
    async start() { calls.push('start-agent'); }
    async stopGracefully() { calls.push('stop-agent'); }
  }
  class Window {
    static getAllWindows() { return windows; }
    constructor() {
      this.webContents = Object.assign(new EventEmitter(), {
        mainFrame: { url: 'rhythm://app/index.html#/agents' },
        send() {}, isDestroyed: () => false, setWindowOpenHandler() {}, executeJavaScript: async () => {},
      });
      windows.push(this);
    }
    isDestroyed() { return false; }
    async loadURL() { this.webContents.emit('did-finish-load'); }
  }
  const app = Object.assign(new EventEmitter(), {
    getPath: () => '/fixture', setPath() {}, requestSingleInstanceLock: () => true, isReady: () => false,
    whenReady: async () => {}, getVersion: () => 'test', quit: () => calls.push('quit'), exit: (code) => calls.push(['exit', code]),
  });
  const processBoundary = Object.assign(new EventEmitter(), {
    argv,
    env: { RHYTHM_HERMES_ENABLED: enabled, RHYTHM_SHELL_USER_DATA: '/fixture' },
    cwd: () => '/fixture',
    stdout: { write: (text) => stdout.push(String(text)) },
    stderr: { write: (text) => calls.push(['stderr', String(text)]) },
    exit: (code) => calls.push(['process-exit', code]),
  });
  const file = new URL('../src/main.mjs', import.meta.url);
  const context = createContext({ process: processBoundary, URL, Response, console });
  const module = new SourceTextModule(await readFile(file, 'utf8'), { context, initializeImportMeta(meta) { meta.dirname = '/fixture'; } });
  await module.link(async (name) => {
    let values;
    if (name === 'electron') values = { app, BrowserWindow: Window, ipcMain: { on() {}, handle: (key, fn) => handlers.set(key, fn) }, net: {}, Notification: {}, protocol: { registerSchemesAsPrivileged() {}, handle() {} }, safeStorage: { isEncryptionAvailable: () => false }, session: { defaultSession: Object.assign(new EventEmitter(), { setPermissionRequestHandler() {} }) }, shell: {}, dialog: { showErrorBox() {}, showMessageBox: async () => ({ response: 1 }) } };
    else if (name === './agent-server.mjs') values = { AgentServerService: Server, AGENT_SERVER_BASE_URL: 'http://127.0.0.1:4001', AGENT_SERVER_ENGINE_PORT: 4096, electronDbPath: () => '/fixture/electron.db', legacyFlutterDbPath: () => '/fixture/legacy.db' };
    else if (name === './hermes-server.mjs') values = { createHermesSupervisor: (value) => { options = value; return supervisor; } };
    else if (name === './hermes-view.mjs') values = { registerHermesView() { return { disposeCurrent: async () => {}, dispose: async () => {} }; }, bindHermesViewSupervisor() {} };
    else if (name === './production-api-config.mjs') values = { createProductionApiConfig: () => ({ load: () => 'https://example.invalid' }), createProductionApiSetHandler: () => () => {} };
    else { values = { ...await import(name.startsWith('.') ? new URL(name, file).href : name) }; if (name === 'node:fs') values.existsSync = () => true; }
    return new SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
  });
  await module.evaluate();
  await tick();
  await tick();
  const event = windows[0] ? { sender: windows[0].webContents, senderFrame: windows[0].webContents.mainFrame } : undefined;
  return {
    app, calls, event, handlers, options, processBoundary, stdout, supervisor,
    publish: (snapshot) => listener(snapshot),
    release: () => releaseStop?.(),
  };
}

test('issue-1542-desktop-c5: feature flag never starts the retired dashboard sidecar', async () => {
  const attached = await hermesRuntimeFixture();
  assert.ok(!attached.calls.includes('start-hermes'), 'Desktop host, not the shell, owns Hermes service discovery and startup');
  assert.ok(!attached.calls.includes('construct-agent'), 'attached mode must not take ownership of the Flutter runtime');
  await attached.handlers.get('hermes:install')(attached.event);
  await attached.handlers.get('hermes:restart')(attached.event);
  assert.ok(!attached.calls.includes('install-hermes'));
  assert.ok(!attached.calls.includes('restart-hermes'));
  let prevented = false;
  attached.app.emit('before-quit', { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.ok(attached.calls.includes('stop-hermes'));
  assert.ok(!attached.calls.includes('stop-agent'));
  attached.release();
  await tick();

  const disabled = await hermesRuntimeFixture({ enabled: '0' });
  assert.ok(!disabled.calls.includes('start-hermes'));
  assert.equal((await disabled.handlers.get('hermes:install')(disabled.event)).state, 'disabled');
  assert.equal((await disabled.handlers.get('hermes:restart')(disabled.event)).state, 'disabled');
  assert.ok(!disabled.calls.includes('install-hermes'));
  assert.ok(!disabled.calls.includes('restart-hermes'));

  for (const argv of [['--smoke'], ['--missing-dist']]) {
    const selfTest = await hermesRuntimeFixture({ argv });
    assert.ok(!selfTest.calls.includes('start-hermes'), argv.join(' '));
    assert.ok(!selfTest.calls.includes('stop-hermes'), argv.join(' '));
  }
});

test('Hermes supervisor output and lifecycle states reach the main-process stdout', async () => {
  const fixture = await hermesRuntimeFixture();
  fixture.publish({ state: 'failed', port: 9121, url: 'http://127.0.0.1:9121', reason: 'port-in-use' });
  assert.match(fixture.stdout.join(''), /hermes: failed port-in-use\n/);
});
