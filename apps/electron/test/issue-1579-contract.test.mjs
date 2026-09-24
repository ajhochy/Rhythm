import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const main = await readFile(resolve(root, 'src/main.mjs'), 'utf8');
const preload = await readFile(resolve(root, 'src/preload.cjs'), 'utf8');
// Test-only source mutation in VM memory; never edits the frozen product file.
const mutations = {
  M1: ['activeLookups >= 4', 'activeLookups >= 1'],
  M2: ['now - old.created > 300_000', 'now - old.created > 600_000'],
  M3: ['admissionTimes.length >= 20', 'admissionTimes.length >= 1'],
  M4: ['agentTargets.size >= 100', 'agentTargets.size >= 1'],
  M5: ['data.session?.id !== entry.sessionId', 'false'],
  M6: ['agentViewing.displayed && agentViewing.sessionId', 'false && agentViewing.sessionId'],
  M7: ['if (mainWindow.isMinimized()) mainWindow.restore();', 'if (false) mainWindow.restore();'],
  M8: ['mainWindow.show(); mainWindow.focus();', 'mainWindow.focus();'],
  M9: ['if (!agentReady) { queuedAgentActivation = entry;', 'if (agentReady) { queuedAgentActivation = entry;'],
  M10: ['while (activeLookups < 4 && waitingLookups.length)', 'while (false && waitingLookups.length)'],
  M11: ['entry.notification !== notification', 'entry.notification === notification'],
};
const mutation = process.env.RHYTHM_1579_MUTANT && mutations[process.env.RHYTHM_1579_MUTANT];
if (process.env.RHYTHM_1579_MUTANT && !mutation) throw new Error('Unknown test-only mutant');
if (mutation && !main.includes(mutation[0])) throw new Error('Mutation anchor missing');
const fixtureSource = mutation ? main.replaceAll(mutation[0], mutation[1]) : main;

test('issue-1579-c1: completion needs a distinct host-owned native notification bridge', () => {
  // Regression: in-app session state changes without ever reaching macOS Notification Center.
  assert.equal(main.includes('rhythm:agent-notifications:sync'), true);
});

test('issue-1579-c2: pending agent decisions cross a narrow preload event bridge', () => {
  // Regression: a question remains visible in the transcript but cannot notify in the background.
  assert.equal(preload.includes('rhythm:agent-notifications'), true);
});

test('issue-1579-c5: first arm requests a main-owned permission probe without granting renderer permission', () => {
  // Regression: renderer denial is substituted for the required main-owned permission request path.
  assert.equal(main.includes('callback(notificationPermission)'), false);
  assert.equal(main.includes('globalThis.Notification.requestPermission()'), false);
  assert.equal(main.includes("item.type === 'arm'"), true);
  assert.equal(main.includes('primeAgentNotificationPermission'), true);
  assert.equal(main.includes('rhythm:agent-notifications:permission'), true);
  assert.equal(preload.includes('rhythm:agent-notifications:permission'), true);
});

