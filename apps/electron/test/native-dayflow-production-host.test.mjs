import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { DAYFLOW_ROUTE, RHYTHM_BUNDLE_IDENTIFIER, WRAPPER_FILE_NAME, registerNativeDayflowProductionHost } from '../src/native-dayflow-production-host.mjs';

// Mocks only: no Electron, no addon, no OS access.
function fixture({ dataRoot = '/ud/df', bundleIdentifier = RHYTHM_BUNDLE_IDENTIFIER, installError, startResult = true, supported = true, candidate = 0, downloadGate, stopThrows, loadModuleError } = {}) {
  let candidateState = candidate;
  const calls = [];
  const handlers = new Map();
  const ipcMain = { handle: (c, l) => handlers.set(c, l), removeHandler: (c) => handlers.delete(c) };
  const mainFrame = { url: DAYFLOW_ROUTE };
  const webContents = Object.assign(new EventEmitter(), {
    mainFrame, url: DAYFLOW_ROUTE, zoom: 1, destroyed: false,
    isDestroyed() { return this.destroyed; }, getURL() { return this.url; }, getZoomFactor() { return this.zoom; },
    focus() { calls.push('webFocus'); },
  });
  const window = Object.assign(new EventEmitter(), {
    webContents, destroyed: false, visible: true, minimized: false,
    isDestroyed() { return this.destroyed; }, isVisible() { return this.visible; }, isMinimized() { return this.minimized; },
    getContentBounds: () => ({ x: 0, y: 0, width: 1000, height: 800 }), getNativeWindowHandle: () => Buffer.alloc(8),
    restore() { calls.push('restore'); this.minimized = false; }, show() { calls.push('show'); }, focus() { calls.push('focus'); },
    loadURL(url) { calls.push(['loadURL', url]); return Promise.resolve(); },
  });
  let queue = [];
  const wrapper = {
    install: (c) => { calls.push(['install', c]); if (installError) throw installError; },
    configureHelper: (p) => { calls.push(['helper', p]); return true; },
    startServices: () => { calls.push('start'); return startResult; },
    stopServices: () => { calls.push('stop'); if (stopThrows) throw new Error('stop failed'); },
    attach: (h, b) => { calls.push(['attach', b]); return { attached: true, hidden: true }; },
    setBounds: (b) => { calls.push(['setBounds', b]); return true; },
    setLifecycle: (bits) => { calls.push(['lifecycle', bits]); return {}; },
    detach: () => { calls.push('detach'); return { attached: false }; },
    returnFocus: () => { calls.push('returnFocus'); return true; },
    drainHostEvents: (limit) => { calls.push(['drain', limit]); const out = queue.slice(0, limit); queue = queue.slice(limit); return out; },
    setLaunchAtLoginState: (v) => calls.push(['loginState', v]),
    startNotificationBridge: () => { calls.push('notifStart'); return true; },
    stopNotificationBridge: () => calls.push('notifStop'),
    notificationCandidateState: () => { calls.push('candidate'); return typeof candidateState === 'function' ? candidateState() : candidateState; },
  };
  let loads = 0;
  const moduleLoads = [];
  const mod = {
    resolveHelperPath: (app) => `${app}/Contents/Helpers/rhythm-dayflow`,
    resolvePackagedLayout: (root) => ({ addonPath: `${root}/addon.node` }),
    createInstallConfiguration: (c) => Object.freeze({ ...c }),
    createEmbeddedDayflowHost: () => wrapper,
  };
  let tick;
  let login = false;
  const host = registerNativeDayflowProductionHost({
    ipcMain, getWindow: () => window, loadModule: (path) => { moduleLoads.push(path); if (loadModuleError) throw new Error('missing'); return mod; }, loadAddon: () => { loads += 1; return {}; },
    nativeRoot: '/App/Contents/Resources/native-dayflow', appBundlePath: '/App', dataRoot,
    identity: { bundleIdentifier, displayName: 'Rhythm', shortVersion: '1', build: '1' },
    isSupported: () => supported,
    openDownloadPage: () => { calls.push('download'); return downloadGate?.(); },
    loginItem: { get: () => login, set: (v) => { login = v; calls.push(['loginSet', v]); } },
    showQuitReopenInstruction: () => calls.push('quitInstruction'),
    scheduler: { set: (fn) => { tick = fn; return 1; }, clear: () => { tick = undefined; } },
    newLease: (() => { let n = 0; return () => `lease${++n}`; })(),
  });
  host.bindWindow(window);
  const event = (over = {}) => ({ sender: webContents, senderFrame: mainFrame, ...over });
  const call = (channel, ...args) => handlers.get(channel)(event(), ...args);
  return { host, calls, handlers, moduleLoads, setCandidate: (v) => { candidateState = v; }, window, webContents, mainFrame, event, call, wrapper, mod, push: (...c) => { queue.push(...c); }, tick: () => tick?.(), loads: () => loads, isLogin: () => login };
}

