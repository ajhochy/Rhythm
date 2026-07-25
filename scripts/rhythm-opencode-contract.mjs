import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function collectOperations(openapi) {
  const methods = new Set(['get', 'post', 'put', 'patch', 'delete']);
  return Object.entries(openapi.paths ?? {})
    .flatMap(([route, item]) => Object.entries(item)
      .filter(([method, operation]) => methods.has(method) && operation?.operationId)
      .map(([method, operation]) => ({
        method: method.toUpperCase(),
        path: route,
        operationId: operation.operationId,
        summary: operation.summary ?? '',
        tags: operation.tags ?? [],
      })))
    .sort((left, right) => left.operationId.localeCompare(right.operationId));
}

export function buildManifest(enginePackage, openapi) {
  const canonicalOpenapi = `${JSON.stringify(openapi)}\n`;
  const operations = collectOperations(openapi);
  return {
    engineVersion: enginePackage.version,
    openapiSha256: createHash('sha256').update(canonicalOpenapi).digest('hex'),
    operationCount: operations.length,
    operations,
  };
}

const mode = process.argv[2];
if (!['--write', '--check'].includes(mode) || process.argv.length !== 3) {
  throw new Error('Usage: rhythm-opencode-contract.mjs --write|--check');
}

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rhythmRoot = process.env.RHYTHM_REPO ?? path.resolve(mobileRoot, '../Rhythm');
const manifest = buildManifest(
  JSON.parse(await readFile(path.join(rhythmRoot, 'apps/opencode_fork/packages/opencode/package.json'), 'utf8')),
  JSON.parse(await readFile(path.join(rhythmRoot, 'apps/opencode_fork/packages/sdk/openapi.json'), 'utf8')),
);
const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
const manifestPath = path.join(mobileRoot, 'contracts/rhythm-opencode-contract.json');

if (mode === '--write') {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, serialized);
} else if ((await readFile(manifestPath, 'utf8').catch(() => '')) !== serialized) {
  console.error('Rhythm OpenCode contract drifted; run npm run contract:sync');
  process.exitCode = 1;
}
