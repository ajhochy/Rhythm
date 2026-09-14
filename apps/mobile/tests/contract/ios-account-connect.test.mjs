import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../../lib/pairing/paired-host-store.ts', import.meta.url), 'utf8');
const contractSource = await readFile(new URL('../../lib/pairing/mobile-environment-contract.ts', import.meta.url), 'utf8');
const providerSource = await readFile(new URL('../../providers/paired-host-provider.tsx', import.meta.url), 'utf8');
const withoutImports = source
  .replace(/^import\b[\s\S]*?from\s+['"][^'"]+['"]\s*;?\n?/gm, '')
  .replace(/^export\s+type\s+\{[^}]*\}\s*;?\n?/gm, '');

const stubs = `
const HEALTH = {
  status: 'ready', hostId: 'host-1', userId: 7,
  gatewayVersion: '1', rhythmVersion: '0.1.0', opencodeVersion: '1.14.49',
  contractFingerprint: 'f960fbd07a9495b8911ffd511e297307f2f9e6f7e400a0d36f0740aac96dfd56',
  minimumMobileVersion: '0.1.0',
  features: ['pairing', 'device-revocation', 'project-scope', 'opencode-http-proxy'],
};
const __secureStore = new Map();
const __asyncStore = new Map();
const __cloudCalls = [];
const __macCalls = [];
let __macHandler = async () => HEALTH;
const AsyncStorage = {
  getItem: async (key) => __asyncStore.get(key) ?? null,
  setItem: async (key, value) => __asyncStore.set(key, value),
  removeItem: async (key) => __asyncStore.delete(key),
};
const getNetworkStateAsync = async () => ({ isConnected: true, isInternetReachable: true });
const getItemAsync = async (key) => __secureStore.get(key) ?? null;
const setItemAsync = async (key, value) => __secureStore.set(key, value);
const deleteItemAsync = async (key) => __secureStore.delete(key);
class ApiError extends Error {
  constructor({ source = 'cloud', status = 0, code = 'UNKNOWN', message = 'request failed', retryable = false }) {
    super(message); this.source = source; this.status = status; this.code = code; this.retryable = retryable;
  }
}
class PublicGatewayClient { async requestPublic() { throw new Error('manual pairing not configured'); } }
class PairedMacClient {
  constructor(options) { this.options = options; }
  async request(path, init) {
    const token = await this.options.getDeviceToken();
    __macCalls.push({ path, init, token, baseUrl: this.options.baseUrl });
    return __macHandler(path, init, token, this.options.baseUrl);
  }
}
export function __reset() {
  __secureStore.clear(); __asyncStore.clear(); __cloudCalls.length = 0; __macCalls.length = 0;
  __macHandler = async () => HEALTH;
}
export function __secure() { return __secureStore; }
export function __async() { return __asyncStore; }
export function __macRequests() { return __macCalls; }
export function __setMacHandler(handler) { __macHandler = handler; }
export { ApiError };
`;

const transpiled = ts.transpileModule(`${stubs}\n${contractSource}\n${withoutImports}`, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, strict: false },
}).outputText;
const mod = await import(`data:text/javascript,${encodeURIComponent(transpiled)}`);
const {
  ApiError, PairedHostStore, PAIRED_DEVICE_SECURE_KEY, PAIRED_HOST_META_KEY,
  EXPECTED_CONTRACT_FINGERPRINT, __async, __macRequests, __reset, __secure, __setMacHandler,
} = mod;

const HEALTH = {
  status: 'ready', hostId: 'host-1', userId: 7, gatewayVersion: '1', rhythmVersion: '0.1.0',
  opencodeVersion: '1.14.49', contractFingerprint: EXPECTED_CONTRACT_FINGERPRINT,
  minimumMobileVersion: '0.1.0',
  features: ['pairing', 'device-revocation', 'project-scope', 'opencode-http-proxy'],
};
const ONLINE = { id: 'env-1', name: 'Office Mac', status: 'online', historyAvailable: true };
const OFFLINE = { id: 'env-2', name: 'Home Mac', status: 'offline', historyAvailable: true };
const GRANT = {
  environmentId: 'env-1', hostId: 'host-1', deviceId: 'device-1',
  deviceToken: 'device-secret-A1', gatewayBaseUrl: 'https://api.vcrcapps.com/relay',
};

function cloudClient(handler) {
  const calls = [];
  return { calls, request: async (path, init) => { calls.push({ path, init }); return handler(path, init); } };
}

async function bootstrap(store, client, userId = 7) {
  return store.restoreWithAccountBootstrap(client, { userId, deviceName: 'Rhythm iPhone' });
}

