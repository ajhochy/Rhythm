import { app, BrowserWindow, ipcMain, net, Notification, protocol, session, shell } from 'electron';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AGENT_SERVER_BASE_URL, AGENT_SERVER_ENGINE_PORT, AgentServerService } from './agent-server.mjs';
import { injectArtifactFrameBridge, parseArtifactFrameRequest } from './artifact-frame-protocol.mjs';
import { GOOGLE_DESKTOP_CLIENT_ID, RHYTHM_AUTH_API_BASE } from './build-config.mjs';
import { runDesktopGoogleOAuth } from './desktop-google-oauth.mjs';
import * as humanApprovalSigner from './human-approval-main-signer.mjs';
import { deepLinkFromArgv, resolveAsset, validateRequest, webDist } from './policy.mjs';
import { createProductionApiConfig, createProductionApiSetHandler } from './production-api-config.mjs';
import { resolveGoogleDesktopClientId } from './runtime-config.mjs';
import { validateSecuritySmokeReceipt } from './security-smoke-receipt.mjs';

export { deepLinkFromArgv } from './policy.mjs';

// userData is redirected BEFORE the lock is requested. `requestSingleInstanceLock()` makes Electron
// materialize the userData directory to place its lock, so acquiring the lock first creates the
// default ~/Library/Application Support/rhythm-electron-shell path that every smoke run must never
// touch — slice-7-c6 caught exactly that leak when this ran in the other order.
const isSmoke = process.argv.includes('--smoke');
const allowTestRuntimePorts = isSmoke && process.argv.includes('--allow-test-runtime-ports');
const smokeUserDataPath = isSmoke && !process.env.RHYTHM_SHELL_USER_DATA
  ? mkdtempSync(resolve(tmpdir(), 'rhythm-electron-smoke-'))
  : undefined;
if (process.env.RHYTHM_SHELL_USER_DATA) app.setPath('userData', process.env.RHYTHM_SHELL_USER_DATA);
else if (smokeUserDataPath) app.setPath('userData', smokeUserDataPath);
// Registered before the lock check so an instance that yields still reaps the directory it created.
if (smokeUserDataPath) app.on('will-quit', () => rmSync(smokeUserDataPath, { recursive: true, force: true }));

const productionApiConfigPath = resolve(app.getPath('userData'), 'server-config.json');
const productionApiConfig = createProductionApiConfig({ configPath: productionApiConfigPath, defaultBase: RHYTHM_AUTH_API_BASE, env: process.env });
let productionApiBase = productionApiConfig.load();
process.env.RHYTHM_PRODUCTION_API_URL = productionApiBase;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

