import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

await import('./public-gateway-client.test.mjs');

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
let __publicHandler = async () => { throw new Error('public handler missing'); };
let __macHandler = async () => { throw new Error('Mac handler missing'); };
let __asyncSetFailure = false;
let __asyncSetFailureAtCall = null;
let __asyncSetCalls = 0;
let __asyncRemoveFailure = false;
let __secureWriteFailure = false;
let __secureCleanupFailure = false;
const __publicCalls = [];
const __macCalls = [];
const AsyncStorage = {
  getItem: async (key) => __asyncStore.get(key) ?? null,
  setItem: async (key, value) => {
    __asyncSetCalls += 1;
    if (
      __asyncSetFailure ||
      __asyncSetCalls === __asyncSetFailureAtCall
    ) {
      throw new Error('metadata write failed');
    }
    __asyncStore.set(key, value);
  },
  removeItem: async (key) => {
    if (__asyncRemoveFailure) throw new Error('metadata removal failed');
    __asyncStore.delete(key);
  },
};
const getNetworkStateAsync = async () => __network;
const getItemAsync = async (key) => __secureStore.get(key) ?? null;
const setItemAsync = async (key, value) => {
  if (
    __secureWriteFailure &&
    key === 'rhythm.paired.device' &&
    value !== ''
  ) {
    throw new Error('secure write failed');
  }
  if (
    __secureCleanupFailure &&
    key === 'rhythm.paired.device' &&
    value === ''
  ) {
    throw new Error('secure write failed');
  }
  __secureStore.set(key, value);
};
const deleteItemAsync = async (key) => {
  if (__secureCleanupFailure && key === 'rhythm.paired.device') {
    throw new Error('secure delete failed');
  }
  __secureStore.delete(key);
};
class ApiError extends Error {
  constructor({ source = 'paired-mac', status = 0, code = 'UNKNOWN', message = 'request failed', retryable = false }) {
    super(message);
    this.source = source;
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}
class PublicGatewayClient {
  constructor(options) { this.options = options; }
  async requestPublic(path, init) {
    __publicCalls.push({ baseUrl: this.options.baseUrl, path, init });
    return __publicHandler(path, init, this.options.baseUrl);
  }
}
class PairedMacClient {
  constructor(options) { this.options = options; }
  async request(path, init) {
    const token = await this.options.getDeviceToken();
    __macCalls.push({ baseUrl: this.options.baseUrl, path, init, token });
    return __macHandler(path, init, token, this.options.baseUrl);
  }
}
export function __reset() {
  __secureStore.clear();
  __asyncStore.clear();
  __network = { isConnected: true, isInternetReachable: true };
  __publicCalls.length = 0;
  __macCalls.length = 0;
  __asyncSetFailure = false;
  __asyncSetFailureAtCall = null;
  __asyncSetCalls = 0;
  __asyncRemoveFailure = false;
  __secureWriteFailure = false;
  __secureCleanupFailure = false;
  __publicHandler = async () => { throw new Error('public handler missing'); };
  __macHandler = async () => { throw new Error('Mac handler missing'); };
}
export function __failAsyncSet(value = true) { __asyncSetFailure = value; }
export function __failAsyncSetOnCall(call) { __asyncSetFailureAtCall = call; }
export function __failAsyncRemove(value = true) { __asyncRemoveFailure = value; }
export function __failSecureWrite(value = true) { __secureWriteFailure = value; }
export function __failSecureCleanup(value = true) { __secureCleanupFailure = value; }
export function __setPublicHandler(handler) { __publicHandler = handler; }
export function __setMacHandler(handler) { __macHandler = handler; }
export function __setNetwork(value) { __network = value; }
export function __secure() { return __secureStore; }
export function __async() { return __asyncStore; }
export function __publicRequests() { return __publicCalls; }
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
  __publicRequests,
  __failAsyncRemove,
  __failAsyncSet,
  __failAsyncSetOnCall,
  __failSecureWrite,
  __failSecureCleanup,
  __macRequests,
  __reset,
  __secure,
  __setPublicHandler,
  __setMacHandler,
  __setNetwork,
} = mod;

