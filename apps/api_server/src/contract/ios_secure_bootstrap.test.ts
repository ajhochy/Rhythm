import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import express from 'express';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

import type { User } from '../models/user';

const PROJECT_ID = 'project-owner';
const OWNER_ID = 42;
const FOREIGN_ID = 84;
const HOST_ID = 'host-enrolled-owner';

function parseWithMobileEnvironmentGrant(
  value: unknown,
  environmentId: string,
): unknown {
  const source = readFileSync(
    join(__dirname, '../../../mobile/lib/pairing/mobile-environment-contract.ts'),
    'utf8',
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  new Function('module', 'exports', compiled)(module, module.exports);
  const parse = module.exports.parseMobileEnvironmentGrant as (
    input: unknown,
    id: string,
    parseUrl: (input: unknown) => string,
  ) => unknown;
  return parse(
    value,
    environmentId,
    (input) => new URL(String(input)).toString().replace(/\/$/, ''),
  );
}

function tokenVerifier(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function testUser(id: number, email: string, googleSub: string): User {
  const timestamp = '2026-09-12T00:00:00.000Z';
  return {
    id,
    name: `User ${id}`,
    email,
    googleSub,
    photoUrl: null,
    role: 'member',
    isFacilitiesManager: false,
    emailNotificationsEnabled: true,
    timezone: 'America/Los_Angeles',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe.sequential('iOS secure bootstrap B1 acceptance contract', () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function fixture(options: { foreignDevice?: boolean } = {}) {
    vi.resetModules();
    vi.stubEnv('RHYTHM_ROLE', 'relay');
    const storageRoot = join(tmpdir(), `ios-bootstrap-${randomUUID()}`);
    mkdirSync(storageRoot, { recursive: true });
    vi.stubEnv('LIVE_ARTIFACT_STORAGE_DIR', storageRoot);

    const { setDb } = await import('../database/db');
    const { runMigrations } = await import('../database/migrations');
    const db = new Database(':memory:');
    runMigrations(db);
    setDb(db);
    const { initializeMobilePairingSchema } = await import(
      '../repositories/mobile_devices_repository'
    );
    initializeMobilePairingSchema(db);
    const { UsersRepository } = await import('../repositories/users_repository');
    const { SessionsRepository } = await import('../repositories/sessions_repository');
    const users = new UsersRepository();
    const owner = users.create({ name: 'Owner', email: 'owner@example.com' });
    const foreign = users.create({ name: 'Foreign', email: 'foreign@example.com' });
    db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run('google-owner', owner.id);
    db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run('google-foreign', foreign.id);
    const sessions = new SessionsRepository();
    const ownerSession = sessions.create(owner.id);
    const foreignSession = sessions.create(foreign.id);
    const now = '2026-09-12T00:00:00.000Z';
    const ownerDeviceToken = 'owner-device-token';
    const foreignDeviceToken = 'foreign-device-token';
    db.prepare(
      `INSERT INTO mobile_devices
         (id, host_id, user_id, name, token_verifier, revoked_at, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    ).run(
      'device-owner', HOST_ID, owner.id, 'Owner iPhone', tokenVerifier(ownerDeviceToken), now,
    );
    if (options.foreignDevice) {
      db.prepare(
        `INSERT INTO mobile_devices
           (id, host_id, user_id, name, token_verifier, revoked_at, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?)`,
      ).run(
        'device-foreign',
        'host-foreign',
        foreign.id,
        'Foreign iPhone',
        tokenVerifier(foreignDeviceToken),
        now,
      );
    }

    cleanups.push(() => {
      db.close();
      rmSync(storageRoot, { recursive: true, force: true });
    });
    return {
      db,
      storageRoot,
      ownerId: owner.id,
      foreignId: foreign.id,
      ownerToken: ownerSession.token,
      foreignToken: foreignSession.token,
      ownerDeviceToken,
      foreignDeviceToken,
    };
  }

  async function startRelay(
    sendRpc: (request: { method: string; path: string; headers: Record<string, string>; bodyB64: string }) => Promise<{
      status: number;
      headers: Record<string, string>;
      bodyB64: string;
    }> = async () => ({ status: 200, headers: { 'content-type': 'application/json' }, bodyB64: 'e30=' }),
  ) {
    const { OpencodeEventHub } = await import('../services/opencode_event_hub');
    const { createRelayGatewayRouter } = await import('../routes/relay_gateway_routes');
    const { errorHandler } = await import('../middleware/error_handler');
    const hub = new OpencodeEventHub();
    hub.setLive(true);
    const uplink = {
      hub,
      isMacOnline: () => true,
      isHostOnline: (hostId: string, userId: number) =>
        hostId === HOST_ID && userId === 1,
      getHealth: () => ({ hostId: HOST_ID }),
      getLastUplinkAt: () => '2026-09-12T00:00:00.000Z',
      onResynced: () => {},
      sendRpc,
    };
    const app = express();
    app.use(express.json());
    app.use('/relay', createRelayGatewayRouter({ uplink: uplink as never }));
    app.use(errorHandler);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  it('task-ios-secure-bootstrap-c1: only the bound owner discovers the enrolled environment', async () => {
    // Regression caught: a foreign authenticated account can enumerate another owner's computer.
    const state = await fixture();
    const baseUrl = await startRelay();
    const ownerResponse = await fetch(`${baseUrl}/relay/mobile-environments`, {
      headers: { Authorization: `Bearer ${state.ownerToken}` },
    });
    expect(ownerResponse.status).toBe(200);
    expect(ownerResponse.headers.get('cache-control')).toBe('no-store');
    expect(await ownerResponse.json()).toEqual({
      environments: [{ id: HOST_ID, name: 'Rhythm Mac', status: 'online', historyAvailable: true }],
    });
    const foreignResponse = await fetch(`${baseUrl}/relay/mobile-environments`, {
      headers: { Authorization: `Bearer ${state.foreignToken}` },
    });
    expect(foreignResponse.status).toBe(200);
    expect(await foreignResponse.json()).toEqual({ environments: [] });
    expect((await fetch(`${baseUrl}/relay/mobile-environments`)).status).toBe(401);
  });

  it('task-ios-secure-bootstrap-c2: connect validates input and returns one same-origin account-bound grant', async () => {
    // Regression caught: retries create duplicate grants or a relay URL can be injected from request input.
    const state = await fixture();
    const grants = new Map<string, { deviceId: string; deviceToken: string }>();
    const baseUrl = await startRelay(async (request) => {
      const body = JSON.parse(Buffer.from(request.bodyB64, 'base64').toString('utf8')) as {
        deviceName: string;
        environmentId: string;
      };
      expect(request.headers.authorization).toBe(`Bearer ${state.ownerToken}`);
      expect(body.environmentId).toBe(HOST_ID);
      const grant = grants.get(body.deviceName) ?? {
        deviceId: 'bootstrap-device',
        deviceToken: 'bootstrap-device-token',
      };
      grants.set(body.deviceName, grant);
      return {
        status: 201,
        headers: { 'content-type': 'application/json' },
        bodyB64: Buffer.from(JSON.stringify({ ...grant, hostId: HOST_ID, userId: state.ownerId })).toString('base64'),
      };
    });
    const connect = () => fetch(`${baseUrl}/relay/mobile-environments/${HOST_ID}/connect`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceName: 'AJ iPhone', gatewayUrl: 'https://attacker.invalid' }),
    });
    const first = await connect();
    const second = await connect();
    expect(first.status).toBe(201);
    const firstGrantResponse = await first.json();
    expect(firstGrantResponse).toEqual({
      environmentId: HOST_ID,
      hostId: HOST_ID,
      deviceId: 'bootstrap-device',
      deviceToken: 'bootstrap-device-token',
      gatewayBaseUrl: `${baseUrl}/relay/mobile-gateway`,
    });
    expect(parseWithMobileEnvironmentGrant(firstGrantResponse, HOST_ID))
      .toEqual(firstGrantResponse);
    expect(((await second.json()) as { deviceId: string }).deviceId).toBe(
      'bootstrap-device',
    );
    expect(grants.size).toBe(1);
    expect((await fetch(`${baseUrl}/relay/mobile-environments/${HOST_ID}/connect`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceName: 'x'.repeat(129) }),
    })).status).toBe(400);
    expect((await fetch(`${baseUrl}/relay/mobile-environments/${HOST_ID}/connect`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.foreignToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceName: 'Foreign iPhone' }),
    })).status).toBe(404);

    const { getMobilePairingService } = await import(
      '../services/mobile_gateway_runtime'
    );
    const pairing = getMobilePairingService();
    const firstGrant = pairing.grantCloudDevice(state.ownerId, 'AJ iPhone');
    const retriedGrant = pairing.grantCloudDevice(state.ownerId, 'AJ iPhone');
    expect(retriedGrant.deviceId).toBe(firstGrant.deviceId);
    expect(state.db.prepare('SELECT COUNT(*) AS count FROM mobile_devices WHERE id = ?')
      .get(firstGrant.deviceId)).toEqual({ count: 1 });
    expect(pairing.authenticateDevice(firstGrant.deviceToken)).toBeNull();
    expect(pairing.authenticateDevice(retriedGrant.deviceToken)?.userId)
      .toBe(state.ownerId);
  });

  it('task-ios-secure-bootstrap-c3: an authenticated but unenrolled machine cannot claim the active uplink', async () => {
    // Regression caught: any valid account bearer can supersede the enrolled Mac by choosing its own machine id.
    await fixture();
    const { RelayUplinkServer } = await import('../services/relay_uplink_server');
    const uplink = new RelayUplinkServer({
      bearerValidator: async () => ({ userId: 1 }),
      requireEnrollment: true,
    });
    const server = http.createServer();
    server.on('upgrade', (request, socket, head) => {
      if (!uplink.handleUpgrade(request, socket, head)) socket.destroy();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => {
      uplink.stop();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const { port } = server.address() as AddressInfo;
    const socket = new WebSocket(`ws://127.0.0.1:${port}/relay/uplink`, {
      headers: { Authorization: 'Bearer valid-owner-token' },
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    socket.send(JSON.stringify({ ch: 'ctrl', t: 'hello', userId: 1, machineId: 'attacker-host', health: {} }));
    const result = await Promise.race([
      new Promise<string>((resolve) => socket.once('close', () => resolve('closed'))),
      new Promise<string>((resolve) => setTimeout(() => resolve('open'), 150)),
    ]);
    if (result === 'open') socket.terminate();
    expect(result).toBe('closed');
    expect(uplink.isMacOnline()).toBe(false);
  });

  it('task-ios-secure-bootstrap-c4: cloud numeric ids never replace the verified Google binding', async () => {
    // Regression caught: cloud id=7 is treated as local owner 7 instead of subject-bound owner 42.
    const { MobileCloudIdentityService } = await import('../services/mobile_cloud_identity_service');
    const local = testUser(OWNER_ID, 'owner@example.com', 'google-owner');
    const cloud = testUser(7, 'owner@example.com', 'google-owner');
    const service = new MobileCloudIdentityService({
      localSessions: { getUserForSessionToken: vi.fn().mockResolvedValue(null) },
      localUsers: {
        findByGoogleSubAsync: vi.fn().mockResolvedValue(local),
        findByEmailAsync: vi.fn().mockResolvedValue(local),
      },
      fetchFn: vi.fn().mockResolvedValue(new Response(JSON.stringify({ user: cloud }), { status: 200 })),
    } as never);
    expect(await service.authenticateBearerToken('cloud-token')).toEqual(local);
    expect((await service.authenticateBearerToken('cloud-token'))?.id).not.toBe(cloud.id);
  });

  it('task-ios-secure-bootstrap-c5: Device REST remains compatible and revocation fails closed', async () => {
    // Regression caught: adding Bearer bootstrap broadens chat routes or ignores revoked device grants.
    const state = await fixture({ foreignDevice: true });
    const baseUrl = await startRelay(async () => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      bodyB64: Buffer.from(JSON.stringify({ ok: true })).toString('base64'),
    }));
    const route = `${baseUrl}/relay/mobile-gateway/opencode/config/providers`;
    expect((await fetch(route, { headers: { Authorization: `Bearer ${state.ownerToken}` } })).status).toBe(401);
    const active = await fetch(route, { headers: { Authorization: `Device ${state.ownerDeviceToken}` } });
    expect(active.status).toBe(200);
    state.db.prepare('UPDATE mobile_devices SET revoked_at = ? WHERE id = ?').run('2026-09-12T01:00:00.000Z', 'device-owner');
    expect((await fetch(route, { headers: { Authorization: `Device ${state.ownerDeviceToken}` } })).status).toBe(401);
  });

  it('task-ios-secure-bootstrap-c6: cached artifacts require matching owner, project, and session ownership', async () => {
    // Regression caught: possession of a foreign artifact id bypasses session/project/owner authorization while offline.
    const state = await fixture({ foreignDevice: true });
    const artifactId = 'artifact-owner-only';
    const artifactDir = join(state.storageRoot, 'relay-artifacts');
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, artifactId), 'owner bytes');
    writeFileSync(join(artifactDir, `${artifactId}.meta.json`), JSON.stringify({
      contentType: 'text/plain',
      ownerUserId: state.ownerId,
      projectId: PROJECT_ID,
      sessionId: 'session-owner',
    }));
    const baseUrl = await startRelay();
    const get = (deviceToken: string, projectId = PROJECT_ID) => fetch(
      `${baseUrl}/relay/mobile-gateway/artifacts/${artifactId}`,
      { headers: { Authorization: `Device ${deviceToken}`, 'X-Rhythm-Project-ID': projectId } },
    );
    expect((await get(state.ownerDeviceToken)).status).toBe(200);
    expect((await get(state.foreignDeviceToken)).status).toBe(404);
    expect((await get(state.ownerDeviceToken, 'foreign-project')).status).toBe(404);
  });

  it('task-ios-secure-bootstrap-c7: the synthetic matrix has distinct two-user enrollment state', async () => {
    // Regression caught: security fixtures accidentally use one principal and cannot prove cross-account denial.
    const state = await fixture({ foreignDevice: true });
    expect(state.ownerId).not.toBe(state.foreignId);
    const rows = state.db.prepare('SELECT user_id, host_id FROM mobile_devices ORDER BY user_id').all();
    expect(rows).toEqual([
      { user_id: state.ownerId, host_id: HOST_ID },
      { user_id: state.foreignId, host_id: 'host-foreign' },
    ]);
  });
});
