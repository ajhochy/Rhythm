import { createHash } from 'node:crypto';
import { chmod, cp, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

const MAX_NPM_BYTES = 32 * 1024 * 1024;
const MAX_NPM_FILES = 3000;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const comparePaths = (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

async function regularFile(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Node runtime source must be a regular file: ${path}`);
  return info;
}

async function regularDirectory(path) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Node runtime source must be a real directory: ${path}`);
}

/** Hash only the exact regular files that will ship, with portable relative paths. */
export async function npmRuntimeInventory(npmRoot) {
  await regularDirectory(npmRoot);
  const files = [];
  let totalBytes = 0;
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error('Node npm runtime contains a symlink');
      if (info.isDirectory()) { await visit(path); continue; }
      if (!info.isFile()) throw new Error('Node npm runtime contains a nonregular entry');
      totalBytes += info.size;
      if (totalBytes > MAX_NPM_BYTES || files.length >= MAX_NPM_FILES)
        throw new Error('Node npm runtime exceeds the bounded packaging inventory');
      const name = relative(npmRoot, path).split(sep).join('/');
      const bytes = await readFile(path);
      if (bytes.length !== info.size) throw new Error('Node npm runtime changed while packaging');
      files.push({ path: name, size: info.size, sha256: sha256(bytes) });
    }
  }
  await visit(npmRoot);
  files.sort(comparePaths);
  return { npmTreeSha256: sha256(Buffer.from(JSON.stringify(files))), fileCount: files.length, totalBytes };
}

/** Stage npm from the very same Node distribution used for Resources/node/bin/node. */
export async function stageNodeNpmRuntime({ sourceNode, resources, nodeVersion }) {
  if (basename(sourceNode) !== 'node' || basename(dirname(sourceNode)) !== 'bin' ||
      resolve(sourceNode) !== sourceNode || await realpath(sourceNode) !== sourceNode)
    throw new Error('Packaged Node must be the real bin/node of one distribution');
  await regularDirectory(dirname(sourceNode));
  const sourceRoot = dirname(dirname(sourceNode));
  await regularDirectory(sourceRoot);
  await regularDirectory(join(sourceRoot, 'lib'));
  await regularDirectory(join(sourceRoot, 'lib/node_modules'));
  await regularFile(sourceNode);
  const sourceNpm = join(sourceRoot, 'lib/node_modules/npm');
  const sourceInventory = await npmRuntimeInventory(sourceNpm);
  await regularFile(join(sourceNpm, 'bin/npm-cli.js'));
  const npmPackage = JSON.parse(await readFile(join(sourceNpm, 'package.json'), 'utf8'));
  if (npmPackage.name !== 'npm' || typeof npmPackage.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(npmPackage.version))
    throw new Error('Node distribution does not contain a versioned npm CLI');
  if (!/^v22\.\d+\.\d+$/.test(nodeVersion)) throw new Error('Node packaging requires pinned Node 22');

  const destinationRoot = join(resources, 'node');
  const destinationNode = join(destinationRoot, 'bin/node');
  const destinationNpm = join(destinationRoot, 'lib/node_modules/npm');
  await mkdir(dirname(destinationNode), { recursive: true });
  await mkdir(dirname(destinationNpm), { recursive: true });
  await cp(sourceNode, destinationNode);
  await chmod(destinationNode, 0o755);
  await cp(sourceNpm, destinationNpm, { recursive: true, verbatimSymlinks: true });
  const copiedInventory = await npmRuntimeInventory(destinationNpm);
  if (copiedInventory.npmTreeSha256 !== sourceInventory.npmTreeSha256 ||
      copiedInventory.fileCount !== sourceInventory.fileCount || copiedInventory.totalBytes !== sourceInventory.totalBytes)
    throw new Error('Packaged npm bytes differ from the pinned Node distribution');
  const nodeSourceSha256 = sha256(await readFile(sourceNode));
  if (sha256(await readFile(destinationNode)) !== nodeSourceSha256)
    throw new Error('Packaged Node bytes differ from the pinned Node distribution');
  const manifest = {
    version: 1,
    nodeVersion,
    npmVersion: npmPackage.version,
    nodeSourceSha256,
    npmTreeSha256: sourceInventory.npmTreeSha256,
    fileCount: sourceInventory.fileCount,
  };
  await writeFile(join(destinationRoot, 'npm-runtime-manifest.json'), `${JSON.stringify(manifest)}\n`);
  return manifest;
}
