import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PINNED_HERMES_DESKTOP_SOURCE_COMMIT } from './hermes-desktop-config.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{40}$/;
const failure = () => new Error('Qualification Hermes runtime unavailable');
/** @param {string | Buffer} bytes */
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** @param {string} name */
const canonicalName = (name) => name.toLowerCase().replace(/[-_.]+/g, '-');

/** @param {string} path @param {number} mode @param {boolean} [directory] */
function privateOwned(path, mode, directory = false) {
  const stat = lstatSync(path);
  if (realpathSync(path) !== path || stat.isSymbolicLink() || stat.uid !== process.getuid?.()
    || (stat.mode & 0o777) !== mode || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) throw failure();
}

/** @param {string} root @param {string} path */
function inside(root, path) {
  return path.startsWith(`${root}${sep}`);
}

/** @param {string} root @param {string} expectedRevision */
function cleanPinnedSource(root, expectedRevision) {
  if (!REVISION.test(expectedRevision)) throw failure();
  /** @param {...string} args */
  const git = (...args) => execFileSync('/usr/bin/git', ['--no-optional-locks', '-C', root, ...args], {
    encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  }).trim();
  if (git('rev-parse', '--show-toplevel') !== root || git('rev-parse', 'HEAD') !== expectedRevision
    || git('status', '--porcelain=v1', '--untracked-files=all')) throw failure();
}

/** @param {string} root */
function lockedInstalledPackages(root) {
  const lock = readFileSync(join(root, 'uv.lock'), 'utf8');
  /** @type {Map<string, Set<string>>} */
  const locked = new Map();
  for (const block of lock.split(/(?:^|\n)\[\[package\]\]\n/).slice(1)) {
    const name = /^name = "([^"]+)"/m.exec(block)?.[1];
    const version = /^version = "([^"]+)"/m.exec(block)?.[1];
    if (name && version) {
      const key = canonicalName(name);
      if (!locked.has(key)) locked.set(key, new Set());
      locked.get(key)?.add(version);
    }
  }
  if (!locked.size) throw failure();
  const site = join(root, '.venv', 'lib', 'python3.12', 'site-packages');
  const installed = readdirSync(site).filter((name) => name.endsWith('.dist-info'));
  if (!installed.length) throw failure();
  for (const entry of installed) {
    const metadata = readFileSync(join(site, entry, 'METADATA'), 'utf8');
    const name = /^Name: (.+)$/m.exec(metadata)?.[1];
    const version = /^Version: (.+)$/m.exec(metadata)?.[1];
    if (!name || !version || !locked.get(canonicalName(name))?.has(version)) throw failure();
  }
  const hermes = installed.filter((name) => name.startsWith('hermes_agent-'));
  if (hermes.length !== 1) throw failure();
  const editable = JSON.parse(readFileSync(join(site, hermes[0], 'direct_url.json'), 'utf8'));
  if (editable.url !== pathToFileURL(root).href || editable.dir_info?.editable !== true) throw failure();
  return installed.length;
}

/** @param {string} root */
function runtimeFiles(root) {
  /** @type {Record<string, {link?: string, sha256?: string}>} */
  const files = {};
  /** @param {string} path */
  const visit = (path) => {
    const stat = lstatSync(path);
    if (stat.uid !== process.getuid?.()) throw failure();
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) visit(join(path, name));
      return;
    }
    const key = relative(root, path).split(sep).join('/');
    if (!key || key.startsWith('..') || Object.hasOwn(files, key)) throw failure();
    if (stat.isSymbolicLink()) {
      const target = realpathSync(path);
      if (![join(root, '.uv-python'), join(root, '.venv')].some((tree) => target === tree || inside(tree, target))) throw failure();
      files[key] = { link: target };
    } else if (stat.isFile() && stat.nlink === 1) {
      files[key] = { sha256: digest(readFileSync(path)) };
    } else throw failure();
  };
  visit(join(root, '.uv-python'));
  visit(join(root, '.venv'));
  return files;
}

