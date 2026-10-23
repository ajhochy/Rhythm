import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { captureOwnedRoot, processIdentity, processIsAlive, stopExactProcess } from './web_paid_custody.mjs';
import { finishPaidControl, installedBrowserCache, observeChildExit, probePaidBrowser, sandboxEnvironment } from './run_web_paid.mjs';

function control(t) {
  const root = mkdtempSync('/private/tmp/rhythm-web-paid-browser-test-'); chmodSync(root, 0o700);
  mkdirSync(join(root, 'home'), { mode: 0o700 }); mkdirSync(join(root, 'tmp'), { mode: 0o700 });
  t.after(() => rmSync(root, { recursive: true, force: true })); return root;
}

test('private-HOME paid environment launches only the existing blank Chromium without installs or navigation', async t => {
  const root = control(t);
  const env = sandboxEnvironment({ fixtureRoot: '/private/tmp/rhythm-ai-fixture-synthetic',
    sourceRoot: '/private/tmp/rhythm-web-paid-sources-synthetic', sourceRevision: 'a'.repeat(40),
    ports: { api: 53981, engine: 53982, gateway: 53983 } }, root);
  assert.equal(env.PLAYWRIGHT_BROWSERS_PATH, installedBrowserCache());
  assert.equal(env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD, '1');
  const result = await probePaidBrowser(env);
  assert.deepEqual(result, { category: 'blank-browser-launched' });
});

test('exact watchdog exiting between liveness and identity checks cannot leave a fully scrubbed control root', async t => {
  const root = control(t), owner = captureOwnedRoot(root);
  writeFileSync(join(root, 'done.json'), JSON.stringify({ secretsScrubbed: true }), { mode: 0o600 });
  const proc = spawn(process.execPath, ['-e', 'process.stdin.once("data",()=>process.exit(0));'], { stdio: ['pipe', 'ignore', 'ignore'] });
  const exit = observeChildExit(proc);
  const exited = once(proc, 'exit'); await once(proc, 'spawn'); const watchdog = processIdentity(proc.pid);
  t.after(async () => { if (processIsAlive(watchdog.pid)) await stopExactProcess(watchdog); });
  await finishPaidControl(owner, watchdog, { roots: [{ root: '/already-scrubbed-synthetic' }] }, { exit, stop: async expected => {
    assert.deepEqual(expected, watchdog); proc.stdin.write('exit'); await exited;
    throw new Error('custody process changed'); // Kernel identity read lost the just-exited owned process.
  } });
  assert.equal(existsSync(root), false);
});

test('a still-live replaced watchdog identity continues to refuse control cleanup', async t => {
  const root = control(t), owner = captureOwnedRoot(root);
  writeFileSync(join(root, 'done.json'), JSON.stringify({ secretsScrubbed: true }), { mode: 0o600 });
  const proc = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  const exit = observeChildExit(proc);
  await once(proc, 'spawn'); const watchdog = processIdentity(proc.pid);
  t.after(async () => { if (processIsAlive(watchdog.pid)) await stopExactProcess(watchdog); });
  await assert.rejects(() => finishPaidControl(owner, { ...watchdog, start: 'replacement' }, { roots: [] }, { exit }), /custody process changed/);
  assert.equal(processIsAlive(watchdog.pid), true); assert.equal(existsSync(root), true);
});
