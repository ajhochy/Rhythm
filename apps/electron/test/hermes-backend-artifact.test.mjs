import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { resolveHermesBackendArtifact, resolveOptionalHermesBackendArtifact, refreshHermesBackendArtifactIntegrity } from '../src/hermes-backend-artifact.mjs';
import { stageHermesBackendArtifact } from '../scripts/package-mac.mjs';

const digest = (data) => createHash('sha256').update(data).digest('hex');
function fixture(t) {
  const root = mkdtempSync('/private/tmp/rhythm-hermes-backend-test-');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'source')); mkdirSync(join(root, 'python', 'bin'), { recursive: true }); mkdirSync(join(root, 'site-packages'));
  writeFileSync(join(root, 'hermes'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(root, 'source', 'uv.lock'), '[[package]]\nname = "example"\nversion = "1.0"\n');
  writeFileSync(join(root, 'python', 'bin', 'python3.12'), 'MachO', { mode: 0o755 });
  symlinkSync('python3.12', join(root, 'python', 'bin', 'python3'));
  writeFileSync(join(root, 'site-packages', 'module.py'), 'VALUE = 1\n');
  const files = {
    hermes: { sha256: digest(readFileSync(join(root, 'hermes'))) },
    'source/uv.lock': { sha256: digest(readFileSync(join(root, 'source', 'uv.lock'))) },
    'python/bin/python3.12': { sha256: digest(readFileSync(join(root, 'python', 'bin', 'python3.12'))) },
    'python/bin/python3': { link: 'python3.12' },
    'site-packages/module.py': { sha256: digest(readFileSync(join(root, 'site-packages', 'module.py'))) },
  };
  const manifest = { schemaVersion: 1, product: 'hermes-backend', sourceCommit: '23589566471dbd2068a0387c85a2cb85d4a7d737',
    uvLockSha256: files['source/uv.lock'].sha256, pythonVersion: '3.12.13', arch: process.arch,
    distributionCount: process.arch === 'x64' ? 72 : 73, licenseCount: process.arch === 'x64' ? 72 : 73,
    files, native: ['python/bin/python3.12'] };
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
  return { root, manifest };
}

test('bundled backend validates its exact executable, source pin, symlinks and exhaustive inventory', (t) => {
  const { root } = fixture(t);
  assert.equal(resolveHermesBackendArtifact(root).backendExecutablePath, join(root, 'hermes'));
  writeFileSync(join(root, 'site-packages', 'module.py'), 'VALUE = 2\n');
  assert.throws(() => resolveHermesBackendArtifact(root), /Hermes backend artifact/);
});

test('frozen distribution count is exact for Intel macOS and unknown architectures fail closed', (t) => {
  const { root, manifest } = fixture(t);
  const original = Object.getOwnPropertyDescriptor(process, 'arch');
  try {
    Object.defineProperty(process, 'arch', { ...original, value: 'x64' });
    manifest.arch = 'x64';
    manifest.distributionCount = 72;
    manifest.licenseCount = 72;
    writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
    assert.equal(resolveHermesBackendArtifact(root).manifest.distributionCount, 72);

    Object.defineProperty(process, 'arch', { ...original, value: 'riscv64' });
    manifest.arch = 'riscv64';
    writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
    assert.throws(() => resolveHermesBackendArtifact(root), /Hermes backend artifact/);
  } finally {
    Object.defineProperty(process, 'arch', original);
  }
});

test('present but invalid backend fails closed, including added files and escaping links', (t) => {
  const { root } = fixture(t);
  writeFileSync(join(root, 'source', 'extra.py'), 'x = 1\n');
  assert.throws(() => resolveHermesBackendArtifact(root), /Hermes backend artifact/);
  rmSync(join(root, 'source', 'extra.py'));
  rmSync(join(root, 'python', 'bin', 'python3'));
  symlinkSync('/bin/sh', join(root, 'python', 'bin', 'python3'));
  assert.throws(() => resolveHermesBackendArtifact(root), /Hermes backend artifact/);
});

test('only truly absent bundles permit legacy fallback', (t) => {
  const resources = mkdtempSync('/private/tmp/rhythm-hermes-resources-test-');
  t.after(() => rmSync(resources, { recursive: true, force: true }));
  assert.equal(resolveOptionalHermesBackendArtifact(resources), undefined);
  symlinkSync('/private/tmp/absent-hermes-backend', join(resources, 'hermes-backend'));
  assert.throws(() => resolveOptionalHermesBackendArtifact(resources), /Hermes backend artifact/);
});

test('native signing may refresh only listed native hashes after all other bytes verify', (t) => {
  const { root } = fixture(t);
  writeFileSync(join(root, 'python', 'bin', 'python3.12'), 'SignedMachO');
  assert.throws(() => resolveHermesBackendArtifact(root), /Hermes backend artifact/);
  refreshHermesBackendArtifactIntegrity(root);
  assert.equal(resolveHermesBackendArtifact(root).backendExecutablePath, join(root, 'hermes'));
  chmodSync(join(root, 'hermes'), 0o644);
  assert.throws(() => resolveHermesBackendArtifact(root), /Hermes backend artifact/);
  chmodSync(join(root, 'hermes'), 0o755);
  chmodSync(join(root, 'python', 'bin', 'python3.12'), 0o644);
  assert.throws(() => resolveHermesBackendArtifact(root), /Hermes backend artifact/);
});

test('packager stages only a verified pinned backend separate from the desktop factory', async (t) => {
  const { root } = fixture(t);
  const resources = mkdtempSync('/private/tmp/rhythm-hermes-resources-test-');
  t.after(() => rmSync(resources, { recursive: true, force: true }));
  const staged = await stageHermesBackendArtifact({ resources, artifactRoot: root });
  assert.equal(staged, join(resources, 'hermes-backend'));
  assert.equal(resolveHermesBackendArtifact(staged).backendExecutablePath, join(staged, 'hermes'));
  writeFileSync(join(root, 'source', 'uv.lock'), 'tampered\n');
  await assert.rejects(stageHermesBackendArtifact({ resources, artifactRoot: root }), /Hermes backend artifact/);
  assert.equal(resolveHermesBackendArtifact(staged).backendExecutablePath, join(staged, 'hermes'));
});
