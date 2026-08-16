// CONTRACT TESTS — Slice 8. These must fail before the integrated verification entrypoint exists.
//
// Design note: the entrypoint is expensive (full web suite + live lifecycle + packaged Electron +
// parity, ~15 min). It is invoked EXACTLY ONCE here and every criterion asserts against that single
// run's summary artifact. Re-running per test would multiply cost with no added signal.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, '../../..');
const entrypoint = resolve(repositoryRoot, 'tools/validation/verify-all.mjs');
const summaryPath = resolve(repositoryRoot, 'dist/verification/summary.json');
const persistentUserData = resolve(homedir(), 'Library/Application Support', 'rhythm-electron-shell');

const REQUIRED_COMPONENTS = [
  'web:typecheck', 'web:build', 'web:fixture', 'web:suite', 'web:dist-smoke',
  'web:gateway-sessions', 'web:live-lifecycle', 'electron:shell', 'electron:packaged', 'parity',
];

function run(command, args, cwd, extraEnv = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ code, stdout, stderr }));
  });
}

// Single shared run, awaited by every criterion.
const verification = (async () => {
  if (!existsSync(entrypoint)) return { missing: true };
  const result = await run('node', [entrypoint], repositoryRoot);
  const summary = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : null;
  return { missing: false, result, summary };
})();

test('slice-8-c1: one command runs every verification component and fails if any component fails', async () => {
  // Regression caught: verification is a folklore checklist rather than one reproducible command.
  const state = await verification;
  assert.equal(state.missing, false, `slice-8-c1: missing integrated verification entrypoint at ${entrypoint}`);
  assert.equal(state.result.code, 0, `slice-8-c1: verification run exited ${state.result.code}\n${state.result.stderr.slice(-4000)}`);
  assert.ok(state.summary, 'slice-8-c1: verification run produced no summary artifact');
  const covered = state.summary.components.map((component) => component.name);
  for (const required of REQUIRED_COMPONENTS) {
    assert.ok(covered.includes(required), `slice-8-c1: verification set is missing required component ${required}`);
  }
  for (const component of state.summary.components) {
    assert.equal(component.status, 'pass', `slice-8-c1: component ${component.name} did not pass`);
  }
});

test('slice-8-c2: parity result is order-independent after the live/Playwright suites run', async () => {
  // Regression caught: Playwright artifacts and .agent-stack contaminate the hermetic parity corpus,
  // so parity passed or failed purely on execution order.
  const state = await verification;
  assert.equal(state.missing, false, `slice-8-c2: missing integrated verification entrypoint at ${entrypoint}`);
  const order = state.summary.components.map((component) => component.name);
  assert.ok(
    order.indexOf('parity') > order.indexOf('web:live-lifecycle'),
    'slice-8-c2: parity must run AFTER the live suite so contamination would be caught, not avoided',
  );
  const parity = state.summary.components.find((component) => component.name === 'parity');
  assert.equal(parity.status, 'pass', 'slice-8-c2: parity did not pass when run after the live suite');
  // The behavior taxonomy is the stable invariant; row counts legitimately grow as files are added,
  // so asserting a literal here would false-alarm on every new file. The parity component's own
  // hermetic byte-match already proves the fresh scan equals the published corpus.
  assert.equal(parity.counts.behaviors, 17, 'slice-8-c2: parity behavior taxonomy drifted');
  const published = readFileSync(resolve(repositoryRoot, 'docs/ai/coverage/react-electron/mappings.csv'), 'utf8')
    .split('\n').filter((line) => line.includes('review_required')).length;
  assert.equal(parity.counts.reviewRequired, published, 'slice-8-c2: generator review-required disagrees with the published corpus');
});

