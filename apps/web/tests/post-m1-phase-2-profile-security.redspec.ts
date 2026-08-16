import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

const packaged = process.env.RHYTHM_PACKAGED_PROFILE_E2E === '1';
test.skip(!packaged, 'pending orchestrator-run packaged profile/provider check');
test.setTimeout(120_000);

const packagedBinary = resolve(
  import.meta.dirname,
  '../../electron/dist/Rhythm.app/Contents/MacOS/Rhythm',
);
const forbiddenDisclosure = /(bearer\s+[a-z0-9._-]+|api[_-]?key|authorization\s*code|secret|\/Users\/|\/home\/|[A-Z]:\\|opencode\.json|auth\.json|<!doctype|<html|\bat\s+\S+\([^)]*:\d+:\d+\))/i;

type Receipt = {
  bridge?: { keys?: string[]; frozen?: boolean; nodeExposed?: boolean };
  profileSecurity?: {
    operations?: string[];
    renderedText?: string;
    diagnostics?: string;
  };
};

async function packagedReceipt(): Promise<Receipt> {
  const child = spawn(packagedBinary, ['--smoke', '--profile-security-smoke'], {
    cwd: resolve(import.meta.dirname, '../../electron'),
    env: {
      ...process.env,
      RHYTHM_LIVE_API_URL: 'http://127.0.0.1:4098',
      RHYTHM_LIVE_ENGINE_URL: 'http://127.0.0.1:4097',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += String(chunk); });
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  const code = await new Promise<number | null>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', resolveExit);
  });
  expect(code, `packaged profile-security smoke failed: ${stderr}`).toBe(0);
  const line = stdout.trim().split('\n').findLast((entry) => entry.trim().startsWith('{'));
  expect(line, `packaged smoke emitted no JSON receipt: ${stdout}`).toBeTruthy();
  return JSON.parse(line!) as Receipt;
}

test.describe.serial('packaged Phase 2 profile/provider security', () => {
  let receipt: Receipt;

  test.beforeAll(async () => {
    // The file-level test.setTimeout does not cover hooks, so this hook inherited the config's 20s
    // budget while a packaged launch plus a scripted profile CRUD pass takes longer. That produced a
    // "beforeAll hook timeout" which reads exactly like a product failure and is not one. Only the
    // observation window changes; every assertion below is unchanged.
    test.setTimeout(180_000);
    receipt = await packagedReceipt();
  });

  test('post-m1-p2-c4a: packaged profile CRUD exposes only approved gateway operations', () => {
    // Regression caught: renderer profile controls gain arbitrary engine-config, filesystem, or
    // credential-store calls; the exact packaged receipt allowlist assertion fails.
    expect(receipt.profileSecurity?.operations).toEqual([
      'GET /agent-configs',
      'POST /agent-configs',
      'PATCH /agent-configs/:id',
      'DELETE /agent-configs/:id',
      'POST /agent-sessions {profileId}',
    ]);
    expect(receipt.profileSecurity?.operations?.join('\n') ?? '').not.toMatch(
      /\/opencode\/(?:config|auth)|credential|filesystem/i,
    );
  });

  test('post-m1-p2-c4b: packaged profile/provider rendering bounds and redacts failures', () => {
    // Regression caught: a raw provider/config error is rendered verbatim; the length or forbidden
    // disclosure assertion fails.
    const text = receipt.profileSecurity?.renderedText ?? '';
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThanOrEqual(280);
    expect(text).not.toMatch(forbiddenDisclosure);
  });

  test('post-m1-p2-c4c: packaged preload and diagnostics expose no secret-bearing surface', () => {
    // Regression caught: the packaged preload grows credential/config/path operations or renderer
    // diagnostics expose their values; the frozen key list or disclosure assertion fails.
    expect(receipt.bridge).toMatchObject({
      keys: ['version', 'appVersion', 'platform'],
      frozen: true,
      nodeExposed: false,
    });
    expect(receipt.profileSecurity?.diagnostics ?? '').not.toMatch(forbiddenDisclosure);
    expect(receipt.profileSecurity?.diagnostics?.length ?? 0).toBeGreaterThan(0);
    expect(receipt.profileSecurity?.diagnostics?.length ?? 0).toBeLessThanOrEqual(280);
  });
});
