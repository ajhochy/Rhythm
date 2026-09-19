import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { hermesReadyOrigin, parseHermesBounds, parseHermesIntent } from './hermes-protocol.mjs';
import { loadHermesTheme } from './hermes-theme.mjs';

/** @typedef {{getStatus: () => unknown | Promise<unknown>, getSessionToken: () => string | undefined, onStatus?: (callback: (status: unknown) => void) => (() => void)}} Supervisor */
/** @type {Supervisor | undefined} */
let boundSupervisor;
/** @type {Set<() => void>} */
const supervisorChanges = new Set();
/** @type {(() => void) | undefined} */
let unsubscribeSupervisor;

/** Native-only integration seam for B2. Bind the supervisor instance, never a
 * renderer-supplied status. Absent binding fails closed without starting Hermes.
 * @param {Supervisor} supervisor
 */
export function bindHermesViewSupervisor(supervisor) {
  unsubscribeSupervisor?.();
  boundSupervisor = supervisor;
  for (const changed of supervisorChanges) changed();
  unsubscribeSupervisor = supervisor.onStatus?.(() => {
    for (const changed of supervisorChanges) changed();
  });
}

/** @param {{ipcMain: Electron.IpcMain, getWindow: () => Electron.BrowserWindow | undefined,
 * getStatus?: () => unknown | Promise<unknown>, getSessionToken?: () => string | undefined,
 * electron?: Pick<typeof import('electron'), 'WebContentsView' | 'MessageChannelMain'>,
 * enabled?: () => boolean, themeCss?: string}} options
 */
