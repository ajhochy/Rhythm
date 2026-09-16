import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContext, SourceTextModule, SyntheticModule, runInContext } from 'node:vm';
import test from 'node:test';
import { exchangeDesktopAuthorizationCode } from '../src/google-oauth-core.mjs';

const A = 'https://a.example', B = 'https://b.example';
const decision = { approvalId: 'approval-1', status: 'approved', decisionNonce: 'nonce-1', payloadDigest: null };
const tick = () => new Promise((r) => setImmediate(r));

// Real main + config + preload; fake only Electron, OAuth browser interaction, signer and I/O.
async function host(t, immediateLogin = false, Notification = { isSupported: () => false }) {
  const directory = await mkdtemp(join(tmpdir(), 'rhythm-e12a-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const handlers = new Map(), listeners = new Map(), protocols = new Map();
  const windows = [], logins = [], requests = [], signed = [], opened = [];
  let quits = 0;
  const app = Object.assign(new EventEmitter(), {
    getPath: () => directory, requestSingleInstanceLock: () => true, isReady: () => false,
    whenReady: async () => {}, getVersion: () => 'test', quit() { quits += 1; }, exit(code) { throw new Error(`startup ${code}`); },
  });
  const preload = await readFile(new URL('../src/preload.cjs', import.meta.url), 'utf8');
  class Window {
    constructor() {
      this.destroyed = false;
      if (Notification.isSupported()) { this.isMinimized = () => false; this.focus = () => {}; }
      this.webContents = Object.assign(new EventEmitter(), {
        mainFrame: { url: '' }, getURL: () => this.webContents.mainFrame.url,
        isDestroyed: () => this.destroyed, send() {}, setWindowOpenHandler() {}, executeJavaScript: async () => {},
      });
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.identity = undefined; this.bridge = undefined; this.webContents.emit('destroyed'); if (windows.every((w) => w.destroyed)) app.emit('window-all-closed'); }
    async loadURL(url) {
      this.webContents.emit('did-start-navigation', {}, url, false, true);
      this.webContents.mainFrame = { url };
      const event = () => ({ sender: this.webContents, senderFrame: this.webContents.mainFrame });
      runInContext(preload, createContext({ process: { argv: [], env: {}, platform: 'darwin' }, window: { addEventListener() {} }, require: () => ({
        contextBridge: { exposeInMainWorld: (_key, value) => { this.bridge = value; } },
        ipcRenderer: {
          sendSync: (key) => { const e = event(); listeners.get(key)(e); return e.returnValue; },
          invoke: (key, ...args) => handlers.get(key)(event(), ...args), on() {}, removeListener() {},
        },
      }) }));
      this.webContents.emit('did-finish-load');
    }
  }
  class Server { status = { status: 'ready' }; onStatusChange() {} async start() {} }
  const context = createContext({ process: Object.assign(new EventEmitter(), { argv: [], env: { RHYTHM_PRODUCTION_API_URL: A }, cwd: () => directory, stderr: { write(message) { throw new Error(message); } } }), URL, Response, Headers, console,
    fetch: async (url, init) => { requests.push({ url, bearer: new Headers(init?.headers).get('authorization') }); return new Response('<html></html>'); },
  });
  const file = new URL('../src/main.mjs', import.meta.url);
  const module = new SourceTextModule(await readFile(file, 'utf8'), { context, initializeImportMeta(meta) { meta.dirname = directory; } });
  await module.link(async (name) => {
    let values;
    if (name === 'electron') values = { app, BrowserWindow: Window, ipcMain: { on: (key, fn) => listeners.set(key, fn), handle: (key, fn) => handlers.set(key, fn) }, net: {}, Notification, protocol: { registerSchemesAsPrivileged() {}, handle: (key, fn) => protocols.set(key, fn) }, safeStorage: { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value), decryptString: (value) => value.toString() }, session: { defaultSession: Object.assign(new EventEmitter(), { setPermissionRequestHandler() {} }) }, shell: { openExternal(url) { opened.push(url); } }, dialog: { showErrorBox() {} } };
    else if (name === './agent-server.mjs') values = { AgentServerService: Server, AGENT_SERVER_BASE_URL: 'http://127.0.0.1:4001', AGENT_SERVER_ENGINE_PORT: 4096, electronDbPath: () => join(directory, 'electron.db'), legacyFlutterDbPath: () => join(directory, 'legacy.db') };
    else if (name === './desktop-google-oauth.mjs') values = { runDesktopGoogleOAuth: (options) => new Promise((resolve) => { logins.push({ options, resolve }); if (immediateLogin) resolve({ sessionToken: 'unexpected', user: { id: 1 } }); }) };
    else if (name === './human-approval-main-signer.mjs') values = { capability: async () => 'capability', signDecision: async (value) => { signed.push(value); return { signature: 'signature' }; } };
    else { values = { ...await import(name.startsWith('.') ? new URL(name, file).href : name) }; if (name === 'node:fs') values.existsSync = () => true; }
    return new SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
  });
  await module.evaluate();
  for (let index = 0; index < 20 && windows.length === 0; index += 1) await tick();
  return {
    windows, logins, requests, signed, opened, handlers, listeners, quits: () => quits,
    current: () => windows.at(-1),
    event: () => ({ sender: windows.at(-1).webContents, senderFrame: windows.at(-1).webContents.mainFrame }),
    artifact: () => protocols.get('rhythm-artifact')({ url: 'rhythm-artifact://app/00000000-0000-4000-8000-000000000801', method: 'GET' }),
  };
}

test('e12a-c1: selected server reaches the real desktop token/session exchange, not the build default', async (t) => {
  const h = await host(t);
  const pending = h.current().bridge.auth.signInWithGoogle();
  assert.equal(h.logins[0].options.apiBase, A);
  let target;
  const login = await exchangeDesktopAuthorizationCode({ apiBase: h.logins[0].options.apiBase, code: 'code', codeVerifier: 'verifier', redirectUri: 'http://127.0.0.1:1/callback', fetcher: async (url) => {
    target = String(url); return Response.json({ sessionToken: 'token-A', user: { id: 1 } });
  } });
  assert.equal(target, `${A}/auth/google/desktop-exchange`);
  h.logins[0].resolve(login);
  assert.equal((await pending).sessionToken, 'token-A');
});

test('e12a-c2: A to B destroys identity-bearing renderer and next preload cannot send A bearer to B', async (t) => {
  const h = await host(t), old = h.current();
  const login = old.bridge.auth.signInWithGoogle(); h.logins[0].resolve({ sessionToken: 'token-A', user: { id: 1 } }); await login;
  old.identity = 'A';
  assert.equal((await h.artifact()).status, 200);
  assert.deepEqual(h.requests, [{ url: `${A}/live-artifacts/00000000-0000-4000-8000-000000000801/render`, bearer: 'Bearer token-A' }]);
  await old.bridge.gateway.setProductionApiBase(B);
  assert.equal(old.destroyed, true);
  assert.equal(h.quits(), 0, 'replacing the only window must not quit the application');
  assert.equal(old.identity, undefined);
  assert.notEqual(h.current(), old);
  assert.equal(h.current().bridge.gateway.productionApiBase, B);
  assert.equal((await h.artifact()).status, 401);
  assert.equal(h.requests.length, 1);
  const next = h.current().bridge.auth.signInWithGoogle();
  assert.equal(h.logins[1].options.apiBase, B);
  h.logins[1].resolve({ sessionToken: 'token-B', user: { id: 2 } }); await next;
  await h.artifact();
  assert.equal(h.requests[1].bearer, 'Bearer token-B');
  assert.ok(h.requests[1].url.startsWith(B));
});

test('e12a-c3: old login completing after server change is rejected and cannot clear the newer login', async (t) => {
  const h = await host(t);
  const old = h.current().bridge.auth.signInWithGoogle();
  const rejected = assert.rejects(old, /changed|stale|denied/i);
  await h.current().bridge.gateway.setProductionApiBase(B);
  const next = h.current().bridge.auth.signInWithGoogle();
  h.logins[0].resolve({ sessionToken: 'old', user: { id: 1 } }); await rejected;
  assert.equal((await h.artifact()).status, 401);
  const duplicate = h.current().bridge.auth.signInWithGoogle();
  assert.equal(h.logins.length, 2);
  h.logins[1].resolve({ sessionToken: 'new', user: { id: 2 } });
  assert.equal((await next).sessionToken, 'new'); await duplicate;
});

test('e12a-c4: privileged IPC denies foreign contents, subframes and documents before dispatch', async (t) => {
  const h = await host(t, true);
  for (const channel of ['rhythm:auth:google-sign-in', 'rhythm:production-api:set', 'rhythm:human-approval:capability', 'rhythm:human-approval:sign-decision']) {
    const payload = channel.endsWith(':set') ? [B] : channel.endsWith('sign-decision') ? [decision] : [];
    for (const event of [{ sender: {}, senderFrame: h.event().senderFrame }, { ...h.event(), senderFrame: { url: 'rhythm://app/index.html' } }, { sender: undefined, senderFrame: undefined }]) {
      await assert.rejects(async () => h.handlers.get(channel)(event, ...payload), /denied/i);
    }
    const frame = h.event().senderFrame, original = frame.url;
    for (const url of ['https://evil.example', 'rhythm://other/index.html', 'rhythm://app/other.html', 'rhythm://app/index.html?untrusted=1']) {
      frame.url = url;
      await assert.rejects(async () => h.handlers.get(channel)(h.event(), ...payload), /denied/i);
    }
    frame.url = original;
  }
  const deniedGet = { ...h.event(), senderFrame: { url: 'rhythm://app/index.html' } };
  h.listeners.get('rhythm:production-api:get')(deniedGet);
  assert.equal(deniedGet.returnValue, undefined);
  assert.equal(h.logins.length, 0); assert.equal(h.signed.length, 0);
});

test('e12a-c5: closed bounded privileged payloads reject before signing or configuration mutation', async (t) => {
  const h = await host(t, true), sign = h.handlers.get('rhythm:human-approval:sign-decision');
  for (const value of [null, [], {}, { ...decision, extra: true }, { ...decision, approvalId: 'x\ny' }, { ...decision, approvalId: 'x'.repeat(129) }, { ...decision, status: 'maybe' }, { ...decision, decisionNonce: 'x'.repeat(257) }, { ...decision, payloadDigest: 'not-a-digest' }]) {
    await assert.rejects(async () => sign(h.event(), value), /invalid|malformed/i);
  }
  assert.equal(h.signed.length, 0);
  await sign(h.event(), decision);
  await sign(h.event(), { ...decision, status: 'rejected', payloadDigest: 'a'.repeat(64) });
  assert.equal(h.signed.length, 2);
  for (const channel of ['rhythm:auth:google-sign-in', 'rhythm:human-approval:capability']) {
    await assert.rejects(async () => h.handlers.get(channel)(h.event(), {}), /invalid|payload/i);
  }
  for (const value of [null, {}, 'https://b.example/' + 'x'.repeat(2048), 'file:///tmp/api']) {
    await assert.rejects(async () => h.handlers.get('rhythm:production-api:set')(h.event(), value), /invalid|production api/i);
  }
  assert.equal(h.current().bridge.gateway.productionApiBase, A);
});

test('e12a-c6: preload stays frozen and exposes no generic IPC or credential mutation', async (t) => {
  const h = await host(t), bridge = h.current().bridge;
  for (const value of [bridge, bridge.auth, bridge.gateway, bridge.humanApproval]) assert.equal(Object.isFrozen(value), true);
  assert.deepEqual(Object.keys(bridge.auth), ['signInWithGoogle', 'currentSession', 'logout']);
  assert.deepEqual(Object.keys(bridge.gateway), ['apiBase', 'engineBase', 'productionApiBase', 'setProductionApiBase']);
});

test('e12a-c7: retained A notification click cannot queue or navigate in B; current clicks and cleanup still work', async (t) => {
  const notifications = [];
  class Notification extends EventEmitter {
    static isSupported() { return true; }
    constructor() { super(); this.closed = false; notifications.push(this); }
    show() {}
    close() { this.closed = true; this.emit('close'); }
  }
  const h = await host(t, false, Notification);
  const sync = () => h.listeners.get('rhythm:approval-notifications:sync')(h.event(), [{ id: 'approval-A', sessionId: 'session-A', status: 'pending' }]);
  sync();
  const old = h.current(), notificationA = notifications[0];
  const staleClick = notificationA.listeners('click')[0];
  const switching = old.bridge.gateway.setProductionApiBase(B);
  assert.equal(old.destroyed, true);
  assert.equal(notificationA.closed, true);
  staleClick(); // No window: a stale activation must not queue for B's first load.
  await switching;
  const current = h.current(), initialUrl = 'rhythm://app/index.html#/agents';
  current.isMinimized = () => false;
  let focused = 0;
  current.focus = () => { focused += 1; };
  assert.equal(current.bridge.gateway.productionApiBase, B);
  assert.equal(current.webContents.getURL(), initialUrl, 'stale activation must not survive in the pending queue');
  sync(); // Same approval ID in B must not make A's callback current again.
  assert.equal(notifications.length, 2, 'invalidation clears the registry');
  staleClick();
  assert.equal(current.webContents.getURL(), initialUrl, 'stale click must not navigate the ready B window');
  assert.equal(focused, 0);
  notifications[1].emit('click');
  assert.equal(current.webContents.getURL(), 'rhythm://app/index.html#/agents?sessionId=session-A&approvalId=approval-A');
  assert.equal(focused, 1, 'current-generation click still activates the window');
  sync();
  const latest = notifications.at(-1);
  h.listeners.get('rhythm:approval-notifications:sync')(h.event(), []);
  assert.equal(latest.closed, true, 'notification cancellation still closes the native notification');
  sync();
  assert.notEqual(notifications.at(-1), latest, 'cancellation removes the registry entry');
});

test('e12a-c3: same-URL document replacement discards old login; signed-in account replacement fails closed', async (t) => {
  const h = await host(t);
  const old = h.current().bridge.auth.signInWithGoogle();
  const rejected = assert.rejects(old, /changed|stale/);
  await h.current().loadURL('rhythm://app/index.html#/agents');
  h.logins[0].resolve({ sessionToken: 'old', user: { id: 1 } }); await rejected;
  assert.equal((await h.artifact()).status, 401);
  const login = h.current().bridge.auth.signInWithGoogle();
  h.logins[1].resolve({ sessionToken: 'new', user: { id: 2 } }); await login;
  await assert.rejects(async () => h.current().bridge.auth.signInWithGoogle(), /replacement denied/i);
  assert.equal(h.logins.length, 2);
});

test('E42: current session is main-owned and logout clears it before rebuilding', async (t) => {
  const h = await host(t); const first = h.current();
  const pending = first.bridge.auth.signInWithGoogle();
  h.logins[0].resolve({ sessionToken: 'token-A', user: { id: 1, name: 'Admin', email: 'admin@example.invalid', role: 'admin' } });
  await pending;
  assert.equal(JSON.stringify(await first.bridge.auth.currentSession()), JSON.stringify({ sessionToken: 'token-A', user: { id: 1, name: 'Admin', email: 'admin@example.invalid', role: 'admin' } }));
  await first.bridge.auth.logout();
  assert.equal(first.destroyed, true);
  assert.equal(await h.current().bridge.auth.currentSession(), null);
});

test('E44: update capability opens only the fixed Rhythm Releases page', async (t) => {
  const h = await host(t); const bridge = h.current().bridge;
  assert.deepEqual(Object.keys(bridge.updates), ['openDownloadPage']);
  await bridge.updates.openDownloadPage();
  assert.deepEqual(h.opened, ['https://github.com/ajhochy/Rhythm/releases']);
});
