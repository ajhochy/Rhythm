// issue-1570-d: produces the detached Ed25519 signature the installed-artifact verifier
// (src/hermes-desktop-artifact.mjs) requires before it will read any payload path. Call this only
// after refreshHermesDesktopArtifactIntegrity has re-sealed the manifest post-nested-codesign and
// before the outer app codesign — mutating manifest.json afterward invalidates the signature.
//
// The signing key is read once from the environment (a CI secret in the release pipeline, or a
// synthetic test key in tests) and is never written to disk or logged. It never lives in the repo.
import { sign } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const HERMES_DESKTOP_MANIFEST_SIGNING_KEY_ENV = 'HERMES_DESKTOP_MANIFEST_SIGNING_KEY';

/**
 * Fails the release build closed when the CI secret is absent, rather than silently shipping an
 * unsigned manifest that installed-artifact verification would reject anyway.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} the PEM-encoded Ed25519 private key
 */
export function requireManifestSigningKey(env = process.env) {
  const key = env[HERMES_DESKTOP_MANIFEST_SIGNING_KEY_ENV];
  if (typeof key !== 'string' || !key.trim()) {
    throw new Error(`${HERMES_DESKTOP_MANIFEST_SIGNING_KEY_ENV} is required to sign the Hermes Desktop manifest for a release build. Set it from the CI secret; never from the repo.`);
  }
  return key;
}

/**
 * Signs the manifest.json bytes already sitting in artifactRoot and writes the detached
 * manifest.sig next to it.
 * @param {{artifactRoot: string, signingKey: string}} options
 */
export async function signHermesDesktopManifest({ artifactRoot, signingKey }) {
  const manifestBytes = await readFile(resolve(artifactRoot, 'manifest.json'));
  const signature = sign(null, manifestBytes, signingKey);
  await writeFile(resolve(artifactRoot, 'manifest.sig'), `${signature.toString('base64')}\n`, { mode: 0o644 });
}
