import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { isOpenDesignNavigationUrl, isOpenDesignRequestUrl, OPEN_DESIGN_UNAVAILABLE, registerOpenDesignView } from '../src/open-design-view.mjs';

// Deterministic Electron fixture: WebContentsView, sessions, frames, and IPC are injected fakes.
const ORIGIN = 'http://127.0.0.1:49545';
const READY = { state: 'ready', origin: ORIGIN, identityPid: 10, listenerPid: 11 };
const FAILURE = { ok: false, reason: OPEN_DESIGN_UNAVAILABLE };
const tick = () => new Promise((resolve) => setImmediate(resolve));

function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }

function fixture({ discover, load, fail = {}, isTrustedSender } = {}) {
  const log = [];
  const ipcMain = { handlers: new Map(), handle(name, handler) { this.handlers.set(name, handler); }, removeHandler(name) { this.handlers.delete(name); } };
  const views = [];
  let nextId = 1;
  class WebContentsView {
    constructor(options) {
      // Explicit `=== true`: `fail.constructor` is Object.prototype.constructor (truthy) otherwise.
      if (fail.constructor === true) throw new Error('/private/native/path constructor failed');
      this.options = options;
      this.bounds = [];
      const id = nextId++;
      const partition = Object.assign(new EventEmitter(), {
        webRequest: { onBeforeRequest(handler) { if (handler === null && fail.guardRemoval === true) throw new Error('guard removal failed'); partition.requestHandler = handler; if (handler === null) log.push(`guards-removed:${id}`); } },
        setPermissionRequestHandler(handler) { partition.permissionRequest = handler; },
        setPermissionCheckHandler(handler) { if (fail.config === true && handler) throw new Error('config failed'); partition.permissionCheck = handler; },
        async clearStorageData() { log.push(`clear:${id}`); if (fail.clear === true) throw new Error('clear failed'); },
      });
      this.webContents = Object.assign(new EventEmitter(), {
        id, session: partition, destroyed: false, loads: [],
        isDestroyed() { return this.destroyed; },
        close() { log.push(`close:${id}`); if (fail.close === true) throw new Error('close failed'); this.destroyed = true; },
        setWindowOpenHandler(handler) { this.windowOpen = handler; },
        async loadURL(url) { this.loads.push(url); if (fail.load === true) throw new Error('/private load failed'); if (load) await load(url, this); },
        setZoomFactor(value) { this.zoom = value; },
      });
      views.push(this);
    }
    setBounds(value) { if (fail.setBounds === true) throw new Error('setBounds failed'); this.bounds.push(value); }
  }
  const host = Object.assign(new EventEmitter(), { mainFrame: { url: 'rhythm://app/index.html#/open-design' }, zoom: 1, getZoomFactor() { return this.zoom; }, focus() {}, isDestroyed: () => false });
  const children = new Set();
  const win = {
    webContents: host,
    contentView: {
      addChildView(view) { if (fail.add === true) throw new Error('add failed'); children.add(view); },
      removeChildView(view) { log.push(`remove:${view.webContents.id}`); if (fail.remove === true) throw new Error('remove failed'); children.delete(view); },
    },
    isDestroyed: () => false, getContentBounds: () => ({ width: 800, height: 600 }),
  };
  const owner = registerOpenDesignView({ ipcMain, getWindow: () => win, electron: { WebContentsView }, discoverRuntime: discover ?? (async () => READY), isTrustedSender });
  const event = () => ({ sender: host, senderFrame: host.mainFrame });
  const call = (name, ...args) => ipcMain.handlers.get(name)(...args);
  const navigateHash = (hash) => { host.mainFrame.url = `rhythm://app/index.html#${hash}`; host.emit('did-start-navigation', { url: host.mainFrame.url, isMainFrame: true, isSameDocument: true }); };
  const listenerTotal = (view) => [view.webContents, view.webContents.session, host].reduce((sum, emitter) => sum + emitter.eventNames().reduce((n, name) => n + emitter.listenerCount(name), 0), 0);
  return { ipcMain, owner, host, win, views, children, log, event, call, navigateHash, listenerTotal };
}

