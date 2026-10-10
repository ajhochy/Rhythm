// UNIT transport/lifecycle contract, NOT native ownership/runtime proof.
// The entire actual class is transpiled unchanged. Only external SDK/network,
// configuration and ownership-validator module boundaries are fixture doubles.
// No SUT method/property replacement, source rewrite or fake human/model output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as vm from 'node:vm';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(`${root}/apps/api_server/package.json`);
const ts = require('typescript');
const endpoint = 'http://127.0.0.1:4797';
const fixtureRoot = process.env.RHYTHM_TRANSPORT_UNIT_ROOT;
assert.ok(fixtureRoot?.startsWith('/private/tmp/rhythm-transport-unit-'));
const rootInfo = fs.lstatSync(fixtureRoot);
assert.equal(fs.realpathSync(fixtureRoot), fixtureRoot);
assert.equal(rootInfo.uid, process.getuid());
assert.equal(rootInfo.mode & 0o777, 0o700);
assert.deepEqual(fs.readdirSync(fixtureRoot), []);

// Guarded realm diagnostic showed Function import-cache reuse of the FIRST
// Script callback across VM contexts, not a default-loader escape. Exported
// SDK factories resolve the active sequential fixture at actual call time.
let activeSdkBoundary;
let activeSdkLabel;
function traceBoundary(event, fields) {
  if (process.env.RHYTHM_STAGE_A_BOUNDARY_TRACE === '1') {
    console.log(JSON.stringify({ unitBoundaryTrace: event, ...fields }));
  }
}