async function hostFixture({ fetcher, supported = true, supportThrow = false, focused = false, visible = true, minimized = false, nativeThrow = false, nativeFailure, apiBase = 'http://127.0.0.1:6298' } = {}) {
  const listeners = new Map(), handlers = new Map(), shown = [], requests = [], windows = [], permissions = {}, actions = [], sent = [], timers = [];
  const state = { focused, visible, minimized };
  const contents = Object.assign(new EventEmitter(), {
    mainFrame: { url: 'rhythm://app/index.html#/agents' },
    isDestroyed: () => false, setWindowOpenHandler() {}, send(channel, payload) { sent.push({ channel, payload }); }, executeJavaScript: async () => {},
  });
  class Window extends EventEmitter {
    static getAllWindows() { return windows; }
    constructor() { super(); this.webContents = contents; windows.push(this); }
    isDestroyed() { return Boolean(this.destroyed); }
    destroy() { this.destroyed = true; }
    isFocused() { return state.focused; }
    isVisible() { return state.visible; }
    isMinimized() { return state.minimized; }
    restore() { actions.push('restore'); state.minimized = false; }
    show() { actions.push('show'); state.visible = true; }
    focus() { actions.push('focus'); state.focused = true; }
    async loadURL(url) { actions.push(String(url)); contents.emit('did-finish-load'); }
  }
  class Native extends EventEmitter {
    static isSupported() { if (supportThrow) throw new Error('support probe unavailable'); return supported; }
    constructor(options) { super(); this.options = options; }
    show() {
      if (nativeThrow) throw new Error('notification unavailable');
      shown.push(this);
      if (nativeFailure) this.emit('failed', {}, nativeFailure); else this.emit('show', {});
    }
    close() { this.closed = true; }
  }
  const app = Object.assign(new EventEmitter(), {
    getPath: () => '/fixture', setPath() {}, requestSingleInstanceLock: () => true,
    isReady: () => false, whenReady: async () => {}, getVersion: () => 'test', quit() {}, exit() {},
  });
  const file = new URL('../src/main.mjs', import.meta.url);
  const clock = { now: Date.now() };
  const ClockDate = class extends Date { static now() { return clock.now; } };
  const fixtureSetTimeout = (callback, delay, ...args) => {
    if (delay === 300_000) {
      const timer = { callback, args, active: true, unref() {} };
      timers.push(timer);
      return timer;
    }
    return setTimeout(callback, delay, ...args);
  };
  const fixtureClearTimeout = (timer) => {
    if (timers.includes(timer)) timer.active = false; else clearTimeout(timer);
  };
  const context = createContext({ Date: ClockDate, process: Object.assign(new EventEmitter(), {
    argv: ['--interactive-smoke', '--allow-test-runtime-ports'], env: { RHYTHM_SHELL_USER_DATA: '/fixture', RHYTHM_LIVE_API_URL: apiBase },
    cwd: () => '/fixture', stdout: { write() {} }, stderr: { write() {} }, platform: 'darwin',
  }), URL, Response, Headers, AbortSignal, TextDecoder, Buffer, console, setTimeout: fixtureSetTimeout, clearTimeout: fixtureClearTimeout,
  fetch: fetcher ?? (async (url, init) => {
    requests.push({ url: String(url), authorization: new Headers(init.headers).get('authorization'), redirect: init.redirect });
    return new Response(JSON.stringify({ session: { id: '18aa886d-0f9e-4530-ac35-767bf3d1ce91', name: 'Synthetic session' }, messages: [], transcriptPage: { nextCursor: null, hasMore: false } }), { status: 200 });
  }) });
  const module = new SourceTextModule(fixtureSource, { context, initializeImportMeta(meta) { meta.dirname = '/fixture'; } });
  await module.link(async (name) => {
    let values;
    if (name === 'electron') values = { app, BrowserWindow: Window, ipcMain: { on: (key, fn) => listeners.set(key, fn), handle: (key, fn) => handlers.set(key, fn) }, net: {}, Notification: Native, protocol: { registerSchemesAsPrivileged() {}, handle() {} }, safeStorage: { isEncryptionAvailable: () => false }, session: { defaultSession: Object.assign(new EventEmitter(), { setPermissionRequestHandler(fn) { permissions.request = fn; }, setPermissionCheckHandler(fn) { permissions.check = fn; } }) }, shell: {}, dialog: { showMessageBox: async () => ({ response: 1 }) } };
    else if (name === './agent-server.mjs') values = { AgentServerService: class {}, AGENT_SERVER_BASE_URL: 'http://127.0.0.1:6298', AGENT_SERVER_ENGINE_PORT: 6297, electronDbPath: () => '/fixture/db', legacyFlutterDbPath: () => '/fixture/old' };
    else if (name === './hermes-server.mjs') values = { createHermesSupervisor: () => ({ getStatus: () => ({ state: 'disabled' }), onStatus() {}, stop: async () => {} }) };
    else if (name === './desktop-google-oauth.mjs') values = { runDesktopGoogleOAuth: async () => ({ sessionToken: 'fixture-token', user: { id: 1 } }) };
    else if (name === './hermes-view.mjs') values = { registerHermesView: () => ({ disposeCurrent: async () => {}, dispose: async () => {} }), bindHermesViewSupervisor() {} };
    else if (name === './production-api-config.mjs') values = { createProductionApiConfig: () => ({ load: () => 'https://example.invalid' }), createProductionApiSetHandler: () => () => {} };
    else { values = { ...await import(name.startsWith('.') ? new URL(name, file).href : name) }; if (name === 'node:fs') values.existsSync = () => true; }
    return new SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
  });
  await module.evaluate();
  await new Promise((resolveTick) => setImmediate(resolveTick));
  return {
    app, contents, listeners, handlers, shown, requests, windows, permissions, actions, sent, timers, state, clock,
    runCompletionTimers: () => { for (const timer of timers) if (timer.active) { timer.active = false; timer.callback(...timer.args); } },
    signin: () => handlers.get('rhythm:auth:google-sign-in')({ sender: contents, senderFrame: contents.mainFrame }),
    send: (detail, event = { sender: contents, senderFrame: contents.mainFrame }, ...extras) => listeners.get('rhythm:agent-notifications:sync')?.(event, detail, ...extras),
  };
}