const navigation = (url) => ({ url, prevented: false, preventDefault() { this.prevented = true; } });

test('AT-VIEW-01 only the exact host main frame may attach; non-owners get an explicit failure', async () => {
  const f = fixture();
  for (const evt of [
    { sender: f.host, senderFrame: { url: 'rhythm://app/index.html#/open-design' } },
    { sender: {}, senderFrame: f.host.mainFrame },
  ]) assert.deepEqual(await f.call('open-design:view:attach', evt), FAILURE);
  f.host.mainFrame.url = 'rhythm://app/index.html#/hermes';
  assert.deepEqual(await f.call('open-design:view:attach', f.event()), FAILURE);
  f.host.mainFrame.url = 'rhythm://app/index.html#/open-design';
  assert.deepEqual(await f.call('open-design:view:attach', f.event(), 'renderer-supplied-url'), FAILURE);
  assert.equal(f.views.length, 0);
  const attached = await f.call('open-design:view:attach', f.event());
  assert.equal(attached.ok, true);
  assert.equal(typeof attached.attachment, 'string'); // main → preload only; preload strips it (AT-PRE-*)
  assert.deepEqual(f.views[0].webContents.loads, [`${ORIGIN}/`]);
  const prefs = f.views[0].options.webPreferences;
  assert.equal(prefs.preload, undefined);
  assert.deepEqual([prefs.sandbox, prefs.contextIsolation, prefs.nodeIntegration, prefs.webviewTag], [true, true, false, false]);
  await f.owner.dispose();
});

test('AT-VIEW-02 requests allow same-origin http and matching ws; navigation and redirects are same-origin http only', async () => {
  assert.equal(isOpenDesignRequestUrl(`${ORIGIN}/api`, ORIGIN), true);
  assert.equal(isOpenDesignRequestUrl('ws://127.0.0.1:49545/socket', ORIGIN), true);
  for (const url of ['ws://127.0.0.1:49546/socket', 'wss://127.0.0.1:49545/', 'ws://localhost:49545/', 'https://127.0.0.1:49545/', 'http://127.0.0.1:49546/', 'file:///etc/passwd']) assert.equal(isOpenDesignRequestUrl(url, ORIGIN), false, url);
  assert.equal(isOpenDesignNavigationUrl('ws://127.0.0.1:49545/socket', ORIGIN), false);

  const f = fixture();
  await f.call('open-design:view:attach', f.event());
  const contents = f.views[0].webContents;
  const decide = (details) => { let result; contents.session.requestHandler(details, (value) => { result = value; }); return result.cancel; };
  assert.equal(decide({ url: 'ws://127.0.0.1:49545/socket', webContentsId: contents.id }), false);
  assert.equal(decide({ url: `${ORIGIN}/`, webContentsId: contents.id + 99 }), true, 'foreign renderer');
  assert.equal(decide({ url: `${ORIGIN}/` }), true, 'unattributed request');
  assert.equal(decide({ url: 'https://example.invalid/', webContentsId: contents.id }), true);
  for (const name of ['will-navigate', 'will-redirect', 'will-frame-navigate']) {
    for (const [url, prevented] of [['ws://127.0.0.1:49545/', true], ['https://example.invalid/', true], [`${ORIGIN}/project`, false]]) {
      const nav = navigation(url);
      contents.emit(name, nav);
      assert.equal(nav.prevented, prevented, `${name} ${url}`);
    }
  }
  const webview = navigation('');
  contents.emit('will-attach-webview', webview);
  assert.equal(webview.prevented, true);
  assert.deepEqual(contents.windowOpen({ url: `${ORIGIN}/` }), { action: 'deny' });
  let permission;
  contents.session.permissionRequest(contents, 'media', (value) => { permission = value; });
  assert.equal(permission, false);
  assert.equal(contents.session.permissionCheck(), false);
  const download = navigation('');
  contents.session.emit('will-download', download);
  assert.equal(download.prevented, true);
  await f.owner.dispose();
});

