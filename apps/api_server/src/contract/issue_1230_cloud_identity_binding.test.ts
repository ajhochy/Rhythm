import Database from 'better-sqlite3';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { User } from '../models/user';
import {
  initializeMobilePairingSchema,
  MobileDevicesRepository,
} from '../repositories/mobile_devices_repository';
import { MobileGatewayController } from '../controllers/mobile_gateway_controller';
import { requireMobileCloudUser } from '../middleware/mobile_device_auth';
import { MobileCloudIdentityService } from '../services/mobile_cloud_identity_service';
import { MobilePairingService } from '../services/mobile_pairing_service';
import { startTestServer } from '../__tests__/helpers/real_server';

function user(overrides: Partial<User>): User {
  return {
    id: 1,
    name: 'Local User',
    email: 'bound@example.com',
    googleSub: 'google-bound',
    photoUrl: null,
    role: 'member',
    isFacilitiesManager: false,
    emailNotificationsEnabled: true,
    timezone: 'America/Los_Angeles',
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
    ...overrides,
  };
}

function cloudResponse(cloudUser: User): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify({ user: cloudUser, workspace: null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('issue #1230 immutable cloud/local identity binding contracts', () => {
  const closes: Array<() => Promise<void>> = [];
  const databases: Database.Database[] = [];

  afterEach(async () => {
    await Promise.all(closes.splice(0).map((close) => close()));
    for (const db of databases.splice(0)) db.close();
  });

  it('issue-1230-c1: a numeric collision resolves by Google subject', async () => {
    // Regression caught: Cloud id=7 is returned as local id=7 despite its subject belonging to local id=42.
    const local = user({ id: 42 });
    const service = new MobileCloudIdentityService({
      localSessions: { getUserForSessionToken: vi.fn().mockResolvedValue(null) },
      localUsers: {
        findByGoogleSubAsync: vi.fn().mockResolvedValue(local),
        findByEmailAsync: vi.fn().mockResolvedValue(local),
      },
      fetchFn: vi.fn(() => cloudResponse(user({ id: 7 }))),
    } as never);
    await expect(service.authenticateBearerToken('cloud-token')).resolves.toEqual(local);
  });

  it('issue-1230-c2: mismatched immutable identity is rejected', async () => {
    // Regression caught: an existing email binding is silently rebound to a different subject.
    const local = user({ id: 42, googleSub: 'google-original' });
    const service = new MobileCloudIdentityService({
      localSessions: { getUserForSessionToken: vi.fn().mockResolvedValue(null) },
      localUsers: {
        findByGoogleSubAsync: vi.fn().mockResolvedValue(null),
        findByEmailAsync: vi.fn().mockResolvedValue(local),
      },
      fetchFn: vi.fn(() =>
        cloudResponse(user({ id: 42, googleSub: 'google-attacker' })),
      ),
    } as never);
    await expect(service.authenticateBearerToken('cloud-token')).resolves.toBeNull();
  });

  it('issue-1230-c3: pairing ownership uses the resolved local identifier', async () => {
    // Regression caught: the HTTP pairing route persists Cloud id=84000 as a
    // local owner rather than the subject-bound local id=84.
    const local = user({ id: 84 });
    const cloudIdentity = new MobileCloudIdentityService({
      localSessions: { getUserForSessionToken: vi.fn().mockResolvedValue(null) },
      localUsers: {
        findByGoogleSubAsync: vi.fn().mockResolvedValue(local),
        findByEmailAsync: vi.fn().mockResolvedValue(local),
      },
      fetchFn: vi.fn(() => cloudResponse(user({ id: 84_000 }))),
    } as never);
    const db = new Database(':memory:');
    databases.push(db);
    initializeMobilePairingSchema(db);
    const pairing = new MobilePairingService({
      repository: new MobileDevicesRepository(db),
      hostId: 'host-1230',
    });
    const controller = new MobileGatewayController(pairing);
    const app = express();
    app.use(express.json());
    app.post(
      '/pairing-codes',
      requireMobileCloudUser(cloudIdentity),
      (req, res, next) => controller.createPairingCode(req, res, next),
    );
    app.post('/pair', (req, res, next) => controller.pair(req, res, next));
    const server = await startTestServer(app);
    closes.push(server.close);

    const codeResponse = await fetch(`${server.baseUrl}/pairing-codes`, {
      method: 'POST',
      headers: { Authorization: 'Bearer cloud-token' },
    });
    expect(codeResponse.status).toBe(201);
    const code = (await codeResponse.json()) as {
      pairingCode: string;
      hostId: string;
    };
    const pairResponse = await fetch(`${server.baseUrl}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairingCode: code.pairingCode,
        hostId: code.hostId,
        deviceName: 'Bound iPhone',
      }),
    });
    expect(pairResponse.status).toBe(201);
    expect(
      db.prepare('SELECT user_id FROM mobile_devices').get(),
    ).toEqual({ user_id: 84 });
  });

  it('issue-1230-c4: valid immutable bindings continue to authenticate', async () => {
    // Regression caught: collision defense either rejects a correctly bound
    // user or authorizes the unrelated local row whose numeric id equals Cloud.
    const local = user({ id: 55 });
    const wrongNumericCollision = user({
      id: 999,
      email: 'wrong@example.com',
      googleSub: 'google-wrong',
    });
    const service = new MobileCloudIdentityService({
      localSessions: { getUserForSessionToken: vi.fn().mockResolvedValue(null) },
      localUsers: {
        findByGoogleSubAsync: vi.fn().mockResolvedValue(local),
        findByEmailAsync: vi.fn(async (email: string) =>
          email === local.email ? local : wrongNumericCollision,
        ),
      },
      fetchFn: vi.fn(() => cloudResponse(user({ id: 999 }))),
    } as never);
    await expect(service.authenticateBearerToken('cloud-token')).resolves.toEqual(local);
  });
});
