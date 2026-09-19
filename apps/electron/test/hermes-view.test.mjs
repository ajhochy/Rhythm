import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { bindHermesViewSupervisor, registerHermesView } from '../src/hermes-view.mjs';

const READY = { state: 'ready', port: 9121, url: 'http://127.0.0.1:9121' };
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(t, { status = READY, token = 'main-only-hermes-token', bound = false, delayedLoad = false } = {}) {
  const handlers = new Map(), views = [], ports = [];
  const ipcMain = Object.assign(new EventEmitter(), { handle: (key, fn) => handlers.set(key, fn), removeHandler: key => handlers.delete(key) });
  const mainFrame = { url: 'rhythm://app/index.html#/hermes' };
  const host = Object.assign(new EventEmitter(), { mainFrame, isDestroyed: () => false, getZoomFactor: () => 2 });
  const children = new Set();
  const win = Object.assign(new EventEmitter(), { webContents: host, isDestroyed: () => false,
    getContentBounds: () => ({ width: 1280, height: 800 }),
    contentView: { addChildView: view => children.add(view), removeChildView: view => children.delete(view) } });
  class Port extends EventEmitter {
    closed = false;
    close() { if (this.closed) return; this.closed = true; this.emit('close'); }
    start() { this.started = true; }
  }
  class MessageChannelMain {
    constructor() { this.port1 = new Port(); this.port2 = new Port(); ports.push(this); }
  }
  class WebContentsView {
    constructor(options) {
      this.options = options; views.push(this);
      const contents = Object.assign(new EventEmitter(), {
        mainFrame: { url: 'about:blank' }, destroyed: false, loads: [], css: [], messages: [],
        isDestroyed: () => contents.destroyed,
        close: () => { contents.destroyed = true; children.delete(this); },
        getURL: () => contents.mainFrame.url,
        setWindowOpenHandler: fn => { contents.openWindow = fn; },
        setZoomFactor: zoom => { contents.zoom = zoom; },
        insertCSS: async (css, options) => { contents.css.push({ css, options }); return 'style'; },
        postMessage: (channel, generation, transfer) => { contents.messages.push({ channel, generation, transfer }); },
        loadURL: async url => {
          contents.loads.push(url);
          contents.emit('did-start-navigation', {}, url, false, true);
          if (delayedLoad) await new Promise(resolve => { contents.finishLoad = resolve; });
          contents.mainFrame = { url };
          contents.emit('dom-ready');
        },
        session: Object.assign(new EventEmitter(), {
          setPermissionRequestHandler: fn => { contents.permission = fn; },
          setPermissionCheckHandler: fn => { contents.permissionCheck = fn; },
          webRequest: { onBeforeRequest: fn => { contents.request = fn; } },
        }),
      });
      this.webContents = contents;
    }
    setBounds(bounds) { this.bounds = bounds; }
  }
  let currentStatus = status;
  let currentToken = token;
  let tokenReads = 0;
  let enabled = true;
  let statusListener;
  const getSessionToken = () => { tokenReads += 1; return currentToken; };
  if (bound) bindHermesViewSupervisor({ getStatus: () => currentStatus, getSessionToken, onStatus: fn => { statusListener = fn; return () => {}; } });
  const dispose = registerHermesView({ ipcMain, getWindow: () => win, ...(bound ? {} : { getStatus: () => currentStatus }),
    ...(bound ? {} : { getSessionToken }), enabled: () => enabled, electron: { WebContentsView, MessageChannelMain } });
  t.after(dispose);
  const event = { sender: host, senderFrame: mainFrame };
  const call = (name, value, sender = event) => value === undefined ? handlers.get(name)(sender) : handlers.get(name)(sender, value);
  const acknowledge = (frame, generation) => {
    const contents = views.at(-1).webContents;
    ipcMain.emit('hermes:view:document-ready', { sender: contents, senderFrame: frame ?? contents.mainFrame }, generation ?? contents.messages.at(-1).generation);
  };
  return { views, ports, children, handlers, event, host, win, call, acknowledge, dispose,
    setStatus: value => { currentStatus = value; statusListener?.(value); },
    setToken: value => { currentToken = value; statusListener?.(currentStatus); },
    tokenReads: () => tokenReads,
    setEnabled: value => { enabled = value; },
  };
}

