import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import test from 'node:test';

const token = 'synthetic-host-export-secret';
async function host(t, signedIn = true, argv = [], extraEnv = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-export-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'web-cloud', 'credential.json');
  if (signedIn) fs.writeFileSync(path.join(directory, 'auth-session.bin'), JSON.stringify({ productionApiBase: 'https://cloud.example.invalid', sessionToken: token, user: { id: 99 } }));
  const menu = Object.assign(new EventEmitter(), { items: [], append(item) { this.items.push(item); } });
  const Menu = { getApplicationMenu: () => menu, setApplicationMenu() {}, buildFromTemplate: (items) => Object.assign(new EventEmitter(), { items, append(item) { this.items.push(item); } }), MenuItem: null };
  // Electron's MenuItem is also supplied separately; no renderer or IPC route
  // is involved in choosing the destination or invoking the action.
  class MenuItem { constructor(options) { Object.assign(this, options); } }
  const dialogs = [], sent = [], logs = [], handlers = new Map();
  let response = 0, decrypts = 0;
  const app = Object.assign(new EventEmitter(), { getPath: () => directory, requestSingleInstanceLock: () => true, isReady: () => false, setPath() {}, whenReady: async () => {}, getVersion: () => 'test', quit() {}, exit() {} });
  const contents = Object.assign(new EventEmitter(), { mainFrame: { url: 'rhythm://app/index.html' }, isDestroyed: () => false, send: (...args) => sent.push(args), setWindowOpenHandler() {}, executeJavaScript: async () => {} });
  class Window extends EventEmitter { constructor() { super(); this.webContents = contents; } isDestroyed() { return false; } async loadURL() { contents.emit('did-finish-load'); } }
  class Server { status = { status: 'ready', owned: false }; onStatusChange() {} async start() { return this.status; } async stopForQuit() {} }
  const context = createContext({ process: Object.assign(new EventEmitter(), { argv, env: { RHYTHM_SHELL_USER_DATA: directory, ...extraEnv }, resourcesPath: path.join(directory, 'Resources'), cwd: () => directory, stderr: { write: line => logs.push(line) } }), URL, Response, Headers, console: { log: (...args) => logs.push(args), warn: (...args) => logs.push(args), error: (...args) => logs.push(args) } });
  const source = new URL('../src/main.mjs', import.meta.url);
  const main = new SourceTextModule(fs.readFileSync(source, 'utf8'), { context, initializeImportMeta(meta) { meta.url = source.href; meta.dirname = directory; } });
  await main.link(async name => {
    let values;
    if (name === 'electron') values = { app, Menu, MenuItem, BrowserWindow: Window, ipcMain: { on() {}, handle: (key, fn) => handlers.set(key, fn) }, net: {}, Notification: {}, protocol: { registerSchemesAsPrivileged() {}, handle() {} }, safeStorage: { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: bytes => { decrypts++; return bytes.toString(); } }, session: { defaultSession: Object.assign(new EventEmitter(), { setPermissionRequestHandler() {} }) }, shell: {}, dialog: { showErrorBox: (...args) => dialogs.push(args), showMessageBox: async options => { dialogs.push(options); return { response }; } } };
    else if (name === './agent-server.mjs') values = { AgentServerService: Server, AGENT_SERVER_BASE_URL: 'http://127.0.0.1:4001', AGENT_SERVER_ENGINE_PORT: 4096, electronDbPath: () => path.join(directory, 'electron.db'), legacyFlutterDbPath: () => path.join(directory, 'legacy.db'), loadQualificationSyntheticActor: () => null };
    else if (name === './hermes-server.mjs') values = { createHermesSupervisor: () => ({ getStatus: () => ({ state: 'disabled' }), onStatus() {}, async start() {}, async stop() {} }) };
    else if (name === './production-api-config.mjs') values = { createProductionApiConfig: () => ({ load: () => 'https://cloud.example.invalid' }), createProductionApiSetHandler: () => () => {} };
    else { values = { ...await import(name.startsWith('.') ? new URL(name, source).href : name) }; if (name === 'node:fs') values.existsSync = () => true; }
    return new SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
  });
  await main.evaluate();
  for (let n = 0; n < 30; n++) await new Promise(resolve => setImmediate(resolve));
  function item() {
    const all = menu.items.flatMap(item => [item, ...(item.submenu?.items ?? item.submenu ?? [])]);
    return all.find(item => item.label === 'Enable browser access on this Mac…');
  }
  return { file, menu, item, dialogs, sent, logs, handlers, decrypts: () => decrypts, setResponse: value => { response = value; } };
}

