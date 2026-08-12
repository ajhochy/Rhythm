import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MOBILE_GATEWAY_COMPATIBILITY } from '../services/mobile_pairing_service';

// Regression guard: the Mac advertises MOBILE_GATEWAY_COMPATIBILITY.{opencodeVersion,
// contractFingerprint} to the mobile app, which refuses to pair unless they equal
// its own EXPECTED_OPENCODE_VERSION / EXPECTED_CONTRACT_FINGERPRINT ("This Mac and
// app use incompatible agent protocols"). Both must track the generated mobile
// contract manifest. Bumping one side without the other silently breaks pairing
// while every other suite stays green — which is exactly what happened when the
// #1352 mcp-app ops changed the manifest. Pin both here so it can't recur.
describe('mobile pairing fingerprint stays in sync with the generated contract', () => {
  const manifest = JSON.parse(
    readFileSync(
      resolve(__dirname, '../../../mobile/contracts/rhythm-opencode-contract.json'),
      'utf8',
    ),
  ) as { openapiSha256: string; engineVersion: string };

  it('server-advertised contractFingerprint equals the manifest openapiSha256', () => {
    expect(MOBILE_GATEWAY_COMPATIBILITY.contractFingerprint).toBe(
      manifest.openapiSha256,
    );
  });

  it('server-advertised opencodeVersion equals the manifest engineVersion', () => {
    expect(MOBILE_GATEWAY_COMPATIBILITY.opencodeVersion).toBe(
      manifest.engineVersion,
    );
  });
});