const lifecycles = (calls) => calls.filter((c) => Array.isArray(c) && c[0] === 'lifecycle').map((c) => c[1]);

test('construction, bind and status load nothing and request nothing', async () => {
  const f = fixture();
  assert.deepEqual(await f.call('dayflow:view:status'), { state: 'ready' });
  assert.equal(f.loads(), 0);
  assert.deepEqual(f.calls, []);
  assert.deepEqual([...f.handlers.keys()].sort(), ['attach', 'blocked', 'bounds', 'detach', 'return-focus', 'status'].map((n) => `dayflow:view:${n}`).sort());
});

test('status is unavailable when unsupported, with args, or from a foreign sender/frame/route', async () => {
  const bad = { state: 'unavailable', code: 'unavailable' };
  assert.deepEqual(await fixture({ supported: false }).call('dayflow:view:status'), bad);
  const f = fixture();
  assert.deepEqual(await f.call('dayflow:view:status', 1), bad);
  assert.deepEqual(await f.handlers.get('dayflow:view:status')({ sender: {}, senderFrame: f.mainFrame }), bad);
  assert.deepEqual(await f.handlers.get('dayflow:view:status')(f.event({ senderFrame: { url: DAYFLOW_ROUTE } })), bad);
  f.mainFrame.url = `${DAYFLOW_ROUTE}?demo=1`;
  assert.deepEqual(await f.call('dayflow:view:status'), bad);
});

test('attach runs install -> helper -> start once, returns a lease, starts hidden at a placeholder', async () => {
  const f = fixture();
  const result = await f.call('dayflow:view:attach');
  assert.deepEqual(result, { ok: true, lease: 'lease1' });
  assert.deepEqual(f.calls.find((c) => c[0] === 'helper'), ['helper', '/App/Contents/Helpers/rhythm-dayflow']);
  assert.deepEqual(f.calls.slice(0, 4).map((c) => (Array.isArray(c) ? c[0] : c)), ['install', 'helper', 'start', 'loginState']);
  assert.deepEqual(f.calls.find((c) => c[0] === 'attach')[1], { x: 0, y: 0, width: 1, height: 1, zoom: 1 });
  assert.equal(lifecycles(f.calls).length, 0, 'no lifecycle show before a measurement');
  await f.call('dayflow:view:detach', { attachment: 'lease1' });
  await f.call('dayflow:view:attach');
  assert.equal(f.calls.filter((c) => Array.isArray(c) && c[0] === 'install').length, 1);
  assert.equal(f.calls.filter((c) => c === 'start').length, 1);
});

test('a second attach on the same live document reuses the active lease without re-attaching', async () => {
  const f = fixture();
  assert.deepEqual(await f.call('dayflow:view:attach'), { ok: true, lease: 'lease1' });
  assert.deepEqual(await f.call('dayflow:view:attach'), { ok: true, lease: 'lease1' });
  assert.equal(f.calls.filter((c) => Array.isArray(c) && c[0] === 'attach').length, 1);
});

test('attach is denied for args, foreign frames, and non-exact routes', async () => {
  const f = fixture();
  assert.deepEqual(await f.call('dayflow:view:attach', 'x'), { ok: false, reason: 'denied' });
  f.mainFrame.url = 'rhythm://app/index.html#/tools/dayflow?demo=1';
  assert.deepEqual(await f.call('dayflow:view:attach'), { ok: false, reason: 'denied' });
  f.mainFrame.url = DAYFLOW_ROUTE;
  assert.deepEqual(await f.handlers.get('dayflow:view:attach')(f.event({ senderFrame: { url: DAYFLOW_ROUTE } })), { ok: false, reason: 'denied' });
  assert.equal(f.calls.length, 0);
});