const CODE = 'a'.repeat(43);
const TOKEN = 'device-token-secret';
const PAYLOAD = JSON.stringify({
  gatewayUrl: 'https://rhythm-mac.tail1234.ts.net',
  hostId: 'host-1',
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
  userId: 7,
  deviceToken: TOKEN,
  ...compatibility,
};
const healthResponse = { status: 'ready', hostId: 'host-1', ...compatibility };

async function pairedStore() {
  __setPublicHandler(async (path) =>
    path === '/mobile-gateway/health' ? healthResponse : pairResponse);
  const store = new PairedHostStore();
  store.setAccountUserId(7);
  const result = await store.pair(PAYLOAD, { userId: 7, deviceName: 'AJ iPhone' });
  assert.equal(result.state, 'connected');
  return store;
}

// issue-1171-c2/c3: the scanner payload is exact and constrained to tailnet HTTPS.
{
  assert.deepEqual(parsePairingPayload(PAYLOAD), {
    gatewayUrl: 'https://rhythm-mac.tail1234.ts.net',
    hostId: 'host-1',
    pairingCode: CODE,
  });
  for (const invalid of [
    'not-json',
    JSON.stringify({ gatewayUrl: 'http://rhythm-mac.tail1234.ts.net', hostId: 'host-1', pairingCode: CODE }),
    JSON.stringify({ gatewayUrl: 'https://example.com', hostId: 'host-1', pairingCode: CODE }),
    JSON.stringify({ gatewayUrl: 'https://rhythm-mac.tail1234.ts.net', hostId: 'host-1', pairingCode: '!'.repeat(43) }),
    JSON.stringify({ gatewayUrl: 'https://rhythm-mac.tail1234.ts.net', hostId: 'host-1', pairingCode: CODE, token: 'extra' }),
    JSON.stringify({ gatewayUrl: 'https://rhythm-mac.tail1234.ts.net', pairingCode: CODE }),
  ]) {
    assert.throws(() => parsePairingPayload(invalid), PairedHostError);
  }
}

// issue-1171-c7: malformed scanner input must leave the store out of pairing
// so the provider can publish a retryable snapshot without an app restart.
{
  __reset();
  const store = new PairedHostStore();
  store.setAccountUserId(7);
  await assert.rejects(
    () => store.pair('not-json', { userId: 7, deviceName: 'AJ iPhone' }),
    (error) =>
      error instanceof PairedHostError && error.kind === 'invalidPayload',
  );
  assert.equal(store.snapshot().state, 'unpaired');
  assert.equal(store.snapshot().host, null);
  assert.match(store.snapshot().message, /invalid/i);
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
  assert.equal(JSON.parse(metadata).rhythmUserId, 7);
  assert.equal(__publicRequests().length, 2);
  assert.equal(__publicRequests()[0].path, '/mobile-gateway/health');
  const requestBody = JSON.parse(__publicRequests()[1].init.body);
  assert.equal(requestBody.pairingCode, CODE);
  assert.equal(requestBody.hostId, 'host-1');
  assert.equal(requestBody.userId, undefined);
  assert.equal(__publicRequests()[1].init.headers?.Authorization, undefined);
}

// issue-1171-c4: unpaired and pairing are observable state transitions.
{
  __reset();
  const emptyStore = new PairedHostStore();
  emptyStore.setAccountUserId(7);
  assert.equal((await emptyStore.restore()).state, 'unpaired');

  let release;
  __setPublicHandler((path) => {
    if (path === '/mobile-gateway/health') return healthResponse;
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const pendingStore = new PairedHostStore();
  pendingStore.setAccountUserId(7);
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
  __setPublicHandler(async () => {
    throw new Error('must not be called');
  });
  const otherPayload = JSON.stringify({
    gatewayUrl: 'https://other-mac.tail1234.ts.net',
    hostId: 'host-2',
    pairingCode: 'b'.repeat(43),
  });
  await assert.rejects(
    () => store.pair(otherPayload, { userId: 7, deviceName: 'AJ iPhone' }),
    (error) => error instanceof PairedHostError && error.kind === 'replacementRequired',
  );
  assert.equal(__publicRequests().length, 2);
}

// issue-1171-c4/c5: compatibility is checked before the one-time code is
// consumed, so an incompatible Mac cannot strand a newly issued device token.
{
  __reset();
  __setPublicHandler(async (path) => {
    assert.equal(path, '/mobile-gateway/health');
    return { ...healthResponse, minimumMobileVersion: '99.0.0' };
  });
  const store = new PairedHostStore();
  store.setAccountUserId(7);
  await assert.rejects(
    () => store.pair(PAYLOAD, { userId: 7, deviceName: 'AJ iPhone' }),
    (error) =>
      error instanceof PairedHostError && error.kind === 'incompatible',
  );
  assert.equal(store.snapshot().state, 'incompatible');
  assert.equal(__publicRequests().length, 1);
  assert.equal(__secure().has(PAIRED_DEVICE_SECURE_KEY), false);
}

// issue-1171 security: a paired credential is usable only by its owning Rhythm
// user. Switching accounts blocks all Mac calls without destroying offline
// metadata, and switching back restores the same-user pairing.
{
  __reset();
  const store = await pairedStore();
  store.setAccountUserId(8);
  const blocked = await store.refresh();
  assert.equal(blocked.state, 'accountMismatch');
  assert.equal(__macRequests().length, 0);
  assert.equal(__secure().get(PAIRED_DEVICE_SECURE_KEY), TOKEN);

  store.setAccountUserId(7);
  __setMacHandler(async () => healthResponse);
  assert.equal((await store.refresh()).state, 'connected');
  assert.equal(__macRequests().length, 1);
}

// issue-1171 security: pre-binding metadata is rejected rather than silently
// adopting a Keychain credential into whichever account signs in next.
{
  __reset();
  __secure().set(PAIRED_DEVICE_SECURE_KEY, TOKEN);
  __async().set(PAIRED_HOST_META_KEY, JSON.stringify({
    gatewayUrl: 'https://rhythm-mac.tail1234.ts.net',
    deviceId: 'legacy-device',
    hostId: 'legacy-host',
    deviceName: 'Legacy iPhone',
    ...compatibility,
    pairedAt: new Date().toISOString(),
  }));
  const store = new PairedHostStore();
  store.setAccountUserId(7);
  assert.equal((await store.restore()).state, 'unpaired');
  assert.equal(__secure().has(PAIRED_DEVICE_SECURE_KEY), false);
  assert.equal(__macRequests().length, 0);
}

// issue-1171/#1175 security: confirmed cross-Mac replacement commits the new
// credential before revoking the previous Mac with its stored Device token.
{
  __reset();
  const store = await pairedStore();
  const oldMetadata = JSON.parse(__async().get(PAIRED_HOST_META_KEY));
  const otherPayload = JSON.stringify({
    gatewayUrl: 'https://other-mac.tail1234.ts.net',
    hostId: 'host-2',
    pairingCode: 'b'.repeat(43),
  });
  __setPublicHandler(async (path) => {
    if (path === '/mobile-gateway/health') {
      return { ...healthResponse, hostId: 'host-2' };
    }
    if (path === '/mobile-gateway/pair') {
      return {
        ...pairResponse,
        deviceId: 'device-2',
        hostId: 'host-2',
        deviceToken: 'new-device-token',
      };
    }
    throw new Error(`unexpected public path ${path}`);
  });
  __setMacHandler(async (path, _init, token, baseUrl) => {
    assert.equal(token, TOKEN);
    assert.equal(baseUrl, oldMetadata.gatewayUrl);
    assert.equal(path, '/mobile-gateway/devices/device-1');
    return undefined;
  });
  const replaced = await store.pair(otherPayload, {
    userId: 7,
    deviceName: 'AJ iPhone',
    replaceExisting: true,
  });
  assert.equal(replaced.state, 'connected');
  assert.equal(replaced.host.hostId, 'host-2');
  assert.equal(__secure().get(PAIRED_DEVICE_SECURE_KEY), 'new-device-token');
  assert.ok(__macRequests().some(
    (request) =>
      request.baseUrl === oldMetadata.gatewayUrl &&
      request.path === '/mobile-gateway/devices/device-1' &&
      request.token === TOKEN,
  ));
}

// issue-1175-c29: a recycled tailnet endpoint is a different Mac when hostId
// changes. Require confirmation even though URL/user match, then never present
// the stale credential to the new host while committing the new pairing.
{
  __reset();
  const store = await pairedStore();
  const recycledPayload = JSON.stringify({
    gatewayUrl: 'https://rhythm-mac.tail1234.ts.net',
    hostId: 'host-2',
    pairingCode: 'b'.repeat(43),
  });
  __setPublicHandler(async () => {
    throw new Error('must not consume before replacement confirmation');
  });
  await assert.rejects(
    () => store.pair(recycledPayload, {
      userId: 7,
      deviceName: 'AJ iPhone',
    }),
    (error) =>
      error instanceof PairedHostError &&
      error.kind === 'replacementRequired',
  );
  assert.equal(__publicRequests().length, 2);

  __setPublicHandler(async (path) => {
    if (path === '/mobile-gateway/health') {
      return { ...healthResponse, hostId: 'host-2' };
    }
    if (path === '/mobile-gateway/pair') {
      return {
        ...pairResponse,
        deviceId: 'device-2',
        hostId: 'host-2',
        deviceToken: 'new-device-token',
      };
    }
    throw new Error(`unexpected public path ${path}`);
  });
  __setMacHandler(async () => {
    throw new Error('recycled endpoint must not receive the stale credential');
  });
  const replaced = await store.pair(recycledPayload, {
    userId: 7,
    deviceName: 'AJ iPhone',
    replaceExisting: true,
  });
  assert.equal(replaced.state, 'connected');
  assert.equal(replaced.host.hostId, 'host-2');
  assert.equal(__secure().get(PAIRED_DEVICE_SECURE_KEY), 'new-device-token');
  assert.equal(
    __macRequests().some((request) => request.token === TOKEN),
    false,
  );
}

// issue-1175-c29: when secure storage fails after detecting a recycled
// endpoint, cleanup uses only the new credential and the state cannot claim
// the old, now-dead credential is still connected.
{
  __reset();
  const store = await pairedStore();
  const recycledPayload = JSON.stringify({
    gatewayUrl: 'https://rhythm-mac.tail1234.ts.net',
    hostId: 'host-2',
    pairingCode: 'c'.repeat(43),
  });
  __setPublicHandler(async (path) => {
    if (path === '/mobile-gateway/health') {
      return { ...healthResponse, hostId: 'host-2' };
    }
    if (path === '/mobile-gateway/pair') {
      return {
        ...pairResponse,
        deviceId: 'device-2',
        hostId: 'host-2',
        deviceToken: 'new-device-token',
      };
    }
    throw new Error(`unexpected public path ${path}`);
  });
  __setMacHandler(async (path, _init, token) => {
    assert.equal(token, 'new-device-token');
    assert.equal(path, '/mobile-gateway/devices/device-2');
    return undefined;
  });
  __failSecureWrite();
  await assert.rejects(
    () => store.pair(recycledPayload, {
      userId: 7,
      deviceName: 'AJ iPhone',
      replaceExisting: true,
    }),
    (error) => error instanceof PairedHostError && error.kind === 'storage',
  );
  assert.equal(store.snapshot().state, 'unhealthy');
  assert.equal(store.snapshot().host.hostId, 'host-1');
  assert.match(store.snapshot().message, /different Mac|recycled|pair again/i);
  assert.equal(
    __macRequests().some((request) => request.token === TOKEN),
    false,
  );
}

async function secureWriteReplacement({
  newDeviceRevocationFails = false,
  credentialCleanupFails = false,
} = {}) {
  __reset();
  const store = await pairedStore();
  const oldMetadata = __async().get(PAIRED_HOST_META_KEY);
  const otherPayload = JSON.stringify({
    gatewayUrl: 'https://other-mac.tail1234.ts.net',
    hostId: 'host-2',
    pairingCode: 'b'.repeat(43),
  });
  __failSecureWrite();
  __failSecureCleanup(credentialCleanupFails);
  __setPublicHandler(async (path) => {
    if (path === '/mobile-gateway/health') {
      return { ...healthResponse, hostId: 'host-2' };
    }
    if (path === '/mobile-gateway/pair') {
      return {
        ...pairResponse,
        deviceId: 'device-2',
        hostId: 'host-2',
        deviceToken: 'new-device-token',
      };
    }
    throw new Error(`unexpected public path ${path}`);
  });
  __setMacHandler(async (path) => {
    if (
      path === '/mobile-gateway/devices/device-2' &&
      newDeviceRevocationFails
    ) {
      throw new Error('new Mac cleanup failed');
    }
    assert.equal(path, '/mobile-gateway/devices/device-2');
    return undefined;
  });
  let failure;
  try {
    await store.pair(otherPayload, {
      userId: 7,
      deviceName: 'AJ iPhone',
      replaceExisting: true,
    });
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof PairedHostError);
  return { failure, oldMetadata, store };
}

// issue-1171-c9: if the initial new-token Keychain write fails during a
// cross-Mac replacement, every server/local cleanup combination must expose
// the host that still needs action and describe exactly what remains.
{
  const clean = await secureWriteReplacement();
  assert.equal(clean.failure.kind, 'storage');
  assert.equal(clean.store.snapshot().state, 'connected');
  assert.equal(clean.store.snapshot().host.hostId, 'host-1');
  assert.match(clean.store.snapshot().message, /previous pairing is unchanged/i);
  assert.equal(__secure().get(PAIRED_DEVICE_SECURE_KEY), TOKEN);
  assert.equal(__async().get(PAIRED_HOST_META_KEY), clean.oldMetadata);

  const serverCleanupFailed = await secureWriteReplacement({
    newDeviceRevocationFails: true,
  });
  assert.equal(serverCleanupFailed.failure.kind, 'storageRollbackFailed');
  assert.equal(serverCleanupFailed.store.snapshot().state, 'unhealthy');
  assert.equal(serverCleanupFailed.store.snapshot().host.hostId, 'host-1');
  assert.match(
    serverCleanupFailed.store.snapshot().message,
    /new Mac still lists.*Revoke/i,
  );
  assert.equal(__secure().get(PAIRED_DEVICE_SECURE_KEY), TOKEN);
  const serverCleanupMetadata = JSON.parse(
    __async().get(PAIRED_HOST_META_KEY),
  );
  assert.equal(serverCleanupMetadata.hostId, 'host-1');
  assert.deepEqual(serverCleanupMetadata.recovery, {
    revokeDevice: true,
    credential: 'previous',
  });
  const restoredServerCleanup = new PairedHostStore();
  restoredServerCleanup.setAccountUserId(7);
  assert.equal((await restoredServerCleanup.restore()).state, 'unhealthy');
  assert.equal(restoredServerCleanup.snapshot().host.hostId, 'host-1');
  assert.equal(__macRequests().length, 1);

  const keychainCleanupFailed = await secureWriteReplacement({
    credentialCleanupFails: true,
  });
  assert.equal(keychainCleanupFailed.failure.kind, 'storage');
  assert.equal(keychainCleanupFailed.store.snapshot().state, 'connected');
  assert.equal(keychainCleanupFailed.store.snapshot().host.hostId, 'host-1');
  assert.match(
    keychainCleanupFailed.store.snapshot().message,
    /previous pairing is unchanged/i,
  );
  assert.equal(__secure().get(PAIRED_DEVICE_SECURE_KEY), TOKEN);
  assert.equal(
    __async().get(PAIRED_HOST_META_KEY),
    keychainCleanupFailed.oldMetadata,
  );

  const bothCleanupsFailed = await secureWriteReplacement({
    newDeviceRevocationFails: true,
    credentialCleanupFails: true,
  });
  assert.equal(bothCleanupsFailed.failure.kind, 'storageRollbackFailed');
  assert.equal(bothCleanupsFailed.store.snapshot().state, 'unhealthy');
  assert.equal(bothCleanupsFailed.store.snapshot().host.hostId, 'host-1');
  assert.match(
    bothCleanupsFailed.store.snapshot().message,
    /new Mac still lists.*Revoke/i,
  );
  assert.equal(__secure().get(PAIRED_DEVICE_SECURE_KEY), TOKEN);
  const bothCleanupMetadata = JSON.parse(__async().get(PAIRED_HOST_META_KEY));
  assert.equal(bothCleanupMetadata.hostId, 'host-1');
  assert.deepEqual(bothCleanupMetadata.recovery, {
    revokeDevice: true,
    credential: 'previous',
  });
}

// issue-1171 security: if the old Mac cannot be revoked, the newly minted
// credential is rolled back and the original pairing remains intact.
{
  __reset();
  const store = await pairedStore();
  const oldMetadata = __async().get(PAIRED_HOST_META_KEY);
  const otherPayload = JSON.stringify({
    gatewayUrl: 'https://other-mac.tail1234.ts.net',
    hostId: 'host-2',
    pairingCode: 'b'.repeat(43),
  });
  __setPublicHandler(async (path) => {
    if (path === '/mobile-gateway/health') return { ...healthResponse, hostId: 'host-2' };
    if (path === '/mobile-gateway/pair') {
      return {
        ...pairResponse,
        deviceId: 'device-2',
        hostId: 'host-2',
        deviceToken: 'new-device-token',
      };
    }
    throw new Error(`unexpected public path ${path}`);
  });
  __setMacHandler(async (path, _init, token, baseUrl) => {
    if (baseUrl.includes('rhythm-mac')) {
      assert.equal(token, TOKEN);
      throw new Error('old Mac unreachable');
    }
    assert.equal(token, 'new-device-token');
    assert.equal(path, '/mobile-gateway/devices/device-2');
    return undefined;
  });
  await assert.rejects(
    () => store.pair(otherPayload, {
      userId: 7,
      deviceName: 'AJ iPhone',
      replaceExisting: true,
    }),
    (error) =>
      error instanceof PairedHostError && error.kind === 'replacementFailed',
  );
  assert.equal(__secure().get(PAIRED_DEVICE_SECURE_KEY), TOKEN);
  assert.equal(__async().get(PAIRED_HOST_META_KEY), oldMetadata);
  assert.equal(store.snapshot().state, 'connected');
  assert.equal(store.snapshot().host.hostId, 'host-1');
  assert.ok(__macRequests().some(
    (request) =>
      request.baseUrl.includes('other-mac') &&
      request.path === '/mobile-gateway/devices/device-2' &&
      request.token === 'new-device-token',
  ));
}

// issue-1175-c18: if Keychain restoration succeeds but metadata restoration
// fails, recovery must describe the previous credential that is actually
// stored instead of claiming that the new Mac credential remains.
{
  __reset();
  const store = await pairedStore();
  const otherPayload = JSON.stringify({
    gatewayUrl: 'https://other-mac.tail1234.ts.net',
    hostId: 'host-2',
    pairingCode: 'b'.repeat(43),
  });
  __setPublicHandler(async (path) => {
    if (path === '/mobile-gateway/health') {
      return { ...healthResponse, hostId: 'host-2' };
    }
    if (path === '/mobile-gateway/pair') {
      return {
        ...pairResponse,
        deviceId: 'device-2',
        hostId: 'host-2',
        deviceToken: 'new-device-token',
      };
    }
    throw new Error(`unexpected public path ${path}`);
  });
  __setMacHandler(async (path, _init, token, baseUrl) => {
    if (baseUrl.includes('rhythm-mac')) {
      assert.equal(token, TOKEN);
      throw new Error('old Mac unreachable');
    }
    assert.equal(token, 'new-device-token');
    assert.equal(path, '/mobile-gateway/devices/device-2');
    return undefined;
  });
  // pairedStore wrote metadata once; replacement writes it a second time.
  // Fail only the attempted previous-metadata restore, then allow recovery.
  __failAsyncSetOnCall(3);
  await assert.rejects(
    () =>
      store.pair(otherPayload, {
        userId: 7,
        deviceName: 'AJ iPhone',
        replaceExisting: true,
      }),
    (error) =>
      error instanceof PairedHostError &&
      error.kind === 'storageRollbackFailed',
  );
  assert.equal(__secure().get(PAIRED_DEVICE_SECURE_KEY), TOKEN);
  const recoveryMetadata = JSON.parse(
    __async().get(PAIRED_HOST_META_KEY),
  );
  assert.equal(recoveryMetadata.hostId, 'host-1');
  assert.equal(store.snapshot().host.hostId, 'host-1');
  assert.deepEqual(recoveryMetadata.recovery, {
    revokeDevice: false,
    credential: 'previous',
  });
}

// issue-1171 transactional storage: after the old Mac is revoked, a local
// metadata failure revokes the newly minted device and exposes the old host as
// revoked rather than falsely claiming that it remains usable.
{
  __reset();
  const store = await pairedStore();
  const oldMetadata = __async().get(PAIRED_HOST_META_KEY);
  const otherPayload = JSON.stringify({
    gatewayUrl: 'https://other-mac.tail1234.ts.net',
    hostId: 'host-2',
    pairingCode: 'b'.repeat(43),
  });
  __setPublicHandler(async (path) => {
    if (path === '/mobile-gateway/health') return { ...healthResponse, hostId: 'host-2' };
    if (path === '/mobile-gateway/pair') {
      return {
        ...pairResponse,
        deviceId: 'device-2',
        hostId: 'host-2',
        deviceToken: 'new-device-token',
      };
    }
    throw new Error(`unexpected public path ${path}`);
  });
  __setMacHandler(async (path) => {
    assert.equal(path, '/mobile-gateway/devices/device-2');
    return undefined;
  });
  __failAsyncSet();
  await assert.rejects(
    () => store.pair(otherPayload, {
      userId: 7,
      deviceName: 'AJ iPhone',
      replaceExisting: true,
    }),
    (error) => error instanceof PairedHostError && error.kind === 'storage',
  );
  const rollbackRequests = __macRequests().slice(-1);
  assert.deepEqual(
    rollbackRequests.map((request) => request.path),
    ['/mobile-gateway/devices/device-2'],
  );
  assert.equal(store.snapshot().state, 'connected');
  assert.equal(store.snapshot().host.hostId, 'host-1');
  assert.match(store.snapshot().message, /previous pairing is unchanged/i);
  assert.equal(__secure().get(PAIRED_DEVICE_SECURE_KEY), TOKEN);
  assert.equal(__async().get(PAIRED_HOST_META_KEY), oldMetadata);
}

// issue-1171 transactional storage: if the new-device rollback itself fails,
// the store retains the new device identity in memory, clears local credentials,
// and exposes an actionable unhealthy state for owner revocation.
{
  __reset();
  const store = await pairedStore();
  const otherPayload = JSON.stringify({
    gatewayUrl: 'https://other-mac.tail1234.ts.net',
    hostId: 'host-2',
    pairingCode: 'b'.repeat(43),
  });
  __setPublicHandler(async (path) => {
    if (path === '/mobile-gateway/health') return { ...healthResponse, hostId: 'host-2' };
    if (path === '/mobile-gateway/pair') {
      return {
        ...pairResponse,
        deviceId: 'device-2',
        hostId: 'host-2',
        deviceToken: 'new-device-token',
      };
    }
    throw new Error(`unexpected public path ${path}`);
  });
  __setMacHandler(async (path) => {
    if (path === '/mobile-gateway/devices/device-2') {
      throw new Error('new Mac cleanup failed');
    }
    return undefined;
  });
  __failAsyncSet();
  await assert.rejects(
    () => store.pair(otherPayload, {
      userId: 7,
      deviceName: 'AJ iPhone',
      replaceExisting: true,
    }),
    (error) =>
      error instanceof PairedHostError &&
      error.kind === 'storageRollbackFailed',
  );
  assert.equal(store.snapshot().state, 'unhealthy');
  assert.equal(store.snapshot().host.hostId, 'host-1');
  assert.equal(store.snapshot().host.deviceId, 'device-1');
  assert.match(store.snapshot().message, /new Mac.*revoke/i);
  assert.equal(__secure().get(PAIRED_DEVICE_SECURE_KEY), TOKEN);
}

// issue-1171 transactional storage: an initial pairing whose metadata write
// and Keychain rollback both fail must retain an actionable host snapshot
// rather than hiding the credential behind an unpaired state.
{
  __reset();
  __setPublicHandler(async (path) => {
    if (path === '/mobile-gateway/health') return healthResponse;
    if (path === '/mobile-gateway/pair') return pairResponse;
    throw new Error(`unexpected public path ${path}`);
  });
  __setMacHandler(async (path) => {
    assert.equal(path, '/mobile-gateway/devices/device-1');
    return undefined;
  });
  __failAsyncSet();
  __failSecureCleanup();
  const store = new PairedHostStore();
  store.setAccountUserId(7);
  await assert.rejects(
    () => store.pair(PAYLOAD, { userId: 7, deviceName: 'AJ iPhone' }),
    (error) =>
      error instanceof PairedHostError &&
      error.kind === 'storageRollbackFailed',
  );
  assert.equal(store.snapshot().state, 'unhealthy');
  assert.equal(store.snapshot().host.deviceId, 'device-1');
  assert.match(store.snapshot().message, /credential remains in Keychain.*Forget/i);
  assert.equal(__secure().get(PAIRED_DEVICE_SECURE_KEY), TOKEN);
  assert.equal(__async().has(PAIRED_HOST_META_KEY), false);
}

// issue-1171 actions: revoke and forget failures become actionable snapshots
// instead of leaving the UI connected or producing an unhandled rejection.
{
  __reset();
  const revokeStore = await pairedStore();
  __setMacHandler(async () => {
    throw new ApiError({ code: 'NETWORK_ERROR', status: 0, retryable: true });
  });
  await assert.rejects(() => revokeStore.revoke(), PairedHostError);
  assert.equal(revokeStore.snapshot().state, 'tailscaleUnavailable');
  assert.match(revokeStore.snapshot().message, /not revoked.*still active/i);

  __reset();
  const forgetStore = await pairedStore();
  __failSecureCleanup();
  await assert.rejects(() => forgetStore.forget(), PairedHostError);
  assert.equal(forgetStore.snapshot().state, 'unhealthy');
  assert.match(forgetStore.snapshot().message, /credential remains.*retry/i);

  __reset();
  const metadataForgetStore = await pairedStore();
  __failAsyncRemove();
  await assert.rejects(() => metadataForgetStore.forget(), PairedHostError);
  assert.equal(metadataForgetStore.snapshot().state, 'unhealthy');
  assert.match(
    metadataForgetStore.snapshot().message,
    /credential was removed.*details.*retry/i,
  );
  assert.equal(__secure().has(PAIRED_DEVICE_SECURE_KEY), false);
  assert.equal(__async().has(PAIRED_HOST_META_KEY), true);
}

// issue-1171-c3/c6/#1175-c18: explicit revoke calls the Mac with the stored
// Device token, then
// clears both Keychain and secret-free metadata.
{
  __reset();
  const store = await pairedStore();
  __setMacHandler(async () => undefined);
  assert.equal((await store.revoke()).state, 'unpaired');
  assert.equal(__secure().has(PAIRED_DEVICE_SECURE_KEY), false);
  assert.equal(__async().has(PAIRED_HOST_META_KEY), false);
  assert.equal(__macRequests()[0].path, '/mobile-gateway/devices/device-1');
  assert.equal(__macRequests()[0].token, TOKEN);
}

console.log('Paired-host security and state-machine tests passed (22 scenarios)');
