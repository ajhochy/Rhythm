import { createHash, verify } from 'node:crypto';
import { lstat, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  HERMES_DESKTOP_MINIMUM_VERSION,
  HERMES_DESKTOP_SUPPORTED_HOST_API_VERSIONS,
  HERMES_DESKTOP_UPDATE_PUBLIC_KEYS,
} from './hermes-desktop-config.mjs';

const REQUIRED_FILES = ['renderer', 'host', 'preload'];
const SHA256_SRI = /^sha256-[A-Za-z0-9+/]{43}=$/;
const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const INSTALLED_UNAVAILABLE = 'Hermes Desktop artifact is unavailable.';

/** @param {unknown} value */
function parseSemver(value) {
  if (typeof value !== 'string') return undefined;
  const match = SEMVER.exec(value);
  if (!match) return undefined;
  return { parts: match.slice(1, 4).map(Number), prerelease: match[4] };
}

/** @param {string} candidate @param {string} minimum */
function semverAtLeast(candidate, minimum) {
  const left = parseSemver(candidate);
  const right = parseSemver(minimum);
  if (!left || !right) return false;
  for (let index = 0; index < left.parts.length; index += 1) {
    if (left.parts[index] !== right.parts[index]) return left.parts[index] > right.parts[index];
  }
  if (left.prerelease === right.prerelease) return true;
  if (!left.prerelease) return true;
  if (!right.prerelease) return false;
  return left.prerelease.localeCompare(right.prerelease, 'en', { numeric: true }) >= 0;
}

/** @param {unknown} value */
function decodeSignature(value) {
  if (typeof value !== 'string') return undefined;
  const encoded = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) return undefined;
  const signature = Buffer.from(encoded, 'base64');
  return signature.length === 64 && signature.toString('base64') === encoded ? signature : undefined;
}

/** @param {string} root @param {string} candidate */
function containedPath(root, candidate) {
  if (typeof candidate !== 'string' || !candidate || isAbsolute(candidate) || candidate.split(/[\\/]/).includes('..')) {
    throw new Error(`Hermes Desktop artifact path is invalid: ${String(candidate)}`);
  }
  const path = resolve(root, candidate);
  const rel = relative(root, path);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error(`Hermes Desktop artifact path escapes its root: ${candidate}`);
  return path;
}

/** @param {string} path */
async function digestFile(path) {
  const { createReadStream } = await import('node:fs');
  const hash = createHash('sha256');
  await new Promise((/** @type {(value: void) => void} */ resolveStream, reject) => createReadStream(path)
    .on('error', reject).on('data', (chunk) => hash.update(chunk))
    .on('end', () => resolveStream(undefined)));
  return `sha256-${hash.digest('base64')}`;
}

/** @param {string} root @param {string} directory @param {string[]} files */
async function collectArtifactFiles(root, directory, files) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    const rel = relative(root, path).split(sep).join('/');
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) throw new Error(`Hermes Desktop artifact contains an unsupported symlink: ${rel}`);
    if (metadata.isDirectory()) await collectArtifactFiles(root, path, files);
    else if (metadata.isFile()) files.push(rel);
    else throw new Error(`Hermes Desktop artifact contains an unsupported entry: ${rel}`);
  }
}

/**
 * Validates an immutable Hermes Desktop embedded artifact before it is imported
 * into Rhythm's privileged Electron process.
 * Factory artifacts retain the signed-bundle + exact-pin policy. Installed
 * artifacts require a detached Ed25519 signature before any payload is read.
 * @param {{artifactRoot: string, expectedElectronMajor: number, expectedSourceCommit?: string, allowDirty?: boolean,
 * artifactSource?: 'factory' | 'installed', expectedElectronVersion?: string, minimumHermesVersion?: string,
 * supportedHostApiVersions?: readonly number[], trustedPublicKeys?: readonly string[], minimumSequence?: number,
 * readFile?: typeof readFile}} options
 */
