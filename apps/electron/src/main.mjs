import { app, BrowserWindow, dialog, ipcMain, net, Notification, protocol, safeStorage, session, shell } from 'electron';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AGENT_SERVER_BASE_URL, AGENT_SERVER_ENGINE_PORT, AgentServerService, electronDbPath, legacyFlutterDbPath } from './agent-server.mjs';
import { injectArtifactFrameBridge, isAllowedArtifactFrameNavigation, parseArtifactFrameRequest } from './artifact-frame-protocol.mjs';
import { GOOGLE_DESKTOP_CLIENT_ID, RHYTHM_AUTH_API_BASE } from './build-config.mjs';
import { runDesktopGoogleOAuth } from './desktop-google-oauth.mjs';
import * as humanApprovalSigner from './human-approval-main-signer.mjs';
import { createHermesSupervisor } from './hermes-server.mjs';
import { deepLinkFromArgv, resolveAsset, validateRequest, webDist } from './policy.mjs';
import { createProductionApiConfig, createProductionApiSetHandler } from './production-api-config.mjs';
import { resolveGoogleDesktopClientId } from './runtime-config.mjs';
import { validateSecuritySmokeReceipt } from './security-smoke-receipt.mjs';
import { createAccountsAuthState } from './hermes-accounts-auth.mjs';
import { createHermesAccountsMain } from './hermes-accounts-main.mjs';
import { createAgentBridgeHost } from './hermes-agent-bridge.mjs';
import { bindHermesViewSupervisor, registerHermesView } from './hermes-view.mjs';
import { registerColonyHost } from './colony-host.mjs';

export { deepLinkFromArgv } from './policy.mjs';

// userData is redirected BEFORE the lock is requested. `requestSingleInstanceLock()` makes Electron
// materialize the userData directory to place its lock, so acquiring the lock first creates the
// default ~/Library/Application Support/rhythm-electron-shell path that every smoke run must never
// touch — slice-7-c6 caught exactly that leak when this ran in the other order.
const isSmoke = process.argv.includes('--smoke');
const isInteractiveSmoke = process.argv.includes('--interactive-smoke');
const allowTestRuntimePorts = (isSmoke || isInteractiveSmoke) && process.argv.includes('--allow-test-runtime-ports');
if (isInteractiveSmoke && (!process.env.RHYTHM_SHELL_USER_DATA || !isAbsolute(process.env.RHYTHM_SHELL_USER_DATA))) {
  throw new Error('--interactive-smoke requires an explicit absolute RHYTHM_SHELL_USER_DATA path');
}
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
const authSessionPath = resolve(app.getPath('userData'), 'auth-session.bin');
process.env.RHYTHM_PRODUCTION_API_URL = productionApiBase;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

