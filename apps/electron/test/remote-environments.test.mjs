// #1374 slice 1 — electron-remote-environment-custody.
// The Device grant issued by /relay/mobile-environments/:id/connect must never reach the renderer:
// this module is the only place in the Electron main process allowed to hold it.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  createRemoteEnvironmentsCustody,
  isAllowedRemoteGatewayRequest,
  registerRemoteEnvironments,
  remoteAttachEnabled,
} from '../src/remote-environments.mjs';

/** @param {number} status @param {unknown} body */
function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function grantStore() {
  /** @type {Buffer | null} */
  let stored = null;
  return {
    loadEncrypted: async () => stored,
    saveEncrypted: async (bytes) => { stored = bytes; },
    clearEncrypted: async () => { stored = null; },
    get raw() { return stored; },
  };
}

const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`enc:${value}`),
  decryptString: (bytes) => bytes.toString('utf8').replace(/^enc:/, ''),
};

const CONNECT_PAYLOAD = {
  environmentId: 'host-1', hostId: 'host-1', deviceId: 'device-1',
  deviceToken: 'super-secret-device-token', gatewayBaseUrl: 'https://relay.example.invalid',
  capabilities: ['remote-attach-desktop-v1'],
};

function makeCustody(overrides = {}) {
  const store = grantStore();
  const calls = [];
  const fetchFn = overrides.fetchFn ?? (async () => { throw new Error('unexpected fetch'); });
  const custody = createRemoteEnvironmentsCustody({
    fetchFn: async (...args) => { calls.push(args); return fetchFn(...args); },
    getProductionApiBase: () => overrides.productionApiBase ?? 'https://api.example.invalid',
    getSessionToken: () => overrides.sessionToken ?? 'main-session-token',
    loadEncrypted: store.loadEncrypted, saveEncrypted: store.saveEncrypted, clearEncrypted: store.clearEncrypted,
    safeStorage: overrides.safeStorage ?? fakeSafeStorage,
    env: overrides.env ?? {},
  });
  return { custody, calls, store };
}

test('isAllowedRemoteGatewayRequest allows exactly the six mobile-gateway operations plus health', () => {
  const allowed = [
    ['GET', '/mobile-gateway/opencode/experimental/session'],
    ['GET', '/mobile-gateway/opencode/session/ses_1/message'],
    ['GET', '/mobile-gateway/sessions/ses_1/events'],
    ['POST', '/mobile-gateway/opencode/session/ses_1/prompt_async'],
    ['POST', '/mobile-gateway/opencode/permission/perm_1/reply'],
    ['POST', '/mobile-gateway/opencode/question/q_1/reply'],
    ['POST', '/mobile-gateway/opencode/session/ses_1/abort'],
    ['GET', '/mobile-gateway/health'],
  ];
  for (const [method, path] of allowed) assert.equal(isAllowedRemoteGatewayRequest(method, path), true, path);
});

test('isAllowedRemoteGatewayRequest rejects every other relay route', () => {
  const denied = [
    ['GET', '/mobile-gateway/devices'],
    ['DELETE', '/mobile-gateway/devices/device-1'],
    ['POST', '/mobile-gateway/pairing-codes'],
    ['GET', '/mobile-environments'],
    ['ALL', '/mobile-gateway/pty/anything'],
    ['GET', '/mobile-gateway/artifacts/some-id'],
    ['POST', '/mobile-gateway/opencode/session/ses_1/prompt_async/../../devices'],
    ['GET', '/mobile-gateway/opencode/experimental/session/../devices'],
  ];
  for (const [method, path] of denied) assert.equal(isAllowedRemoteGatewayRequest(method, path), false, path);
});