test('A1-c1 fresh OAuth account obtains and consumes a SecureStore device grant automatically', async () => {
  __reset();
  const client = cloudClient(async (path, init) => {
    if (path === '/relay/mobile-environments') return { environments: [ONLINE] };
    assert.equal(path, '/relay/mobile-environments/env-1/connect');
    assert.deepEqual(JSON.parse(init.body), { deviceName: 'Rhythm iPhone' });
    return GRANT;
  });
  const store = new PairedHostStore();
  store.setAccountUserId(7);
  const started = performance.now();
  const result = await bootstrap(store, client);
  const elapsedMs = performance.now() - started;
  assert.equal(result.state, 'connected');
  assert.equal(__secure().get(PAIRED_DEVICE_SECURE_KEY), GRANT.deviceToken);
  assert.equal(client.calls.length, 2, 'fresh bootstrap must use exactly list + connect');
  assert.match(providerSource, /store\.restoreWithAccountBootstrap\(\s*account\.client/);
  await store.client().request('/mobile-gateway/projects', { method: 'GET' });
  assert.equal(__macRequests().at(-1).token, GRANT.deviceToken);
  console.log(`A1 metric fresh: cloudRequests=${client.calls.length} elapsedMs=${elapsedMs.toFixed(2)}`);
});

test('A1-c2 device secret stays out of public state/errors and Bearer client is never used for chat', async () => {
  __reset();
  const client = cloudClient(async (path) => path === '/relay/mobile-environments' ? { environments: [ONLINE] } : GRANT);
  const store = new PairedHostStore();
  store.setAccountUserId(7);
  const result = await bootstrap(store, client);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(GRANT.deviceToken));
  for (const value of __async().values()) assert.doesNotMatch(String(value), new RegExp(GRANT.deviceToken));
  assert.ok(client.calls.every(({ path }) => path.startsWith('/relay/mobile-environments')));
  await store.client().request('/mobile-gateway/sessions', { method: 'GET' });
  assert.equal(client.calls.length, 2);
  assert.equal(__macRequests().at(-1).token, GRANT.deviceToken);
});

test('A1-c3 zero, offline, and network failure publish bounded provider states with retry', async () => {
  __reset();
  const emptyStore = new PairedHostStore(); emptyStore.setAccountUserId(7);
  const empty = await bootstrap(emptyStore, cloudClient(async () => ({ environments: [] })));
  assert.equal(empty.bootstrapState, 'noAuthorizedComputer');
  assert.match(empty.message, /no authorized computer/i);

  __reset();
  const offlineStore = new PairedHostStore(); offlineStore.setAccountUserId(7);
  const offlineClient = cloudClient(async (path) => path === '/relay/mobile-environments'
    ? { environments: [OFFLINE] } : { ...GRANT, environmentId: OFFLINE.id });
  const offline = await bootstrap(offlineStore, offlineClient);
  assert.equal(offline.state, 'offline');
  assert.deepEqual(offline.environments, [OFFLINE]);
  assert.ok(offlineStore.client());

  __reset();
  let attempts = 0;
  const retryStore = new PairedHostStore(); retryStore.setAccountUserId(7);
  const retryClient = cloudClient(async (path) => {
    if (path === '/relay/mobile-environments' && attempts++ === 0) throw new ApiError({ code: 'NETWORK_ERROR', retryable: true });
    return path === '/relay/mobile-environments' ? { environments: [ONLINE] } : GRANT;
  });
  assert.equal((await bootstrap(retryStore, retryClient)).bootstrapState, 'retryableError');
  assert.equal((await bootstrap(retryStore, retryClient)).state, 'connected');
});

test('A1-c4 account switch cancels stale bootstrap and clears old credential plus metadata', async () => {
  __reset();
  let releaseConnect;
  const pendingConnect = new Promise((resolve) => { releaseConnect = resolve; });
  const store = new PairedHostStore(); store.setAccountUserId(7);
  const pending = bootstrap(store, cloudClient(async (path) => path === '/relay/mobile-environments' ? { environments: [ONLINE] } : pendingConnect));
  await Promise.resolve();
  await store.clearForAccountChange(8);
  releaseConnect(GRANT);
  await pending;
  assert.equal(__secure().has(PAIRED_DEVICE_SECURE_KEY), false);
  assert.equal(__async().has(PAIRED_HOST_META_KEY), false);
  assert.equal(store.snapshot().host, null);
  assert.notEqual(store.snapshot().state, 'connected');
  assert.match(providerSource, /store\.clearForAccountChange\(accountUserId\)/);
});