test('AT-VIEW-03 port 80 origins compare as normalised origins for http and ws', () => {
  const origin = 'http://127.0.0.1';
  for (const url of ['http://127.0.0.1/', 'http://127.0.0.1:80/x', 'ws://127.0.0.1/', 'ws://127.0.0.1:80/socket']) assert.equal(isOpenDesignRequestUrl(url, origin), true, url);
  for (const url of ['http://127.0.0.1:8080/', 'ws://127.0.0.1:443/', 'wss://127.0.0.1/']) assert.equal(isOpenDesignRequestUrl(url, origin), false, url);
});

test('AT-VIEW-04 hash tab leave suspends and return resumes the same view without reload', async () => {
  const f = fixture();
  const first = await f.call('open-design:view:attach', f.event());
  assert.equal(await f.call('open-design:view:bounds', f.event(), { attachment: first.attachment, bounds: { x: 10, y: 10, width: 900, height: 700 } }), true);
  assert.deepEqual(f.views[0].bounds.at(-1), { x: 10, y: 10, width: 790, height: 590 });
  f.navigateHash('/tasks');
  assert.deepEqual(f.views[0].bounds.at(-1), { x: 0, y: 0, width: 0, height: 0 });
  assert.equal(f.children.size, 1);
  assert.equal(await f.call('open-design:view:bounds', f.event(), { attachment: first.attachment, bounds: { x: 0, y: 0, width: 10, height: 10 } }), false, 'inactive tab cannot place view');
  f.navigateHash('/open-design');
  const again = await f.call('open-design:view:attach', f.event());
  assert.equal(again.attachment, first.attachment);
  assert.equal(f.views.length, 1);
  assert.equal(f.views[0].webContents.loads.length, 1);
  assert.equal(await f.call('open-design:view:detach', f.event(), { attachment: 'forged' }), false);
  assert.equal(await f.call('open-design:view:detach', f.event(), { attachment: first.attachment }), true);
  assert.equal(f.children.size, 1);
  await f.owner.dispose();
});

test('AT-VIEW-05 bounds are zoom-scaled and clipped to the content area', async () => {
  const f = fixture();
  const { attachment } = await f.call('open-design:view:attach', f.event());
  f.host.zoom = 2;
  assert.equal(await f.call('open-design:view:bounds', f.event(), { attachment, bounds: { x: 100, y: 50, width: 400, height: 400 } }), true);
  assert.deepEqual(f.views[0].bounds.at(-1), { x: 200, y: 100, width: 600, height: 500 });
  assert.equal(f.views[0].webContents.zoom, 2);
  await f.owner.dispose();
});

test('AT-VIEW-06 a delayed discovery is revoked when the host leaves the route', async () => {
  const gate = deferred();
  const f = fixture({ discover: async () => { await gate.promise; return READY; } });
  const pending = f.call('open-design:view:attach', f.event());
  await tick(); // attach is now awaiting discovery
  f.host.mainFrame.url = 'rhythm://app/index.html#/tasks';
  gate.resolve();
  assert.deepEqual(await pending, FAILURE);
  assert.equal(f.views.length, 0);
  await f.owner.dispose();
});

test('AT-VIEW-07 a delayed load is revoked and its view closed when the host leaves meanwhile', async () => {
  const gate = deferred();
  const f = fixture({ load: () => gate.promise });
  const pending = f.call('open-design:view:attach', f.event());
  await tick();
  f.navigateHash('/tasks');
  gate.resolve();
  assert.deepEqual(await pending, FAILURE);
  assert.equal(f.children.size, 0);
  assert.equal(f.views[0].webContents.destroyed, true);
  await f.owner.dispose();
});