const sessionId = '18aa886d-0f9e-4530-ac35-767bf3d1ce91';
const ask = { v: 1, type: 'ask', family: 'permission', sessionId, requestId: 'perm_1' };
const tick = () => new Promise((done) => setImmediate(done));
const envelope = (id = sessionId, name = 'Authorized') => Response.json({ session: { id, name }, messages: [], transcriptPage: { hasMore: false, nextCursor: null } });
const permissionStatuses = (host) => host.sent
  .filter(({ channel }) => channel === 'rhythm:agent-notifications:permission')
  .map(({ payload }) => payload.status);

test('issue-1579-c5: the first arm performs one macOS show probe and reports the observed result', async () => {
  // Regression: arming only changes renderer state, so macOS never gets the first Notification that triggers its permission prompt.
  const host = await hostFixture();
  host.send({ v: 1, type: 'arm', sessionId });
  assert.deepEqual(host.shown.map(({ options }) => ({ ...options })), [{ title: 'Rhythm notifications', body: 'Agent completion and question alerts are enabled.' }]);
  assert.deepEqual(permissionStatuses(host), ['unknown', 'granted']);
  host.send({ v: 1, type: 'arm', sessionId });
  assert.equal(host.shown.length, 1, 'later arms report status without showing another permission probe');
  assert.equal(permissionStatuses(host).at(-1), 'granted');
});

test('issue-1579-c5: denied, unknown-error and unsupported permission probes fail soft', async () => {
  // Regression: an OS denial or unsupported Notification implementation throws through the arm/session flow.
  const denied = await hostFixture({ nativeFailure: 'Permission denied by system' });
  assert.doesNotThrow(() => denied.send({ v: 1, type: 'arm', sessionId }));
  assert.equal(permissionStatuses(denied).at(-1), 'denied');

  const unknown = await hostFixture({ nativeThrow: true });
  assert.doesNotThrow(() => unknown.send({ v: 1, type: 'arm', sessionId }));
  assert.equal(permissionStatuses(unknown).at(-1), 'unknown');

  const unsupported = await hostFixture({ supported: false });
  assert.doesNotThrow(() => unsupported.send({ v: 1, type: 'arm', sessionId }));
  assert.deepEqual(permissionStatuses(unsupported), ['unsupported']);

  const supportError = await hostFixture({ supportThrow: true });
  assert.doesNotThrow(() => supportError.send({ v: 1, type: 'arm', sessionId }));
  assert.deepEqual(permissionStatuses(supportError), ['unknown']);
});