test('A1-c5 restore avoids cloud bootstrap and revoked grant bootstraps exactly once', async () => {
  __reset();
  const initialClient = cloudClient(async (path) => path === '/relay/mobile-environments' ? { environments: [ONLINE] } : GRANT);
  const initial = new PairedHostStore(); initial.setAccountUserId(7); await bootstrap(initial, initialClient);
  const restoreCloud = cloudClient(async () => { throw new Error('cloud bootstrap must not run'); });
  const restored = new PairedHostStore(); restored.setAccountUserId(7);
  const started = performance.now();
  assert.equal((await bootstrap(restored, restoreCloud)).state, 'connected');
  console.log(`A1 metric restore: cloudRequests=${restoreCloud.calls.length} elapsedMs=${(performance.now() - started).toFixed(2)}`);
  assert.equal(restoreCloud.calls.length, 0);

  let healthCalls = 0;
  __setMacHandler(async () => {
    healthCalls += 1;
    if (healthCalls === 1) throw new ApiError({ source: 'paired-mac', status: 401, code: 'UNAUTHORIZED' });
    return HEALTH;
  });
  const revokedCloud = cloudClient(async (path) => path === '/relay/mobile-environments'
    ? { environments: [ONLINE] } : { ...GRANT, deviceToken: 'replacement-device-secret' });
  const revoked = new PairedHostStore(); revoked.setAccountUserId(7);
  assert.equal((await bootstrap(revoked, revokedCloud)).state, 'connected');
  assert.equal(revokedCloud.calls.filter(({ path }) => path === '/relay/mobile-environments').length, 1);
  assert.equal(revokedCloud.calls.filter(({ path }) => path.endsWith('/connect')).length, 1);
});

test('A1-c6 signed-in account can explicitly retry an unavailable bootstrap service', async () => {
  __reset();
  const store = new PairedHostStore(); store.setAccountUserId(7);
  let available = false;
  const client = cloudClient(async (path) => {
    if (!available) {
      throw new ApiError({ status: 404, code: 'NOT_FOUND', retryable: false });
    }
    return path === '/relay/mobile-environments' ? { environments: [ONLINE] } : GRANT;
  });
  const result = await bootstrap(store, client);
  assert.equal(result.state, 'unpaired');
  assert.equal(result.bootstrapState, 'unsupported');
  assert.match(result.message, /connection service.*unavailable|update required/i);
  assert.doesNotMatch(result.message, /pair/i);
  assert.deepEqual(client.calls.map(({ path, init }) => [path, init.method]), [
    ['/relay/mobile-environments', 'GET'],
  ]);
  await Promise.resolve();
  assert.equal(client.calls.length, 1, '404 must not start an automatic retry loop');
  assert.equal(__secure().has(PAIRED_DEVICE_SECURE_KEY), false);

  available = true;
  const recovered = await store.discoverAccountEnvironments(
    client,
    { userId: 7, deviceName: 'Rhythm iPhone' },
  );
  assert.equal(recovered.state, 'connected');
  assert.deepEqual(client.calls.map(({ path, init }) => [path, init.method]), [
    ['/relay/mobile-environments', 'GET'],
    ['/relay/mobile-environments', 'GET'],
    ['/relay/mobile-environments/env-1/connect', 'POST'],
  ]);
  assert.equal(__secure().get(PAIRED_DEVICE_SECURE_KEY), GRANT.deviceToken);
  assert.doesNotMatch(JSON.stringify(recovered), new RegExp(GRANT.deviceToken));
  assert.ok(client.calls.every((call) => !JSON.stringify(call).includes(GRANT.deviceToken)));
});

test('A1-c7 malicious cloud gateway URL is rejected before secret persistence', async () => {
  __reset();
  const secret = 'malicious-response-device-secret';
  const store = new PairedHostStore(); store.setAccountUserId(7);
  await assert.rejects(
    () => bootstrap(store, cloudClient(async (path) => path === '/relay/mobile-environments'
      ? { environments: [ONLINE] }
      : { ...GRANT, deviceToken: secret, gatewayBaseUrl: 'https://evil.example/relay' })),
    (error) => error?.kind === 'invalidPayload' && !String(error.message).includes(secret),
  );
  assert.equal(store.snapshot().bootstrapState, 'error');
  assert.equal(__secure().has(PAIRED_DEVICE_SECURE_KEY), false);
  assert.equal([...__async().values()].some((value) => String(value).includes(secret)), false);
});

test('A1-c8 bootstrap request counters are exact and observable', async () => {
  __reset();
  const client = cloudClient(async (path) => path === '/relay/mobile-environments' ? { environments: [ONLINE] } : GRANT);
  const store = new PairedHostStore(); store.setAccountUserId(7);
  await bootstrap(store, client);
  assert.deepEqual(client.calls.map(({ path }) => path), [
    '/relay/mobile-environments',
    '/relay/mobile-environments/env-1/connect',
  ]);
  assert.equal(client.calls[0].init.cache, 'no-store');
});