test('slice-8-c3: the run emits a machine-readable summary at a known path', async () => {
  // Regression caught: a gate can only tell pass from fail by scraping console text.
  const state = await verification;
  assert.equal(state.missing, false, `slice-8-c3: missing integrated verification entrypoint at ${entrypoint}`);
  assert.ok(existsSync(summaryPath), `slice-8-c3: no summary artifact at ${summaryPath}`);
  assert.equal(typeof state.summary.ok, 'boolean', 'slice-8-c3: summary lacks a top-level boolean ok');
  assert.ok(Array.isArray(state.summary.components), 'slice-8-c3: summary lacks a components array');
  for (const component of state.summary.components) {
    assert.equal(typeof component.name, 'string', 'slice-8-c3: component lacks a name');
    assert.ok(['pass', 'fail'].includes(component.status), `slice-8-c3: component ${component.name} has a non-binary status`);
    assert.equal(typeof component.durationMs, 'number', `slice-8-c3: component ${component.name} lacks durationMs`);
  }
});

test('slice-8-c4: the run leaves zero residue', async () => {
  // Regression caught: "zero leaks" reported while real worktrees and Electron userData survived.
  const state = await verification;
  assert.equal(state.missing, false, `slice-8-c4: missing integrated verification entrypoint at ${entrypoint}`);
  assert.equal(existsSync(resolve(repositoryRoot, 'apps/web/test-results')), false, 'slice-8-c4: apps/web/test-results survived the run');
  assert.equal(existsSync(persistentUserData), false, `slice-8-c4: persistent Electron userData survived at ${persistentUserData}`);
  assert.deepEqual(
    (await readdir(tmpdir())).filter((entry) => entry.startsWith('rhythm-electron-smoke-')),
    [],
    'slice-8-c4: isolated Electron userData directories survived the run',
  );
  const worktrees = await run('git', ['worktree', 'list'], repositoryRoot);
  assert.equal(worktrees.stdout.includes('smoke-'), false, 'slice-8-c4: smoke git worktrees survived the run');
  const branches = await run('git', ['branch', '--list', 'opencode/smoke-*'], repositoryRoot);
  assert.equal(branches.stdout.trim(), '', 'slice-8-c4: opencode/smoke-* branches survived the run');
  assert.deepEqual(state.summary.residue, {
    webTestResults: false, persistentUserData: false, smokeUserDataDirs: 0, smokeWorktrees: 0, smokeBranches: 0,
  }, 'slice-8-c4: summary reported residue');
  assert.equal(state.summary.engine.model, 'omlx/gpt-oss-20b-MXFP4-Q8', 'slice-8-c4: engine model was not restored');
  assert.equal(state.summary.engine.lmstudioAuth, false, 'slice-8-c4: lmstudio auth was left behind');
});

test('slice-8-c5: the run refuses protected ports and fails loudly without the sandbox', async () => {
  // Regression caught: silently degrading to fixtures, or touching AJ's live desktop on 4001/4096.
  const state = await verification;
  assert.equal(state.missing, false, `slice-8-c5: missing integrated verification entrypoint at ${entrypoint}`);
  assert.deepEqual(state.summary.protectedPorts, { contacted: [] }, 'slice-8-c5: the run contacted protected ports 4001/4096');
  assert.deepEqual(
    state.summary.sandbox,
    { api: 4098, engine: 4097, gateway: 4099, ready: true },
    'slice-8-c5: sandbox preflight was not recorded as ready on the expected ports',
  );
  // Point the entrypoint at a port nothing listens on: it must fail loudly, not fall back to fixtures.
  const withoutSandbox = await run('node', [entrypoint, '--preflight-only'], repositoryRoot, {
    RHYTHM_SANDBOX_API_PORT: '4', RHYTHM_SANDBOX_ENGINE_PORT: '5', RHYTHM_SANDBOX_GATEWAY_PORT: '6',
  });
  assert.notEqual(withoutSandbox.code, 0, 'slice-8-c5: the run succeeded with no sandbox listening');
  assert.match(
    `${withoutSandbox.stdout}${withoutSandbox.stderr}`,
    /sandbox/i,
    'slice-8-c5: the failure did not name the missing sandbox',
  );
});
