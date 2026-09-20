import { randomUUID } from 'node:crypto';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PINNED_HERMES_DESKTOP_SOURCE_COMMIT } from './hermes-desktop-config.mjs';
import { parseHermesBounds, parseHermesIntent } from './hermes-protocol.mjs';
import { resolveHermesDesktopArtifact } from './hermes-desktop-artifact.mjs';

// Kept for the outer shell while Desktop service ownership moves to the host.
/** @param {unknown} _supervisor */
export function bindHermesViewSupervisor(_supervisor) {}

/** @param {string} root @param {string} candidate */
function pathWithin(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..');
}

/** @param {string | undefined} message */
function publicFailure(message) {
  if (typeof message !== 'string') return 'Hermes Desktop could not open. Rebuild the pinned Hermes Desktop artifact and retry.';
  if (/missing|unreadable|incompatible|integrity|pinned artifact/i.test(message)) return message;
  return 'Hermes Desktop could not open. Rebuild the pinned Hermes Desktop artifact and retry.';
}

/** @param {{ipcMain: Electron.IpcMain, getWindow: () => Electron.BrowserWindow | undefined,
 * electron?: Pick<typeof import('electron'), 'WebContentsView'>,
 * enabled?: () => boolean, getArtifactRoot?: () => string | undefined,
 * getUserDataPath?: () => string | undefined, expectedElectronMajor?: number,
 * resolveArtifact?: (options: {artifactRoot: string, expectedElectronMajor: number}) => Promise<any>,
 * importHost?: (path: string) => Promise<any>, openExternal?: (url: string) => Promise<void> | void}} options
 */