test('an overlong own root makes the host unavailable without loading anything', async () => {
  const f = fixture({ dataRoot: `/${'a'.repeat(100)}` });
  assert.deepEqual(await f.call('dayflow:view:status'), { state: 'unavailable', code: 'unavailable' });
  assert.deepEqual(await f.call('dayflow:view:attach'), { ok: false, reason: 'unavailable' });
  assert.equal(f.loads(), 0);
});

test('install failure is typed unavailable, sticky, and never retried', async () => {
  const error = Object.assign(new TypeError('x'), { code: 'E_STORAGE_UNAVAILABLE' });
  const f = fixture({ installError: error });
  assert.deepEqual(await f.call('dayflow:view:attach'), { ok: false, reason: 'unavailable' });
  assert.deepEqual(await f.call('dayflow:view:attach'), { ok: false, reason: 'unavailable' });
  assert.deepEqual(await f.call('dayflow:view:status'), { state: 'unavailable', code: 'unavailable' });
  assert.equal(f.calls.filter((c) => Array.isArray(c) && c[0] === 'install').length, 1);
  assert.equal(f.calls.includes('start'), false);
});

async function attached(f) {
  const { lease } = await f.call('dayflow:view:attach');
  return lease;
}

test('bounds: exact keys, CSS clamp with main zoom, hide instead of zero, lease required', async () => {
  const f = fixture();
  const lease = await attached(f);
  assert.equal(await f.call('dayflow:view:bounds', { attachment: 'other', bounds: { x: 0, y: 0, width: 5, height: 5 } }), false);
  assert.equal(await f.call('dayflow:view:bounds', { attachment: lease, bounds: { x: 0, y: 0, width: 5, height: 5, extra: 1 } }), false);
  assert.equal(await f.call('dayflow:view:bounds', { attachment: lease, bounds: { x: 0, y: 0, width: Infinity, height: 5 } }), false);
  f.webContents.zoom = 2;
  assert.equal(await f.call('dayflow:view:bounds', { attachment: lease, bounds: { x: -10, y: 10, width: 900, height: 100 } }), true);
  // content 1000x800 at zoom 2 => 500x400 CSS; x clamped to 0, width limited to 500-0 → min(500, -10+900)
  assert.deepEqual(f.calls.filter((c) => c[0] === 'setBounds').at(-1)[1], { x: 0, y: 10, width: 500, height: 100, zoom: 2 });
  assert.deepEqual(lifecycles(f.calls).at(-1), { activeTool: true, modalVisible: true, windowVisible: true, minimized: false, hostCrashed: false });
  // still renderer-blocked by default => modalVisible true; unblock => shown
  assert.equal(await f.call('dayflow:view:blocked', { attachment: lease, blocked: false }), true);
  assert.deepEqual(lifecycles(f.calls).at(-1), { activeTool: true, modalVisible: false, windowVisible: true, minimized: false, hostCrashed: false });
  const before = f.calls.filter((c) => c[0] === 'setBounds').length;
  assert.equal(await f.call('dayflow:view:bounds', { attachment: lease, bounds: { x: 600, y: 0, width: 10, height: 10 } }), false); // fully outside → hide
  assert.equal(f.calls.filter((c) => c[0] === 'setBounds').length, before);
  assert.equal(lifecycles(f.calls).at(-1).activeTool, false);
  f.webContents.zoom = 5;
  assert.equal(await f.call('dayflow:view:bounds', { attachment: lease, bounds: { x: 0, y: 0, width: 5, height: 5 } }), false);
});

test('main state (minimize, hide, own modal) dominates renderer blocked=false and web focus returns', async () => {
  const f = fixture();
  const lease = await attached(f);
  await f.call('dayflow:view:bounds', { attachment: lease, bounds: { x: 0, y: 0, width: 100, height: 100 } });
  await f.call('dayflow:view:blocked', { attachment: lease, blocked: false });
  assert.equal(await f.call('dayflow:view:return-focus', { attachment: lease }), true);
  f.window.minimized = true; f.window.emit('minimize');
  assert.equal(lifecycles(f.calls).at(-1).minimized, true);
  assert.equal(await f.call('dayflow:view:return-focus', { attachment: lease }), false);
  f.window.minimized = false; f.window.emit('restore');
  let resolve; const dialog = new Promise((r) => { resolve = r; });
  const pending = f.host.runModal(() => dialog);
  assert.equal(lifecycles(f.calls).at(-1).modalVisible, true);
  f.calls.length = 0;
  resolve('x'); await pending;
  assert.equal(lifecycles(f.calls).at(-1).modalVisible, false);
  assert.equal(f.host.runModal(() => 7), 7);
  assert.throws(() => f.host.runModal(() => { throw new Error('boom'); }), /boom/);
  assert.equal(lifecycles(f.calls).at(-1).modalVisible, false, 'counter balanced after throw');
});