test('AT-VIEW-08 a load that never settles cannot block disposal or the attach queue', async () => {
  const f = fixture({ load: () => new Promise(() => {}) });
  const pending = f.call('open-design:view:attach', f.event());
  await tick();
  await f.owner.disposeCurrent();
  assert.deepEqual(await pending, FAILURE);
  assert.equal(f.views[0].webContents.destroyed, true);
  await f.owner.dispose();
  assert.equal(f.ipcMain.handlers.size, 0);
});

test('AT-VIEW-09 cached attachment is never reused by a new document or changed runtime', async () => {
  let runtime = READY;
  const f = fixture({ discover: async () => runtime });
  const first = await f.call('open-design:view:attach', f.event());
  f.host.mainFrame = { url: 'rhythm://app/index.html#/open-design' }; // new host document without a navigation event
  const second = await f.call('open-design:view:attach', f.event());
  assert.notEqual(second.attachment, first.attachment);
  assert.equal(f.views[0].webContents.destroyed, true);
  runtime = { ...READY, listenerPid: 12 };
  const third = await f.call('open-design:view:attach', f.event());
  assert.notEqual(third.attachment, second.attachment);
  assert.equal(f.views[1].webContents.destroyed, true);
  assert.equal(f.children.size, 1);
  await f.owner.dispose();
});

test('AT-VIEW-10 disposal closes the renderer before guards are removed and removes every named listener', async () => {
  const f = fixture();
  await f.call('open-design:view:attach', f.event());
  const view = f.views[0];
  await f.owner.disposeCurrent();
  const id = view.webContents.id;
  const order = (entry) => f.log.indexOf(`${entry}:${id}`);
  assert.ok(order('remove') >= 0 && order('remove') < order('close'));
  assert.ok(order('close') < order('clear') && order('clear') < order('guards-removed'));
  assert.equal(f.listenerTotal(view), 0);
  // disposeCurrent (profile reset / document revocation) keeps IPC for a fresh attach.
  assert.equal(f.ipcMain.handlers.size, 4);
  assert.equal((await f.call('open-design:view:attach', f.event())).ok, true);
  assert.equal(f.views.length, 2);
  // dispose (quit) removes every handler.
  await f.owner.dispose();
  assert.equal(f.ipcMain.handlers.size, 0);
});

test('AT-VIEW-11 a guest that survives a failed close keeps every denial until destroyed; host listeners and channels go now', async () => {
  const f = fixture({ fail: { remove: true, close: true, clear: true } });
  assert.equal((await f.call('open-design:view:attach', f.event())).ok, true);
  const view = f.views[0];
  const contents = view.webContents;
  await f.owner.dispose();
  assert.equal(f.ipcMain.handlers.size, 0, 'IPC channels removed');
  assert.equal(f.host.eventNames().reduce((n, name) => n + f.host.listenerCount(name), 0), 0, 'host navigation listeners removed promptly');
  assert.deepEqual(view.bounds.at(-1), { x: 0, y: 0, width: 0, height: 0 }, 'concealed');
  // Surviving guest: guards are NOT broadened.
  assert.ok(!f.log.includes(`guards-removed:${contents.id}`));
  let decision;
  contents.session.requestHandler({ url: 'https://example.invalid/', webContentsId: contents.id }, (value) => { decision = value; });
  assert.equal(decision.cancel, true);
  assert.equal(contents.session.permissionCheck(), false);
  const nav = navigation('https://example.invalid/');
  contents.emit('will-navigate', nav);
  assert.equal(nav.prevented, true);
  // Later native destruction completes the cleanup.
  contents.destroyed = true;
  contents.emit('destroyed');
  assert.ok(f.log.includes(`guards-removed:${contents.id}`));
  assert.equal(contents.session.permissionCheck, null);
  assert.equal(f.listenerTotal(view), 0);
});