test('isAllowedRemoteGatewayRequest allows the message route\'s own before= cursor and rejects every other query shape', () => {
  const path = '/mobile-gateway/opencode/session/ses_1/message';
  assert.equal(isAllowedRemoteGatewayRequest('GET', `${path}?before=msg_20`), true, 'the real relay pagination param must be allowed');
  assert.equal(isAllowedRemoteGatewayRequest('GET', path), true, 'no query string at all must still be allowed');
  assert.equal(isAllowedRemoteGatewayRequest('GET', `${path}?cursor=msg_20`), false, 'cursor is not a relay param for this route');
  assert.equal(isAllowedRemoteGatewayRequest('GET', `${path}?before=msg_20&limit=999`), false, 'no other key may ride alongside before');
  assert.equal(isAllowedRemoteGatewayRequest('GET', `${path}?before=../../etc`), false, 'before must be an opaque id, not a path trick');
  assert.equal(isAllowedRemoteGatewayRequest('GET', `${path}?before=a&before=b`), false, 'a repeated key is rejected outright, not just its first value');
  assert.equal(isAllowedRemoteGatewayRequest('GET', '/mobile-gateway/health?before=msg_20'), false, 'a route with no query contract rejects any query string');
});

test('isAllowedRemoteGatewayRequest rejects protocol-relative and absolute URLs even when the suffix looks allowed', () => {
  assert.equal(isAllowedRemoteGatewayRequest('GET', '//evil.example/mobile-gateway/health'), false);
  assert.equal(isAllowedRemoteGatewayRequest('GET', 'https://evil.example/mobile-gateway/health'), false);
});

test('remoteAttachEnabled defaults on and is disabled only by an explicit 0/false', () => {
  assert.equal(remoteAttachEnabled({}), true);
  assert.equal(remoteAttachEnabled({ RHYTHM_REMOTE_ATTACH: '0' }), false);
  assert.equal(remoteAttachEnabled({ RHYTHM_REMOTE_ATTACH: 'false' }), false);
  assert.equal(remoteAttachEnabled({ RHYTHM_REMOTE_ATTACH: '1' }), true);
});

test('listEnvironments calls production /relay/mobile-environments with the main session bearer', async () => {
  const { custody, calls } = makeCustody({
    fetchFn: async () => jsonResponse(200, { environments: [{ id: 'host-1', name: 'Rhythm Mac', status: 'online', historyAvailable: true }] }),
  });
  const result = await custody.listEnvironments();
  assert.equal(result.state, 'ok');
  assert.equal(result.environments.length, 1);
  assert.equal(calls.length, 1);
  const [url, init] = calls[0];
  assert.equal(String(url), 'https://api.example.invalid/relay/mobile-environments');
  assert.equal(init.headers.Authorization, 'Bearer main-session-token');
});

test('connect stores the device token only via safeStorage and never returns it to the caller', async () => {
  const { custody, calls, store } = makeCustody({ fetchFn: async () => jsonResponse(201, CONNECT_PAYLOAD) });
  const result = await custody.connect('host-1');
  assert.equal(result.state, 'connected');
  assert.equal(result.deviceId, 'device-1');
  assert.equal(JSON.stringify(result).includes('super-secret-device-token'), false, 'device token must not reach the IPC result');
  assert.ok(store.raw, 'grant must be persisted');
  assert.equal(store.raw.toString('utf8').includes('super-secret-device-token'), true);
  assert.equal(store.raw.toString('utf8').startsWith('enc:'), true, 'grant bytes must be the encrypted envelope, not plaintext');
  const [url, init] = calls[0];
  assert.equal(String(url), 'https://api.example.invalid/relay/mobile-environments/host-1/connect');
  assert.equal(init.headers.Authorization, 'Bearer main-session-token');
});

test('connect surfaces a 503 mac-offline response as a distinct state without throwing', async () => {
  const { custody } = makeCustody({ fetchFn: async () => jsonResponse(503, { error: 'mac_offline' }) });
  const result = await custody.connect('host-1');
  assert.equal(result.state, 'offline');
});

test('request rejects a disallowed path before any network call', async () => {
  const { custody, calls } = makeCustody();
  await assert.rejects(() => custody.request({ method: 'GET', path: '/mobile-gateway/devices' }));
  assert.equal(calls.length, 0);
});

