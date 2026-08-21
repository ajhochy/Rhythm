// CONTRACT TESTS — Slice 7 Unit 1. These must fail before packaging exists.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { liveEnvironment } from '../../web/tests/live-environment.ts';

const here = dirname(fileURLToPath(import.meta.url));
const electronRoot = resolve(here, '..');
const repositoryRoot = resolve(electronRoot, '../..');
const packageJsonPath = resolve(electronRoot, 'package.json');
const artifactRoot = resolve(electronRoot, 'dist/Rhythm.app');
const packagedBinary = resolve(artifactRoot, 'Contents/MacOS/Rhythm');
const sourceWebDist = resolve(electronRoot, '../web/dist');
const packagedWebDist = resolve(artifactRoot, 'Contents/Resources/app/web/dist');
const packageCommand = ['npm', ['run', 'package:mac']];
// Every poisoned value must be a string that can ONLY have come from the caller's environment.
// `fixture` was used here first and made the assertion unfalsifiable: the renderer legitimately
// contains that word because the app has a fixture mode, so the check failed whether or not
// packaging neutralized the caller. A sentinel that collides with real content proves nothing and
// blocks the fix it was written to verify.
const poisonedRendererEnvironment = {
  VITE_RHYTHM_GATEWAY_MODE: 'poisoned-gateway-mode-sentinel',
  VITE_RHYTHM_API_BASE: 'https://compiled-api.invalid',
  VITE_RHYTHM_ENGINE_BASE: 'https://compiled-engine.invalid',
  VITE_RHYTHM_LIVE_TOKEN: 'non-credential-build-sentinel',
};
const liveBases = liveEnvironment();
const sandboxEnvironment = {
  RHYTHM_LIVE_API_URL: liveBases.apiBase,
  RHYTHM_LIVE_ENGINE_URL: liveBases.engineBase,
  RHYTHM_PRODUCTION_API_URL: liveBases.productionApiBase,
};
// Electron derives userData from package.json `name`, so an un-redirected launch writes persistent
// state to ~/Library/Application Support/rhythm-electron-shell. That is the leak c6 must catch: the
// app's own will-quit cleanup loses a race with Chromium, which recreates directories before exit.
const persistentUserData = resolve(homedir(), 'Library/Application Support', 'rhythm-electron-shell');

test('slice-7-c1: one command produces the unsigned macOS app bundle', async () => {
  // Regression caught: packaging exists only as undocumented manual steps.
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  assert.equal(
    typeof packageJson.scripts?.['package:mac'],
    'string',
    'slice-7-c1: apps/electron is missing the single repeatable `npm run package:mac` command',
  );

  const result = await runWithoutAppleCredentials(...packageCommand);
  assert.equal(result.code, 0, `slice-7-c1: package command failed\n${result.stderr}`);
  await assertPathExists(artifactRoot, 'slice-7-c1: package command did not produce dist/Rhythm.app');
  await assertPathExists(packagedBinary, 'slice-7-c1: packaged app binary Contents/MacOS/Rhythm is absent');
  const signature = await run('codesign', ['--display', '--verbose=4', artifactRoot]);
  const signatureDetails = `${signature.stdout}\n${signature.stderr}`;
  assert.doesNotMatch(signatureDetails, /^Authority=/m, 'slice-7-c1: packaged app has a signing authority; only ad-hoc signing is allowed');
  assert.doesNotMatch(signatureDetails, /^TeamIdentifier=(?!not set$).+/m, 'slice-7-c1: packaged app has a team identity; Developer ID signing is forbidden');
  await assertTreeExcludes(
    packagedWebDist,
    Object.values(poisonedRendererEnvironment),
    'slice-7-c1: package command compiled caller-supplied gateway configuration into the renderer',
  );
});

test('slice-7-c2: packaged web assets byte-match apps/web/dist by SHA-256', async () => {
  // Regression caught: a stale renderer copy ships even though its file count matches.
  await assertPackagedBundle('slice-7-c2');
  const [sourceManifest, packagedManifest] = await Promise.all([
    sha256Manifest(sourceWebDist),
    sha256Manifest(packagedWebDist),
  ]);
  assert.deepEqual(
    packagedManifest,
    sourceManifest,
    'slice-7-c2: packaged web assets diverge from apps/web/dist by relative path or SHA-256',
  );
});

test('slice-7-c3: packaged binary registers rhythm before ready and loads the hardened agents window', async () => {
  // Regression caught: source smoke stays green while the packaged entry point loses protocol timing or hardening.
  await assertPackagedBundle('slice-7-c3');
  const receipt = await packagedSmoke(['--smoke']);
  assert.equal(receipt.protocol?.registeredBeforeReady, true, 'slice-7-c3: packaged rhythm protocol was not registered before ready');
  assert.equal(receipt.url, 'rhythm://app/index.html#/agents', 'slice-7-c3: packaged app did not load the agents route');
  assert.deepEqual(receipt.windowOptions?.webPreferences, {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
  }, 'slice-7-c3: packaged BrowserWindow options differ from the hardened Slice 5 contract');
});

