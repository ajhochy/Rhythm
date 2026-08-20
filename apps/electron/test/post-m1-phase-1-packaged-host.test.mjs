// Phase 1 packaged host-trust check. This is the half of post-m1-p1-c4c/c4e that a pure-function
// unit test cannot reach: the single-instance lock only exists once a real Electron app is running.
// It launches the PACKAGED binary twice against ONE shared userData directory, because Electron keys
// the lock on userData — two launches with separate userData dirs would both win and prove nothing.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { liveEnvironment } from '../../web/tests/live-environment.ts';

const here = dirname(fileURLToPath(import.meta.url));
const electronRoot = resolve(here, '..');
const packagedBinary = resolve(electronRoot, 'dist/Rhythm.app/Contents/MacOS/Rhythm');
const liveBases = liveEnvironment();
const sandboxEnvironment = {
  RHYTHM_LIVE_API_URL: liveBases.apiBase,
  RHYTHM_LIVE_ENGINE_URL: liveBases.engineBase,
  RHYTHM_PRODUCTION_API_URL: liveBases.productionApiBase,
};

test('post-m1-p1-c4e: a second packaged launch yields to the first instead of starting a second host', async () => {
  // Regression caught: the host takes no single-instance lock, so a second launch boots another
  // window, another protocol handler, and another set of listeners against the same userData.
  //
  // The two launches have to OVERLAP for the lock to be contended, and the smoke run is only ~1.2s,
  // so a single attempt is a race: a cold first launch can finish before the second starts, both
  // emit a receipt, and the run proves nothing. That outcome is INCONCLUSIVE, never a pass — it is
  // retried with a tighter gap. A host with no lock produces two receipts on every attempt and
  // therefore still fails, which was mutation-proved by replacing requestSingleInstanceLock() with
  // a constant `true` and rebuilding: every attempt reported two receipts and the test failed.
  const attempts = [250, 120, 60];
  const inconclusive = [];

  for (const gap of attempts) {
    const userData = mkdtempSync(resolve(tmpdir(), 'rhythm-electron-smoke-'));
    try {
      const first = launch(['--smoke'], userData);
      await delay(gap);
      const second = launch(['--smoke'], userData);
      const [a, b] = await Promise.all([first, second]);
      const receipts = [a, b].filter((result) => result.stdout.trim() !== '').length;

      if (receipts === 2) {
        inconclusive.push(`gap ${gap}ms: both launches ran, so they never overlapped`);
        continue;
      }
      assert.equal(receipts, 1, `post-m1-p1-c4e: expected exactly one launch to run, got ${receipts}\nfirst code ${a.code}: ${a.stderr.trim().slice(0, 300)}\nsecond code ${b.code}: ${b.stderr.trim().slice(0, 300)}`);
      // The yielding instance must exit cleanly rather than crash or linger.
      const yielded = a.stdout.trim() === '' ? a : b;
      assert.equal(yielded.code, 0, `post-m1-p1-c4e: the yielding launch exited ${yielded.code} instead of quitting cleanly\n${yielded.stderr.slice(0, 400)}`);
      return;
    } finally {
      rmSync(userData, { recursive: true, force: true });
    }
  }

  assert.fail(`post-m1-p1-c4e: never observed two overlapping launches contend for the lock, so single-instance behaviour is unproven:\n${inconclusive.join('\n')}`);
});

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function launch(args, userData) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(packagedBinary, args, {
      cwd: electronRoot,
      env: { ...process.env, ...sandboxEnvironment, RHYTHM_SHELL_USER_DATA: userData },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => { clearTimeout(timer); resolvePromise({ code, stdout, stderr }); });
  });
}
