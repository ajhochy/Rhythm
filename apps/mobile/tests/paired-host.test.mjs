import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(
  new URL('../lib/pairing/paired-host-store.ts', import.meta.url),
  'utf8',
);

const withoutImports = source
  .replace(/^import\b[\s\S]*?from\s+['"][^'"]+['"]\s*;?\n?/gm, '')
  .replace(/^export\s+type\s+\{[^}]*\}\s*;?\n?/gm, '');

const stubs = `
const __secureStore = new Map();
const __asyncStore = new Map();
let __network = { isConnected: true, isInternetReachable: true };
let __cloudHandler = async () => { throw new Error('cloud handler missing'); };
let __macHandler = async () => { throw new Error('Mac handler missing'); };
const __cloudCalls = [];
const __macCalls = [];
const AsyncStorage = {
  getItem: async (key) => __asyncStore.get(key) ?? null,
  setItem: async (key, value) => { __asyncStore.set(key, value); },
  removeItem: async (key) => { __asyncStore.delete(key); },
};
const getNetworkStateAsync = async () => __network;
const getItemAsync = async (key) => __secureStore.get(key) ?? null;
const setItemAsync = async (key, value) => { __secureStore.set(key, value); };
const deleteItemAsync = async (key) => { __secureStore.delete(key); };
const RHYTHM_SESSION_SECURE_KEY = 'rhythm.cloud.session';
class ApiError extends Error {
  constructor({ source = 'paired-mac', status = 0, code = 'UNKNOWN', message = 'request failed', retryable = false }) {
    super(message);
    this.source = source;
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}
class RhythmCloudClient {
  constructor(options) { this.options = options; }
  async request(path, init) {
    const token = await this.options.getToken();
    __cloudCalls.push({ baseUrl: this.options.baseUrl, path, init, token });
    return __cloudHandler(path, init, token);
  }
}
class PairedMacClient {
  constructor(options) { this.options = options; }
  async request(path, init) {
    const token = await this.options.getDeviceToken();
    __macCalls.push({ baseUrl: this.options.baseUrl, path, init, token });
    return __macHandler(path, init, token);
  }
}
export function __reset() {
  __secureStore.clear();
  __asyncStore.clear();
  __network = { isConnected: true, isInternetReachable: true };
  __cloudCalls.length = 0;
  __macCalls.length = 0;
  __cloudHandler = async () => { throw new Error('cloud handler missing'); };
  __macHandler = async () => { throw new Error('Mac handler missing'); };
}
export function __setCloudHandler(handler) { __cloudHandler = handler; }
export function __setMacHandler(handler) { __macHandler = handler; }
export function __setNetwork(value) { __network = value; }
export function __secure() { return __secureStore; }
export function __async() { return __asyncStore; }
export function __cloudRequests() { return __cloudCalls; }
export function __macRequests() { return __macCalls; }
export { ApiError };
`;

const transpiled = ts.transpileModule(`${stubs}\n${withoutImports}`, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    strict: false,
  },
}).outputText;

const mod = await import(`data:text/javascript,${encodeURIComponent(transpiled)}`);
const {
  ApiError,
  PairedHostError,
  PairedHostStore,
  PAIRED_DEVICE_SECURE_KEY,
  PAIRED_HOST_META_KEY,
  EXPECTED_CONTRACT_FINGERPRINT,
  parsePairingPayload,
  __async,
  __cloudRequests,
  __macRequests,
  __reset,
  __secure,
  __setCloudHandler,
  __setMacHandler,
  __setNetwork,
} = mod;

const CODE = 'a'.repeat(43);
const TOKEN = 'device-token-secret';
const PAYLOAD = JSON.stringify({
  gatewayUrl: 'https://rhythm-mac.tail1234.ts.net',
  pairingCode: CODE,
});
const compatibility = {
  gatewayVersion: '1',
  rhythmVersion: '0.1.0',
  opencodeVersion: '1.14.49',
  contractFingerprint: EXPECTED_CONTRACT_FINGERPRINT,
  minimumMobileVersion: '0.1.0',
  features: [
    'pairing',
    'device-revocation',
    'project-scope',
    'opencode-http-proxy',
  ],
};
const pairResponse = {
  deviceId: 'device-1',
  hostId: 'host-1',
  deviceToken: TOKEN,
  ...compatibility,
};
const healthResponse = { status: 'ready', hostId: 'host-1', ...compatibility };

function primeCloudSession() {
  __secure().set('rhythm.cloud.session', 'cloud-session-secret');
}

async function pairedStore() {
  primeCloudSession();
  __setCloudHandler(async (path) =>
    path === '/mobile-gateway/health' ? healthResponse : pairResponse);
  const store = new PairedHostStore();
  const result = await store.pair(PAYLOAD, { userId: 7, deviceName: 'AJ iPhone' });
  assert.equal(result.state, 'connected');
  return store;
}

// issue-1171-c2/c3: the scanner payload is exact and constrained to tailnet HTTPS.
{
  assert.deepEqual(parsePairingPayload(PAYLOAD), {
    gatewayUrl: 'https://rhythm-mac.tail1234.ts.net',
    pairingCode: CODE,
  });
  for (const invalid of [
    'not-json',
    JSON.stringify({ gatewayUrl: 'http://rhythm-mac.tail1234.ts.net', pairingCode: CODE }),
    JSON.stringify({ gatewayUrl: 'https://example.com', pairingCode: CODE }),
    JSON.stringify({ gatewayUrl: 'https://rhythm-mac.tail1234.ts.net', pairingCode: CODE, token: 'extra' }),
  ]) {
    assert.throws(() => parsePairingPayload(invalid), PairedHostError);
  }
}

