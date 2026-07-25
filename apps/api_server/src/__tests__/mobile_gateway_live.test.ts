import { randomInt } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const baseUrl = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');

describeLive('live E2E — mobile gateway pairing', () => {
  it('pairs and revokes through the running API server', async () => {
    if (!baseUrl || baseUrl.includes(':4001')) {
      throw new Error('RHYTHM_LIVE_URL must target an isolated non-4001 API server');
    }
    const userId = randomInt(1, 2_147_483_647);

    const healthResponse = await fetch(`${baseUrl}/mobile-gateway/health`);
    expect(healthResponse.status).toBe(200);
    expect(await healthResponse.json()).toMatchObject({ status: 'ready', gatewayVersion: '1' });

    const codeResponse = await fetch(`${baseUrl}/mobile-gateway/pairing-codes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    expect(codeResponse.status).toBe(201);
    const { pairingCode } = (await codeResponse.json()) as { pairingCode: string };

    const pairResponse = await fetch(`${baseUrl}/mobile-gateway/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingCode, userId, deviceName: 'Live Test iPhone' }),
    });
    expect(pairResponse.status).toBe(201);
    const paired = (await pairResponse.json()) as { deviceId: string; deviceToken: string };
    expect(paired.deviceToken).toBeTruthy();

    const listResponse = await fetch(
      `${baseUrl}/mobile-gateway/devices?userId=${encodeURIComponent(userId)}`,
    );
    expect(listResponse.status).toBe(200);
    const devices = (await listResponse.json()) as Array<Record<string, unknown>>;
    expect(devices).toEqual([
      expect.objectContaining({ id: paired.deviceId, userId, revokedAt: null }),
    ]);
    expect(JSON.stringify(devices)).not.toContain(paired.deviceToken);

    const revokeResponse = await fetch(
      `${baseUrl}/mobile-gateway/devices/${paired.deviceId}?userId=${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
    );
    expect(revokeResponse.status).toBe(204);

    const revokedResponse = await fetch(
      `${baseUrl}/mobile-gateway/devices?userId=${encodeURIComponent(userId)}`,
    );
    const revokedDevices = (await revokedResponse.json()) as Array<{ revokedAt: string | null }>;
    expect(revokedDevices[0].revokedAt).not.toBeNull();
  });
});