test('slice-7-c4: packaged live smoke reaches Live and completes a real gateway read', async () => {
  // Regression caught: the package displays fixture data while claiming the sandbox is live.
  await assertPackagedBundle('slice-7-c4');
  const receipt = await packagedSmoke(['--smoke', '--live-smoke'], sandboxEnvironment);
  assert.equal(receipt.environment?.mode, 'Live', 'slice-7-c4: packaged environment receipt did not read `Live`');
  assert.match(receipt.liveRead?.url ?? '', new RegExp(`^${escapeRegExp(liveBases.apiBase)}/(agent-sessions|tasks)(?:[/?#]|$)`), 'slice-7-c4: no real sandbox /agent-sessions or /tasks read was recorded');
  assert.equal(receipt.liveRead?.status, 200, 'slice-7-c4: real live gateway read did not return HTTP 200');
  assert.equal(receipt.liveRead?.fixtureFallback, false, 'slice-7-c4: fixture fallback attempted to satisfy packaged live smoke');
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('slice-7-c5: packaged binary preserves renderer isolation and fail-closed policies', async () => {
  // Regression caught: security checks exercise source Electron while the shipped preload or policies are permissive.
  await assertPackagedBundle('slice-7-c5');
  const receipt = await packagedSmoke(['--smoke', '--security-smoke']);
  assert.equal(receipt.bridge?.nodeExposed, false, 'slice-7-c5: Node is exposed in the packaged renderer');
  assert.deepEqual(receipt.bridge?.keys, ['version', 'appVersion', 'platform', 'gateway', 'auth', 'humanApproval', 'agentServer'], 'slice-7-c5: packaged preload exposes capabilities beyond lifecycle, gateway metadata, Google auth, human-approval signing, and agent-server status');
  assert.equal(receipt.bridge?.frozen, true, 'slice-7-c5: packaged lifecycle object is not frozen');
  assert.deepEqual(receipt.bridge?.gateway?.keys, ['apiBase', 'engineBase', 'productionApiBase', 'setProductionApiBase'], 'slice-7-c5: packaged preload gateway configuration differs from the approved runtime values');
  assert.equal(receipt.bridge?.gateway?.frozen, true, 'slice-7-c5: packaged gateway metadata is not frozen');
  assert.deepEqual(receipt.bridge?.auth?.keys, ['signInWithGoogle'], 'slice-7-c5: packaged preload auth surface is broader than the approved Google sign-in capability');
  assert.equal(receipt.bridge?.auth?.frozen, true, 'slice-7-c5: packaged auth surface is not frozen');
  // post-m1-p7-c4e: a narrow, purpose-built surface only — never an arbitrary-sign primitive
  // (no raw key export, no "sign these bytes" method; only capability() and the fixed-shape
  // signDecision(approvalId, status, decisionNonce, payloadDigest)).
  assert.deepEqual(receipt.bridge?.humanApproval?.keys, ['capability', 'signDecision'], 'slice-7-c5: packaged preload human-approval surface is broader than capability+signDecision');
  assert.equal(receipt.bridge?.humanApproval?.frozen, true, 'slice-7-c5: packaged human-approval surface is not frozen');
  assert.deepEqual(receipt.bridge?.agentServer?.keys, ['status', 'onStatusChange'], 'slice-7-c5: packaged preload agent-server surface is broader than status+onStatusChange');
  assert.equal(receipt.bridge?.agentServer?.frozen, true, 'slice-7-c5: packaged agent-server surface is not frozen');
  assert.equal(Number.isInteger(receipt.bridge?.value?.version), true, 'slice-7-c5: packaged lifecycle object has no integer version');
  assert.deepEqual(receipt.denials, {
    navigation: true,
    popup: true,
    permission: true,
    download: true,
    malformedProtocol: true,
  }, 'slice-7-c5: one or more packaged security policies did not fail closed');
});

test('slice-7-c6: packaging is deterministic, gitignored, and leak-free', async () => {
  // Regression caught: reruns mutate the artifact or smoke leaves repository/runtime debris behind.
  await assertPackagedBundle('slice-7-c6');
  const ignored = await run('git', ['check-ignore', '-q', artifactRoot], repositoryRoot);
  assert.equal(ignored.code, 0, 'slice-7-c6: dist/Rhythm.app is not in a gitignored location');

  const beforeArtifact = await sha256Manifest(artifactRoot);
  const beforeBranches = await repositoryState('branch', ['branch', '--format=%(refname)']);
  const beforeWorktrees = await worktreePaths();
  const result = await run(...packageCommand);
  assert.equal(result.code, 0, `slice-7-c6: repeated package command failed\n${result.stderr}`);
  assert.deepEqual(await sha256Manifest(artifactRoot), beforeArtifact, 'slice-7-c6: repeated packaging changed the artifact byte manifest');

  assert.equal(existsSync(persistentUserData), false, `slice-7-c6: stale persistent userData exists before the smoke: ${persistentUserData}`);
  const receipt = await packagedSmoke(['--smoke', '--cleanup-smoke'], sandboxEnvironment);
  assert.deepEqual(receipt.cleanup, {
    disposableRows: 0,
    listeners: 0,
    worktrees: 0,
    branches: 0,
  }, 'slice-7-c6: packaged smoke reported leaked disposable state');
  // Independent of the app's self-reported counts: a packaged smoke must never write persistent
  // Electron state outside the isolated temp userData the harness owns.
  assert.equal(existsSync(persistentUserData), false, `slice-7-c6: packaged smoke leaked persistent userData at ${persistentUserData}`);
  assert.deepEqual(
    (await readdir(tmpdir())).filter((entry) => entry.startsWith('rhythm-electron-smoke-')),
    [],
    'slice-7-c6: packaged smoke left isolated userData directories behind',
  );
  assert.equal(await repositoryState('branch', ['branch', '--format=%(refname)']), beforeBranches, 'slice-7-c6: packaged smoke changed branches');
  assert.deepEqual(await worktreePaths(), beforeWorktrees, 'slice-7-c6: packaged smoke changed worktrees');
});

// Worktree PATHS only. `git worktree list --porcelain` also prints every worktree's HEAD sha, and
// this repository is checked out into eight worktrees driven by separate concurrent agents — so
// comparing the raw output asserted "nobody anywhere committed during the smoke" and went red for
// an unrelated commit in self-improvement/pg-column-drift while this smoke leaked nothing. A leaked
// worktree still adds a path, which this comparison catches.
async function worktreePaths() {
  const porcelain = await repositoryState('worktree', ['worktree', 'list', '--porcelain']);
  return porcelain.split('\n').filter((line) => line.startsWith('worktree ')).sort();
}

async function assertPackagedBundle(criterionId) {
  await assertPathExists(
    artifactRoot,
    `${criterionId}: packaged artifact dist/Rhythm.app is absent; implement packaging before this packaged-only criterion can run`,
  );
  await assertPathExists(
    packagedBinary,
    `${criterionId}: packaged binary Contents/MacOS/Rhythm is absent; source \`electron .\` cannot satisfy this criterion`,
  );
}

async function assertPathExists(path, message) {
  const exists = await stat(path).then(() => true, () => false);
  assert.equal(exists, true, message);
}

async function sha256Manifest(root) {
  await assertPathExists(root, `required manifest root is absent: ${root}`);
  const files = await listFiles(root);
  return Object.fromEntries(await Promise.all(files.map(async (path) => [
    relative(root, path),
    createHash('sha256').update(await readFile(path)).digest('hex'),
  ])));
}

async function listFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(root, entry.name);
    return entry.isDirectory() ? listFiles(path) : entry.isFile() ? [path] : [];
  }));
  return nested.flat().sort();
}