test('revocation: reload, route/hash departure (incl. replaceState), crash, auth transition, window close', async () => {
  const cases = {
    reload: (f) => f.webContents.emit('did-start-navigation', {}, DAYFLOW_ROUTE, false, true),
    leaveHash: (f) => { f.webContents.url = 'rhythm://app/index.html#/agents'; f.webContents.emit('did-start-navigation', {}, f.webContents.url, true, true); },
    replaceState: (f) => { f.webContents.url = `${DAYFLOW_ROUTE}?x=1`; f.webContents.emit('did-navigate-in-page', {}, f.webContents.url, true); },
    crash: (f) => f.webContents.emit('render-process-gone', {}, { reason: 'crashed' }),
    auth: (f) => f.host.disposeCurrent(),
    closed: (f) => f.window.emit('closed'),
    destroyed: (f) => f.webContents.emit('destroyed'),
  };
  for (const [name, trigger] of Object.entries(cases)) {
    const f = fixture();
    const lease = await attached(f);
    trigger(f);
    // revocation is synchronous: the very next IPC with the old lease is refused
    assert.equal(await f.call('dayflow:view:blocked', { attachment: lease, blocked: false }), false, name);
    f.webContents.url = DAYFLOW_ROUTE; f.webContents.destroyed = false;
    await f.host.disposeCurrent();
    assert.ok(f.calls.includes('detach'), `${name} detaches natively`);
    assert.equal(f.calls.includes('webFocus'), true, `${name} restores web focus`);
  }
});

test('a hash-only same-route in-place navigation keeps the lease', async () => {
  const f = fixture();
  const lease = await attached(f);
  f.webContents.emit('did-start-navigation', {}, DAYFLOW_ROUTE, true, true);
  assert.equal(await f.call('dayflow:view:blocked', { attachment: lease, blocked: false }), true);
});

test('a stale attach (revoked while services start) is not published and detaches', async () => {
  const f = fixture();
  const original = f.wrapper.startServices;
  f.wrapper.startServices = () => { f.webContents.emit('did-start-navigation', {}, DAYFLOW_ROUTE, false, true); return original(); };
  const result = await f.call('dayflow:view:attach');
  assert.deepEqual(result, { ok: false, reason: 'detached' });
  assert.equal(f.calls.some((c) => Array.isArray(c) && c[0] === 'attach'), false);
});

test('window replacement revokes the old record; foreign window events are ignored', async () => {
  const f = fixture();
  const lease = await attached(f);
  const other = Object.assign(new EventEmitter(), { ...f.window, webContents: Object.assign(new EventEmitter(), f.webContents) });
  f.host.bindWindow(other);
  assert.equal(await f.call('dayflow:view:blocked', { attachment: lease, blocked: false }), false);
});

test('host events drain bounded and map to fixed actions only', async () => {
  const f = fixture();
  await attached(f);
  f.push('checkForUpdates', 'launchAtLoginEnable', 'dockIconHide', 'dockIconShow', 'showHostWindow', 'quitAndReopenRequested', 'bogus');
  await f.tick();
  assert.deepEqual(f.calls.find((c) => c[0] === 'drain'), ['drain', 16]);
  assert.ok(f.calls.includes('download'));
  assert.deepEqual(f.calls.filter((c) => c[0] === 'loginSet'), [['loginSet', true]]);
  assert.equal(f.isLogin(), true);
  assert.deepEqual(f.calls.filter((c) => c[0] === 'loginState').at(-1), ['loginState', true]);
  assert.ok(f.calls.includes('restore') === false && f.calls.includes('show'));
  assert.ok(f.calls.includes('quitInstruction'));
  assert.equal(f.calls.some((c) => /dock/i.test(String(c))), false, 'dock events have no OS effect');
});

test('showHostWindow restores, focuses and routes to the exact Dayflow route', async () => {
  const f = fixture();
  await attached(f);
  f.window.minimized = true; f.webContents.url = 'rhythm://app/index.html#/agents';
  f.push('showHostWindow'); await f.tick();
  assert.deepEqual(f.calls.filter((c) => ['restore', 'show', 'focus'].includes(c)), ['restore', 'show', 'focus']);
  assert.deepEqual(f.calls.find((c) => c[0] === 'loadURL'), ['loadURL', DAYFLOW_ROUTE]);
});

