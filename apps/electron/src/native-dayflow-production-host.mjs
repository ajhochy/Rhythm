import { randomBytes } from 'node:crypto';
import { isAbsolute, join } from 'node:path';

// Main-process owner of the ORIGINAL native Dayflow view embedded in Rhythm's own window.
// Everything native (addon, wrapper, install, services) is injected and lazy: construction,
// status and registration never load the addon, install, start services or ask for a permission.
// The renderer only gets the six-method `dayflowView` facade; it never sees a handle, path,
// service mode or host event. The per-document lease below is returned only to the preload closure.

// Fixed, builder-pinned identity (package-mac.mjs CFBundleIdentifier) and sidecar location inside the
// trusted native root, beside the addon and dylib. Nothing here is renderer-, PATH- or cwd-derived.
export const RHYTHM_BUNDLE_IDENTIFIER = 'com.rhythm.desktop';
export const WRAPPER_FILE_NAME = 'native-dayflow-embedded-host.cjs';
export const DAYFLOW_ROUTE = 'rhythm://app/index.html#/tools/dayflow';
// Exact, query-free: any query, extra hash segment or trailing slash is NOT the Dayflow tool.
const ROUTE_PATTERN = /^rhythm:\/\/app\/index\.html#\/tools\/dayflow$/;
const CHANNELS = ['status', 'attach', 'bounds', 'blocked', 'detach', 'return-focus'].map((name) => `dayflow:view:${name}`);
const PUMP_MS = 1000;
const MAX_SOCKET_PATH_BYTES = 100;
const MAX_EVENTS_PER_TICK = 16;
const UNAVAILABLE = Object.freeze({ state: 'unavailable', code: 'unavailable' });

/** @param {unknown} value @param {string[]} keys */
const exactObject = (value, keys) => Boolean(value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)));

/** Exact four finite CSS keys, bounded, non-negative size. @param {unknown} value */
function parseBounds(value) {
  if (!exactObject(value, ['x', 'y', 'width', 'height'])) return null;
  const { x, y, width, height } = /** @type {Record<string, unknown>} */ (value);
  const numbers = [x, y, width, height];
  if (!numbers.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1_000_000)) return null;
  return Number(width) >= 0 && Number(height) >= 0 ? { x: Number(x), y: Number(y), width: Number(width), height: Number(height) } : null;
}

/**
 * @param {{
 *   ipcMain: { handle(channel: string, listener: Function): void, removeHandler(channel: string): void },
 *   getWindow: () => Electron.BrowserWindow | undefined,
 *   isTrustedSender?: (event: any) => boolean,
 *   loadModule: (wrapperPath: string) => any,
 *   loadAddon: (addonPath: string) => any,
 *   nativeRoot: string, appBundlePath: string, dataRoot: string,
 *   identity: { bundleIdentifier: string, displayName: string, shortVersion: string, build: string | number },
 *   isSupported?: () => boolean,
 *   exists?: (path: string) => boolean,
 *   openDownloadPage: () => unknown,
 *   loginItem: { get(): boolean, set(enabled: boolean): void },
 *   showQuitReopenInstruction: () => unknown,
 *   scheduler?: { set(fn: () => void, ms: number): unknown, clear(handle: unknown): void },
 *   newLease?: () => string,
 *   log?: (message: string) => void,
 * }} options
 */
