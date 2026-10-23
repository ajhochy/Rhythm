#!/usr/bin/env node
// Root-invoked only. Imports are inert; no discovery of operator credential paths.
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync, lstatSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { userInfo } from 'node:os';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { createQualificationFixture, readQualificationFixture } from './qualification_fixture.mjs';
import { preparePaidSourceDatabase } from './paid_source_database.mjs';
import { artifactPaths, assertInvocation, assertLoanWindow, assertSameProcess, assertSourceHashes, captureOwnedRoot, captureSourceHashes,
  checkoutRoot, currentCheckoutIdentity, digestArtifact, issuePaidLoan, processIdentity, processIsAlive,
  runPaidLifecycle, scrubOwnedRoot, stableOwnedBytes, stopExactProcess, validatePaidReceipt, watchdogReason } from './web_paid_custody.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const mono = () => Number(process.hrtime.bigint() / 1_000_000n);
const fail = category => { throw new Error(`custody ${category}`); };
const runnerFile = join(checkoutRoot, 'tools/testing/run_web_paid.mjs');
const json = file => JSON.parse(stableOwnedBytes(file, { privateFile: true }).bytes.toString());
const writeJson = (file, value, exclusive = true) => writeFileSync(file, JSON.stringify(value) + '\n', { mode: 0o600, flag: exclusive ? 'wx' : 'w' });
const stages = ['buildapi', 'buildmcp', 'buildweb', 'buildengine', 'discovery', 'prepare', 'loan', 'startup', 'test', 'cleanup'];
const failureCategories = ['build-failed', 'discovery-rejected', 'prepare-rejected', 'loan-rejected', 'startup-unavailable',
  'startup-process-exited', 'startup-timeout', 'startup-ownership-unavailable', 'browser-launch-unavailable', 'test-failed', 'test-report-invalid', 'cleanup-refused', 'source-changed', 'deadline', 'parent-exit'];
const diagnosticSpecs = ['grid', 'primary-model-router', 'mcp-profile-scope', 'coordinator-two-goal', 'org-actual-snapshot']
  .map(name => `apps/web/tests/web-host/web-host-paid-${name}.spec.ts`);
const errorKinds = ['assertion', 'timeout', 'type', 'reference', 'syntax', 'interrupted', 'test-error'];
const diagnosticHelpers = ['paid-parity-fixture.ts', 'paid-task-setup-api.ts'].map(name => `apps/web/tests/web-host/${name}`);
const diagnosticFacts = { 'browser-uuid-unavailable': 'crypto.randomUUID is not a function',
  'browser-type-error': 'TypeError:', 'browser-page-error': 'pageerror',
  'locator-error': 'locator.', 'assert-equal': 'toEqual', 'assert-object': 'toMatchObject',
  'assert-value': 'toBe(', 'assert-visible': 'toBeVisible', 'assert-length': 'toHaveLength',
  'runtime-timeout': 'TimeoutError', 'fixture-assertion': 'AssertionError' };
const safeFacts = value => Array.isArray(value) ? Object.keys(diagnosticFacts).filter(key => value.includes(key)) : [];