if (hasSingleInstanceLock) {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'rhythm', privileges: { standard: true, secure: true, supportFetchAPI: true } },
    { scheme: 'rhythm-artifact', privileges: { standard: true, secure: true, supportFetchAPI: true } },
    { scheme: 'rhythm-colony', privileges: { standard: true, secure: true, supportFetchAPI: true } },
    // Hermes registers the handler on the isolated embedded session; Chromium
    // still requires this privilege declaration before app readiness.
    { scheme: 'hermes-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
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
  /** @type {ReturnType<typeof registerColonyHost> | undefined} */
  let colonyHost;
  const hermesView = registerHermesView({ ipcMain, getWindow: () => mainWindow, getUserDataPath: () => app.getPath('userData'), getBackendCredentialOptions: () => credentialHostOptions(), openExternal: (url) => shell.openExternal(url) });
  /** @type {string | null} */
  let pendingDeepLink = deepLinkFromArgv(process.argv);
  /** @type {Map<string, Notification>} */
  const nativeNotificationRegistry = new Map();
  const agentNotificationReceiptPath = isInteractiveSmoke && allowTestRuntimePorts
    ? resolve(/** @type {string} */ (process.env.RHYTHM_SHELL_USER_DATA), 'agent-notification-receipts.jsonl')
    : undefined;
  /** @param {{ event: 'show', family: 'permission' | 'question' | 'completion', sessionId: string } | { event: 'withdraw' }} receipt */
  const recordAgentNotificationReceipt = (receipt) => {
    if (!agentNotificationReceiptPath) return;
    try { appendFileSync(agentNotificationReceiptPath, `${JSON.stringify(receipt)}\n`, { encoding: 'utf8', mode: 0o600 }); } catch {}
  };
  /** @type {Array<{ family: 'approval', sessionId: string, approvalId: string }>} */
  const pendingNativeNotificationActivations = [];
  let rendererReady = false;
  /** @typedef {{ key: string, family?: 'permission' | 'question', sessionId: string, generation: number, created: number, valid: boolean, notification?: Notification, queued?: boolean, retireAfterActivation?: boolean, retireTimer?: ReturnType<typeof setTimeout> }} AgentTarget */
  /** @type {Map<string, AgentTarget>} */
  const agentTargets = new Map();
  /** @type {Map<string, number>} */
  const completionCycles = new Map();
  /** @type {Map<string, number>} */
  const retiredCompletions = new Map();
  let agentReady = false;
  /** @type {{ sessionId: string | null, displayed: boolean }} */
  let agentViewing = { sessionId: null, displayed: false };
  /** @type {AgentTarget | undefined} */
  let queuedAgentActivation;
  let activationSequence = 0;
  let activeLookups = 0;
  /** @type {AgentTarget[]} */
  const waitingLookups = [];
  /** @type {number[]} */
  const admissionTimes = [];
  /** @type {'granted' | 'denied' | 'unknown' | 'unsupported'} */
  let agentNotificationPermission = 'unknown';
  let agentNotificationPermissionPrimed = false;
  /** @type {Notification | undefined} */
  let agentNotificationPermissionPrimer;
  const reportAgentNotificationPermission = () => {
    const contents = mainWindow?.webContents;
    if (!contents || contents.isDestroyed()) return;
    try { contents.send('rhythm:agent-notifications:permission', { v: 1, status: agentNotificationPermission }); } catch {}
  };
  /** @param {'granted' | 'denied' | 'unknown' | 'unsupported'} status */
  const recordAgentNotificationPermission = (status) => {
    agentNotificationPermission = status;
    reportAgentNotificationPermission();
  };
  const primeAgentNotificationPermission = () => {
    if (agentNotificationPermissionPrimed) { reportAgentNotificationPermission(); return; }
    agentNotificationPermissionPrimed = true;
    try {
      if (!Notification.isSupported()) { recordAgentNotificationPermission('unsupported'); return; }
    } catch { recordAgentNotificationPermission('unknown'); return; }
    // Electron has no main-process requestPermission API. On macOS the first show() is the
    // explicit OS permission trigger; on other supported platforms this is only a best-effort
    // presentation probe. A show event is observable as granted. A permission-specific failure
    // is denied; silence or any other platform error remains unknown rather than overclaiming.
    recordAgentNotificationPermission('unknown');
    try {
      const primer = new Notification({
        title: 'Rhythm notifications',
        body: 'Agent completion and question alerts are enabled.',
      });
      agentNotificationPermissionPrimer = primer;
      primer.once('show', () => {
        if (agentNotificationPermissionPrimer !== primer) return;
        recordAgentNotificationPermission('granted');
        agentNotificationPermissionPrimer = undefined;
      });
      primer.once('failed', (_event, error) => {
        if (agentNotificationPermissionPrimer !== primer) return;
        agentNotificationPermissionPrimer = undefined;
        recordAgentNotificationPermission(/permission|denied/i.test(String(error)) ? 'denied' : 'unknown');
      });
      primer.once('close', () => { if (agentNotificationPermissionPrimer === primer) agentNotificationPermissionPrimer = undefined; });
      primer.show();
    } catch (error) {
      agentNotificationPermissionPrimer = undefined;
      recordAgentNotificationPermission(/permission|denied/i.test(String(error)) ? 'denied' : 'unknown');
    }
  };
  const clearAgentNotifications = () => {
    agentReady = false;
    admissionTimes.length = 0;
    waitingLookups.length = 0;
    queuedAgentActivation = undefined;
    agentViewing = { sessionId: null, displayed: false };
    for (const entry of agentTargets.values()) {
      entry.valid = false;
      if (entry.retireTimer) clearTimeout(entry.retireTimer);
      try { entry.notification?.close(); } catch {}
    }
    agentTargets.clear();
    completionCycles.clear();
    retiredCompletions.clear();
  };
  /** @type {Promise<import('./google-oauth-core.mjs').DesktopAuthLoginResponse> | undefined} */
  let googleSignInInFlight;
  let authGeneration = 0;
  /** @type {import('./google-oauth-core.mjs').DesktopAuthLoginResponse['user'] | undefined} */
  let productionSessionUser;
  const clearStoredAuthentication = () => rm(authSessionPath, { force: true }).catch(() => undefined);
  const accountsAuth = createAccountsAuthState({
    safeStorage, loadEncrypted: () => readFile(authSessionPath),
    saveEncrypted: async (bytes) => { await mkdir(dirname(authSessionPath), { recursive: true }); await writeFile(authSessionPath, bytes, { mode: 0o600 }); },
    clearEncrypted: clearStoredAuthentication,
    // Reuse the existing main session policy: successful OAuth or a validated
    // encrypted offline envelope. Accounts does not add a network login gate.
    validateSession: (session) => session.serverOrigin === productionApiBase && session.sessionToken === productionSessionToken && session.userId === String(productionSessionUser?.id),
  });
  /** @type {ReturnType<typeof createHermesAccountsMain> | undefined} */
  let accountsMain;
  /** @type {string | undefined} */
  let accountsHermesHome;
  let accountsBlocked = false;
  let accountsTransition = Promise.resolve();
  /** @type {AgentServerService | undefined} */
  let agentServer;
  const bridgeHost = createAgentBridgeHost({
    getRegistrar: () => agentServer?.bridgeRegistrar?.(),
    getSessionToken: () => productionSessionToken,
    getMemoryConsent: async (identity) => {
      const auth = accountsAuth.getSnapshot();
      const memorySearchConsent = /** @type {any} */ (accountsMain)?.memorySearchConsent;
      const consent = await memorySearchConsent?.({
        ...identity,
        rhythmUserId: auth.userId,
        hermesHome: accountsHermesHome,
      });
      if (consent === true) return { granted: true, memoryVaultId: identity.memoryVaultId };
      if (consent && typeof consent === 'object') return consent;
      return { granted: false };
    },
    confirmNative: async (summary) => {
      const win = mainWindow;
      if (!win || win.isDestroyed()) return false;
      const detail = summary.fields.map((field) => `${field.name}: ${String(field.before)} → ${String(field.after)}`).join('\n');
      const result = await dialog.showMessageBox(win, {
        type: 'question', buttons: ['Apply', 'Reject'], defaultId: 1, cancelId: 1,
        title: 'Confirm shared agent change',
        message: `Allow changes to ${summary.agentLabel} (${summary.agentId})?`,
        detail,
      });
      return result.response === 0;
    },
    log: (entry) => process.stderr.write(`agent bridge: ${entry.code}\n`),
  });
  const getAccountsMain = () => {
    if (accountsBlocked || !accountsAuth.getSnapshot().authenticated) return undefined;
    if (accountsMain) return accountsMain;
    try {
      const osHome = realpathSync(userInfo().homedir);
      const hermesHome = realpathSync(resolve(osHome, '.hermes'));
      accountsHermesHome = hermesHome;
      accountsMain = createHermesAccountsMain({ osHome, hermesHome,
        grantsPath: resolve(app.getPath('userData'), 'hermes-credential-grants.json'),
        getAuthState: () => accountsAuth.getSnapshot(),
        getDocumentState: () => ({ contents: mainWindow?.webContents, frame: mainWindow?.webContents.mainFrame,
          url: mainWindow?.webContents.mainFrame.url, epoch: accountsAuth.getSnapshot().documentEpoch }),
        confirmNative: async (mutation) => {
          const win = mainWindow;
          if (!win || win.isDestroyed()) return false;
          const result = await dialog.showMessageBox(win, { type: 'question', buttons: ['Confirm', 'Cancel'], defaultId: 1, cancelId: 1,
            title: 'Hermes account sharing', message: `${mutation.action === 'enable' ? 'Share' : 'Stop sharing'} the ${mutation.provider} API key with Hermes?`,
            detail: 'Applies to the next Hermes backend start. Existing running work may retain a previously shared key until it stops.' });
          return result.response === 0;
        },
        disposeOwnedBackend: () => hermesView.disposeCurrent(),
        bridgeHost,
      });
    } catch { return undefined; }
    return accountsMain;
  };
  const credentialHostOptions = () => {
    if (accountsBlocked) throw new Error('Previous Hermes backend disposal has not completed');
    const adapter = getAccountsMain(), auth = accountsAuth.getSnapshot();
    if (!adapter || !auth.authenticated) return undefined;
    /** @type {ReturnType<typeof adapter.createBackendAttempt> | undefined} */
    let attempt;
    /** @type {string | undefined} */
    let attemptId;
    return {
      hermesHome: accountsHermesHome,
      backendEnvContext: Object.freeze({ serverOrigin: auth.serverOrigin, rhythmUserId: auth.userId, authGeneration: auth.authGeneration }),
      backendEnv: async (/** @type {any} */ request) => {
        const accountEnvironment = await (attempt?.backendEnv(request) ?? Promise.resolve({}));
        if (!attempt || !attemptId) return accountEnvironment;
        return { ...accountEnvironment, ...bridgeHost.mintForAttempt({
          attemptId,
          profile: request.profile,
          serverOrigin: String(auth.serverOrigin ?? ''),
          authGeneration: String(auth.authGeneration ?? ''),
        }) };
      },
      onOwnedBackendAttempt: (/** @type {any} */ event) => {
        if (event.phase === 'starting') {
          if (attempt || accountsBlocked || accountsAuth.getSnapshot().authGeneration !== auth.authGeneration) throw new Error('Stale credential attempt denied');
          attemptId = event.attemptId;
          attempt = adapter.createBackendAttempt({ attemptId: event.attemptId, profile: event.profile });
          return;
        }
        const accepted = event.attemptId === attemptId && attempt?.record({ phase: event.phase === 'accepted' ? 'spawned' : event.cause === 'exited' ? 'exited' : 'failed', owned: true, acceptedEnvNames: event.acceptedEnvNames });
        if (event.phase === 'accepted' && !accepted) throw new Error('Invalid credential spawn receipt');
        if (event.phase === 'retired') void bridgeHost.retire(event.attemptId).catch(() => {});
        if (event.phase === 'retired' && event.attemptId === attemptId) attempt = undefined;
      },
    };
  };
  const persistAuthentication = async () => {
    if (!productionSessionToken || !productionSessionUser) return;
    await accountsAuth.signIn({ serverOrigin: productionApiBase, userId: String(productionSessionUser.id), sessionToken: productionSessionToken,
      envelope: { productionApiBase, sessionToken: productionSessionToken, user: productionSessionUser } });
  };
  const restoreAuthentication = async () => {
    if (isSmoke || !safeStorage.isEncryptionAvailable()) return;
    try {
      const stored = JSON.parse(safeStorage.decryptString(await readFile(authSessionPath)));
      if (stored.productionApiBase !== productionApiBase || typeof stored.sessionToken !== 'string' || !stored.user || typeof stored.user.id !== 'number') throw new Error('invalid stored session');
      productionSessionToken = stored.sessionToken; productionSessionUser = stored.user;
      await accountsAuth.restore({ serverOrigin: productionApiBase });
    } catch { await clearStoredAuthentication(); }
  };
  let changingServer = false;
  app.on('window-all-closed', () => { if (!changingServer) app.quit(); });
  /** @type {(() => Promise<void>) | undefined} */
  let rebuildMainWindow;
  const invalidateAuthentication = () => {
    accountsBlocked = true;
    const authInvalidation = accountsAuth.invalidate();
    const brokerInvalidation = accountsMain?.identityChanged();
    const previous = accountsTransition;
    accountsTransition = Promise.all([previous, authInvalidation, brokerInvalidation, bridgeHost.revokeAll(), hermesView.disposeCurrent(), colonyHost?.invalidateProfile()]).then(() => { accountsBlocked = false; });
    void accountsTransition.catch(() => {});
    authGeneration += 1;
    clearAgentNotifications();
    googleSignInInFlight = undefined;
    productionSessionToken = undefined;
    productionSessionUser = undefined;
    rendererReady = false;
    pendingNativeNotificationActivations.length = 0;
    for (const notification of nativeNotificationRegistry.values()) notification.close();
    nativeNotificationRegistry.clear();
  };
  /** @param {Electron.IpcMainEvent | Electron.IpcMainInvokeEvent} event */
  const ownsDocument = (event) => {
    const contents = mainWindow?.webContents;
    return Boolean(contents && !contents.isDestroyed() && event.sender === contents
      && event.senderFrame && event.senderFrame === contents.mainFrame
      && /^rhythm:\/\/app\/index\.html(?:#.*)?$/.test(event.senderFrame.url));
  };
  /** @param {Electron.IpcMainEvent | Electron.IpcMainInvokeEvent} event */
  const requireOwnedDocument = (event) => {
    if (!ownsDocument(event)) throw new Error('Privileged IPC denied');
  };
  /** @param {unknown[]} args */
  const requireNoPayload = (args) => {
    if (args.length) throw new Error('Invalid IPC payload');
  };
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
      const generation = authGeneration;
      notification.on('click', () => {
        if (generation !== authGeneration || nativeNotificationRegistry.get(target.approvalId) !== notification) return;
        routeNativeNotificationActivation(target);
      });
      // Dismissal/OS expiry is not resolution: retain the pending ID so another
      // snapshot cannot re-show (and re-sound) it. Reconciliation/auth reset clears it.
      nativeNotificationRegistry.set(target.approvalId, notification);
      notification.show();
    }
  };

  /** @param {unknown} value @returns {{ v: 1, type: 'ready' | 'viewing' | 'arm' | 'completion' | 'ask' | 'resolve', family?: 'permission' | 'question', sessionId?: string | null, requestId?: string, displayed?: boolean } | null} */
  const agentEvent = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const item = /** @type {Record<string, unknown>} */ (value);
    try { if (JSON.stringify(value).length >= 2048) return null; } catch { return null; }
    if (item.v !== 1) return null;
    const keys = Object.keys(item).sort().join(',');
    if (item.type === 'ready' && keys === 'type,v') return { v: 1, type: 'ready' };
    if (item.type === 'viewing' && keys === 'displayed,sessionId,type,v' && typeof item.displayed === 'boolean' && (item.sessionId === null || safeNotificationId(item.sessionId))) return { v: 1, type: 'viewing', displayed: item.displayed, sessionId: /** @type {string | null} */ (item.sessionId) };
    if (item.type === 'arm' && keys === 'sessionId,type,v' && safeNotificationId(item.sessionId)) return { v: 1, type: 'arm', sessionId: /** @type {string} */ (item.sessionId) };
    if (item.type === 'completion' && keys === 'sessionId,type,v' && safeNotificationId(item.sessionId)) return { v: 1, type: 'completion', sessionId: /** @type {string} */ (item.sessionId) };
    if ((item.type === 'ask' || item.type === 'resolve') && keys === 'family,requestId,sessionId,type,v' && (item.family === 'permission' || item.family === 'question') && safeNotificationId(item.sessionId) && safeNotificationId(item.requestId)) return { v: 1, type: item.type, family: item.family, sessionId: /** @type {string} */ (item.sessionId), requestId: /** @type {string} */ (item.requestId) };
    return null;
  };
  /** @param {AgentTarget} entry */
  const isAgentEntry = (entry) => Boolean(entry.valid && entry.generation === authGeneration && agentTargets.get(entry.key) === entry && mainWindow && !mainWindow.isDestroyed());
  /** @param {AgentTarget} entry @param {boolean} [recordWithdrawal] */
  const withdrawAgentEntry = (entry, recordWithdrawal = false) => {
    entry.valid = false;
    if (entry.retireTimer) { clearTimeout(entry.retireTimer); entry.retireTimer = undefined; }
    if (entry.queued) {
      const index = waitingLookups.indexOf(entry);
      if (index !== -1) waitingLookups.splice(index, 1);
      entry.queued = false;
    }
    if (queuedAgentActivation === entry) queuedAgentActivation = undefined;
    const notification = entry.notification;
    try { notification?.close(); } catch {}
    entry.notification = undefined;
    if (recordWithdrawal && notification) recordAgentNotificationReceipt({ event: 'withdraw' });
  };
  /** @param {AgentTarget} entry @param {boolean} [close] */
  const retireCompletionEntry = (entry, close = false) => {
    if (entry.family || (!entry.valid && agentTargets.get(entry.key) !== entry)) return;
    entry.valid = false;
    if (entry.retireTimer) { clearTimeout(entry.retireTimer); entry.retireTimer = undefined; }
    if (entry.queued) {
      const index = waitingLookups.indexOf(entry);
      if (index !== -1) waitingLookups.splice(index, 1);
      entry.queued = false;
    }
    if (queuedAgentActivation === entry) queuedAgentActivation = undefined;
    const notification = entry.notification;
    entry.notification = undefined;
    if (agentTargets.get(entry.key) === entry) agentTargets.delete(entry.key);
    retiredCompletions.set(entry.key, Date.now());
    if (close) { try { notification?.close(); } catch {} }
  };
  /** @param {AgentTarget} entry */
  const activateAgentEntry = (entry) => {
    if (!isAgentEntry(entry) || !entry.notification || !mainWindow) return false;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show(); mainWindow.focus();
    if (!agentReady) { queuedAgentActivation = entry; return false; }
    const url = new URL('rhythm://app/index.html');
    url.hash = `/agents?sessionId=${encodeURIComponent(entry.sessionId)}&activation=${++activationSequence}`;
    void mainWindow.loadURL(url.toString());
    return true;
  };
  /** @param {AgentTarget} entry @param {string} title @param {string} body */
  const showAgentEntry = (entry, title, body) => {
    if (!isAgentEntry(entry) || !mainWindow) return;
    try { if (!Notification.isSupported()) return; } catch { return; }
    if (entry.family && agentViewing.displayed && agentViewing.sessionId === entry.sessionId
      && mainWindow.isFocused() && mainWindow.isVisible() && !mainWindow.isMinimized()) {
      agentTargets.delete(entry.key); entry.valid = false; return;
    }
    try {
      const notification = new Notification({ title, body });
      notification.on('click', () => {
        if (!isAgentEntry(entry) || entry.notification !== notification) return;
        const activated = activateAgentEntry(entry);
        if (!entry.family) {
          if (activated) retireCompletionEntry(entry);
          else entry.retireAfterActivation = true;
        }
      });
      if (!entry.family) {
        notification.on('close', () => {
          if (entry.retireAfterActivation && queuedAgentActivation === entry) return;
          retireCompletionEntry(entry);
        });
        const timer = setTimeout(() => retireCompletionEntry(entry, true), 300_000);
        timer.unref?.();
        entry.retireTimer = timer;
      }
      entry.notification = notification;
      notification.show();
      recordAgentNotificationReceipt({ event: 'show', family: entry.family ?? 'completion', sessionId: entry.sessionId });
    } catch {
      if (entry.family) withdrawAgentEntry(entry); else retireCompletionEntry(entry);
    }
  };
  /** @param {unknown} payload */
  const syncAgentNotifications = (payload) => {
    const event = agentEvent(payload);
    if (!event) return;
    if (event.type === 'ready') {
      agentReady = true;
      const entry = queuedAgentActivation;
      queuedAgentActivation = undefined;
      if (entry) {
        const activated = activateAgentEntry(entry);
        if (activated && entry.retireAfterActivation && !entry.family) retireCompletionEntry(entry);
      }
      return;
    }
    if (event.type === 'viewing') { agentViewing = { sessionId: event.sessionId ?? null, displayed: event.displayed === true }; return; }
    if (event.type === 'arm') {
      if (!event.sessionId) return;
      primeAgentNotificationPermission();
      completionCycles.set(event.sessionId, (completionCycles.get(event.sessionId) ?? 0) + 1);
      for (const entry of agentTargets.values()) {
        if (!entry.family && entry.sessionId === event.sessionId) retireCompletionEntry(entry, true);
      }
      return;
    }
    if (event.type === 'resolve') {
      if (!event.family || !event.sessionId || !event.requestId) return;
      const key = `${authGeneration}:${event.family}:${event.sessionId}:${event.requestId}`;
      const entry = agentTargets.get(key);
      if (entry) withdrawAgentEntry(entry, true); // Retain a tombstone: OS dismissal is not a fresh ask.
      else {
        const now = Date.now();
        for (const [oldKey, old] of agentTargets) if (!old.valid && now - old.created > 300_000) agentTargets.delete(oldKey);
        while (admissionTimes[0] < now - 60_000) admissionTimes.shift();
        if (admissionTimes.length >= 20) return;
        admissionTimes.push(now);
        if (agentTargets.size >= 100) return;
        agentTargets.set(key, { key, sessionId: event.sessionId, family: event.family, generation: authGeneration, valid: false, created: Date.now() });
      }
      return;
    }
    if (!productionSessionToken?.trim() || !event.sessionId) return;
    const key = event.type === 'completion'
      ? `${authGeneration}:completion:${event.sessionId}:${completionCycles.get(event.sessionId) ?? 0}`
      : `${authGeneration}:${event.family}:${event.sessionId}:${event.requestId}`;
    if (event.type === 'ask' && agentTargets.has(key)) return;
    const now = Date.now();
    for (const [oldKey, retiredAt] of retiredCompletions) if (now - retiredAt > 300_000) retiredCompletions.delete(oldKey);
    if (event.type === 'completion' && (agentTargets.has(key) || retiredCompletions.has(key))) return;
    // Only tombstones expire; live/queued entries remain pending until resolution or invalidation.
    for (const [oldKey, old] of agentTargets) if (!old.valid && now - old.created > 300_000) agentTargets.delete(oldKey);
    while (admissionTimes[0] < now - 60_000) admissionTimes.shift();
    if (admissionTimes.length >= 20) return;
    admissionTimes.push(now);
    while (agentTargets.size >= 100) {
      const tombstone = [...agentTargets].find(([, value]) => !value.valid);
      if (!tombstone) return; // Never evict a visible or pending ask to accept a new one.
      agentTargets.delete(tombstone[0]);
    }
    /** @type {AgentTarget} */
    const entry = { key, family: event.family, sessionId: event.sessionId, generation: authGeneration, created: now, valid: true, notification: undefined };
    agentTargets.set(key, entry); // Reserve before the asynchronous ownership lookup.
    if (activeLookups >= 4) { entry.queued = true; waitingLookups.push(entry); return; }
    startAgentLookup(entry);
  };
  /** @param {AgentTarget} entry */
  const startAgentLookup = (entry) => {
    if (!isAgentEntry(entry)) return;
    entry.queued = false;
    activeLookups++;
    // ponytail: signed-in main is the local gate; the localhost API route is an existence check,
    // not a cloud ownership proof. Never forward a hosted bearer to the local server.
    const apiBase = process.env.RHYTHM_LIVE_API_URL ?? AGENT_SERVER_BASE_URL;
    let localApi;
    try {
      localApi = new URL(apiBase);
      if (localApi.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(localApi.hostname)
        || localApi.username || localApi.password || !['', '/'].includes(localApi.pathname)
        || localApi.search || localApi.hash) throw new Error('Local API required');
    } catch {
      withdrawAgentEntry(entry);
      activeLookups--;
      return;
    }
    void globalThis.fetch(`${localApi.origin}/agent-sessions/${encodeURIComponent(entry.sessionId)}?transcriptLimit=0`, {
      redirect: 'error', signal: AbortSignal.timeout(1500),
    }).then(async (response) => {
      if (!isAgentEntry(entry) || !response.ok || Number(response.headers.get('content-length') ?? 0) > 65536) {
        await response.body?.cancel(); withdrawAgentEntry(entry); return;
      }
      const reader = response.body?.getReader();
      if (!reader) { withdrawAgentEntry(entry); return; }
      const chunks = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 65536 || !isAgentEntry(entry)) { await reader.cancel(); withdrawAgentEntry(entry); return; }
        chunks.push(value);
      }
      const text = new TextDecoder().decode(Buffer.concat(chunks));
      if (text.length > 65536 || !isAgentEntry(entry)) { withdrawAgentEntry(entry); return; }
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.messages) || !data.transcriptPage || Array.isArray(data.transcriptPage)
        || typeof data.transcriptPage !== 'object' || typeof data.transcriptPage.hasMore !== 'boolean'
        || !(data.transcriptPage.nextCursor === null || typeof data.transcriptPage.nextCursor === 'string')
        || data.session?.id !== entry.sessionId) { withdrawAgentEntry(entry); return; }
      const name = typeof data.session.name === 'string' ? Array.from(data.session.name.replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim()).slice(0, 60).join('') : '';
      if (!entry.family) showAgentEntry(entry, 'Agent finished', 'Your agent has finished working.');
      else {
        const title = `${name || 'Agent session'} — ${entry.family === 'permission' ? 'Permission requested' : 'Question'}`;
        showAgentEntry(entry, title, entry.family === 'permission' ? 'An agent is waiting for your permission.' : 'An agent is waiting for your answer.');
      }
    }).catch(() => { withdrawAgentEntry(entry); }).finally(() => {
      activeLookups--;
      while (activeLookups < 4 && waitingLookups.length) {
        const next = waitingLookups.shift();
        if (next && isAgentEntry(next)) startAgentLookup(next);
      }
    });
  };
  ipcMain.on('rhythm:agent-notifications:sync', (event, payload, ...args) => {
    if (!args.length && ownsDocument(event)) syncAgentNotifications(payload);
  });

  ipcMain.on('rhythm:approval-notifications:sync', (event, payload) => {
    if (!ownsDocument(event)) return;
    syncNativeApprovalNotifications(payload);
  });

  ipcMain.handle('rhythm:ai-accounts:status', (event, ...args) => {
    const adapter = getAccountsMain();
    return adapter ? adapter.getStatus(event, ...args) : { version: 1, availability: 'unavailable', childMayRetainCredential: accountsBlocked, memory: { state: 'disabled' } };
  });
  ipcMain.handle('rhythm:ai-accounts:set-grant', (event, payload, ...args) => {
    const adapter = getAccountsMain();
    return adapter ? adapter.setGrant(event, payload, ...args) : { accepted: false };
  });
  ipcMain.handle('rhythm:ai-accounts:set-memory-consent', (event, payload, ...args) => {
    const adapter = getAccountsMain();
    return adapter ? adapter.setMemorySearchConsent(event, payload, ...args) : { accepted: false };
  });

  ipcMain.handle('rhythm:auth:google-sign-in', (event, ...args) => {
    requireOwnedDocument(event);
    requireNoPayload(args);
    // No account-replacement API yet: never silently replace an authenticated renderer's identity.
    if (accountsBlocked) throw new Error('Previous Hermes backend disposal has not completed');
    if (productionSessionToken) throw new Error('Account replacement denied; restart to sign in again');
    if (!googleSignInInFlight) {
      const generation = authGeneration;
      googleSignInInFlight = runDesktopGoogleOAuth({
        clientId: resolveGoogleDesktopClientId(GOOGLE_DESKTOP_CLIENT_ID),
        apiBase: productionApiBase,
        openExternal: (url) => shell.openExternal(url),
        fetcher: (url, init) => globalThis.fetch(String(url), init),
      }).then(async (login) => {
        if (generation !== authGeneration || !ownsDocument(event)) throw new Error('Sign-in context changed; stale login discarded');
        // Main owns the token and persists it only through Electron safeStorage; it never enters a
        // URL, renderer DOM attribute, log, or plaintext file.
        productionSessionToken = login.sessionToken;
        productionSessionUser = login.user;
        await persistAuthentication();
        await colonyHost?.activateProfile({ productionApiBase, userId: String(login.user.id) });
        return login;
      }).finally(() => { if (generation === authGeneration) googleSignInInFlight = undefined; });
    }
    return googleSignInInFlight;
  });
  // Preload runs in a separate sandboxed process whose inherited environment is fixed before this
  // module loads persisted configuration. Read the validated current value from main instead of
  // assuming a later process.env mutation crosses that boundary.
  ipcMain.on('rhythm:production-api:get', (event, ...args) => {
    if (!ownsDocument(event) || args.length) return;
    event.returnValue = productionApiBase;
  });
  const setProductionApi = createProductionApiSetHandler({
    allowedSender: () => mainWindow?.webContents,
    save: async (value) => {
      if (value === productionApiBase) return productionApiBase;
      if (!rebuildMainWindow) throw new Error('Production API update denied before window ready');
      changingServer = true;
      invalidateAuthentication();
      const hermesDispose = accountsTransition;
      // Destroy, not a renderer notification: no old gateway, bearer or pending callback survives.
      mainWindow?.destroy();
      mainWindow = undefined;
      try {
        await hermesDispose;
        const serverUrl = await productionApiConfig.save(value);
        productionApiBase = serverUrl;
        process.env.RHYTHM_PRODUCTION_API_URL = serverUrl;
        return serverUrl;
      } finally {
        // Even a failed save returns to the previous server signed out, with fresh preload config.
        try { await rebuildMainWindow(); }
        finally { changingServer = false; }
      }
    },
  });
  ipcMain.handle('rhythm:production-api:set', (event, value, ...args) => {
    requireOwnedDocument(event);
    if (args.length || typeof value !== 'string' || value.length > 2048) throw new Error('Invalid production API URL payload');
    return setProductionApi(event, value);
  });
  ipcMain.handle('rhythm:auth:current-session', (event, ...args) => {
    requireOwnedDocument(event); requireNoPayload(args);
    return productionSessionToken && productionSessionUser ? { sessionToken: productionSessionToken, user: productionSessionUser } : null;
  });
  ipcMain.handle('rhythm:auth:logout', async (event, ...args) => {
    requireOwnedDocument(event); requireNoPayload(args);
    invalidateAuthentication(); await accountsTransition;
    if (rebuildMainWindow) { mainWindow?.destroy(); mainWindow = undefined; await rebuildMainWindow(); }
  });
  ipcMain.handle('rhythm:updates:open-download', async (event, ...args) => {
    requireOwnedDocument(event); requireNoPayload(args);
    await shell.openExternal('https://github.com/ajhochy/Rhythm/releases');
  });
  ipcMain.handle('shell:select-directory', async (event, ...args) => {
    requireOwnedDocument(event); requireNoPayload(args);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) throw new Error('Directory picker owner unavailable');
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    requireOwnedDocument(event);
    return canceled || !filePaths[0] ? null : String(filePaths[0]);
  });

  // Mirrors apps/desktop_flutter/lib/app/core/server/api_server_service.dart +
  // agent_server_controller.dart: THIS process spawns and owns the local api_server, the same way
  // Flutter's Dart code does, instead of assuming some other process (tools/dev/sandbox.sh, a
  // developer's own terminal) already has one running. Production always pins these bases to the
  // canonical 4001/4096 boundary: healthy Rhythm services are reused without ownership.
  // Alternate ports exist only behind an explicit smoke-only flag.
  // Interactive smoke renders normally, but the manager owns the external sandbox lifecycle.
  agentServer = isInteractiveSmoke ? undefined : new AgentServerService({
    relayConfigurationProvider: () => ({ token: productionSessionToken, productionApiBase }),
  });
  const isHermesSelfTest = isSmoke || isMissingDistSmoke;
  /** @param {string} text */
  const writeHermesLog = (text) => process.stdout?.write?.(text.endsWith('\n') ? text : `${text}\n`);
  const hermes = createHermesSupervisor({
    env: process.env,
    installLogPath: resolve(app.getPath('userData'), 'hermes-install.log'),
    log: writeHermesLog,
    showConsent: (options) => dialog.showMessageBox(options),
  });
  bindHermesViewSupervisor(hermes);
  for (const [channel, action] of /** @type {const} */ ([
    ['hermes:get-status', () => hermes.getStatus()],
    // The legacy dashboard supervisor remains a status compatibility seam only.
    // Embedded Desktop owns its own supported backend lifecycle, so shell IPC
    // cannot start a second dashboard service.
    ['hermes:install', () => hermes.getStatus()],
    ['hermes:restart', () => hermes.getStatus()],
  ])) {
    ipcMain.handle(channel, (event, ...args) => {
      requireOwnedDocument(event); requireNoPayload(args);
      return action();
    });
  }
  hermes.onStatus((snapshot) => {
    const reason = snapshot.reason?.split(/\r?\n/, 1)[0];
    writeHermesLog(`hermes: ${snapshot.state}${reason ? ` ${reason}` : ''}`);
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('hermes:status', snapshot);
    }
  });
  const externalRuntimeStatus = { status: 'stopped', ownership: 'none', owned: false, failureReason: null, stderrTail: null, errorMessage: null };
  if (!allowTestRuntimePorts) {
    process.env.RHYTHM_LIVE_API_URL = AGENT_SERVER_BASE_URL;
    process.env.RHYTHM_LIVE_ENGINE_URL = `http://127.0.0.1:${AGENT_SERVER_ENGINE_PORT}`;
  }

  ipcMain.handle('rhythm:agent-server:status', () => agentServer?.status ?? externalRuntimeStatus);
  let shuttingDown = false;
  let intentionalAgentServerRestart = false;
  ipcMain.handle('rhythm:agent-server:restart', async (event, ...args) => {
    requireOwnedDocument(event); requireNoPayload(args);
    if (shuttingDown) return { ok: false, reason: 'shutting_down', code: 'shutting_down' };
    if (!agentServer) return { ok: false, reason: 'runtime_unowned', code: 'runtime_unowned' };
    intentionalAgentServerRestart = true;
    try {
      return await agentServer.restart();
    } finally {
      intentionalAgentServerRestart = false;
    }
  });
  ipcMain.handle('rhythm:human-approval:capability', (event, ...args) => {
    requireOwnedDocument(event);
    requireNoPayload(args);
    return humanApprovalSigner.capability();
  });
  ipcMain.handle('rhythm:human-approval:sign-decision', async (event, decision, ...args) => {
    requireOwnedDocument(event);
    if (args.length || !decision || typeof decision !== 'object' || Array.isArray(decision)
      || Object.keys(decision).length !== 4
      || !['approvalId', 'status', 'decisionNonce', 'payloadDigest'].every((key) => Object.hasOwn(decision, key))
      || !safeNotificationId(decision.approvalId)
      || !['approved', 'rejected'].includes(decision.status)
      || typeof decision.decisionNonce !== 'string' || !/^[a-zA-Z0-9_-]{1,256}$/.test(decision.decisionNonce)
      || (decision.payloadDigest !== null && (typeof decision.payloadDigest !== 'string' || !/^[a-f0-9]{64}$/.test(decision.payloadDigest)))) {
      throw new Error('Invalid signing payload');
    }
    const generation = authGeneration;
    const signature = await humanApprovalSigner.signDecision(decision);
    if (generation !== authGeneration || !ownsDocument(event)) throw new Error('Signing context changed');
    cancelNativeNotification(decision.approvalId);
    return signature;
  });
  agentServer?.onStatusChange((/** @type {import('./agent-server.mjs').AgentServerStatus} */ snapshot) => {
    if (snapshot.status === 'ready') void bridgeHost.onRegistrarReady().catch(() => {});
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('rhythm:agent-server:status-changed', snapshot);
    // ponytail: native error dialog keeps failures actionable without expanding E12's renderer UI.
    if (!isSmoke && !intentionalAgentServerRestart && snapshot.status === 'failed') {
      void dialog.showMessageBox({ type: 'error', title: 'Rhythm local runtime unavailable',
        message: snapshot.errorMessage ?? 'Rhythm could not start its local runtime.',
        buttons: ['Retry', 'Close'], defaultId: 0, cancelId: 1,
      }).then(({ response }) => {
        if (response === 0 && !shuttingDown) void agentServer?.start();
      });
    }
  });

  // api_server_service.dart:134-151's exact shutdown sequence (SIGTERM, race a 2s timer against
  // real exit, SIGKILL if still alive), triggered from the same three places Flutter triggers it:
  // normal app quit, and OS SIGINT/SIGTERM (main.dart:182-192; SIGTERM is skipped on Windows there
  // because it isn't catchable — not a concern here since this Electron build targets macOS only).
  const stopRuntimes = async () => { await Promise.all([agentServer?.stopForQuit(), hermes.stop(), hermesView.dispose(), colonyHost?.dispose()]); };
  app.on('before-quit', (event) => {
    if (isHermesSelfTest || shuttingDown) return;
    shuttingDown = true;
    event.preventDefault();
    void stopRuntimes().catch((error) => process.stderr.write(`Runtime shutdown failed: ${error}\n`)).finally(() => app.quit());
  });
  if (!isHermesSelfTest) {
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.on(signal, () => { shuttingDown = true; void stopRuntimes().then(() => process.exit(0), (error) => { process.stderr.write(`Runtime shutdown failed: ${error}\n`); process.exit(1); }); });
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
    await restoreAuthentication();
    colonyHost = registerColonyHost({ ipcMain, getWindow: () => mainWindow, userDataPath: app.getPath('userData'), resourcesPath: process.resourcesPath,
      home: userInfo().homedir, isPackaged: app.isPackaged, environment: process.env, app, shell, dialog,
      emitReset: () => mainWindow?.webContents.send('colony:host:reset') });
    if (productionSessionUser) await colonyHost.activateProfile({ productionApiBase, userId: String(productionSessionUser.id) });
    if (!isSmoke && agentServer && !existsSync(electronDbPath()) && existsSync(legacyFlutterDbPath())) {
      const choice = await dialog.showMessageBox({ type: 'question', title: 'Import existing Rhythm data?', message: 'Rhythm found data from the Flutter desktop app.', detail: 'Import copies the database into Electron using SQLite backup. The original remains untouched. Imported schedules start disabled for review.', buttons: ['Import existing data', 'Start fresh', 'Cancel'], defaultId: 0, cancelId: 2 });
      if (choice.response === 2) { app.quit(); return; }
      process.env.RHYTHM_ELECTRON_MIGRATE_LEGACY = choice.response === 0 ? '1' : '0';
    }

    // Initial workspace requests must not race local API startup and cache connection errors.
    if (!isSmoke && agentServer) await agentServer.start().catch((error) => agentServer.reportStartupFailure(error));
    // Hermes Desktop's embedded host owns compatible backend discovery and any
    // service it starts. Do not also launch the legacy dashboard supervisor.

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
                window.__rhythmHostResponse = function(payload) {
                  parent.postMessage({ __artifactSmoke: true, bridge: payload }, '*');
                  setTimeout(function() { location.href = 'rhythm-artifact://app/00000000-0000-4000-8000-000000000802'; }, 0);
                };
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
    /** @type {((blocked: boolean) => void) | undefined} */
    let resolveArtifactNavigationDenied;
    const artifactNavigationDenied = isArtifactFrameSmoke
      ? new Promise((resolvePromise) => { resolveArtifactNavigationDenied = resolvePromise; })
      : undefined;
    /** @param {Electron.WebContents | null} webContents @param {string} permission */
    const allowOwnedClipboardWrite = (webContents, permission) =>
      permission === 'clipboard-sanitized-write' && !!webContents && webContents === mainWindow?.webContents
        && !webContents.isDestroyed() && /^rhythm:\/\/app\/index\.html(?:#.*)?$/.test(webContents.mainFrame?.url ?? '');
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      const allowed = allowOwnedClipboardWrite(webContents, permission);
      if (!allowed) denials.permission = true;
      callback(allowed);
    });
    session.defaultSession.setPermissionCheckHandler?.((webContents, permission) => allowOwnedClipboardWrite(webContents, permission));
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

    rebuildMainWindow = async () => {
    const window = new BrowserWindow({
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
    mainWindow = window;
    window.webContents.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace && rendererReady) {
        if (/^rhythm:\/\/app\/index\.html(?:#.*)?$/.test(url)) {
          // Revoke pending work from the old document, but a trusted reload is not logout.
          authGeneration += 1;
          accountsAuth.documentChanged();
          clearAgentNotifications();
          googleSignInInFlight = undefined;
          rendererReady = false;
        } else invalidateAuthentication();
      }
    });
    window.webContents.on('will-navigate', (event) => {
      denials.navigation = true;
      event.preventDefault();
    });
    window.webContents.on('will-frame-navigate', (event) => {
      if (event.isMainFrame) return;
      const currentUrl = event.frame?.url;
      const targetUrl = event.url;
      const touchesArtifact = targetUrl.startsWith('rhythm-artifact:') || currentUrl?.startsWith('rhythm-artifact:');
      if (!touchesArtifact) return;
      if (typeof currentUrl !== 'string' || !isAllowedArtifactFrameNavigation(currentUrl, targetUrl)) {
        denials.navigation = true;
        resolveArtifactNavigationDenied?.(true);
        event.preventDefault();
      }
    });
    window.webContents.setWindowOpenHandler(() => {
      denials.popup = true;
      return { action: 'deny' };
    });
    window.webContents.on('did-finish-load', () => {
      rendererReady = true;
      if (agentNotificationPermissionPrimed) reportAgentNotificationPermission();
      window.webContents.send('rhythm:agent-server:status-changed', agentServer?.status ?? externalRuntimeStatus);
      window.webContents.send('hermes:status', hermes.getStatus());
      for (const activation of pendingNativeNotificationActivations.splice(0)) {
        routeNativeNotificationActivation(activation);
      }
    });
    window.on?.('closed', () => { if (mainWindow === window) clearAgentNotifications(); });
    await window.loadURL(pendingDeepLink ?? 'rhythm://app/index.html#/agents');
    if (mainWindow !== window || window.isDestroyed()) return;
    pendingDeepLink = null;
    };
    const windowOptions = {
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
    };
    await rebuildMainWindow();
    // A renderer can synchronously request logout/server replacement during
    // its first load. The old load may have returned after a replacement was
    // already started, so it must not turn that normal lifecycle transition
    // into a fatal startup error.
    if (!mainWindow) return;

    if (isArtifactFrameSmoke) {
      const smokeWindow = mainWindow;
      artifactFrame = await smokeWindow.webContents.executeJavaScript(`new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Artifact frame smoke timed out')), 10_000);
        const frame = document.createElement('iframe');
        frame.id = 'rhythm-artifact-smoke-frame';
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
          const protocol = new URL(frame.src).protocol;
          clearTimeout(timer);
          window.removeEventListener('message', onMessage);
          resolve({ loaded: true, protocol, bridge: event.data.bridge });
        };
        window.addEventListener('message', onMessage);
        document.body.append(frame);
      })`).then(async (receipt) => {
        let denialTimeout;
        const navigationBlocked = await Promise.race([
          artifactNavigationDenied,
          new Promise((resolvePromise) => { denialTimeout = setTimeout(() => resolvePromise(false), 10_000); }),
        ]);
        clearTimeout(denialTimeout);
        await smokeWindow.webContents.executeJavaScript("document.getElementById('rhythm-artifact-smoke-frame')?.remove()");
        return { ...receipt, navigationBlocked, request: artifactFrameRequest };
      });
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
    hermes: {
      keys: Object.keys(window.rhythmShell?.hermes || {}),
      frozen: Object.isFrozen(window.rhythmShell?.hermes),
      enabled: window.rhythmShell?.hermes?.enabled,
    },
    hermesView: {
      keys: Object.keys(window.rhythmShell?.hermesView || {}),
      frozen: Object.isFrozen(window.rhythmShell?.hermesView),
    },
    colonyView: {
      keys: Object.keys(window.rhythmShell?.colonyView || {}),
      frozen: Object.isFrozen(window.rhythmShell?.colonyView),
    },
    aiAccounts: {
      keys: Object.keys(window.rhythmShell?.aiAccounts || {}),
      frozen: Object.isFrozen(window.rhythmShell?.aiAccounts),
    },
    agentServer: {
      keys: Object.keys(window.rhythmShell?.agentServer || {}),
      frozen: Object.isFrozen(window.rhythmShell?.agentServer),
    },
    updates: {
      keys: Object.keys(window.rhythmShell?.updates || {}),
      frozen: Object.isFrozen(window.rhythmShell?.updates),
    },
  nodeExposed: typeof process !== 'undefined' || typeof require !== 'undefined',
  value: { version: window.rhythmShell?.version }
})`);
    if (bridge?.hermes) bridge.hermes.status = await mainWindow.webContents.executeJavaScript('window.rhythmShell.hermes.getStatus()');
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
