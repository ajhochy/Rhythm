// @ts-nocheck -- Electron's view/session event overloads are injected and covered
// by the focused native-view contract fixture.
import { randomUUID } from 'node:crypto';
import { parseHermesBounds } from './hermes-protocol.mjs';
import { discoverOpenDesignRuntime, sameOpenDesignRuntime } from './open-design-runtime.mjs';

const CHANNELS = ['open-design:view:attach', 'open-design:view:bounds', 'open-design:view:detach', 'open-design:status'];
export const OPEN_DESIGN_UNAVAILABLE = 'OpenDesign isn’t running. Open the OpenDesign app, then select Retry.';
const ZERO = Object.freeze({ x: 0, y: 0, width: 0, height: 0 });

function safeUnavailable() { return { state: 'unavailable', code: 'unavailable' }; }
function failure() { return { ok: false, reason: OPEN_DESIGN_UNAVAILABLE }; }
const attempt = (fn) => { try { fn(); } catch { /* native teardown is best effort; continue */ } };

/** @param {unknown} value */
function isStatus(value) { return Boolean(value && typeof value === 'object' && value.state === 'ready' && typeof value.origin === 'string'); }

const normalizedOrigin = (url, protocol) => {
  try { const value = new URL(url); return value.protocol === protocol ? value.origin : null; } catch { return null; }
};

/**
 * Navigation (main frame, subframe, and same-origin HTTP redirects) is plain
 * HTTP on the verified origin only. Both sides are WHATWG-normalised origins,
 * so `:80` and an elided default port compare equal.
 */
export function isOpenDesignNavigationUrl(url, origin) {
  return normalizedOrigin(url, 'http:') === origin;
}

/** Network requests additionally permit `ws:` to the same normalised host:port; nothing else. */
export function isOpenDesignRequestUrl(url, origin) {
  return isOpenDesignNavigationUrl(url, origin) || normalizedOrigin(url, 'ws:') === `ws:${origin.slice('http:'.length)}`;
}

/**
 * @param {any} options `isTrustedSender(event)` is an optional builder check
 * (signed-in, unblocked document) applied in addition to the exact frame/route check.
 */