test('AT-VIEW-16 guard removals are independent: one throwing does not skip the others', async () => {
  const f = fixture({ fail: { guardRemoval: true } });
  assert.equal((await f.call('open-design:view:attach', f.event())).ok, true);
  const contents = f.views[0].webContents;
  await f.owner.dispose();
  assert.equal(contents.session.permissionRequest, null);
  assert.equal(contents.session.permissionCheck, null);
  assert.equal(f.listenerTotal(f.views[0]), 0);
  assert.equal(f.ipcMain.handlers.size, 0);
});

test('AT-VIEW-12 native construction/config/add/setBounds/load failures return safe failure and close the partial guest', async () => {
  for (const kind of ['constructor', 'config', 'add', 'setBounds', 'load']) {
    const f = fixture({ fail: { [kind]: true } });
    const result = await f.call('open-design:view:attach', f.event());
    assert.deepEqual(result, FAILURE, kind);
    assert.doesNotMatch(JSON.stringify(result), /private|failed/, kind);
    assert.equal(f.children.size, 0, kind);
    for (const view of f.views) {
      assert.equal(view.webContents.destroyed, true, kind);
      assert.equal(f.listenerTotal(view), 0, kind);
    }
    assert.equal(await f.call('open-design:view:bounds', f.event(), { attachment: 'any', bounds: { x: 0, y: 0, width: 1, height: 1 } }), false, kind);
    await f.owner.dispose();
    assert.equal(f.ipcMain.handlers.size, 0, kind);
  }
});

test('AT-VIEW-13 the optional builder trust check is enforced in addition to frame/route ownership', async () => {
  for (const isTrustedSender of [() => false, () => { throw new Error('auth snapshot unavailable'); }, () => 'yes']) {
    const f = fixture({ isTrustedSender });
    assert.deepEqual(await f.call('open-design:view:attach', f.event()), FAILURE);
    assert.deepEqual(await f.call('open-design:status', f.event()), { state: 'unavailable', code: 'unavailable' });
    assert.equal(f.views.length, 0);
    await f.owner.dispose();
  }
  let trusted = true;
  const f = fixture({ isTrustedSender: () => trusted });
  const { attachment } = await f.call('open-design:view:attach', f.event());
  trusted = false; // signed out / blocked while attached
  assert.equal(await f.call('open-design:view:bounds', f.event(), { attachment, bounds: { x: 0, y: 0, width: 1, height: 1 } }), false);
  await f.owner.dispose();
});

test('AT-VIEW-14 stale renderer callbacks cannot revoke a newer view; full navigation disposes', async () => {
  const f = fixture();
  await f.call('open-design:view:attach', f.event());
  const stale = f.views[0].webContents;
  f.host.mainFrame = { url: 'rhythm://app/index.html#/open-design' };
  const current = await f.call('open-design:view:attach', f.event());
  stale.emit('render-process-gone');
  await tick();
  assert.equal(f.views[1].webContents.destroyed, false);
  assert.equal(await f.call('open-design:view:bounds', f.event(), { attachment: current.attachment, bounds: { x: 0, y: 0, width: 10, height: 10 } }), true);
  f.host.emit('did-start-navigation', { url: 'rhythm://app/index.html#/open-design', isMainFrame: true, isSameDocument: false });
  await tick();
  assert.equal(f.views[1].webContents.destroyed, true);
  assert.equal(f.children.size, 0);
  await f.owner.dispose();
});

test('AT-VIEW-15 status is ready/unavailable only and never exposes runtime details', async () => {
  const f = fixture();
  assert.deepEqual(await f.call('open-design:status', f.event()), { state: 'ready' });
  assert.deepEqual(await f.call('open-design:status', { sender: f.host, senderFrame: {} }), { state: 'unavailable', code: 'unavailable' });
  const down = fixture({ discover: async () => { throw new Error('/secret/path'); } });
  assert.deepEqual(await down.call('open-design:status', down.event()), { state: 'unavailable', code: 'unavailable' });
  assert.deepEqual(await down.call('open-design:view:attach', down.event()), FAILURE);
  await f.owner.dispose();
  await down.owner.dispose();
});