test('drain is bounded per tick (16 of 40)', async () => {
  const f = fixture();
  await attached(f);
  f.push(...Array.from({ length: 40 }, () => 'dockIconShow'));
  await f.tick();
  assert.equal(f.calls.filter((c) => c[0] === 'drain').length, 1);
});

const candidatesOf = (f) => f.calls.filter((c) => c === 'candidate').length;
const installs = (f) => f.calls.filter((c) => Array.isArray(c) && c[0] === 'install').length;
const starts = (f) => f.calls.filter((c) => c === 'start').length;

test('early bridge start establishes the ONE pump but cannot install or start before the window is ready', async () => {
  const f = fixture({ candidate: 1 });
  assert.equal(f.host.startNotifications(), true);
  assert.equal(f.host.startNotifications(), false);
  assert.deepEqual(f.calls, ['notifStart']);
  await f.tick(); await f.tick();
  assert.equal(installs(f), 0);
  assert.equal(starts(f), 0);
  assert.equal(candidatesOf(f), 0, 'not even a state query before the owned window is ready');
});

test('cold response BEFORE ready: qualified candidate installs context, then starts services exactly once, on the next tick after ready', async () => {
  const states = [1, 2];
  const f = fixture({ candidate: () => states.shift() ?? 0 });
  f.host.startNotifications();
  await f.tick();
  assert.equal(installs(f), 0);
  f.host.windowReady();
  await f.tick();
  assert.equal(installs(f), 1);
  assert.deepEqual(f.calls.filter((c) => c === 'start' || (Array.isArray(c) && c[0] === 'install')).map((c) => (Array.isArray(c) ? 'install' : c)), ['install', 'start']);
  assert.equal(f.calls.find((c) => Array.isArray(c) && c[0] === 'install')[1].bundleIdentifier, 'com.rhythm.desktop');
  await f.tick(); await f.tick();
  assert.equal(starts(f), 1);
  assert.equal(f.calls.some((c) => c === 'restore' || c === 'show' || (Array.isArray(c) && c[0] === 'loadURL')), false, 'the host never fabricates event 6');
});

test('cold response AFTER ready is picked up by the same pump without any attach', async () => {
  const f = fixture({ candidate: 0 });
  f.host.startNotifications();
  f.host.windowReady();
  await f.tick();
  assert.equal(installs(f), 0);
  assert.equal(starts(f), 0);
  const states = [1, 2];
  f.setCandidate(() => states.shift() ?? 0);
  await f.tick();
  assert.equal(installs(f), 1);
  assert.equal(starts(f), 1);
});

test('foreign/malformed candidate (state 0) never installs or starts; wrong marker is context-only', async () => {
  const foreign = fixture({ candidate: 0 });
  foreign.host.startNotifications(); foreign.host.windowReady();
  await foreign.tick(); await foreign.tick();
  assert.equal(installs(foreign), 0);
  assert.equal(starts(foreign), 0);

  const states = [1, 0]; // needs context -> after the context-only install the marker did not match
  const wrong = fixture({ candidate: () => states.shift() ?? 0 });
  wrong.host.startNotifications(); wrong.host.windowReady();
  await wrong.tick();
  assert.equal(installs(wrong), 1, 'the unavoidable context-only install for the marker comparison');
  assert.equal(starts(wrong), 0, 'no original service starts');
  assert.equal(wrong.calls.some((c) => c === 'show' || (Array.isArray(c) && c[0] === 'loadURL')), false);
  await wrong.tick(); await wrong.tick();
  assert.equal(starts(wrong), 0);
  // a normal admitted attach afterwards reuses the context and only then starts services
  const result = await wrong.call('dayflow:view:attach');
  assert.equal(result.ok, true);
  assert.equal(installs(wrong), 1);
  assert.equal(starts(wrong), 1);
});

test('the packaged wrapper is loaded from the fixed native root only, with no fallback', async () => {
  const f = fixture();
  await f.call('dayflow:view:attach');
  assert.deepEqual([...new Set(f.moduleLoads)], [`/App/Contents/Resources/native-dayflow/${WRAPPER_FILE_NAME}`]);
  assert.equal(WRAPPER_FILE_NAME, 'native-dayflow-embedded-host.cjs');
  const missing = fixture({ loadModuleError: true });
  assert.deepEqual(await missing.call('dayflow:view:attach'), { ok: false, reason: 'unavailable' });
  assert.deepEqual(await missing.call('dayflow:view:status'), { state: 'unavailable', code: 'unavailable' });
  assert.equal(missing.moduleLoads.length, 1, 'one attempt at the one location; no relative/PATH/source fallback');
  assert.equal(missing.loads(), 0);
});

