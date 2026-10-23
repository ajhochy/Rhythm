import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cleanupControl, publicEvidence, sandboxEnvironment, summarizePlaywrightReport, writeBuildIdentity } from './run_web_paid.mjs';
import { artifactPaths, captureOwnedRoot, captureSourceHashes, checkoutRoot, digestArtifact,
  processIdentity, processIsAlive, stopExactProcess } from './web_paid_custody.mjs';

const revision = 'a'.repeat(40), sourceSha256 = 'b'.repeat(64);
const fake = 'synthetic-only-never-a-real-secret';
function root(t) {
  const dir = mkdtempSync('/private/tmp/rhythm-web-paid-unit-'); chmodSync(dir, 0o700);
  t.after(() => rmSync(dir, { recursive: true, force: true })); return dir;
}
const write = (file, value) => writeFileSync(file, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
async function child(t) {
  const proc = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', env: { PATH: '/usr/bin:/bin' } });
  const exited = once(proc, 'exit'); await once(proc, 'spawn');
  const owner = processIdentity(proc.pid);
  t.after(async () => { if (processIsAlive(owner.pid)) await stopExactProcess(owner, { graceMs: 300 }); });
  return { owner, exited };
}
function fixture(t) {
  const control = root(t), fixtureRoot = root(t), sourceRoot = root(t), original = root(t);
  const sourceFile = join(original, 'source.json'); write(sourceFile, { access: fake });
  write(join(fixtureRoot, 'borrowed.json'), { access: fake, refresh: '' });
  // Public runtime receipt is intentionally invalid/expired. Creator cleanup must not read it.
  write(join(fixtureRoot, 'web-paid-custody.json'), { tampered: true, stopAt: 1 });
  const receipt = { fixtureRoot, sourceRoot, sourceRevision: revision, ports: { api: 53981, engine: 53982, gateway: 53983 } };
  const state = { checkoutRoot, sourceRevision: revision, sourceSha256, caseIds: [91], provider: 'openai',
    fixtureRoot, sourceRoot, ports: receipt.ports, roots: [captureOwnedRoot(fixtureRoot), captureOwnedRoot(sourceRoot)],
    sourceHashes: captureSourceHashes([sourceFile]), sandboxEnv: sandboxEnvironment(receipt, control),
    testExitCode: 1, launchAttempted: true, issuedAt: 1, stopAt: 2, expires: 3, artifacts: {} };
  return { control, fixtureRoot, sourceRoot, original, sourceFile, state };
}

test('custody-05 runner environment has only explicit sandbox/qualification paths and existing paid opt-ins', () => {
  const fixtureRoot = '/private/tmp/rhythm-ai-fixture-synthetic', sourceRoot = '/private/tmp/rhythm-web-paid-sources-synthetic';
  const env = sandboxEnvironment({ fixtureRoot, sourceRoot, sourceRevision: revision,
    ports: { api: 53981, engine: 53982, gateway: 53983 } }, '/private/tmp/rhythm-web-paid-run-synthetic');
  assert.equal(env.RHYTHM_SANDBOX_ENGINE_DIR, join(checkoutRoot, 'apps/opencode_fork/packages/opencode'));
  assert.equal(env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST, join(fixtureRoot, 'manifest.json'));
  assert.equal(env.RHYTHM_LIVE_DB_PATH, join(sourceRoot, 'rhythm.db'));
  assert.equal(env.RHYTHM_EXPECTED_REVISION, revision);
  assert.equal(env.RHYTHM_FEATURE_EXPECTED_REVISION, revision);
  assert.equal(env.RHYTHM_FEATURE_MODEL, '1'); assert.equal(env.RHYTHM_LIVE_E2E, '1');
  for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENCODE_CONFIG_DIR', 'RHYTHM_OPENAI_ACCOUNTS_FILE']) assert.equal(env[key], undefined);
});

test('custody-08/09 actual canonical down precedes expired/tampered fixture scrub and exact helper-child exit', async t => {
  const setup = fixture(t), owned = await child(t);
  setup.state.testProcess = owned.owner;
  write(join(setup.control, 'state.json'), setup.state);
  const receipt = await cleanupControl(setup.control, 'deadline');
  await owned.exited;
  assert.equal(processIsAlive(owned.owner.pid), false);
  assert.equal(receipt.canonicalDown, true); assert.equal(receipt.secretsScrubbed, true);
  assert.equal(receipt.sourceUnchanged, true); assert.equal(receipt.reason, 'deadline');
  assert.equal(existsSync(setup.fixtureRoot), false); assert.equal(existsSync(setup.sourceRoot), false);
  assert.equal(JSON.parse(readFileSync(setup.sourceFile, 'utf8')).access === fake, true);
  assert.equal(JSON.stringify(receipt).includes(fake), false);
});

test('custody-04/09 failure cleanup audits changed original bytes but still scrubs borrowed fixtures', async t => {
  const setup = fixture(t);
  writeFileSync(setup.sourceFile, '{"access":"synthetic-changed-original"}');
  write(join(setup.control, 'state.json'), setup.state);
  const receipt = await cleanupControl(setup.control, 'failed');
  assert.equal(receipt.canonicalDown, true); assert.equal(receipt.secretsScrubbed, true);
  assert.equal(receipt.sourceUnchanged, false); assert.equal(receipt.exitCode, 1);
  assert.equal(existsSync(setup.fixtureRoot), false);
  assert.equal(readFileSync(setup.sourceFile, 'utf8').includes('synthetic-changed-original'), true);
});

test('custody-08 replaced runtime PID binding refuses down and retains exact-owned fixture for recovery', async t => {
  const setup = fixture(t), owned = await child(t);
  setup.state.runtimeProcesses = [{ ...owned.owner, start: 'replaced-start' }];
  write(join(setup.control, 'state.json'), setup.state);
  await assert.rejects(() => cleanupControl(setup.control, 'failed'), /custody cleanup failed/);
  assert.equal(processIsAlive(owned.owner.pid), true);
  assert.equal(existsSync(join(setup.fixtureRoot, 'borrowed.json')), true);
  const receipt = JSON.parse(readFileSync(join(setup.control, 'done.json'), 'utf8'));
  assert.equal(receipt.reason, 'cleanup-refused'); assert.equal(receipt.secretsScrubbed, false);
});

test('custody-10 result receipt drops raw logs, unknown artifact fields and arbitrary errors', () => {
  const paths = artifactPaths();
  const receipt = publicEvidence({ sourceRevision: revision, sourceSha256, caseIds: [91], provider: 'openai',
    rawLog: fake, error: { stack: fake }, sourceHashes: [{ bytes: fake }],
    artifacts: { api: { path: paths.api, sha256: 'c'.repeat(64), raw: fake }, arbitrary: { access: fake } } }, 1, fake);
  assert.equal(JSON.stringify(receipt).includes(fake), false);
  assert.equal(receipt.reason, 'failed');
  assert.deepEqual(Object.keys(receipt.artifacts), ['api']);
  assert.deepEqual(Object.keys(receipt.artifacts.api), ['path', 'sha256']);
});

test('custody-02 artifact tree identity changes when any runtime payload changes', t => {
  const dir = root(t); mkdirSync(join(dir, 'nested'), { mode: 0o700 });
  write(join(dir, 'server.js'), { synthetic: 'entry' }); write(join(dir, 'nested', 'controller.js'), { synthetic: 'controller' });
  const before = digestArtifact(dir);
  writeFileSync(join(dir, 'nested', 'controller.js'), '{"synthetic":"changed-controller"}');
  assert.notEqual(digestArtifact(dir), before);
});

test('custody-10 exact requested case IDs must each pass once; equal totals cannot hide wrong or duplicate cases', () => {
  const spec = (id, extra = {}) => ({ title: id < 109 ? `#${id}: synthetic case` : `[web-parity-${id}] synthetic case`,
    tests: [{ expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed', duration: 10 }], ...extra }] });
  const report = (...specs) => ({ suites: [{ specs }] });
  const passed = summarizePlaywrightReport(report(spec(91), spec(109)), [91, 109]);
  assert.equal(passed.passed, true);
  assert.deepEqual(passed.caseResults.map(row => [row.caseId, row.observed, row.status, row.attempts]), [[91, 1, 'passed', 1], [109, 1, 'passed', 1]]);
  for (const wrong of [report(spec(91), spec(91)), report(spec(91), spec(110)), report(spec(91)),
    report(spec(91), spec(109, { status: 'unexpected' })), report(spec(91), spec(109, { results: [{ status: 'skipped' }] })),
    report(spec(91), spec(109, { results: [{ status: 'failed' }, { status: 'passed' }] }))]) {
    assert.equal(summarizePlaywrightReport(wrong, [91, 109]).passed, false);
  }
  assert.equal(summarizePlaywrightReport({ suites: [{ specs: [{ title: '#91: listed', tests: [{}] }] }] }, [91], { discovery: true }).passed, true);
});

test('custody-10 corrupted metadata cannot place raw strings in the allowlisted receipt', () => {
  const result = publicEvidence({ sourceRevision: fake, sourceSha256: fake, caseIds: [fake, 91], provider: fake,
    startedAt: fake, issuedAt: fake, caseResults: [{ caseId: 91, status: fake, durationMs: fake, observed: fake, attempts: fake }],
    artifacts: { api: { path: fake, sha256: fake } } }, 1, fake);
  assert.equal(JSON.stringify(result).includes(fake), false);
});

test('custody-01 generated build stamp is owned atomic public metadata; links cannot redirect a write', t => {
  const dir = root(t), file = join(dir, 'build-identity.json'), other = join(dir, 'other.json');
  writeBuildIdentity(file, revision);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { schemaVersion: 1, sourceRevision: revision });
  writeBuildIdentity(file, 'b'.repeat(40));
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).sourceRevision, 'b'.repeat(40));
  write(other, { keep: true }); rmSync(file); symlinkSync(other, file);
  assert.throws(() => writeBuildIdentity(file, revision), /custody build stamp rejected/);
  assert.deepEqual(JSON.parse(readFileSync(other, 'utf8')), { keep: true });
  rmSync(file); linkSync(other, file);
  assert.throws(() => writeBuildIdentity(file, revision), /custody build stamp rejected/);
});

test('custody-06 only the seeded org run receives the explicitly pinned snapshot metadata', () => {
  const receipt = { fixtureRoot: '/private/tmp/rhythm-ai-fixture-synthetic', sourceRoot: '/private/tmp/rhythm-web-paid-sources-synthetic',
    sourceRevision: revision, ports: { api: 53981, engine: 53982, gateway: 53983 } };
  const snapshot = { snapshotPath: '/private/tmp/synthetic-snapshot.json', snapshotSha256: 'c'.repeat(64) };
  assert.equal(sandboxEnvironment(receipt, '/private/tmp/rhythm-web-paid-run-synthetic', snapshot).RHYTHM_ORG_EVALUATION_REAL_SNAPSHOT_PATH, undefined);
  const env = sandboxEnvironment({ ...receipt, orgSeedReceiptSha256: 'd'.repeat(64) }, '/private/tmp/rhythm-web-paid-run-synthetic', snapshot);
  assert.equal(env.RHYTHM_ORG_EVALUATION_REAL_SNAPSHOT_PATH, snapshot.snapshotPath);
  assert.equal(env.RHYTHM_ORG_EVALUATION_REAL_SNAPSHOT_SHA256, snapshot.snapshotSha256);
});

test('custody-10 diagnostics retain only an enumerated stage/category and a reviewed failing test site', () => {
  const path = 'apps/web/tests/web-host/web-host-paid-grid.spec.ts';
  const site = { path, line: 165, column: 9, errorKind: 'assertion' };
  const result = publicEvidence({ caseIds: [92], reviewedSpecs: [path], stage: 'cleanup', failureStage: 'test',
    failureCategory: 'test-failed', caseResults: [{ caseId: 92, status: 'failed', observed: 1, attempts: 1,
      failureSite: { ...site, message: fake, stack: fake, actual: fake } }], rawLog: fake }, 1, 'failed');
  assert.equal(result.stage, 'test'); assert.equal(result.category, 'test-failed');
  assert.deepEqual(result.caseResults[0].failureSite, site);
  assert.equal(JSON.stringify(result).includes(fake), false);
  for (const stage of ['buildapi', 'buildmcp', 'buildweb', 'buildengine', 'discovery', 'prepare', 'loan', 'startup', 'test', 'cleanup'])
    assert.equal(publicEvidence({ stage }, 1, 'failed').stage, stage);
  const tainted = publicEvidence({ caseIds: [92], reviewedSpecs: [path, fake], stage: fake, failureStage: fake,
    failureCategory: fake, caseResults: [{ caseId: 92, status: 'failed', failureSite: { path: fake, line: fake, column: fake, errorKind: fake } }] }, 1, 'failed');
  assert.equal(tainted.stage, undefined); assert.equal(tainted.category, undefined);
  assert.equal(tainted.caseResults[0].failureSite, undefined);
  assert.equal(JSON.stringify(tainted).includes(fake), false);
});

test('custody-10 report failure locations require the selected reviewed spec; raw error content never survives', () => {
  const path = 'apps/web/tests/web-host/web-host-paid-grid.spec.ts';
  const report = location => ({ suites: [{ specs: [{ title: `#92: ${fake}`, tests: [{ expectedStatus: 'passed', status: 'unexpected',
    results: [{ status: 'failed', duration: 1, stdout: [fake], errors: [{ name: 'AssertionError', message: fake, stack: fake,
      snippet: fake, value: fake, location }] }] }] }] }] });
  const good = summarizePlaywrightReport(report({ file: join(checkoutRoot, path), line: 165, column: 9 }), [92], { reviewedSpecs: [path] });
  assert.deepEqual(good.caseResults[0].failureSite, { path, line: 165, column: 9, errorKind: 'assertion' });
  assert.equal(JSON.stringify(good).includes(fake), false);
  for (const location of [{ file: fake, line: 1, column: 1 }, { file: path, line: fake, column: 1 },
    { file: path, line: 0, column: 1 }, { file: path, line: 1, column: -1 },
    { file: 'apps/web/tests/web-host/web-host-paid-coordinator-two-goal.spec.ts', line: 1, column: 1 }]) {
    const bad = summarizePlaywrightReport(report(location), [92], { reviewedSpecs: [path] });
    assert.equal(bad.caseResults[0].failureSite, undefined);
    assert.equal(JSON.stringify(bad).includes(fake), false);
  }
});

test('custody-10 successful canonical cleanup retains the bounded originating startup failure category', async t => {
  const setup = fixture(t);
  Object.assign(setup.state, { stage: 'startup', failureStage: 'startup', failureCategory: 'startup-process-exited' });
  write(join(setup.control, 'state.json'), setup.state);
  const receipt = await cleanupControl(setup.control, 'failed');
  assert.equal(receipt.stage, 'startup'); assert.equal(receipt.category, 'startup-process-exited');
  assert.equal(receipt.canonicalDown, true); assert.equal(receipt.secretsScrubbed, true);
});
