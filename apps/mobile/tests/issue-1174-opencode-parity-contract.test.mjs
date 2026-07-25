import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mobileRoot = new URL('../', import.meta.url);
const rhythmRoot = new URL('../../../', import.meta.url);

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

function collectOperations(openapi) {
  const methods = new Set(['get', 'post', 'put', 'patch', 'delete']);
  return Object.entries(openapi.paths ?? {})
    .flatMap(([path, pathItem]) => Object.entries(pathItem)
      .filter(([method, operation]) =>
        methods.has(method) && operation?.operationId)
      .map(([method, operation]) => ({
        operationId: operation.operationId,
        method: method.toUpperCase(),
        path,
      })))
    .sort((left, right) =>
      left.operationId.localeCompare(right.operationId));
}

function parseGatewayManifest(source) {
  return [...source.matchAll(/^  (\{.*\}),$/gm)]
    .map((match) => JSON.parse(match[1]))
    .sort((left, right) =>
      left.operationId.localeCompare(right.operationId));
}

function publicOperation(operation) {
  return {
    operationId: operation.operationId,
    method: operation.method,
    path: operation.path,
  };
}

const [
  classificationInventory,
  shippingContract,
  mobilePackage,
  enginePackage,
  openapi,
  contractGeneratorSource,
  gatewayManifestSource,
] = await Promise.all([
  readJson(new URL('contracts/rhythm-opencode-classifications.json', mobileRoot)),
  readJson(new URL('contracts/rhythm-opencode-contract.json', mobileRoot)),
  readJson(new URL('package.json', mobileRoot)),
  readJson(new URL(
    'apps/opencode_fork/packages/opencode/package.json',
    rhythmRoot,
  )),
  readJson(new URL(
    'apps/opencode_fork/packages/sdk/openapi.json',
    rhythmRoot,
  )),
  readFile(
    new URL('scripts/rhythm-opencode-contract.mjs', mobileRoot),
    'utf8',
  ),
  readFile(
    new URL(
      'apps/api_server/src/services/mobile_opencode_operations.generated.ts',
      rhythmRoot,
    ),
    'utf8',
  ),
]);

const bundledOperations = collectOperations(openapi);
const classifiedOperations = [...classificationInventory.operations]
  .sort((left, right) =>
    left.operationId.localeCompare(right.operationId));
const gatewayOperations = parseGatewayManifest(gatewayManifestSource);
const classifications = new Set([
  'surfaced',
  'internal',
  'alternate',
  'intentionally-omitted',
]);

test('issue-1174-c1: every bundled operation has exactly one classification and reason', () => {
  // Regression caught: a fork upgrade adds an endpoint, but the mobile contract
  // silently forwards it because no reviewer was forced to classify it.
  assert.equal(bundledOperations.length, 133);
  assert.equal(classifiedOperations.length, bundledOperations.length);
  assert.equal(
    new Set(classifiedOperations.map(({ operationId }) => operationId)).size,
    bundledOperations.length,
    'duplicate operation classification',
  );
  assert.deepEqual(
    classifiedOperations.map(publicOperation),
    bundledOperations,
    'missing, extra, or path/method-drifted operation classification',
  );

  for (const operation of classifiedOperations) {
    assert.ok(
      classifications.has(operation.classification),
      `${operation.operationId} has invalid classification`,
    );
    assert.ok(
      typeof operation.reason === 'string' &&
        operation.reason.trim().length >= 12,
      `${operation.operationId} is missing a meaningful reason`,
    );
  }

  const shippingById = new Map(
    shippingContract.operations.map((operation) => [
      operation.operationId,
      operation,
    ]),
  );
  const shippingClassificationGaps = [];
  for (const expected of classifiedOperations) {
    const shipped = shippingById.get(expected.operationId);
    assert.ok(shipped, `${expected.operationId} is absent from shipping contract`);
    if (
      shipped.classification !== expected.classification ||
      shipped.reason !== expected.reason
    ) {
      shippingClassificationGaps.push(expected.operationId);
    }
  }
  assert.deepEqual(
    shippingClassificationGaps,
    [],
    'shipping contract has missing or drifted classifications/reasons',
  );
});

test('issue-1174-c2: mobile contract is generated from bundled OpenCode 1.14.49', () => {
  // Regression caught: contract sync resolves a floating npm release and
  // quietly changes the mobile API independently of Rhythm's bundled engine.
  const canonicalOpenapi = `${JSON.stringify(openapi)}\n`;
  const openapiSha256 = createHash('sha256')
    .update(canonicalOpenapi)
    .digest('hex');

  assert.equal(enginePackage.name, 'opencode');
  assert.equal(enginePackage.version, '1.14.49');
  assert.equal(mobilePackage.dependencies['@opencode-ai/sdk'], '1.14.49');
  assert.equal(classificationInventory.source.engineVersion, '1.14.49');
  assert.equal(shippingContract.engineVersion, '1.14.49');
  assert.equal(classificationInventory.source.operationCount, 133);
  assert.equal(classificationInventory.source.openapiSha256, openapiSha256);
  assert.equal(shippingContract.openapiSha256, openapiSha256);
  assert.match(
    contractGeneratorSource,
    /apps\/opencode_fork\/packages\/sdk\/openapi\.json/,
  );
  assert.doesNotMatch(
    contractGeneratorSource,
    /\bnpm\s+(?:view|install)|@latest|latest-only/i,
  );
});

test('issue-1174-c3: gateway allowlist exactly matches mobile classifications', () => {
  // Regression caught: an alternate or intentionally omitted endpoint remains
  // reachable because the generated gateway defaults every unknown-safe route
  // to allowed.
  assert.deepEqual(
    gatewayOperations.map(publicOperation),
    classifiedOperations.map(publicOperation),
    'gateway and classification inventories cover different operations',
  );

  const expectedById = new Map(
    classifiedOperations.map((operation) => [
      operation.operationId,
      operation,
    ]),
  );
  const gatewayDecisionMismatches = [];
  for (const gatewayOperation of gatewayOperations) {
    const expected = expectedById.get(gatewayOperation.operationId);
    if (
      gatewayOperation.allowed !== expected.gatewayAllowed ||
      (
        !expected.gatewayAllowed &&
        gatewayOperation.reason !== expected.gatewayReason
      )
    ) {
      gatewayDecisionMismatches.push({
        operationId: gatewayOperation.operationId,
        classification: expected.classification,
        expectedAllowed: expected.gatewayAllowed,
        actualAllowed: gatewayOperation.allowed,
        expectedReason: expected.gatewayReason,
        actualReason: gatewayOperation.reason ?? null,
      });
    }
  }
  assert.deepEqual(
    gatewayDecisionMismatches,
    [],
    'gateway decisions disagree with the reviewed mobile classification policy',
  );

  for (const operation of classifiedOperations) {
    if (
      operation.classification === 'alternate' ||
      operation.classification === 'intentionally-omitted'
    ) {
      assert.equal(
        operation.gatewayAllowed,
        false,
        `${operation.operationId} may not be generically forwarded`,
      );
    }
  }

  assert.deepEqual(
    classifiedOperations
      .filter((operation) =>
        operation.classification === 'internal' &&
        operation.gatewayAllowed === false)
      .map(({ operationId }) => operationId),
    ['global.event', 'pty.connect'],
    'only dedicated SSE and PTY channels may be internal but absent from the generic gateway',
  );
});
