import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PINNED_HERMES_DESKTOP_SOURCE_COMMIT } from '../src/hermes-desktop-config.mjs';
import { resolveHermesBackendArtifact } from '../src/hermes-backend-artifact.mjs';
import { snapshotQualificationHermesRuntime } from '../src/qualification-hermes-runtime.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canonical = (name) => name.toLowerCase().replace(/[-_.]+/g, '-');
const nativeMagic = new Set(['cffaedfe', 'feedfacf', 'cafebabe', 'bebafeca']);

/** Build from a clean pinned source and its frozen, previously attested private runtime.
 * Output is a separate relocatable artifact. Caller must run under Rhythm's build guard.
 * @param {{sourceRoot: string, outputRoot: string}} input */
export function buildHermesBackendArtifact({ sourceRoot, outputRoot }) {
  if (![sourceRoot, outputRoot].every((path) => typeof path === 'string' && path.startsWith('/private/tmp/') && resolve(path) === path)
    || sourceRoot === outputRoot || outputRoot.startsWith(`${sourceRoot}${sep}`)) throw new Error('Private canonical Hermes source and output paths required');
  const git = (...args) => execFileSync('/usr/bin/git', ['--no-optional-locks', '-C', sourceRoot, ...args], {
    encoding: 'utf8', timeout: 30_000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  }).trim();
  if (realpathSync(sourceRoot) !== sourceRoot || git('rev-parse', '--show-toplevel') !== sourceRoot
    || git('rev-parse', 'HEAD') !== PINNED_HERMES_DESKTOP_SOURCE_COMMIT
    || git('status', '--porcelain=v1', '--untracked-files=all')) throw new Error('Hermes source is not the clean pinned revision');
  const stagedRuntime = snapshotQualificationHermesRuntime(sourceRoot);
  const candidates = readdirSync(join(sourceRoot, '.uv-python')).filter((name) => name.startsWith('cpython-3.12.13-macos-'));
  if (candidates.length !== 1) throw new Error('Exact managed Python 3.12.13 required');
  const pythonRoot = join(sourceRoot, '.uv-python', candidates[0]);
  const site = join(sourceRoot, '.venv', 'lib', 'python3.12', 'site-packages');
  if (realpathSync(pythonRoot) !== pythonRoot || realpathSync(site) !== site) throw new Error('Hermes runtime must be local and canonical');
  if (stagedRuntime.installedPackages !== 61 || stagedRuntime.uvLockSha256 !== digest(readFileSync(join(sourceRoot, 'uv.lock'))))
    throw new Error('Hermes staged runtime differs from its frozen lock');
  const lock = readFileSync(join(sourceRoot, 'uv.lock'), 'utf8');
  const locked = new Map();
  for (const block of lock.split(/(?:^|\n)\[\[package\]\]\n/).slice(1)) {
    const name = /^name = "([^"]+)"/m.exec(block)?.[1], version = /^version = "([^"]+)"/m.exec(block)?.[1];
    if (name && version) locked.set(canonical(name), version);
  }
  const distributions = readdirSync(site).filter((name) => name.endsWith('.dist-info') && !name.startsWith('hermes_agent-'));
  if (distributions.length !== 60) throw new Error('Hermes frozen dependency count changed');
  for (const entry of distributions) {
    const metadata = readFileSync(join(site, entry, 'METADATA'), 'utf8');
    const name = /^Name: (.+)$/m.exec(metadata)?.[1], version = /^Version: (.+)$/m.exec(metadata)?.[1];
    const licenses = join(site, entry, 'licenses');
    const licenseFiles = existsSync(licenses)
      ? readdirSync(licenses, { recursive: true }).filter((file) => lstatSync(join(licenses, file)).isFile())
      : readdirSync(join(site, entry)).filter((file) => /^(LICENSE|LICENCE|COPYING|NOTICE)(\.|$)/i.test(file));
    if (!name || !version || locked.get(canonical(name)) !== version || !licenseFiles.length)
      throw new Error(`Hermes frozen dependency or license metadata changed: ${entry}`);
  }
  if (lstatSync(outputRoot, { throwIfNoEntry: false })) throw new Error('Hermes backend output must not already exist');
  mkdirSync(outputRoot, { recursive: false, mode: 0o700 });
  try {
    const sourceOut = join(outputRoot, 'source');
    mkdirSync(sourceOut);
    const archive = execFileSync('/usr/bin/git', ['--no-optional-locks', '-C', sourceRoot, 'archive', '--format=tar', 'HEAD'], { maxBuffer: 200 * 1024 * 1024, timeout: 60_000 });
    execFileSync('/usr/bin/tar', ['-xf', '-', '-C', sourceOut], { input: archive, timeout: 60_000 });
    cpSync(pythonRoot, join(outputRoot, 'python'), { recursive: true, verbatimSymlinks: true });
    const siteOut = join(outputRoot, 'site-packages');
    mkdirSync(siteOut);
    const excluded = (name) => name.startsWith('__editable__') || name.startsWith('hermes_agent-') || name.startsWith('_virtualenv.');
    for (const entry of readdirSync(site)) if (!excluded(entry)) cpSync(join(site, entry), join(siteOut, entry), { recursive: true, verbatimSymlinks: true });
    const launcher = '#!/bin/sh\nset -eu\nroot=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)\nexport PYTHONHOME="$root/python"\nexport PYTHONPATH="$root/source:$root/site-packages"\nexport PYTHONDONTWRITEBYTECODE=1\nexport PYTHONNOUSERSITE=1\nexport PYTHONSAFEPATH=1\nexport HERMES_DISABLE_LAZY_INSTALLS=1\nunset HERMES_LAZY_INSTALL_TARGET PYTHONUSERBASE PYTHONSTARTUP\nexec "$root/python/bin/python3" -P -s -B -m hermes_cli.main "$@"\n';
    writeFileSync(join(outputRoot, 'hermes'), launcher, { mode: 0o755 });
    /** @type {Record<string, {sha256?: string, link?: string}>} */
    const files = {};
    /** @type {string[]} */
    const native = [];
    /** @param {string} directory */
    const visit = (directory) => {
      for (const name of readdirSync(directory).sort()) {
        const path = join(directory, name), stat = lstatSync(path);
        const key = relative(outputRoot, path).split(sep).join('/');
        if (stat.isDirectory()) visit(path);
        else if (stat.isSymbolicLink()) {
          const target = realpathSync(path);
          if (target !== outputRoot && !target.startsWith(`${outputRoot}${sep}`)) throw new Error(`Hermes runtime link escaped: ${key}`);
          files[key] = { link: readlinkSync(path) };
        } else if (stat.isFile() && stat.nlink === 1) {
          const bytes = readFileSync(path);
          files[key] = { sha256: digest(bytes) };
          if (nativeMagic.has(bytes.subarray(0, 4).toString('hex'))) native.push(key);
        } else throw new Error(`Unsupported Hermes runtime entry: ${key}`);
      }
    };
    visit(outputRoot);
    const ordered = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
    const manifest = { schemaVersion: 1, product: 'hermes-backend', sourceCommit: PINNED_HERMES_DESKTOP_SOURCE_COMMIT,
      uvLockSha256: digest(readFileSync(join(sourceOut, 'uv.lock'))), pythonVersion: '3.12.13', arch: process.arch,
      distributionCount: distributions.length, licenseCount: distributions.length, files: ordered, native: native.sort() };
    writeFileSync(join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
    resolveHermesBackendArtifact(outputRoot);
    if (git('rev-parse', 'HEAD') !== PINNED_HERMES_DESKTOP_SOURCE_COMMIT
      || git('status', '--porcelain=v1', '--untracked-files=all')) throw new Error('Hermes source changed during backend build');
    return { root: outputRoot, files: Object.keys(files).length, native: native.length };
  } catch (error) {
    rmSync(outputRoot, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = buildHermesBackendArtifact({ sourceRoot: process.argv[2], outputRoot: process.argv[3] });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
