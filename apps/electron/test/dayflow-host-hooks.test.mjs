// Dayflow's accepted helper dependency is loaded from this composed checkout;
// the artifact validator and command executor remain synthetic VM seams.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createContext, runInNewContext, SourceTextModule, SyntheticModule } from 'node:vm';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const localHelperPath = resolve(here, '../src/dayflow-desktop.mjs');
const helperPath = localHelperPath;
const helperSource = 'accepted local helper';
const expectedBundledCandidate = '/trusted/Resources/dayflow-desktop/Dayflow.app';
const expectedInstalledCandidate = '/trusted/home/Applications/Dayflow.app';
const tick = () => new Promise((resolveTick) => setImmediate(resolveTick));

/** @param {unknown} value */
const statusFields = (value) => ({
  status: value?.status,
  version: value?.version,
  build: value?.build,
  identifier: value?.identifier,
  code: value?.code,
});

async function loadOwnerHelper(context, validateArtifact) {
  const source = await readFile(helperPath, 'utf8');
  const helper = new SourceTextModule(source, { context, identifier: helperPath });
  await helper.link(async (name) => {
    assert.equal(name, './dayflow-desktop-artifact.mjs');
    return new SyntheticModule(['validateDayflowDesktopArtifact'], function () {
      this.setExport('validateDayflowDesktopArtifact', validateArtifact);
    }, { context });
  });
  await helper.evaluate();
  return helper;
}

/**
 * Runs the real main registration in an isolated VM. Electron, the command
 * executor, and the still-pending helper artifact validator are synthetic; no
 * native app, path, or macOS tool is touched.
 */