async function assertTreeExcludes(root, forbiddenValues, message) {
  for (const path of await listFiles(root)) {
    const bytes = await readFile(path);
    for (const value of forbiddenValues) assert.equal(bytes.includes(value), false, `${message}: ${relative(root, path)}`);
  }
}

async function packagedSmoke(args, extraEnvironment = {}) {
  // The harness owns userData for every launch and reaps it only after the process has fully exited,
  // so Chromium cannot recreate a directory after the app's own cleanup runs.
  const userData = mkdtempSync(resolve(tmpdir(), 'rhythm-electron-smoke-'));
  let result;
  try {
    result = await run(packagedBinary, args, electronRoot, {
      ...sandboxEnvironment,
      ...extraEnvironment,
      RHYTHM_SHELL_USER_DATA: userData,
    });
  } finally {
    rmSync(userData, { recursive: true, force: true });
  }
  assert.equal(result.code, 0, `packaged smoke exited ${result.code}\n${result.stderr}`);
  assert.notEqual(result.stdout.trim(), '', 'packaged smoke emitted no JSON receipt');
  try {
    return JSON.parse(result.stdout.trim());
  } catch (error) {
    assert.fail(`packaged smoke emitted invalid JSON: ${error.message}\n${result.stdout}`);
  }
}

async function repositoryState(label, args) {
  const result = await run('git', args, repositoryRoot);
  assert.equal(result.code, 0, `unable to read ${label} state: ${result.stderr}`);
  return result.stdout;
}

function run(command, args, cwd = electronRoot, extraEnvironment = {}, inheritEnvironment = true) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: inheritEnvironment ? { ...process.env, ...extraEnvironment } : extraEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ code, stdout, stderr }));
  });
}

function runWithoutAppleCredentials(command, args) {
  const environment = { ...process.env, ...poisonedRendererEnvironment };
  for (const key of [
    'APPLE_ID',
    'APPLE_APP_SPECIFIC_PASSWORD',
    'APPLE_TEAM_ID',
    'CSC_KEY_PASSWORD',
    'CSC_LINK',
  ]) delete environment[key];
  return run(command, args, electronRoot, environment, false);
}
