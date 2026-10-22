import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { resolvePrivateEvaluationNpmCli, stagePinnedNpmRuntimeForEvaluation } from '../managed_npm_runtime';

const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex');
const roots: string[] = [];
afterEach(() => {
  delete process.env.RHYTHM_EVALUATION_WORKER;
  delete process.env.RHYTHM_EVALUATION_WORKER_ROOT;
  delete process.env.RHYTHM_EVALUATION_NPM_ROOT;
  delete process.env.RHYTHM_EVALUATION_NPM_TREE_SHA256;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): { node: string; worker: string; npmRoot: string; manifest: string } {
  const root = mkdtempSync('/private/tmp/rhythm-eval-npm-fixture-');
  const worker = mkdtempSync('/private/tmp/rhythm-eval-npm-worker-');
  roots.push(root, worker);
  const runtime = join(root, 'runtime');
  const npmRoot = join(runtime, 'lib', 'node_modules', 'npm');
  const node = join(runtime, 'bin', 'node');
  mkdirSync(join(npmRoot, 'bin'), { recursive: true });
  mkdirSync(join(runtime, 'bin'), { recursive: true });
  writeFileSync(node, 'test-only-node');
  writeFileSync(join(npmRoot, 'package.json'), JSON.stringify({ name: 'npm', version: '10.9.8' }));
  writeFileSync(join(npmRoot, 'bin', 'npm-cli.js'), 'test-only-cli');
  const files = ['bin/npm-cli.js', 'package.json'].map((path) => {
    const bytes = readFileSync(join(npmRoot, path));
    return { path, size: bytes.length, sha256: sha256(bytes) };
  });
  const manifest = join(runtime, 'npm-runtime-manifest.json');
  writeFileSync(manifest, JSON.stringify({ version: 1, nodeVersion: process.version,
    npmVersion: '10.9.8', nodeSourceSha256: sha256(readFileSync(node)),
    npmTreeSha256: sha256(JSON.stringify(files)), fileCount: files.length }));
  return { node, worker, npmRoot, manifest };
}

it('stages only manifest-pinned regular npm bytes and resolves them only in the private worker', () => {
  const input = fixture();
  const staged = stagePinnedNpmRuntimeForEvaluation(input.worker, input.node);
  process.env.RHYTHM_EVALUATION_WORKER = '1';
  process.env.RHYTHM_EVALUATION_WORKER_ROOT = input.worker;
  process.env.RHYTHM_EVALUATION_NPM_ROOT = staged.npmRoot;
  process.env.RHYTHM_EVALUATION_NPM_TREE_SHA256 = staged.treeSha256;
  expect(resolvePrivateEvaluationNpmCli()).toBe(join(staged.npmRoot, 'bin', 'npm-cli.js'));
  writeFileSync(join(staged.npmRoot, 'bin', 'npm-cli.js'), 'tampered');
  expect(resolvePrivateEvaluationNpmCli()).toBeNull();
});

it('rejects a changed source tree and symlinks even when a manifest is present', () => {
  const changed = fixture();
  writeFileSync(join(changed.npmRoot, 'bin', 'npm-cli.js'), 'changed');
  expect(() => stagePinnedNpmRuntimeForEvaluation(changed.worker, changed.node))
    .toThrow('sealed manifest');

  const linked = fixture();
  symlinkSync(join(linked.npmRoot, 'bin', 'npm-cli.js'), join(linked.npmRoot, 'linked-cli'));
  expect(() => stagePinnedNpmRuntimeForEvaluation(linked.worker, linked.node))
    .toThrow('link');
});

it('rejects a forged or missing manifest and refuses to fall back to host npm in a worker', () => {
  const input = fixture();
  const manifest = JSON.parse(readFileSync(input.manifest, 'utf8')) as Record<string, unknown>;
  manifest.npmVersion = '0.0.0';
  writeFileSync(input.manifest, JSON.stringify(manifest));
  expect(() => stagePinnedNpmRuntimeForEvaluation(input.worker, input.node))
    .toThrow('entry point');
  process.env.RHYTHM_EVALUATION_WORKER = '1';
  expect(resolvePrivateEvaluationNpmCli()).toBeNull();
});

it('refuses a non-active Node runtime outside the test seam', () => {
  const input = fixture();
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    expect(() => stagePinnedNpmRuntimeForEvaluation(input.worker, input.node))
      .toThrow('active pinned Node runtime');
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