test('exact packaged identity com.rhythm.desktop is required before any load or context publication', async () => {
  assert.equal(RHYTHM_BUNDLE_IDENTIFIER, 'com.rhythm.desktop');
  for (const wrong of ['com.rhythm.app', 'com.rhythm.native-dayflow', 'com.teleportlabs.dayflow', '']) {
    const f = fixture({ bundleIdentifier: wrong });
    assert.deepEqual(await f.call('dayflow:view:status'), { state: 'unavailable', code: 'unavailable' });
    assert.deepEqual(await f.call('dayflow:view:attach'), { ok: false, reason: 'unavailable' });
    assert.equal(f.host.startNotifications(), false);
    assert.equal(installs(f), 0);
    assert.equal(f.moduleLoads.length, 0);
    assert.equal(f.loads(), 0);
  }
  const f = fixture();
  await f.call('dayflow:view:attach');
  assert.equal(f.calls.find((c) => Array.isArray(c) && c[0] === 'install')[1].bundleIdentifier, 'com.rhythm.desktop');
});

test('revocation hides the captured view synchronously, before the deferred detach', async () => {
  for (const trigger of [
    (f) => f.webContents.emit('did-start-navigation', {}, 'rhythm://app/index.html#/agents', true, true),
    (f) => f.webContents.emit('render-process-gone', {}, { reason: 'crashed' }),
    (f) => f.window.emit('closed'),
  ]) {
    const f = fixture();
    const lease = await attached(f);
    await f.call('dayflow:view:bounds', { attachment: lease, bounds: { x: 0, y: 0, width: 50, height: 50 } });
    await f.call('dayflow:view:blocked', { attachment: lease, blocked: false });
    f.calls.length = 0;
    trigger(f);
    assert.deepEqual(lifecycles(f.calls).at(-1), { activeTool: false, modalVisible: true, windowVisible: true, minimized: false, hostCrashed: false });
    assert.equal(f.calls.includes('detach'), false, 'detach is still deferred when the clip is already hidden');
    assert.equal(await f.call('dayflow:view:blocked', { attachment: lease, blocked: false }), false);
    assert.equal(lifecycles(f.calls).every((l) => l.activeTool === false), true, 'a stale lease cannot reveal');
    await f.host.disposeCurrent();
    assert.equal(f.calls.includes('detach'), true);
  }
});

test('fixed effects run in order in one bounded batch; nothing after disposal', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const f = fixture({ downloadGate: () => gate });
  await attached(f);
  f.push('checkForUpdates', 'launchAtLoginEnable', 'showHostWindow');
  const first = f.tick();
  await new Promise((r) => setImmediate(r));
  assert.equal(f.calls.filter((c) => c === 'download').length, 1);
  assert.equal(f.calls.some((c) => Array.isArray(c) && c[0] === 'loginSet'), false, 'the login item waits for the delayed update action');
  await f.tick(); // an overlapping tick does not drain again
  assert.equal(f.calls.filter((c) => Array.isArray(c) && c[0] === 'drain').length, 1);
  release();
  await first;
  const order = f.calls.filter((c) => c === 'download' || (Array.isArray(c) && c[0] === 'loginSet') || c === 'show');
  assert.deepEqual(order.map((c) => (Array.isArray(c) ? c[0] : c)), ['download', 'loginSet', 'show']);

  // disposal while an action is outstanding: later actions never run
  let release2;
  const gate2 = new Promise((resolve) => { release2 = resolve; });
  const g = fixture({ downloadGate: () => gate2 });
  await attached(g);
  g.push('checkForUpdates', 'launchAtLoginEnable', 'showHostWindow');
  const running = g.tick();
  await new Promise((r) => setImmediate(r));
  const disposing = g.host.dispose();
  release2();
  await running; await disposing;
  assert.equal(g.calls.some((c) => Array.isArray(c) && c[0] === 'loginSet'), false);
  assert.equal(g.calls.includes('show'), false);
});