test('issue-1579-c2: a trusted ask produces fixed native text after an authorized lookup', async () => {
  // Regression: a renderer ask reaches IPC but never produces an authorized native presentation.
  const { contents, listeners, shown, requests, signin, send } = await hostFixture();
  await signin();
  assert.equal(typeof listeners.get('rhythm:agent-notifications:sync'), 'function', 'trusted main must install the agent IPC handler');
  send(ask); await tick();
  assert.deepEqual(requests, [{ url: `http://127.0.0.1:6298/agent-sessions/${sessionId}?transcriptLimit=0`, authorization: null, redirect: 'error' }]);
  assert.deepEqual(shown.map((item) => ({ ...item.options })), [{ title: 'Synthetic session — Permission requested', body: 'An agent is waiting for your permission.' }]);
});

test('issue-1579-c2: ownership lookup excludes a large transcript from the bounded response', async () => {
  // Regression: transcriptLimit=1 returns one arbitrarily large final message and the 64 KiB guard suppresses its notification.
  const requests = [];
  const host = await hostFixture({ fetcher: async (url) => {
    requests.push(String(url));
    if (!String(url).endsWith('?transcriptLimit=0')) {
      return Response.json({ session: { id: sessionId, name: 'Large transcript' }, messages: [{ text: 'x'.repeat(70_000) }], transcriptPage: { hasMore: false, nextCursor: null } });
    }
    return envelope(sessionId, 'Large transcript');
  } });
  await host.signin(); host.send(ask); await tick();
  assert.deepEqual(requests, [`http://127.0.0.1:6298/agent-sessions/${sessionId}?transcriptLimit=0`]);
  assert.equal(host.shown.at(-1)?.options.title, 'Large transcript — Permission requested');
});

test('issue-1579-c3: repeated and resolved asks never reappear, separate questions remain', async () => {
  // Regression: dismissal or resolution can recreate the same native ask.
  const host = await hostFixture(); await host.signin();
  host.send(ask); host.send(ask); await tick();
  assert.equal(host.shown.length, 1);
  host.send({ ...ask, type: 'resolve' });
  assert.equal(host.shown[0].closed, true);
  host.send(ask); host.send({ ...ask, family: 'question' }); await tick();
  assert.equal(host.shown.length, 2);
});

test('issue-1579-c4: click waits for ready, routes once, retires, and a re-armed completion can route again', async () => {
  // Regression: a pre-ready click is lost, or a retired completion routes repeatedly and consumes registry capacity.
  const host = await hostFixture(); await host.signin();
  host.send({ v: 1, type: 'completion', sessionId }); await tick();
  assert.equal(host.shown.length, 1);
  const paths = [];
  host.windows[0].loadURL = async (url) => { paths.push(String(url)); };
  host.shown[0].emit('click');
  assert.equal(paths.length, 0);
  host.send({ v: 1, type: 'ready' }); await tick();
  assert.match(paths[0], /sessionId=18aa886d-0f9e-4530-ac35-767bf3d1ce91&activation=1/);
  host.shown[0].emit('click'); await tick();
  assert.equal(paths.length, 1, 'retired presentation cannot route a second time');
  host.send({ v: 1, type: 'arm', sessionId });
  host.send({ v: 1, type: 'completion', sessionId }); await tick();
  const completion = host.shown.filter(({ options }) => options.title === 'Agent finished').at(-1);
  completion.emit('click'); await tick();
  assert.match(paths[1], /activation=2/);
});

test('issue-1579-c6: malformed and unauthenticated payloads cannot fetch or show', async () => {
  // Regression: a foreign frame, extra renderer text, or missing bearer can reach native UI.
  const host = await hostFixture();
  host.send(ask); host.send({ ...ask, body: 'injected' });
  host.send(ask, { sender: host.contents, senderFrame: { url: 'rhythm://app/index.html' } });
  await tick();
  assert.equal(host.requests.length, 0);
  assert.equal(host.shown.length, 0);
  await host.signin();
  host.send(ask); await tick();
  assert.equal(host.requests.length, 1, 'valid control demonstrates that malformed rejection is not inert wiring');
});