export async function resolveHermesDesktopArtifact({
  artifactRoot,
  expectedElectronMajor,
  expectedSourceCommit,
  allowDirty = false,
  artifactSource = 'factory',
  expectedElectronVersion = process.versions.electron,
  minimumHermesVersion = HERMES_DESKTOP_MINIMUM_VERSION,
  supportedHostApiVersions = HERMES_DESKTOP_SUPPORTED_HOST_API_VERSIONS,
  trustedPublicKeys = HERMES_DESKTOP_UPDATE_PUBLIC_KEYS,
  minimumSequence = 0,
  readFile: readArtifactFile = readFile,
}) {
  if (typeof artifactRoot !== 'string' || !isAbsolute(artifactRoot) || !Number.isInteger(expectedElectronMajor)) {
    throw new Error('Hermes Desktop artifact configuration is invalid. Set an absolute RHYTHM_HERMES_DESKTOP_ARTIFACT_DIR for development or rebuild the Rhythm package.');
  }
  if (!['factory', 'installed'].includes(artifactSource)) throw new Error('Hermes Desktop artifact source policy is invalid.');
  const installed = artifactSource === 'installed';
  const unresolvedManifestPath = resolve(artifactRoot, 'manifest.json');
  /** @type {Buffer | undefined} */
  let manifestBytes;
  let manifest;
  if (installed) {
    /** @type {string | undefined} */
    let signatureText;
    try {
      const [rawManifest, rawSignature] = await Promise.all([
        readArtifactFile(unresolvedManifestPath),
        readArtifactFile(resolve(artifactRoot, 'manifest.sig'), 'utf8'),
      ]);
      manifestBytes = Buffer.isBuffer(rawManifest) ? rawManifest : Buffer.from(rawManifest);
      signatureText = String(rawSignature);
    } catch { throw new Error(INSTALLED_UNAVAILABLE); }
    if (!manifestBytes || !signatureText) throw new Error(INSTALLED_UNAVAILABLE);
    const verifiedManifestBytes = manifestBytes;
    const signature = decodeSignature(signatureText);
    const trusted = signature && Array.isArray(trustedPublicKeys) && trustedPublicKeys.some((publicKey) => {
      try { return typeof publicKey === 'string' && verify(null, verifiedManifestBytes, publicKey, signature); }
      catch { return false; }
    });
    if (!trusted) throw new Error(INSTALLED_UNAVAILABLE);
    try { manifest = JSON.parse(verifiedManifestBytes.toString('utf8')); }
    catch { throw new Error(INSTALLED_UNAVAILABLE); }
  }
  const root = await realpath(artifactRoot).catch(() => {
    if (installed) throw new Error(INSTALLED_UNAVAILABLE);
    throw new Error(`Hermes Desktop artifact is missing at ${artifactRoot}. Rebuild the pinned Hermes Desktop artifact before opening the Hermes tab.`);
  });
  const manifestPath = containedPath(root, 'manifest.json');
  if (!installed) {
    try { manifest = JSON.parse(await readArtifactFile(manifestPath, 'utf8')); }
    catch { throw new Error(`Hermes Desktop artifact manifest is unreadable at ${manifestPath}. Rebuild the pinned Hermes Desktop artifact.`); }
  }
  const expectedSchemaVersion = installed ? 2 : 1;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
    || manifest.schemaVersion !== expectedSchemaVersion || manifest.product !== 'hermes-desktop'
    || typeof manifest.sourceCommit !== 'string' || !FULL_GIT_SHA.test(manifest.sourceCommit)
    || manifest.electronMajor !== expectedElectronMajor || !manifest.files || typeof manifest.files !== 'object'
    || !manifest.integrity || typeof manifest.integrity !== 'object') {
    throw new Error(`Hermes Desktop artifact manifest is incompatible with Rhythm Electron ${expectedElectronMajor}. Rebuild it from the pinned Hermes fork source.`);
  }
  if (installed) {
    if (typeof expectedElectronVersion !== 'string' || manifest.electronVersion !== expectedElectronVersion) {
      throw new Error(`Hermes Desktop artifact is incompatible with Rhythm Electron ${expectedElectronMajor}; exact Electron ${expectedElectronVersion || 'version unavailable'} is required.`);
    }
    if (!Number.isInteger(manifest.hostApiVersion) || !supportedHostApiVersions.includes(manifest.hostApiVersion)) {
      throw new Error(`Hermes Desktop artifact host API version ${String(manifest.hostApiVersion)} is not supported by this Rhythm build.`);
    }
    if (!parseSemver(minimumHermesVersion) || !semverAtLeast(manifest.hermesVersion, minimumHermesVersion)) {
      throw new Error(`Hermes Desktop artifact Hermes version ${String(manifest.hermesVersion)} is older than Rhythm's minimum ${minimumHermesVersion}.`);
    }
    if (!Number.isSafeInteger(manifest.sequence) || manifest.sequence < 1
      || !Number.isSafeInteger(minimumSequence) || minimumSequence < 0
      || manifest.sequence < minimumSequence) {
      throw new Error(`Hermes Desktop artifact sequence ${String(manifest.sequence)} is older than the accepted sequence ${minimumSequence}.`);
    }
  }
  if (expectedSourceCommit && manifest.sourceCommit !== expectedSourceCommit) {
    throw new Error('Hermes Desktop artifact was built from a different source commit. Rebuild it from Rhythm\'s pinned Hermes fork source.');
  }
  if ((manifest.dirty === true || manifest.sourceDirty === true) && !allowDirty) {
    throw new Error('Hermes Desktop artifact contains uncommitted source changes. Rebuild it from the pinned Hermes fork source before packaging Rhythm.');
  }
  if ((manifest.dirty !== undefined && typeof manifest.dirty !== 'boolean')
    || (manifest.sourceDirty !== undefined && typeof manifest.sourceDirty !== 'boolean')) {
    throw new Error('Hermes Desktop artifact manifest is invalid. Rebuild the pinned artifact.');
  }
  const integrityEntries = Object.entries(manifest.integrity);
  if (!integrityEntries.length) throw new Error('Hermes Desktop artifact has no integrity metadata. Rebuild the pinned artifact.');
  const integrityPaths = new Set();
  for (const [entry, expected] of integrityEntries) {
    const path = containedPath(root, entry);
    if (integrityPaths.has(entry) || typeof expected !== 'string' || !SHA256_SRI.test(expected)) {
      throw new Error(`Hermes Desktop artifact integrity is invalid for ${entry}. Rebuild the pinned artifact.`);
    }
    integrityPaths.add(entry);
    const metadata = await lstat(path).catch(() => { throw new Error(`Hermes Desktop artifact is missing ${entry}. Rebuild the pinned artifact.`); });
    if (!metadata.isFile()) throw new Error(`Hermes Desktop artifact entry is not a regular file: ${entry}`);
    if ((await digestFile(path)) !== expected) throw new Error(`Hermes Desktop artifact integrity check failed for ${entry}. Rebuild the pinned artifact; Rhythm will not load a dashboard fallback.`);
  }
  /** @type {string[]} */
  const actualEntries = [];
  await collectArtifactFiles(root, root, actualEntries);
  for (const entry of actualEntries) {
    // issue-1570-d fix: manifest.sig is exempt for BOTH sources, not only 'installed'. The
    // release pipeline (scripts/sign-hermes-desktop-manifest.mjs) writes it into the factory
    // copy too, so that exact signed directory can later be extracted and distributed as a
    // self-contained installed-update package with no extra assembly step. Factory trust is,
    // and remains, the outer Developer ID codesign over the whole .app bundle — this validator
    // never reads or verifies manifest.sig for a factory source, so its presence, absence, or
    // tampering has no effect on factory loading (unlike 'installed', where it is mandatory and
    // verified above before any other path is read).
    if (entry !== 'manifest.json' && entry !== 'manifest.sig' && !integrityPaths.has(entry)) {
      throw new Error(`Hermes Desktop artifact has an unverified file: ${entry}. Rebuild the pinned artifact.`);
    }
  }
  /** @type {Record<string, string>} */
  const files = {};
  for (const key of REQUIRED_FILES) {
    const entry = manifest.files[key];
    if (typeof entry !== 'string' || !entry) throw new Error(`Hermes Desktop artifact manifest is missing ${key}. Rebuild the pinned artifact.`);
    const path = containedPath(root, entry);
    if (!integrityPaths.has(entry)) throw new Error(`Hermes Desktop artifact integrity is missing for ${entry}. Rebuild the pinned artifact.`);
    files[key] = path;
  }
  return Object.freeze({
    root,
    manifest: Object.freeze({ ...manifest }),
    rendererPath: files.renderer,
    hostPath: files.host,
    preloadPath: files.preload,
    rendererUrl: `${pathToFileURL(files.renderer).href}?embedded=1`,
  });
}

/**
 * Re-seals a staged artifact after codesign has changed a nested native binary.
 * Call only after all nested code is signed and immediately before the outer
 * application signature; mutating the artifact later invalidates this seal.
 * @param {{artifactRoot: string}} options
 */
export async function refreshHermesDesktopArtifactIntegrity({ artifactRoot }) {
  if (typeof artifactRoot !== 'string' || !isAbsolute(artifactRoot)) throw new Error('Hermes Desktop artifact path must be absolute while sealing.');
  const root = await realpath(artifactRoot);
  const manifestPath = containedPath(root, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || manifest.schemaVersion !== 1 || manifest.product !== 'hermes-desktop') {
    throw new Error('Cannot seal an invalid Hermes Desktop artifact manifest.');
  }
  /** @type {string[]} */
  const files = [];
  await collectArtifactFiles(root, root, files);
  /** @type {Record<string, string>} */
  const integrity = {};
  for (const entry of files.sort()) {
    if (entry !== 'manifest.json') integrity[entry] = await digestFile(containedPath(root, entry));
  }
  manifest.integrity = integrity;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
}