async function hostRuntime({
  platform = 'darwin',
  installedApp = 'absent',
  invalidBundledArtifact = false,
  invalidInstalledArtifact = false,
} = {}) {
  const handlers = new Map();
  const commandCalls = [];
  const presenceCalls = [];
  const validationCalls = [];
  const windows = [];
  const paths = new Map();
  const adapterCalls = [];
  const openDesignCalls = { disposeCurrent: 0, dispose: 0 };
  const hermesAdapter = { disposeCurrent: async () => {}, dispose: async () => {} };
  const colonyAdapter = { activateProfile: async () => {}, invalidateProfile: async () => {}, dispose: async () => {} };
  const openDesignAdapter = {
    disposeCurrent: async () => { openDesignCalls.disposeCurrent += 1; },
    dispose: async () => { openDesignCalls.dispose += 1; },
  };
  const openDesignOptions = [];
  let authenticated = false;
  const accountsAuth = {
    getSnapshot: () => ({ authenticated }),
    invalidate: async () => { authenticated = false; },
    signIn: async () => {},
    restore: async () => {},
    documentChanged() {},
  };
  const validateArtifact = async ({ appRoot, targetArch, execute }) => {
    validationCalls.push({ appRoot, targetArch, execute });
    if ((appRoot === expectedBundledCandidate && invalidBundledArtifact)
      || (appRoot === expectedInstalledCandidate && invalidInstalledArtifact)) {
      throw new Error('synthetic invalid artifact');
    }
    return {
      root: appRoot,
      version: '2.6.0',
      build: '133',
      identifier: 'teleportlabs.com.Dayflow',
    };
  };
  const app = Object.assign(new EventEmitter(), {
    isPackaged: true,
    setPath: (key, value) => paths.set(key, value),
    getPath: (key) => key === 'home' ? '/trusted/home' : paths.get(key) ?? '/private/tmp/dayflow-host-hooks-user-data',
    requestSingleInstanceLock: () => true,
    isReady: () => false,
    whenReady: async () => {},
    getVersion: () => 'test',
    quit() {},
    exit() {},
  });
  class Window {
    constructor() {
      this.destroyed = false;
      this.webContents = Object.assign(new EventEmitter(), {
        mainFrame: { url: 'rhythm://app/index.html#/agents' },
        isDestroyed: () => this.destroyed,
        send() {},
        setWindowOpenHandler() {},
        executeJavaScript: async () => undefined,
      });
      windows.push(this);
    }
    static fromWebContents(contents) { return windows.find((window) => window.webContents === contents) ?? null; }
    static getAllWindows() { return windows; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
    async loadURL(url) {
      this.webContents.mainFrame = { url };
      this.webContents.emit('did-finish-load');
    }
  }
  const processBoundary = Object.assign(new EventEmitter(), {
    argv: ['--interactive-smoke', '--allow-test-runtime-ports'],
    env: { RHYTHM_SHELL_USER_DATA: '/private/tmp/dayflow-host-hooks-user-data' },
    resourcesPath: '/trusted/Resources',
    arch: 'arm64',
    platform,
    cwd: () => '/fixture',
    stderr: { write() {} },
  });
  const context = createContext({ process: processBoundary, URL, Response, console });
  const helper = await loadOwnerHelper(context, validateArtifact);
  const mainPath = resolve(here, '../src/main.mjs');
  const main = new SourceTextModule(await readFile(mainPath, 'utf8'), {
    context,
    identifier: mainPath,
    initializeImportMeta(meta) { meta.dirname = '/fixture'; },
  });
  const fakeExecFile = (command, args, options, callback) => {
    commandCalls.push({ command, args, options });
    callback(null, 'synthetic stdout', 'synthetic stderr');
  };
  const fakePromisify = (fn) => (...args) => new Promise((resolveResult, reject) => {
    fn(...args, (error, stdout, stderr) => error ? reject(error) : resolveResult({ stdout, stderr }));
  });
  await main.link(async (name) => {
    if (name === './dayflow-desktop.mjs') return helper;
    let values;
    if (name === 'electron') {
      values = {
        app,
        BrowserWindow: Window,
        ipcMain: { on() {}, handle: (channel, handler) => handlers.set(channel, handler) },
        net: {},
        Notification: { isSupported: () => false },
        protocol: { registerSchemesAsPrivileged() {}, handle() {} },
        safeStorage: { isEncryptionAvailable: () => false },
        session: { defaultSession: Object.assign(new EventEmitter(), { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} }) },
        shell: { openExternal: async () => {} },
        dialog: { showErrorBox() {}, showMessageBox: async () => ({ response: 1 }) },
      };
    } else if (name === 'node:child_process') values = { execFile: fakeExecFile };
    else if (name === 'node:util') values = { promisify: fakePromisify };
    else if (name === 'node:crypto') values = { createHash };
    else if (name === 'node:fs') values = {
      appendFileSync() {}, existsSync: () => true,
      lstatSync: (candidate) => {
        presenceCalls.push(candidate);
        assert.equal(candidate, expectedInstalledCandidate, 'Dayflow discovery may inspect only the fixed user-local candidate path');
        if (installedApp === 'absent' || installedApp === 'denied') {
          const error = new Error(installedApp === 'absent' ? 'synthetic missing app' : 'synthetic inaccessible app');
          error.code = installedApp === 'absent' ? 'ENOENT' : 'EACCES';
          throw error;
        }
        assert.equal(installedApp, 'present');
        return {};
      },
      mkdtempSync: () => '/private/tmp/dayflow-host-hooks-smoke',
      realpathSync: (value) => String(value), rmSync() {},
    };
    else if (name === 'node:fs/promises') values = {
      mkdir: async () => {},
      readFile: async () => { const error = new Error('missing synthetic auth record'); error.code = 'ENOENT'; throw error; },
      realpath: async (value) => String(value), rm: async () => {}, stat: async () => ({ isDirectory: () => false }), writeFile: async () => {},
    };
    else if (name === 'node:os') values = { tmpdir: () => '/private/tmp', userInfo: () => ({ homedir: '/fixture/home' }) };
    else if (name === 'node:path') values = { dirname, isAbsolute, resolve };
    else if (name === 'node:url') values = { pathToFileURL };
    else if (name === './agent-server.mjs') values = { AgentServerService: class {}, AGENT_SERVER_BASE_URL: 'http://127.0.0.1:4001', AGENT_SERVER_ENGINE_PORT: 4096, electronDbPath: () => '/fixture/electron.db', legacyFlutterDbPath: () => '/fixture/legacy.db' };
    else if (name === './artifact-frame-protocol.mjs') values = { injectArtifactFrameBridge: (value) => value, isAllowedArtifactFrameNavigation: () => false, parseArtifactFrameRequest: () => undefined };
    else if (name === './build-config.mjs') values = { GOOGLE_DESKTOP_CLIENT_ID: '', RHYTHM_AUTH_API_BASE: 'https://example.invalid' };
    else if (name === './desktop-google-oauth.mjs') values = { runDesktopGoogleOAuth: async () => { throw new Error('not exercised'); } };
    else if (name === './human-approval-main-signer.mjs') values = { capability: async () => '', signDecision: async () => ({}) };
    else if (name === './hermes-server.mjs') values = { createHermesSupervisor: () => ({ getStatus: () => ({ state: 'disabled' }), onStatus() {}, async start() {}, async stop() {} }) };
    else if (name === './policy.mjs') values = {
      createExternalOpenLimiter: () => () => true, deepLinkFromArgv: () => undefined, externalHttpUrl: (value) => typeof value === 'string' ? value : null,
      resolveAsset: () => undefined, validateRequest: () => false, webDist: '/fixture/web',
    };
    else if (name === './manual-workstreams-preference.mjs') values = { createManualWorkstreamsPreference: () => ({ load: () => false, save: async () => false }), manualWorkstreamsPreferenceStatus: () => ({}) };
    else if (name === './production-api-config.mjs') values = { createProductionApiConfig: () => ({ load: () => 'https://example.invalid' }), createProductionApiSetHandler: () => () => {} };
    else if (name === './runtime-config.mjs') values = { resolveGoogleDesktopClientId: () => '' };
    else if (name === './security-smoke-receipt.mjs') values = { validateSecuritySmokeReceipt: () => ({ ok: true }) };
    else if (name === './hermes-accounts-auth.mjs') values = { createAccountsAuthState: () => accountsAuth };
    else if (name === './hermes-accounts-main.mjs') values = { createHermesAccountsMain: () => undefined };
    else if (name === './hermes-agent-bridge.mjs') values = { createAgentBridgeHost: () => ({ revokeAll: async () => {}, onRegistrarReady: async () => {}, mintForAttempt: () => ({}) }) };
    else if (name === './hermes-view.mjs') values = { bindHermesViewSupervisor() {}, registerHermesView: () => hermesAdapter };
    else if (name === './hermes-desktop-updates.mjs') values = { installHermesDesktopUpdate: async () => ({}) };
    else if (name === './colony-host.mjs') values = { registerColonyHost: () => colonyAdapter };
    else if (name === './colony-smoke.mjs') values = { runColonySmoke: async () => ({}) };
    else if (name === './open-design-view.mjs') values = { registerOpenDesignView: (options) => { openDesignOptions.push(options); return openDesignAdapter; } };
    else if (name === './remote-environments.mjs') values = { createRemoteEnvironmentsCustody: () => ({ disconnect: async () => {} }), registerRemoteEnvironments() {} };
    else if (name === './rhythm-agent-tools.mjs') values = {
      createAgentToolAdapterRegistry: () => new Map(),
      registerAgentToolAdapter: (registry, id, adapter) => {
        registry.set(id, adapter);
        adapterCalls.push({ registry, id, adapter });
        return adapter;
      },
    };
    else throw new Error(`Unexpected main import: ${name}`);
    return new SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context });
  });
  await main.evaluate();
  for (let attempt = 0; attempt < 20 && windows.length === 0; attempt += 1) await tick();
  assert.equal(windows.length, 1, 'the synthetic normal window makes the existing ownsDocument policy available');
  const owner = windows[0];
  return {
    commandCalls,
    adapterCalls,
    handlers,
    helperSource,
    owner,
    openDesignAdapter,
    openDesignCalls,
    openDesignOptions,
    presenceCalls,
    validationCalls,
    app,
    setAuthenticated: (value) => { authenticated = value; },
    event: () => ({ sender: owner.webContents, senderFrame: owner.webContents.mainFrame }),
  };
}

