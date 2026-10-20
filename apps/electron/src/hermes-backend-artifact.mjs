import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { PINNED_HERMES_DESKTOP_SOURCE_COMMIT } from './hermes-desktop-config.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
const failure = () => new Error('Hermes backend artifact is invalid. Repackage the pinned backend.');
/** @param {string} path */
const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
/** @param {string} root @param {string} path */
const inside = (root, path) => path === root || path.startsWith(`${root}${sep}`);

/** @param {string} root @param {string} entry */
function payloadPath(root, entry) {
  if (typeof entry !== 'string' || !entry || isAbsolute(entry) || entry.includes('\\')
    || entry.split('/').some((part) => !part || part === '.' || part === '..')) throw failure();
  const path = resolve(root, entry);
  if (!inside(root, path) || path === root) throw failure();
  return path;
}

/** @param {string} root */
function actualEntries(root) {
  /** @type {string[]} */
  const entries = [];
  /** @param {string} directory */
  const visit = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const stat = lstatSync(path);
      if (stat.isDirectory()) visit(path);
      else if (stat.isFile() || stat.isSymbolicLink()) entries.push(relative(root, path).split(sep).join('/'));
      else throw failure();
    }
  };
  visit(root);
  return entries;
}

/**
 * Verify the complete bundled Python payload before a privileged Hermes host may spawn it.
 * The app's outer signature authenticates the manifest; this check binds its source, dependency,
 * native-code and launcher bytes to the exact files at their current installed paths.
 * @param {string} artifactRoot
 * @param {{allowResignedNative?: boolean}} [options]
 */
export function resolveHermesBackendArtifact(artifactRoot, { allowResignedNative = false } = {}) {
  try {
    if (typeof artifactRoot !== 'string' || !isAbsolute(artifactRoot)) throw failure();
    const root = realpathSync(artifactRoot);
    if (root !== artifactRoot || !lstatSync(root).isDirectory()) throw failure();
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
    if (manifest?.schemaVersion !== 1 || manifest.product !== 'hermes-backend'
      || manifest.sourceCommit !== PINNED_HERMES_DESKTOP_SOURCE_COMMIT
      || manifest.arch !== process.arch || manifest.pythonVersion !== '3.12.13'
      || !Number.isInteger(manifest.distributionCount) || manifest.distributionCount !== 73
      || manifest.licenseCount !== manifest.distributionCount
      || !SHA256.test(manifest.uvLockSha256)
      || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)
      || !Array.isArray(manifest.native) || !manifest.native.length) throw failure();
    const files = manifest.files;
    const native = new Set(manifest.native);
    if (native.size !== manifest.native.length || !files.hermes?.sha256 || !files['source/uv.lock']?.sha256
      || !files['python/bin/python3.12']?.sha256 || files['source/uv.lock'].sha256 !== manifest.uvLockSha256) throw failure();
    const recorded = Object.keys(files).sort();
    if (recorded.length < 5 || recorded.some((entry) => entry === 'manifest.json')) throw failure();
    const actual = actualEntries(root).filter((entry) => entry !== 'manifest.json').sort();
    if (actual.length !== recorded.length || actual.some((entry, index) => entry !== recorded[index])) throw failure();
    for (const entry of recorded) {
      const path = payloadPath(root, entry), expected = files[entry], stat = lstatSync(path);
      if (!expected || typeof expected !== 'object' || Array.isArray(expected)) throw failure();
      if (stat.isSymbolicLink()) {
        if (typeof expected.link !== 'string' || Object.keys(expected).length !== 1
          || readlinkSync(path) !== expected.link || !inside(root, realpathSync(path))) throw failure();
      } else if (stat.isFile() && stat.nlink === 1) {
        if (typeof expected.sha256 !== 'string' || !SHA256.test(expected.sha256)
          || Object.keys(expected).length !== 1 || (!allowResignedNative || !native.has(entry)) && digest(path) !== expected.sha256) throw failure();
      } else throw failure();
      if (native.has(entry) && !stat.isFile()) throw failure();
    }
    if ([...native].some((entry) => !files[entry]?.sha256)) throw failure();
    const launcher = payloadPath(root, 'hermes');
    const interpreter = payloadPath(root, 'python/bin/python3.12');
    if (!(lstatSync(launcher).mode & 0o111) || !(lstatSync(interpreter).mode & 0o111)
      || !readFileSync(launcher, 'utf8').startsWith('#!/bin/sh\n')) throw failure();
    return Object.freeze({ root, backendExecutablePath: launcher, manifest: Object.freeze(manifest) });
  } catch { throw failure(); }
}

/** Only native bytes signed in-place may change before the outer application seal. */
/** @param {string} artifactRoot */
export function refreshHermesBackendArtifactIntegrity(artifactRoot) {
  const artifact = resolveHermesBackendArtifact(artifactRoot, { allowResignedNative: true });
  const manifest = artifact.manifest;
  for (const entry of manifest.native) manifest.files[entry].sha256 = digest(payloadPath(artifact.root, entry));
  writeFileSync(join(artifact.root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  return resolveHermesBackendArtifact(artifact.root);
}

/** Missing backend can preserve legacy applications; a present-invalid backend never falls back. */
/** @param {string} resourcesRoot */
export function resolveOptionalHermesBackendArtifact(resourcesRoot) {
  if (typeof resourcesRoot !== 'string' || !isAbsolute(resourcesRoot)) throw failure();
  const root = join(resourcesRoot, 'hermes-backend');
  return lstatSync(root, { throwIfNoEntry: false }) ? resolveHermesBackendArtifact(root) : undefined;
}
