import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const describeLive =
  process.env.RHYTHM_LIVE_E2E === '1' ? describe : describe.skip;
const gatewayUrl = (
  process.env.RHYTHM_LIVE_MOBILE_GATEWAY_URL ?? ''
).replace(/\/$/, '');

describeLive('live E2E — issue #1175 pairing compatibility', () => {
  it('advertises the exact shipping mobile contract fingerprint', async () => {
    // Regression caught: the gateway can be healthy while advertising a stale
    // fingerprint that every shipping phone rejects before pairing.
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(gatewayUrl)) {
      throw new Error(
        'RHYTHM_LIVE_MOBILE_GATEWAY_URL must be an isolated loopback URL',
      );
    }

    const manifest = JSON.parse(
      await readFile(
        resolve(
          process.cwd(),
          '../mobile/contracts/rhythm-opencode-contract.json',
        ),
        'utf8',
      ),
    ) as { openapiSha256: string };
    const response = await fetch(`${gatewayUrl}/mobile-gateway/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'ready',
      contractFingerprint: manifest.openapiSha256,
    });
  });
});