async function preloadBridge(runtime) {
  let bridge;
  const invokes = [];
  runInNewContext(await readFile(resolve(here, '../src/preload.cjs'), 'utf8'), {
    require(name) {
      assert.equal(name, 'electron');
      return {
        contextBridge: { exposeInMainWorld: (key, value) => { assert.equal(key, 'rhythmShell'); bridge = value; } },
        ipcRenderer: {
          on() {}, removeListener() {}, send() {}, sendSync: () => 'https://example.invalid',
          invoke: async (channel, ...args) => {
            invokes.push([channel, ...args]);
            return runtime.handlers.get(channel)(runtime.event(), ...args);
          },
        },
      };
    },
    process: { argv: [], env: {}, platform: 'darwin' },
    window: { addEventListener() {}, dispatchEvent() {} },
  });
  return { bridge, invokes };
}

test('Dayflow host hooks use the accepted helper contract and select the fixed bundle only when the user-local app is absent', async () => {
  const runtime = await hostRuntime();
  assert.equal(runtime.helperSource, helperSource);
  assert.deepEqual([...runtime.handlers.keys()].filter((channel) => channel.startsWith('dayflow-desktop:')).sort(), [
    'dayflow-desktop:get-status',
    'dayflow-desktop:open',
  ]);
  assert.deepEqual(runtime.commandCalls, [], 'registration and normal startup must not launch Dayflow');
  assert.deepEqual(runtime.validationCalls, [], 'registration and normal startup must not probe Dayflow');
  assert.deepEqual(runtime.presenceCalls, [expectedInstalledCandidate]);

  const { bridge, invokes } = await preloadBridge(runtime);
  assert.equal(Object.isFrozen(bridge), true);
  assert.equal(Object.isFrozen(bridge.dayflowDesktop), true);
  assert.deepEqual(Object.keys(bridge.dayflowDesktop).sort(), ['getDayflowDesktopStatus', 'openDayflowDesktop']);

  const status = await bridge.dayflowDesktop.getDayflowDesktopStatus({ ignored: 'renderer argument' });
  assert.deepEqual(statusFields(status), {
    status: 'ready', version: '2.6.0', build: '133', identifier: 'teleportlabs.com.Dayflow', code: undefined,
  });
  assert.deepEqual(invokes, [['dayflow-desktop:get-status']]);
  assert.equal(runtime.validationCalls.length, 1);
  assert.equal(runtime.validationCalls[0].appRoot, expectedBundledCandidate);
  assert.equal(runtime.validationCalls[0].targetArch, 'arm64');
  assert.equal(runtime.commandCalls.length, 0, 'status may validate but must not open the app');

  const opened = await bridge.dayflowDesktop.openDayflowDesktop(undefined, 'ignored trailing argument');
  assert.deepEqual(statusFields(opened), {
    status: 'ready', version: '2.6.0', build: '133', identifier: 'teleportlabs.com.Dayflow', code: undefined,
  });
  assert.deepEqual(invokes, [['dayflow-desktop:get-status'], ['dayflow-desktop:open']]);
  assert.equal(runtime.validationCalls.length, 2, 'open revalidates the fixed candidate');
  assert.equal(runtime.commandCalls.length, 1);
  assert.equal(runtime.commandCalls[0].command, 'open');
  assert.deepEqual([...runtime.commandCalls[0].args], ['-a', expectedBundledCandidate]);
  assert.equal(runtime.commandCalls[0].options.shell, false);
});

