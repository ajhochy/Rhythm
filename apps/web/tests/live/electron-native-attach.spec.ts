import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertCandidateExecutablePath, assertCandidatePayloadIdentity, assertCandidateProcessIdentity, assertDisposableUserDataRoot, isExpectedNativeLiveRoute } from './electron-native-test';
import { usesNativeAxeLegacyMode } from '../helpers/list-inspector';

const candidate = '/private/tmp/candidate/Rhythm.app/Contents/MacOS/Rhythm';
const relativeCommand = '501 ./dist/Rhythm.app/Contents/MacOS/Rhythm --interactive-smoke';

function sourceCommitFor(marker: string): string {
  return createHash('sha1').update(marker).digest('hex');
}

function sealManifest(appRoot: string, sourceCommit: string): void {
  const artifactRoot = path.join(appRoot, 'Contents/Resources/hermes-desktop');
  const integrity = Object.fromEntries([
    'electron/embedded-host.mjs',
    'electron/preload.cjs',
    'renderer/index.html',
  ].map((relativePath) => [relativePath, `sha256-${createHash('sha256').update(readFileSync(path.join(artifactRoot, relativePath))).digest('base64')}`]));
  writeFileSync(path.join(artifactRoot, 'manifest.json'), JSON.stringify({
    electronMajor: 40,
    files: { host: 'electron/embedded-host.mjs', preload: 'electron/preload.cjs', renderer: 'renderer/index.html' },
    integrity,
    product: 'hermes-desktop',
    schemaVersion: 1,
    sourceCommit,
  }));
}

