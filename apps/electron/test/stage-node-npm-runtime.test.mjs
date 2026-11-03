import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { npmRuntimeInventory, stageNodeNpmRuntime } from '../scripts/stage-node-npm-runtime.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'rhythm-node-runtime-test-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceNode = join(root, 'source/bin/node');
  const npmRoot = join(root, 'source/lib/node_modules/npm');
  const resources = join(root, 'Resources');
  await mkdir(join(npmRoot, 'bin'), { recursive: true });
  await mkdir(join(root, 'source/bin'), { recursive: true });
  await writeFile(sourceNode, 'pinned Node bytes');
  await writeFile(join(npmRoot, 'package.json'), JSON.stringify({ name: 'npm', version: '10.9.8' }));
  await writeFile(join(npmRoot, 'bin/npm-cli.js'), 'pinned npm CLI bytes');
  return { root, sourceNode, npmRoot, resources };
}

test('stages npm beside the exact packaged Node with a deterministic byte manifest', async (t) => {
  const { sourceNode, npmRoot, resources } = await fixture(t);
  const manifest = await stageNodeNpmRuntime({ sourceNode, resources, nodeVersion: 'v22.23.0' });
  assert.deepEqual(manifest, {
    version: 1,
    nodeVersion: 'v22.23.0',
    npmVersion: '10.9.8',
    nodeSourceSha256: hash('pinned Node bytes'),
    npmTreeSha256: (await npmRuntimeInventory(npmRoot)).npmTreeSha256,
    fileCount: 2,
  });
  assert.deepEqual(JSON.parse(await readFile(join(resources, 'node/npm-runtime-manifest.json'), 'utf8')), manifest);
  assert.equal(await readFile(join(resources, 'node/lib/node_modules/npm/bin/npm-cli.js'), 'utf8'), 'pinned npm CLI bytes');
  const packaged = await npmRuntimeInventory(join(resources, 'node/lib/node_modules/npm'));
  assert.equal(packaged.npmTreeSha256, manifest.npmTreeSha256);
});

test('refuses npm symlinks and an npm CLI missing from the same distribution', async (t) => {
  const { sourceNode, npmRoot, resources } = await fixture(t);
  await symlink(join(npmRoot, 'package.json'), join(npmRoot, 'linked-package.json'));
  await assert.rejects(stageNodeNpmRuntime({ sourceNode, resources, nodeVersion: 'v22.23.0' }), /symlink/);
  await rm(join(npmRoot, 'linked-package.json'));
  await rm(join(npmRoot, 'bin/npm-cli.js'));
  await assert.rejects(stageNodeNpmRuntime({ sourceNode, resources, nodeVersion: 'v22.23.0' }));
});

test('refuses a source Node symlink and an unsupported Node major', async (t) => {
  const { root, sourceNode, resources } = await fixture(t);
  const linked = join(root, 'linked/bin/node');
  await mkdir(join(root, 'linked/bin'), { recursive: true });
  await symlink(sourceNode, linked);
  await assert.rejects(stageNodeNpmRuntime({ sourceNode: linked, resources, nodeVersion: 'v22.23.0' }), /real bin\/node/);
  await assert.rejects(stageNodeNpmRuntime({ sourceNode, resources, nodeVersion: 'v24.0.0' }), /Node 22/);
});