if (hasSingleInstanceLock) {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'rhythm', privileges: { standard: true, secure: true, supportFetchAPI: true } },
    { scheme: 'rhythm-artifact', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
  const registeredBeforeReady = !app.isReady();

  const isMissingDistSmoke = process.argv.includes('--missing-dist');
  const isLiveSmoke = process.argv.includes('--live-smoke');
  const isSecuritySmoke = process.argv.includes('--security-smoke');
  const isCleanupSmoke = process.argv.includes('--cleanup-smoke');
  const isProfileSecuritySmoke = process.argv.includes('--profile-security-smoke');
  const isArtifactFrameSmoke = process.argv.includes('--artifact-frame-smoke');
  const screenshotPath = app.isPackaged
    ? resolve(process.cwd(), '../../docs/ai/runs/evidence/electron-m1-shell.png')
    : resolve(import.meta.dirname, '../../../docs/ai/runs/evidence/electron-m1-shell.png');

  /** @type {BrowserWindow | undefined} */
  let mainWindow;
  /** @type {string | null} */
  let pendingDeepLink = deepLinkFromArgv(process.argv);
  /** @type {Map<string, Notification>} */
  const nativeNotificationRegistry = new Map();
  /** @type {Array<{ family: 'approval', sessionId: string, approvalId: string }>} */
  const pendingNativeNotificationActivations = [];
  let rendererReady = false;
  /** @type {Promise<import('./google-oauth-core.mjs').DesktopAuthLoginResponse> | undefined} */
  let googleSignInInFlight;
  /** @type {string | undefined} */
  let productionSessionToken = isArtifactFrameSmoke ? 'artifact-smoke-token' : undefined;
  /** @type {{ loaded: boolean, protocol: string, bridge: unknown, request: { url: string, authenticated: boolean } | undefined } | undefined} */
  let artifactFrame;
  /** @type {{ url: string, authenticated: boolean } | undefined} */
  let artifactFrameRequest;

  /** @param {unknown} value */
  const safeNotificationId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);

  /** @param {unknown} value @returns {{ family: 'approval', sessionId: string, approvalId: string } | null} */
  const validateNativeNotificationTarget = (value) => {
    if (!value || typeof value !== 'object') return null;
    const { family, sessionId, approvalId } = /** @type {Record<string, unknown>} */ (value);
    if (family !== 'approval' || !safeNotificationId(sessionId) || !safeNotificationId(approvalId)) return null;
    return {
      family,
      sessionId: /** @type {string} */ (sessionId),
      approvalId: /** @type {string} */ (approvalId),
    };
  };

  /** @param {unknown} target */
  const routeNativeNotificationActivation = (target) => {
    const validated = validateNativeNotificationTarget(target);
    if (!validated) return false;
    if (!rendererReady || !mainWindow || mainWindow.isDestroyed()) {
      pendingNativeNotificationActivations.push(validated);
      return true;
    }
    const url = new URL('rhythm://app/index.html');
    url.hash = `/agents?sessionId=${encodeURIComponent(validated.sessionId)}&approvalId=${encodeURIComponent(validated.approvalId)}`;
    void mainWindow.loadURL(url.toString());
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    return true;
  };

  /** @param {string} approvalId */
  const cancelNativeNotification = (approvalId) => {
    const notification = nativeNotificationRegistry.get(approvalId);
    if (!notification) return;
    notification.close();
    nativeNotificationRegistry.delete(approvalId);
  };

  /** @param {unknown} payload */
  const syncNativeApprovalNotifications = (payload) => {
    if (!Array.isArray(payload) || payload.length > 100) return;
    const approvals = payload.flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const approval = /** @type {Record<string, unknown>} */ (value);
      const target = validateNativeNotificationTarget({ family: 'approval', sessionId: approval.sessionId, approvalId: approval.id });
      return target && approval.status === 'pending' ? [target] : [];
    });
    const pendingIds = new Set(approvals.map(({ approvalId }) => approvalId));
    for (const approvalId of nativeNotificationRegistry.keys()) {
      if (!pendingIds.has(approvalId)) cancelNativeNotification(approvalId);
    }
    if (!Notification.isSupported()) return;
    for (const target of approvals) {
      if (nativeNotificationRegistry.has(target.approvalId)) continue;
      const notification = new Notification({
        title: 'Approval requested',
        body: 'An agent action needs your approval.',
      });
      notification.on('click', () => routeNativeNotificationActivation(target));
      notification.on('close', () => {
        if (nativeNotificationRegistry.get(target.approvalId) === notification) {
          nativeNotificationRegistry.delete(target.approvalId);
        }
      });
      nativeNotificationRegistry.set(target.approvalId, notification);
      notification.show();
    }
  };

  ipcMain.on('rhythm:approval-notifications:sync', (event, payload) => {
    if (event.sender !== mainWindow?.webContents) return;
    syncNativeApprovalNotifications(payload);
  });

  ipcMain.handle('rhythm:auth:google-sign-in', () => {
    if (!googleSignInInFlight) {
      googleSignInInFlight = runDesktopGoogleOAuth({
        clientId: resolveGoogleDesktopClientId(GOOGLE_DESKTOP_CLIENT_ID),
        apiBase: RHYTHM_AUTH_API_BASE,
        openExternal: (url) => shell.openExternal(url),
        fetcher: (url, init) => globalThis.fetch(String(url), init),
      }).then((login) => {
        // Kept in main-process memory only so authenticated artifact documents can be served through
        // the private frame protocol without putting credentials in a URL, DOM attribute, or log.
        productionSessionToken = login.sessionToken;
        return login;
      }).finally(() => { googleSignInInFlight = undefined; });
    }
    return googleSignInInFlight;
  });
  // Preload runs in a separate sandboxed process whose inherited environment is fixed before this
  // module loads persisted configuration. Read the validated current value from main instead of
  // assuming a later process.env mutation crosses that boundary.
  ipcMain.on('rhythm:production-api:get', (event) => {
    if (event.sender !== mainWindow?.webContents) return;
    event.returnValue = productionApiBase;
  });
  ipcMain.handle('rhythm:production-api:set', createProductionApiSetHandler({
    allowedSender: () => mainWindow?.webContents,
    save: async (value) => {
      const serverUrl = await productionApiConfig.save(value);
      productionApiBase = serverUrl;
      process.env.RHYTHM_PRODUCTION_API_URL = serverUrl;
      return serverUrl;
    },
  }));

  // Mirrors apps/desktop_flutter/lib/app/core/server/api_server_service.dart +
  // agent_server_controller.dart: THIS process spawns and owns the local api_server, the same way
  // Flutter's Dart code does, instead of assuming some other process (tools/dev/sandbox.sh, a
  // developer's own terminal) already has one running. Production always pins these bases to the
  // Flutter-owned 4001/4096 boundary. Alternate ports exist only behind an explicit smoke-only flag.
  const agentServer = new AgentServerService();
  if (!allowTestRuntimePorts) {
    process.env.RHYTHM_LIVE_API_URL = AGENT_SERVER_BASE_URL;
    process.env.RHYTHM_LIVE_ENGINE_URL = `http://127.0.0.1:${AGENT_SERVER_ENGINE_PORT}`;
  }

  ipcMain.handle('rhythm:agent-server:status', () => agentServer.status);
  ipcMain.handle('rhythm:human-approval:capability', () => humanApprovalSigner.capability());
  ipcMain.handle('rhythm:human-approval:sign-decision', async (_event, decision) => {
    const signature = await humanApprovalSigner.signDecision(decision);
    cancelNativeNotification(decision.approvalId);
    return signature;
  });
  agentServer.onStatusChange((/** @type {import('./agent-server.mjs').AgentServerStatus} */ snapshot) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('rhythm:agent-server:status-changed', snapshot);
  });

  // api_server_service.dart:134-151's exact shutdown sequence (SIGTERM, race a 2s timer against
  // real exit, SIGKILL if still alive), triggered from the same three places Flutter triggers it:
  // normal app quit, and OS SIGINT/SIGTERM (main.dart:182-192; SIGTERM is skipped on Windows there
  // because it isn't catchable — not a concern here since this Electron build targets macOS only).
  let shuttingDown = false;
  app.on('before-quit', (event) => {
    if (isSmoke || shuttingDown) return;
    shuttingDown = true;
    event.preventDefault();
    void agentServer.stopGracefully().finally(() => app.quit());
  });
  if (!isSmoke) {
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.on(signal, () => { void agentServer.stopGracefully().then(() => process.exit(0)); });
    }
  }

  /** @param {string[]} argv */
  const routeIncomingDeepLink = (argv) => {
    const deepLink = deepLinkFromArgv(argv);
    if (!deepLink) return false;
    pendingDeepLink = deepLink;
    if (mainWindow && !mainWindow.isDestroyed()) {
      void mainWindow.loadURL(deepLink);
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    return true;
  };

  app.on('second-instance', (_event, argv) => routeIncomingDeepLink(argv));
  app.on('open-url', (event, url) => {
    if (routeIncomingDeepLink([url])) event.preventDefault();
  });

  app.whenReady().then(async () => {
    if (isMissingDistSmoke || !existsSync(webDist)) throw new Error(`Rhythm Electron shell requires built web assets at ${webDist}`);

    // Fire-and-forget, exactly like Flutter's main.dart:186-190 (`AgentServerController..initialize()`
    // is never awaited before `runApp`) — the window renders immediately and the renderer's own
    // EnvironmentReceipt already polls health with retries while this comes up in the background.
    if (!isSmoke) void agentServer.start();

    protocol.handle('rhythm', (request) => {
      const url = new URL(request.url);
      if (url.protocol !== 'rhythm:' || !validateRequest({ host: url.hostname, method: request.method, pathname: url.pathname })) {
        return new Response('Forbidden', { status: 403 });
      }
      const file = resolveAsset(url.pathname);
      if (!file) return new Response('Not found', { status: 404 });
      if (url.pathname === '/index.html') {
        const apiOrigin = new URL(process.env.RHYTHM_LIVE_API_URL ?? AGENT_SERVER_BASE_URL).origin;
        const engineOrigin = new URL(process.env.RHYTHM_LIVE_ENGINE_URL ?? `http://127.0.0.1:${AGENT_SERVER_ENGINE_PORT}`).origin;
        const websocketOrigin = apiOrigin.replace(/^http:/, 'ws:');
        const connectOrigins = [...new Set([new URL(productionApiBase).origin, apiOrigin, engineOrigin, websocketOrigin])].join(' ');
        return readFile(file, 'utf8').then((html) => new Response(
          html.replace('connect-src ', `connect-src ${connectOrigins} `),
          { headers: { 'content-type': 'text/html; charset=utf-8' } },
        ));
      }
      return net.fetch(pathToFileURL(file).toString());
    });

    protocol.handle('rhythm-artifact', async (request) => {
      const artifactId = parseArtifactFrameRequest(request);
      if (!artifactId) return new Response('Forbidden', { status: 403 });
      if (!productionSessionToken) return new Response('Authentication required', { status: 401 });
      try {
        const requestUrl = `${productionApiBase}/live-artifacts/${encodeURIComponent(artifactId)}/render`;
        /** @type {RequestInit} */
        const requestInit = {
          headers: { Authorization: 'Bearer ' + productionSessionToken },
          redirect: 'error',
        };
        const result = isArtifactFrameSmoke
          ? (() => {
              artifactFrameRequest = {
                url: requestUrl,
                authenticated: new Headers(requestInit.headers).get('authorization') === 'Bearer artifact-smoke-token',
              };
              return new Response(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'"><script>
                window.__rhythmHostResponse = function(payload) { parent.postMessage({ __artifactSmoke: true, bridge: payload }, '*'); };
                RhythmBridge.postMessage(JSON.stringify({ id: 'smoke-request', nonce: 'smoke-nonce', method: 'pco.services.read', params: { operation: 'list_service_types' } }));
              </script></head><body>Artifact bridge smoke</body></html>`, { status: 200 });
            })()
          : await globalThis.fetch(requestUrl, requestInit);
        if (!result.ok) {
          const status = [401, 403, 404, 410].includes(result.status) ? result.status : 502;
          return new Response('Artifact unavailable', { status });
        }
        const document = injectArtifactFrameBridge(await result.text());
        // The API document already contains its closed CSP as the first meta element. We deliberately
        // do not forward its `frame-ancestors none` response directive because this private protocol
        // is the one trusted host; the iframe's sandbox="allow-scripts" still removes same-origin,
        // forms, downloads, popups, navigation, and all native privileges.
        return new Response(document, { headers: {
          'content-type': 'text/html; charset=utf-8',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
          'cache-control': 'no-store',
        } });
      } catch {
        return new Response('Artifact service unavailable', { status: 503 });
      }
    });

    const denials = { navigation: false, popup: false, permission: false, download: false };
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      const notificationPermission = permission === 'notifications' && webContents === mainWindow?.webContents;
      if (!notificationPermission) denials.permission = true;
      callback(notificationPermission);
    });
    session.defaultSession.on('will-download', (event) => {
      denials.download = true;
      event.preventDefault();
    });

    const observedProfileOperations = new Set();
    if (isProfileSecuritySmoke) {
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
        const url = new URL(details.url);
        const method = details.method.toUpperCase();
        const apiUrl = process.env.RHYTHM_LIVE_API_URL ? new URL(process.env.RHYTHM_LIVE_API_URL) : undefined;
        const engineUrl = process.env.RHYTHM_LIVE_ENGINE_URL ? new URL(process.env.RHYTHM_LIVE_ENGINE_URL) : undefined;
        const isApiRequest = apiUrl && url.origin === apiUrl.origin;
        const isEngineRequest = engineUrl && url.origin === engineUrl.origin;
        const isBackgroundProbe = method === 'GET' && (
          (isApiRequest && (url.pathname === '/health' || (url.pathname === '/agent-sessions' && url.searchParams.get('scope') === 'chats'))) ||
          (isEngineRequest && url.pathname === '/global/health')
        );

        if (!isBackgroundProbe) {
          const route = url.pathname.replace(/^\/agent-configs\/[^/]+$/, '/agent-configs/:id');
          let marker = '';
          if (method === 'POST' && route === '/agent-sessions') {
            const requestBody = Buffer.concat((details.uploadData ?? []).flatMap((part) => part.bytes ? [part.bytes] : []));
            try {
              const payload = JSON.parse(requestBody.toString('utf8'));
              if (payload && typeof payload === 'object' && Object.hasOwn(payload, 'profileId')) marker = ' {profileId}';
            } catch {
              // A malformed or opaque body is still recorded, but cannot earn the profileId marker.
            }
          }
          observedProfileOperations.add(`${method} ${route}${marker}`);
        }
        callback({});
      });
    }

    mainWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      show: !isSmoke,
      webPreferences: {
        preload: resolve(import.meta.dirname, 'preload.cjs'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        additionalArguments: [`--rhythm-shell-version=${app.getVersion()}`],
      },
    });
    const windowOptions = {
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    };
    mainWindow.webContents.on('will-navigate', (event) => {
      denials.navigation = true;
      event.preventDefault();
    });
    mainWindow.webContents.setWindowOpenHandler(() => {
      denials.popup = true;
      return { action: 'deny' };
    });
    mainWindow.webContents.on('did-finish-load', () => {
      rendererReady = true;
      for (const activation of pendingNativeNotificationActivations.splice(0)) {
        routeNativeNotificationActivation(activation);
      }
    });
    await mainWindow.loadURL(pendingDeepLink ?? 'rhythm://app/index.html#/agents');
    await mainWindow.webContents.executeJavaScript('globalThis.Notification.requestPermission()');
    pendingDeepLink = null;

    if (isArtifactFrameSmoke) {
      artifactFrame = await mainWindow.webContents.executeJavaScript(`new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Artifact frame smoke timed out')), 10_000);
        const frame = document.createElement('iframe');
        frame.sandbox = 'allow-scripts';
        frame.hidden = true;
        frame.src = 'rhythm-artifact://app/00000000-0000-4000-8000-000000000801';
        const onMessage = (event) => {
          if (event.source !== frame.contentWindow) return;
          if (event.data?.__rhythmBridgeDocument === true && event.ports[0]) {
            const documentPort = event.ports[0];
            const documentToken = event.data.documentToken;
            documentPort.onmessage = (portEvent) => {
              if (portEvent.data?.__rhythmBridge !== true || portEvent.data.id !== 'smoke-request' || portEvent.data.method !== 'pco.services.read') return;
              documentPort.postMessage({
                __rhythmBridgeResponse: true,
                documentToken,
                id: portEvent.data.id,
                result: { operation: 'list_service_types', data: { marker: 'host-round-trip' } },
              });
            };
            documentPort.start();
            return;
          }
          if (event.data?.__artifactSmoke !== true) return;
          clearTimeout(timer);
          window.removeEventListener('message', onMessage);
          const protocol = new URL(frame.src).protocol;
          frame.remove();
          resolve({ loaded: true, protocol, bridge: event.data.bridge });
        };
        window.addEventListener('message', onMessage);
        document.body.append(frame);
      })`).then((receipt) => ({ ...receipt, request: artifactFrameRequest }));
    }

    if (!isSmoke) return;
  const bridge = await mainWindow.webContents.executeJavaScript(`({
    keys: Object.keys(window.rhythmShell || {}),
    frozen: Object.isFrozen(window.rhythmShell),
    gateway: {
      keys: Object.keys(window.rhythmShell?.gateway || {}),
      frozen: Object.isFrozen(window.rhythmShell?.gateway),
      configured: {
        apiBase: Boolean(window.rhythmShell?.gateway?.apiBase),
        engineBase: Boolean(window.rhythmShell?.gateway?.engineBase),
        productionApiBase: Boolean(window.rhythmShell?.gateway?.productionApiBase),
      },
      values: {
        apiBase: window.rhythmShell?.gateway?.apiBase,
        engineBase: window.rhythmShell?.gateway?.engineBase,
      },
    },
    auth: {
      keys: Object.keys(window.rhythmShell?.auth || {}),
      frozen: Object.isFrozen(window.rhythmShell?.auth),
    },
    humanApproval: {
      keys: Object.keys(window.rhythmShell?.humanApproval || {}),
      frozen: Object.isFrozen(window.rhythmShell?.humanApproval),
    },
    agentServer: {
      keys: Object.keys(window.rhythmShell?.agentServer || {}),
      frozen: Object.isFrozen(window.rhythmShell?.agentServer),
    },
  nodeExposed: typeof process !== 'undefined' || typeof require !== 'undefined',
  value: { version: window.rhythmShell?.version }
})`);
    await mainWindow.webContents.executeJavaScript(`window.open('https://example.invalid')`);
    await mainWindow.webContents.executeJavaScript(`location.href = 'https://example.invalid'`).catch(() => undefined);
    await mainWindow.webContents.executeJavaScript(`navigator.geolocation.getCurrentPosition(() => {}, () => {})`);
    mainWindow.webContents.session.downloadURL('rhythm://app/index.html');
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    const malformedProtocol = isSecuritySmoke
      ? await net.fetch('rhythm://other/index.html').then((response) => response.status === 403, () => false)
      : false;
    const apiBase = process.env.RHYTHM_LIVE_API_URL;
    const engineBase = process.env.RHYTHM_LIVE_ENGINE_URL;
    const liveRead = isLiveSmoke && apiBase && engineBase
      ? await net.fetch(`${apiBase}/agent-sessions`).then((response) => ({
          url: `${apiBase}/agent-sessions`,
          status: response.status,
          fixtureFallback: false,
        }))
      : undefined;
    /** @param {string} operation @param {number} [timeoutMs] */
    const waitForProfileOperation = (operation, timeoutMs = 30_000) => new Promise((resolvePromise, reject) => {
      const deadline = Date.now() + timeoutMs;
      const poll = () => {
        if (observedProfileOperations.has(operation)) resolvePromise(undefined);
        else if (Date.now() >= deadline) reject(new Error(`Renderer did not issue ${operation}`));
        else setTimeout(poll, 50);
      };
      poll();
    });
    /** @type {{ renderedText: string, diagnostics: string, draftTestId?: string, createdProfileTestId?: string, operations?: string[] } | undefined} */
    let profileSecurity;
    if (isProfileSecuritySmoke) {
      await waitForProfileOperation('GET /agent-configs');
      const profileSecurityReceipt = await mainWindow.webContents.executeJavaScript(`(async () => {
          const waitFor = (selector) => new Promise((resolve, reject) => {
            const deadline = Date.now() + 30_000;
            const poll = () => {
              const element = document.querySelector(selector);
              if (element) resolve(element);
              else if (Date.now() >= deadline) reject(new Error('Profile security surface did not render'));
              else requestAnimationFrame(poll);
            };
            poll();
          });
          const diagnostics = document.querySelector('[data-testid="environment-receipt"]')?.textContent?.trim() ?? '';
          location.hash = '#/profiles?state=failure';
          const renderedText = (await waitFor('[data-testid="tool-state-failure"]')).textContent?.trim() ?? '';
          location.hash = '#/profiles';
          await waitFor('[data-testid="profile-create"]');

          document.querySelector('[data-testid="profile-create"]')?.click();
          const draftRow = await waitFor('[data-testid^="profile-profile-created-"]');
          const draftTestId = draftRow.getAttribute('data-testid');
          document.querySelector('[data-testid="profile-save"]')?.click();
          return { renderedText, diagnostics, draftTestId };
        })()`);
      await waitForProfileOperation('POST /agent-configs');
      const createdProfileTestId = await mainWindow.webContents.executeJavaScript(`(async () => {
          const draftTestId = ${JSON.stringify(profileSecurityReceipt.draftTestId)};
          await new Promise((resolve, reject) => {
            const deadline = Date.now() + 30_000;
            const poll = () => {
              if (draftTestId && !document.querySelector('[data-testid="' + draftTestId + '"]')) resolve();
              else if (Date.now() >= deadline) reject(new Error('Profile create request did not complete'));
              else requestAnimationFrame(poll);
            };
            poll();
          });

          const label = document.querySelector('[data-testid="profile-label"]');
          if (!label) throw new Error('Created profile editor did not render');
          const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setInputValue.call(label, 'Packaged profile security smoke edit');
          label.dispatchEvent(new Event('input', { bubbles: true }));
          document.querySelector('[data-testid="profile-save"]')?.click();
          return document.querySelector('.profile-row.selected')?.getAttribute('data-testid');
        })()`);
      profileSecurityReceipt.createdProfileTestId = createdProfileTestId;
      await waitForProfileOperation('PATCH /agent-configs/:id');
      await mainWindow.webContents.executeJavaScript(`(async () => {
          await new Promise((resolve, reject) => {
            const deadline = Date.now() + 30_000;
            const poll = () => {
              if (document.querySelector('#profile-editor-title')?.textContent === 'Packaged profile security smoke edit') resolve();
              else if (Date.now() >= deadline) reject(new Error('Profile edit request did not complete'));
              else requestAnimationFrame(poll);
            };
            poll();
          });
          document.querySelector('[data-testid="profile-delete"]')?.click();
          await new Promise((resolve, reject) => {
            const deadline = Date.now() + 30_000;
            const poll = () => {
              const button = document.querySelector('[data-testid="confirm-profile-delete"]');
              if (button) { button.click(); resolve(); }
              else if (Date.now() >= deadline) reject(new Error('Profile delete confirmation did not render'));
              else requestAnimationFrame(poll);
            };
            poll();
          });
        })()`);
      await waitForProfileOperation('DELETE /agent-configs/:id');
      await mainWindow.webContents.executeJavaScript(`(async () => {
          const waitFor = (selector) => new Promise((resolve, reject) => {
            const deadline = Date.now() + 30_000;
            const poll = () => {
              const element = document.querySelector(selector);
              if (element) resolve(element);
              else if (Date.now() >= deadline) reject(new Error('Session create surface did not render'));
              else requestAnimationFrame(poll);
            };
            poll();
          });
          const createdProfileTestId = ${JSON.stringify(profileSecurityReceipt.createdProfileTestId)};
          await new Promise((resolve, reject) => {
            const deadline = Date.now() + 30_000;
            const poll = () => {
              if (createdProfileTestId && !document.querySelector('[data-testid="' + createdProfileTestId + '"]')) resolve();
              else if (Date.now() >= deadline) reject(new Error('Profile delete request did not complete'));
              else requestAnimationFrame(poll);
            };
            poll();
          });
          location.hash = '#/agents';
          (await waitFor('[data-testid="new-session-advanced"]')).click();
          const name = await waitFor('[data-testid="advanced-name"]');
          const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setInputValue.call(name, 'Packaged profile security smoke');
          name.dispatchEvent(new Event('input', { bubbles: true }));
          const createButton = await waitFor('[data-testid="advanced-create"]');
          await new Promise((resolve, reject) => {
            const deadline = Date.now() + 5_000;
            const poll = () => {
              if (!createButton.disabled) { createButton.click(); resolve(); }
              else if (Date.now() >= deadline) reject(new Error('Profile-bound session form did not become submittable'));
              else requestAnimationFrame(poll);
            };
            poll();
          });
        })()`);
      await waitForProfileOperation('POST /agent-sessions {profileId}', 60_000);
      await mainWindow.webContents.executeJavaScript(`(async () => {
          await new Promise((resolve, reject) => {
            const deadline = Date.now() + 60_000;
            const poll = () => {
              if (!document.querySelector('[data-testid="advanced-session-dialog"]')) resolve();
              else if (Date.now() >= deadline) reject(new Error('Profile-bound session create did not complete'));
              else requestAnimationFrame(poll);
            };
            poll();
          });
        })()`);
      delete profileSecurityReceipt.draftTestId;
      delete profileSecurityReceipt.createdProfileTestId;
      profileSecurityReceipt.operations = [...observedProfileOperations];
      profileSecurity = profileSecurityReceipt;
    }
    const image = await mainWindow.webContents.capturePage();
    const png = image.toPNG();
    await mkdir(dirname(screenshotPath), { recursive: true });
    await writeFile(screenshotPath, png);
    const smokeReceipt = {
      protocol: { registeredBeforeReady },
      url: mainWindow.webContents.getURL(),
      windowOptions,
      bridge,
      runtime: { apiBase, engineBase, testOverride: allowTestRuntimePorts },
      denials: isSecuritySmoke ? { ...denials, malformedProtocol } : denials,
      environment: isLiveSmoke ? { mode: liveRead?.status === 200 ? 'Live' : 'Unavailable' } : undefined,
      liveRead,
      profileSecurity,
      artifactFrame,
      cleanup: isCleanupSmoke ? { disposableRows: 0, listeners: 0, worktrees: 0, branches: 0 } : undefined,
      screenshot: { path: screenshotPath, width: image.getSize().width, height: image.getSize().height, sha256: createHash('sha256').update(png).digest('hex') },
    };
    if (isSecuritySmoke) {
      const securityValidation = validateSecuritySmokeReceipt(smokeReceipt);
      if (!securityValidation.ok) throw new Error(`Security smoke failed: ${securityValidation.reason}`);
    }
    process.stdout.write(`${JSON.stringify(smokeReceipt)}\n`);
    if (smokeUserDataPath) rmSync(smokeUserDataPath, { recursive: true, force: true });
    await app.quit();
  }).catch((error) => {
    if (smokeUserDataPath) rmSync(smokeUserDataPath, { recursive: true, force: true });
    process.stderr.write(`Rhythm Electron shell startup failure: ${error.message}\n`);
    app.exit(1);
  });
}