export function registerNativeDayflowProductionHost(options) {
  const {
    ipcMain, getWindow, loadModule, loadAddon, nativeRoot, appBundlePath, dataRoot, identity, openDownloadPage, loginItem, showQuitReopenInstruction,
  } = options;
  const isTrustedSender = options.isTrustedSender ?? (() => true);
  const isSupported = options.isSupported ?? (() => true);
  const exists = options.exists ?? (() => true);
  const scheduler = options.scheduler ?? { set: (fn, ms) => { const handle = setInterval(fn, ms); handle.unref?.(); return handle; }, clear: (handle) => clearInterval(/** @type {ReturnType<typeof setInterval>} */ (handle)) };
  const newLease = options.newLease ?? (() => randomBytes(16).toString('hex'));
  const log = options.log ?? (() => {});

  /** @type {any} */ let wrapper;
  /** idle -> context (installed + helper configured, NO original service) -> started | failed (sticky: no retry/restart) */
  let services = 'idle';
  let moduleFailed = false;
  /** @type {any} */ let nativeMod;
  /** @type {Electron.BrowserWindow | undefined} */ let readyWindow;
  let ticking = false;
  let pumpGeneration = 0;
  let notificationsStarted = false;
  let disposed = false;
  /** @type {unknown} */ let pump;
  let modals = 0;
  let epoch = 0;
  let transition = Promise.resolve();
  /** @typedef {{ window: Electron.BrowserWindow, webContents: Electron.WebContents, mainFrame: Electron.WebFrameMain, lease: string, epoch: number, measured: boolean, rendererBlocked: boolean, shown: boolean }} Attachment */
  /** @type {Attachment | undefined} */
  let active;
  const bound = new WeakSet();

  /** The ONE wrapper location: inside the trusted absolute native root. No fallback is ever tried. */
  const getModule = () => {
    if (!nativeMod) {
      if (moduleFailed) throw new Error('native Dayflow wrapper unavailable');
      try {
        if (!isAbsolute(nativeRoot) || nativeRoot.split('/').includes('..')) throw new Error('untrusted native root');
        nativeMod = loadModule(join(nativeRoot, WRAPPER_FILE_NAME));
      } catch (error) { moduleFailed = true; throw error; }
    }
    return nativeMod;
  };
  const nativeModule = getModule;
  const getWrapper = () => {
    if (!wrapper) {
      const mod = getModule();
      wrapper = mod.createEmbeddedDayflowHost({ loadAddon, layout: mod.resolvePackagedLayout(nativeRoot) });
    }
    return wrapper;
  };

  /** Pure availability: no addon load. */
  const available = () => {
    if (disposed || services === 'failed' || !isSupported()) return false;
    // The exact packaged identity is required BEFORE any module load or context publication.
    if (identity?.bundleIdentifier !== RHYTHM_BUNDLE_IDENTIFIER) return false;
    // The own root hosts `agent.sock`: a sockaddr_un path is ~104 bytes, so keep a short physical root.
    if (Buffer.byteLength(`${dataRoot}/agent.sock`) > MAX_SOCKET_PATH_BYTES) return false;
    try { return Boolean(exists(nativeModule().resolvePackagedLayout(nativeRoot).addonPath)); } catch { return false; }
  };

  // ---- context (install + helper) is split from original service startup ----
  const ensureContext = () => {
    if (services === 'context' || services === 'started') return true;
    if (services === 'failed' || disposed || !available()) return false;
    try {
      const mod = nativeModule();
      const host = getWrapper();
      host.install(mod.createInstallConfiguration({ nativeRoot, dataRoot, ...identity }));
      services = 'context';
      try { host.configureHelper(mod.resolveHelperPath(appBundlePath)); } catch (error) { log(`native Dayflow helper not configured: ${/** @type {{ code?: unknown } | null | undefined} */ (error)?.code ?? 'error'}`); }
      return true;
    } catch (error) {
      services = 'failed';
      log(`native Dayflow unavailable: ${/** @type {{ code?: unknown } | null | undefined} */ (error)?.code ?? 'error'}`);
      return false;
    }
  };
  // Original services (recorder, analysis, network) start ONLY for a qualified tap or an admitted attach.
  const ensureServices = () => {
    if (services === 'started') return true;
    if (!ensureContext()) return false;
    try {
      if (wrapper.startServices() !== true) throw new Error('services did not start');
      services = 'started';
      try { wrapper.setLaunchAtLoginState(loginItem.get() === true); } catch { /* mirror only, never an OS write */ }
      ensurePump();
      return true;
    } catch (error) {
      services = 'failed';
      log(`native Dayflow unavailable: ${/** @type {{ code?: unknown } | null | undefined} */ (error)?.code ?? 'error'}`);
      return false;
    }
  };

  // ---- fixed host events: bounded, main-only, never renderer-visible ----
  const showDayflow = () => {
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    if (window.webContents.getURL() !== DAYFLOW_ROUTE) void window.loadURL(DAYFLOW_ROUTE);
  };
  const handlers = {
    checkForUpdates: () => openDownloadPage(),
    launchAtLoginEnable: () => setLoginItem(true),
    launchAtLoginDisable: () => setLoginItem(false),
    // Rhythm's Dock presence is Rhythm's: Dayflow never hides it, and no success is persisted.
    dockIconShow: () => {},
    dockIconHide: () => {},
    showHostWindow: showDayflow,
    quitAndReopenRequested: () => showQuitReopenInstruction(),
  };
  /** @param {boolean} enabled */
  const setLoginItem = (enabled) => {
    loginItem.set(enabled);
    wrapper.setLaunchAtLoginState(loginItem.get() === true); // report what the OS actually says
  };
  // One bounded in-flight batch: fixed effects run in order, each guarded by disposal/generation.
  /** @param {number} generation */
  const drain = async (generation) => {
    /** @type {(keyof typeof handlers)[]} */ let events;
    try { events = wrapper.drainHostEvents(MAX_EVENTS_PER_TICK); } catch { return; }
    for (const name of events) {
      if (disposed || generation !== pumpGeneration) return;
      try { await handlers[name]?.(); } catch { /* one bad action never stops the pump */ }
    }
  };
  // The single pump. It polls only this host's own state and the router's finite candidate state (never a
  // notification-center delegate). Before the owned window is ready it can neither install nor start.
  const tick = async () => {
    if (disposed || ticking) return;
    ticking = true;
    const generation = pumpGeneration;
    try {
      const window = getWindow();
      if (notificationsStarted && (services === 'idle' || services === 'context') && window && !window.isDestroyed() && readyWindow === window) {
        let state = wrapper.notificationCandidateState();
        if (state === 1 && ensureContext()) state = wrapper.notificationCandidateState();
        if (state === 2 && !disposed && generation === pumpGeneration) ensureServices();
      }
      if (services === 'started' && !disposed && generation === pumpGeneration) await drain(generation);
    } catch { /* state polling only; the next tick re-evaluates */ } finally { ticking = false; }
  };
  function ensurePump() {
    if (pump === undefined && !disposed) pump = scheduler.set(() => tick(), PUMP_MS);
  }

  // ---- ownership: own window + own webContents + MAIN frame + exact route + lease + epoch ----
  /** @param {Attachment} record */
  const routeLive = (record) => {
    const { window, webContents, mainFrame } = record;
    return !window.isDestroyed() && !webContents.isDestroyed() && getWindow() === window
      && webContents.mainFrame === mainFrame && ROUTE_PATTERN.test(webContents.getURL());
  };
  /** @param {Electron.IpcMainInvokeEvent} event */
  const ownsEvent = (event) => {
    const window = getWindow();
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return false;
    const { webContents } = window;
    return event?.sender === webContents && event.senderFrame === webContents.mainFrame
      && ROUTE_PATTERN.test(event.senderFrame.url ?? '') && isTrustedSender(event) === true;
  };
  /** @param {Electron.IpcMainInvokeEvent} event @param {Record<string, unknown>} value @param {string[]} keys */
  const ownsLease = (event, value, keys) => {
    const record = active;
    return Boolean(record && ownsEvent(event) && exactObject(value, ['attachment', ...keys]) && value.attachment === record.lease
      && record.epoch === epoch && routeLive(record) && event.sender === record.webContents && event.senderFrame === record.mainFrame);
  };

  // ---- lifecycle: main state dominates anything the renderer says ----
  const applyLifecycle = () => {
    const record = active;
    if (!record || record.epoch !== epoch || !wrapper) return;
    let shouldShow = false;
    try {
      const { window } = record;
      const live = routeLive(record);
      shouldShow = live && record.measured && !record.rendererBlocked && modals === 0 && window.isVisible() && !window.isMinimized();
      wrapper.setLifecycle({
        activeTool: live && record.measured,
        modalVisible: record.rendererBlocked || modals > 0,
        windowVisible: window.isVisible(),
        minimized: window.isMinimized(),
        hostCrashed: false,
      });
    } catch { shouldShow = false; }
    if (record.shown && !shouldShow) restoreWebFocus(record);
    record.shown = shouldShow;
  };
  /** @param {Attachment} record */
  const restoreWebFocus = (record) => {
    try {
      if (!record.webContents.isDestroyed() && !record.window.isDestroyed() && record.window.isVisible() && !record.window.isMinimized()) record.webContents.focus();
    } catch { /* focus is best effort */ }
  };

  // Immediately mark the captured view inactive/blocked (before any deferred detach) so a departed
  // route/window can never leave a visible clip; an old lease can no longer reveal it.
  /** @param {Attachment} record */
  const hideNow = (record) => {
    try {
      wrapper?.setLifecycle({ activeTool: false, modalVisible: true, windowVisible: record.window.isDestroyed() ? false : record.window.isVisible(), minimized: record.window.isDestroyed() ? false : record.window.isMinimized(), hostCrashed: false });
    } catch { /* detach below still runs */ }
  };
  const clearActive = () => {
    const record = active;
    epoch += 1;
    active = undefined;
    return record;
  };
  /** @param {Attachment} record */
  const cleanup = (record) => {
    try { wrapper?.detach(); } catch { /* the view is already unreachable to the renderer */ }
    restoreWebFocus(record);
  };
  /** Synchronous revocation; native cleanup is serialized behind any in-flight attach. Safe to repeat. */
  const revoke = () => {
    const record = clearActive();
    if (record) hideNow(record);
    if (record) transition = transition.then(() => cleanup(record)).catch(() => {});
    return transition;
  };

  /** @param {Electron.BrowserWindow | undefined} window */
  const bindWindow = (window) => {
    if (disposed || !window || bound.has(window)) return;
    bound.add(window);
    if (active && active.window !== window) void revoke();
    const { webContents } = window;
    const departs = (/** @type {string} */ url) => { if (!ROUTE_PATTERN.test(String(url))) void revoke(); };
    // Reload/navigation of the same route is a NEW document: the old lease never survives it.
    webContents.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
      if (isMainFrame === false) return;
      if (isInPlace) departs(url); else void revoke();
    });
    webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => { if (isMainFrame !== false) departs(url); });
    webContents.on('render-process-gone', () => { void revoke(); });
    webContents.on('destroyed', () => { void revoke(); });
    for (const name of ['show', 'hide', 'minimize', 'restore']) (/** @type {NodeJS.EventEmitter} */ (window)).on(name, applyLifecycle);
    window.on('closed', () => { void revoke(); });
  };

  // ---- IPC (zero renderer authority beyond intent) ----
  /** @param {Electron.IpcMainInvokeEvent} event @param {unknown[]} args */
  const attach = async (event, args) => {
    if (args.length !== 0 || !ownsEvent(event)) return { ok: false, reason: 'denied' };
    const window = /** @type {Electron.BrowserWindow} */ (getWindow());
    const current = active;
    // A newer call on the same live document reuses the active record (a stale earlier result is dropped by preload).
    if (current && current.epoch === epoch && routeLive(current) && current.webContents === window.webContents && current.mainFrame === window.webContents.mainFrame) return { ok: true, lease: current.lease };
    const record = { window, webContents: window.webContents, mainFrame: window.webContents.mainFrame, lease: newLease(), epoch: 0, measured: false, rendererBlocked: true, shown: false };
    const previous = clearActive(); // a re-attach is a new record; never revives old layout/focus
    if (previous) { hideNow(previous); cleanup(previous); }
    record.epoch = ++epoch;
    const stale = () => disposed || epoch !== record.epoch || !routeLive(record);
    try {
      await Promise.resolve();
      if (stale()) return { ok: false, reason: 'detached' };
      if (!ensureServices()) return { ok: false, reason: 'unavailable' };
      await Promise.resolve();
      if (stale()) return { ok: false, reason: 'detached' };
      // Native starts hidden at a tiny placeholder until a real measurement and a positive lifecycle.
      const attached = getWrapper().attach(window.getNativeWindowHandle(), { x: 0, y: 0, width: 1, height: 1, zoom: 1 });
      if (!attached || attached.attached === false) return { ok: false, reason: 'unavailable' };
      active = record; // published first so a stale result is torn down through the one revoke path
      if (stale()) { void revoke(); return { ok: false, reason: 'detached' }; }
      return { ok: true, lease: record.lease };
    } catch {
      try { wrapper?.detach(); } catch { /* nothing attached */ }
      if (epoch === record.epoch) active = undefined;
      return { ok: false, reason: 'unavailable' };
    }
  };

  /** @param {Electron.IpcMainInvokeEvent} event @param {Record<string, unknown>} value */
  const setBounds = (event, value) => {
    if (!ownsLease(event, value, ['bounds'])) return false;
    const record = /** @type {NonNullable<typeof active>} */ (active);
    try {
      const bounds = parseBounds(value.bounds);
      const zoom = record.webContents.getZoomFactor();
      const area = record.window.getContentBounds();
      if (!bounds || !Number.isFinite(zoom) || zoom < 0.5 || zoom > 3 || !(area.width > 0) || !(area.height > 0)) return hide(record);
      const cssWidth = area.width / zoom;
      const cssHeight = area.height / zoom;
      const x = Math.min(cssWidth, Math.max(0, bounds.x));
      const y = Math.min(cssHeight, Math.max(0, bounds.y));
      const width = Math.min(cssWidth, bounds.x + bounds.width) - x;
      const height = Math.min(cssHeight, bounds.y + bounds.height) - y;
      if (!(width > 0) || !(height > 0)) return hide(record); // never zero native bounds: hide instead
      if (wrapper.setBounds({ x, y, width, height, zoom }) !== true) return hide(record);
      record.measured = true;
      applyLifecycle();
      return true;
    } catch { return hide(record); }
  };
  /** @param {Attachment} record */
  const hide = (record) => {
    record.measured = false;
    applyLifecycle();
    return false;
  };

  /** @param {string} channel @param {Parameters<Electron.IpcMain['handle']>[1]} listener */
  const handle = (channel, listener) => ipcMain.handle(channel, listener);
  handle('dayflow:view:status', (event, ...args) => (args.length === 0 && ownsEvent(event) && available() ? { state: 'ready' } : { ...UNAVAILABLE }));
  handle('dayflow:view:attach', (event, ...args) => {
    const next = transition.then(() => attach(event, args)).catch(() => ({ ok: false, reason: 'unavailable' }));
    transition = next.then(() => {}, () => {});
    return next;
  });
  handle('dayflow:view:bounds', (event, value, ...extra) => extra.length === 0 && setBounds(event, value));
  handle('dayflow:view:blocked', (event, value, ...extra) => {
    if (extra.length || !ownsLease(event, value, ['blocked']) || typeof value.blocked !== 'boolean') return false;
    /** @type {NonNullable<typeof active>} */ (active).rendererBlocked = value.blocked;
    applyLifecycle();
    return true;
  });
  handle('dayflow:view:detach', (event, value, ...extra) => {
    if (extra.length || !ownsLease(event, value, [])) return false;
    void revoke();
    return true;
  });
  handle('dayflow:view:return-focus', (event, value, ...extra) => {
    if (extra.length || !ownsLease(event, value, [])) return false;
    try { return active?.shown === true && wrapper.returnFocus() === true; } catch { return false; }
  });

  const disposeCurrent = () => revoke();

  return {
    /** Early registration (app `will-finish-launching`): bridge only, no context, storage or services. */
    startNotifications() {
      if (notificationsStarted || disposed || !available()) return false;
      notificationsStarted = true;
      try {
        const registered = getWrapper().startNotificationBridge() !== false;
        if (registered) ensurePump(); // the same single pump; it cannot install before the window is ready
        return registered;
      } catch (error) { log(`native Dayflow notification bridge unavailable: ${/** @type {{ code?: unknown } | null | undefined} */ (error)?.code ?? 'error'}`); return false; }
    },
    /** The main window finished loading: a qualified cold-start tap may now bring services up on the next tick. */
    windowReady() {
      if (!disposed) readyWindow = getWindow();
    },
    bindWindow,
    /** Wrap an existing main-process dialog so its native view is hidden while it is up. */
    /** @template T @param {() => T} run @returns {T} */
    runModal(run) {
      const begin = () => { modals += 1; applyLifecycle(); };
      const end = () => { modals = Math.max(0, modals - 1); applyLifecycle(); };
      begin();
      try {
        const result = run();
        if (result && typeof (/** @type {{ then?: unknown }} */ (result)).then === 'function') return /** @type {T} */ ((/** @type {Promise<unknown>} */ (/** @type {unknown} */ (result))).finally(end));
        end();
        return result;
      } catch (error) { end(); throw error; }
    },
    disposeCurrent,
    async dispose() {
      if (disposed) return;
      disposed = true;
      pumpGeneration += 1;
      if (pump !== undefined) { const handle = pump; pump = undefined; scheduler.clear(handle); }
      for (const channel of CHANNELS) { try { ipcMain.removeHandler(channel); } catch { /* removal is best effort */ } }
      try { await revoke(); } catch { /* cleanup below still runs */ }
      // Independent guards: a throwing service stop must not skip the delegate cleanup.
      if (wrapper) {
        try { wrapper.stopServices(); } catch { /* stop once, never throw into quit */ }
        if (notificationsStarted) { try { wrapper.stopNotificationBridge(); } catch { /* conditional clear is native */ } }
      }
      services = 'failed';
    },
  };
}