/** Build the immutable 0600 manifest after a guarded `uv sync --frozen` into this private root. */
/** @param {string} runtimeRoot @param {string} [expectedRevision] */
export function snapshotQualificationHermesRuntime(runtimeRoot, expectedRevision = PINNED_HERMES_DESKTOP_SOURCE_COMMIT) {
  try {
    if (typeof runtimeRoot !== 'string' || !runtimeRoot.startsWith('/private/tmp/') || resolve(runtimeRoot) !== runtimeRoot) throw failure();
    privateOwned(runtimeRoot, 0o700, true);
    cleanPinnedSource(runtimeRoot, expectedRevision);
    const backendExecutablePath = join(runtimeRoot, '.venv', 'bin', 'hermes');
    const pythonLink = join(runtimeRoot, '.venv', 'bin', 'python');
    const pythonExecutablePath = realpathSync(pythonLink);
    if (!inside(join(runtimeRoot, '.uv-python'), pythonExecutablePath)
      || !lstatSync(pythonExecutablePath).isFile() || !(lstatSync(pythonExecutablePath).mode & 0o111)
      || !lstatSync(backendExecutablePath).isFile() || !(lstatSync(backendExecutablePath).mode & 0o111)
      || !readFileSync(backendExecutablePath, 'utf8').startsWith(`#!${pythonLink}\n`)) throw failure();
    const installedPackages = lockedInstalledPackages(runtimeRoot);
    const files = runtimeFiles(runtimeRoot);
    if (!files['.venv/bin/hermes']?.sha256 || !files[relative(runtimeRoot, pythonExecutablePath).split(sep).join('/')]?.sha256) throw failure();
    return { schemaVersion: 1, sourceRevision: expectedRevision, runtimeRoot,
      uvLockSha256: digest(readFileSync(join(runtimeRoot, 'uv.lock'))),
      pyprojectSha256: digest(readFileSync(join(runtimeRoot, 'pyproject.toml'))),
      backendExecutablePath, pythonExecutablePath, installedPackages, files };
  } catch { throw failure(); }
}

/** Called on every synthetic Hermes attach; never reads a normal user profile or PATH. */
/** @param {string} fixtureRoot @param {string} [expectedRevision] */
export function qualificationHermesHostOptions(fixtureRoot, expectedRevision = PINNED_HERMES_DESKTOP_SOURCE_COMMIT) {
  try {
    if (typeof fixtureRoot !== 'string' || !fixtureRoot.startsWith('/private/tmp/') || resolve(fixtureRoot) !== fixtureRoot) throw failure();
    privateOwned(fixtureRoot, 0o700, true);
    const fixtureManifestPath = join(fixtureRoot, 'manifest.json');
    privateOwned(fixtureManifestPath, 0o600);
    const fixture = JSON.parse(readFileSync(fixtureManifestPath, 'utf8'));
    if (fixture.fixtureRoot !== fixtureRoot || !fixture.syntheticActor) throw failure();
    const ref = fixture.syntheticActor.hermesRuntime;
    const runtimeManifestPath = join(fixtureRoot, 'hermes-runtime.json');
    if (ref?.manifestPath !== runtimeManifestPath || !SHA256.test(ref.manifestSha256)) throw failure();
    privateOwned(runtimeManifestPath, 0o600);
    const bytes = readFileSync(runtimeManifestPath);
    if (digest(bytes) !== ref.manifestSha256) throw failure();
    const manifest = JSON.parse(bytes.toString('utf8'));
    if (manifest.schemaVersion !== 1 || manifest.sourceRevision !== expectedRevision) throw failure();
    const current = snapshotQualificationHermesRuntime(manifest.runtimeRoot, expectedRevision);
    if (JSON.stringify(current) !== JSON.stringify(manifest)) throw failure();
    const childHome = join(fixtureRoot, 'home');
    privateOwned(childHome, 0o700, true);
    return Object.freeze({ childHome, hermesHome: join(fixtureRoot, 'hermes-home'),
      backendExecutablePath: current.backendExecutablePath });
  } catch { throw failure(); }
}