export function registerOpenDesignView(options) {
  const { ipcMain, getWindow } = options;
  const discoverRuntime = options.discoverRuntime ?? discoverOpenDesignRuntime;
  const alias = options.toolAliasRoute === '/tools/open-design' ? '/tools/open-design' : null;
  const routePattern = new RegExp(`^rhythm://app/index\\.html#(?:/open-design${alias ? `|${alias}` : ''})(?:\\?.*)?$`);
  let active = null;
  let disposed = false;
  let epoch = 0;
  let transition = Promise.resolve();

  const trusted = (event) => {
    if (typeof options.isTrustedSender !== 'function') return true;
    try { return options.isTrustedSender(event) === true; } catch { return false; }
  };
  const ownsHost = (event) => {
    const win = getWindow();
    return Boolean(win && !win.isDestroyed() && !win.webContents.isDestroyed?.() && event?.sender === win.webContents
      && event?.senderFrame === win.webContents.mainFrame && routePattern.test(event.senderFrame?.url ?? '') && trusted(event));
  };
  const ownsAttachment = (event, value) => Boolean(active && ownsHost(event) && active.frame === event.senderFrame
    && value && typeof value === 'object' && value.attachment === active.attachment);
  const suspend = (record) => {
    record.suspended = true;
    attempt(() => record.view.setBounds(ZERO));
    attempt(() => record.win.webContents.focus());
    return true;
  };
  const runCleanups = (list) => { for (const cleanup of list.splice(0)) attempt(cleanup); };
  // Conceal, detach, and drop host listeners immediately. Guest request,
  // permission, and navigation guards are removed only once the guest is
  // actually destroyed — a guest that survives a failed close keeps every
  // denial until its own `destroyed` event. Each cleanup runs independently.
  const disposeRecord = async (record) => {
    if (!record) return;
    record.closed.resolve();
    const contents = record.view?.webContents;
    try {
      attempt(() => record.view?.setBounds(ZERO));
      attempt(() => { if (record.view && !record.win.isDestroyed()) record.win.contentView.removeChildView(record.view); });
      runCleanups(record.hostCleanups);
      attempt(() => { if (contents && !contents.isDestroyed()) contents.close({ waitForBeforeUnload: false }); });
      await Promise.resolve().then(() => record.partition?.clearStorageData?.()).catch(() => undefined);
    } finally {
      runCleanups(record.hostCleanups);
      let gone = !contents;
      try { gone = gone || contents.isDestroyed(); } catch { /* treat as alive */ }
      if (gone) runCleanups(record.guestCleanups);
      else attempt(() => contents.once('destroyed', () => runCleanups(record.guestCleanups)));
    }
  };
  const release = async () => {
    const record = active;
    active = null;
    await disposeRecord(record);
  };
  /** Document revocation / profile reset: drop the view, keep IPC handlers for a later attach. */
  const disposeCurrent = async () => {
    epoch += 1;
    await release();
    await transition;
  };
  const status = async (event, ...args) => {
    if (disposed || args.length || !ownsHost(event)) return safeUnavailable();
    try { return isStatus(await discoverRuntime()) ? { state: 'ready' } : safeUnavailable(); } catch { return safeUnavailable(); }
  };

  /** Builds and wires one guest. Any native exception closes the partial guest and fails safely. */
  const createRecord = async (electron, win, event, runtime) => {
    let closed;
    const record = { view: null, win, partition: null, runtime, attachment: randomUUID(), frame: event.senderFrame, suspended: false, hostCleanups: [], guestCleanups: [], closed: null };
    record.closed = { promise: new Promise((resolve) => { closed = resolve; }), resolve: () => closed() };
    try {
      const view = new electron.WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false, webSecurity: true, webviewTag: false, partition: `open-design-${randomUUID()}` } });
      record.view = view;
      const contents = view.webContents;
      const partition = contents.session;
      record.partition = partition;
      const listen = (target, name, listener) => {
        target.on(name, listener);
        (target === win.webContents ? record.hostCleanups : record.guestCleanups).push(() => target.removeListener(name, listener));
      };
      // Every callback is bound to this record; a stale guest or host event cannot revoke a newer view.
      const revoke = () => { if (active === record) void disposeCurrent().catch(() => undefined); };
      record.guestCleanups.push(
        () => partition.webRequest.onBeforeRequest(null),
        () => partition.setPermissionRequestHandler(null),
        () => partition.setPermissionCheckHandler(null),
      );
      partition.webRequest.onBeforeRequest((details, callback) => callback({
        cancel: details?.webContentsId !== contents.id || !isOpenDesignRequestUrl(details.url, record.runtime.origin),
      }));
      partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      partition.setPermissionCheckHandler(() => false);
      listen(partition, 'will-download', (download) => download.preventDefault());
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
      const denyForeignNavigation = (navigation, url) => {
        if (!isOpenDesignNavigationUrl(typeof navigation?.url === 'string' ? navigation.url : url ?? '', record.runtime.origin)) navigation.preventDefault();
      };
      listen(contents, 'will-attach-webview', (navigation) => navigation.preventDefault());
      listen(contents, 'will-navigate', denyForeignNavigation);
      listen(contents, 'will-redirect', denyForeignNavigation);
      listen(contents, 'will-frame-navigate', denyForeignNavigation);
      listen(contents, 'render-process-gone', revoke);
      listen(win.webContents, 'did-start-navigation', (navigation, url, sameDocument, isMainFrame) => {
        const main = typeof navigation?.isMainFrame === 'boolean' ? navigation.isMainFrame : isMainFrame;
        const same = typeof navigation?.isSameDocument === 'boolean' ? navigation.isSameDocument : sameDocument;
        if (!main || active !== record) return;
        if (!same) { revoke(); return; }
        if (!routePattern.test(typeof navigation?.url === 'string' ? navigation.url : url ?? '')) suspend(record);
      });
      listen(win.webContents, 'render-process-gone', revoke);
      listen(win.webContents, 'destroyed', revoke);
      view.setBounds(ZERO);
      win.contentView.addChildView(view);
      return record;
    } catch {
      await disposeRecord(record);
      return null;
    }
  };

  const attach = async (event, args) => {
    if (disposed || args.length || !ownsHost(event)) return failure();
    const requestEpoch = ++epoch;
    const current = () => !disposed && requestEpoch === epoch && ownsHost(event);
    let runtime;
    try { runtime = await discoverRuntime(); } catch { runtime = safeUnavailable(); }
    if (!isStatus(runtime) || !current()) return failure();
    if (active) {
      if (active.frame === event.senderFrame && sameOpenDesignRuntime(active.runtime, runtime)) {
        active.suspended = false;
        return { ok: true, attachment: active.attachment };
      }
      // A different host document or a changed service identity never reuses the old guest.
      await release();
      if (!current()) return failure();
    }
    let electron;
    try { electron = options.electron ?? await import('electron'); } catch { return failure(); }
    const win = getWindow();
    if (!current()) return failure();
    const record = await createRecord(electron, win, event, runtime);
    if (!record) return failure();
    if (!current()) { await disposeRecord(record); return failure(); }
    active = record;
    // Race the load against revocation so a hung load on a disposed guest
    // cannot block the serialized attach queue (and therefore dispose).
    let loaded = false;
    try {
      await Promise.race([
        Promise.resolve().then(() => record.view.webContents.loadURL(`${runtime.origin}/`)).then(() => { loaded = true; }),
        record.closed.promise,
      ]);
    } catch { /* load failure */ }
    if (!loaded || active !== record || !current()) {
      if (active === record) await release();
      return failure();
    }
    return { ok: true, attachment: record.attachment };
  };

  ipcMain.handle('open-design:view:attach', (event, ...args) => {
    const next = transition.then(() => attach(event, args)).catch(() => failure());
    transition = next;
    return next;
  });
  ipcMain.handle('open-design:view:bounds', (event, value) => {
    if (!ownsAttachment(event, value)) return false;
    const bounds = parseHermesBounds(value.bounds);
    try {
      const zoom = active.win.webContents.getZoomFactor();
      if (!bounds || !Number.isFinite(zoom) || zoom <= 0) return false;
      const area = active.win.getContentBounds();
      const x = Math.min(area.width, Math.max(0, Math.round(bounds.x * zoom)));
      const y = Math.min(area.height, Math.max(0, Math.round(bounds.y * zoom)));
      const right = Math.min(area.width, Math.max(x, Math.round((bounds.x + bounds.width) * zoom)));
      const bottom = Math.min(area.height, Math.max(y, Math.round((bounds.y + bounds.height) * zoom)));
      active.view.webContents.setZoomFactor?.(zoom);
      active.view.setBounds({ x, y, width: right - x, height: bottom - y });
      active.suspended = false;
      return true;
    } catch { return false; }
  });
  ipcMain.handle('open-design:view:detach', (event, value) => ownsAttachment(event, value) && suspend(active));
  ipcMain.handle('open-design:status', status);
  return {
    disposeCurrent,
    /** App quit / full teardown: dispose the view; handlers are removed even if disposal throws. */
    async dispose() {
      disposed = true;
      try { await disposeCurrent(); } finally { for (const channel of CHANNELS) attempt(() => ipcMain.removeHandler(channel)); }
    },
  };
}
