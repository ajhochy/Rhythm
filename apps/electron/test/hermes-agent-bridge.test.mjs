import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import test from 'node:test';
import { createAgentBridgeHost } from '../src/hermes-agent-bridge.mjs';

const SESSION = 'session-token-sentinel';
const REGISTRAR = 'registrar-secret-sentinel';
const MEMORY_VAULT = 'b'.repeat(64);
const DEFAULT_SCOPES = ['catalog.read', 'agent.write', 'projection.issue', 'runtime.report', 'delegation.dispatch', 'delegation.execute'];
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function waitFor(predicate, message, timeoutMs = 2_500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(message);
}

async function fixture(t, responder) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8');
    const entry = {
      method: request.method,
      path: request.url,
      registrar: request.headers['x-rhythm-bridge-registrar'],
      body: text ? JSON.parse(text) : undefined,
    };
    requests.push(entry);
    const result = await responder?.(entry, requests) ?? (
      entry.path === '/agent-bridge/v1/registrar/memory-vault'
        ? { status: 200, body: { memoryVaultId: MEMORY_VAULT } }
        : entry.method === 'POST' && entry.path === '/agent-bridge/v1/registrar/grants'
          ? { status: 201, body: { grantId: entry.body.grantId, replacedGrantId: null } }
          : { status: 204 }
    );
    response.statusCode = result.status;
    if (result.body !== undefined) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(result.body));
    } else response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return { requests, registrar: { secret: REGISTRAR, baseUrl: `http://127.0.0.1:${address.port}`, port: address.port } };
}

function mint(host, overrides = {}) {
  return host.mintForAttempt({
    attemptId: randomUUID(),
    profile: 'default',
    serverOrigin: 'https://rhythm.example',
    authGeneration: 'auth-generation-1',
    ...overrides,
  });
}

test('EB-2: a reused runtime has no registrar or bridge capability', () => {
  const host = createAgentBridgeHost({
    getRegistrar: () => undefined,
    getSessionToken: () => SESSION,
    confirmNative: async () => false,
  });
  assert.deepEqual(mint(host), {});
  assert.deepEqual(host.status(), { available: false, reason: 'runtime_unowned' });
});

