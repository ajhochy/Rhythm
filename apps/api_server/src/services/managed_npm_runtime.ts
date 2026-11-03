/** Pinned npm program bytes used by the production installer in private evaluation workers. */
import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync,
  readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

interface NpmRuntimeManifest {
  version: 1;
  nodeVersion: string;
  npmVersion: string;
  nodeSourceSha256: string;
  npmTreeSha256: string;
  fileCount: number;
}

interface NpmTreeFile { path: string; size: number; sha256: string }
const MAX_NPM_FILES = 3_000;
const MAX_NPM_BYTES = 32 * 1024 * 1024;
const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
const hexHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function regularFile(path: string): boolean {
  try { return lstatSync(path).isFile() && realpathSync(path) === path; }
  catch { return false; }
}

function npmTreeFiles(root: string): NpmTreeFile[] {
  if (!lstatSync(root).isDirectory() || realpathSync(root) !== root) throw Error('npm root is not an owned directory');
  const files: NpmTreeFile[] = [];
  let totalBytes = 0;
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink() || realpathSync(path) !== path) throw Error('npm runtime contains a link');
      if (entry.isDirectory()) { visit(path); continue; }
      if (!entry.isFile()) throw Error('npm runtime contains a nonregular entry');
      const stat = lstatSync(path);
      totalBytes += stat.size;
      if (files.length + 1 > MAX_NPM_FILES || totalBytes > MAX_NPM_BYTES)
        throw Error('npm runtime exceeds staging bounds');
      const rel = relative(root, path).split(sep).join('/');
      files.push({ path: rel, size: stat.size, sha256: sha256(readFileSync(path)) });
    }
  };
  visit(root);
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return files;
}

function checkedManifest(runtimeRoot: string): { manifest: NpmRuntimeManifest; files: NpmTreeFile[]; npmRoot: string } {
  const manifestPath = join(runtimeRoot, 'npm-runtime-manifest.json');
  const npmRoot = join(runtimeRoot, 'lib', 'node_modules', 'npm');
  if (!regularFile(manifestPath)) throw Error('Pinned npm manifest is unavailable');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as NpmRuntimeManifest;
  if (manifest.version !== 1 || manifest.nodeVersion !== process.version ||
      typeof manifest.npmVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.npmVersion) ||
      !hexHash(manifest.nodeSourceSha256) || !hexHash(manifest.npmTreeSha256) ||
      !Number.isInteger(manifest.fileCount) || manifest.fileCount < 1 || manifest.fileCount > MAX_NPM_FILES)
    throw Error('Pinned npm manifest is invalid');
  const files = npmTreeFiles(npmRoot);
  if (files.length !== manifest.fileCount || sha256(JSON.stringify(files)) !== manifest.npmTreeSha256)
    throw Error('Pinned npm runtime differs from sealed manifest');
  const packageJson = JSON.parse(readFileSync(join(npmRoot, 'package.json'), 'utf8')) as { version?: unknown };
  if (packageJson.version !== manifest.npmVersion ||
      !regularFile(join(npmRoot, 'bin', 'npm-cli.js')))
    throw Error('Pinned npm entry point differs from manifest');
  return { manifest, files, npmRoot };
}

/** Parent-only: copy regular, digest-matched files into one fresh private worker. */
export function stagePinnedNpmRuntimeForEvaluation(
  workerRoot: string,
  nodeBinary: string = process.execPath,
): { npmRoot: string; treeSha256: string } {
  const worker = resolve(workerRoot);
  if (!worker.startsWith('/private/tmp/') || !lstatSync(worker).isDirectory() || realpathSync(worker) !== worker)
    throw Error('Private npm worker root is invalid');
  if (nodeBinary !== process.execPath && process.env.NODE_ENV !== 'test')
    throw Error('Private npm source must be the active pinned Node runtime');
  const node = realpathSync(nodeBinary);
  if (!regularFile(node) || dirname(node) !== join(dirname(dirname(node)), 'bin'))
    throw Error('Pinned Node runtime is invalid');
  const runtimeRoot = dirname(dirname(node));
  const { manifest, files, npmRoot: sourceRoot } = checkedManifest(runtimeRoot);
  const destination = join(worker, 'npm-runtime');
  mkdirSync(destination, { mode: 0o700 });
  for (const file of files) {
    const source = join(sourceRoot, ...file.path.split('/'));
    const target = join(destination, ...file.path.split('/'));
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    const descriptor = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes: Buffer;
    try {
      if (!fstatSync(descriptor).isFile()) throw Error('Pinned npm source changed during staging');
      bytes = readFileSync(descriptor);
    } finally { closeSync(descriptor); }
    if (bytes.length !== file.size || sha256(bytes) !== file.sha256)
      throw Error('Pinned npm source changed during staging');
    writeFileSync(target, bytes, { mode: 0o600, flag: 'wx' });
  }
  const staged = npmTreeFiles(destination);
  if (staged.length !== manifest.fileCount || sha256(JSON.stringify(staged)) !== manifest.npmTreeSha256)
    throw Error('Private npm copy differs from sealed manifest');
  return { npmRoot: destination, treeSha256: manifest.npmTreeSha256 };
}

/** Worker-only: no fallback to a host npm tree after an override is supplied. */
export function resolvePrivateEvaluationNpmCli(): string | null {
  if (process.env.RHYTHM_EVALUATION_WORKER !== '1') return null;
  const workerRoot = process.env.RHYTHM_EVALUATION_WORKER_ROOT;
  const npmRoot = process.env.RHYTHM_EVALUATION_NPM_ROOT;
  const expectedHash = process.env.RHYTHM_EVALUATION_NPM_TREE_SHA256;
  if (!workerRoot || !npmRoot || !hexHash(expectedHash) ||
      !workerRoot.startsWith('/private/tmp/') ||
      resolve(npmRoot) !== join(resolve(workerRoot), 'npm-runtime')) return null;
  try {
    const files = npmTreeFiles(npmRoot);
    const cli = join(npmRoot, 'bin', 'npm-cli.js');
    return files.length > 0 && sha256(JSON.stringify(files)) === expectedHash && regularFile(cli)
      ? cli : null;
  } catch { return null; }
}
