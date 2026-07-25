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

const BLOCKED_EXACT = new Map([
  ['app.log', 'Mobile requests may not write arbitrary engine log payloads'],
  ['event.subscribe', 'SSE is exposed only through the bounded realtime gateway'],
  ['global.config.update', 'Unscoped global configuration mutation is not mobile-safe'],
  ['global.dispose', 'Rhythm desktop owns the engine lifecycle'],
  ['global.event', 'SSE is exposed only through the bounded realtime gateway'],
  ['global.upgrade', 'Rhythm desktop owns fork upgrades'],
  ['instance.dispose', 'Rhythm desktop owns engine instance disposal'],
  ['pty.connect', 'PTY WebSocket traffic uses the authenticated realtime gateway'],
]);

const BLOCKED_PREFIXES = [
  ['experimental.console.', 'Experimental Console APIs are not supported'],
  ['experimental.workspace.', 'Experimental workspace/sync APIs are not supported'],
  ['sync.', 'Experimental workspace/sync APIs are not supported'],
  ['tui.', 'The mobile client controls the headless server, not the TUI'],
  ['v2.', 'The mobile contract is pinned to the supported v1 API'],
];

function blockedReason(operationId) {
  const exact = BLOCKED_EXACT.get(operationId);
  if (exact) return exact;
  return BLOCKED_PREFIXES.find(([prefix]) =>
    operationId.startsWith(prefix))?.[1];
}

const spec = JSON.parse(readFileSync(openApiPath, 'utf8'));
const methods = ['get', 'post', 'put', 'patch', 'delete'];
const operations = [];
for (const [path, pathItem] of Object.entries(spec.paths)) {
  for (const method of methods) {
    const operation = pathItem[method];
    if (!operation?.operationId) continue;
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
