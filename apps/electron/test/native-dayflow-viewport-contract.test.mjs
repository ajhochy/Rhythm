import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const baselineSourceRoot = '/Users/ajhochhalter/Documents/Codex/2026-10-04/task-4/native-dayflow-integration/Host';
const baselineHashes = {
  'NativeDayflowOwnedHostLifecycle.h': '944b2568be2da7a310324714885076d08facd78c31b7c10d99b58026e385d783',
  'NativeDayflowOwnedHostLifecycle.mm': '15426b7987b89773c0df74609efb02655f6b4cb7273b55146f6e7fcf0d9061a1',
};
const testSource = join(here, 'native-dayflow-viewport-contract.mm');
const selectedSource = process.env.RHYTHM_NATIVE_DAYFLOW_SOURCE ?? 'worktree';
const enabled = process.env.RHYTHM_NATIVE_DAYFLOW_CONTRACT === '1';

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function sourceRoot() {
  if (selectedSource === 'baseline') return baselineSourceRoot;
  if (selectedSource === 'worktree') return join(repoRoot, 'apps/electron/native/dayflow-host');
  throw new Error(`HARNESS_SETUP_ERROR|unsupported RHYTHM_NATIVE_DAYFLOW_SOURCE=${selectedSource}`);
}

function runCase(binary, criterion) {
  const result = spawnSync(binary, [criterion], { encoding: 'utf8', timeout: 15_000 });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  assert.equal(result.error, undefined, `native harness execution failed: ${result.error ?? ''}\n${output}`);
  assert.equal(result.signal, null, `native harness was interrupted by ${result.signal}\n${output}`);
  assert.notEqual(result.status, 2, `native harness setup/argument failure (not behavior RED)\n${output}`);
  assert.equal(result.status, 0, `native AppKit contract assertion failed (behavior RED)\n${output}`);
  assert.match(output, new RegExp(`NATIVE_CONTRACT_RESULT\\|${criterion}\\|PASS`));
}

if (!enabled) {
  describe('issue-1605 native Dayflow AppKit viewport contract', { skip: 'Set RHYTHM_NATIVE_DAYFLOW_CONTRACT=1 on macOS to compile and run the isolated AppKit lifecycle harness.' }, () => {});
} else if (process.platform !== 'darwin') {
  describe('issue-1605 native Dayflow AppKit viewport contract', { skip: 'The native lifecycle contract requires macOS AppKit.' }, () => {});
} else {
  describe('issue-1605 native Dayflow AppKit viewport contract', () => {
    let scratch;
    let binary;
    let output;

    before(() => {
      const src = sourceRoot();
      const header = join(src, 'NativeDayflowOwnedHostLifecycle.h');
      const lifecycle = join(src, 'NativeDayflowOwnedHostLifecycle.mm');
      for (const path of [header, lifecycle, testSource]) {
        assert.equal(statSync(path).isFile(), true, `HARNESS_SETUP_ERROR|missing source ${path}`);
      }
      if (selectedSource === 'baseline') {
        for (const [name, expected] of Object.entries(baselineHashes)) {
          assert.equal(sha256(join(src, name)), expected, `HARNESS_SETUP_ERROR|frozen baseline hash changed for ${name}`);
        }
      }

      scratch = mkdtempSync(join(tmpdir(), 'rhythm-native-dayflow-contract-'));
      binary = join(scratch, 'native-dayflow-viewport-contract');
      const compile = spawnSync('clang++', [
        '-std=c++17', '-fobjc-arc', '-fblocks',
        '-I', src,
        lifecycle,
        testSource,
        '-framework', 'AppKit',
        '-framework', 'Foundation',
        '-o', binary,
      ], { encoding: 'utf8', timeout: 60_000 });
      output = `${compile.stdout ?? ''}${compile.stderr ?? ''}`;
      assert.equal(compile.error, undefined, `HARNESS_SETUP_ERROR|clang++ could not start: ${compile.error ?? ''}\n${output}`);
      assert.equal(compile.status, 0, `HARNESS_SETUP_ERROR|native AppKit harness did not compile; this is not behavior RED\n${output}`);
      console.log(`NATIVE_DAYFLOW_SOURCE=${selectedSource}`);
      console.log(`NATIVE_DAYFLOW_LIFECYCLE_SHA256=${sha256(lifecycle)}`);
    });

    after(() => {
      if (scratch) rmSync(scratch, { recursive: true, force: true });
    });

    it('issue-1605-c1: keeps a 445-point native viewport while scrolling the full 558-point document', () => {
      runCase(binary, 'short');
    });

    it('issue-1605-c2: recomputes tall-to-short native content without stale clipping or excess tall scroll range', () => {
      runCase(binary, 'resize');
    });

    it('issue-1605-c3: confines scroll, modal visibility, and detach cleanup to the owned native view', () => {
      runCase(binary, 'ownership');
    });
  });
}
