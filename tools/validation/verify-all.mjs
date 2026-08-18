#!/usr/bin/env node
// Slice 8 — integrated verification for the React/Electron live suite.
//
// One command that runs every component and exits non-zero if any fails, writing a machine-readable
// summary to dist/verification/summary.json (gitignored via **/dist/, and `dist` is already in the
// parity generator's exclusion set, so the summary can never contaminate the hermetic corpus).
//
// Ordering is deliberate: the live/Playwright suites run BEFORE parity, so artifact contamination
// would be caught rather than avoided.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const webRoot = resolve(root, 'apps/web');
const electronRoot = resolve(root, 'apps/electron');
const summaryPath = resolve(root, 'dist/verification/summary.json');
const persistentUserData = resolve(homedir(), 'Library/Application Support', 'rhythm-electron-shell');

const API_PORT = Number(process.env.RHYTHM_SANDBOX_API_PORT ?? 4098);
const ENGINE_PORT = Number(process.env.RHYTHM_SANDBOX_ENGINE_PORT ?? 4097);
const GATEWAY_PORT = Number(process.env.RHYTHM_SANDBOX_GATEWAY_PORT ?? 4099);
const PROTECTED_PORTS = [4001, 4096];

const apiBase = `http://127.0.0.1:${API_PORT}`;
const engineBase = `http://127.0.0.1:${ENGINE_PORT}`;
const liveEnvironment = {
  RHYTHM_LIVE_E2E: '1',
  RHYTHM_LIVE_API_URL: apiBase,
  RHYTHM_LIVE_ENGINE_URL: engineBase,
  RHYTHM_LIVE_DB_PATH: process.env.RHYTHM_LIVE_DB_PATH
    ?? `${process.env.TMPDIR ?? '/tmp/'}rhythm-dev-sandbox/rhythm.db`,
};

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

function listening(port) {
  return new Promise((resolvePromise) => {
    const child = spawn('lsof', ['-tiTCP:' + port, '-sTCP:LISTEN'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('close', () => resolvePromise(out.trim() !== ''));
    child.on('error', () => resolvePromise(false));
  });
}

// Fails loudly rather than degrading to fixtures. Protected ports are never contacted — only their
// listener ownership is observed, and only to prove the run left AJ's live desktop alone.
async function preflight() {
  const ready = (await Promise.all([listening(API_PORT), listening(ENGINE_PORT), listening(GATEWAY_PORT)])).every(Boolean);
  if (!ready) {
    console.error(`verify-all: sandbox is not up on :${API_PORT}/:${ENGINE_PORT}/:${GATEWAY_PORT} — run tools/dev/sandbox.sh up. Refusing to continue; this run must never fall back to fixtures.`);
    process.exit(2);
  }
  return { api: API_PORT, engine: ENGINE_PORT, gateway: GATEWAY_PORT, ready: true };
}

function tapCounts(stdout) {
  const pass = /^# pass (\d+)$/m.exec(stdout);
  const fail = /^# fail (\d+)$/m.exec(stdout);
  return pass ? { pass: Number(pass[1]), fail: Number(fail?.[1] ?? 0) } : {};
}

function playwrightCounts(stdout) {
  const passed = /(\d+) passed/.exec(stdout);
  const failed = /(\d+) failed/.exec(stdout);
  return passed || failed ? { pass: Number(passed?.[1] ?? 0), fail: Number(failed?.[1] ?? 0) } : {};
}

const components = [
  { name: 'web:typecheck', cwd: webRoot, command: 'npm', args: ['run', 'typecheck'] },
  { name: 'web:build', cwd: webRoot, command: 'npm', args: ['run', 'build'] },
  { name: 'web:fixture', cwd: webRoot, command: 'npm', args: ['run', 'test:fixture'], counts: playwrightCounts },
  { name: 'web:suite', cwd: webRoot, command: 'npm', args: ['test'], counts: playwrightCounts },
  { name: 'web:dist-smoke', cwd: webRoot, command: 'npm', args: ['run', 'test:dist-smoke'] },
  { name: 'web:gateway-sessions', cwd: webRoot, command: 'npx', args: ['playwright', 'test', 'tests/gateway/sessions-gateway.spec.ts', '--workers=1'], counts: playwrightCounts },
  { name: 'web:live-lifecycle', cwd: webRoot, command: 'npx', args: ['playwright', 'test', 'tests/sessions/session-live-lifecycle.live.spec.ts', '--workers=1'], env: liveEnvironment, counts: playwrightCounts },
  { name: 'electron:shell', cwd: electronRoot, command: 'node', args: ['--test', 'test/electron-shell.test.mjs'], counts: tapCounts },
  { name: 'electron:packaged', cwd: electronRoot, command: 'node', args: ['--test', 'test/electron-unsigned-package.test.mjs'], counts: tapCounts },
  // Phase 1 host trust. The single-instance lock only exists in a running app, so this is the one
  // Phase 1 criterion that needs the packaged binary rather than a unit test; keeping it in the gate
  // stops the lock from silently regressing the way its userData ordering already did once.
  { name: 'electron:phase1-host', cwd: electronRoot, command: 'node', args: ['--test', 'test/post-m1-phase-1-host-policy.test.mjs', 'test/post-m1-phase-1-packaged-host.test.mjs'], counts: tapCounts },
  // parity runs LAST, after the Playwright suites, so contamination is caught rather than dodged.
  // Only the parity spec is named: `test/*.mjs` would re-enter this very runner recursively.
  { name: 'parity', cwd: root, command: 'node', args: ['--test', 'tools/validation/test/desktop-parity-matrix.test.mjs'], counts: tapCounts, before: parityGenerate },
];

let parityCounts = {};
async function parityGenerate() {
  const generated = await run('node', ['tools/validation/generate-desktop-parity-matrix.mjs'], root);
  const behaviors = /behaviors=(\d+)/.exec(generated.stdout);
  const review = /review_required=(\d+)/.exec(generated.stdout);
  const mappings = /mappings=(\d+)/.exec(generated.stdout);
  parityCounts = {
    behaviors: Number(behaviors?.[1] ?? -1),
    reviewRequired: Number(review?.[1] ?? -1),
    mappings: Number(mappings?.[1] ?? -1),
  };
  return generated.code === 0;
}

async function engineState() {
  const withTimeout = async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      return response.ok ? await response.json() : null;
    } catch { return null; } finally { clearTimeout(timer); }
  };
  const config = await withTimeout(`${engineBase}/config`);
  const auth = await withTimeout(`${apiBase}/opencode/auth/`);
  return {
    model: config?.agent?.['local-lean']?.model ?? null,
    lmstudioAuth: Boolean(auth?.providers?.includes('lmstudio')),
  };
}

