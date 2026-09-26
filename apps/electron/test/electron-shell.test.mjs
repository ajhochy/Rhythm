// Regression: a permissive asset resolver or preload bridge could expose files or Node APIs.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { createContext, runInNewContext, SourceTextModule, SyntheticModule } from 'node:vm';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import test from 'node:test';
import {
  AGENT_SERVER_KEYS, AUTH_KEYS, BRIDGE_KEYS, COLONY_VIEW_KEYS, GATEWAY_KEYS,
  HERMES_KEYS, HERMES_VIEW_KEYS, HUMAN_APPROVAL_KEYS, UPDATE_KEYS,
} from '../src/security-smoke-receipt.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const shellRoot = resolve(here, '..');
const electron = resolve(shellRoot, 'node_modules/.bin/electron');
let smokeResult;

// Execute the real main module; replace only host boundaries, never its flag/lifecycle logic.
// No Electron child, network, screenshot writes, timers, or real runtime ownership in this check.
async function interactiveRuntime(argv, userData = '/fixture/interactive-user-data', selectDirectory = async () => ({ canceled: true, filePaths: [] }), autoQuit = true) {
  const calls = [], windows = [], handlers = new Map(), paths = new Map();
  const processBoundary = Object.assign(new EventEmitter(), {
    argv, env: { RHYTHM_LIVE_API_URL: 'http://127.0.0.1:4098', RHYTHM_LIVE_ENGINE_URL: 'http://127.0.0.1:4097', ...(userData ? { RHYTHM_SHELL_USER_DATA: userData } : {}) },
    cwd: () => '/fixture', stderr: { write: (message) => calls.push(message) },
  });
  const app = Object.assign(new EventEmitter(), {
    isPackaged: true, setPath: (key, value) => paths.set(key, value), getPath: (key) => paths.get(key) ?? '/default-user-data',
    requestSingleInstanceLock: () => { calls.push(['lock', paths.get('userData')]); return true; },
    isReady: () => false, whenReady: async () => {}, getVersion: () => 'test',
    quit: () => calls.push('quit'), exit: (code) => calls.push(['exit', code]),
  });
  class Server {
    constructor() { calls.push('construct'); this.status = { status: 'stopped' }; }
    onStatusChange() { calls.push('subscribe'); }
    async start() { calls.push('start'); }
    async restart() { calls.push('restart-agent'); return { ok: true }; }
    async stopGracefully() { calls.push('stop'); }
    async stopForQuit() { calls.push('stop'); }
  }
  class Window {
    constructor(options) {
      this.options = options; windows.push(this);
      this.webContents = Object.assign(new EventEmitter(), { mainFrame: { url: 'rhythm://app/index.html#/agents' }, isDestroyed: () => false, send() {}, setWindowOpenHandler() {}, executeJavaScript: async () => {} });
    }
    static fromWebContents(contents) { return windows.find((window) => window.webContents === contents) ?? null; }
    isDestroyed() { return false; }
    async loadURL(url) { this.url = url; this.webContents.emit('did-finish-load'); }
  }
  const file = new URL('../src/main.mjs', import.meta.url);
  const context = createContext({ process: processBoundary, URL, Response, console });
  const module = new SourceTextModule(await readFile(file, 'utf8'), { context, initializeImportMeta(meta) { meta.dirname = '/fixture'; } });
  await module.link(async (name) => {
    let values;
    if (name === 'electron') values = { app, BrowserWindow: Window, ipcMain: { on() {}, handle: (key, fn) => handlers.set(key, fn) }, net: {}, Notification: {}, protocol: { registerSchemesAsPrivileged() {}, handle() {} }, safeStorage: { isEncryptionAvailable: () => false }, session: { defaultSession: Object.assign(new EventEmitter(), { setPermissionRequestHandler() {} }) }, shell: {}, dialog: { showOpenDialog: selectDirectory, showErrorBox: () => calls.push('ownership-error'), showMessageBox: async () => { calls.push('migration'); return { response: 1 }; } } };
    else if (name === './agent-server.mjs') values = { AgentServerService: Server, AGENT_SERVER_BASE_URL: 'http://127.0.0.1:4001', AGENT_SERVER_ENGINE_PORT: 4096, electronDbPath: () => '/fixture/electron.db', legacyFlutterDbPath: () => '/fixture/legacy.db' };
    else if (name === './hermes-server.mjs') values = { createHermesSupervisor: () => ({ getStatus: () => ({ state: 'disabled', port: 9121, url: 'http://127.0.0.1:9121' }), onStatus() {}, async start() {}, async stop() {} }) };
    else if (name === './production-api-config.mjs') values = { createProductionApiConfig: () => ({ load: () => 'https://example.invalid' }), createProductionApiSetHandler: () => () => {} };
    else { values = { ...await import(name.startsWith('.') ? new URL(name, file).href : name) }; if (name === 'node:fs') values.existsSync = (path) => path !== '/fixture/electron.db'; }
    return new SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
  });
  await module.evaluate();
  await new Promise((done) => setImmediate(done));
  if (autoQuit) {
    app.emit('before-quit', { preventDefault: () => calls.push('prevent-quit') });
    await new Promise((done) => setImmediate(done));
  }
  return { app, calls, windows, handlers, paths, processBoundary };
}

