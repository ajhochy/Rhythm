import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
assert.equal(pkg.dependencies['@opencode-ai/sdk'], '1.14.49');

const manifest = JSON.parse(
  await readFile(new URL('../contracts/rhythm-opencode-contract.json', import.meta.url), 'utf8'),
);
assert.equal(manifest.engineVersion, '1.14.49');
assert.equal(manifest.operationCount, 136);
assert.equal(manifest.operations.length, 136);
assert.equal(new Set(manifest.operations.map(({ operationId }) => operationId)).size, 136);

const pairedHostStoreSource = await readFile(
  new URL('../lib/pairing/paired-host-store.ts', import.meta.url),
  'utf8',
);
const pinnedEngineVersion = pairedHostStoreSource.match(
  /export const EXPECTED_OPENCODE_VERSION = '([^']+)'/,
)?.[1];
const pinnedContractFingerprint = pairedHostStoreSource.match(
  /export const EXPECTED_CONTRACT_FINGERPRINT =\s*'([^']+)'/,
)?.[1];
assert.equal(pinnedEngineVersion, manifest.engineVersion);
assert.equal(pinnedContractFingerprint, manifest.openapiSha256);

const rhythmRoot = process.env.RHYTHM_REPO
  ? new URL(`file://${process.env.RHYTHM_REPO.replace(/\/$/, '')}/`)
  : new URL('../../../', import.meta.url);
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
