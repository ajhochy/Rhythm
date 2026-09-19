// Explicit opt-in: real Electron + existing isolated sandbox, no provider prompt or live stores.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '../../../web/node_modules/playwright/index.mjs';
import { expect } from '../../../web/node_modules/@playwright/test/index.mjs';
if (process.env.RHYTHM_LIVE_E2E !== '1') {
  console.log('SKIP: RHYTHM_LIVE_E2E=1 required');
  process.exit(0);
}
const root = resolve(import.meta.dirname, '../../../..');
const sb = process.env.RHYTHM_SANDBOX_DIR;
assert.ok(sb?.startsWith('/private/tmp/rhythm-session-opening-'), 'explicit owned sandbox required');
const api = 'http://127.0.0.1:4098', engine = 'http://127.0.0.1:4097';
const headers = { Authorization: 'Bearer e02-synthetic-session-not-a-secret', 'Content-Type': 'application/json' };
assert.equal((await (await fetch(api + '/opencode/health')).json()).status, 'ready');
const runtimePids = await Promise.all(['api_server.pid', 'opencode_engine.pid'].map(name => readFile(resolve(sb, name), 'utf8')));
const cwd = resolve(sb, 'navigation-workspace'); await mkdir(cwd, { recursive: true });
const records = [];
for (const suffix of ['A', 'B']) {
  const result = await fetch(api + '/agent-sessions', { method: 'POST', headers, body: JSON.stringify({ cwd, name: `Navigation specimen ${suffix}`, isolateWorktree: false, profileId: null }) });
  const session = await result.json();
  assert.equal(result.status, 201, JSON.stringify(session));
  assert.ok(session.id && session.sdkSessionId && session.id !== session.sdkSessionId);
  records.push(session);
}
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITE_') && key !== 'ELECTRON_RUN_AS_NODE'));
Object.assign(env, {
  HOME: resolve(sb, 'home'), TMPDIR: resolve(sb, 'tmp'),
  RHYTHM_SHELL_USER_DATA: resolve(sb, 'session-opening-electron'),
  RHYTHM_LIVE_API_URL: api, RHYTHM_LIVE_ENGINE_URL: engine,
  RHYTHM_PRODUCTION_API_URL: 'https://rhythm.invalid',
});
const executablePath = resolve(root, 'apps/electron/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const shell = resolve(root, 'apps/electron');
const url = id => `rhythm://app/index.html#/agents?sessionId=${encodeURIComponent(id)}`;
const baseArgs = [shell, '--interactive-smoke', '--allow-test-runtime-ports', '--use-mock-keychain'];
let app;
let browser;
const mutations = [];
try {
  app = spawn(executablePath, [...baseArgs, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', url(records[1].id)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let launchOutput = ''; app.stderr.on('data', data => { launchOutput += data; });
  let endpoint;
  for (let i = 0; i < 100; i++) {
    assert.equal(app.exitCode, null, launchOutput);
    endpoint = launchOutput.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/)?.[1];
    if (endpoint) break;
    await delay(100);
  }
  assert.ok(endpoint, launchOutput);
  console.log(`Candidate PID ${app.pid}; CDP ${endpoint}`);
  browser = await chromium.connectOverCDP(endpoint, { timeout: 15_000 });
  const context = browser.contexts()[0];
  await context.route('https://**', route => route.abort());
  const page = context.pages()[0] ?? await context.waitForEvent('page', { timeout: 10_000 });
  page.on('request', request => { if (!['GET', 'OPTIONS'].includes(request.method())) mutations.push(request.method() + ' ' + request.url()); });
  await expect(page.getByRole('heading', { name: records[1].name, exact: true })).toBeVisible({ timeout: 20_000 });
  const initialPid = app.pid;
  const receipt = { url: await page.evaluate(() => location.href), capabilities: JSON.parse(await readFile(resolve(root, 'apps/web/dist/desktop-capabilities.json'), 'utf8')) };
  assert.equal(receipt.url, url(records[1].id));
  assert.deepEqual(receipt.capabilities, { version: 1, agentSessionDeepLink: true });
  await page.screenshot({ path: resolve(sb, 'exact-session-initial.png') });
  const second = spawn(executablePath, [...baseArgs, url(records[0].id)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; second.stderr.on('data', data => { output += data; });
  const code = await new Promise((resolveExit, reject) => { second.on('error', reject); second.on('close', resolveExit); setTimeout(() => { if (second.exitCode === null) { second.kill('SIGTERM'); reject(new Error('second instance did not yield')); } }, 15_000).unref(); });
  assert.equal(code, 0, output);
  await expect(page.getByRole('heading', { name: records[0].name, exact: true })).toBeVisible({ timeout: 20_000 });
  assert.equal(app.pid, initialPid); assert.equal(context.pages().length, 1);
  await page.screenshot({ path: resolve(sb, 'exact-session-second-instance.png') });
  assert.deepEqual(mutations, [], 'opening sent a mutation');
  for (const session of records) {
    const detail = await (await fetch(`${api}/agent-sessions/${session.id}`, { headers })).json();
    assert.equal(detail.session.id, session.id); assert.equal(detail.session.sdkSessionId, session.sdkSessionId); assert.equal(detail.messages.length, 0);
  }
  await browser.close(); browser = undefined;
  app.kill('SIGTERM'); await new Promise(resolveExit => app.once('exit', resolveExit)); app = undefined;
  assert.deepEqual(await Promise.all(['api_server.pid', 'opencode_engine.pid'].map(name => readFile(resolve(sb, name), 'utf8'))), runtimePids);
  assert.equal((await (await fetch(api + '/opencode/health')).json()).status, 'ready');
  console.log(JSON.stringify({ result: 'PASS', target: 'source Electron app, real sandbox', initialRoute: receipt.url, capabilities: receipt.capabilities, secondInstanceExit: code, windows: 1, apiPid: runtimePids[0].trim(), enginePid: runtimePids[1].trim(), mutations: mutations.length, screenshots: ['exact-session-initial.png', 'exact-session-second-instance.png'].map(name => resolve(sb, name)) }, null, 2));
} finally {
  if (browser) await browser.close();
  if (app && app.exitCode === null) app.kill('SIGTERM');
}
