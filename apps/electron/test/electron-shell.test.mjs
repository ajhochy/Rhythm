// Regression: a permissive asset resolver or preload bridge could expose files or Node APIs.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const shellRoot = resolve(here, '..');
const electron = resolve(shellRoot, 'node_modules/.bin/electron');
let smokeResult;

test('slice-5-c1: resolves only files under the packaged web dist', async () => {
  const { resolveAsset } = await import('../src/policy.mjs');
  assert.equal(resolveAsset('/index.html'), resolve(shellRoot, '../web/dist/index.html'));
  assert.equal(resolveAsset('/../package.json'), null);
  assert.equal(resolveAsset('/missing.js'), null);
});

test('slice-5-c2: rejects unknown hosts, unsupported methods, and malformed protocol paths', async () => {
  const { validateRequest } = await import('../src/policy.mjs');
  assert.equal(validateRequest({ host: 'app', method: 'GET', pathname: '/index.html' }), true);
  for (const request of [
    { host: 'other', method: 'GET', pathname: '/index.html' },
    { host: 'app', method: 'POST', pathname: '/index.html' },
    { host: 'app', method: 'GET', pathname: '/%2e%2e/package.json' },
  ]) assert.equal(validateRequest(request), false);
});

test('slice-5-c3: actual Electron launch loads the local agents route', async () => {
  const result = await smoke();
  assert.equal(result.url, 'rhythm://app/index.html#/agents');
});

test('slice-5-c4: actual preload exposes only frozen versioned lifecycle, gateway configuration, Google auth, human-approval signing, and agent-server status', async () => {
  const result = await smoke();
  assert.deepEqual(result.runtime, { apiBase: 'http://127.0.0.1:4001', engineBase: 'http://127.0.0.1:4096', testOverride: false });
  assert.deepEqual(result.bridge.keys, ['version', 'appVersion', 'platform', 'gateway', 'auth', 'humanApproval', 'agentServer']);
  assert.equal(result.bridge.frozen, true);
  assert.deepEqual(result.bridge.gateway.keys, ['apiBase', 'engineBase', 'productionApiBase', 'setProductionApiBase']);
  assert.equal(result.bridge.gateway.frozen, true);
  assert.deepEqual(result.bridge.gateway.configured, {
    apiBase: true,
    engineBase: true,
    productionApiBase: true,
  });
  assert.deepEqual(result.bridge.gateway.values, {
    apiBase: 'http://127.0.0.1:4001',
    engineBase: 'http://127.0.0.1:4096',
  });
  assert.deepEqual(result.bridge.auth.keys, ['signInWithGoogle']);
  assert.equal(result.bridge.auth.frozen, true);
  // post-m1-p7-c4e: a narrow, purpose-built surface only — never an arbitrary-sign primitive.
  assert.deepEqual(result.bridge.humanApproval.keys, ['capability', 'signDecision']);
  assert.equal(result.bridge.humanApproval.frozen, true);
  assert.deepEqual(result.bridge.agentServer.keys, ['status', 'onStatusChange']);
  assert.equal(result.bridge.agentServer.frozen, true);
  assert.equal(result.bridge.nodeExposed, false);
});

test('production repair: alternate local ports require an explicit smoke-only flag', async () => {
  const userData = await mkdtemp(resolve(tmpdir(), 'rhythm-electron-test-ports-'));
  try {
    const output = await runElectron(['.', '--smoke', '--allow-test-runtime-ports'], userData);
    assert.equal(output.code, 0, output.stderr);
    assert.deepEqual(JSON.parse(output.stdout.trim()).runtime, {
      apiBase: 'http://127.0.0.1:4098',
      engineBase: 'http://127.0.0.1:4097',
      testOverride: true,
    });
  } finally {
    await rm(userData, { recursive: true, force: true });
  }
});

test('slice-5-c5: actual shell denies navigation, popups, permissions, and downloads', async () => {
  const result = await smoke();
  assert.deepEqual(result.denials, { navigation: true, popup: true, permission: true, download: true });
  const missing = await runElectron(['.', '--smoke', '--missing-dist']);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /requires built web assets/);
});

test('production repair: actual Electron artifact protocol authenticates and executes a sandboxed frame', async () => {
  const userData = await mkdtemp(resolve(tmpdir(), 'rhythm-electron-artifact-'));
  try {
    const output = await runElectron(['.', '--smoke', '--artifact-frame-smoke'], userData);
    assert.equal(output.code, 0, output.stderr);
    const receipt = JSON.parse(output.stdout.trim());
    assert.deepEqual(receipt.artifactFrame, {
      loaded: true,
      protocol: 'rhythm-artifact:',
      bridge: {
        n: 'smoke-nonce',
        id: 'smoke-request',
        ok: true,
        data: { operation: 'list_service_types', data: { marker: 'host-round-trip' } },
      },
      request: {
        url: 'https://api.vcrcapps.com/live-artifacts/00000000-0000-4000-8000-000000000801/render',
        authenticated: true,
      },
    });
  } finally {
    await rm(userData, { recursive: true, force: true });
  }
});

async function smoke() {
  if (smokeResult) return smokeResult;
  const userData = await mkdtemp(resolve(tmpdir(), 'rhythm-electron-shell-'));
  try {
    const output = await runElectron(['.', '--smoke'], userData);
    if (output.code !== 0) throw new Error(`smoke exited ${output.code}: ${output.stderr}`);
    smokeResult = JSON.parse(output.stdout.trim());
    return smokeResult;
  } finally {
    await rm(userData, { recursive: true, force: true });
  }
}

async function runElectron(args, userData, env = {}) {
  // Always redirect userData to a harness-owned temp dir, even for launches that throw before
  // will-quit (e.g. --missing-dist): the app's own cleanup never runs on those paths, and an
  // un-redirected launch would write to ~/Library/Application Support/rhythm-electron-shell.
  const owned = userData ?? (await mkdtemp(resolve(tmpdir(), 'rhythm-electron-smoke-')));
  try {
    return await spawnElectron(args, owned, env);
  } finally {
    if (!userData) await rm(owned, { recursive: true, force: true });
  }
}

function spawnElectron(args, userData, overrides = {}) {
  return new Promise((resolvePromise, reject) => {
      const child = spawn(electron, args, {
        cwd: shellRoot,
        env: {
          ...process.env,
          RHYTHM_LIVE_API_URL: 'http://127.0.0.1:4098',
          RHYTHM_LIVE_ENGINE_URL: 'http://127.0.0.1:4097',
          RHYTHM_PRODUCTION_API_URL: 'https://api.vcrcapps.com',
          ...overrides,
          ...(userData ? { RHYTHM_SHELL_USER_DATA: userData } : {}),
        },
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
