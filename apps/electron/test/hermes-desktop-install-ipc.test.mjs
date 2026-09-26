// issue-1570-e: exercises the real 'hermes:update:install' IPC handler registered by main.mjs, and
// the real preload.cjs bridge that fronts it. The harness mirrors electron-shell.test.mjs's
// interactiveRuntime() (stubs only Electron itself plus the two runtimes with real process/network
// side effects; every other ./*.mjs import, including hermes-desktop-updates.mjs and
// hermes-view.mjs, is the real module) so the handler under test is the actual production code.
import assert from 'node:assert/strict';
import { createHash, sign } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContext, runInNewContext, SourceTextModule, SyntheticModule } from 'node:vm';
import test from 'node:test';

import { HERMES_VIEW_KEYS } from '../src/security-smoke-receipt.mjs';
import { TEST_UPDATE_PRIVATE_KEY } from './fixtures/hermes-desktop-test-keys.mjs';

const digest = (value) => `sha256-${createHash('sha256').update(value).digest('base64')}`;

async function interactiveRuntime(argv, userData, selectDirectory = async () => ({ canceled: true, filePaths: [] })) {
  const calls = [], windows = [], handlers = new Map(), paths = new Map();
  const processBoundary = Object.assign(new EventEmitter(), {
    argv, env: { RHYTHM_LIVE_API_URL: 'http://127.0.0.1:4098', RHYTHM_LIVE_ENGINE_URL: 'http://127.0.0.1:4097', ...(userData ? { RHYTHM_SHELL_USER_DATA: userData } : {}) },
    cwd: () => '/fixture', stderr: { write: (message) => calls.push(message) }, versions: { electron: '40.10.2' },
  });
  const app = Object.assign(new EventEmitter(), {
    isPackaged: true, setPath: (key, value) => paths.set(key, value), getPath: (key) => paths.get(key) ?? '/default-user-data',
    requestSingleInstanceLock: () => true, isReady: () => false, whenReady: async () => {}, getVersion: () => 'test',
    quit: () => calls.push('quit'), exit: (code) => calls.push(['exit', code]),
  });
  class Server {
    onStatusChange() {} async start() {} async restart() { return { ok: true }; } async stopGracefully() {} async stopForQuit() {}
  }
  class Window {
    constructor(options) {
      this.options = options; windows.push(this);
      this.webContents = Object.assign(new EventEmitter(), { mainFrame: { url: 'rhythm://app/index.html#/hermes' }, isDestroyed: () => false, send() {}, setWindowOpenHandler() {}, executeJavaScript: async () => {} });
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
    if (name === 'electron') values = { app, BrowserWindow: Window, ipcMain: { on() {}, handle: (key, fn) => handlers.set(key, fn) }, net: {}, Notification: {}, protocol: { registerSchemesAsPrivileged() {}, handle() {} }, safeStorage: { isEncryptionAvailable: () => false }, session: { defaultSession: Object.assign(new EventEmitter(), { setPermissionRequestHandler() {} }) }, shell: {}, dialog: { showOpenDialog: selectDirectory, showErrorBox: () => {}, showMessageBox: async () => ({ response: 1 }) } };
    else if (name === './agent-server.mjs') values = { AgentServerService: Server, AGENT_SERVER_BASE_URL: 'http://127.0.0.1:4001', AGENT_SERVER_ENGINE_PORT: 4096, electronDbPath: () => '/fixture/electron.db', legacyFlutterDbPath: () => '/fixture/legacy.db' };
    else if (name === './hermes-server.mjs') values = { createHermesSupervisor: () => ({ getStatus: () => ({ state: 'disabled', port: 9121, url: 'http://127.0.0.1:9121' }), onStatus() {}, async start() {}, async stop() {} }) };
    else if (name === './production-api-config.mjs') values = { createProductionApiConfig: () => ({ load: () => 'https://example.invalid' }), createProductionApiSetHandler: () => () => {} };
    else { values = { ...await import(name.startsWith('.') ? new URL(name, file).href : name) }; if (name === 'node:fs') values.existsSync = (path) => path !== '/fixture/electron.db'; }
    return new SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
  });
  await module.evaluate();
  await new Promise((done) => setImmediate(done));
  return { app, calls, windows, handlers, paths, processBoundary };
}

