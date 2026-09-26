import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { refreshHermesDesktopArtifactIntegrity, resolveHermesDesktopArtifact } from '../src/hermes-desktop-artifact.mjs';
import { PINNED_HERMES_DESKTOP_SOURCE_COMMIT } from '../src/hermes-desktop-config.mjs';
import {
  HERMES_DESKTOP_MANIFEST_SIGNING_KEY_ENV,
  requireManifestSigningKey,
  signHermesDesktopManifest,
} from '../scripts/sign-hermes-desktop-manifest.mjs';
import { TEST_UPDATE_PRIVATE_KEY, TEST_UPDATE_PUBLIC_KEY } from './fixtures/hermes-desktop-test-keys.mjs';

const digest = (value) => `sha256-${createHash('sha256').update(value).digest('base64')}`;

async function writeV2Artifact(root, { sequence = 2 } = {}) {
  const renderer = '<main id="hermes-desktop">Desktop workspace v2</main>';
  const host = 'export async function createEmbeddedHermesHost() { return { dispose: async () => {}, handleIntent: async () => ({ ok: true }) }; }\n';
  const preload = 'window.hermesDesktop = { version: 2 };\n';
  await mkdir(path.join(root, 'renderer'), { recursive: true });
  await mkdir(path.join(root, 'electron'), { recursive: true });
  await writeFile(path.join(root, 'renderer', 'index.html'), renderer);
  await writeFile(path.join(root, 'electron', 'embedded-host.mjs'), host);
  await writeFile(path.join(root, 'electron', 'preload.cjs'), preload);
  const manifest = {
    schemaVersion: 2,
    product: 'hermes-desktop',
    sourceCommit: 'd747cbd9e81870704347738cb702d3f229818557',
    hermesVersion: '0.20.6',
    hostApiVersion: 1,
    electronMajor: 40,
    electronVersion: '40.10.2',
    sequence,
    dirty: false,
    sourceDirty: false,
    files: {
      renderer: 'renderer/index.html',
      host: 'electron/embedded-host.mjs',
      preload: 'electron/preload.cjs',
    },
    integrity: {
      'renderer/index.html': digest(renderer),
      'electron/embedded-host.mjs': digest(host),
      'electron/preload.cjs': digest(preload),
    },
  };
  await writeFile(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function writeFactoryArtifact(root, { sourceCommit = PINNED_HERMES_DESKTOP_SOURCE_COMMIT } = {}) {
  const renderer = '<main id="hermes-desktop">Desktop workspace</main>';
  const host = 'export async function createEmbeddedHermesHost() { return { dispose: async () => {}, handleIntent: async () => ({ ok: true }) }; }\n';
  const preload = 'window.hermesDesktop = {};\n';
  await mkdir(path.join(root, 'renderer'), { recursive: true });
  await mkdir(path.join(root, 'electron'), { recursive: true });
  await writeFile(path.join(root, 'renderer', 'index.html'), renderer);
  await writeFile(path.join(root, 'electron', 'embedded-host.mjs'), host);
  await writeFile(path.join(root, 'electron', 'preload.cjs'), preload);
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    product: 'hermes-desktop',
    sourceCommit,
    electronMajor: 40,
    files: { renderer: 'renderer/index.html', host: 'electron/embedded-host.mjs', preload: 'electron/preload.cjs' },
    integrity: {
      'renderer/index.html': digest(renderer),
      'electron/embedded-host.mjs': digest(host),
      'electron/preload.cjs': digest(preload),
    },
  }));
}

const installedPolicy = {
  artifactSource: 'installed',
  expectedElectronMajor: 40,
  expectedElectronVersion: '40.10.2',
  minimumHermesVersion: '0.20.0',
  supportedHostApiVersions: [1],
  trustedPublicKeys: [TEST_UPDATE_PUBLIC_KEY],
};

test('1570-d:1 signHermesDesktopManifest output is accepted by the installed-artifact verifier and rejects any manifest byte change', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rhythm-hermes-manifest-sign-'));
  await writeV2Artifact(root);

  await signHermesDesktopManifest({ artifactRoot: root, signingKey: TEST_UPDATE_PRIVATE_KEY });

  const artifact = await resolveHermesDesktopArtifact({ artifactRoot: root, ...installedPolicy });
  assert.equal(artifact.manifest.hermesVersion, '0.20.6');

  // Any byte change to the signed manifest must invalidate the signature.
  const manifestPath = path.join(root, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.sequence += 1;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await assert.rejects(
    () => resolveHermesDesktopArtifact({ artifactRoot: root, ...installedPolicy }),
    /Hermes Desktop artifact is unavailable/,
  );
});