test('Dayflow host hooks prefer a valid fixed user-local Dayflow candidate', async () => {
  const runtime = await hostRuntime({ installedApp: 'present' });
  assert.deepEqual(runtime.presenceCalls, [expectedInstalledCandidate]);
  assert.deepEqual(runtime.validationCalls, [], 'startup must not validate the present installed app');
  assert.deepEqual(runtime.commandCalls, [], 'startup must not open the present installed app');

  const status = await runtime.handlers.get('dayflow-desktop:get-status')(runtime.event());
  assert.deepEqual(statusFields(status), {
    status: 'ready', version: '2.6.0', build: '133', identifier: 'teleportlabs.com.Dayflow', code: undefined,
  });
  assert.deepEqual(runtime.validationCalls.map((call) => call.appRoot), [expectedInstalledCandidate]);

  const opened = await runtime.handlers.get('dayflow-desktop:open')(runtime.event());
  assert.deepEqual(statusFields(opened), {
    status: 'ready', version: '2.6.0', build: '133', identifier: 'teleportlabs.com.Dayflow', code: undefined,
  });
  assert.deepEqual(runtime.validationCalls.map((call) => call.appRoot), [expectedInstalledCandidate, expectedInstalledCandidate]);
  assert.deepEqual(runtime.commandCalls.map((call) => [call.command, [...call.args]]), [['open', ['-a', expectedInstalledCandidate]]]);
});