test('issue-1579-c8: signed-out session invalidates pending click and native presentation', async () => {
  // Regression: prior-user clicks can navigate a new signed-in document.
  const host = await hostFixture(); await host.signin();
  host.send(ask); await tick();
  assert.equal(host.shown.length, 1);
  await host.handlers.get('rhythm:auth:logout')({ sender: host.contents, senderFrame: host.contents.mainFrame });
  assert.equal(host.shown[0].closed, true);
});

for (const status of [401, 403, 404, 'mismatch', 'redirect']) test(`issue-1579-c6: ${status} lookup fails closed without retry or presentation`, async () => {
  // Regression: a denied/mismatched lookup can be retried anonymously or displayed anyway.
  const requests = [];
  const host = await hostFixture({ fetcher: async (url, init) => {
    requests.push({ url: String(url), bearer: new Headers(init.headers).get('authorization'), redirect: init.redirect });
    if (status === 'redirect') throw new TypeError('redirect:error');
    const response = envelope(status === 'mismatch' ? 'other' : sessionId);
    return typeof status === 'number' ? new Response(response.body, { status }) : response;
  } });
  await host.signin(); host.send(ask); await tick();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].bearer, null);
  assert.equal(requests[0].redirect, 'error');
  assert.equal(host.shown.length, 0);
});

test('issue-1579-c6: closed IPC rejects extra keys, invalid IDs, subframes and foreign documents', async () => {
  // Regression: an owned top-level React surface gains an arbitrary title/body or cross-frame primitive.
  const host = await hostFixture(); await host.signin();
  for (const detail of [[ask], { ...ask, title: 'inject' }, { ...ask, requestId: 'bad/id' }, { ...ask, requestId: 'x'.repeat(3000) }]) host.send(detail);
  host.send(ask, { sender: host.contents, senderFrame: { url: 'rhythm://app/index.html#/agents' } });
  host.send(ask, { sender: {}, senderFrame: host.contents.mainFrame });
  assert.equal(host.requests.length, 0);
  assert.equal(host.shown.length, 0);
});

test('issue-1579-c3: resolve during pending lookup invalidates its later response', async () => {
  // Regression: a network response arriving after resolution creates a stale native alert.
  let release;
  const host = await hostFixture({ fetcher: () => new Promise(done => { release = done; }) });
  await host.signin(); host.send(ask); host.send({ ...ask, type: 'resolve' });
  release(envelope());
  await tick();
  assert.equal(host.shown.length, 0);
});

test('issue-1579-c2: exact displayed transcript suppresses asks but never completions', async () => {
  // Regression: background asks are lost or completions suppressed by foreground transcript state.
  const host = await hostFixture({ focused: true }); await host.signin();
  host.send({ v: 1, type: 'viewing', sessionId, displayed: true });
  host.send(ask); await tick();
  assert.equal(host.shown.length, 0);
  host.send({ v: 1, type: 'completion', sessionId }); await tick();
  assert.equal(host.shown.length, 1);
  assert.equal(host.shown[0].options.title, 'Agent finished');
});

test('issue-1579-c8: no more than four authenticated lookups can be in flight', async () => {
  // Regression: owned renderer floods local API with unbounded notification lookup work.
  let started = 0;
  const host = await hostFixture({ fetcher: () => { started++; return new Promise(() => {}); } });
  await host.signin();
  for (let i = 0; i < 20; i++) host.send({ ...ask, requestId: `p_${i}` });
  assert.equal(started, 4);
});