for (const state of ['disabled', 'absent', 'starting', 'failed', 'stopped']) {
  test(`Hermes attach creates no view while supervisor is ${state}`, async t => {
    const f = fixture(t, { status: { ...READY, state } });
    assert.deepEqual(await f.call('hermes:view:attach'), { ok: false, reason: 'not-ready' });
    assert.deepEqual(f.views, []);
    assert.equal(f.children.size, 0);
  });
}

test('Hermes view is sandboxed, separately partitioned, zoomed and themed on dom-ready', async t => {
  const f = fixture(t);
  const { attachment } = await f.call('hermes:view:attach');
  const view = f.views[0], contents = view.webContents;
  assert.deepEqual(Object.keys(view.options.webPreferences).sort(), ['contextIsolation', 'nodeIntegration', 'partition', 'preload', 'sandbox', 'webSecurity'].sort());
  assert.equal(view.options.webPreferences.partition, 'persist:rhythm-hermes');
  for (const key of ['contextIsolation', 'sandbox', 'webSecurity']) assert.equal(view.options.webPreferences[key], true);
  assert.equal(view.options.webPreferences.nodeIntegration, false);
  assert.match(view.options.webPreferences.preload, /hermes-view-preload.cjs$/);
  assert.deepEqual(contents.loads, ['http://127.0.0.1:9121/']);
  assert.equal(f.children.has(view), true);
  assert.equal(await f.call('hermes:view:bounds', { attachment, bounds: { x: 100.5, y: 40, width: 600, height: 500 } }), true);
  assert.deepEqual(view.bounds, { x: 201, y: 80, width: 1079, height: 720 });
  assert.equal(contents.zoom, 2);
  assert.match(contents.css[0].css, /--midground-base/);
  assert.match(contents.css[0].css, /#4F6AF5/);
  assert.match(contents.css[0].css, /prefers-color-scheme: dark/);
  assert.equal(contents.css[0].options.cssOrigin, 'user');
  assert.deepEqual(contents.openWindow({ url: 'https://evil.test' }), { action: 'deny' });
  assert.equal(contents.permissionCheck(), false);
  let permission; contents.permission(contents, 'media', value => { permission = value; });
  assert.equal(permission, false);
  for (const [url, cancel] of [['http://127.0.0.1:9121/api/status', false], ['ws://127.0.0.1:9121/api/ws', false], ['http://127.0.0.1:4001/api', true], ['https://evil.test', true], ['file:///etc/passwd', true]]) {
    let result; contents.request({ url }, value => { result = value; }); assert.deepEqual(result, { cancel });
  }
});

test('issue-1542-c8: Hermes view requires the main-only token but loads only the clean ready URL for server HTML bootstrap', async t => {
  const token = 'private-session-token';
  const f = fixture(t, { token });
  const result = await f.call('hermes:view:attach');
  assert.equal(result.ok, true);
  assert.equal(typeof result.attachment, 'string');
  assert.ok(f.tokenReads() > 0, 'native attach must bind the supervisor token generation');
  assert.deepEqual(f.views[0].webContents.loads, [`${READY.url}/`]);
  assert.doesNotMatch(JSON.stringify({ result, options: f.views[0].options, loads: f.views[0].webContents.loads }), new RegExp(token));

  const missing = fixture(t, { token: null });
  assert.deepEqual(await missing.call('hermes:view:attach'), { ok: false, reason: 'not-ready' });
  assert.deepEqual(missing.views, []);
});

test('issue-1542-c9: Hermes token rotation revokes a view tied to the prior dashboard start', async t => {
  const f = fixture(t, { bound: true });
  await f.call('hermes:view:attach');
  const contents = f.views[0].webContents;
  f.setToken('next-dashboard-token');
  await tick();
  assert.equal(contents.destroyed, true);
  assert.equal(f.children.size, 0);
});

test('Hermes foreign frames, absent acknowledgement, and malformed intents cause zero navigation', async t => {
  const f = fixture(t);
  const { attachment } = await f.call('hermes:view:attach');
  const contents = f.views[0].webContents;
  const payload = { attachment, intent: { v: 1, type: 'navigate-session', sessionId: 'session-1' } };
  const foreign = { sender: f.host, senderFrame: { url: f.event.senderFrame.url } };
  f.acknowledge({ url: contents.getURL() });
  assert.equal((await f.call('hermes:intent', payload)).ok, false, 'foreign view frame cannot acknowledge');
  f.acknowledge();
  for (const sender of [foreign, { sender: {}, senderFrame: f.event.senderFrame }]) {
    assert.equal((await f.call('hermes:intent', payload, sender)).ok, false);
    assert.equal(await f.call('hermes:view:bounds', { attachment, bounds: { x: 1, y: 1, width: 20, height: 20 } }, sender), false);
    assert.equal(await f.call('hermes:view:detach', { attachment }, sender), false);
    assert.equal((await f.call('hermes:view:attach', undefined, sender)).ok, false);
  }
  for (const intent of [{ v: 1, type: 'new-chat', context: 'x'.repeat(65536) }, { v: 2, type: 'navigate-session', sessionId: 'session-1' }, { v: 1, type: 'unknown', sessionId: 'session-1' }, { v: 1, type: 'navigate-session', sessionId: '../env' }]) {
    assert.equal((await f.call('hermes:intent', { attachment, intent })).ok, false);
  }
  assert.deepEqual(contents.loads, ['http://127.0.0.1:9121/']);
  assert.equal(contents.destroyed, false);
  assert.equal(f.views.length, 1);
});

test('Hermes navigates only to its dashboard session route and refuses unsafe draft emulation', async t => {
  const f = fixture(t);
  const { attachment } = await f.call('hermes:view:attach'); f.acknowledge();
  const contents = f.views[0].webContents;
  assert.deepEqual(await f.call('hermes:intent', { attachment, intent: { v: 1, type: 'new-chat', context: 'Rhythm dashboard counts unavailable' } }), { ok: false, reason: 'unsupported-draft' });
  assert.deepEqual(contents.loads, ['http://127.0.0.1:9121/']);
  const port = f.ports[0].port2;
  assert.deepEqual(await f.call('hermes:intent', { attachment, intent: { v: 1, type: 'navigate-session', sessionId: 'abc-123' } }), { ok: true });
  assert.deepEqual(contents.loads, ['http://127.0.0.1:9121/', 'http://127.0.0.1:9121/chat?resume=abc-123']);
  assert.equal(port.closed, true);
});

test('Hermes reload revokes old generation; only the current main frame can reactivate', async t => {
  const f = fixture(t);
  const { attachment } = await f.call('hermes:view:attach'); f.acknowledge();
  const contents = f.views[0].webContents, oldFrame = contents.mainFrame;
  const generation = contents.messages[0].generation;
  const intent = { attachment, intent: { v: 1, type: 'navigate-session', sessionId: 'abc' } };
  contents.emit('did-start-navigation', {}, contents.getURL(), false, true);
  assert.equal(f.ports[0].port2.closed, true);
  assert.equal((await f.call('hermes:intent', intent)).ok, false);
  contents.mainFrame = { url: contents.getURL() }; contents.emit('dom-ready');
  f.acknowledge(oldFrame, generation);
  assert.equal((await f.call('hermes:intent', intent)).ok, false);
  f.acknowledge(contents.mainFrame, generation);
  assert.equal((await f.call('hermes:intent', intent)).ok, false);
  assert.deepEqual(contents.loads, ['http://127.0.0.1:9121/']);
  f.acknowledge();
  assert.equal((await f.call('hermes:intent', intent)).ok, true);
});

for (const trigger of ['detach', 'window-close', 'host-reload', 'leave-route', 'supervisor-stop', 'replace']) {
  test(`Hermes ${trigger} removes view, closes port, and rejects stale handles`, async t => {
    const f = fixture(t, { bound: true });
    const { attachment } = await f.call('hermes:view:attach'); f.acknowledge();
    const contents = f.views[0].webContents, port = f.ports[0].port2;
    if (trigger === 'detach') await f.call('hermes:view:detach', { attachment });
    if (trigger === 'window-close') f.win.emit('closed');
    if (trigger === 'host-reload') f.host.emit('did-start-navigation', {}, f.event.senderFrame.url, false, true);
    if (trigger === 'leave-route') f.host.emit('did-start-navigation', {}, 'rhythm://app/index.html#/tasks', true, true);
    if (trigger === 'supervisor-stop') { f.setStatus({ ...READY, state: 'stopped' }); await tick(); }
    if (trigger === 'replace') await f.call('hermes:view:attach');
    assert.equal(contents.destroyed, true); assert.equal(port.closed, true);
    assert.equal(f.children.has(f.views[0]), false);
    assert.equal(await f.call('hermes:view:detach', { attachment }), false);
    assert.equal((await f.call('hermes:intent', { attachment, intent: { v: 1, type: 'navigate-session', sessionId: 'abc' } })).ok, false);
    port.emit('message', { data: { v: 1, type: 'navigate-session', sessionId: 'evil' } });
    assert.deepEqual(contents.loads, ['http://127.0.0.1:9121/']);
  });
}

test('Hermes off flag and wrong host route never create a view', async t => {
  const f = fixture(t); f.setEnabled(false);
  assert.equal((await f.call('hermes:view:attach')).ok, false);
  f.setEnabled(true); f.event.senderFrame.url = 'rhythm://app/index.html#/agents';
  assert.equal((await f.call('hermes:view:attach')).ok, false);
  assert.equal(f.views.length, 0);
});

test('Hermes pending intents cannot navigate after a reload or a supervisor change', async t => {
  const f = fixture(t);
  const { attachment } = await f.call('hermes:view:attach'); f.acknowledge();
  const contents = f.views[0].webContents;
  const pending = f.call('hermes:intent', { attachment, intent: { v: 1, type: 'navigate-session', sessionId: 'abc' } });
  contents.emit('did-start-navigation', {}, contents.getURL(), false, true);
  assert.equal((await pending).ok, false);
  assert.deepEqual(contents.loads, ['http://127.0.0.1:9121/']);
  contents.emit('dom-ready'); f.acknowledge();
  f.setStatus({ ...READY, state: 'failed' });
  assert.equal((await f.call('hermes:intent', { attachment, intent: { v: 1, type: 'navigate-session', sessionId: 'abc' } })).ok, false);
  assert.equal(contents.destroyed, true);
});

test('Hermes overlapping attach requests destroy the old view and ignore late load completion', async t => {
  const f = fixture(t, { delayedLoad: true });
  const first = f.call('hermes:view:attach'); await tick();
  const second = f.call('hermes:view:attach'); await tick();
  assert.equal(f.views[0].webContents.destroyed, true);
  f.views[0].webContents.finishLoad();
  assert.equal((await first).ok, false);
  f.views[1].webContents.finishLoad();
  assert.equal((await second).ok, true);
  assert.equal(f.children.size, 1);
});

test('Hermes parent reload during readiness lookup cancels the pending attach', async t => {
  let resolveStatus;
  const f = fixture(t, { status: new Promise(resolve => { resolveStatus = resolve; }) });
  const attach = f.call('hermes:view:attach');
  f.host.emit('did-start-navigation', {}, f.event.senderFrame.url, false, true);
  resolveStatus(READY);
  assert.equal((await attach).ok, false);
  assert.equal(f.views.length, 0);
  assert.equal(f.host.listenerCount('did-start-navigation'), 0);
});

test('Hermes supervisor replacement cancels a pending readiness snapshot', async t => {
  let resolveStatus;
  const f = fixture(t, { bound: true, status: new Promise(resolve => { resolveStatus = resolve; }) });
  const attach = f.call('hermes:view:attach');
  f.setStatus({ ...READY, state: 'failed' });
  resolveStatus(READY);
  assert.equal((await attach).ok, false);
  assert.equal(f.views.length, 0);
  assert.equal(f.host.listenerCount('did-start-navigation'), 0);
});

test('Hermes same-document navigation replaces the port without duplicating theme insertion', async t => {
  const f = fixture(t);
  await f.call('hermes:view:attach'); f.acknowledge();
  const contents = f.views[0].webContents;
  contents.emit('did-start-navigation', {}, `${READY.url}/sessions`, true, true);
  contents.mainFrame.url = `${READY.url}/sessions`;
  contents.emit('did-navigate-in-page', {}, contents.getURL(), true);
  assert.equal(f.ports[0].port2.closed, true);
  assert.equal(f.ports.length, 2);
  assert.notEqual(contents.messages[0].generation, contents.messages[1].generation);
  assert.equal(contents.css.length, 1);
});

test('Hermes navigation, subframes and downloads cannot leave the approved origin', async t => {
  const f = fixture(t); await f.call('hermes:view:attach');
  const contents = f.views[0].webContents;
  for (const url of ['file:///etc/passwd', 'https://evil.test', 'http://127.0.0.1:4001/', 'javascript:alert(1)', 'invalid']) {
    for (const eventName of ['will-navigate', 'will-redirect']) {
      let prevented = false;
      contents.emit(eventName, { preventDefault() { prevented = true; } }, url);
      assert.equal(prevented, true, `${eventName}: ${url}`);
    }
  }
  let framePrevented = false, downloadPrevented = false;
  contents.emit('will-frame-navigate', { url: `${READY.url}/`, isMainFrame: false, preventDefault() { framePrevented = true; } });
  contents.session.emit('will-download', { preventDefault() { downloadPrevented = true; } });
  assert.equal(framePrevented, true); assert.equal(downloadPrevented, true);
  const port = f.ports[0].port2;
  port.emit('message', { data: { v: 1, type: 'navigate-session', sessionId: 'evil' } });
  assert.deepEqual(contents.loads, [`${READY.url}/`], 'dashboard-originated messages have no authority');
});

test('Hermes main preload hides attachment handles and retires late attach results', async () => {
  let shell, resolveAttach;
  const calls = [], ipc = new EventEmitter();
  ipc.sendSync = () => undefined;
  ipc.invoke = (channel, payload) => {
    calls.push({ channel, payload });
    if (channel === 'hermes:view:attach') return new Promise(resolve => { resolveAttach = resolve; });
    return Promise.resolve(true);
  };
  runInNewContext(await readFile(new URL('../src/preload.cjs', import.meta.url), 'utf8'), {
    require: () => ({ ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (_key, value) => { shell = value; } } }),
    process: { argv: [], env: {}, platform: 'darwin' }, window: { addEventListener() {} },
  });
  assert.equal(Object.isFrozen(shell.hermesView), true);
  assert.deepEqual(Object.keys(shell.hermesView), ['attach', 'setBounds', 'detach', 'sendIntent']);
  const pending = shell.hermesView.attach();
  await shell.hermesView.detach();
  resolveAttach({ ok: true, attachment: 'stale-secret-handle' });
  assert.equal((await pending).ok, false);
  assert.equal(calls.at(-1).channel, 'hermes:view:detach');
  assert.equal(calls.at(-1).payload.attachment, 'stale-secret-handle');
  const next = shell.hermesView.attach(); resolveAttach({ ok: true, attachment: 'current-handle' });
  const result = await next;
  assert.equal(result.ok, true); assert.equal(result.attachment, undefined);
  const intent = { v: 1, type: 'new-chat', context: 'Rhythm dashboard summary' };
  await shell.hermesView.sendIntent(intent);
  assert.equal(calls.at(-1).payload.attachment, 'current-handle');
  assert.deepEqual(calls.at(-1).payload.intent, intent);
});