function reviewedFailureSite(location, reviewedSpecs, errorKind) {
  if (!location || !Number.isSafeInteger(location.line) || location.line <= 0
    || !Number.isSafeInteger(location.column) || location.column <= 0 || !errorKinds.includes(errorKind)) return undefined;
  const selected = Array.isArray(reviewedSpecs) ? diagnosticSpecs.filter(path => reviewedSpecs.includes(path)) : [];
  const path = [...selected, ...(selected.length ? diagnosticHelpers : [])].find(path =>
    [path, join(checkoutRoot, path), path.slice('apps/web/tests/web-host/'.length)].includes(location.file ?? location.path));
  return path ? { path, line: location.line, column: location.column, errorKind } : undefined;
}
export function installedBrowserCache() {
  // Browser executables are tool metadata. Derive from the OS user, never sanitized HOME or caller overrides.
  const cache = join(userInfo().homedir, 'Library/Caches/ms-playwright'), st = lstatSync(cache);
  if (process.platform !== 'darwin' || realpathSync(cache) !== cache || !st.isDirectory() || st.isSymbolicLink()
    || st.uid !== process.getuid() || (st.mode & 0o022)) fail('browser cache rejected');
  return cache;
}
const baseEnv = root => ({ PATH: `${dirname(process.execPath)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
  HOME: join(root, 'home'), TMPDIR: join(root, 'tmp'), DB_CLIENT: 'sqlite', RHYTHM_OPTIMIZER_MODE: 'shadow',
  PLAYWRIGHT_BROWSERS_PATH: installedBrowserCache(), PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
  npm_config_offline: 'true', npm_config_registry: 'http://127.0.0.1:9', npm_config_cache: join(root, 'npm-cache') });

export function validatePlan(plan, identity, environment) {
  assertInvocation(plan, identity, environment);
  const allowed = ['schemaVersion', 'checkoutRoot', 'sourceRevision', 'sourceSha256', 'caseIds', 'provider',
    'sourceAccountsPath', 'selectedAccountId', 'sourceDecisionPath', 'sourceGridPath', 'reviewedDecision', 'reviewedGrid',
    'specs', 'ports', 'snapshotPath', 'snapshotSha256', 'profileIds'];
  if (plan.schemaVersion !== 1 || Object.keys(plan).some(key => !allowed.includes(key))
    || typeof plan.selectedAccountId !== 'string' || !plan.selectedAccountId
    || !Array.isArray(plan.specs) || !plan.specs.length) fail('plan rejected');
  const forbiddenKeys = value => {
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, item]) => /(?:key|token|secret|password|credential|authorization|access)/i.test(key) || forbiddenKeys(item));
  };
  if (forbiddenKeys(plan.reviewedDecision) || forbiddenKeys(plan.reviewedGrid)) fail('plan rejected');
  for (const source of [plan.sourceAccountsPath, ...(plan.provider === 'openai' ? [plan.sourceDecisionPath, plan.sourceGridPath] : [])]) {
    if (typeof source !== 'string' || !source.startsWith('/') || resolve(source) !== source) fail('plan rejected');
  }
  for (const spec of plan.specs) {
    if (!/^apps\/web\/tests\/web-host\/web-host-[a-z0-9-]+\.spec\.ts$/.test(spec.path)
      || !/^[a-f0-9]{64}$/.test(spec.sha256) || hash(stableOwnedBytes(join(checkoutRoot, spec.path)).bytes) !== spec.sha256) fail('plan rejected');
  }
  if (!plan.ports || Object.keys(plan.ports).sort().join(',') !== 'api,engine,gateway'
    || new Set(Object.values(plan.ports)).size !== 3 || Object.values(plan.ports).some(port =>
      !Number.isSafeInteger(port) || port < 1024 || port > 65535 || [4001, 4002, 4096, 4175].includes(port))) fail('plan rejected');
  if (plan.caseIds.includes(118) && (typeof plan.snapshotPath !== 'string' || resolve(plan.snapshotPath) !== plan.snapshotPath
    || !/^[a-f0-9]{64}$/.test(plan.snapshotSha256) || JSON.stringify(plan.profileIds) !== '["secretary"]')) fail('plan rejected');
  if (!plan.caseIds.includes(118) && ['snapshotPath', 'snapshotSha256', 'profileIds'].some(key => plan[key] !== undefined)) fail('plan rejected');
  return plan;
}

export function sandboxEnvironment(receipt, controlRoot, snapshot = {}) {
  const { fixtureRoot: root, sourceRoot, sourceRevision, ports } = receipt;
  return { ...baseEnv(controlRoot), RHYTHM_SANDBOX_DIR: root,
    RHYTHM_SANDBOX_API_PORT: String(ports.api), RHYTHM_SANDBOX_ENGINE_PORT: String(ports.engine), RHYTHM_SANDBOX_GATEWAY_PORT: String(ports.gateway),
    RHYTHM_APPROVED_FIXTURE_ROOT: sourceRoot, RHYTHM_LIVE_DB_PATH: join(sourceRoot, 'rhythm.db'), RHYTHM_SANDBOX_OPENCODE_CONFIG: sourceRoot,
    RHYTHM_SANDBOX_ENGINE_DIR: join(checkoutRoot, 'apps/opencode_fork/packages/opencode'), RHYTHM_SANDBOX_NODE_BIN: process.execPath,
    RHYTHM_SANDBOX_WEB_PAID: '1', RHYTHM_WEB_PAID_CONTROL_ROOT: controlRoot, RHYTHM_WEB_PAID_CUSTODY_RECEIPT: join(root, 'web-paid-custody.json'),
    RHYTHM_QUALIFICATION_FIXTURE_MANIFEST: join(root, 'manifest.json'), RHYTHM_WEB_HOST: '1', RHYTHM_WEB_OWNER_USER_ID: '1',
    RHYTHM_WEB_PUBLIC_ORIGIN: `http://rhythm-web.test:${ports.api}`, RHYTHM_WEB_DIST_DIR: join(checkoutRoot, 'apps/web/dist-web'),
    RHYTHM_WORKSTREAMS_ENABLED: 'true', RHYTHM_EXPECTED_REVISION: sourceRevision, RHYTHM_FEATURE_EXPECTED_REVISION: sourceRevision,
    RHYTHM_WEB_PAID_TEST: '1', RHYTHM_FEATURE_MODEL: '1', RHYTHM_LIVE_E2E: '1',
    ...(receipt.orgSeedReceiptSha256 ? { RHYTHM_WEB_PAID_ORG_SEED_RECEIPT: join(root, 'paid-org-seed.json'),
      RHYTHM_ORG_EVALUATION_REAL_SNAPSHOT_PATH: snapshot.snapshotPath,
      RHYTHM_ORG_EVALUATION_REAL_SNAPSHOT_SHA256: snapshot.snapshotSha256 } : {}) };
}

/** Replace only an owned public build stamp, without following a destination link. */
export function writeBuildIdentity(file, sourceRevision) {
  const parent = dirname(file), st = lstatSync(parent);
  if (!/^[a-f0-9]{40}$/.test(sourceRevision) || realpathSync(parent) !== parent || !st.isDirectory()
    || st.uid !== process.getuid() || (st.mode & 0o022)) fail('build stamp rejected');
  try { lstatSync(file); stableOwnedBytes(file); } catch (error) { if (error.code !== 'ENOENT') fail('build stamp rejected'); }
  const temporary = `${file}.paid-${process.pid}`;
  writeJson(temporary, { schemaVersion: 1, sourceRevision });
  try { renameSync(temporary, file); } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}