test('issue-1579-t1: queued asks drain FIFO, preserve pending targets and never expire visible entries', async () => {
  // Regression: overflow drops an ask and a five-minute clock removes a still-pending OS entry.
  const releases = []; const started = [];
  const host = await hostFixture({ fetcher: (url) => { started.push(String(url)); return new Promise(done => releases.push(done)); } });
  await host.signin();
  for (let i = 0; i < 5; i++) host.send({ ...ask, requestId: `p_${i}` });
  assert.equal(started.length, 4);
  releases[0](envelope());
  await tick(); await tick();
  assert.equal(started.length, 5);
  assert.match(started[4], new RegExp(sessionId), 'fifth request is for the pending session');
  assert.equal(host.shown.length, 1);
  const first = host.shown[0];
  host.clock.now += 600_000;
  host.send({ ...ask, requestId: 'later' });
  assert.equal(first.closed, undefined);
  releases[1](envelope()); releases[2](envelope()); releases[3](envelope());
  await tick(); await tick();
  assert.equal(host.shown.length, 4);
  releases[4](envelope()); await tick();
  assert.equal(host.shown.length, 5, 'pending fifth ask still presents after 600 seconds');
});

test('issue-1579-t2: known resolve survives unknown resolve flood while admission stays bounded', async () => {
  // Regression: unknown IDs evict a real pending notification, or consume unlimited tombstones.
  const host = await hostFixture(); await host.signin(); host.send(ask); await tick();
  for (let i = 0; i < 150; i++) host.send({ ...ask, type: 'resolve', requestId: `unknown_${i}` });
  host.send({ ...ask, type: 'resolve' });
  assert.equal(host.shown[0].closed, true);
  host.send(ask); await tick();
  assert.equal(host.shown.length, 1);
});

test('issue-1579-t3: malformed envelopes, extra IPC args and abandoned response bodies fail closed', async () => {
  // Regression: a malformed lookup or extra IPC parameter creates native UI; failed responses leak streams.
  let cancelled = false;
  const host = await hostFixture({ fetcher: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 404 }) });
  await host.signin(); host.send(ask, undefined, { title: 'injected' });
  await tick(); assert.equal(host.shown.length, 0);
  host.send(ask); await tick();
  assert.equal(cancelled, true);
  const malformed = await hostFixture({ fetcher: async () => Response.json({ session: { id: sessionId }, messages: {}, transcriptPage: {} }) });
  await malformed.signin(); malformed.send(ask); await tick();
  assert.equal(malformed.shown.length, 0);
});

test('issue-1579-t4: deny renderer notifications but keep the prior non-notification permission policy', async () => {
  // Regression: blanket deny breaks clipboard Copy in a packaged owned app.
  const host = await hostFixture();
  let result;
  host.permissions.request(host.contents, 'notifications', value => { result = value; });
  assert.equal(result, false);
  assert.equal(host.permissions.check(host.contents, 'notifications'), false);
  host.permissions.request(host.contents, 'clipboard-sanitized-write', value => { result = value; });
  assert.equal(result, true);
  assert.equal(host.permissions.check(host.contents, 'clipboard-sanitized-write'), true);
  assert.equal(host.permissions.check({}, 'clipboard-sanitized-write'), false);
});

test('issue-1579-t5: native show errors fail soft', async () => {
  const host = await hostFixture({ nativeThrow: true }); await host.signin(); host.send(ask); await tick();
  assert.equal(host.shown.length, 0);
});

test('issue-1579-t6: a configured remote API cannot receive a bearer or an anonymous existence probe', async () => {
  // Regression: a remote-origin override exfiltrates local session IDs or the cloud sign-in token.
  const host = await hostFixture({ apiBase: 'https://cloud.example.test' }); await host.signin(); host.send(ask); await tick();
  assert.equal(host.requests.length, 0);
  assert.equal(host.shown.length, 0);
});

test('issue-1579-t7: unsupported native notifications fail soft without a presentation', async () => {
  const host = await hostFixture({ supported: false }); await host.signin(); host.send(ask); await tick();
  assert.equal(host.requests.length, 1);
  assert.equal(host.shown.length, 0);
});

test('issue-1579-t8: unknown resolve tombstone blocks replay until strictly beyond 300 seconds', async () => {
  const host = await hostFixture(); await host.signin();
  host.send({ ...ask, type: 'resolve' }); host.send(ask); await tick();
  assert.equal(host.requests.length, 0);
  host.clock.now += 300_000; host.send(ask); await tick();
  assert.equal(host.requests.length, 0, 'boundary at 300000 ms is still a tombstone');
  host.clock.now++; host.send({ ...ask, type: 'resolve', requestId: 'sweep' }); host.send(ask); await tick();
  assert.equal(host.requests.length, 1);
  assert.equal(host.shown.length, 1);
});