test('interactive-runtime-c1: interactive smoke keeps the visible normal route', async () => {
  const result = await interactiveRuntime(['--interactive-smoke', '--allow-test-runtime-ports']);
  assert.deepEqual(result.calls[0], ['lock', '/fixture/interactive-user-data']);
  assert.ok(result.calls.includes('prevent-quit'));
  assert.ok(result.calls.includes('quit'));
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].options.show, true);
  assert.equal(result.windows[0].url, 'rhythm://app/index.html#/agents');
});

test('interactive-runtime-c2: interactive smoke leaves the external runtime unowned while Hermes has shutdown hooks', async () => {
  const result = await interactiveRuntime(['--interactive-smoke', '--allow-test-runtime-ports']);
  assert.deepEqual(result.calls[0], ['lock', '/fixture/interactive-user-data']);
  assert.ok(!result.calls.includes('construct'));
  assert.ok(!result.calls.includes('start'));
  assert.ok(!result.calls.includes('stop'));
  assert.ok(result.calls.includes('prevent-quit'));
  assert.ok(result.calls.includes('quit'));
  assert.equal(result.processBoundary.listenerCount('SIGINT'), 1);
  assert.equal(result.processBoundary.listenerCount('SIGTERM'), 1);
  assert.equal(result.handlers.get('rhythm:agent-server:status')().status, 'stopped');
});

test('interactive-runtime-c3: explicit userData required before lock; alternate ports need both flags', async () => {
  await assert.rejects(interactiveRuntime(['--interactive-smoke', '--allow-test-runtime-ports'], ''), /RHYTHM_SHELL_USER_DATA/);
  await assert.rejects(interactiveRuntime(['--interactive-smoke', '--allow-test-runtime-ports'], 'relative-path'), /RHYTHM_SHELL_USER_DATA/);
  for (const argv of [[], ['--allow-test-runtime-ports'], ['--interactive-smoke'], ['--interactive-smoke', '--allow-test-runtime-ports'], ['--smoke'], ['--smoke', '--allow-test-runtime-ports']]) {
    const result = await interactiveRuntime(argv);
    const override = argv.includes('--allow-test-runtime-ports') && (argv.includes('--interactive-smoke') || argv.includes('--smoke'));
    assert.equal(result.processBoundary.env.RHYTHM_LIVE_API_URL, `http://127.0.0.1:${override ? 4098 : 4001}`, argv.join(' '));
    assert.equal(result.processBoundary.env.RHYTHM_LIVE_ENGINE_URL, `http://127.0.0.1:${override ? 4097 : 4096}`, argv.join(' '));
  }
});

test('interactive-runtime-c4: production still owns lifecycle; automated smoke stays hidden and unowned', async () => {
  const production = await interactiveRuntime([]);
  for (const call of ['construct', 'subscribe', 'migration', 'start', 'stop', 'prevent-quit']) assert.ok(production.calls.includes(call), call);
  assert.equal(production.windows[0].options.show, true);
  assert.equal(production.processBoundary.listenerCount('SIGTERM'), 1);
  const smoke = await interactiveRuntime(['--smoke']);
  assert.equal(smoke.windows[0].options.show, false);
  for (const call of ['start', 'stop', 'migration', 'prevent-quit']) assert.ok(!smoke.calls.includes(call), call);
});