test('Dayflow host hooks do not fall through from an invalid installed candidate to the bundle', async () => {
  const runtime = await hostRuntime({ installedApp: 'present', invalidInstalledArtifact: true });
  for (const channel of ['dayflow-desktop:get-status', 'dayflow-desktop:open']) {
    const result = await runtime.handlers.get(channel)(runtime.event());
    assert.deepEqual(statusFields(result), {
      status: 'unavailable', version: undefined, build: undefined, identifier: undefined, code: 'ARTIFACT_INVALID',
    });
  }
  assert.deepEqual(runtime.presenceCalls, [expectedInstalledCandidate]);
  assert.deepEqual(runtime.validationCalls.map((call) => call.appRoot), [expectedInstalledCandidate, expectedInstalledCandidate]);
  assert.deepEqual(runtime.commandCalls, []);
});

test('Dayflow host hooks fail closed when fixed user-local presence metadata is inaccessible', async () => {
  const runtime = await hostRuntime({ installedApp: 'denied', invalidInstalledArtifact: true });
  const result = await runtime.handlers.get('dayflow-desktop:get-status')(runtime.event());
  assert.deepEqual(statusFields(result), {
    status: 'unavailable', version: undefined, build: undefined, identifier: undefined, code: 'ARTIFACT_INVALID',
  });
  assert.deepEqual(runtime.presenceCalls, [expectedInstalledCandidate]);
  assert.deepEqual(runtime.validationCalls.map((call) => call.appRoot), [expectedInstalledCandidate]);
  assert.deepEqual(runtime.commandCalls, []);
});

test('Dayflow host hooks preserve ownsDocument authorization and reject every supplied IPC argument', async () => {
  const runtime = await hostRuntime();
  const owner = runtime.event();
  for (const channel of ['dayflow-desktop:get-status', 'dayflow-desktop:open']) {
    const handler = runtime.handlers.get(channel);
    for (const event of [
      { sender: {}, senderFrame: owner.senderFrame },
      { sender: owner.sender, senderFrame: { url: owner.senderFrame.url } },
      { sender: owner.sender, senderFrame: undefined },
    ]) {
      const result = await handler(event);
      assert.deepEqual(statusFields(result), {
        status: 'unavailable', version: undefined, build: undefined, identifier: undefined, code: 'UNAUTHORIZED',
      });
    }
    for (const args of [[undefined], [{ candidate: '/untrusted/Dayflow.app' }], [undefined, 'extra']]) {
      const result = await handler(owner, ...args);
      assert.deepEqual(statusFields(result), {
        status: 'unavailable', version: undefined, build: undefined, identifier: undefined, code: 'UNAUTHORIZED',
      });
    }
  }
  const statusHandler = runtime.handlers.get('dayflow-desktop:get-status');
  const originalUrl = owner.senderFrame.url;
  owner.senderFrame.url = 'https://example.invalid';
  assert.deepEqual(statusFields(await statusHandler(runtime.event())), {
    status: 'unavailable', version: undefined, build: undefined, identifier: undefined, code: 'UNAUTHORIZED',
  });
  owner.senderFrame.url = originalUrl;
  runtime.owner.destroyed = true;
  assert.deepEqual(statusFields(await statusHandler(runtime.event())), {
    status: 'unavailable', version: undefined, build: undefined, identifier: undefined, code: 'UNAUTHORIZED',
  });
  assert.deepEqual(runtime.validationCalls, []);
  assert.deepEqual(runtime.commandCalls, []);
});