test('issue-1579-t9: multiple queued lookups drain FIFO and resolved queue entries never show', async () => {
  const releases = []; const host = await hostFixture({ fetcher: () => new Promise(done => releases.push(done)) });
  await host.signin();
  for (let i = 0; i < 7; i++) host.send({ ...ask, requestId: `queue_${i}` });
  assert.equal(releases.length, 4);
  host.send({ ...ask, type: 'resolve', requestId: 'queue_4' });
  releases[0](envelope()); await tick(); await tick();
  assert.equal(releases.length, 5, 'queue_5 must start after resolved queue_4');
  releases[1](envelope()); await tick(); await tick();
  assert.equal(releases.length, 6, 'queue_6 must start next');
  for (const release of releases.slice(2)) release(envelope());
  await tick(); await tick();
  assert.equal(host.shown.length, 6);
  host.send({ ...ask, requestId: 'queue_4' }); await tick();
  assert.equal(releases.length, 6, 'resolved queued ask retains its identity');
});

test('issue-1579-t10: exactly twenty admissions per minute and recovery at 60001 ms', async () => {
  const host = await hostFixture(); await host.signin();
  for (let i = 0; i < 21; i++) host.send({ ...ask, requestId: `rate_${i}` });
  await tick();
  assert.equal(host.requests.length, 20);
  assert.equal(host.shown.length, 20);
  host.clock.now += 60_001;
  host.send({ ...ask, requestId: 'rate_20' }); await tick();
  assert.equal(host.requests.length, 21);
  assert.equal(host.shown.length, 21);
});

test('issue-1579-t11: 100 live retained targets cannot be evicted; tombstones can', async () => {
  const host = await hostFixture(); await host.signin();
  for (let minute = 0; minute < 5; minute++) {
    for (let i = 0; i < 20; i++) host.send({ ...ask, requestId: `live_${minute}_${i}` });
    await tick(); host.clock.now += 60_001;
  }
  assert.equal(host.shown.length, 100);
  host.send({ ...ask, requestId: 'overflow' }); await tick();
  assert.equal(host.shown.length, 100);
  assert.equal(host.requests.length, 100);
  host.send({ ...ask, type: 'resolve', requestId: 'live_0_0' });
  assert.equal(host.shown[0].closed, true);
  host.send({ ...ask, requestId: 'overflow' }); await tick();
  assert.equal(host.shown.length, 101);
  host.send({ ...ask, requestId: 'live_0_0' }); await tick();
  assert.equal(host.shown.length, 101, 'evicted tombstone cannot bypass admission of a live full registry');
});

test('issue-1579-c3: one hundred dismissed completions retire outside the pending-ask cap', async () => {
  // Regression: closed completion presentations remain valid forever, so 100 distinct sessions block every later notification.
  const host = await hostFixture({ fetcher: async (url) => {
    const id = decodeURIComponent(new URL(String(url)).pathname.split('/').at(-1));
    return envelope(id, `Session ${id}`);
  } });
  await host.signin();
  for (let i = 0; i < 100; i++) {
    if (i > 0 && i % 20 === 0) host.clock.now += 60_001;
    const id = `session_${i}`;
    host.send({ v: 1, type: 'arm', sessionId: id });
    host.send({ v: 1, type: 'completion', sessionId: id });
    await tick();
    host.shown.filter(({ options }) => options.title === 'Agent finished').at(-1).emit('close');
  }
  host.clock.now += 60_001;
  host.send({ v: 1, type: 'arm', sessionId: 'session_100' });
  host.send({ v: 1, type: 'completion', sessionId: 'session_100' });
  await tick();
  assert.equal(host.shown.filter(({ options }) => options.title === 'Agent finished').length, 101);
});

