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
    if (name === 'electron') values = { app, BrowserWindow: Window, ipcMain: { on() {}, handle: (key, fn) => handlers.set(key, fn) }, net: {}, Notification: {}, protocol: { registerSchemesAsPrivileged() {}, handle() {} }, safeStorage: { isEncryptionAvailable: () => false }, session: { defaultSession: Object.assign(new EventEmitter(), { setPermissionRequestHandler() {} }) }, shell: {}, dialog: { showErrorBox: (...args) => dialogs.push(args), showMessageBox: async () => ({ response: 1 }) } };
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
  assert.ok(dialogs.some(([, message]) => /Reopen/.test(message)), 'failure must be visible without a web product page change');
});
