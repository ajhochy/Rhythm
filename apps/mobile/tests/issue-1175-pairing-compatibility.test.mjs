import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const rhythmRoot = new URL('../../../', import.meta.url);

async function readJson(relativePath) {
  return JSON.parse(
    await readFile(new URL(relativePath, rhythmRoot), 'utf8'),
  );
}

function extractFingerprint(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `Could not find ${label}`);
  return match[1];
}

test('issue-1175-c32: shipping mobile and gateway fingerprints match the generated contract', async () => {
  // Regression caught: package-local contract checks stay green while the
  // desktop gateway advertises a stale fingerprint and every phone rejects it.
  const [manifest, classifications, pairedHostSource, pairingServiceSource] =
    await Promise.all([
      readJson('apps/mobile/contracts/rhythm-opencode-contract.json'),
      readJson('apps/mobile/contracts/rhythm-opencode-classifications.json'),
      readFile(
        new URL('apps/mobile/lib/pairing/paired-host-store.ts', rhythmRoot),
        'utf8',
      ),
      readFile(
        new URL(
          'apps/api_server/src/services/mobile_pairing_service.ts',
          rhythmRoot,
        ),
        'utf8',
      ),
    ]);

  const mobileFingerprint = extractFingerprint(
    pairedHostSource,
    /export const EXPECTED_CONTRACT_FINGERPRINT =\s*'([^']+)'/,
    'mobile shipping contract fingerprint',
  );
  const gatewayFingerprint = extractFingerprint(
    pairingServiceSource,
    /contractFingerprint:\s*'([^']+)'/,
    'gateway compatibility contract fingerprint',
  );

  assert.equal(mobileFingerprint, manifest.openapiSha256);
  assert.equal(classifications.source.openapiSha256, manifest.openapiSha256);
  assert.equal(gatewayFingerprint, manifest.openapiSha256);
});