function harness({ attached = true, unhealthy = false, postAwaitChange = false, initialReject = false } = {}) {
  const requests = [], factories = [], lifecycle = [];
  let checks = 0, closeCalls = 0, healthRelease;
  const environment = {
    HOME: fs.mkdtempSync(`${fixtureRoot}/home-`),
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin', RHYTHM_OPENCODE_ENGINE_PORT: '4797',
    RHYTHM_API_BASE: 'http://127.0.0.1:4798', RHYTHM_MANAGED_CONTEXT_EXPORTS: '1',
    ...(attached ? { RHYTHM_SANDBOX_ATTACH_ENGINE_PID: 'UNIT_VALIDATOR_BOUNDARY_NOT_REAL_PID' } : {}),
  };
  const client = { fixture: 'SDK boundary only, no model or native execution' };
  const ownership = {
    sandboxEngineAttachment(port) {
      assert.equal(port, 4797);
      checks++;
      if (initialReject || (postAwaitChange && checks > 1) ||
          environment.RHYTHM_SANDBOX_ATTACH_ENGINE_PID === 'UNIT_REJECT_NEXT_VALIDATION') {
        throw new Error('UNIT rejected validator boundary');
      }
      return attached ? endpoint : null;
    },
    prepareSandboxEngineLaunch(port) { lifecycle.push(['prepare-spawn', port]); },
  };
  const logger = Object.fromEntries(['info', 'warn', 'error', 'debug'].map(k => [k, () => {}]));
  const emptyClass = class {};
  const modules = {
    '../utils/logger': { logger },
    './opencode_auth_store': { OpencodeAuthStore: emptyClass },
    './sandbox_engine_attachment': ownership,
    '../config/env': { env: { dbClient: 'postgres', port: 4798 }, resolveWebsearchConfig: () => null },
    './gemini_project_config': { ensureGeminiProjectConfig: () => ({ changed: false }), ensureGeminiProjectEnv: () => null },
    './local_omlx_provider': { ensureOmlxProviderConfig: () => ({ enabled: false }) },
    '../security/trusted_mcp_call': { clearTrustedMcpVerifier() {}, initializeTrustedMcpVerifier: async () => false },
    '../repositories/model_provenance_repository': { ModelProvenanceRepository: emptyClass },
  };
  const context = vm.createContext({
    exports: {}, Buffer, URL, URLSearchParams, AbortSignal, AbortController, TextDecoder, Response, Headers,
    setTimeout, clearTimeout, console,
    process: { env: environment, platform: 'darwin', cwd: () => root,
      kill() { throw new Error('UNIT must never signal a process'); } },
    __dirname: `${root}/apps/api_server/src/services`,
    fetch: async (url) => {
      requests.push(String(url));
      if (String(url).endsWith('/global/health')) {
        if (healthRelease) await new Promise(resolve => { healthRelease.resolve = resolve; });
        return new Response('{}', { status: unhealthy ? 503 : 200 });
      }
      // Transport targets, not provider admission, are under test. Deliberately
      // invalid frame/guard bodies must not confer managed authority.
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  function compileModule(filename) {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports = {};
    const local = vm.createContext({ ...context, exports, require: boundaryRequire });
    new vm.Script(output, { filename }).runInContext(local);
    return exports;
  }
  function boundaryRequire(name) {
    if (name in modules) return modules[name];
    if (name === 'os') return { homedir: () => environment.HOME };
    if (name === 'child_process') {
      // OS survey boundary: no host lookup. Preserve execFile's documented
      // promisify return shape rather than an accidental undefined result.
      const execFile = (_file, _args, done) => done(null, '', '');
      execFile[require('node:util').promisify.custom] = async () => ({ stdout: '', stderr: '' });
      return { execFile };
    }
    if (name === '../contracts/dayflow_provider_admission_contract' || name === '../contracts/coordinator_coding_execution_contract') {
      return compileModule(`${root}/apps/api_server/src/${name.slice(3)}.ts`);
    }
    if (name.startsWith('node:') || ['fs', 'path', 'util'].includes(name)) return require(name);
    // Unused imports do not execute repositories/providers or seed authority.
    return {};
  }
  context.require = boundaryRequire;
  const output = ts.transpileModule(fs.readFileSync(`${root}/apps/api_server/src/services/opencode_client_service.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const sdk = {
    createOpencodeClient(options) {
      traceBoundary('factory', { owner: attached ? 'attached' : 'ordinary', baseUrl: options.baseUrl });
      factories.push(options.baseUrl);
      return client;
    },
    async createOpencode(options) {
      lifecycle.push(['spawn', options.port]);
      return { client, server: { url: endpoint, close() { closeCalls++; } } };
    },
  };
  activeSdkBoundary = sdk;
  activeSdkLabel = attached ? 'attached' : 'ordinary';
  const script = new vm.Script(output, {
    filename: 'actual-opencode-client-service.cjs',
    importModuleDynamically: async (specifier) => {
      traceBoundary('import', { callbackOwner: attached ? 'attached' : 'ordinary', activeOwner: activeSdkLabel, specifier });
      assert.ok(['@opencode-ai/sdk', '@opencode-ai/sdk/v2/client'].includes(specifier));
      // Native VM import callback supplies only the external SDK boundary.
      // Function/import source and all production lifecycle methods stay intact.
      const module = new vm.SyntheticModule(Object.keys(sdk), function () {
        for (const key of Object.keys(sdk)) {
          this.setExport(key, (...args) => activeSdkBoundary[key](...args));
        }
      }, { context });
      await module.link(() => { throw new Error('unexpected SDK dependency'); });
      await module.evaluate();
      return module;
    },
  });
  script.runInContext(context);
  const service = new context.exports.OpencodeClientService();
  return { service, requests, factories, lifecycle, environment,
    get closeCalls() { return closeCalls; },
    get checks() { return checks; },
    holdHealth() { healthRelease = {}; },
    async waitForHealth() {
      for (let i = 0; i < 100 && !healthRelease.resolve; i++) await new Promise(r => setTimeout(r, 1));
      assert.ok(healthRelease.resolve, 'actual initializer never reached held health await');
    },
    releaseHealth() { healthRelease.resolve(); },
  };
}

async function readManaged(h) {
  const s = h.service;
  const enrollment = { schemaVersion: 2, kind: 'coordinator_workflow_enrollment',
    binding: { schemaVersion: 1, jobId: 'UNIT-no-authority', rootSdkSessionId: 'root',
      managerSdkSessionId: 'manager', expiresAt: '2099-01-01T00:00:00.000Z' },
    scope: { kind: 'manager_lineage' } };
  await s.getDayflowProviderFrame('sdk', 'nonce', '/synthetic');
  await s.getWorkflowProviderFrame('sdk', 'nonce', '/synthetic');
  await s.enrollDayflowGuard('sdk', '/synthetic');
  await s.enrollWorkflowProviderGuard('sdk', '/synthetic', enrollment);
  await s.mintManagedPromptAnchor('sdk', '/synthetic');
  await s.getManagedActiveToolCall('sdk', 'assistant', 'tool', '/synthetic');
}

test('UNIT actual attached initialization binds raw/v2 and all six managed URLs to4797', async () => {
  // Regression: successful attach has server:null, so raw/v2 drift to4096 and
  // six managed readers silently refuse while ordinary readiness says ready.
  const h = harness();
  await h.service.initialize();
  assert.equal(h.service.isReady, true, h.service.statusMessage);
  assert.equal(h.service.server, null, 'attachment must not invent a close handle');
  await h.service.getEngineIdentity();
  await h.service.listPermissions('/synthetic');
  await h.service.getSessionStatuses('/synthetic');
  const events = await h.service.subscribeToGlobalEvents();
  events?.abort();
  await h.service.v2Client();
  const before = h.requests.length;
  await readManaged(h);
  assert.ok(h.requests.every(url => new URL(url).origin === endpoint), JSON.stringify(h.requests));
  assert.deepEqual(h.factories, [endpoint, endpoint]);
  assert.equal(h.requests.length - before, 6, 'every composing managed reader must use the binding');
  assert.equal(h.service.hasOwnedEngine, true);
  assert.equal(h.service.serverUrl, endpoint);
  assert.equal(h.checks, 2, 'existing validation must surround health await');
  assert.deepEqual(h.lifecycle, []);
  h.service.dispose();
  assert.equal(h.closeCalls, 0);
  assert.equal(h.service.hasOwnedEngine, false);
  assert.throws(() => h.service.serverUrl, 'disposed requested attachment cannot fall back to4096');
});

test('UNIT ordinary spawn retains one real SDK close-handle boundary and URL agreement', async () => {
  const h = harness({ attached: false });
  await h.service.initialize();
  assert.equal(h.service.isReady, true);
  assert.equal(h.service.serverUrl, endpoint);
  assert.equal(h.service.hasOwnedEngine, true);
  await h.service.v2Client();
  assert.deepEqual(h.factories, [endpoint]);
  assert.deepEqual(h.lifecycle, [['prepare-spawn', 4797], ['spawn', 4797]]);
  h.service.dispose();
  h.service.dispose();
  assert.equal(h.closeCalls, 1, 'dispose must close spawned handle once');
});

test('UNIT injected ready client with no validated binding cannot gain managed ownership', async () => {
  const h = harness();
  h.service.__setTestClient({});
  assert.equal(h.service.hasOwnedEngine, false);
  await readManaged(h);
  assert.deepEqual(h.requests, []);
  assert.throws(() => h.service.serverUrl, 'requested attachment must fail closed without binding');
});

for (const [name, options] of [
  ['validator rejection', { initialReject: true }],
  ['unhealthy owned endpoint', { unhealthy: true }],
  ['post-await identity change', { postAwaitChange: true }],
]) {
  test(`UNIT ${name} cannot publish readiness or raw/v2 fallback`, async () => {
    const h = harness(options);
    await h.service.initialize();
    assert.equal(h.service.isReady, false);
    assert.equal(h.service.hasOwnedEngine, false);
    assert.equal(h.service.client, null);
    assert.deepEqual(h.factories, []);
    assert.deepEqual(h.lifecycle, []);
    assert.throws(() => h.service.serverUrl);
    await readManaged(h);
    assert.ok(h.requests.every(url => new URL(url).origin === endpoint));
  });
}

test('UNIT dispose during health await cannot resurrect an attached binding', async () => {
  const h = harness();
  h.holdHealth();
  const pending = h.service.initialize();
  await h.waitForHealth();
  h.service.dispose();
  h.releaseHealth();
  await pending;
  assert.equal(h.service.hasOwnedEngine, false);
  assert.equal(h.service.isReady, false);
  assert.throws(() => h.service.serverUrl);
  assert.equal(h.closeCalls, 0);
});

test('UNIT failed credential reload clears the previously bound attachment endpoint', async () => {
  const h = harness();
  await h.service.initialize();
  assert.equal(h.service.serverUrl, endpoint);
  // A boundary state change, not a mocked lifecycle method: existing validator
  // now rejects the captured engine, so no old URL may survive the reload.
  const original = h.service;
  // Altering the validator's outcome is outside the transport unit; no native
  // metadata is fabricated. Reload must still execute the actual lifecycle.
  h.environment.RHYTHM_SANDBOX_ATTACH_ENGINE_PID = 'UNIT_REJECT_NEXT_VALIDATION';
  await original.reloadCredentials();
  assert.equal(h.closeCalls, 0);
  assert.equal(original.hasOwnedEngine, false);
  assert.throws(() => original.serverUrl);
});
