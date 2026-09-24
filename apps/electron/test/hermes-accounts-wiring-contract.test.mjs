import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile, mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContext, SourceTextModule, SyntheticModule, runInContext } from 'node:vm';
import test from 'node:test';
import { registerHermesView, bindHermesViewSupervisor } from '../src/hermes-view.mjs';
const SECRET = 'synthetic-s4-integration-key';

const A = 'https://a.example', B = 'https://b.example';
const decision = { approvalId: 'approval-1', status: 'approved', decisionNonce: 'nonce-1', payloadDigest: null };
const tick = () => new Promise((r) => setImmediate(r));

// Executes real main, preload, config and view. Only Electron, OAuth, agent supervisor and the external fork host are fixtures. No mocked Accounts behavior; all account files are synthetic. Fork real hermes:connection-to-spawn proof belongs to its companion contract.
async function host(t, { initialSession, missingHome = false, confirm, failDisposal = false, failAttachment = false } = {}) {
  const immediateLogin = false, Notification = { isSupported: () => false }, onInitialBridge = undefined;
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'rhythm-e12a-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const osHome = join(directory, 'os-home'), hermesHome = join(osHome, '.hermes');
  await mkdir(join(osHome, '.local/share/opencode'), { recursive: true, mode: 0o700 });
  if (!missingHome) await mkdir(hermesHome, { mode: 0o700 });
  await writeFile(join(osHome, '.local/share/opencode/auth.json'), JSON.stringify({ openai: { type: 'api', key: SECRET } }), { mode: 0o600 });
  const hostCalls = [], dialogs = [], ipcResults = [];
  let releaseDispose, disposalStarted = false;
  let disposal = Promise.resolve();
  const handlers = new Map(), listeners = new Map(), protocols = new Map();
  const windows = [], logins = [], requests = [], signed = [], opened = [];
  /** Resolves only after the actual preload bridge has been installed. */
  let resolveInitialBridge;
  const initialBridgeReady = new Promise((resolve) => { resolveInitialBridge = resolve; });
  let quits = 0, exits = 0;
  const app = Object.assign(new EventEmitter(), {
    getPath: () => directory, requestSingleInstanceLock: () => true, isReady: () => false,
    whenReady: async () => {}, getVersion: () => 'test', quit() { quits += 1; }, exit() { exits += 1; },
  });
  if (initialSession) {
    await writeFile(join(directory, 'auth-session.bin'), Buffer.from(JSON.stringify({ productionApiBase: A, sessionToken: initialSession, user: { id: 1 } })));
  }
  const preload = await readFile(new URL('../src/preload.cjs', import.meta.url), 'utf8');
  class Window extends EventEmitter {
    constructor() {
      super();
      this.contentView = { addChildView() {}, removeChildView() {} };
      this.getContentBounds = () => ({ width: 1280, height: 800 });
      this.destroyed = false;
      if (Notification.isSupported()) { this.isMinimized = () => false; this.focus = () => {}; }
      this.webContents = Object.assign(new EventEmitter(), {
        mainFrame: { url: '' }, getURL: () => this.webContents.mainFrame.url,
        getZoomFactor: () => 1, isDestroyed: () => this.destroyed, send(...args) { ipcResults.push(args); }, setWindowOpenHandler() {},
        executeJavaScript: async () => {},
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
          invoke: async (key, ...args) => { const value = await handlers.get(key)(event(), ...args); ipcResults.push([key, value]); return value; }, on() {}, removeListener() {},
        },
      }) }));
      if (onInitialBridge && windows.length === 1) {
        await onInitialBridge(this.bridge);
        resolveInitialBridge?.();
        resolveInitialBridge = undefined;
      }
      this.webContents.emit('did-finish-load');
      resolveInitialBridge?.();
      resolveInitialBridge = undefined;
    }
  }
  let agentServerOptions;
  const starts = [];
  class Server {
    constructor(options) { this.options = options; agentServerOptions = options; }
    status = { status: 'ready' };
    onStatusChange() {}
    async start() { starts.push(this.options?.relayConfigurationProvider?.()); }
  }
  class WebContentsView {
    constructor() { this.webContents = Object.assign(new EventEmitter(), { id: 101, isDestroyed: () => false, close() {}, setWindowOpenHandler() {}, setZoomFactor() {}, async loadURL() {}, session: Object.assign(new EventEmitter(), { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, async clearStorageData() {}, webRequest: { onBeforeRequest() {} } }) }); }
    setBounds() {}
  }
  const context = createContext({ process: Object.assign(new EventEmitter(), { argv: [], env: { RHYTHM_PRODUCTION_API_URL: A }, cwd: () => directory, stderr: { write(message) { throw new Error(message); } } }), URL, Response, Headers, console,
    fetch: async (url, init) => { requests.push({ url, bearer: new Headers(init?.headers).get('authorization') }); return new Response('<html></html>'); },
  });
  const file = new URL('../src/main.mjs', import.meta.url);
  const module = new SourceTextModule(await readFile(file, 'utf8'), { context, initializeImportMeta(meta) { meta.dirname = directory; } });
  await module.link(async (name) => {
    let values;
    if (name === 'electron') values = { app, BrowserWindow: Window, ipcMain: { removeHandler: key => handlers.delete(key), on: (key, fn) => listeners.set(key, fn), handle: (key, fn) => handlers.set(key, fn) }, net: {}, Notification, protocol: { registerSchemesAsPrivileged() {}, handle: (key, fn) => protocols.set(key, fn) }, safeStorage: { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value), decryptString: (value) => value.toString() }, session: { defaultSession: Object.assign(new EventEmitter(), { setPermissionRequestHandler() {} }) }, shell: { openExternal(url) { opened.push(url); } }, dialog: { showErrorBox() {}, async showMessageBox(...args) { dialogs.push(args); return confirm ? confirm(...args) : { response: 0 }; } } };
    else if (name === './hermes-view.mjs') values = { bindHermesViewSupervisor, registerHermesView: options => { const controller = registerHermesView({ ...options, getArtifactRoot: () => directory, electron: { WebContentsView }, resolveArtifact: async () => ({ root: directory, rendererUrl: 'file://' + directory + '/index.html', hostPath: directory + '/embedded-host.mjs', preloadPath: directory + '/preload.cjs' }), importHost: async () => ({ createEmbeddedHermesHost: async hostOptions => { hostCalls.push(hostOptions); return { async dispose() { disposalStarted = true; await disposal; if (failDisposal) throw new Error('Fixture owned child could not stop'); }, async handleIntent() { return { ok: true }; }, async getAllowedOrigins() { if (failAttachment) { hostOptions.onOwnedBackendAttempt({ attemptId: 'pending-host', phase: 'starting', profile: 'default', acceptedEnvNames: [] }); await hostOptions.backendEnv({ ...hostOptions.backendEnvContext, hermesHome, profile: 'default', source: 'opencode-auth-json' }); hostOptions.onOwnedBackendAttempt({ attemptId: 'pending-host', phase: 'accepted', profile: 'default', acceptedEnvNames: ['OPENAI_API_KEY'] }); throw new Error('Fixture readiness failed after owned start'); } return []; }, onAllowedOrigins() { return () => {}; }, async handlePermissionRequest() { return false; }, handleWillAttachWebview() { return false; }, async handleGuestWindowOpen() { return false; }, handleGuestNavigation() { return false; } }; } }) }); t.after(async () => { releaseDispose?.(); await controller.dispose().catch(() => {}); }); return controller; } };
    else if (name === './agent-server.mjs') values = { AgentServerService: Server, AGENT_SERVER_BASE_URL: 'http://127.0.0.1:4001', AGENT_SERVER_ENGINE_PORT: 4096, electronDbPath: () => join(directory, 'electron.db'), legacyFlutterDbPath: () => join(directory, 'legacy.db') };
    else if (name === './hermes-server.mjs') values = { createHermesSupervisor: () => ({ getStatus: () => ({ state: 'disabled', port: 9121, url: 'http://127.0.0.1:9121' }), onStatus() {}, async start() {}, async stop() {} }) };
    else if (name === './desktop-google-oauth.mjs') values = { runDesktopGoogleOAuth: (options) => new Promise((resolve) => { logins.push({ options, resolve }); if (immediateLogin) resolve({ sessionToken: 'unexpected', user: { id: 1 } }); }) };
    else if (name === './human-approval-main-signer.mjs') values = { capability: async () => 'capability', signDecision: async (value) => { signed.push(value); return { signature: 'signature' }; } };
    else { values = { ...await import(name.startsWith('.') ? new URL(name, file).href : name) }; if (name === 'node:fs') { const exists = values.existsSync; values.existsSync = path => String(path).endsWith('dist/index.html') || exists(path); } if (name === 'node:os') { values.homedir = () => osHome; values.userInfo = () => ({ homedir: osHome, username: 'fixture' }); } }
    return new SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
  });
  await module.evaluate();
  await Promise.race([initialBridgeReady, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Main failed to initialize fixture')), 2000); timer.unref(); })]);
  return {
    directory, osHome, hermesHome, hostCalls, dialogs, ipcResults, holdDisposal: () => { disposal = new Promise(resolve => { releaseDispose = resolve; }); }, releaseDisposal: () => releaseDispose?.(), disposalStarted: () => disposalStarted, windows, logins, requests, signed, opened, handlers, listeners, agentServerOptions, starts, quits: () => quits, exits: () => exits,
    current: () => windows.at(-1),
    event: () => ({ sender: windows.at(-1).webContents, senderFrame: windows.at(-1).webContents.mainFrame }),
    artifact: () => protocols.get('rhythm-artifact')({ url: 'rhythm-artifact://app/00000000-0000-4000-8000-000000000801', method: 'GET' }),
  };
}

const mutation = { action: 'enable', provider: 'openai', source: 'opencode-auth-json' };
function accounts(h) {
  const bridge = h.current().bridge.aiAccounts;
  assert.ok(bridge, 'Actual preload must expose the closed Accounts bridge');
  assert.equal(Object.isFrozen(bridge), true);
  assert.deepEqual(Object.keys(bridge).sort(), ['getStatus', 'setGrant']);
  return bridge;
}
async function attach(h) {
  const previous = h.hostCalls.length;
  h.current().webContents.mainFrame.url = 'rhythm://app/index.html#/hermes';
  const result = await h.current().bridge.hermesView.attach();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(h.hostCalls.length, previous + 1);
  return h.hostCalls.at(-1);
}
async function login(h) {
  const pending = h.current().bridge.auth.signInWithGoogle();
  h.logins.at(-1).resolve({ sessionToken: 'fixture-token', user: { id: 7 } });
  await pending;
}

test('S4-I1: actual main/preload exposes metadata-only Accounts with no renderer authority', async t => {
  const h = await host(t); const api = accounts(h);
  assert.equal((await api.getStatus()).availability, 'unavailable');
  assert.equal((await api.setGrant(mutation)).accepted, false);
  assert.equal(h.dialogs.length, 0);
  assert.equal(JSON.stringify(h.ipcResults).includes(SECRET), false);
});

test('S4-I2: signed-out ordinary Hermes view still attaches without credential sharing', async t => {
  const h = await host(t); const options = await attach(h);
  assert.equal(options.backendEnv, undefined);
  assert.equal(options.onOwnedBackendAttempt, undefined);
});

test('S4-I3: missing default home does not break signed-in ordinary Hermes startup', async t => {
  const h = await host(t, { missingHome: true }); await login(h);
  const options = await attach(h);
  assert.equal(options.backendEnv, undefined);
  assert.equal(options.onOwnedBackendAttempt, undefined);
  assert.equal((await accounts(h).getStatus()).availability, 'unavailable');
});

test('S4-I4: restored offline envelope feeds real view host; native receipt alone marks applied', async t => {
  const h = await host(t, { initialSession: 'offline-session' }); const api = accounts(h);
  assert.equal((await api.getStatus()).availability, 'available');
  assert.equal((await api.setGrant(mutation)).accepted, true);
  assert.equal(h.dialogs.length, 1);
  const options = await attach(h);
  assert.equal(options.hermesHome, h.hermesHome, 'Main must pass the identical trusted canonical home to the real fork host');
  assert.equal(typeof options.backendEnv, 'function');
  assert.equal(typeof options.onOwnedBackendAttempt, 'function');
  assert.equal(options.backendEnvContext.serverOrigin, A);
  assert.equal(options.backendEnvContext.rhythmUserId, '1');
  const generation = options.backendEnvContext.authGeneration;
  assert.equal(typeof generation, 'string');
  assert.ok(generation.length > 0);
  options.onOwnedBackendAttempt({ attemptId: 'fixture-owned-1', phase: 'starting', profile: 'default', acceptedEnvNames: [] });
  const env = await options.backendEnv(Object.freeze({ ...options.backendEnvContext, profile: 'default', hermesHome: h.hermesHome, source: 'opencode-auth-json' }));
  assert.equal(env.OPENAI_API_KEY, SECRET);
  assert.equal((await api.getStatus()).providers.openai.applicationState, 'configured');
  options.onOwnedBackendAttempt({ attemptId: 'fixture-owned-1', phase: 'accepted', profile: 'default', acceptedEnvNames: ['OPENAI_API_KEY'] });
  assert.equal((await api.getStatus()).providers.openai.applicationState, 'applied');
  options.onOwnedBackendAttempt({ attemptId: 'fixture-owned-1', phase: 'retired', profile: 'default', acceptedEnvNames: [], cause: 'exited' });
  assert.equal((await api.getStatus()).providers.openai.applicationState, 'configured');
  assert.equal(JSON.stringify(h.ipcResults).includes(SECRET), false);
  assert.equal(h.requests.length, 0, 'Existing offline session restore must not require a new network login');
  const envelope = JSON.parse(await readFile(join(h.directory, 'auth-session.bin'), 'utf8'));
  assert.equal(envelope.sessionToken, 'offline-session');
  assert.equal(envelope.rhythmAccountsAuthGeneration, generation);
});

test('S4-I5: current frame only; confirmation returning after document replacement cannot grant', async t => {
  let resolveConfirmation;
  const h = await host(t, { confirm: () => new Promise(resolve => { resolveConfirmation = resolve; }) }); await login(h);
  const api = accounts(h);
  const handler = h.handlers.get('rhythm:ai-accounts:set-grant');
  assert.equal(typeof handler, 'function');
  for (const event of [{ sender: {}, senderFrame: h.event().senderFrame }, { ...h.event(), senderFrame: { url: h.event().senderFrame.url } }]) {
    assert.equal((await handler(event, mutation)).accepted, false);
  }
  assert.equal((await api.setGrant({ ...mutation, hermesHome: '/attacker', authGeneration: 'attacker' })).accepted, false);
  assert.equal(h.dialogs.length, 0);
  const pending = api.setGrant(mutation);
  for (let i = 0; i < 30 && !resolveConfirmation; i++) await tick();
  assert.equal(typeof resolveConfirmation, 'function');
  await h.current().loadURL('rhythm://app/index.html#/agent-settings');
  resolveConfirmation({ response: 0 });
  assert.equal((await pending).accepted, false);
  assert.equal((await accounts(h).getStatus()).providers.openai.grantEnabled, false);
});

test('S4-I6: actual logout waits for owned host disposal and blocks old broker callbacks', async t => {
  const h = await host(t); await login(h); const api = accounts(h);
  assert.equal((await api.setGrant(mutation)).accepted, true);
  const options = await attach(h);
  options.onOwnedBackendAttempt({ attemptId: 'fixture-pending', phase: 'starting', profile: 'default', acceptedEnvNames: [] });
  h.holdDisposal();
  let completed = false;
  const logout = h.current().bridge.auth.logout().then(() => { completed = true; });
  for (let i = 0; i < 30 && !h.disposalStarted(); i++) await tick();
  assert.equal(h.disposalStarted(), true); assert.equal(completed, false);
  assert.deepEqual(Object.keys(await options.backendEnv({ ...options.backendEnvContext, profile: 'default', hermesHome: h.hermesHome, source: 'opencode-auth-json' })), []);
  options.onOwnedBackendAttempt({ attemptId: 'fixture-pending', phase: 'retired', profile: 'default', acceptedEnvNames: [], cause: 'disposed' });
  h.releaseDisposal(); await logout;
  assert.equal((await accounts(h).getStatus()).availability, 'unavailable');
  await login(h);
  assert.equal((await accounts(h).getStatus()).availability, 'available');
  const next = await attach(h);
  assert.notEqual(next.backendEnvContext.authGeneration, options.backendEnvContext.authGeneration);
  assert.equal(next.backendEnvContext.serverOrigin, h.current().bridge.gateway.productionApiBase);
  assert.deepEqual(Object.keys(await options.backendEnv({ ...options.backendEnvContext, profile: 'default', hermesHome: h.hermesHome, source: 'opencode-auth-json' })), []);
  assert.throws(() => options.onOwnedBackendAttempt({ attemptId: 'fixture-pending', phase: 'accepted', profile: 'default', acceptedEnvNames: ['OPENAI_API_KEY'] }), /stale|denied|receipt|attempt|invalid/i);
  assert.equal((await accounts(h).getStatus()).providers.openai.grantEnabled, false);
});

test('S4-I7: actual server change waits for owned host disposal and blocks old broker callbacks', async t => {
  const h = await host(t); await login(h); const api = accounts(h);
  assert.equal((await api.setGrant(mutation)).accepted, true);
  const options = await attach(h);
  options.onOwnedBackendAttempt({ attemptId: 'fixture-pending', phase: 'starting', profile: 'default', acceptedEnvNames: [] });
  h.holdDisposal();
  let completed = false;
  const logout = h.current().bridge.gateway.setProductionApiBase(B).then(() => { completed = true; });
  for (let i = 0; i < 30 && !h.disposalStarted(); i++) await tick();
  assert.equal(h.disposalStarted(), true); assert.equal(completed, false);
  assert.deepEqual(Object.keys(await options.backendEnv({ ...options.backendEnvContext, profile: 'default', hermesHome: h.hermesHome, source: 'opencode-auth-json' })), []);
  options.onOwnedBackendAttempt({ attemptId: 'fixture-pending', phase: 'retired', profile: 'default', acceptedEnvNames: [], cause: 'disposed' });
  h.releaseDisposal(); await logout;
  assert.equal((await accounts(h).getStatus()).availability, 'unavailable');
  await login(h);
  assert.equal((await accounts(h).getStatus()).availability, 'available');
  const next = await attach(h);
  assert.notEqual(next.backendEnvContext.authGeneration, options.backendEnvContext.authGeneration);
  assert.equal(next.backendEnvContext.serverOrigin, h.current().bridge.gateway.productionApiBase);
  assert.deepEqual(Object.keys(await options.backendEnv({ ...options.backendEnvContext, profile: 'default', hermesHome: h.hermesHome, source: 'opencode-auth-json' })), []);
  assert.throws(() => options.onOwnedBackendAttempt({ attemptId: 'fixture-pending', phase: 'accepted', profile: 'default', acceptedEnvNames: ['OPENAI_API_KEY'] }), /stale|denied|receipt|attempt|invalid/i);
  assert.equal((await accounts(h).getStatus()).providers.openai.grantEnabled, false);
});


test('S4-I8: failed owned disposal cannot admit a new credential identity', async t => {
  const h = await host(t, { failDisposal: true }); await login(h);
  assert.equal((await accounts(h).setGrant(mutation)).accepted, true);
  const options = await attach(h);
  options.onOwnedBackendAttempt({ attemptId: 'fixture-retaining', phase: 'starting', profile: 'default', acceptedEnvNames: [] });
  await options.backendEnv({ ...options.backendEnvContext, profile: 'default', hermesHome: h.hermesHome, source: 'opencode-auth-json' });
  options.onOwnedBackendAttempt({ attemptId: 'fixture-retaining', phase: 'accepted', profile: 'default', acceptedEnvNames: ['OPENAI_API_KEY'] });
  await assert.rejects(h.current().bridge.gateway.setProductionApiBase(B), /stop|dispos|retain|failed/i);
  // Old window may have been destroyed; test the real handler with its old event.
  const status = await h.handlers.get('rhythm:ai-accounts:status')(h.event());
  assert.equal(status.availability, 'unavailable');
  assert.deepEqual(Object.keys(await options.backendEnv({ ...options.backendEnvContext, profile: 'default', hermesHome: h.hermesHome, source: 'opencode-auth-json' })), []);
  assert.equal(h.hostCalls.length, 1);
  assert.equal(h.current().bridge?.gateway.productionApiBase === B, false);
});

test('S4-I9: failed reload disposal remains a barrier to later logout and server change', async t => {
  const h = await host(t, { failDisposal: true }); await login(h);
  assert.equal((await accounts(h).setGrant(mutation)).accepted, true);
  const options = await attach(h);
  options.onOwnedBackendAttempt({ attemptId: 'reload-retaining', phase: 'starting', profile: 'default', acceptedEnvNames: [] });
  await options.backendEnv({ ...options.backendEnvContext, profile: 'default', hermesHome: h.hermesHome, source: 'opencode-auth-json' });
  options.onOwnedBackendAttempt({ attemptId: 'reload-retaining', phase: 'accepted', profile: 'default', acceptedEnvNames: ['OPENAI_API_KEY'] });
  await h.current().loadURL('rhythm://app/index.html#/hermes');
  for (let i = 0; i < 10; i++) await tick();
  await assert.rejects(h.current().bridge.auth.logout(), /stop|dispos|retain|failed/i);
  assert.equal((await accounts(h).getStatus()).availability, 'unavailable');
  await assert.rejects(h.current().bridge.gateway.setProductionApiBase(B), /stop|dispos|retain|failed/i);
  assert.equal(h.hostCalls.length, 1);
  assert.equal(h.current().bridge.gateway.productionApiBase, A);
});


test('S4-I10: pending attachment stop failure remains a later identity barrier', async t => {
  const h = await host(t, { failDisposal: true, failAttachment: true }); await login(h);
  assert.equal((await accounts(h).setGrant(mutation)).accepted, true);
  h.current().webContents.mainFrame.url = 'rhythm://app/index.html#/hermes';
  // Both a rejected invocation and a closed failure DTO surface attachment failure.
  const attached = await h.current().bridge.hermesView.attach().catch(() => ({ ok: false }));
  assert.equal(attached.ok, false);
  assert.equal(h.disposalStarted(), true);
  await assert.rejects(h.current().bridge.auth.logout(), /stop|dispos|retain|failed/i);
  assert.equal((await accounts(h).getStatus()).availability, 'unavailable');
  assert.equal(h.hostCalls.length, 1);
});
