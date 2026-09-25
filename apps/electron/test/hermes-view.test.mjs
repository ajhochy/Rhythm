import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { registerHermesView } from '../src/hermes-view.mjs';

const tick = () => new Promise((done) => setImmediate(done));
const ARTIFACT = Object.freeze({
  root: '/fixture/hermes-desktop',
  rendererUrl: 'file:///fixture/hermes-desktop/renderer/index.html?embedded=1',
  hostPath: '/fixture/hermes-desktop/electron/embedded-host.mjs',
  preloadPath: '/fixture/hermes-desktop/electron/preload.cjs',
});

function fixture(t, { artifactError, allowedOrigins, deferHost = false, deferRenderer = false, hostImport, onHostDispose, permissionResult = false, resolver, updateStore } = {}) {
  const handlers = new Map(), views = [], children = new Set(), hostCalls = [], intents = [], permissionRequests = [], guestOpens = [], guestNavigations = [];
  let mainStorageClears = 0;
  let publishAllowedOrigins;
  let releaseRendererLoad;
  let signalRendererLoadStarted;
  const rendererLoadStarted = new Promise((resolve) => { signalRendererLoadStarted = resolve; });
  const ipcMain = Object.assign(new EventEmitter(), { handle: (key, fn) => handlers.set(key, fn), removeHandler: (key) => handlers.delete(key) });
  const mainFrame = { url: 'rhythm://app/index.html#/hermes' };
  const hostContents = Object.assign(new EventEmitter(), { mainFrame, isDestroyed: () => false, getZoomFactor: () => 2 });
  const win = Object.assign(new EventEmitter(), {
    webContents: hostContents, isDestroyed: () => false, getContentBounds: () => ({ width: 1280, height: 800 }),
    contentView: { addChildView: (view) => children.add(view), removeChildView: (view) => children.delete(view) },
  });
  class WebContentsView {
    constructor(options) {
      this.options = options;
      views.push(this);
      const contents = Object.assign(new EventEmitter(), {
        id: 101, destroyed: false, loads: [], isDestroyed: () => contents.destroyed,
        close: () => { contents.destroyed = true; children.delete(this); },
        setWindowOpenHandler: (handler) => { contents.windowOpenHandler = handler; },
        setZoomFactor: (zoom) => { contents.zoom = zoom; },
        loadURL: async (url) => {
          contents.loads.push(url);
          signalRendererLoadStarted();
          if (deferRenderer) await new Promise((resolve) => { releaseRendererLoad = resolve; });
        },
        session: Object.assign(new EventEmitter(), {
          setPermissionRequestHandler: (fn) => { contents.permission = fn; },
          setPermissionCheckHandler: (fn) => { contents.permissionCheck = fn; },
          clearStorageData: async () => { mainStorageClears += 1; },
          webRequest: { onBeforeRequest: (fn) => { contents.request = fn; } },
        }),
      });
      this.webContents = contents;
    }
    setBounds(bounds) { this.bounds = bounds; }
  }
  let disposed = 0;
  let releaseHost;
  let signalHostStarted;
  const hostStarted = new Promise((resolve) => { signalHostStarted = resolve; });
  const module = { createEmbeddedHermesHost: async (options) => {
    signalHostStarted();
    hostCalls.push(options);
    const host = {
      dispose: async () => { disposed += 1; await onHostDispose?.(options.webContents); },
      handleIntent: async (intent) => { intents.push(intent); return { ok: true }; },
      getAllowedOrigins: async () => allowedOrigins ?? [],
      onAllowedOrigins: (callback) => { publishAllowedOrigins = callback; return () => { publishAllowedOrigins = undefined; }; },
      handlePermissionRequest: async (request) => { permissionRequests.push(request); return permissionResult; },
      handleWillAttachWebview: (webPreferences, params) => {
        if (params.partition !== 'persist:hermes-embedded-101-preview'
          || (params.src !== 'about:blank' && !/^https?:\/\//.test(String(params.src)))) return false;
        webPreferences.nodeIntegration = false;
        webPreferences.contextIsolation = true;
        webPreferences.sandbox = true;
        webPreferences.webSecurity = true;
        webPreferences.webviewTag = false;
        delete webPreferences.preload;
        return true;
      },
      handleGuestWindowOpen: async (url) => { guestOpens.push(url); return url.startsWith('https://'); },
      handleGuestNavigation: (url) => {
        guestNavigations.push(url);
        try { return ['http:', 'https:'].includes(new URL(url).protocol); } catch { return false; }
      },
    };
    if (!deferHost) return host;
    return new Promise((done) => { releaseHost = () => done(host); });
  } };
  const controller = registerHermesView({
    ipcMain,
    getWindow: () => win,
    getUserDataPath: () => '/fixture/rhythm-user-data',
    getArtifactRoot: () => '/fixture/hermes-desktop',
    resolveArtifact: resolver ?? (async () => { if (artifactError) throw new Error(artifactError); return ARTIFACT; }),
    importHost: hostImport ?? (async () => module),
    ...(updateStore ? { updateStore } : {}),
    electron: { WebContentsView },
  });
  t.after(() => controller.dispose());
  const event = { sender: hostContents, senderFrame: mainFrame };
  const call = (channel, value, sender = event) => value === undefined ? handlers.get(channel)(sender) : handlers.get(channel)(sender, value);
  return { call, children, controller, event, handlers, hostCalls, hostContents, hostStarted, intents, permissionRequests, guestOpens, guestNavigations, mainStorageClears: () => mainStorageClears, publishAllowedOrigins: (origins) => publishAllowedOrigins?.(origins), releaseHost: () => releaseHost?.(), releaseRendererLoad: () => releaseRendererLoad?.(), rendererLoadStarted, views, win, disposed: () => disposed };
}

for (const failure of ['corrupted', 'wrong-signature', 'unsupported-hostApiVersion', 'import-throws']) {
  test(`issue-1570-c-c1: ${failure} installed artifact falls back to factory and is never retried`, async (t) => {
    const bad = new Set();
    const resolutionRoots = [];
    const importedRoots = [];
    const candidates = [
      { kind: 'installed', root: `/updates/${failure}`, sequence: 7, version: '0.20.7' },
      { kind: 'factory', root: ARTIFACT.root },
    ];
    const updateStore = {
      beginLaunch: async (candidate) => !bad.has(candidate.version),
      getLaunchCandidates: async () => candidates.filter((candidate) => candidate.kind !== 'installed' || !bad.has(candidate.version)),
      markBad: async (candidate) => { bad.add(candidate.version) },
      markGood: async () => {},
    };
    const f = fixture(t, {
      updateStore,
      resolver: async ({ artifactRoot }) => {
        resolutionRoots.push(artifactRoot);
        if (artifactRoot !== ARTIFACT.root && failure !== 'import-throws') throw new Error(`installed ${failure}`);
        return artifactRoot === ARTIFACT.root ? ARTIFACT : { ...ARTIFACT, root: artifactRoot, hostPath: `${artifactRoot}/embedded-host.mjs` };
      },
      hostImport: async (hostPath) => {
        importedRoots.push(hostPath);
        if (failure === 'import-throws' && hostPath.startsWith('/updates/')) throw new Error('installed host import crashed');
        return {
          createEmbeddedHermesHost: async () => ({
            dispose: async () => {}, handleIntent: async () => ({ ok: true }), getAllowedOrigins: async () => [],
            onAllowedOrigins: () => () => {}, handlePermissionRequest: async () => false,
            handleWillAttachWebview: () => false, handleGuestWindowOpen: async () => false, handleGuestNavigation: () => false,
          }),
        };
      },
    });

    assert.equal((await f.call('hermes:view:attach')).ok, true);
    assert.equal(bad.has('0.20.7'), true);
    assert.deepEqual(resolutionRoots.slice(0, 2), [`/updates/${failure}`, ARTIFACT.root]);
    await f.controller.disposeCurrent();
    const attemptsBeforeRelaunch = resolutionRoots.filter((root) => root.startsWith('/updates/')).length;
    assert.equal((await f.call('hermes:view:attach')).ok, true);
    assert.equal(resolutionRoots.filter((root) => root.startsWith('/updates/')).length, attemptsBeforeRelaunch);
    if (failure === 'import-throws') assert.equal(importedRoots.some((root) => root.startsWith('/updates/')), true);
  });
}

test('issue-1570-c-c2: installed version becomes good only after host import and renderer readiness', async (t) => {
  const candidate = { kind: 'installed', root: '/updates/0.20.7', sequence: 7, version: '0.20.7' };
  const good = [];
  const updateStore = {
    beginLaunch: async () => true,
    getLaunchCandidates: async () => [candidate, { kind: 'factory', root: ARTIFACT.root }],
    markBad: async () => {},
    markGood: async (selected) => { good.push(selected); },
  };
  const f = fixture(t, { deferRenderer: true, resolver: async () => ARTIFACT, updateStore });

  const attaching = f.call('hermes:view:attach');
  await f.rendererLoadStarted;
  assert.deepEqual(good, []);
  f.releaseRendererLoad();
  assert.equal((await attaching).ok, true);
  assert.deepEqual(good, [candidate]);
});

test('issue-1542-desktop-c6: mounts the real local Desktop renderer with its packaged preload and host', async (t) => {
  const f = fixture(t);
  const result = await f.call('hermes:view:attach');
  assert.equal(result.ok, true);
  assert.equal(f.views.length, 1);
  assert.deepEqual(f.views[0].options.webPreferences, {
    preload: ARTIFACT.preloadPath, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, webviewTag: true,
    partition: f.views[0].options.webPreferences.partition,
  });
  assert.equal(f.views[0].options.webPreferences.partition, 'persist:rhythm-hermes-desktop');
  assert.deepEqual(f.views[0].webContents.loads, [ARTIFACT.rendererUrl]);
  assert.deepEqual(f.hostCalls[0], {
    hostWindow: f.win,
    webContents: f.views[0].webContents,
    assetRoot: ARTIFACT.root,
    userDataPath: '/fixture/rhythm-user-data',
    log: f.hostCalls[0].log,
  });
  assert.equal(f.children.has(f.views[0]), true);
});

test('issue-1542-desktop-c3-c4: preserves the mounted Desktop across a Rhythm tab switch and passes a draft to the host without navigation', async (t) => {
  const f = fixture(t);
  const first = await f.call('hermes:view:attach');
  f.hostContents.emit('did-start-navigation', {}, 'rhythm://app/index.html#/agents', true, true);
  assert.deepEqual(f.views[0].bounds, { x: 0, y: 0, width: 0, height: 0 });
  f.event.senderFrame.url = 'rhythm://app/index.html#/hermes';
  const second = await f.call('hermes:view:attach');
  assert.equal(second.attachment, first.attachment);
  assert.equal(f.views.length, 1);
  const result = await f.call('hermes:intent', { attachment: first.attachment, intent: { v: 1, type: 'new-chat', context: 'Review this dashboard context before sending.' } });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(f.intents, [{ v: 1, type: 'new-chat', context: 'Review this dashboard context before sending.' }]);
  assert.deepEqual(f.views[0].webContents.loads, [ARTIFACT.rendererUrl]);
});

test('issue-1542-desktop-c1: full Rhythm document revocation disposes the scoped Desktop host and stale attachment', async (t) => {
  const f = fixture(t);
  const attached = await f.call('hermes:view:attach');
  f.hostContents.emit('did-start-navigation', {}, 'rhythm://app/index.html#/login', false, true);
  await tick();
  assert.equal(f.disposed(), 1);
  assert.equal(f.children.size, 0);
  assert.equal(await f.call('hermes:view:bounds', { attachment: attached.attachment, bounds: { x: 0, y: 0, width: 1, height: 1 } }), false);
});

test('issue-1542-desktop-c5: terminal disposal waits for a host factory in flight and cleans its late result', async (t) => {
  let lateHostSawClosedRenderer = false;
  const f = fixture(t, {
    deferHost: true,
    onHostDispose: async (contents) => { lateHostSawClosedRenderer = contents.isDestroyed(); },
  });
  const attaching = f.call('hermes:view:attach');
  await f.hostStarted;
  const closing = f.controller.dispose();
  f.releaseHost();
  await Promise.all([attaching, closing]);
  assert.equal(f.disposed(), 1);
  assert.equal(f.children.size, 0);
  assert.equal(f.views[0].webContents.isDestroyed(), true);
  assert.equal(lateHostSawClosedRenderer, true);
});

test('issue-1542-desktop-c5: authentication reset disposes the current host but leaves the controller able to attach again', async (t) => {
  const f = fixture(t);
  await f.call('hermes:view:attach');
  await f.controller.disposeCurrent();
  assert.equal(f.disposed(), 1);
  const next = await f.call('hermes:view:attach');
  assert.equal(next.ok, true);
  assert.equal(f.views.length, 2);
  assert.equal(f.children.size, 1);
});

test('issue-1542-desktop-c3: recreates the renderer in a stable persistent Desktop partition without clearing its state', async (t) => {
  const f = fixture(t);
  await f.call('hermes:view:attach');
  const firstPartition = f.views[0].options.webPreferences.partition;
  await f.controller.disposeCurrent();
  await f.call('hermes:view:attach');
  const secondPartition = f.views[1].options.webPreferences.partition;
  assert.equal(firstPartition, 'persist:rhythm-hermes-desktop');
  assert.equal(secondPartition, firstPartition);
  assert.equal(f.mainStorageClears(), 0);
});

test('issue-1542-desktop-c5: closes the renderer while its guards remain installed before native teardown', async (t) => {
  const events = [];
  let hostSawDestroyedRenderer = false;
  let hostSawNetworkGuard = false;
  const f = fixture(t, {
    onHostDispose: async (contents) => {
      events.push('host-dispose');
      hostSawDestroyedRenderer = contents.isDestroyed();
      hostSawNetworkGuard = typeof contents.request === 'function';
      let blocked;
      if (hostSawNetworkGuard) contents.request({ url: 'https://untrusted.example/poll' }, (result) => { blocked = result.cancel; });
      hostSawNetworkGuard &&= blocked === true;
    },
  });
  await f.call('hermes:view:attach');
  const contents = f.views[0].webContents;
  const originalClose = contents.close;
  contents.close = (options) => {
    events.push('renderer-close');
    originalClose(options);
  };

  await f.controller.disposeCurrent();

  assert.deepEqual(events, ['renderer-close', 'host-dispose']);
  assert.equal(hostSawDestroyedRenderer, true);
  assert.equal(hostSawNetworkGuard, true);
  assert.equal(contents.request, null);
});

test('issue-1542-desktop-c1: rejects a sibling Rhythm frame before resolving or creating an embedded host', async (t) => {
  const f = fixture(t);
  const sibling = { sender: f.hostContents, senderFrame: { url: 'rhythm://app/index.html#/hermes' } };
  assert.deepEqual(await f.call('hermes:view:attach', undefined, sibling), { ok: false, reason: 'Hermes Desktop is unavailable in this Rhythm session.' });
  assert.equal(f.hostCalls.length, 0);
});

test('issue-1542-desktop-c1: permits only host-validated gateway origins and local packaged assets', async (t) => {
  const f = fixture(t, { allowedOrigins: ['ws://127.0.0.1:43111', 'http://127.0.0.1:43111'] });
  await f.call('hermes:view:attach');
  const request = f.views[0].webContents.request;
  let approved;
  request({ url: 'ws://127.0.0.1:43111/api/ws?token=host-minted' }, (result) => { approved = result; });
  assert.deepEqual(approved, { cancel: false });
  let denied;
  request({ url: 'ws://127.0.0.1:9121/api/ws?token=untrusted' }, (result) => { denied = result; });
  assert.deepEqual(denied, { cancel: true });
  let asset;
  request({ url: 'file:///fixture/hermes-desktop/renderer/assets/app.js' }, (result) => { asset = result; });
  assert.deepEqual(asset, { cancel: false });
  let typographyStylesheet;
  request({ url: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap', resourceType: 'stylesheet' }, (result) => { typographyStylesheet = result; });
  assert.deepEqual(typographyStylesheet, { cancel: false });
  let typographyFont;
  request({ url: 'https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbY2oWUg0MKqScQ7Q.woff2', resourceType: 'font' }, (result) => { typographyFont = result; });
  assert.deepEqual(typographyFont, { cancel: false });
  let typographyFetch;
  request({ url: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono', resourceType: 'fetch' }, (result) => { typographyFetch = result; });
  assert.deepEqual(typographyFetch, { cancel: true });
  let unrelatedStylesheet;
  request({ url: 'https://fonts.googleapis.com/analytics.js', resourceType: 'stylesheet' }, (result) => { unrelatedStylesheet = result; });
  assert.deepEqual(unrelatedStylesheet, { cancel: true });
  let media;
  request({ url: 'hermes-media://embedded/audio/voice.wav' }, (result) => { media = result; });
  assert.deepEqual(media, { cancel: false });
  let custom;
  request({ url: 'attacker-media://embedded/audio/voice.wav' }, (result) => { custom = result; });
  assert.deepEqual(custom, { cancel: true });
  f.publishAllowedOrigins(['wss://remote.example.test']);
  let revoked;
  request({ url: 'ws://127.0.0.1:43111/api/ws?token=previous' }, (result) => { revoked = result; });
  assert.deepEqual(revoked, { cancel: true });
  let replacement;
  request({ url: 'wss://remote.example.test/api/ws?token=host-minted' }, (result) => { replacement = result; });
  assert.deepEqual(replacement, { cancel: false });
});

test('issue-1542-desktop-c1: permits only the exact local entry document across Hermes SPA hash routes', async (t) => {
  const f = fixture(t);
  await f.call('hermes:view:attach');
  let permitted = false;
  f.views[0].webContents.emit('will-frame-navigate', { preventDefault: () => { permitted = true; }, url: `${ARTIFACT.rendererUrl}#/settings`, isMainFrame: true });
  assert.equal(permitted, false);
  let siblingDenied = false;
  f.views[0].webContents.emit('will-frame-navigate', { preventDefault: () => { siblingDenied = true; }, url: 'file:///fixture/hermes-desktop/renderer/other.html', isMainFrame: true });
  assert.equal(siblingDenied, true);
  let childDenied = false;
  f.views[0].webContents.emit('will-frame-navigate', { preventDefault: () => { childDenied = true; }, url: `${ARTIFACT.rendererUrl}#/chat`, isMainFrame: false });
  assert.equal(childDenied, true);
});

test('issue-1542-desktop-c8: permits only the existing isolated browser guest and keeps it outside the Hermes bridge', async (t) => {
  const f = fixture(t);
  await f.call('hermes:view:attach');
  const webPreferences = { preload: '/fixture/attacker-preload.cjs', nodeIntegration: true, contextIsolation: false, sandbox: false, webviewTag: true };
  const params = { partition: 'persist:hermes-preview', src: 'https://example.test/path', allowpopups: true };
  let denied = false;
  f.views[0].webContents.emit('will-attach-webview', { preventDefault: () => { denied = true; } }, webPreferences, params);
  assert.equal(denied, false);
  assert.equal(params.partition, 'persist:hermes-embedded-101-preview');
  assert.deepEqual(webPreferences, { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false });
  let storageCleared = 0;
  const guestSession = Object.assign(new EventEmitter(), {
    clearStorageData: async () => { storageCleared += 1; },
    setPermissionRequestHandler: (handler) => { guestSession.permission = handler; },
    setPermissionCheckHandler: (handler) => { guestSession.permissionCheck = handler; },
  });
  const guestLoads = [];
  const guest = Object.assign(new EventEmitter(), {
    setWindowOpenHandler: (handler) => { guest.windowOpenHandler = handler; },
    loadURL: async (url) => { guestLoads.push(url); },
    session: guestSession,
  });
  f.views[0].webContents.emit('did-attach-webview', {}, guest);
  assert.deepEqual(guest.windowOpenHandler({ url: 'https://example.test/popout' }), { action: 'deny' });
  await tick();
  assert.deepEqual(f.guestOpens, ['https://example.test/popout']);
  let guestPermission;
  guestSession.permission(null, 'media', (value) => { guestPermission = value; });
  assert.equal(guestPermission, false);
  assert.equal(guestSession.permissionCheck(), false);
  let guestDownloadCancelled = false;
  guestSession.emit('will-download', { preventDefault: () => { guestDownloadCancelled = true; } });
  assert.equal(guestDownloadCancelled, true);
  let remoteGuestNavigationDenied = false;
  guest.emit('will-navigate', { preventDefault: () => { remoteGuestNavigationDenied = true; }, url: 'https://example.test/next' });
  assert.equal(remoteGuestNavigationDenied, false);
  let localGuestNavigationDenied = false;
  guest.emit('will-navigate', { preventDefault: () => { localGuestNavigationDenied = true; }, url: 'file:///fixture/hermes-desktop/renderer/index.html' });
  assert.equal(localGuestNavigationDenied, true);
  let dataGuestFrameDenied = false;
  guest.emit('will-frame-navigate', { preventDefault: () => { dataGuestFrameDenied = true; }, url: 'data:text/html,attack', isMainFrame: false });
  assert.equal(dataGuestFrameDenied, true);
  let redirectGuestNavigationDenied = false;
  guest.emit('will-redirect', { preventDefault: () => { redirectGuestNavigationDenied = true; }, url: 'javascript:alert(1)', isMainFrame: true });
  assert.equal(redirectGuestNavigationDenied, true);
  assert.deepEqual(f.guestNavigations, [
    'https://example.test/next',
    'file:///fixture/hermes-desktop/renderer/index.html',
    'data:text/html,attack',
    'javascript:alert(1)',
  ]);
  await guest.loadURL('https://example.test/programmatic');
  await assert.rejects(guest.loadURL('javascript:alert(1)'), /denied/i);
  assert.deepEqual(guestLoads, ['https://example.test/programmatic']);
  assert.deepEqual(f.guestNavigations.slice(-2), ['https://example.test/programmatic', 'javascript:alert(1)']);

  const foreignPreferences = {};
  let foreignDenied = false;
  f.views[0].webContents.emit('will-attach-webview', { preventDefault: () => { foreignDenied = true; } }, foreignPreferences, { partition: 'persist:attacker', src: 'https://example.test' });
  assert.equal(foreignDenied, true);
  let localDenied = false;
  f.views[0].webContents.emit('will-attach-webview', { preventDefault: () => { localDenied = true; } }, {}, { partition: 'persist:hermes-preview', src: 'file:///fixture/hermes-desktop/renderer/index.html' });
  assert.equal(localDenied, true);
  await f.controller.disposeCurrent();
  assert.equal(storageCleared, 1);
});

test('issue-1542-desktop-c8: consumes only a host-approved, exact-renderer microphone lease', async (t) => {
  const f = fixture(t, { permissionResult: true });
  await f.call('hermes:view:attach');
  const contents = f.views[0].webContents;
  assert.equal(contents.permissionCheck(contents, 'media', 'file:///fixture/hermes-desktop/renderer/index.html'), true);
  assert.equal(contents.permissionCheck(contents, 'notifications', ARTIFACT.rendererUrl), false);
  let granted;
  contents.permission(contents, 'media', (value) => { granted = value; }, { requestingUrl: ARTIFACT.rendererUrl, mediaTypes: ['audio'] });
  await tick();
  assert.equal(granted, true);
  assert.deepEqual(f.permissionRequests, [{ permission: 'media', requestingUrl: ARTIFACT.rendererUrl, mediaTypes: ['audio'], isMainFrame: true }]);
  let foreignGranted;
  contents.permission({ id: 'guest' }, 'media', (value) => { foreignGranted = value; }, { requestingUrl: ARTIFACT.rendererUrl, mediaTypes: ['audio'] });
  assert.equal(foreignGranted, false);
});

test('issue-1542-desktop-c6: reports a missing artifact honestly and never starts a dashboard fallback', async (t) => {
  const f = fixture(t, { artifactError: 'Hermes Desktop artifact is missing at /fixture/hermes-desktop. Rebuild the pinned Hermes Desktop artifact before opening the Hermes tab.' });
  const result = await f.call('hermes:view:attach');
  assert.equal(result.ok, false);
  assert.match(result.reason, /artifact is missing.*Rebuild/i);
  assert.equal(f.views.length, 0);
  assert.equal(f.hostCalls.length, 0);
});