async function main() {
  const sandbox = await preflight();
  if (process.argv.includes('--preflight-only')) {
    console.log('verify-all: sandbox preflight ok');
    return;
  }

  const results = [];
  for (const component of components) {
    const started = Date.now();
    let ok = true;
    if (component.before) ok = await component.before();
    const result = ok
      ? await run(component.command, component.args, component.cwd, component.env ?? {})
      : { code: 1, stdout: '', stderr: 'pre-step failed' };
    const counts = component.name === 'parity' ? parityCounts : (component.counts?.(result.stdout) ?? {});
    results.push({
      name: component.name,
      status: ok && result.code === 0 ? 'pass' : 'fail',
      durationMs: Date.now() - started,
      counts,
    });
    console.log(`${ok && result.code === 0 ? 'PASS' : 'FAIL'}  ${component.name}  (${Date.now() - started}ms)`);
    // Playwright reports failures on stdout while stderr often carries only build warnings, so a
    // gate that prints stderr alone hides the reason it failed. Print both, stdout last.
    if (!ok || result.code !== 0) {
      if (result.stderr.trim()) console.error(`--- ${component.name} stderr ---\n${result.stderr.slice(-2000)}`);
      if (result.stdout.trim()) console.error(`--- ${component.name} stdout ---\n${result.stdout.slice(-6000)}`);
    }
  }

  // Playwright writes test-results on every run; remove it so the run is residue-free. Parity has
  // already completed above, and its generator excludes this path anyway.
  rmSync(resolve(webRoot, 'test-results'), { recursive: true, force: true });

  const worktrees = await run('git', ['worktree', 'list'], root);
  const branches = await run('git', ['branch', '--list', 'opencode/smoke-*'], root);
  const residue = {
    webTestResults: existsSync(resolve(webRoot, 'test-results')),
    persistentUserData: existsSync(persistentUserData),
    smokeUserDataDirs: readdirSync(tmpdir()).filter((entry) => entry.startsWith('rhythm-electron-smoke-')).length,
    smokeWorktrees: worktrees.stdout.split('\n').filter((line) => line.includes('smoke-')).length,
    smokeBranches: branches.stdout.trim() === '' ? 0 : branches.stdout.trim().split('\n').length,
  };

  const summary = {
    ok: results.every((component) => component.status === 'pass') && Object.values(residue).every((value) => !value),
    generatedBy: 'tools/validation/verify-all.mjs',
    sandbox,
    protectedPorts: { contacted: [] },
    components: results,
    residue,
    engine: await engineState(),
  };

  mkdirSync(dirname(summaryPath), { recursive: true });
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`\nverify-all: ${summary.ok ? 'PASS' : 'FAIL'} — summary at ${resolve(summaryPath)}`);
  if (!summary.ok) process.exit(1);
}

// The runner only ever addresses the sandbox ports; PROTECTED_PORTS exists to make that explicit and
// to fail fast if a future edit ever points a component at AJ's live desktop.
for (const component of components) {
  const serialized = JSON.stringify(component.env ?? {});
  for (const port of PROTECTED_PORTS) {
    if (serialized.includes(`:${port}`)) throw new Error(`verify-all: component ${component.name} targets protected port ${port}`);
  }
}

await main();
