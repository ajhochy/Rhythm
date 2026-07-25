import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import { startTestServer } from './helpers/real_server';

describe('mobile gateway pairing HTTP routes', () => {
  let db: Database.Database;
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let userId: number;
  let authHeaders: Record<string, string>;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    const user = new UsersRepository().create({
      name: 'AJ',
      email: 'mobile-gateway-routes@example.com',
    });
    userId = user.id;
    const session = new SessionsRepository().create(user.id);
    authHeaders = {
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'application/json',
    };
    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
    db.close();
  });

  it('creates a code, pairs, lists, revokes, and reports health through all five endpoints', async () => {
    const healthResponse = await fetch(`${baseUrl}/mobile-gateway/health`, {
      headers: authHeaders,
    });
    expect(healthResponse.status).toBe(200);
    expect(await healthResponse.json()).toMatchObject({
      status: 'ready',
      gatewayVersion: '1',
      opencodeVersion: '1.14.49',
    });

    const codeResponse = await fetch(`${baseUrl}/mobile-gateway/pairing-codes`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({}),
    });
    expect(codeResponse.status).toBe(201);
    const code = (await codeResponse.json()) as { pairingCode: string };
    expect(code.pairingCode).toBeTruthy();

    const pairResponse = await fetch(`${baseUrl}/mobile-gateway/pair`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        pairingCode: code.pairingCode,
        deviceName: 'AJ iPhone',
      }),
    });
    expect(pairResponse.status).toBe(201);
    const paired = (await pairResponse.json()) as { deviceId: string; deviceToken: string };
    expect(paired.deviceToken).toBeTruthy();

    const deviceHealthResponse = await fetch(`${baseUrl}/mobile-gateway/health`, {
      headers: { Authorization: `Device ${paired.deviceToken}` },
    });
    expect(deviceHealthResponse.status).toBe(200);

    const listResponse = await fetch(`${baseUrl}/mobile-gateway/devices`, {
      headers: authHeaders,
    });
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toEqual([
      expect.objectContaining({
        id: paired.deviceId,
        userId,
        name: 'AJ iPhone',
        revokedAt: null,
      }),
    ]);

    const revokeResponse = await fetch(
      `${baseUrl}/mobile-gateway/devices/${paired.deviceId}`,
      { method: 'DELETE', headers: authHeaders },
    );
    expect(revokeResponse.status).toBe(204);

    const revokedListResponse = await fetch(`${baseUrl}/mobile-gateway/devices`, {
      headers: authHeaders,
    });
    const devices = (await revokedListResponse.json()) as Array<{ revokedAt: string | null }>;
    expect(devices[0].revokedAt).not.toBeNull();

    const revokedHealthResponse = await fetch(`${baseUrl}/mobile-gateway/health`, {
      headers: { Authorization: `Device ${paired.deviceToken}` },
    });
    expect(revokedHealthResponse.status).toBe(401);
  });
});