export function registerHermesView(options) {
  const { ipcMain, getWindow } = options;
  const enabled = options.enabled ?? (() => !['0', 'false'].includes((process.env.RHYTHM_HERMES_ENABLED ?? '').toLowerCase()));
  const expectedElectronMajor = options.expectedElectronMajor ?? 40;
  const getArtifactRoot = options.getArtifactRoot ?? (() => process.env.RHYTHM_HERMES_DESKTOP_ARTIFACT_DIR
    || (typeof process.resourcesPath === 'string' ? join(process.resourcesPath, 'hermes-desktop') : undefined));
  const resolveArtifact = options.resolveArtifact ?? resolveHermesDesktopArtifact;
  const importHost = options.importHost ?? ((path) => import(pathToFileURL(path).href));
  const getUserDataPath = options.getUserDataPath ?? (() => undefined);
  const channels = ['hermes:view:attach', 'hermes:view:bounds', 'hermes:view:detach', 'hermes:intent'];
  /** @type {{view: Electron.WebContentsView, win: Electron.BrowserWindow, attachment: string, frame: Electron.WebFrameMain, artifact: {root: string, rendererUrl: string}, host: {dispose: () => Promise<void>, handleIntent: (intent: import('./hermes-protocol.mjs').HermesIntent) => Promise<{ok: boolean, reason?: string}>}, cleanups: (() => void)[], guestSessions: Set<Electron.Session>} | undefined} */
  let active;
  /** @type {(() => void) | undefined} */
  let pendingHostCleanup;
  let requestEpoch = 0;
  let disposed = false;
  let disposal = Promise.resolve();
  /** @type {Promise<unknown>} */
  let attachmentTransition = Promise.resolve();
  /** @type {Electron.WebContentsView | undefined} */
  let pendingView;
  /** @type {{dispose?: () => Promise<void>} | undefined} */
  let pendingHost;

  /** @param {Electron.IpcMainInvokeEvent | Electron.IpcMainEvent} event */
  const ownsHost = (event) => {
    const win = getWindow();
    return Boolean(win && !win.isDestroyed() && !win.webContents.isDestroyed()
      && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame
      && /^rhythm:\/\/app\/index\.html#\/hermes(?:\?.*)?$/.test(event.senderFrame?.url ?? ''));
  };
  /** @param {Electron.WebContentsView | undefined} view @param {Electron.BrowserWindow | undefined} win */
  const closeOwnedView = (view, win) => {
    if (!view) return;
    // Terminate the renderer before any host handler or backend is removed.
    // Its partition guards deliberately stay installed until native disposal
    // completes, so a last renderer request cannot escape the allowlist.
    if (win && !win.isDestroyed()) win.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false });
  };
  /** @param {NonNullable<typeof active>} record */
  const disposeRecord = async (record) => {
    closeOwnedView(record.view, record.win);
    await record.host.dispose().catch(() => undefined);
    for (const cleanup of record.cleanups.splice(0)) cleanup();
    await Promise.all([...record.guestSessions].map((session) => session.clearStorageData().catch(() => undefined)));
  };
  const detach = async () => {
    requestEpoch += 1;
    pendingHostCleanup?.();
    pendingHostCleanup = undefined;
    const record = active;
    active = undefined;
    if (!record) { await disposal; return; }
    const current = disposal.then(() => disposeRecord(record));
    disposal = current.catch(() => undefined);
    await current;
  };
  /** @param {Electron.IpcMainInvokeEvent} event @param {unknown} value */
  const ownsAttachment = (event, value) => Boolean(ownsHost(event) && active && value && typeof value === 'object'
    && active.frame === event.senderFrame && active.attachment === /** @type {{attachment?: unknown}} */ (value).attachment);
  const disposeCurrent = async () => {
    await detach();
    await attachmentTransition;
  };

  /** @param {Electron.IpcMainInvokeEvent} event @param {unknown[]} args */
  const attach = async (event, ...args) => {
    if (disposed || !enabled() || !ownsHost(event) || args.length) return { ok: false, reason: 'Hermes Desktop is unavailable in this Rhythm session.' };
    if (active && active.frame === event.senderFrame) return { ok: true, attachment: active.attachment };
    await detach();
    const epoch = requestEpoch;
    const win = getWindow();
    const artifactRoot = getArtifactRoot();
    const userDataPath = getUserDataPath();
    if (!win || !artifactRoot || !userDataPath) return { ok: false, reason: 'Hermes Desktop artifact is unavailable. Rebuild the Rhythm package or set RHYTHM_HERMES_DESKTOP_ARTIFACT_DIR for development.' };
    const hostNavigation = (/** @type {Electron.Event & {url?: unknown, isSameDocument?: unknown, isMainFrame?: unknown}} */ details, /** @type {string | undefined} */ legacyUrl, /** @type {boolean | undefined} */ legacyInPlace, /** @type {boolean | undefined} */ legacyIsMainFrame) => {
      // Tab switches only mutate the hash. Keep drafts/streams until this
      // document is actually revoked or the owning window closes.
      const url = typeof details?.url === 'string' ? details.url : legacyUrl;
      const inPlace = typeof details?.isSameDocument === 'boolean' ? details.isSameDocument : legacyInPlace;
      const isMainFrame = typeof details?.isMainFrame === 'boolean' ? details.isMainFrame : legacyIsMainFrame;
      if (!isMainFrame) return;
      if (!inPlace) { void disposeCurrent(); return; }
      if (!/^rhythm:\/\/app\/index\.html#\/hermes(?:\?.*)?$/.test(url ?? '') && active) active.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    };
    const windowClosed = () => { void disposeCurrent(); };
    win.webContents.on('did-start-navigation', hostNavigation);
    win.once('closed', windowClosed);
    pendingHostCleanup = () => {
      win.webContents.removeListener('did-start-navigation', hostNavigation);
      win.removeListener('closed', windowClosed);
    };
    try {
      const artifact = await resolveArtifact({
        artifactRoot,
        expectedElectronMajor,
        expectedSourceCommit: PINNED_HERMES_DESKTOP_SOURCE_COMMIT,
        // Dirty artifacts are an explicit developer-only local proof. Packaged
        // resources never take this branch because they do not use the dev path.
        allowDirty: Boolean(process.env.RHYTHM_HERMES_DESKTOP_ARTIFACT_DIR && process.env.RHYTHM_HERMES_DESKTOP_ALLOW_DIRTY_ARTIFACT === '1'),
      });
      if (disposed || !enabled() || epoch !== requestEpoch || !ownsHost(event)) return { ok: false, reason: 'Hermes Desktop attachment was revoked.' };
      const module = await importHost(artifact.hostPath);
      if (typeof module.createEmbeddedHermesHost !== 'function') return { ok: false, reason: 'Hermes Desktop artifact is incomplete. Rebuild the pinned artifact.' };
      const runtime = options.electron ?? await import('electron');
      if (disposed || !enabled() || epoch !== requestEpoch || !ownsHost(event) || !event.senderFrame) return { ok: false, reason: 'Hermes Desktop attachment was revoked.' };
      const view = new runtime.WebContentsView({ webPreferences: {
        preload: artifact.preloadPath,
        sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, webviewTag: true,
        // Keep the actual Desktop renderer's local state in Rhythm's own
        // user-data profile across view recreation and app relaunch. Preview
        // guests receive separate, host-scoped partitions below.
        partition: 'persist:rhythm-hermes-desktop',
      } });
      pendingView = view;
      const contents = view.webContents;
      const host = await module.createEmbeddedHermesHost({
        hostWindow: win, webContents: contents, assetRoot: artifact.root, userDataPath,
        ...(options.openExternal ? { openExternal: options.openExternal } : {}),
        log: (/** @type {string} */ message) => process.stdout?.write?.(`hermes-desktop: ${String(message)}\n`),
      });
      pendingHost = host;
      if (!host || typeof host.dispose !== 'function' || typeof host.handleIntent !== 'function'
        || typeof host.getAllowedOrigins !== 'function' || typeof host.onAllowedOrigins !== 'function'
        || typeof host.handlePermissionRequest !== 'function' || typeof host.handleWillAttachWebview !== 'function'
        || typeof host.handleGuestWindowOpen !== 'function' || typeof host.handleGuestNavigation !== 'function') {
        closeOwnedView(view, win);
        await host?.dispose?.().catch(() => undefined);
        pendingHost = undefined;
        pendingView = undefined;
        return { ok: false, reason: 'Hermes Desktop artifact host is incomplete. Rebuild the pinned artifact.' };
      }
      const approvedOrigins = new Set();
      /** @param {unknown} origins */
      const replaceApprovedOrigins = (origins) => {
        if (!Array.isArray(origins)) throw new Error('Hermes Desktop host returned invalid network origins.');
        const next = new Set();
        for (const value of origins) {
          try {
            const url = new URL(value);
            if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash) next.add(url.origin);
          } catch { throw new Error('Hermes Desktop host returned invalid network origins.'); }
        }
        approvedOrigins.clear();
        for (const origin of next) approvedOrigins.add(origin);
      };
      replaceApprovedOrigins(await host.getAllowedOrigins());
      if (disposed || !enabled() || epoch !== requestEpoch || !ownsHost(event)) {
        closeOwnedView(view, win);
        await host.dispose().catch(() => undefined);
        pendingHost = undefined;
        pendingView = undefined;
        return { ok: false, reason: 'Hermes Desktop attachment was revoked.' };
      }
      const record = { view, win, attachment: randomUUID(), frame: event.senderFrame, artifact, host, cleanups: /** @type {(() => void)[]} */ ([]), guestSessions: new Set() };
      active = record;
      pendingHost = undefined;
      pendingView = undefined;
      if (pendingHostCleanup) record.cleanups.push(pendingHostCleanup);
      pendingHostCleanup = undefined;
      const unsubscribe = host.onAllowedOrigins((/** @type {unknown} */ origins) => {
        try { replaceApprovedOrigins(origins); } catch { approvedOrigins.clear(); }
      });
      if (typeof unsubscribe !== 'function') {
        await detach();
        return { ok: false, reason: 'Hermes Desktop artifact host is incomplete. Rebuild the pinned artifact.' };
      }
      record.cleanups.push(unsubscribe);
      const partition = contents.session;
      const permissionRequest = (/** @type {Electron.WebContents} */ requestingContents, /** @type {string} */ permission, /** @type {(allowed: boolean) => void} */ callback, /** @type {{requestingUrl?: unknown, mediaTypes?: unknown}} */ details) => {
        const requestingUrl = typeof details?.requestingUrl === 'string' ? details.requestingUrl : '';
        if (requestingContents !== contents || permission !== 'media' || !isRendererDocument(requestingUrl)) {
          callback(false);
          return;
        }
        void host.handlePermissionRequest({ permission, requestingUrl, mediaTypes: details.mediaTypes, isMainFrame: true })
          .then((/** @type {boolean} */ allowed) => callback(allowed === true), () => callback(false));
      };
      const permissionCheck = (/** @type {Electron.WebContents | null} */ requestingContents, /** @type {string} */ permission, /** @type {string} */ requestingOrigin) => requestingContents === contents
        && permission === 'media' && isRendererDocument(requestingOrigin);
      partition.setPermissionRequestHandler(permissionRequest);
      partition.setPermissionCheckHandler(permissionCheck);
      const cancelDownload = (/** @type {Electron.Event} */ download) => download.preventDefault();
      partition.on('will-download', cancelDownload);
      record.cleanups.push(() => partition.removeListener('will-download', cancelDownload));
      partition.webRequest.onBeforeRequest((details, callback) => {
        let allowed = false;
        try {
          const target = new URL(details.url);
          const typographyAsset = target.protocol === 'https:' && (
            (details.resourceType === 'stylesheet' && target.hostname === 'fonts.googleapis.com'
              && target.pathname === '/css2' && target.searchParams.has('family'))
            || (details.resourceType === 'font' && target.hostname === 'fonts.gstatic.com'
              && /^\/s\/[^/]+\/.+\.(?:woff2?|ttf|otf)$/i.test(target.pathname))
          );
          allowed = (target.protocol === 'file:' && pathWithin(artifact.root, resolve(decodeURIComponent(target.pathname))))
            || target.protocol === 'hermes-media:' || typographyAsset || approvedOrigins.has(target.origin);
        } catch { /* fail closed */ }
        callback({ cancel: !allowed });
      });
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
      record.cleanups.push(() => {
        partition.webRequest.onBeforeRequest(null);
        partition.setPermissionRequestHandler(null);
        partition.setPermissionCheckHandler(null);
      });
      /** @param {string} name @param {(...args: any[]) => void} listener */
      const listen = (name, listener) => {
        contents.on(/** @type {any} */ (name), listener);
        record.cleanups.push(() => contents.removeListener(/** @type {any} */ (name), listener));
      };
      function isRendererEntry(/** @type {string} */ url) {
        try {
          const target = new URL(url);
          const entry = new URL(artifact.rendererUrl);
          return target.protocol === 'file:' && target.pathname === entry.pathname && target.search === entry.search;
        } catch { return false; }
      }
      function isRendererDocument(/** @type {string} */ url) {
        try {
          const target = new URL(url);
          const entry = new URL(artifact.rendererUrl);
          return target.protocol === 'file:' && target.pathname === entry.pathname;
        } catch { return false; }
      }
      listen('will-navigate', (/** @type {Electron.Event & {url?: unknown}} */ navigation, /** @type {string | undefined} */ legacyUrl) => {
        const url = typeof navigation?.url === 'string' ? navigation.url : legacyUrl;
        if (!isRendererEntry(url ?? '')) navigation.preventDefault();
      });
      listen('will-redirect', (/** @type {Electron.Event & {url?: unknown}} */ navigation, /** @type {string | undefined} */ legacyUrl) => {
        const url = typeof navigation?.url === 'string' ? navigation.url : legacyUrl;
        if (!isRendererEntry(url ?? '')) navigation.preventDefault();
      });
      listen('will-frame-navigate', (/** @type {Electron.Event & {url?: unknown, isMainFrame?: unknown}} */ navigation, /** @type {string | undefined} */ legacyUrl, /** @type {boolean | undefined} */ _legacyInPlace, /** @type {boolean | undefined} */ legacyIsMainFrame) => {
        const url = typeof navigation?.url === 'string' ? navigation.url : legacyUrl;
        const isMainFrame = typeof navigation?.isMainFrame === 'boolean' ? navigation.isMainFrame : legacyIsMainFrame;
        if (!isMainFrame || !isRendererEntry(url ?? '')) navigation.preventDefault();
      });
      listen('will-attach-webview', (/** @type {Electron.Event} */ navigation, /** @type {Record<string, unknown>} */ webPreferences, /** @type {Record<string, unknown>} */ params) => {
        // The Desktop renderer's established preview partition is translated
        // into the host-scoped partition before the native host validates it.
        // This keeps a remote browser guest isolated per Hermes view and does
        // not permit renderer-selected partitions.
        const previewPartition = `persist:hermes-embedded-${Number.isInteger(contents.id) ? contents.id : 'view'}-preview`;
        if (params.partition === 'persist:hermes-preview') params.partition = previewPartition;
        if (params.partition !== previewPartition || !host.handleWillAttachWebview(webPreferences, params)) navigation.preventDefault();
      });
      listen('did-attach-webview', (/** @type {Electron.Event} */ _attached, /** @type {Electron.WebContents} */ guest) => {
        guest.setWindowOpenHandler((details) => {
          void host.handleGuestWindowOpen(details.url).catch(() => undefined);
          return { action: 'deny' };
        });
        const permitsGuestNavigation = (/** @type {unknown} */ url) => {
          try { return typeof url === 'string' && host.handleGuestNavigation(url) === true; } catch { return false; }
        };
        const guardGuestNavigation = (/** @type {Electron.Event & {url?: unknown}} */ navigation, /** @type {string | undefined} */ legacyUrl) => {
          const url = typeof navigation?.url === 'string' ? navigation.url : legacyUrl;
          if (!permitsGuestNavigation(url)) navigation.preventDefault();
        };
        /** @type {any} */ (guest).on('will-navigate', guardGuestNavigation);
        /** @type {any} */ (guest).on('will-frame-navigate', guardGuestNavigation);
        /** @type {any} */ (guest).on('will-redirect', guardGuestNavigation);
        record.cleanups.push(() => {
          /** @type {any} */ (guest).removeListener('will-navigate', guardGuestNavigation);
          /** @type {any} */ (guest).removeListener('will-frame-navigate', guardGuestNavigation);
          /** @type {any} */ (guest).removeListener('will-redirect', guardGuestNavigation);
        });
        // Electron does not emit will-navigate for programmatic loadURL calls.
        // Preserve the native Browser runtime's HTTP(S)-only policy for those
        // calls as well as page-initiated navigation above.
        const originalGuestLoadURL = guest.loadURL;
        if (typeof originalGuestLoadURL === 'function') {
          guest.loadURL = (url, ...args) => permitsGuestNavigation(url)
            ? originalGuestLoadURL.call(guest, url, ...args)
            : Promise.reject(new Error('Hermes browser guest navigation was denied.'));
          record.cleanups.push(() => { guest.loadURL = originalGuestLoadURL; });
        }
        const guestSession = guest.session;
        if (guestSession === contents.session || record.guestSessions.has(guestSession)) return;
        // The preview is a remote browser document. Give its dedicated session
        // no ambient media permission or download authority, then clear only
        // that owned preview partition when the Hermes record is disposed.
        guestSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
        guestSession.setPermissionCheckHandler(() => false);
        const cancelGuestDownload = (/** @type {Electron.Event} */ download) => download.preventDefault();
        guestSession.on('will-download', cancelGuestDownload);
        record.cleanups.push(() => {
          guestSession.setPermissionRequestHandler(null);
          guestSession.setPermissionCheckHandler(null);
          guestSession.removeListener('will-download', cancelGuestDownload);
        });
        record.guestSessions.add(guestSession);
      });
      listen('render-process-gone', () => { if (active === record) void detach(); });
      view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      win.contentView.addChildView(view);
      try {
        await contents.loadURL(artifact.rendererUrl);
        if (active !== record) return { ok: false, reason: 'Hermes Desktop attachment was revoked.' };
        return { ok: true, attachment: record.attachment };
      } catch {
        if (active === record) await detach();
        return { ok: false, reason: 'Hermes Desktop renderer failed to load. Rebuild the pinned artifact and retry.' };
      }
    } catch (error) {
      const host = pendingHost;
      const view = pendingView;
      pendingHost = undefined;
      pendingView = undefined;
      closeOwnedView(view, win);
      await host?.dispose?.().catch(() => undefined);
      if (active) await detach();
      return { ok: false, reason: publicFailure(error instanceof Error ? error.message : undefined) };
    } finally {
      if (!active && epoch === requestEpoch) pendingHostCleanup?.();
    }
  };
  ipcMain.handle('hermes:view:attach', (event, ...args) => {
    const operation = attachmentTransition.then(() => attach(event, ...args));
    attachmentTransition = operation.catch(() => undefined);
    return operation;
  });

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
    if (!ownsAttachment(event, value) || !active || !enabled()) return { ok: false, reason: 'unavailable' };
    const intent = parseHermesIntent(value.intent);
    if (!intent) return { ok: false, reason: 'invalid-intent' };
    const record = active;
    const result = await record.host.handleIntent(intent).catch(() => ({ ok: false, reason: 'Hermes Desktop could not open that draft.' }));
    return active === record && ownsAttachment(event, value) ? result : { ok: false, reason: 'unavailable' };
  });
  return {
    disposeCurrent,
    dispose: async () => {
      disposed = true;
      await disposeCurrent();
      for (const channel of channels) ipcMain.removeHandler(channel);
    },
  };
}