async function writeUpdateSource(root, { sequence = 5 } = {}) {
  const renderer = '<main id="hermes-desktop">v2</main>';
  const host = 'export async function createEmbeddedHermesHost() { return { dispose: async () => {}, handleIntent: async () => ({ ok: true }) }; }\n';
  const preload = 'window.hermesDesktop = { version: 2 };\n';
  await mkdir(join(root, 'renderer'), { recursive: true });
  await mkdir(join(root, 'electron'), { recursive: true });
  await writeFile(join(root, 'renderer', 'index.html'), renderer);
  await writeFile(join(root, 'electron', 'embedded-host.mjs'), host);
  await writeFile(join(root, 'electron', 'preload.cjs'), preload);
  const manifest = {
    schemaVersion: 2, product: 'hermes-desktop',
    sourceCommit: 'ba0de5c2068ba3fe9ad986952f644056610b64fb',
    hermesVersion: '0.20.6', hostApiVersion: 1, electronMajor: 40, electronVersion: '40.10.2',
    sequence, dirty: false, sourceDirty: false,
    files: { renderer: 'renderer/index.html', host: 'electron/embedded-host.mjs', preload: 'electron/preload.cjs' },
    integrity: {
      'renderer/index.html': digest(renderer),
      'electron/embedded-host.mjs': digest(host),
      'electron/preload.cjs': digest(preload),
    },
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(root, 'manifest.json'), manifestBytes);
  await writeFile(join(root, 'manifest.sig'), `${sign(null, manifestBytes, TEST_UPDATE_PRIVATE_KEY).toString('base64')}\n`);
}

test('1570-e:1 hermes:update:install accepts no renderer payload, runs only for the owning main frame, and a cancelled dialog writes nothing', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'rhythm-hermes-install-'));
  let opened = 0;
  const runtime = await interactiveRuntime([], userData, async () => { opened += 1; return { canceled: true, filePaths: [] }; });
  const handler = runtime.handlers.get('hermes:update:install');
  assert.equal(typeof handler, 'function');
  const owner = runtime.windows[0];
  const event = { sender: owner.webContents, senderFrame: owner.webContents.mainFrame };

  await assert.rejects(handler({ sender: {}, senderFrame: event.senderFrame }), /denied/);
  await assert.rejects(handler({ ...event, senderFrame: { url: 'https://example.invalid' } }), /denied/);
  assert.equal(opened, 0);

  await assert.rejects(handler(event, { path: '/x' }), /Invalid IPC payload/);
  assert.equal(opened, 0);

  const result = await handler(event);
  // Per-field, not a whole-object deepEqual: `result` is a value returned by a function compiled
  // inside this harness's vm context, so it carries that context's own Object prototype, not this
  // test file's — a cross-realm deepStrictEqual would fail on prototype identity, not content.
  assert.equal(result.ok, false);
  assert.equal(result.cancelled, true);
  assert.equal(opened, 1);
  await assert.rejects(readdir(join(userData, 'hermes-desktop-versions')), /ENOENT/);
});

test('1570-e:6 (regression) a second concurrent hermes:update:install call is ignored instead of opening a second dialog', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'rhythm-hermes-install-'));
  let opened = 0;
  let releaseDialog;
  const pendingDialog = new Promise((resolve) => { releaseDialog = resolve; });
  const runtime = await interactiveRuntime([], userData, async () => {
    opened += 1;
    await pendingDialog;
    return { canceled: true, filePaths: [] };
  });
  const handler = runtime.handlers.get('hermes:update:install');
  const owner = runtime.windows[0];
  const event = { sender: owner.webContents, senderFrame: owner.webContents.mainFrame };

  const first = handler(event);
  await new Promise((done) => setImmediate(done));
  assert.equal(opened, 1);

  const second = await handler(event);
  assert.equal(second.ok, false);
  assert.match(second.reason, /already in progress/);
  assert.equal(opened, 1, 'the duplicate call must not open a second native dialog');

  releaseDialog();
  const firstResult = await first;
  assert.equal(firstResult.ok, false);
  assert.equal(firstResult.cancelled, true);

  // Once the first call finishes, a new call is no longer treated as a duplicate.
  const third = await handler(event);
  assert.equal(third.cancelled, true);
  assert.equal(opened, 2);
});

test('1570-e:2 a selected file that is not manifest.json is refused with zero writes', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'rhythm-hermes-install-'));
  const sourceRoot = await mkdtemp(join(tmpdir(), 'rhythm-hermes-source-'));
  await writeUpdateSource(sourceRoot);
  const wrongFile = join(sourceRoot, 'renderer', 'index.html');
  const runtime = await interactiveRuntime([], userData, async () => ({ canceled: false, filePaths: [wrongFile] }));
  const handler = runtime.handlers.get('hermes:update:install');
  const owner = runtime.windows[0];
  const event = { sender: owner.webContents, senderFrame: owner.webContents.mainFrame };
  const result = await handler(event);
  assert.equal(result.ok, false);
  assert.match(result.reason, /manifest\.json/);
  await assert.rejects(readdir(join(userData, 'hermes-desktop-versions')), /ENOENT/);
});