/** Discard arbitrary test/runtime strings; never forward raw failure text. */
export function publicEvidence(state, exitCode, reason) {
  const paths = artifactPaths();
  const artifacts = Object.fromEntries(Object.entries(paths).flatMap(([name, path]) => {
    const artifact = state.artifacts?.[name];
    return artifact?.path === path && /^[a-f0-9]{64}$/.test(artifact.sha256) ? [[name, { path, sha256: artifact.sha256 }]] : [];
  }));
  const number = value => Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  const selected = Array.isArray(state.caseIds) ? state.caseIds.filter(id => [91, 92, 93, 94, 108, 109, 110, 118].includes(id)) : [];
  return { schemaVersion: 1, kind: 'web-paid-run-result-v1', sourceRevision: /^[a-f0-9]{40}$/.test(state.sourceRevision) ? state.sourceRevision : undefined,
    sourceSha256: /^[a-f0-9]{64}$/.test(state.sourceSha256) ? state.sourceSha256 : undefined,
    caseIds: selected, provider: ['openai', 'anthropic'].includes(state.provider) ? state.provider : undefined,
    exitCode: Number.isInteger(exitCode) ? exitCode : 1, reason: ['complete', 'failed', 'deadline', 'parent-exit', 'cleanup-refused'].includes(reason) ? reason : 'failed',
    stage: stages.includes(state.failureStage ?? state.stage) ? state.failureStage ?? state.stage : undefined,
    category: exitCode !== 0 && failureCategories.includes(state.failureCategory) ? state.failureCategory : undefined,
    sourceUnchanged: state.sourceUnchanged === true, canonicalDown: state.canonicalDown === true,
    secretsScrubbed: state.secretsScrubbed === true, artifacts,
    caseResults: (Array.isArray(state.caseResults) ? state.caseResults : []).filter(row => selected.includes(row.caseId)).map(row => ({ caseId: row.caseId,
      observed: number(row.observed), status: ['passed', 'failed', 'missing', 'duplicate'].includes(row.status) ? row.status : 'failed',
      attempts: number(row.attempts), durationMs: number(row.durationMs),
      failureSite: reviewedFailureSite(row.failureSite, state.reviewedSpecs, row.failureSite?.errorKind),
      failureFacts: safeFacts(row.failureFacts) })),
    startedAt: number(state.startedAt), testStartedAt: number(state.testStartedAt), testFinishedAt: number(state.testFinishedAt),
    issuedAt: number(state.issuedAt), stopAt: number(state.stopAt), finishedAt: Date.now() };
}