test('1570-d:5 (regression) signing the FACTORY copy in place, exactly as sign-and-notarize-mac.mjs does, does not break factory loading — manifest.sig is exempt, not verified, for factory', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rhythm-hermes-factory-sign-'));
  await writeFactoryArtifact(root);

  // Mirrors sign-and-notarize-mac.mjs's exact call order: reseal after nested codesign, sanity
  // check the factory artifact (as it does today, pre-signing), THEN sign in place.
  await refreshHermesDesktopArtifactIntegrity({ artifactRoot: root });
  const factoryPolicy = { artifactRoot: root, expectedElectronMajor: 40, expectedSourceCommit: PINNED_HERMES_DESKTOP_SOURCE_COMMIT };
  await resolveHermesDesktopArtifact(factoryPolicy); // pre-sign: must already succeed today

  await signHermesDesktopManifest({ artifactRoot: root, signingKey: TEST_UPDATE_PRIVATE_KEY });

  // The blocker: resolving the SAME factory directory after signing must still succeed —
  // manifest.sig must not trip the unverified-file completeness scan.
  const realRoot = await realpath(root);
  const artifact = await resolveHermesDesktopArtifact(factoryPolicy);
  assert.equal(artifact.root, realRoot);

  // A tampered manifest.sig alone must not affect factory loading — factory never reads or
  // verifies it; trust comes from the outer app codesign, not this signature.
  await writeFile(path.join(root, 'manifest.sig'), 'not-a-real-signature\n');
  const stillLoads = await resolveHermesDesktopArtifact(factoryPolicy);
  assert.equal(stillLoads.root, realRoot);

  // Tampering the manifest itself must still fail exactly as before (pre-existing integrity
  // protection, unrelated to the signature).
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  manifest.electronMajor = 41;
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  await assert.rejects(() => resolveHermesDesktopArtifact(factoryPolicy), /incompatible with Rhythm Electron/);
});

test('1570-d:2 sign-and-notarize-mac.mjs signs after the reseal and before the outer app codesign', async () => {
  const source = await readFile(new URL('../scripts/sign-and-notarize-mac.mjs', import.meta.url), 'utf8');
  assert.match(source, /import \{ requireManifestSigningKey, signHermesDesktopManifest \} from '\.\/sign-hermes-desktop-manifest\.mjs';/);
  const resealIndex = source.indexOf('await refreshHermesDesktopArtifactIntegrity(');
  const signIndex = source.indexOf('await signHermesDesktopManifest(');
  const outerCodesignIndex = source.indexOf("await codesign(artifact, { deep: false });");
  assert.ok(resealIndex > -1, 'reseal call must exist');
  assert.ok(signIndex > -1, 'manifest signing call must exist');
  assert.ok(outerCodesignIndex > -1, 'outer app codesign call must exist');
  assert.ok(resealIndex < signIndex, 'signing must run after the reseal');
  assert.ok(signIndex < outerCodesignIndex, 'signing must run before the outer app codesign');
});

test('1570-d:3 a release build with no signing-key secret fails before any signing/codesign work', async () => {
  assert.throws(() => requireManifestSigningKey({}), new RegExp(HERMES_DESKTOP_MANIFEST_SIGNING_KEY_ENV));
  assert.throws(() => requireManifestSigningKey({ [HERMES_DESKTOP_MANIFEST_SIGNING_KEY_ENV]: '   ' }));
  assert.equal(requireManifestSigningKey({ [HERMES_DESKTOP_MANIFEST_SIGNING_KEY_ENV]: TEST_UPDATE_PRIVATE_KEY }), TEST_UPDATE_PRIVATE_KEY);

  const source = await readFile(new URL('../scripts/sign-and-notarize-mac.mjs', import.meta.url), 'utf8');
  const keyCheckIndex = source.indexOf('requireManifestSigningKey()');
  const firstCodesignIndex = source.indexOf("await hardenElectronFuses(");
  assert.ok(keyCheckIndex > -1, 'the script must call requireManifestSigningKey()');
  assert.ok(firstCodesignIndex > -1);
  assert.ok(keyCheckIndex < firstCodesignIndex, 'the signing key must be required before any codesign work starts');
});

test('1570-d:4 the private key never reaches disk, manifest.sig, or captured stdout/stderr', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rhythm-hermes-manifest-sign-'));
  await writeV2Artifact(root);
  const originalOut = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  let captured = '';
  process.stdout.write = (chunk, ...rest) => { captured += chunk; return originalOut(chunk, ...rest); };
  process.stderr.write = (chunk, ...rest) => { captured += chunk; return originalErr(chunk, ...rest); };
  try {
    await signHermesDesktopManifest({ artifactRoot: root, signingKey: TEST_UPDATE_PRIVATE_KEY });
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }
  assert.equal(captured.includes(TEST_UPDATE_PRIVATE_KEY), false);
  assert.equal(captured.includes('BEGIN PRIVATE KEY'), false);
  const manifestSig = await readFile(path.join(root, 'manifest.sig'), 'utf8');
  const manifestJson = await readFile(path.join(root, 'manifest.json'), 'utf8');
  assert.equal(manifestSig.includes(TEST_UPDATE_PRIVATE_KEY), false);
  assert.equal(manifestJson.includes(TEST_UPDATE_PRIVATE_KEY), false);
});