test('1570-e:3 an untrusted-signature update is refused end to end and leaves no installed version behind (production key set is empty until AJ supplies one)', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'rhythm-hermes-install-'));
  const sourceRoot = await mkdtemp(join(tmpdir(), 'rhythm-hermes-source-'));
  await writeUpdateSource(sourceRoot);
  const manifestPath = join(sourceRoot, 'manifest.json');
  const runtime = await interactiveRuntime([], userData, async () => ({ canceled: false, filePaths: [manifestPath] }));
  const handler = runtime.handlers.get('hermes:update:install');
  const owner = runtime.windows[0];
  const event = { sender: owner.webContents, senderFrame: owner.webContents.mainFrame };
  const result = await handler(event);
  assert.equal(result.ok, false);
  assert.match(result.reason, /unavailable/i);
  const entries = await readdir(join(userData, 'hermes-desktop-versions')).catch(() => []);
  assert.deepEqual(entries, []);
});

test('1570-e:4 preload exposes a frozen installUpdate capability and threads attach version/source/fallbackReason through unchanged', async () => {
  let bridge;
  const invoked = [];
  runInNewContext(await readFile(new URL('../src/preload.cjs', import.meta.url), 'utf8'), {
    require(name) {
      assert.equal(name, 'electron');
      return {
        contextBridge: { exposeInMainWorld: (key, value) => { assert.equal(key, 'rhythmShell'); bridge = value; } },
        ipcRenderer: {
          on() {}, send() {}, sendSync: () => 'https://example.invalid',
          invoke: async (channel, ...args) => {
            invoked.push([channel, ...args]);
            if (channel === 'hermes:view:attach') return { ok: true, attachment: 'a1', hermesVersion: '0.20.5', source: 'factory' };
            if (channel === 'hermes:update:install') return { ok: true, version: '0.20.6' };
            return undefined;
          },
        },
      };
    },
    process: { argv: [], env: {}, platform: 'darwin' },
    window: { addEventListener() {}, dispatchEvent() {} },
  });
  assert.equal(Object.isFrozen(bridge.hermesView), true);
  assert.deepEqual(Object.keys(bridge.hermesView).sort(), [...HERMES_VIEW_KEYS].sort());
  assert.equal(typeof bridge.hermesView.installUpdate, 'function');

  const installResult = await bridge.hermesView.installUpdate();
  assert.equal(installResult.ok, true);
  assert.equal(installResult.version, '0.20.6');
  assert.deepEqual(invoked.at(-1), ['hermes:update:install']);

  // attach() rebuilds its return value inside preload.cjs, which runs in this harness's own vm
  // context — compare fields, not object identity/prototype, for the same reason as above.
  const attachResult = await bridge.hermesView.attach();
  assert.equal(attachResult.ok, true);
  assert.equal(attachResult.version, '0.20.5');
  assert.equal(attachResult.source, 'factory');
  assert.equal(attachResult.reason, undefined);
  assert.equal(attachResult.fallbackReason, undefined);
});

test('1570-e:5 a fallback attach result threads its version, source and reason through preload unchanged', async () => {
  let bridge;
  runInNewContext(await readFile(new URL('../src/preload.cjs', import.meta.url), 'utf8'), {
    require() {
      return {
        contextBridge: { exposeInMainWorld: (_key, value) => { bridge = value; } },
        ipcRenderer: {
          on() {}, send() {}, sendSync: () => 'https://example.invalid',
          invoke: async (channel) => channel === 'hermes:view:attach'
            ? { ok: true, attachment: 'a1', hermesVersion: '0.20.5', source: 'factory', fallbackReason: 'Hermes 0.20.6 failed to start; running the bundled 0.20.5' }
            : undefined,
        },
      };
    },
    process: { argv: [], env: {}, platform: 'darwin' },
    window: { addEventListener() {}, dispatchEvent() {} },
  });
  const result = await bridge.hermesView.attach();
  assert.equal(result.ok, true);
  assert.equal(result.version, '0.20.5');
  assert.equal(result.source, 'factory');
  assert.equal(result.fallbackReason, 'Hermes 0.20.6 failed to start; running the bundled 0.20.5');
});
