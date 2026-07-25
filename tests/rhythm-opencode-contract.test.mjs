import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
assert.equal(pkg.dependencies['@opencode-ai/sdk'], '1.14.49');

const manifest = JSON.parse(
  await readFile(new URL('../contracts/rhythm-opencode-contract.json', import.meta.url), 'utf8'),
);
assert.equal(manifest.engineVersion, '1.14.49');
assert.equal(manifest.operationCount, 133);
assert.equal(manifest.operations.length, 133);
assert.equal(new Set(manifest.operations.map(({ operationId }) => operationId)).size, 133);

const rhythmRoot = process.env.RHYTHM_REPO
  ? new URL(`file://${process.env.RHYTHM_REPO.replace(/\/$/, '')}/`)
  : new URL('../../Rhythm/', import.meta.url);
const openapi = JSON.parse(
  await readFile(new URL('apps/opencode_fork/packages/sdk/openapi.json', rhythmRoot), 'utf8'),
);

assert.deepEqual(
  openapi.paths['/vcs/diff'].get.parameters.map(({ name }) => name).sort(),
  ['directory', 'mode', 'workspace'],
);

const ptyTicket = openapi.paths['/pty/{ptyID}/connect-token']
  .post.responses['200'].content['application/json'].schema;
assert.deepEqual([...ptyTicket.required].sort(), ['expires_in', 'ticket']);

const globalEventTypes = openapi.components.schemas.GlobalEvent.properties.payload.anyOf
  .flatMap(({ $ref }) => openapi.components.schemas[$ref.split('/').at(-1)]?.properties?.type?.enum ?? []);
assert.equal(globalEventTypes.includes('catalog.updated'), false);
assert.equal(globalEventTypes.includes('project.updated'), true);

execFileSync('node', ['./scripts/rhythm-opencode-contract.mjs', '--check'], {
  cwd: new URL('..', import.meta.url),
  stdio: 'inherit',
});

console.log('Rhythm OpenCode contract tests passed');