test('EB-3: mint is local and registration retries with the exact bounded grant body', async (t) => {
  let registrations = 0;
  const f = await fixture(t, (entry) => {
    if (entry.path.endsWith('/memory-vault')) return { status: 200, body: { memoryVaultId: MEMORY_VAULT } };
    if (entry.path.endsWith('/grants')) {
      registrations += 1;
      if (registrations === 1) return { status: 503, body: { error: { code: 'bridge_unavailable', message: 'Unavailable' } } };
      return { status: 201, body: { grantId: entry.body.grantId, replacedGrantId: null } };
    }
    return { status: 204 };
  });
  const logs = [];
  let fetchCalls = 0;
  const host = createAgentBridgeHost({
    getRegistrar: () => f.registrar,
    getSessionToken: () => SESSION,
    confirmNative: async () => false,
    fetchImpl: (...args) => { fetchCalls += 1; return fetch(...args); },
    log: (value) => logs.push(String(value)),
  });

  const attemptId = randomUUID();
  const bridgeEnv = mint(host, { attemptId });
  assert.equal(fetchCalls, 0, 'mint must return before any network operation');
  assert.match(bridgeEnv.HERMES_HOST_CAPABILITY_RHYTHM_BRIDGE, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(bridgeEnv.HERMES_HOST_CAPABILITY_RHYTHM_BRIDGE_ORIGIN, f.registrar.baseUrl);
  assert.deepEqual(mint(host, { attemptId }), bridgeEnv, 'one owned attempt must retain one capability');

  const registration = await waitFor(
    () => f.requests.filter((entry) => entry.method === 'POST' && entry.path.endsWith('/grants')).at(1),
    'registration did not retry after the one-second first backoff',
  );
  assert.equal(registration.registrar, REGISTRAR);
  assert.match(registration.body.grantId, /^[0-9a-f-]{36}$/);
  assert.equal(registration.body.capabilitySha256, createHash('sha256').update(bridgeEnv.HERMES_HOST_CAPABILITY_RHYTHM_BRIDGE).digest('hex'));
  assert.equal(registration.body.sessionToken, SESSION);
  assert.equal(registration.body.hermesProfile, 'default');
  assert.match(registration.body.runtimeGeneration, /^[0-9a-f-]{36}$/);
  assert.equal(registration.body.serverOrigin, 'https://rhythm.example');
  assert.equal(registration.body.authGeneration, 'auth-generation-1');
  assert.deepEqual(registration.body.scopes, DEFAULT_SCOPES);
  assert.equal(Object.hasOwn(registration.body, 'memoryVaultId'), false);
  await waitFor(() => host.status().available, 'successful retry did not make the bridge available');
  assert.deepEqual(host.status(), { available: true, reason: null });
  assert.equal(logs.join('\n').includes(SESSION), false);
  assert.equal(logs.join('\n').includes(REGISTRAR), false);
});

test('EB-4: retire, identity revocation, fail-closed minting, and registrar restart preserve lifecycle boundaries', async (t) => {
  const first = await fixture(t);
  const second = await fixture(t);
  let current = first.registrar;
  const host = createAgentBridgeHost({
    getRegistrar: () => current,
    getSessionToken: () => SESSION,
    confirmNative: async () => false,
  });
  const attemptId = randomUUID();
  const bridgeEnv = mint(host, { attemptId });
  const firstRegistration = await waitFor(() => first.requests.find((entry) => entry.path.endsWith('/grants')), 'initial grant missing');
  current = second.registrar;
  await host.onRegistrarReady();
  const replacement = await waitFor(() => second.requests.find((entry) => entry.path.endsWith('/grants')), 'grant was not restored after server restart');
  assert.equal(replacement.body.capabilitySha256, firstRegistration.body.capabilitySha256, 'the live attempt must retain the same C');
  await host.retire(attemptId);
  await waitFor(() => second.requests.find((entry) => entry.method === 'DELETE'), 'retire did not delete the grant');
  assert.equal(host.status().available, false);

  let revokeResponse;
  let revokeRequests = 0;
  const revokeStarted = new Promise((resolve) => { revokeResponse = resolve; });
  const blockingHost = createAgentBridgeHost({
    getRegistrar: () => first.registrar,
    getSessionToken: () => SESSION,
    confirmNative: async () => false,
    fetchImpl: async (url, init) => {
      if (String(url).endsWith('/revoke-all')) {
        revokeRequests += 1;
        await revokeStarted;
        return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
      }
      return fetch(url, init);
    },
  });
  mint(blockingHost);
  const revoking = blockingHost.revokeAll();
  let settled = false;
  revoking.finally(() => { settled = true; }).catch(() => {});
  await tick();
  assert.equal(settled, false, 'revokeAll must be awaitable by the identity transition');
  revokeResponse();
  await assert.rejects(revoking, /bridge revocation failed/i);
  assert.equal(revokeRequests, 4, 'revocation must make an initial attempt plus three retries');
  assert.deepEqual(mint(blockingHost), {}, 'a failed identity revocation must keep bridge minting disabled');
  assert.deepEqual(blockingHost.status(), { available: false, reason: 'bridge_unavailable' });
  assert.equal(bridgeEnv.HERMES_HOST_CAPABILITY_RHYTHM_BRIDGE.length, 43);
});

test('EB-5: only an authenticated default-profile owned attempt receives bridge material', async (t) => {
  const f = await fixture(t);
  let sessionToken;
  const host = createAgentBridgeHost({
    getRegistrar: () => f.registrar,
    getSessionToken: () => sessionToken,
    confirmNative: async () => false,
  });
  assert.deepEqual(mint(host), {});
  sessionToken = SESSION;
  assert.deepEqual(mint(host, { profile: 'work' }), {});
  assert.equal(f.requests.length, 0);
});

test('EB-6: memory scope is consent- and vault-bound, and consent revocation removes the scope', async (t) => {
  const f = await fixture(t);
  const identities = [];
  const host = createAgentBridgeHost({
    getRegistrar: () => f.registrar,
    getSessionToken: () => SESSION,
    getMemoryConsent: async (identity) => { identities.push(identity); return { granted: true, memoryVaultId: MEMORY_VAULT }; },
    confirmNative: async () => false,
  });
  mint(host);
  const registration = await waitFor(() => f.requests.find((entry) => entry.path.endsWith('/grants')), 'consented grant missing');
  assert.deepEqual(registration.body.scopes, [...DEFAULT_SCOPES, 'memory.search']);
  assert.equal(registration.body.memoryVaultId, MEMORY_VAULT);
  assert.equal(identities[0].memoryVaultId, MEMORY_VAULT);
  await host.revokeScope('memory.search');
  const revoke = await waitFor(() => f.requests.find((entry) => entry.path.endsWith('/revoke-scopes')), 'scope revocation missing');
  assert.deepEqual(revoke.body, { scopes: ['memory.search'] });
});

test('EB-7: bridge secrets remain absent from logs, preload source, status and errors', async (t) => {
  const f = await fixture(t);
  const logs = [];
  const host = createAgentBridgeHost({
    getRegistrar: () => f.registrar,
    getSessionToken: () => SESSION,
    confirmNative: async () => false,
    log: (value) => logs.push(String(value)),
  });
  const material = mint(host);
  await waitFor(() => host.status().available, 'grant did not become available');
  const publicSurfaces = JSON.stringify({ logs, status: host.status(), preload: await readFile(new URL('../src/preload.cjs', import.meta.url), 'utf8') });
  for (const sentinel of [material.HERMES_HOST_CAPABILITY_RHYTHM_BRIDGE, REGISTRAR, SESSION]) assert.equal(publicSurfaces.includes(sentinel), false);
});

test('EB-8: confirmation polling is serial, complete, hash-bound, and denies when no window is available', async (t) => {
  const confirmation = {
    confirmationId: randomUUID(), agentId: 'agent-a', agentLabel: 'Agent A', expectedRevision: 4, currentRevision: 4,
    fields: [
      { name: 'enabled', before: true, after: false },
      { name: 'systemPrompt', before: 'changed (10 → 20 chars): old', after: 'changed (10 → 20 chars): new' },
    ],
    changesSha256: 'c'.repeat(64),
  };
  let nextCalls = 0;
  const f = await fixture(t, (entry) => {
    if (entry.path.endsWith('/confirmations/next')) {
      nextCalls += 1;
      return nextCalls === 1 ? { status: 200, body: confirmation } : { status: 204 };
    }
    if (entry.path.endsWith('/memory-vault')) return { status: 200, body: { memoryVaultId: MEMORY_VAULT } };
    if (entry.path.endsWith('/grants')) return { status: 201, body: { grantId: entry.body.grantId, replacedGrantId: null } };
    return { status: 200, body: { status: 'rejected' } };
  });
  let releaseDialog;
  const seen = [];
  const host = createAgentBridgeHost({
    getRegistrar: () => f.registrar,
    getSessionToken: () => SESSION,
    confirmNative: (summary) => new Promise((resolve) => { seen.push(summary); releaseDialog = resolve; }),
  });
  mint(host);
  await host.onRegistrarReady();
  await waitFor(() => seen.length === 1, 'confirmation dialog missing');
  assert.deepEqual(seen[0].fields, confirmation.fields);
  assert.equal(nextCalls, 1, 'a second long-poll must not overlap the native dialog');
  releaseDialog(false);
  const decision = await waitFor(() => f.requests.find((entry) => entry.path.endsWith(`/confirmations/${confirmation.confirmationId}/decision`)), 'confirmation decision missing');
  assert.deepEqual(decision.body, { changesSha256: confirmation.changesSha256, approve: false });
});

test('EB-9: real main wiring merges bridge material, retires attempts, gates auth invalidation, and reacts to server readiness', async () => {
  const calls = [];
  const handlers = new Map();
  let hostOptions;
  const auth = { authenticated: true, serverOrigin: 'https://rhythm.example', userId: '7', authGeneration: randomUUID(), documentEpoch: 1 };
  const bridgeHost = {
    mintForAttempt: (value) => { calls.push(['mint', value]); return { HERMES_HOST_CAPABILITY_RHYTHM_BRIDGE: 'x'.repeat(43), HERMES_HOST_CAPABILITY_RHYTHM_BRIDGE_ORIGIN: 'http://127.0.0.1:7330' }; },
    retire: async (value) => { calls.push(['retire', value]); },
    revokeAll: async () => { calls.push(['revokeAll']); },
    revokeScope: async (value) => { calls.push(['revokeScope', value]); },
    onRegistrarReady: async () => { calls.push(['ready']); },
    status: () => ({ available: true, reason: null }),
  };
  class Server {
    status = { status: 'starting' };
    constructor() { calls.push(['server']); }
    bridgeRegistrar() { return { secret: REGISTRAR, baseUrl: 'http://127.0.0.1:7330', port: 7330 }; }
    onStatusChange(listener) { this.listener = listener; }
    async start() { this.status = { status: 'ready' }; this.listener(this.status); }
    async stopGracefully() {}
  }
  const app = Object.assign(new EventEmitter(), { getPath: () => '/fixture', requestSingleInstanceLock: () => true, isReady: () => false, whenReady: async () => {}, getVersion: () => 'test', quit() {}, exit() {} });
  const contents = Object.assign(new EventEmitter(), { mainFrame: { url: 'rhythm://app/index.html#/agents' }, send() {}, isDestroyed: () => false, setWindowOpenHandler() {}, executeJavaScript: async () => {} });
  class Window { static getAllWindows() { return []; } constructor() { this.webContents = contents; this.destroyed = false; } isDestroyed() { return this.destroyed; } destroy() { this.destroyed = true; } async loadURL() { contents.emit('did-finish-load'); } }
  const context = createContext({ process: Object.assign(new EventEmitter(), { argv: [], env: {}, cwd: () => '/fixture', stderr: { write() {} } }), URL, Response, Headers, console });
  const file = new URL('../src/main.mjs', import.meta.url);
  const module = new SourceTextModule(await readFile(file, 'utf8'), { context, initializeImportMeta(meta) { meta.dirname = '/fixture'; } });
  await module.link(async (name) => {
    let values;
    if (name === 'electron') values = { app, BrowserWindow: Window, ipcMain: { on() {}, handle: (key, fn) => handlers.set(key, fn) }, net: {}, Notification: { isSupported: () => false }, protocol: { registerSchemesAsPrivileged() {}, handle() {} }, safeStorage: { isEncryptionAvailable: () => false }, session: { defaultSession: Object.assign(new EventEmitter(), { setPermissionRequestHandler() {} }) }, shell: {}, dialog: { showMessageBox: async () => ({ response: 1 }) } };
    else if (name === './agent-server.mjs') values = { AgentServerService: Server, AGENT_SERVER_BASE_URL: 'http://127.0.0.1:4001', AGENT_SERVER_ENGINE_PORT: 4096, electronDbPath: () => '/fixture/electron.db', legacyFlutterDbPath: () => '/fixture/legacy.db' };
    else if (name === './hermes-agent-bridge.mjs') values = { createAgentBridgeHost: (options) => { calls.push(['bridge-options', options]); return bridgeHost; } };
    else if (name === './hermes-accounts-auth.mjs') values = { createAccountsAuthState: () => ({ getSnapshot: () => auth, invalidate: async () => { calls.push(['auth-invalidated']); }, documentChanged() {}, async restore() {}, async signIn() {} }) };
    else if (name === './hermes-accounts-main.mjs') values = { createHermesAccountsMain: () => ({ createBackendAttempt: () => ({ backendEnv: async () => ({ ACCOUNT_SENTINEL: 'present' }), record: () => true }), identityChanged: async () => { calls.push(['identityChanged']); }, memorySearchConsent: async () => false }) };
    else if (name === './hermes-view.mjs') values = { bindHermesViewSupervisor() {}, registerHermesView: (options) => { hostOptions = options; return { disposeCurrent: async () => {}, dispose: async () => {} }; } };
    else if (name === './hermes-server.mjs') values = { createHermesSupervisor: () => ({ getStatus: () => ({ state: 'disabled' }), onStatus() {}, async stop() {} }) };
    else if (name === './production-api-config.mjs') values = { createProductionApiConfig: () => ({ load: () => auth.serverOrigin }), createProductionApiSetHandler: () => () => {} };
    else { values = { ...await import(name.startsWith('.') ? new URL(name, file).href : name) }; if (name === 'node:fs') { values.existsSync = () => true; values.realpathSync = (value) => String(value); } if (name === 'node:os') values.userInfo = () => ({ homedir: '/fixture/home' }); }
    return new SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
  });
  await module.evaluate();
  await tick();
  const options = hostOptions.getBackendCredentialOptions();
  const attemptId = randomUUID();
  options.onOwnedBackendAttempt({ attemptId, phase: 'starting', profile: 'default', acceptedEnvNames: [] });
  const env = await options.backendEnv({ ...options.backendEnvContext, hermesHome: options.hermesHome, profile: 'default' });
  assert.equal(env.ACCOUNT_SENTINEL, 'present');
  assert.equal(env.HERMES_HOST_CAPABILITY_RHYTHM_BRIDGE, 'x'.repeat(43));
  options.onOwnedBackendAttempt({ attemptId, phase: 'retired', profile: 'default', acceptedEnvNames: [], cause: 'exited' });
  await waitFor(() => calls.find(([name]) => name === 'retire'), 'main did not retire the bridge grant');
  assert.ok(calls.some(([name]) => name === 'ready'), 'agent-server readiness must notify the bridge host');
  const event = { sender: contents, senderFrame: contents.mainFrame };
  await handlers.get('rhythm:auth:logout')(event);
  assert.ok(calls.some(([name]) => name === 'revokeAll'), 'identity invalidation must await bridge revocation');
});