test('Dayflow host hooks preserve helper unavailable and unsupported statuses without probing or launching', async () => {
  const unsupported = await hostRuntime({ platform: 'linux' });
  const unsupportedResult = await unsupported.handlers.get('dayflow-desktop:get-status')(unsupported.event());
  assert.deepEqual(statusFields(unsupportedResult), {
    status: 'unsupported', version: undefined, build: undefined, identifier: undefined, code: 'UNSUPPORTED_PLATFORM',
  });
  assert.deepEqual(unsupported.validationCalls, []);
  assert.deepEqual(unsupported.commandCalls, []);

  const unavailable = await hostRuntime({ invalidBundledArtifact: true });
  const unavailableResult = await unavailable.handlers.get('dayflow-desktop:get-status')(unavailable.event());
  assert.deepEqual(statusFields(unavailableResult), {
    status: 'unavailable', version: undefined, build: undefined, identifier: undefined, code: 'ARTIFACT_INVALID',
  });
  assert.equal(unavailable.validationCalls.length, 1);
  assert.equal(unavailable.validationCalls[0].appRoot, expectedBundledCandidate);
  assert.deepEqual(unavailable.commandCalls, []);
});

test('OpenDesign host composition keeps all four existing adapters, gates the native view by the current signed-in document, and disposes on reset and quit', async () => {
  const runtime = await hostRuntime();
  assert.deepEqual(runtime.adapterCalls.map(({ id }) => id), ['hermes', 'open-design', 'dayflow', 'bot-crossing']);
  assert.equal(new Set(runtime.adapterCalls.map(({ registry }) => registry)).size, 1, 'all adapters use the one closed registry');
  assert.equal(runtime.adapterCalls.find(({ id }) => id === 'open-design')?.adapter, runtime.openDesignAdapter);

  assert.equal(runtime.openDesignOptions.length, 1);
  const [{ getWindow, isTrustedSender }] = runtime.openDesignOptions;
  assert.equal(getWindow(), runtime.owner);
  assert.equal(isTrustedSender(runtime.event()), false, 'a signed-out document cannot attach the view');
  runtime.setAuthenticated(true);
  assert.equal(isTrustedSender(runtime.event()), true, 'the current signed-in top frame is admitted');
  assert.equal(isTrustedSender({ sender: {}, senderFrame: runtime.owner.webContents.mainFrame }), false, 'foreign sender is rejected');
  assert.equal(isTrustedSender({ sender: runtime.owner.webContents, senderFrame: { url: runtime.owner.webContents.mainFrame.url } }), false, 'foreign frame object is rejected');

  await runtime.handlers.get('rhythm:auth:logout')(runtime.event());
  assert.equal(runtime.openDesignCalls.disposeCurrent, 1, 'identity reset disposes the native view but keeps its handlers');
  assert.equal(isTrustedSender(runtime.event()), false, 'the old document is no longer trusted after reset');

  let prevented = false;
  runtime.app.emit('before-quit', { preventDefault() { prevented = true; } });
  await tick();
  await tick();
  assert.equal(prevented, true);
  assert.equal(runtime.openDesignCalls.dispose, 1, 'full quit removes the OpenDesign host');
});