test('1555:electron-local-runtime-restart-ipc:5 preload exposes a frozen restart capability', async () => {
  let bridge;
  const calls = [];
  runInNewContext(await readFile(resolve(shellRoot, 'src/preload.cjs'), 'utf8'), {
    require(name) {
      assert.equal(name, 'electron');
      return {
        contextBridge: { exposeInMainWorld: (key, value) => { assert.equal(key, 'rhythmShell'); bridge = value; } },
        ipcRenderer: { on() {}, sendSync: () => 'https://example.invalid', invoke: async (...args) => { calls.push(args); return '/selected/project'; } },
      };
    },
    process: { argv: [], env: {}, platform: 'darwin' },
    window: { addEventListener() {} },
  });
  assert.deepEqual(Object.keys(bridge), BRIDGE_KEYS);
  assert.equal(Object.isFrozen(bridge), true);
  assert.deepEqual(Object.keys(bridge.agentServer), AGENT_SERVER_KEYS);
  assert.equal(Object.isFrozen(bridge.agentServer), true);
  assert.equal(await bridge.selectDirectory({ properties: ['openFile'] }), '/selected/project');
  assert.deepEqual(calls, [['shell:select-directory']]);
});

test('directory-picker: owned native dialog returns only the first path string or null', async () => {
  let response;
  const dialogs = [];
  const runtime = await interactiveRuntime(['--interactive-smoke'], undefined, async (owner, options) => {
    dialogs.push({ owner, options }); return response;
  });
  const owner = runtime.windows[0];
  const event = { sender: owner.webContents, senderFrame: owner.webContents.mainFrame };
  const handler = runtime.handlers.get('shell:select-directory');
  for (const [result, expected] of [
    [{ canceled: false, filePaths: ['/Users/AJ/Project with spaces', '/second'], bookmarks: ['never exposed'] }, '/Users/AJ/Project with spaces'],
    [{ canceled: true, filePaths: ['/discarded'] }, null],
    [{ canceled: false, filePaths: [] }, null],
    [{ canceled: false, filePaths: [''] }, null],
    [{ canceled: false, filePaths: [123] }, '123'],
  ]) {
    response = result;
    assert.equal(await handler(event), expected);
    assert.equal(dialogs.at(-1).owner, owner);
    assert.deepEqual(JSON.parse(JSON.stringify(dialogs.at(-1).options)), { properties: ['openDirectory', 'createDirectory'] });
  }
});

test('directory-picker: foreign senders, frames, hosts and payloads cannot open the dialog', async () => {
  let opened = 0;
  const runtime = await interactiveRuntime(['--interactive-smoke'], undefined, async () => { opened++; return { canceled: true, filePaths: [] }; });
  const owner = runtime.windows[0];
  const event = { sender: owner.webContents, senderFrame: owner.webContents.mainFrame };
  const handler = runtime.handlers.get('shell:select-directory');
  for (const invalid of [{ sender: {}, senderFrame: event.senderFrame }, { ...event, senderFrame: { url: event.senderFrame.url } }, { ...event, senderFrame: undefined }]) {
    await assert.rejects(handler(invalid), /denied/);
  }
  for (const url of ['https://example.invalid', 'rhythm://other/index.html', 'rhythm-artifact://app/index.html']) {
    event.senderFrame.url = url;
    await assert.rejects(handler(event), /denied/);
  }
  event.senderFrame.url = 'rhythm://app/index.html#/agents';
  await assert.rejects(handler(event, { properties: ['openFile'] }), /Invalid IPC payload/);
  owner.isDestroyed = () => true;
  await assert.rejects(handler(event), /owner unavailable/);
  assert.equal(opened, 0);
});

test('directory-picker: navigation during selection cannot receive a stale path', async () => {
  const runtime = await interactiveRuntime(['--interactive-smoke'], undefined, async (owner) => {
    owner.webContents.mainFrame.url = 'https://example.invalid';
    return { canceled: false, filePaths: ['/private/project'] };
  });
  const contents = runtime.windows[0].webContents;
  await assert.rejects(runtime.handlers.get('shell:select-directory')({ sender: contents, senderFrame: contents.mainFrame }), /denied/);
});

