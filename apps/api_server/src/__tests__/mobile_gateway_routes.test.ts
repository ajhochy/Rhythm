import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app';
import { setDb } from '../database/db';
import { startTestServer } from './helpers/real_server';

describe('mobile gateway pairing HTTP routes', () => {
  let db: Database.Database;
  let baseUrl: string;
  let closeServer: () => Promise<void>;

  beforeEach(async () => {
    db = new Database(':memory:');
    setDb(db);
    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
    db.close();
  });

  it('creates a code, pairs, lists, revokes, and reports health through all five endpoints', async () => {
    const healthResponse = await fetch(`${baseUrl}/mobile-gateway/health`);
    expect(healthResponse.status).toBe(200);
    expect(await healthResponse.json()).toMatchObject({
      status: 'ready',
      gatewayVersion: '1',
      opencodeVersion: '1.14.49',
    });

    const codeResponse = await fetch(`${baseUrl}/mobile-gateway/pairing-codes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 1 }),
    });
    expect(codeResponse.status).toBe(201);
    const code = (await codeResponse.json()) as { pairingCode: string };
    expect(code.pairingCode).toBeTruthy();

    const pairResponse = await fetch(`${baseUrl}/mobile-gateway/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairingCode: code.pairingCode,
        userId: 1,
        deviceName: 'AJ iPhone',
      }),
    });
    expect(pairResponse.status).toBe(201);
    const paired = (await pairResponse.json()) as { deviceId: string; deviceToken: string };
    expect(paired.deviceToken).toBeTruthy();

    const listResponse = await fetch(`${baseUrl}/mobile-gateway/devices?userId=1`);
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toEqual([
      expect.objectContaining({
        id: paired.deviceId,
        userId: 1,
        name: 'AJ iPhone',
        revokedAt: null,
      }),
    ]);

    const revokeResponse = await fetch(
      `${baseUrl}/mobile-gateway/devices/${paired.deviceId}?userId=1`,
      { method: 'DELETE' },
    );
    expect(revokeResponse.status).toBe(204);

    const revokedListResponse = await fetch(`${baseUrl}/mobile-gateway/devices?userId=1`);
    const devices = (await revokedListResponse.json()) as Array<{ revokedAt: string | null }>;
    expect(devices[0].revokedAt).not.toBeNull();
  });
});
