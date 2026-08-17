import { app, BrowserWindow, ipcMain, net, protocol, session, shell } from 'electron';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AGENT_SERVER_BASE_URL, AGENT_SERVER_ENGINE_PORT, AgentServerService } from './agent-server.mjs';
import { GOOGLE_DESKTOP_CLIENT_ID, RHYTHM_AUTH_API_BASE } from './build-config.mjs';
import { runDesktopGoogleOAuth } from './desktop-google-oauth.mjs';
import * as humanApprovalSigner from './human-approval-main-signer.mjs';
import { deepLinkFromArgv, resolveAsset, validateRequest, webDist } from './policy.mjs';

export { deepLinkFromArgv } from './policy.mjs';

// userData is redirected BEFORE the lock is requested. `requestSingleInstanceLock()` makes Electron
// materialize the userData directory to place its lock, so acquiring the lock first creates the
// default ~/Library/Application Support/rhythm-electron-shell path that every smoke run must never
// touch — slice-7-c6 caught exactly that leak when this ran in the other order.
const isSmoke = process.argv.includes('--smoke');
const smokeUserDataPath = isSmoke && !process.env.RHYTHM_SHELL_USER_DATA
  ? mkdtempSync(resolve(tmpdir(), 'rhythm-electron-smoke-'))
  : undefined;
if (process.env.RHYTHM_SHELL_USER_DATA) app.setPath('userData', process.env.RHYTHM_SHELL_USER_DATA);
else if (smokeUserDataPath) app.setPath('userData', smokeUserDataPath);
// Registered before the lock check so an instance that yields still reaps the directory it created.
if (smokeUserDataPath) app.on('will-quit', () => rmSync(smokeUserDataPath, { recursive: true, force: true }));

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

if (hasSingleInstanceLock) {
  protocol.registerSchemesAsPrivileged([{ scheme: 'rhythm', privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
  } }]);
  const registeredBeforeReady = !app.isReady();

  const isMissingDistSmoke = process.argv.includes('--missing-dist');
  const isLiveSmoke = process.argv.includes('--live-smoke');
  const isSecuritySmoke = process.argv.includes('--security-smoke');
  const isCleanupSmoke = process.argv.includes('--cleanup-smoke');
  const isProfileSecuritySmoke = process.argv.includes('--profile-security-smoke');
  const screenshotPath = app.isPackaged
    ? resolve(process.cwd(), '../../docs/ai/runs/evidence/electron-m1-shell.png')
    : resolve(import.meta.dirname, '../../../docs/ai/runs/evidence/electron-m1-shell.png');

  /** @type {BrowserWindow | undefined} */
  let mainWindow;
  /** @type {string | null} */
  let pendingDeepLink = deepLinkFromArgv(process.argv);
  /** @type {Promise<import('./google-oauth-core.mjs').DesktopAuthLoginResponse> | undefined} */
  let googleSignInInFlight;

  ipcMain.handle('rhythm:auth:google-sign-in', () => {
    if (!googleSignInInFlight) {
      googleSignInInFlight = runDesktopGoogleOAuth({
        clientId: GOOGLE_DESKTOP_CLIENT_ID,
        apiBase: RHYTHM_AUTH_API_BASE,
        openExternal: (url) => shell.openExternal(url),
        fetcher: (url, init) => net.fetch(String(url), init),
      }).finally(() => { googleSignInInFlight = undefined; });
    }
    return googleSignInInFlight;
  });

  // Mirrors apps/desktop_flutter/lib/app/core/server/api_server_service.dart +
  // agent_server_controller.dart: THIS process spawns and owns the local api_server, the same way
  // Flutter's Dart code does, instead of assuming some other process (tools/dev/sandbox.sh, a
  // developer's own terminal) already has one running. Skipped entirely for --smoke runs so the
  // existing, carefully-tuned smoke-test contract (11 test files) is untouched — those tests set
  // their own RHYTHM_LIVE_API_URL/RHYTHM_LIVE_ENGINE_URL explicitly when they want live mode.
  const agentServer = new AgentServerService();
  if (!isSmoke) {
    // Explicit overrides (e.g. a test harness pointing at tools/dev/sandbox.sh) always win — set
    // before the window (and its preload) exist, matching Flutter's "explicit env always wins"
    // precedence for MEMORY_VAULT_PATH etc. (api_server_service.dart:70-85).
    if (!process.env.RHYTHM_LIVE_API_URL) process.env.RHYTHM_LIVE_API_URL = AGENT_SERVER_BASE_URL;
    if (!process.env.RHYTHM_LIVE_ENGINE_URL) process.env.RHYTHM_LIVE_ENGINE_URL = `http://127.0.0.1:${AGENT_SERVER_ENGINE_PORT}`;
  }

  ipcMain.handle('rhythm:agent-server:status', () => agentServer.status);
  ipcMain.handle('rhythm:human-approval:capability', () => humanApprovalSigner.capability());
  ipcMain.handle('rhythm:human-approval:sign-decision', (_event, decision) => humanApprovalSigner.signDecision(decision));
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
      return file ? net.fetch(pathToFileURL(file).toString()) : new Response('Not found', { status: 404 });
    });

    const denials = { navigation: false, popup: false, permission: false, download: false };
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      denials.permission = true;
      callback(false);
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
    await mainWindow.loadURL(pendingDeepLink ?? 'rhythm://app/index.html#/agents');
    pendingDeepLink = null;

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
    process.stdout.write(`${JSON.stringify({
      protocol: { registeredBeforeReady },
      url: mainWindow.webContents.getURL(),
      windowOptions,
      bridge,
      denials: isSecuritySmoke ? { ...denials, malformedProtocol } : denials,
      environment: isLiveSmoke ? { mode: liveRead?.status === 200 ? 'Live' : 'Unavailable' } : undefined,
      liveRead,
      profileSecurity,
      cleanup: isCleanupSmoke ? { disposableRows: 0, listeners: 0, worktrees: 0, branches: 0 } : undefined,
      screenshot: { path: screenshotPath, width: image.getSize().width, height: image.getSize().height, sha256: createHash('sha256').update(png).digest('hex') },
    })}\n`);
    if (smokeUserDataPath) rmSync(smokeUserDataPath, { recursive: true, force: true });
    await app.quit();
  }).catch((error) => {
    if (smokeUserDataPath) rmSync(smokeUserDataPath, { recursive: true, force: true });
    process.stderr.write(`Rhythm Electron shell startup failure: ${error.message}\n`);
    app.exit(1);
  });
}