test('Hermes view preload gives the page no native API and closes old ports', async () => {
  const ipc = new EventEmitter(), sent = [], window = new EventEmitter();
  ipc.send = (...args) => sent.push(args); window.addEventListener = window.on.bind(window);
  runInNewContext(await readFile(new URL('../src/hermes-view-preload.cjs', import.meta.url), 'utf8'), {
    require: name => { assert.equal(name, 'electron'); return { ipcRenderer: ipc }; }, process: { isMainFrame: true }, window,
  });
  const port = () => ({ closed: false, close() { this.closed = true; }, start() {}, postMessage() {} });
  const first = port(), second = port();
  ipc.emit('hermes:port', { ports: [first] }, 'doc-one');
  ipc.emit('hermes:port', { ports: [second] }, 'doc-two');
  assert.equal(first.closed, true);
  assert.deepEqual(sent, [['hermes:view:document-ready', 'doc-one'], ['hermes:view:document-ready', 'doc-two']]);
  assert.equal(window.rhythmShell, undefined);
  window.emit('pagehide'); assert.equal(second.closed, true);
});

test('issue-1542-c10: packaged main stages every Hermes view support file', async () => {
  const packageSource = await readFile(new URL('../scripts/package-mac.mjs', import.meta.url), 'utf8');
  for (const file of ['hermes-view.mjs', 'hermes-view-preload.cjs', 'hermes-protocol.mjs', 'hermes-theme.mjs', 'hermes-theme.css']) {
    assert.match(packageSource, new RegExp(`src/${file.replaceAll('.', '\\.')}`), `${file} is missing from the explicit package manifest`);
  }
});

test('issue-1542-c11: canonical Electron tests include both B3 suites', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(manifest.scripts.test, /test\/hermes-protocol\.test\.mjs/);
  assert.match(manifest.scripts.test, /test\/hermes-view\.test\.mjs/);
});