test('request attaches the Device token and capability header, and passes through only the project id header', async () => {
  const { store } = makeCustody({ fetchFn: async () => jsonResponse(201, CONNECT_PAYLOAD) });
  await createRemoteEnvironmentsCustody({
    fetchFn: async () => jsonResponse(201, CONNECT_PAYLOAD),
    getProductionApiBase: () => 'https://api.example.invalid', getSessionToken: () => 'main-session-token',
    loadEncrypted: store.loadEncrypted, saveEncrypted: store.saveEncrypted, clearEncrypted: store.clearEncrypted,
    safeStorage: fakeSafeStorage, env: {},
  }).connect('host-1');
  const captured = [];
  const forwarding = createRemoteEnvironmentsCustody({
    fetchFn: async (url, init) => { captured.push([url, init]); return jsonResponse(200, { ok: true }); },
    getProductionApiBase: () => 'https://api.example.invalid', getSessionToken: () => 'main-session-token',
    loadEncrypted: store.loadEncrypted, saveEncrypted: store.saveEncrypted, clearEncrypted: store.clearEncrypted,
    safeStorage: fakeSafeStorage, env: {},
  });
  const result = await forwarding.request({
    method: 'GET', path: '/mobile-gateway/opencode/experimental/session',
    headers: { 'X-Rhythm-Project-ID': 'project-1', 'X-Evil-Header': 'nope' },
  });
  assert.equal(result.state, 'ok');
  const [url, init] = captured[0];
  assert.equal(String(url), 'https://relay.example.invalid/relay/mobile-gateway/opencode/experimental/session');
  assert.equal(init.headers.Authorization, 'Device super-secret-device-token');
  assert.equal(init.headers['X-Rhythm-Client-Capability'], 'remote-attach-desktop-v1');
  assert.equal(init.headers['X-Rhythm-Project-ID'], 'project-1');
  assert.equal(init.headers['X-Evil-Header'], undefined);
});

test('a 401 from a forwarded request clears the stored grant and reports revoked', async () => {
  const { custody, store } = makeCustody({ fetchFn: async () => jsonResponse(201, CONNECT_PAYLOAD) });
  await custody.connect('host-1');
  assert.ok(store.raw);
  const revoking = createRemoteEnvironmentsCustody({
    fetchFn: async () => jsonResponse(401, { error: 'revoked' }),
    getProductionApiBase: () => 'https://api.example.invalid',
    getSessionToken: () => 'main-session-token',
    loadEncrypted: () => Promise.resolve(store.raw),
    saveEncrypted: async () => {},
    clearEncrypted: async () => { store.raw !== null && (await store.clearEncrypted()); },
    safeStorage: fakeSafeStorage, env: {},
  });
  const result = await revoking.request({ method: 'GET', path: '/mobile-gateway/opencode/experimental/session' });
  assert.equal(result.state, 'revoked');
  assert.equal(store.raw, null);
});

test('the kill switch disables every handler and makes no network call even with a stored grant', async () => {
  const { custody, calls } = makeCustody({ env: { RHYTHM_REMOTE_ATTACH: '0' }, fetchFn: async () => jsonResponse(200, {}) });
  assert.deepEqual(await custody.listEnvironments(), { state: 'disabled' });
  assert.deepEqual(await custody.connect('host-1'), { state: 'disabled' });
  assert.deepEqual(await custody.request({ method: 'GET', path: '/mobile-gateway/health' }), { state: 'disabled' });
  assert.deepEqual(await custody.subscribe('ses_1', () => {}), { state: 'disabled' });
  assert.equal(calls.length, 0);
});

test('subscribe streams chunks to the caller and stop() ends the stream', async () => {
  const encoder = new TextEncoder();
  let aborted = false;
  const grant = { hostId: 'host-1', deviceId: 'device-1', deviceToken: 'super-secret-device-token', gatewayBaseUrl: 'https://relay.example.invalid' };
  const streamed = [];
  const withGrant = createRemoteEnvironmentsCustody({
    fetchFn: async (_url, init) => {
      init.signal.addEventListener('abort', () => { aborted = true; });
      return { ok: true, status: 200, body: (async function* () { yield encoder.encode('data: {"type":"session.status"}\n\n'); })() };
    },
    getProductionApiBase: () => 'https://api.example.invalid', getSessionToken: () => 'main-session-token',
    loadEncrypted: async () => Buffer.from(`enc:${JSON.stringify(grant)}`), saveEncrypted: async () => {}, clearEncrypted: async () => {},
    safeStorage: fakeSafeStorage, env: {},
  });
  const result = await withGrant.subscribe('ses_1', (chunk) => streamed.push(chunk));
  assert.equal(result.state, 'ok');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(streamed.join(''), 'data: {"type":"session.status"}\n\n');
  result.stop();
  assert.equal(aborted, true);
});