test('a throwing service stop cannot skip the notification-bridge cleanup; pump is cancelled once', async () => {
  const f = fixture({ stopThrows: true });
  f.host.startNotifications();
  await attached(f);
  await f.host.dispose();
  assert.equal(f.calls.filter((c) => c === 'stop').length, 1);
  assert.equal(f.calls.filter((c) => c === 'notifStop').length, 1);
  assert.equal(f.tick(), undefined, 'the single pump was cancelled');
});

test('dispose stops services and bridge once, removes handlers, cancels the pump', async () => {
  const f = fixture();
  f.host.startNotifications();
  await attached(f);
  await f.host.dispose(); await f.host.dispose();
  assert.equal(f.calls.filter((c) => c === 'stop').length, 1);
  assert.equal(f.calls.filter((c) => c === 'notifStop').length, 1);
  assert.equal(f.handlers.size, 0);
  assert.equal(f.tick(), undefined);
  assert.equal(f.calls.filter((c) => c === 'detach').length >= 1, true);
  assert.equal(f.calls.includes('detach'), true);
});

// ---- preload facade (mock electron; lease closure + epoch) ----
import Module, { createRequire } from 'node:module';

function loadFacade(invoke) {
  const exposed = {};
  const original = Module._load;
  Module._load = function load(request, ...rest) {
    if (request === 'electron') {
      return {
        contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } },
        ipcRenderer: { invoke, on() {}, removeListener() {}, sendSync: () => undefined, send() {} },
      };
    }
    return original.call(this, request, ...rest);
  };
  const hadWindow = 'window' in globalThis;
  if (!hadWindow) globalThis.window = { addEventListener() {}, dispatchEvent() {} };
  try {
    const require = createRequire(import.meta.url);
    const path = require.resolve('../src/preload.cjs');
    delete require.cache[path];
    require(path);
  } finally { Module._load = original; if (!hadWindow) delete globalThis.window; }
  return exposed.rhythmShell.dayflowView;
}

test('preload facade: frozen six methods, lease private, stale attach dropped without detach', async () => {
  const sent = [];
  const gates = [];
  const view = loadFacade((channel, payload) => {
    sent.push([channel, payload]);
    if (channel === 'dayflow:view:attach') return new Promise((resolve) => gates.push(resolve));
    return Promise.resolve(true);
  });
  assert.ok(Object.isFrozen(view));
  assert.deepEqual(Object.keys(view).sort(), ['attach', 'detach', 'getStatus', 'returnFocus', 'setBlocked', 'setBounds']);
  assert.equal(await view.setBounds({ x: 0, y: 0, width: 1, height: 1 }), false, 'no lease → false locally');
  assert.equal(sent.length, 0);
  const first = view.attach();
  const second = view.attach();
  gates[0]({ ok: true, lease: 'old' });
  assert.deepEqual(await first, { ok: false, reason: 'detached' });
  assert.equal(sent.some(([c]) => c === 'dayflow:view:detach'), false, 'stale result is not detached');
  gates[1]({ ok: true, lease: 'new' });
  assert.deepEqual(await second, { ok: true });
  await view.setBlocked(false);
  assert.deepEqual(sent.at(-1), ['dayflow:view:blocked', { attachment: 'new', blocked: false }]);
  const detached = view.detach();
  assert.equal(await view.returnFocus(), false, 'lease cleared synchronously');
  assert.equal(await detached, true);
  assert.deepEqual(sent.at(-1), ['dayflow:view:detach', { attachment: 'new' }]);
  const pending = view.attach();
  view.detach();
  gates[2]({ ok: true, lease: 'late' });
  assert.deepEqual(await pending, { ok: false, reason: 'detached' });
  assert.equal(await view.setBounds({ x: 0, y: 0, width: 1, height: 1 }), false);
});

test('preload facade: attach folds malformed or rejected main results', async () => {
  for (const [result, expected] of [[{ ok: false, reason: 'denied' }, 'denied'], [{ ok: false, reason: 'weird' }, 'unavailable'], [{ ok: true }, 'unavailable'], [undefined, 'unavailable']]) {
    const view = loadFacade(() => Promise.resolve(result));
    assert.deepEqual(await view.attach(), { ok: false, reason: expected });
  }
  const failing = loadFacade(() => Promise.reject(new Error('x')));
  assert.deepEqual(await failing.attach(), { ok: false, reason: 'unavailable' });
  assert.deepEqual(await failing.getStatus(), { state: 'unavailable', code: 'unavailable' });
});