test('1555:electron-local-runtime-restart-ipc:5 restart IPC accepts only the owned document with no payload', async () => {
  const runtime = await interactiveRuntime([], undefined, undefined, false);
  const owner = runtime.windows[0];
  const event = { sender: owner.webContents, senderFrame: owner.webContents.mainFrame };
  const handler = runtime.handlers.get('rhythm:agent-server:restart');
  assert.equal(typeof handler, 'function');
  assert.deepEqual(await handler(event), { ok: true });
  assert.ok(runtime.calls.includes('restart-agent'));
  await assert.rejects(handler({ sender: {}, senderFrame: event.senderFrame }), /denied/);
  await assert.rejects(handler(event, { force: true }), /Invalid IPC payload/);
  runtime.app.emit('before-quit', { preventDefault() {} });
  await new Promise((done) => setImmediate(done));
});

test('slice-5-c1: resolves only files under the packaged web dist', async () => {
  const { resolveAsset } = await import('../src/policy.mjs');
  assert.equal(resolveAsset('/index.html'), resolve(shellRoot, '../web/dist/index.html'));
  assert.equal(resolveAsset('/../package.json'), null);
  assert.equal(resolveAsset('/missing.js'), null);
});

test('slice-5-c2: rejects unknown hosts, unsupported methods, and malformed protocol paths', async () => {
  const { validateRequest } = await import('../src/policy.mjs');
  assert.equal(validateRequest({ host: 'app', method: 'GET', pathname: '/index.html' }), true);
  for (const request of [
    { host: 'other', method: 'GET', pathname: '/index.html' },
    { host: 'app', method: 'POST', pathname: '/index.html' },
    { host: 'app', method: 'GET', pathname: '/%2e%2e/package.json' },
  ]) assert.equal(validateRequest(request), false);
});

test('slice-5-c3: actual Electron launch loads the local agents route', async () => {
  const result = await smoke();
  assert.equal(result.url, 'rhythm://app/index.html#/agents');
});

test('slice-5-c4: actual preload exposes only frozen versioned lifecycle, gateway configuration, Google auth, human-approval signing, and agent-server status', async () => {
  const result = await smoke();
  assert.deepEqual(result.runtime, { apiBase: 'http://127.0.0.1:4001', engineBase: 'http://127.0.0.1:4096', testOverride: false });
  assert.deepEqual(result.bridge.keys, BRIDGE_KEYS);
  assert.equal(result.bridge.frozen, true);
  assert.deepEqual(result.bridge.gateway.keys, GATEWAY_KEYS);
  assert.equal(result.bridge.gateway.frozen, true);
  assert.deepEqual(result.bridge.gateway.configured, {
    apiBase: true,
    engineBase: true,
    productionApiBase: true,
  });
  assert.deepEqual(result.bridge.gateway.values, {
    apiBase: 'http://127.0.0.1:4001',
    engineBase: 'http://127.0.0.1:4096',
  });
  assert.deepEqual(result.bridge.auth.keys, AUTH_KEYS);
  assert.equal(result.bridge.auth.frozen, true);
  // post-m1-p7-c4e: a narrow, purpose-built surface only — never an arbitrary-sign primitive.
  assert.deepEqual(result.bridge.humanApproval.keys, HUMAN_APPROVAL_KEYS);
  assert.equal(result.bridge.humanApproval.frozen, true);
  assert.deepEqual(result.bridge.agentServer.keys, AGENT_SERVER_KEYS);
  assert.equal(result.bridge.agentServer.frozen, true);
  assert.deepEqual(result.bridge.updates.keys, UPDATE_KEYS);
  assert.equal(result.bridge.updates.frozen, true);
  assert.deepEqual(result.bridge.hermes.keys, HERMES_KEYS);
  assert.equal(result.bridge.hermes.frozen, true);
  assert.deepEqual(result.bridge.hermesView.keys, HERMES_VIEW_KEYS);
  assert.equal(result.bridge.hermesView.frozen, true);
  assert.deepEqual(result.bridge.colonyView.keys, COLONY_VIEW_KEYS);
  assert.equal(result.bridge.colonyView.frozen, true);
  assert.equal(result.bridge.hermes.enabled, process.env.RHYTHM_HERMES_ENABLED !== '0');
  assert.equal(result.bridge.hermes.status.state, process.env.RHYTHM_HERMES_ENABLED === '0' ? 'disabled' : 'stopped');
  assert.equal(result.bridge.hermes.status.url, `http://127.0.0.1:${process.env.RHYTHM_HERMES_PORT ?? '9121'}`);
  assert.equal(result.bridge.nodeExposed, false);
});