// issue-1171-c3: the one-time code is sent once and never enters persisted metadata.
{
  __reset();
  const store = await pairedStore();
  assert.equal(__secure().get(PAIRED_DEVICE_SECURE_KEY), TOKEN);
  const metadata = __async().get(PAIRED_HOST_META_KEY);
  assert.ok(metadata);
  assert.doesNotMatch(metadata, new RegExp(TOKEN));
  assert.doesNotMatch(metadata, new RegExp(CODE));
  assert.doesNotMatch(JSON.stringify(store.snapshot()), new RegExp(`${TOKEN}|${CODE}`));
  assert.equal(__cloudRequests().length, 2);
  assert.equal(__cloudRequests()[0].path, '/mobile-gateway/health');
  const requestBody = JSON.parse(__cloudRequests()[1].init.body);
  assert.equal(requestBody.pairingCode, CODE);
  assert.equal(__cloudRequests()[1].token, 'cloud-session-secret');
}

// issue-1171-c4: unpaired and pairing are observable state transitions.
{
  __reset();
  const emptyStore = new PairedHostStore();
  assert.equal((await emptyStore.restore()).state, 'unpaired');

  primeCloudSession();
  let release;
  __setCloudHandler((path) => {
    if (path === '/mobile-gateway/health') return healthResponse;
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const pendingStore = new PairedHostStore();
  const pending = pendingStore.pair(PAYLOAD, { userId: 7, deviceName: 'AJ iPhone' });
  for (let attempt = 0; attempt < 10 && typeof release !== 'function'; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(pendingStore.snapshot().state, 'pairing');
  assert.equal(typeof release, 'function');
  release(pairResponse);
  assert.equal((await pending).state, 'connected');
}

// issue-1171-c4: offline retains the host and does not call the gateway.
{
  __reset();
  const store = await pairedStore();
  __setNetwork({ isConnected: false, isInternetReachable: false });
  const result = await store.refresh();
  assert.equal(result.state, 'offline');
  assert.equal(result.host.hostId, 'host-1');
  assert.equal(__macRequests().length, 0);
}

// issue-1171-c4: tailnet failure is distinct from device-offline.
{
  __reset();
  const store = await pairedStore();
  __setMacHandler(async () => {
    throw new ApiError({ code: 'NETWORK_ERROR', status: 0, retryable: true });
  });
  const result = await store.refresh();
  assert.equal(result.state, 'tailscaleUnavailable');
  assert.match(result.message, /Tailscale/);
}

// issue-1171-c4: revocation clears Keychain but retains safe host diagnostics.
{
  __reset();
  const store = await pairedStore();
  __setMacHandler(async () => {
    throw new ApiError({ code: 'UNAUTHORIZED', status: 401 });
  });
  const result = await store.refresh();
  assert.equal(result.state, 'revoked');
  assert.equal(__secure().has(PAIRED_DEVICE_SECURE_KEY), false);
  assert.equal(result.host.hostId, 'host-1');
}

// issue-1171-c4: incompatible and unhealthy are bounded, actionable states.
{
  __reset();
  const incompatibleStore = await pairedStore();
  __setMacHandler(async () => ({
    ...healthResponse,
    minimumMobileVersion: '99.0.0',
  }));
  assert.equal((await incompatibleStore.refresh()).state, 'incompatible');

  __reset();
  const unhealthyStore = await pairedStore();
  __setMacHandler(async () => ({ ...healthResponse, status: 'degraded' }));
  assert.equal((await unhealthyStore.refresh()).state, 'unhealthy');
}

// issue-1171-c4/c6: replacing a paired Mac requires explicit confirmation and
// does not consume the new one-time code before confirmation.
{
  __reset();
  const store = await pairedStore();
  __setCloudHandler(async () => {
    throw new Error('must not be called');
  });
  const otherPayload = JSON.stringify({
    gatewayUrl: 'https://other-mac.tail1234.ts.net',
    pairingCode: 'b'.repeat(43),
  });
  await assert.rejects(
    () => store.pair(otherPayload, { userId: 7, deviceName: 'AJ iPhone' }),
    (error) => error instanceof PairedHostError && error.kind === 'replacementRequired',
  );
  assert.equal(__cloudRequests().length, 2);
}

// issue-1171-c4/c5: compatibility is checked before the one-time code is
// consumed, so an incompatible Mac cannot strand a newly issued device token.
{
  __reset();
  primeCloudSession();
  __setCloudHandler(async (path) => {
    assert.equal(path, '/mobile-gateway/health');
    return { ...healthResponse, minimumMobileVersion: '99.0.0' };
  });
  const store = new PairedHostStore();
  await assert.rejects(
    () => store.pair(PAYLOAD, { userId: 7, deviceName: 'AJ iPhone' }),
    (error) =>
      error instanceof PairedHostError && error.kind === 'incompatible',
  );
  assert.equal(store.snapshot().state, 'incompatible');
  assert.equal(__cloudRequests().length, 1);
  assert.equal(__secure().has(PAIRED_DEVICE_SECURE_KEY), false);
}

// issue-1171-c3/c6: explicit revoke calls the Mac with the cloud token, then
// clears both Keychain and secret-free metadata.
{
  __reset();
  const store = await pairedStore();
  __setCloudHandler(async () => undefined);
  assert.equal((await store.revoke()).state, 'unpaired');
  assert.equal(__secure().has(PAIRED_DEVICE_SECURE_KEY), false);
  assert.equal(__async().has(PAIRED_HOST_META_KEY), false);
  assert.equal(__cloudRequests()[2].path, '/mobile-gateway/devices/device-1');
}

console.log('Paired-host security and state-machine tests passed (11 scenarios)');