export function summarizePlaywrightReport(report, caseIds, { discovery = false, reviewedSpecs = [] } = {}) {
  const found = new Map(caseIds.map(id => [id, []]));
  let unexpected = false;
  const visit = suite => {
    for (const spec of suite.specs ?? []) {
      const match = String(spec.title).match(/^(?:#(\d+)(?::|\s)|\[web-parity-(\d+)\])/);
      const id = Number(match?.[1] ?? match?.[2]);
      if (!found.has(id)) { unexpected = true; continue; }
      for (const item of spec.tests ?? []) found.get(id).push(item);
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  visit(report);
  const caseResults = [...found].map(([caseId, tests]) => {
    const results = tests.flatMap(item => item.results ?? []);
    const passed = tests.length === 1 && (discovery || tests[0].expectedStatus === 'passed' && tests[0].status === 'expected'
      && results.length === 1 && results[0].status === 'passed');
    let failureSite;
    const failureFacts = new Set();
    if (!passed && !discovery) for (const result of results) {
      if (result.status === 'passed') continue;
      for (const error of result.errors ?? (result.error ? [result.error] : [])) {
        const errorKind = result.status === 'timedOut' ? 'timeout' : result.status === 'interrupted' ? 'interrupted'
          : ({ AssertionError: 'assertion', TimeoutError: 'timeout', TypeError: 'type', ReferenceError: 'reference', SyntaxError: 'syntax' }[error.name] ?? 'test-error');
        failureSite ??= reviewedFailureSite(error.location, reviewedSpecs, errorKind);
        if (!failureSite && typeof error.stack === 'string') {
          for (const path of [...diagnosticSpecs, ...diagnosticHelpers]) {
            const at = error.stack.indexOf(path + ':');
            if (at < 0) continue;
            const coordinates = /^(\d+):(\d+)(?:\D|$)/.exec(error.stack.slice(at + path.length + 1));
            if (coordinates) failureSite ??= reviewedFailureSite({ file: path, line: Number(coordinates[1]),
              column: Number(coordinates[2]) }, reviewedSpecs, errorKind);
          }
        }
        const diagnostic = JSON.stringify(error).slice(0, 1_000_000);
        for (const [key, needle] of Object.entries(diagnosticFacts)) if (diagnostic.includes(needle)) failureFacts.add(key);
      }
    }
    return { caseId, observed: tests.length, status: passed ? (discovery ? 'listed' : 'passed') : tests.length === 0 ? 'missing' : tests.length > 1 ? 'duplicate' : 'failed',
      attempts: results.length, durationMs: results.reduce((sum, result) => sum + (Number.isFinite(result.duration) ? result.duration : 0), 0), failureSite, failureFacts: safeFacts([...failureFacts]) };
  });
  return { caseResults, passed: !unexpected && !(report.errors?.length) && caseResults.every(row => row.status === (discovery ? 'listed' : 'passed')) };
}
function playwrightArguments(plan) {
  const ids = plan.caseIds.join('|');
  return [join(checkoutRoot, 'apps/web/node_modules/@playwright/test/cli.js'), 'test', '--config',
    join(checkoutRoot, 'apps/web/tests/web-host/playwright.config.ts'), ...plan.specs.map(spec => join(checkoutRoot, spec.path)),
    '--workers=1', '--retries=0', '--reporter=json', '--grep', `(?:#(?:${ids})(?:\\]|:|\\s)|\\[web-parity-(?:${ids})\\])`];
}

async function command(file, args, { cwd = checkoutRoot, env, capture = false } = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(file, args, { cwd, env, stdio: ['ignore', capture ? 'pipe' : 'ignore', 'ignore'] });
    let output = '', tooLarge = false;
    if (capture) child.stdout.on('data', chunk => { output += chunk; if (output.length > 8_000_000) { tooLarge = true; output = ''; } });
    child.once('error', () => reject(new Error('custody command failed')));
    child.once('exit', (code, signal) => resolveResult({ code: code ?? 1, signal, output: tooLarge ? '' : output }));
  });
}
async function checkedCommand(file, args, options) {
  const result = await command(file, args, options);
  if (result.code !== 0 || result.signal) fail('command failed');
  return result.output;
}
export async function probePaidBrowser(environment) {
  const script = `const {chromium}=require(${JSON.stringify(join(checkoutRoot, 'apps/web/node_modules/@playwright/test'))});
    (async()=>{let browser;try{browser=await chromium.launch({headless:true,timeout:15000});await browser.close();browser=null;
      process.stdout.write('browser-ready');}catch{process.exitCode=1;}finally{if(browser)await browser.close().catch(()=>{});}})();`;
  const result = await command(process.execPath, ['-e', script], { env: environment, capture: true });
  if (result.code !== 0 || result.signal || result.output !== 'browser-ready') fail('browser launch unavailable');
  return { category: 'blank-browser-launched' };
}
function portsFree(ports) {
  for (const port of Object.values(ports)) {
    try {
      const result = execFileSync('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      if (result.trim()) return false;
    } catch (error) { if (error.status !== 1) fail('port audit failed'); }
  }
  return true;
}
export function paidRuntimeReadiness(state, observed) {
  if (!observed.apiOk || !observed.engineOk || observed.opencodeStatus !== 'ready') return false;
  try {
    const { records, listeners, processes, after, argvBound, parents } = observed;
    if (new Set(Object.values(records)).size !== 3 || ['api', 'engine', 'holder'].some(role =>
      !Number.isSafeInteger(records[role]) || records[role] <= 1 || processes[role]?.pid !== records[role] || argvBound[role] !== true)
      || listeners.api.length !== 1 || listeners.api[0] !== records.api
      || listeners.engine.length !== 1 || listeners.engine[0] !== records.engine || listeners.gateway.length !== 0
      || processes.api.executable !== realpathSync(process.execPath) || processes.engine.executable !== artifactPaths().engine
      || processes.holder.executable !== '/bin/bash' || parents.api !== records.holder || parents.engine !== records.api
      || parents.holder !== state.parent.pid) fail('runtime ownership rejected');
    assertSameProcess(state.holderProcess, processes.holder);
    for (const role of ['api', 'engine', 'holder']) assertSameProcess(processes[role], after[role]);
    return true;
  } catch { fail('runtime ownership rejected'); }
}

async function observePaidRuntime(state) {
  const { ports, fixtureRoot } = state;
  const [api, engine, managed] = await Promise.all([
    fetch(`http://127.0.0.1:${ports.api}/health`, { signal: AbortSignal.timeout(1000) }),
    fetch(`http://127.0.0.1:${ports.engine}/global/health`, { signal: AbortSignal.timeout(1000) }),
    fetch(`http://127.0.0.1:${ports.api}/opencode/health`, { signal: AbortSignal.timeout(1000) }),
  ]);
  const health = { apiOk: api.ok, engineOk: engine.ok, opencodeStatus: managed.ok ? (await managed.json()).status : undefined };
  if (!health.apiOk || !health.engineOk || health.opencodeStatus !== 'ready') return health;
  const names = { api: 'api_server.pid', engine: 'opencode_engine.pid', holder: 'foreground_holder.pid' };
  const files = Object.fromEntries(Object.entries(names).map(([role, name]) => [role, stableOwnedBytes(join(fixtureRoot, name))]));
  const records = Object.fromEntries(Object.entries(files).map(([role, file]) => {
    const raw = file.bytes.toString().trim();
    if (!/^[1-9][0-9]*$/.test(raw)) fail('runtime ownership rejected');
    return [role, Number(raw)];
  }));
  const processes = Object.fromEntries(Object.entries(records).map(([role, pid]) => [role, processIdentity(pid)]));
  const read = (file, args) => execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
  const listening = port => {
    let raw;
    try { raw = read('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']); }
    catch (error) { if (error.status === 1) return []; throw error; }
    if (!/^[0-9]+(?:\s+[0-9]+)*$/.test(raw)) fail('runtime ownership rejected');
    return [...new Set(raw.split(/\s+/).map(Number))];
  };
  const listeners = Object.fromEntries(Object.entries(ports).map(([role, port]) => [role, listening(port)]));
  const requiredArgs = { api: [join(checkoutRoot, 'apps/api_server/dist/server.js'), '--parent-pid=1', `--rhythm-sandbox=${fixtureRoot}`],
    engine: ['serve', '--hostname=127.0.0.1', `--port=${ports.engine}`], holder: [join(checkoutRoot, 'tools/dev/sandbox.sh'), 'up', '--foreground'] };
  for (const role of ['api', 'engine', 'holder']) read('/usr/bin/python3',
    ['-I', join(checkoutRoot, 'tools/dev/sandbox_api_recovery.py'), 'inspect-argv', String(records[role]), ...requiredArgs[role]]);
  const parents = Object.fromEntries(Object.entries(records).map(([role, pid]) => [role, Number(read('/bin/ps', ['-p', String(pid), '-o', 'ppid=']))]));
  const after = Object.fromEntries(Object.entries(records).map(([role, pid]) => [role, processIdentity(pid)]));
  for (const [role, name] of Object.entries(names)) {
    const current = stableOwnedBytes(join(fixtureRoot, name));
    if (!current.bytes.equals(files[role].bytes) || JSON.stringify(current.identity) !== JSON.stringify(files[role].identity)) fail('runtime ownership rejected');
  }
  return { ...health, records, listeners, processes, after, parents, argvBound: { api: true, engine: true, holder: true } };
}
function seal(directory) {
  for (const name of readdirSync(directory)) {
    const file = join(directory, name), st = lstatSync(file);
    if (st.isSymbolicLink()) fail('source sealing rejected');
    if (st.isDirectory()) { seal(file); chmodSync(file, 0o500); }
    else if (st.isFile()) chmodSync(file, 0o400);
    else fail('source sealing rejected');
  }
}
function saveState(controlRoot, state) {
  const next = join(controlRoot, `state-${process.pid}.json`);
  writeJson(next, state); renameSync(next, join(controlRoot, 'state.json'));
}

/** Both the foreground runner and independent watchdog use this exact cleanup. */
export async function cleanupControl(controlRoot, reason = 'complete') {
  captureOwnedRoot(controlRoot);
  const doneFile = join(controlRoot, 'done.json');
  if (existsSync(doneFile)) return json(doneFile);
  try { writeFileSync(join(controlRoot, 'cleanup.lock'), String(process.pid), { mode: 0o600, flag: 'wx' }); }
  catch {
    for (let attempt = 0; attempt < 120; attempt++) { if (existsSync(doneFile)) return json(doneFile); await sleep(250); }
    fail('cleanup failed');
  }
  const state = json(join(controlRoot, 'state.json'));
  if (reason !== 'complete') state.failureStage ??= state.stage;
  if (['deadline', 'parent-exit'].includes(reason)) state.failureCategory = reason;
  state.stage = 'cleanup';
  try {
    for (const owner of state.roots) {
      if (JSON.stringify(captureOwnedRoot(owner.root)) !== JSON.stringify(owner)) fail('cleanup refused');
    }
    await stopExactProcess(state.testProcess);
    for (const owner of state.runtimeProcesses ?? []) if (processIsAlive(owner.pid)) assertSameProcess(owner, processIdentity(owner.pid));
    if (state.launchAttempted) {
      await checkedCommand('/bin/bash', [join(checkoutRoot, 'tools/dev/sandbox.sh'), 'down'], { env: state.sandboxEnv });
    }
    if (!portsFree(state.ports)) fail('cleanup refused');
    if (state.holderProcess && processIsAlive(state.holderProcess.pid)) fail('cleanup refused');
    state.canonicalDown = true;
    let unchanged = true;
    if (state.sourceHashes?.length) { try { assertSourceHashes(state.sourceHashes); } catch { unchanged = false; } }
    state.sourceUnchanged = unchanged;
    if (!unchanged) { state.failureStage = 'cleanup'; state.failureCategory = 'source-changed'; }
    // No runtime authority read here: expiry does not prevent exact creator scrub.
    for (const owner of [...state.roots].reverse()) {
      // Read-only synthetic source subdirectories need write permission for unlink.
      const unlock = dir => { chmodSync(dir, 0o700); for (const name of readdirSync(dir)) {
        const file = join(dir, name), st = lstatSync(file); if (st.isDirectory() && !st.isSymbolicLink()) unlock(file);
      } };
      unlock(owner.root);
      scrubOwnedRoot(owner, { stopped: true, portsFree: true });
    }
    state.secretsScrubbed = true;
    const receipt = publicEvidence(state, unchanged ? state.testExitCode ?? 1 : 1, reason);
    writeJson(doneFile, receipt);
    return receipt;
  } catch {
    state.failureStage = 'cleanup'; state.failureCategory = 'cleanup-refused';
    writeJson(doneFile, publicEvidence(state, 1, 'cleanup-refused'));
    fail('cleanup failed');
  }
}

async function watchdog(controlRoot) {
  const owner = captureOwnedRoot(controlRoot);
  while (true) {
    if (existsSync(join(controlRoot, 'done.json'))) return;
    if (JSON.stringify(captureOwnedRoot(controlRoot)) !== JSON.stringify(owner)) fail('cleanup refused');
    const state = json(join(controlRoot, 'state.json'));
    let parentAlive = processIsAlive(state.parent.pid);
    if (parentAlive) { try { assertSameProcess(state.parent, processIdentity(state.parent.pid)); } catch { parentAlive = false; } }
    // Reserve bounded shutdown time; the provisioner's ten-minute limit is never extended.
    const reason = state.stopAt ? watchdogReason({ ...state, stopAt: state.stopAt - 30_000, now: Date.now(), monotonicNow: mono(), parentAlive }) : parentAlive ? null : 'parent-exit';
    if (reason) { await cleanupControl(controlRoot, reason); return; }
    await sleep(250);
  }
}

export function observeChildExit(child) {
  const exit = { observed: child.exitCode !== null || child.signalCode !== null, promise: undefined };
  exit.promise = exit.observed ? Promise.resolve() : new Promise(resolveExit => child.once('exit', () => { exit.observed = true; resolveExit(); }));
  return exit;
}
export async function finishPaidControl(controlOwner, watchdogProcess, state, { stop = stopExactProcess, exit } = {}) {
  if (watchdogProcess) {
    try { await stop(watchdogProcess); }
    catch (error) {
      // Only the exact ChildProcess exit event can settle the alive→identity race.
      if (exit && !exit.observed) await Promise.race([exit.promise, sleep(100)]);
      if (!exit?.observed || processIsAlive(watchdogProcess.pid)) throw error;
    }
  }
  if (!state.roots.length || existsSync(join(controlOwner.root, 'done.json')) && json(join(controlOwner.root, 'done.json')).secretsScrubbed) {
    scrubOwnedRoot(controlOwner, { stopped: true, portsFree: true });
  }
}

export async function runPlan(planPath) {
  process.umask(0o077);
  const plan = json(planPath);
  validatePlan(plan, currentCheckoutIdentity(), process.env);
  if (!portsFree(plan.ports)) fail('port audit failed');
  const controlRoot = mkdtempSync('/private/tmp/rhythm-web-paid-run-'), controlOwner = captureOwnedRoot(controlRoot);
  for (const dir of ['home', 'tmp']) mkdirSync(join(controlRoot, dir), { mode: 0o700 });
  let state = { ...currentCheckoutIdentity(), caseIds: plan.caseIds, provider: plan.provider, ports: plan.ports,
    reviewedSpecs: plan.specs.map(spec => spec.path),
    parent: processIdentity(process.pid), roots: [], testExitCode: 1, startedAt: Date.now() }, watchdogProcess, watchdogExit;
  const save = () => saveState(controlRoot, state);
  const markStage = (stage, category) => { state.stage = stage; state.failureCategory = category; save(); };
  try {
    const result = await runPaidLifecycle(plan, {
      validate: async () => validatePlan(plan, currentCheckoutIdentity(), process.env),
      build: async () => {
        const env = baseEnv(controlRoot);
        const guard = async (args, extra = {}, cwd = checkoutRoot) => checkedCommand('/usr/bin/python3',
          [join(checkoutRoot, 'tools/build/guard.py'), '--repo', checkoutRoot, '--watch', join(checkoutRoot, 'apps/web/dist-web'),
            '--', ...args], { cwd, env: { ...env, ...extra } });
        for (const app of ['api_server', 'mcp_server']) {
          markStage(app === 'api_server' ? 'buildapi' : 'buildmcp', 'build-failed');
          await guard(['npm', '--prefix', join(checkoutRoot, 'apps', app), 'run', 'build']);
        }
        markStage('buildweb', 'build-failed');
        await guard(['npm', '--prefix', join(checkoutRoot, 'apps/web'), 'run', 'build:web']);
        markStage('buildengine', 'build-failed');
        await guard(['bun', '--no-env-file', 'run', './script/build.ts', '--single', '--skip-install', '--skip-embed-web-ui'],
          // Paid routing needs the normal production registry; the offline unit fixture omits GPT-6.
          { OPENCODE_VERSION: `0.0.0-rhythm-${plan.sourceRevision}`, OPENCODE_CHANNEL: 'rhythm-qualification' },
          join(checkoutRoot, 'apps/opencode_fork/packages/opencode'));
        assertInvocation(plan, currentCheckoutIdentity(), {});
        writeBuildIdentity(join(checkoutRoot, 'apps/api_server/build-identity.json'), plan.sourceRevision);
        state.artifacts = Object.fromEntries(Object.entries(artifactPaths()).map(([key, path]) => [key, { path, sha256: digestArtifact(path) }]));
        state.apiBuildIdentitySha256 = hash(stableOwnedBytes(join(checkoutRoot, 'apps/api_server/build-identity.json')).bytes);
        state.builtAt = Date.now();
        markStage('discovery', 'browser-launch-unavailable');
        await probePaidBrowser(env);
        markStage('discovery', 'discovery-rejected');
        const listed = await checkedCommand(process.execPath, [...playwrightArguments(plan), '--list'], { env, capture: true });
        if (!summarizePlaywrightReport(JSON.parse(listed), plan.caseIds, { discovery: true }).passed) fail('case discovery rejected');
      },
      prepare: async () => {
        markStage('prepare', 'prepare-rejected');
        const manifestPath = createQualificationFixture(plan.sourceRevision, { hermesRuntimeRoot: null, hermesBackendArtifactRoot: null });
        const fixtureRoot = dirname(manifestPath);
        state.roots.push(captureOwnedRoot(fixtureRoot)); save();
        const sourceRoot = mkdtempSync('/private/tmp/rhythm-web-paid-sources-');
        state.roots.push(captureOwnedRoot(sourceRoot)); save();
        Object.assign(state, { fixtureRoot, manifestPath, sourceRoot });
        if (plan.caseIds.includes(118)) {
          const { preparePaidOrgSnapshot } = await import('./paid_org_snapshot_fixture.mjs');
          const seeded = await preparePaidOrgSnapshot({ manifestPath, sourceRevision: plan.sourceRevision, sourceConfigRoot: sourceRoot,
            snapshotPath: plan.snapshotPath, snapshotSha256: plan.snapshotSha256, profileIds: plan.profileIds });
          const file = join(fixtureRoot, 'paid-org-seed.json'); writeJson(file, seeded);
          state.orgSeedReceiptSha256 = hash(stableOwnedBytes(file, { privateFile: true }).bytes);
        }
        preparePaidSourceDatabase({ manifestPath, sourceRevision: plan.sourceRevision, sourceRoot });
        const { manifest } = readQualificationFixture(manifestPath, plan.sourceRevision);
        const actor = stableOwnedBytes(manifest.syntheticActor.tokenPath, { privateFile: true }).bytes.toString();
        writeJson(join(sourceRoot, 'opencode.json'), { mcp: { rhythm: { type: 'local', command: [process.execPath, join(checkoutRoot, 'apps/mcp_server/dist/index.js')],
          environment: { RHYTHM_API_URL: `http://127.0.0.1:${plan.ports.api}`, RHYTHM_API_TOKEN: actor } } } });
        seal(sourceRoot); state.sourceRootSha256 = digestArtifact(sourceRoot); save();
        const child = spawn(process.execPath, [runnerFile, 'watchdog', controlRoot], { detached: true, stdio: 'ignore', env: baseEnv(controlRoot) });
        watchdogExit = observeChildExit(child);
        await new Promise((ok, reject) => { child.once('spawn', ok); child.once('error', reject); });
        watchdogProcess = processIdentity(child.pid); child.unref();
        return state;
      },
      issue: async () => {
        markStage('loan', 'loan-rejected');
        assertInvocation(plan, currentCheckoutIdentity(), {});
        state.sourceHashes = captureSourceHashes(plan.provider === 'anthropic' ? [plan.sourceAccountsPath]
          : [plan.sourceAccountsPath, plan.sourceDecisionPath, plan.sourceGridPath]);
        save();
        const loan = await issuePaidLoan({ ...plan, manifestPath: state.manifestPath, expectedRevision: plan.sourceRevision });
        Object.assign(state, loan, { monotonicStart: mono() }); save();
        const receipt = { schemaVersion: 1, kind: 'web-paid-custody-v1', checkoutRoot, sourceRevision: plan.sourceRevision,
          sourceSha256: plan.sourceSha256, builtAt: state.builtAt, artifacts: state.artifacts, fixtureRoot: state.fixtureRoot,
          apiBuildIdentitySha256: state.apiBuildIdentitySha256,
          manifestPath: state.manifestPath, sourceRoot: state.sourceRoot, sourceRootSha256: state.sourceRootSha256,
          caseIds: plan.caseIds, provider: plan.provider, ports: plan.ports, issuedAt: loan.issuedAt, stopAt: loan.stopAt, expires: loan.expires,
          ...(state.orgSeedReceiptSha256 ? { orgSeedReceiptSha256: state.orgSeedReceiptSha256 } : {}) };
        writeJson(join(state.fixtureRoot, 'web-paid-custody.json'), receipt);
        state.sandboxEnv = sandboxEnvironment(receipt, controlRoot, plan); save();
        validatePaidReceipt(join(state.fixtureRoot, 'web-paid-custody.json'), { expectedRevision: plan.sourceRevision });
        return loan;
      },
      start: async () => {
        markStage('startup', 'startup-unavailable');
        state.launchAttempted = true; save();
        const holder = spawn('/bin/bash', [join(checkoutRoot, 'tools/dev/sandbox.sh'), 'up', '--foreground'],
          { cwd: checkoutRoot, env: state.sandboxEnv, stdio: 'ignore' });
        await new Promise((ok, reject) => { holder.once('spawn', ok); holder.once('error', reject); });
        state.holderProcess = processIdentity(holder.pid); save();
        for (let attempt = 0; attempt < 120; attempt++) {
          assertLoanWindow(state);
          if (!processIsAlive(holder.pid)) { state.failureCategory = 'startup-process-exited'; fail('startup failed'); }
          try {
            const observed = await observePaidRuntime(state);
            if (paidRuntimeReadiness(state, observed)) {
              state.runtimeProcesses = [observed.processes.api, observed.processes.engine];
              save(); return;
            }
          } catch { state.failureCategory = 'startup-ownership-unavailable'; /* No response/process contents are retained. */ }
          await sleep(500);
        }
        state.failureCategory = 'startup-timeout'; fail('startup failed');
      },
      run: async () => {
        markStage('test', 'test-failed');
        assertLoanWindow(state);
        if (plan.caseIds.includes(110) && state.stopAt - Date.now() <= 480_000) fail('insufficient deadline');
        state.testStartedAt = Date.now();
        const args = [...playwrightArguments(plan), '--output', join(state.fixtureRoot, 'playwright')];
        const child = spawn(process.execPath, args, { cwd: checkoutRoot, env: { ...state.sandboxEnv,
          PLAYWRIGHT_HTML_OUTPUT_DIR: join(state.fixtureRoot, 'playwright-report') }, stdio: ['ignore', 'pipe', 'ignore'] });
        const exited = new Promise(resolveExit => child.once('exit', (value, signal) => resolveExit(signal ? 1 : value ?? 1)));
        let output = ''; child.stdout.on('data', chunk => { if (output.length < 8_000_000) output += chunk; });
        await new Promise((ok, reject) => { child.once('spawn', ok); child.once('error', reject); });
        state.testProcess = processIdentity(child.pid); save();
        const code = await exited;
        let summary = summarizePlaywrightReport({}, plan.caseIds);
        try { summary = summarizePlaywrightReport(JSON.parse(output), plan.caseIds, { reviewedSpecs: state.reviewedSpecs }); }
        catch { state.failureCategory = 'test-report-invalid'; /* No raw test output survives. */ }
        output = '';
        state.testFinishedAt = Date.now(); state.caseResults = summary.caseResults;
        state.testExitCode = code === 0 && summary.passed ? 0 : 1;
        save(); return { exitCode: state.testExitCode };
      },
      stop: async () => { save(); await cleanupControl(controlRoot, state.testExitCode === 0 ? 'complete' : 'failed'); },
      scrub: async () => { const done = json(join(controlRoot, 'done.json')); if (!done.secretsScrubbed) fail('cleanup failed'); },
    });
    const receipt = json(join(controlRoot, 'done.json'));
    process.stdout.write(JSON.stringify(receipt) + '\n');
    return result.exitCode;
  } catch {
    if (existsSync(join(controlRoot, 'done.json'))) {
      const receipt = json(join(controlRoot, 'done.json'));
      process.stdout.write(JSON.stringify({ ...receipt, ...(!receipt.secretsScrubbed ? { recoveryControlRoot: controlRoot } : {}) }) + '\n');
    } else process.stdout.write(JSON.stringify(publicEvidence(state, 1, 'failed')) + '\n');
    return 1;
  } finally {
    await finishPaidControl(controlOwner, watchdogProcess, state, { exit: watchdogExit });
  }
}

async function main() {
  const [mode, file] = process.argv.slice(2);
  if (mode === 'identity' && !file) { process.stdout.write(JSON.stringify(currentCheckoutIdentity()) + '\n'); return 0; }
  if (mode === 'run' && file) return runPlan(resolve(file));
  if (mode === 'watchdog' && file) { await watchdog(file); return 0; }
  if (mode === 'sandbox-preflight' && file) {
    const receipt = validatePaidReceipt(file, { expectedRevision: process.env.RHYTHM_EXPECTED_REVISION });
    if (process.env.RHYTHM_SANDBOX_WEB_PAID !== '1' || process.env.RHYTHM_SANDBOX_DIR !== receipt.fixtureRoot || process.env.RHYTHM_APPROVED_FIXTURE_ROOT !== receipt.sourceRoot
      || process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST !== receipt.manifestPath
      || process.env.RHYTHM_SANDBOX_ENGINE_DIR !== join(checkoutRoot, 'apps/opencode_fork/packages/opencode')
      || ['api', 'engine', 'gateway'].some(key => process.env[`RHYTHM_SANDBOX_${key.toUpperCase()}_PORT`] !== String(receipt.ports[key]))
      || ['rhythm.db', 'api_server.pid', 'opencode_engine.pid', 'foreground_holder.pid'].some(name => existsSync(join(receipt.fixtureRoot, name)))) fail('startup rejected');
    return 0;
  }
  if (mode === 'sandbox-cleanup' && file) {
    captureOwnedRoot(file);
    const state = json(join(file, 'state.json'));
    if (state.checkoutRoot !== checkoutRoot || process.env.RHYTHM_SANDBOX_WEB_PAID !== '1'
      || process.env.RHYTHM_SANDBOX_DIR !== state.fixtureRoot
      || process.env.RHYTHM_SANDBOX_ENGINE_DIR !== join(checkoutRoot, 'apps/opencode_fork/packages/opencode')
      || !state.roots.some(owner => owner.root === state.fixtureRoot && JSON.stringify(captureOwnedRoot(owner.root)) === JSON.stringify(owner))) fail('cleanup refused');
    return 0;
  }
  fail('command rejected');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(code => { process.exitCode = code; }).catch(() => {
    process.stderr.write('Paid custody operation failed; no raw diagnostics were exported.\n'); process.exitCode = 1;
  });
}