test('production repair: alternate local ports require an explicit smoke-only flag', async () => {
  const userData = await mkdtemp(resolve(tmpdir(), 'rhythm-electron-test-ports-'));
  try {
    const output = await runElectron(['.', '--smoke', '--allow-test-runtime-ports'], userData);
    assert.equal(output.code, 0, output.stderr);
    assert.deepEqual(JSON.parse(output.stdout.trim()).runtime, {
      apiBase: 'http://127.0.0.1:4098',
      engineBase: 'http://127.0.0.1:4097',
      testOverride: true,
    });
  } finally {
    await rm(userData, { recursive: true, force: true });
  }
});

test('slice-5-c5: actual shell denies navigation, popups, permissions, and downloads', async () => {
  const result = await smoke();
  assert.deepEqual(result.denials, { navigation: true, popup: true, permission: true, download: true });
  const missing = await runElectron(['.', '--smoke', '--missing-dist']);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /requires built web assets/);
});

test('production repair: actual Electron artifact protocol authenticates and executes a sandboxed frame', async () => {
  const userData = await mkdtemp(resolve(tmpdir(), 'rhythm-electron-artifact-'));
  try {
    const output = await runElectron(['.', '--smoke', '--artifact-frame-smoke'], userData);
    assert.equal(output.code, 0, output.stderr);
    const receipt = JSON.parse(output.stdout.trim());
    assert.deepEqual(receipt.artifactFrame, {
      loaded: true,
      protocol: 'rhythm-artifact:',
      navigationBlocked: true,
      bridge: {
        n: 'smoke-nonce',
        id: 'smoke-request',
        ok: true,
        data: { operation: 'list_service_types', data: { marker: 'host-round-trip' } },
      },
      request: {
        url: 'https://api.vcrcapps.com/live-artifacts/00000000-0000-4000-8000-000000000801/render',
        authenticated: true,
      },
    });
  } finally {
    await rm(userData, { recursive: true, force: true });
  }
});

async function smoke() {
  if (smokeResult) return smokeResult;
  const userData = await mkdtemp(resolve(tmpdir(), 'rhythm-electron-shell-'));
  try {
    const output = await runElectron(['.', '--smoke'], userData);
    if (output.code !== 0) throw new Error(`smoke exited ${output.code}: ${output.stderr}`);
    smokeResult = JSON.parse(output.stdout.trim());
    return smokeResult;
  } finally {
    await rm(userData, { recursive: true, force: true });
  }
}

async function runElectron(args, userData, env = {}) {
  // Always redirect userData to a harness-owned temp dir, even for launches that throw before
  // will-quit (e.g. --missing-dist): the app's own cleanup never runs on those paths, and an
  // un-redirected launch would write to ~/Library/Application Support/rhythm-electron-shell.
  const owned = userData ?? (await mkdtemp(resolve(tmpdir(), 'rhythm-electron-smoke-')));
  try {
    return await spawnElectron(args, owned, env);
  } finally {
    if (!userData) await rm(owned, { recursive: true, force: true });
  }
}

function spawnElectron(args, userData, overrides = {}) {
  return new Promise((resolvePromise, reject) => {
      const child = spawn(electron, args, {
        cwd: shellRoot,
        env: {
          ...process.env,
          RHYTHM_LIVE_API_URL: 'http://127.0.0.1:4098',
          RHYTHM_LIVE_ENGINE_URL: 'http://127.0.0.1:4097',
          RHYTHM_PRODUCTION_API_URL: 'https://api.vcrcapps.com',
          ...overrides,
          ...(userData ? { RHYTHM_SHELL_USER_DATA: userData } : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (code) => resolvePromise({ code, stdout, stderr }));
    });
}