function writePayload(appRoot: string, marker: string): string {
  const files = [
    ['Contents/MacOS/Rhythm', 'executable'],
    ['Contents/Resources/app/src/runtime-config.mjs', `${marker}:runtime-config`],
    ['Contents/Resources/app/src/main.mjs', `${marker}:main`],
    ['Contents/Resources/app/src/hermes-view.mjs', `${marker}:view`],
    ['Contents/Resources/app/web/dist/index.html', `${marker}:web-index`],
    ['Contents/Resources/app/web/dist/assets/main.js', `${marker}:web-main`],
    ['Contents/Resources/hermes-desktop/electron/embedded-host.mjs', `${marker}:host`],
    ['Contents/Resources/hermes-desktop/electron/preload.cjs', `${marker}:preload`],
    ['Contents/Resources/hermes-desktop/renderer/index.html', `${marker}:renderer`],
  ];
  for (const [relativePath, content] of files) {
    const target = path.join(appRoot, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  sealManifest(appRoot, sourceCommitFor(marker));
  return path.join(appRoot, 'Contents/MacOS/Rhythm');
}

test('native attach accepts relative argv0 when the loaded executable is the owned candidate', () => {
  expect(() => assertCandidateProcessIdentity(
    relativeCommand,
    `p35525\nftxt\nn${candidate}\nftxt\nn/usr/lib/dyld\n`,
    candidate,
    501,
  )).not.toThrow();
});

test('native attach rejects a different loaded executable despite a plausible argv0', () => {
  expect(() => assertCandidateProcessIdentity(
    relativeCommand,
    'p35525\nftxt\nn/Applications/Rhythm.app/Contents/MacOS/Rhythm\n',
    candidate,
    501,
  )).toThrow(/owned packaged Rhythm executable/);
});

test('native attach rejects the candidate path when it is only a secondary mapped file', () => {
  expect(() => assertCandidateProcessIdentity(
    relativeCommand,
    `p35525\nftxt\nn/Applications/Rhythm.app/Contents/MacOS/Rhythm\nftxt\nn${candidate}\n`,
    candidate,
    501,
  )).toThrow(/owned packaged Rhythm executable/);
});

test('native attach rejects a different process owner', () => {
  expect(() => assertCandidateProcessIdentity(
    relativeCommand,
    `p35525\nftxt\nn${candidate}\n`,
    candidate,
    502,
  )).toThrow(/owned packaged Rhythm executable/);
});

test('native attach accepts the canonical private var folders disposable root', () => {
  expect(() => assertDisposableUserDataRoot('/private/var/folders/ab/candidate-user-data')).not.toThrow();
});

test('native attach rejects a non-disposable user-data root', () => {
  expect(() => assertDisposableUserDataRoot('/Users/ajhochhalter/Library/Application Support/Rhythm')).toThrow(/disposable userData/);
});

test('native attach accepts a selection query on the requested hash route only', () => {
  expect(isExpectedNativeLiveRoute(
    'rhythm://app/index.html#/projects/templates?projectId=project-template-1',
    '/projects/templates',
  )).toBe(true);
});

test('native attach rejects another document, outer query, and a different hash route', () => {
  expect(isExpectedNativeLiveRoute('rhythm://app/other.html#/projects/templates', '/projects/templates')).toBe(false);
  expect(isExpectedNativeLiveRoute('rhythm://app/index.html?projectId=1#/projects/templates', '/projects/templates')).toBe(false);
  expect(isExpectedNativeLiveRoute('rhythm://app/index.html#/settings?projectId=1', '/projects/templates')).toBe(false);
});

test('native attach enables legacy axe transport only for the Rhythm document', () => {
  expect(usesNativeAxeLegacyMode('rhythm://app/index.html#/projects')).toBe(true);
  expect(usesNativeAxeLegacyMode('http://127.0.0.1:4173/#/projects')).toBe(false);
  expect(usesNativeAxeLegacyMode('rhythm://app/other.html#/projects')).toBe(false);
});

test('native attach accepts the exact installed candidate when its source-bearing payload matches this worktree', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'rhythm-native-candidate-'));
  try {
    const expected = writePayload(path.join(root, 'worktree/Rhythm.app'), 'same');
    const installed = writePayload(path.join(root, 'Applications/Rhythm Mega Desktop Candidate.app'), 'same');
    await expect(assertCandidatePayloadIdentity(installed, expected, installed)).resolves.toBeUndefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('native attach rejects the exact installed candidate when any source-bearing payload differs', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'rhythm-native-candidate-'));
  try {
    const expected = writePayload(path.join(root, 'worktree/Rhythm.app'), 'expected');
    const installed = writePayload(path.join(root, 'Applications/Rhythm Mega Desktop Candidate.app'), 'expected');
    writeFileSync(path.join(root, 'Applications/Rhythm Mega Desktop Candidate.app/Contents/Resources/app/src/main.mjs'), 'different payload');
    sealManifest(path.join(root, 'Applications/Rhythm Mega Desktop Candidate.app'), sourceCommitFor('expected'));
    await expect(assertCandidatePayloadIdentity(installed, expected, installed)).rejects.toThrow(/payload does not match this worktree/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('native attach rejects an installed candidate with changed runtime config or web payload', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'rhythm-native-candidate-'));
  try {
    const expected = writePayload(path.join(root, 'worktree/Rhythm.app'), 'expected');
    const installedRoot = path.join(root, 'Applications/Rhythm Mega Desktop Candidate.app');
    const installed = writePayload(installedRoot, 'expected');
    writeFileSync(path.join(installedRoot, 'Contents/Resources/app/src/runtime-config.mjs'), 'different runtime config');
    await expect(assertCandidatePayloadIdentity(installed, expected, installed)).rejects.toThrow(/payload does not match this worktree/);
    writeFileSync(path.join(installedRoot, 'Contents/Resources/app/src/runtime-config.mjs'), 'expected:runtime-config');
    writeFileSync(path.join(installedRoot, 'Contents/Resources/app/web/dist/assets/main.js'), 'different web payload');
    await expect(assertCandidatePayloadIdentity(installed, expected, installed)).rejects.toThrow(/payload does not match this worktree/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('native attach rejects a corrupt or source-mismatched Hermes artifact manifest', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'rhythm-native-candidate-'));
  try {
    const expected = writePayload(path.join(root, 'worktree/Rhythm.app'), 'expected');
    const installedRoot = path.join(root, 'Applications/Rhythm Mega Desktop Candidate.app');
    const installed = writePayload(installedRoot, 'expected');
    writeFileSync(path.join(installedRoot, 'Contents/Resources/hermes-desktop/manifest.json'), '{not json');
    await expect(assertCandidatePayloadIdentity(installed, expected, installed)).rejects.toThrow(/manifest is unreadable/);
    sealManifest(installedRoot, sourceCommitFor('different'));
    await expect(assertCandidatePayloadIdentity(installed, expected, installed)).rejects.toThrow(/different source commit/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('native attach rejects a resealed Hermes host bundle that differs from this worktree', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'rhythm-native-candidate-'));
  try {
    const expected = writePayload(path.join(root, 'worktree/Rhythm.app'), 'expected');
    const installedRoot = path.join(root, 'Applications/Rhythm Mega Desktop Candidate.app');
    const installed = writePayload(installedRoot, 'expected');
    writeFileSync(path.join(installedRoot, 'Contents/Resources/hermes-desktop/electron/embedded-host.mjs'), 'different host bundle');
    sealManifest(installedRoot, sourceCommitFor('expected'));
    await expect(assertCandidatePayloadIdentity(installed, expected, installed)).rejects.toThrow(/Hermes source payload does not match this worktree/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('native attach rejects an unapproved clone even when its source-bearing payload matches', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'rhythm-native-candidate-'));
  try {
    const expected = writePayload(path.join(root, 'worktree/Rhythm.app'), 'same');
    const installed = writePayload(path.join(root, 'Applications/Rhythm Mega Desktop Candidate.app'), 'same');
    const clone = writePayload(path.join(root, 'other/Rhythm.app'), 'same');
    await expect(assertCandidatePayloadIdentity(clone, expected, installed)).rejects.toThrow(/exact installed qualification candidate/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('native attach accepts only the exact configured worktree or installed candidate path', () => {
  expect(() => assertCandidateExecutablePath(
    '/Applications/Rhythm Mega Desktop Candidate.app/Contents/MacOS/Rhythm',
    '/worktree/dist/Rhythm.app/Contents/MacOS/Rhythm',
    '/Applications/Rhythm Mega Desktop Candidate.app/Contents/MacOS/Rhythm',
  )).not.toThrow();
  expect(() => assertCandidateExecutablePath(
    '/tmp/Rhythm.app/Contents/MacOS/Rhythm',
    '/worktree/dist/Rhythm.app/Contents/MacOS/Rhythm',
    '/Applications/Rhythm Mega Desktop Candidate.app/Contents/MacOS/Rhythm',
  )).toThrow(/exact installed qualification candidate/);
});
