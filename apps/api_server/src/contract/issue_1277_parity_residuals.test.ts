import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app';
import { env } from '../config/env';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { createMobileGatewaySurface } from '../mobile_gateway_surface';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import { createMobileGatewayRouter } from '../routes/mobile_gateway_routes';
import { resetMobileGatewayRuntimeForTest } from '../services/mobile_gateway_runtime';
import {
  installHumanApprovalTestCredentials,
} from '../__tests__/helpers/human_approval_test_credentials';
import {
  startTestServer,
  type TestServer,
} from '../__tests__/helpers/real_server';

describe('issue #1277 parity residuals acceptance contract', () => {
  let db: Database.Database;
  let primary: TestServer;
  let gateway: TestServer;
  let originalPort: number;

  beforeEach(async () => {
    originalPort = env.port;
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    setDb(db);
    runMigrations(db);

    primary = await startTestServer(createApp());
    env.port = Number(new URL(primary.baseUrl).port);
    gateway = await startTestServer(
      createMobileGatewaySurface(createMobileGatewayRouter()),
    );
  });

  afterEach(async () => {
    await gateway?.close();
    await primary?.close();
    resetMobileGatewayRuntimeForTest();
    db.close();
    env.port = originalPort;
  });

  it('issue-1277-c1: both listeners return the primary API webhook receive URL', async () => {
    const capability =
      installHumanApprovalTestCredentials().capabilityHeader;
    const user = new UsersRepository().create({
      name: 'Parity owner',
      email: 'issue-1277-parity@example.com',
    });
    const session = new SessionsRepository().create(user.id);
    const desktopHeaders = {
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'application/json',
      ...capability,
    };

    const codeResponse = await fetch(
      `${primary.baseUrl}/mobile-gateway/pairing-codes`,
      {
        method: 'POST',
        headers: desktopHeaders,
        body: '{}',
      },
    );
    expect(codeResponse.status).toBe(201);
    const code = (await codeResponse.json()) as {
      pairingCode: string;
      hostId: string;
    };
    const pairResponse = await fetch(
      `${gateway.baseUrl}/mobile-gateway/pair`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairingCode: code.pairingCode,
          hostId: code.hostId,
          deviceName: 'Parity iPhone',
        }),
      },
    );
    expect(pairResponse.status).toBe(201);
    const paired = (await pairResponse.json()) as { deviceToken: string };
    const mobileHeaders = {
      Authorization: `Device ${paired.deviceToken}`,
      'Content-Type': 'application/json',
    };

    const createdResponse = await fetch(
      `${gateway.baseUrl}/mobile-gateway/tools/agent-webhooks`,
      {
        method: 'POST',
        headers: mobileHeaders,
        body: JSON.stringify({ name: 'Listener parity webhook' }),
      },
    );
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      id: string;
      url: string;
    };

    const desktopResponse = await fetch(
      `${primary.baseUrl}/agent-webhooks/${created.id}`,
      {
        headers: {
          Authorization: `Bearer ${session.token}`,
        },
      },
    );
    expect(desktopResponse.status).toBe(200);
    const desktop = (await desktopResponse.json()) as { url: string };
    const expected =
      `${primary.baseUrl}/agent-webhooks/${created.id}/receive`;

    expect(created.url).toBe(expected);
    expect(desktop.url).toBe(expected);
  });
});
