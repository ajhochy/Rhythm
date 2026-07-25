import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(scriptDir, '..');
const openApiPath = resolve(
  apiRoot,
  '../opencode_fork/packages/sdk/openapi.json',
);
const outputPath = resolve(
  apiRoot,
  'src/services/mobile_opencode_operations.generated.ts',
);
const classificationPath = resolve(
  apiRoot,
  '../mobile/contracts/rhythm-opencode-classifications.json',
);

const classificationInventory = JSON.parse(
  readFileSync(classificationPath, 'utf8'),
);
const classifications = new Map(
  classificationInventory.operations.map((operation) => [
    operation.operationId,
    operation,
  ]),
);

function blockedReason(operationId) {
  const classification = classifications.get(operationId);
  if (!classification) {
    throw new Error(`Missing mobile classification for ${operationId}`);
  }
  if (classification.gatewayAllowed) return undefined;
  if (!classification.gatewayReason) {
    throw new Error(`Missing mobile gateway denial reason for ${operationId}`);
  }
  return classification.gatewayReason;
}

const spec = JSON.parse(readFileSync(openApiPath, 'utf8'));
const methods = ['get', 'post', 'put', 'patch', 'delete'];
const operations = [];
for (const [path, pathItem] of Object.entries(spec.paths)) {
  for (const method of methods) {
    const operation = pathItem[method];
    if (!operation?.operationId) continue;
    const classification = classifications.get(operation.operationId);
    if (
      classification?.method !== method.toUpperCase() ||
      classification?.path !== path
    ) {
      throw new Error(
        `Mobile classification drifted for ${operation.operationId}`,
      );
    }
    const reason = blockedReason(operation.operationId);
    operations.push({
      operationId: operation.operationId,
      method: method.toUpperCase(),
      path,
      allowed: !reason,
      ...(reason ? { reason } : {}),
    });
  }
}
operations.sort((left, right) =>
  left.operationId.localeCompare(right.operationId));
if (operations.length !== classifications.size) {
  throw new Error(
    `Mobile classification count ${classifications.size} does not match bundled operation count ${operations.length}`,
  );
}

const lines = [
  '// GENERATED FILE — DO NOT EDIT.',
  '// Regenerate with: node scripts/generate-mobile-opencode-operations.mjs',
  '// Source: apps/opencode_fork/packages/sdk/openapi.json',
  '',
  "import type { MobileOpenCodeOperation } from './mobile_opencode_proxy_types';",
  '',
  'export const MOBILE_OPENCODE_OPERATION_MANIFEST = [',
  ...operations.map((operation) => `  ${JSON.stringify(operation)},`),
  '] as const satisfies readonly MobileOpenCodeOperation[];',
  '',
];
writeFileSync(outputPath, lines.join('\n'));

const allowed = operations.filter((operation) => operation.allowed).length;
const denied = operations.length - allowed;
console.log(
  `Generated ${operations.length} mobile OpenCode decisions (${allowed} allowed, ${denied} denied)`,
);