test('C4 real main menu confirms explicit export of in-memory session to protected file, no token IPC/log/dialog', async t => {
  const h = await host(t);
  assert.ok(h.item(), 'native owner menu action must exist');
  const before = h.decrypts();
  h.setResponse(1); await h.item().click();
  assert.equal(fs.existsSync(h.file), false, 'Cancel must not write');
  h.setResponse(0); await h.item().click();
  assert.deepEqual(JSON.parse(fs.readFileSync(h.file, 'utf8')), { productionApiBase: 'https://cloud.example.invalid', userId: 99, sessionToken: token });
  assert.equal(fs.statSync(h.file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(h.file)).mode & 0o777, 0o700);
  assert.deepEqual(fs.readdirSync(path.dirname(h.file)), ['credential.json'], 'no temporary secret file remains');
  assert.equal(h.decrypts(), before, 'export must not decrypt safeStorage again');
  assert.doesNotMatch(JSON.stringify([h.sent, h.dialogs, h.logs, [...h.handlers.keys()]]), new RegExp(token));
  assert.equal([...h.handlers.keys()].some(key => /cloud.*export|web.*credential/.test(key)), false, 'no exporter IPC');
});

test('C4 signed-out menu cannot export', async t => {
  const h = await host(t, false);
  assert.ok(h.item(), 'native owner menu action must exist');
  assert.equal(h.item().enabled, false);
  await h.item().click();
  assert.equal(fs.existsSync(h.file), false);
});

test('C4 exporter refuses a symlink destination without overwriting its target', async t => {
  const h = await host(t);
  assert.ok(h.item(), 'native owner menu action must exist');
  fs.mkdirSync(path.dirname(h.file), { mode: 0o700 });
  const target = path.join(path.dirname(h.file), 'target'); fs.writeFileSync(target, 'untouched'); fs.symlinkSync(target, h.file);
  await h.item().click();
  assert.equal(fs.readFileSync(target, 'utf8'), 'untouched');
  assert.equal(fs.lstatSync(h.file).isSymbolicLink(), true);
  assert.doesNotMatch(JSON.stringify(h.dialogs), new RegExp(token));
});

test('C4 rename failure preserves old credential and removes protected temporary file', async t => {
  const h = await host(t);
  fs.mkdirSync(path.dirname(h.file), { mode: 0o700 });
  fs.writeFileSync(h.file, 'old-credential', { mode: 0o600 });
  t.mock.method(fs, 'renameSync', (from, to) => {
    assert.equal(to, h.file);
    assert.equal(fs.statSync(from).mode & 0o777, 0o600);
    assert.equal(JSON.parse(fs.readFileSync(from, 'utf8')).sessionToken, token);
    assert.equal(fs.readFileSync(to, 'utf8'), 'old-credential');
    throw new Error('synthetic rename refusal');
  });
  await h.item().click();
  assert.equal(fs.readFileSync(h.file, 'utf8'), 'old-credential');
  assert.deepEqual(fs.readdirSync(path.dirname(h.file)), ['credential.json']);
  assert.doesNotMatch(JSON.stringify(h.dialogs), new RegExp(token));
});

for (const refusal of ['directory-mode', 'foreign-uid', 'qualification']) test(`C4 refuses ${refusal}`, async t => {
  const h = await host(t, true, [], refusal === 'qualification' ? { RHYTHM_QUALIFICATION_FIXTURE_MANIFEST: 'synthetic-test-only' } : {});
  assert.ok(h.item());
  if (refusal === 'directory-mode') fs.mkdirSync(path.dirname(h.file), { mode: 0o755 });
  if (refusal === 'foreign-uid') t.mock.method(process, 'getuid', () => 1234567);
  if (refusal === 'qualification') assert.equal(h.item().enabled, false);
  await h.item().click(); assert.equal(fs.existsSync(h.file), false);
});