export function registerHermesView(options) {
  const { ipcMain, getWindow } = options;
  const enabled = options.enabled ?? (() => !['0', 'false'].includes((process.env.RHYTHM_HERMES_ENABLED ?? '').toLowerCase()));
  const getStatus = options.getStatus ?? (() => boundSupervisor?.getStatus());
  const getSessionToken = options.getSessionToken ?? (() => boundSupervisor?.getSessionToken());
  const currentDashboard = async () => {
    try {
      if (!enabled()) return null;
      const origin = hermesReadyOrigin(await getStatus());
      const sessionToken = getSessionToken();
      return origin && typeof sessionToken === 'string' && /^[A-Za-z0-9_-]{20,128}$/.test(sessionToken)
        ? { origin, sessionToken }
        : null;
    }
    catch { return null; }
  };
  /** @param {string} url @param {string} origin */
  const sameOrigin = (url, origin) => {
    try { return new URL(url).origin === origin; } catch { return false; }
  };
  const channels = ['hermes:view:attach', 'hermes:view:bounds', 'hermes:view:detach', 'hermes:intent'];
  /** @type {{view: Electron.WebContentsView, win: Electron.BrowserWindow, attachment: string,
   * origin: string, sessionToken: string, frame: Electron.WebFrameMain, generation?: string,
   * port?: Electron.MessagePortMain, ready: boolean, cleanups: (() => void)[]} | undefined} */
  let active;
  /** @type {(() => void) | undefined} */
  let pendingHostCleanup;
  let requestEpoch = 0;
  let disposed = false;

  /** @param {Electron.IpcMainInvokeEvent | Electron.IpcMainEvent} event */
  const ownsHost = (event) => {
    const win = getWindow();
    return Boolean(win && !win.isDestroyed() && !win.webContents.isDestroyed()
      && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame
      && /^rhythm:\/\/app\/index\.html#\/hermes(?:\?.*)?$/.test(event.senderFrame?.url ?? ''));
  };
  /** @param {NonNullable<typeof active>} record */
  const revoke = (record) => {
    record.ready = false;
    record.generation = undefined;
    const port = record.port;
    record.port = undefined;
    port?.close();
  };
  const detach = () => {
    requestEpoch += 1;
    pendingHostCleanup?.();
    pendingHostCleanup = undefined;
    const record = active;
    active = undefined;
    if (!record) return;
    revoke(record);
    for (const cleanup of record.cleanups) cleanup();
    if (!record.win.isDestroyed()) record.win.contentView.removeChildView(record.view);
    if (!record.view.webContents.isDestroyed()) record.view.webContents.close({ waitForBeforeUnload: false });
  };
  /** @param {Electron.IpcMainInvokeEvent} event @param {unknown} value */
  const ownsAttachment = (event, value) => {
    if (!ownsHost(event) || !active || !value || typeof value !== 'object') return false;
    return active.frame === event.senderFrame
      && active.attachment === /** @type {{attachment?: unknown}} */ (value).attachment;
  };
  const checkStatus = async () => {
    const record = active;
    if (!record) return;
    const dashboard = await currentDashboard();
    if (active === record && (dashboard?.origin !== record.origin || dashboard.sessionToken !== record.sessionToken)) detach();
  };
  const supervisorChanged = () => {
    if (!active) { detach(); return; }
    requestEpoch += 1;
    void checkStatus();
  };
  supervisorChanges.add(supervisorChanged);

  ipcMain.handle('hermes:view:attach', async (event, ...args) => {
    if (disposed || !enabled() || !ownsHost(event) || args.length) return { ok: false, reason: 'unavailable' };
    detach();
    const epoch = requestEpoch;
    const win = getWindow();
    if (!win) return { ok: false, reason: 'unavailable' };
    // Bind the parent document before either async boundary. Reloading the
    // parent while readiness is pending must not attach to its next document.
    const hostNavigation = (/** @type {Electron.Event} */ _event, /** @type {string} */ url, /** @type {boolean} */ inPlace, /** @type {boolean} */ isMainFrame) => {
      if (isMainFrame && (!inPlace || !/^rhythm:\/\/app\/index\.html#\/hermes(?:\?.*)?$/.test(url))) detach();
    };
    win.webContents.on('did-start-navigation', hostNavigation);
    win.once('closed', detach);
    pendingHostCleanup = () => {
      win.webContents.removeListener('did-start-navigation', hostNavigation);
      win.removeListener('closed', detach);
    };
    try {
      const dashboard = await currentDashboard();
      if (!dashboard || !enabled() || epoch !== requestEpoch || !ownsHost(event)) return { ok: false, reason: 'not-ready' };
      const { origin, sessionToken } = dashboard;
      // Lazy import keeps the controller unit-testable without launching Electron.
      const runtime = options.electron ?? await import('electron');
      if (disposed || !enabled() || epoch !== requestEpoch || !ownsHost(event)) return { ok: false, reason: 'unavailable' };
      if (!event.senderFrame) return { ok: false, reason: 'unavailable' };
      const partitionName = `rhythm-hermes-${randomUUID()}`;
      const view = new runtime.WebContentsView({ webPreferences: {
        preload: fileURLToPath(new URL('./hermes-view-preload.cjs', import.meta.url)),
        sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
        partition: partitionName,
      } });
      // The token never enters a Rhythm URL, IPC payload, preload, or injected script. The owned
      // dashboard child still injects its native loopback bootstrap into its own HTML because its
      // browser WebSocket path accepts only ?token=...; the unique memory partition bounds that
      // unavoidable page-held value to this attachment and is discarded on detach.
      const record = { view, win, attachment: randomUUID(), origin, sessionToken, frame: event.senderFrame,
        ready: false, cleanups: /** @type {(() => void)[]} */ ([]),
        generation: /** @type {string | undefined} */ (undefined), port: /** @type {Electron.MessagePortMain | undefined} */ (undefined) };
      active = record;
      if (pendingHostCleanup) record.cleanups.push(pendingHostCleanup);
      pendingHostCleanup = undefined;
      const contents = view.webContents;
      const partition = contents.session;
      partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      partition.setPermissionCheckHandler(() => false);
      const cancelDownload = (/** @type {Electron.Event} */ event) => event.preventDefault();
      partition.on('will-download', cancelDownload);
      record.cleanups.push(() => partition.removeListener('will-download', cancelDownload));
      // This partition belongs exclusively to this view. No remote resources,
      // sibling loopback services, file URLs, or browser permission grants.
      partition.webRequest.onBeforeRequest((details, callback) => {
        let allowed = false;
        try {
          const target = new URL(details.url);
          allowed = active === record && (target.origin === origin
            || (target.protocol === 'ws:' && `http://${target.host}` === origin));
        } catch { /* fail closed */ }
        callback({ cancel: !allowed });
      });
      partition.webRequest.onBeforeSendHeaders({ urls: [`${origin}/*`] }, (details, callback) => {
        const requestHeaders = Object.fromEntries(Object.entries(details.requestHeaders)
          .filter(([name]) => name.toLowerCase() !== 'authorization'));
        callback({ requestHeaders: { ...requestHeaders, Authorization: `Bearer ${sessionToken}` } });
      });
      record.cleanups.push(() => {
        partition.webRequest.onBeforeRequest(null);
        partition.webRequest.onBeforeSendHeaders(null);
        partition.setPermissionRequestHandler(null);
        partition.setPermissionCheckHandler(null);
        void partition.clearStorageData().catch(() => undefined);
        void partition.clearCache().catch(() => undefined);
        void partition.closeAllConnections().catch(() => undefined);
      });
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
      /** @param {string} name @param {(...args: any[]) => void} listener */
      const listen = (name, listener) => {
        contents.on(/** @type {any} */ (name), listener);
        record.cleanups.push(() => contents.removeListener(/** @type {any} */ (name), listener));
      };
      listen('will-navigate', (navigation, url) => {
        if (!sameOrigin(url, origin)) navigation.preventDefault();
      });
      listen('will-redirect', (navigation, url) => {
        if (!sameOrigin(url, origin)) navigation.preventDefault();
      });
      listen('will-frame-navigate', (navigation) => {
        if (!navigation.isMainFrame || !sameOrigin(navigation.url, origin)) navigation.preventDefault();
      });
      listen('will-attach-webview', (navigation) => navigation.preventDefault());
      listen('did-start-navigation', (_navigation, _url, _inPlace, isMainFrame) => {
        if (isMainFrame) revoke(record);
      });
      listen('render-process-gone', () => { if (active === record) detach(); });
      const bindDocument = () => {
        if (active !== record || !enabled() || !sameOrigin(contents.getURL(), origin)) return;
        revoke(record);
        const { port1, port2 } = new runtime.MessageChannelMain();
        record.generation = randomUUID();
        record.port = port2;
        // The port is unidirectional in this dashboard version. Page messages
        // never trigger native actions; identity is established by the IPC below.
        port2.start();
        port2.on('close', () => { if (record.port === port2) revoke(record); });
        contents.postMessage('hermes:port', record.generation, [port1]);
      };
      listen('dom-ready', () => {
        bindDocument();
        if (active !== record || !enabled() || !sameOrigin(contents.getURL(), origin)) return;
        void contents.insertCSS(options.themeCss ?? loadHermesTheme(), { cssOrigin: 'user' }).catch(() => undefined);
      });
      listen('did-navigate-in-page', (_navigation, _url, isMainFrame) => { if (isMainFrame) bindDocument(); });
      view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      win.contentView.addChildView(view);
      try {
        await contents.loadURL(`${origin}/`);
        if (active !== record) return { ok: false, reason: 'detached' };
        return { ok: true, attachment: record.attachment };
      } catch {
        if (active === record) detach();
        return { ok: false, reason: 'load-failed' };
      }
    } finally {
      if (!active && epoch === requestEpoch) detach();
    }
  });

  const documentReady = (/** @type {Electron.IpcMainEvent} */ event, /** @type {unknown} */ generation) => {
    const record = active;
    if (!record || !enabled() || !record.port || event.sender !== record.view.webContents
      || event.senderFrame !== record.view.webContents.mainFrame || generation !== record.generation) return;
    if (sameOrigin(event.senderFrame.url, record.origin)) record.ready = true;
  };
  ipcMain.on('hermes:view:document-ready', documentReady);

  ipcMain.handle('hermes:view:bounds', (event, value) => {
    if (!ownsAttachment(event, value) || !active || !enabled()) return false;
    const bounds = parseHermesBounds(value.bounds);
    if (!bounds) return false;
    const zoom = active.win.webContents.getZoomFactor();
    if (!Number.isFinite(zoom) || zoom <= 0) return false;
    const area = active.win.getContentBounds();
    const x = Math.min(area.width, Math.max(0, Math.round(bounds.x * zoom)));
    const y = Math.min(area.height, Math.max(0, Math.round(bounds.y * zoom)));
    const right = Math.min(area.width, Math.max(x, Math.round((bounds.x + bounds.width) * zoom)));
    const bottom = Math.min(area.height, Math.max(y, Math.round((bounds.y + bounds.height) * zoom)));
    active.view.webContents.setZoomFactor(zoom);
    active.view.setBounds({ x, y, width: right - x, height: bottom - y });
    return true;
  });
  ipcMain.handle('hermes:view:detach', (event, value) => {
    if (!ownsAttachment(event, value)) return false;
    detach();
    return true;
  });
  ipcMain.handle('hermes:intent', async (event, value) => {
    if (!ownsAttachment(event, value) || !active || !active.ready || !enabled()) return { ok: false, reason: 'unavailable' };
    const intent = parseHermesIntent(value.intent);
    if (!intent) return { ok: false, reason: 'invalid-intent' };
    const record = active;
    const generation = record.generation;
    await checkStatus();
    if (active !== record || !record.ready || generation !== record.generation || !ownsAttachment(event, value)) return { ok: false, reason: 'unavailable' };
    if (intent.type === 'new-chat') {
      record.port?.postMessage(intent);
      return { ok: true };
    }
    revoke(record);
    try {
      await record.view.webContents.loadURL(`${record.origin}/chat?resume=${encodeURIComponent(intent.sessionId)}`);
      return { ok: active === record };
    } catch { return { ok: false, reason: 'load-failed' }; }
  });
  return () => {
    disposed = true;
    detach();
    supervisorChanges.delete(supervisorChanged);
    ipcMain.removeListener('hermes:view:document-ready', documentReady);
    for (const channel of channels) ipcMain.removeHandler(channel);
  };
}