test('issue-1579-c3: completion TTL retires its presentation without resolving pending asks', async () => {
  // Regression: a completion that never emits close remains in the live-target registry indefinitely.
  const host = await hostFixture(); await host.signin();
  host.send({ v: 1, type: 'arm', sessionId });
  host.send({ v: 1, type: 'completion', sessionId }); await tick();
  const first = host.shown.filter(({ options }) => options.title === 'Agent finished')[0];
  host.runCompletionTimers();
  assert.equal(first.closed, true);
  host.send({ v: 1, type: 'arm', sessionId });
  host.send({ v: 1, type: 'completion', sessionId }); await tick();
  assert.equal(host.shown.filter(({ options }) => options.title === 'Agent finished').length, 2);
});

test('issue-1579-t12: valid response ID mismatch retires target without showing', async () => {
  const host = await hostFixture({ fetcher: async () => envelope('different') });
  await host.signin(); host.send(ask); await tick();
  assert.equal(host.shown.length, 0);
  assert.equal(host.requests.length, 0, 'custom boundary does not record requests');
  host.send(ask); await tick();
  assert.equal(host.shown.length, 0, 'mismatched target remains retired');
});

test('issue-1579-t13: suppression is rechecked after lookup, and hidden window may show', async () => {
  let release;
  const host = await hostFixture({ fetcher: () => new Promise(done => { release = done; }), focused: false });
  await host.signin(); host.send({ ...ask, requestId: 'delayed' });
  host.state.focused = true;
  host.send({ v: 1, type: 'viewing', sessionId, displayed: true });
  release(envelope()); await tick();
  assert.equal(host.shown.length, 0);
  host.state.visible = false;
  host.send({ ...ask, requestId: 'hidden' }); release(envelope()); await tick();
  assert.equal(host.shown.length, 1);
});

test('issue-1579-t14: minimized click restores, shows, focuses and routes only after ready', async () => {
  const host = await hostFixture({ minimized: true, focused: false, visible: false });
  await host.signin(); host.send({ v: 1, type: 'completion', sessionId }); await tick();
  host.actions.length = 0;
  host.shown[0].emit('click');
  assert.deepEqual(host.actions, ['restore', 'show', 'focus']);
  host.send({ v: 1, type: 'ready' }); await tick();
  assert.deepEqual(host.actions.slice(3, 5), ['show', 'focus']);
  assert.match(host.actions[5], /sessionId=18aa886d-0f9e-4530-ac35-767bf3d1ce91&activation=1/);
});

test('issue-1579-t15: trusted reload and window disposal invalidate old clicks', async () => {
  const host = await hostFixture(); await host.signin(); host.send(ask); await tick();
  host.actions.length = 0;
  const old = host.shown[0];
  host.contents.emit('did-start-navigation', {}, 'rhythm://app/index.html#/agents', false, true);
  old.emit('click'); await tick();
  assert.equal(host.actions.length, 0);
  assert.equal(old.closed, true);
  host.send({ ...ask, requestId: 'new' }); await tick();
  const newer = host.shown.at(-1);
  host.windows[0].emit('closed'); newer.emit('click'); await tick();
  assert.equal(host.actions.length, 0);
});

test('issue-1579-t16: duplicate completion is inert and re-arm replaces the retired identity', async () => {
  const host = await hostFixture(); await host.signin();
  host.send({ v: 1, type: 'completion', sessionId }); await tick();
  host.actions.length = 0;
  const old = host.shown[0];
  host.send({ v: 1, type: 'completion', sessionId }); await tick();
  assert.equal(host.shown.filter(({ options }) => options.title === 'Agent finished').length, 1);
  host.send({ v: 1, type: 'arm', sessionId });
  host.send({ v: 1, type: 'completion', sessionId }); await tick();
  assert.equal(old.closed, true);
  const latest = host.shown.filter(({ options }) => options.title === 'Agent finished').at(-1);
  old.emit('click'); assert.equal(host.actions.length, 0);
  latest.emit('click');
  assert.deepEqual(host.actions, ['show', 'focus']);
});