test('subscribe rejects a session id that would build a disallowed path', async () => {
  const { custody, calls } = makeCustody({ fetchFn: async () => jsonResponse(201, CONNECT_PAYLOAD) });
  await custody.connect('host-1');
  await assert.rejects(() => custody.subscribe('../devices', () => {}));
  assert.equal(calls.length, 1, 'only the connect() call should have reached the network');
});

// --- registerRemoteEnvironments: IPC sender validation + SSE fan-out ---

function fakeWebContents(url = 'rhythm://app/index.html#/agents') {
  const emitter = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    mainFrame: { url },
    sent: [],
    send(channel, payload) { this.sent.push([channel, payload]); },
  });
  return emitter;
}

function fakeIpcMain() {
  const handlers = new Map();
  return { handle: (channel, fn) => handlers.set(channel, fn), handlers };
}

test('registerRemoteEnvironments rejects an event whose sender is not the owned main window document', async () => {
  const contents = fakeWebContents();
  const otherContents = fakeWebContents();
  const window = { webContents: contents, isDestroyed: () => false };
  const ipcMain = fakeIpcMain();
  const custody = { listEnvironments: async () => ({ state: 'ok', environments: [] }) };
  registerRemoteEnvironments({ ipcMain, getWindow: () => window, custody });
  const list = ipcMain.handlers.get('remote-env:list');
  await assert.rejects(() => Promise.resolve(list({ sender: otherContents, senderFrame: otherContents.mainFrame })));
  const result = await list({ sender: contents, senderFrame: contents.mainFrame });
  assert.deepEqual(result, { state: 'ok', environments: [] });
});

test('registerRemoteEnvironments streams subscribe chunks only to the requesting webContents and stops on destroy', async () => {
  const contents = fakeWebContents();
  const window = { webContents: contents, isDestroyed: () => false };
  const ipcMain = fakeIpcMain();
  let stopped = false;
  let onChunk, onEnd;
  const custody = {
    subscribe: async (_sessionId, chunkCallback, endCallback) => { onChunk = chunkCallback; onEnd = endCallback; return { state: 'ok', stop: () => { stopped = true; } }; },
  };
  registerRemoteEnvironments({ ipcMain, getWindow: () => window, custody });
  const subscribe = ipcMain.handlers.get('remote-env:subscribe');
  const result = await subscribe({ sender: contents, senderFrame: contents.mainFrame }, 'ses_1');
  assert.equal(result.state, 'ok');
  onChunk('hello');
  assert.deepEqual(contents.sent.at(-1), ['remote-env:sse-chunk', { sessionId: 'ses_1', chunk: 'hello' }]);
  contents.emit('destroyed');
  assert.equal(stopped, true);
});

test('registerRemoteEnvironments forwards a natural stream end (not just an explicit stop) to the renderer', async () => {
  const contents = fakeWebContents();
  const window = { webContents: contents, isDestroyed: () => false };
  const ipcMain = fakeIpcMain();
  let onEnd;
  const custody = {
    subscribe: async (_sessionId, _chunkCallback, endCallback) => { onEnd = endCallback; return { state: 'ok', stop: () => {} }; },
  };
  registerRemoteEnvironments({ ipcMain, getWindow: () => window, custody });
  const subscribe = ipcMain.handlers.get('remote-env:subscribe');
  await subscribe({ sender: contents, senderFrame: contents.mainFrame }, 'ses_1');
  onEnd(); // the relay/uplink dropped the connection on its own, no unsubscribe was called
  assert.deepEqual(contents.sent.at(-1), ['remote-env:sse-end', { sessionId: 'ses_1' }]);
});
