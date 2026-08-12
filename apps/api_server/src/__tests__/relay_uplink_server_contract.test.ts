/**
 * Track 2 acceptance contract — RelayUplinkServer + relay phone surface
 * (docs/ai/contracts/relay-t2-relay-server.md, plan §2 + S1.4, S1.6–S1.9, S1.11).
 *
 * Stage A pairs a device against a REAL role=all app (the Mac) and captures
 * the resulting mobile_devices rows + device token. Stage B boots a REAL
 * role=relay app on a fresh DB, connects a fake Mac over the uplink WebSocket,
 * replays the captured rows as a repl/devices snapshot, and drives the phone
 * surface over real HTTP. Implementation must make every test pass without
 * modifying this file.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';

import {
  parseUplinkFrame,
  serializeUplinkFrame,
  type CtrlResyncFrame,
  type RpcReqFrame,
  type UplinkFrame,
} from '../services/relay_uplink_protocol';

const HEALTH = {
  status: 'ok',
  gatewayVersion: '1',
  opencodeVersion: '1.14.49',
  contractFingerprint: 'f960fbd0deadbeef',
  features: ['pairing', 'device-revocation', 'project-scope', 'opencode-http-proxy'],
};

const PROJECT_ROOT = '/Users/tester/Projects/demo';
const PROJECT_ID = 'proj_demo';

// ── Stage A: pair a device on a role=all app, capture rows + token ──────────

interface PairedFixture {
  deviceToken: string;
  userId: number;
  deviceRows: Record<string, unknown>[];
}

async function captureMacPairing(): Promise<PairedFixture> {
  vi.resetModules();
  vi.stubEnv('RHYTHM_ROLE', 'all');
  vi.stubEnv('AGENT_LOCAL', 'true');

  const { setDb } = await import('../database/db');
  const { runMigrations } = await import('../database/migrations');
  const db = new Database(':memory:');
  runMigrations(db);
  setDb(db);
  const { installHumanApprovalTestCredentials } = await import(
    './helpers/human_approval_test_credentials'
  );
  const humanCapabilityHeader =
    installHumanApprovalTestCredentials().capabilityHeader;

  const { UsersRepository } = await import('../repositories/users_repository');
  const { SessionsRepository } = await import(
    '../repositories/sessions_repository'
  );
  const user = new UsersRepository().create({
    name: 'Relay Owner',
    email: `relay-${randomUUID()}@example.com`,
  });
  const session = new SessionsRepository().create(user.id);

  const { createApp } = await import('../app');
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  const codeResponse = await fetch(`${baseUrl}/mobile-gateway/pairing-codes`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'application/json',
      ...humanCapabilityHeader,
    },
    body: '{}',
  });
  expect(codeResponse.status).toBe(201);
  const code = (await codeResponse.json()) as {
    pairingCode: string;
    hostId: string;
  };
  const pairResponse = await fetch(`${baseUrl}/mobile-gateway/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pairingCode: code.pairingCode,
      hostId: code.hostId,
      deviceName: 'Relay iPhone',
    }),
  });
  expect(pairResponse.status).toBe(201);
  const deviceToken = ((await pairResponse.json()) as { deviceToken: string })
    .deviceToken;

  const deviceRows = db
    .prepare('SELECT * FROM mobile_devices')
    .all() as Record<string, unknown>[];
  expect(deviceRows.length).toBe(1);

  await new Promise<void>((res, rej) =>
    server.close((e) => (e ? rej(e) : res())),
  );
  db.close();
  vi.unstubAllEnvs();
  return { deviceToken, userId: user.id, deviceRows };
}

// ── Stage B: the relay under test ────────────────────────────────────────────

/** Same shape the #1379 fanout tests use for scoping stubs. */
function ownership(
  map: Record<string, { userId: number; directory: string }>,
) {
  const lookup = (
    sessionId: string,
    ownerUserId: number,
    projectId: string,
  ) => {
    const entry = map[sessionId];
    if (!entry) return null;
    if (entry.userId !== ownerUserId) return null;
    if (projectId !== PROJECT_ID) return null;
    return entry;
  };
  return {
    isResourceOwnedBy: (
      kind: string,
      resourceId: string,
      ownerUserId: number,
      projectId: string,
    ) => kind === 'session' && lookup(resourceId, ownerUserId, projectId) !== null,
    isResourceExplicitlyOwnedBy: (
      kind: string,
      resourceId: string,
      ownerUserId: number,
      projectId: string,
    ) => kind === 'session' && lookup(resourceId, ownerUserId, projectId) !== null,
    resolveSessionDirectoryForOwner: (
      sessionId: string,
      ownerUserId: number,
      projectId: string,
    ) => lookup(sessionId, ownerUserId, projectId)?.directory ?? null,
  } as never;
}

interface RelayHarness {
  baseUrl: string;
  wsUrl: string;
  db: Database.Database;
  close: () => Promise<void>;
}

async function startRelay(
  options: {
    validBearer?: string;
    ownershipMap?: Record<string, { userId: number; directory: string }>;
  } = {},
): Promise<RelayHarness> {
  vi.resetModules();
  vi.stubEnv('RHYTHM_ROLE', 'relay');

  const { setDb } = await import('../database/db');
  const { runMigrations } = await import('../database/migrations');
  const db = new Database(':memory:');
  runMigrations(db);
  setDb(db);

  const { RelayUplinkServer } = await import(
    '../services/relay_uplink_server'
  );
  const { createRelayGatewayRouter } = await import(
    '../routes/relay_gateway_routes'
  );
  const { errorHandler } = await import('../middleware/error_handler');
  const express = (await import('express')).default;

  const validBearer = options.validBearer ?? 'mac-bearer';
  const uplink = new RelayUplinkServer({
    bearerValidator: async (token: string) =>
      token === validBearer ? { userId: 999 } : null,
  });

  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(
    '/relay',
    createRelayGatewayRouter({
      uplink,
      ...(options.ownershipMap
        ? { ownershipRepository: ownership(options.ownershipMap) }
        : {}),
    }),
  );
  app.use(errorHandler);

  const server = http.createServer(app);
  server.on('upgrade', (request, socket, head) => {
    if (!uplink.handleUpgrade(request, socket, head)) socket.destroy();
  });
  server.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', () => r()));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/relay/uplink`,
    db,
    close: async () => {
      uplink.stop();
      await new Promise<void>((res) => server.close(() => res()));
      db.close();
      vi.unstubAllEnvs();
      vi.resetModules();
    },
  };
}

interface FakeMac {
  frames: UplinkFrame[];
  socket: WebSocket;
  closed: Promise<void>;
  send(frame: UplinkFrame): void;
  sendRaw(raw: string): void;
  waitFor<T extends UplinkFrame>(
    predicate: (frame: UplinkFrame) => frame is T,
    timeoutMs?: number,
  ): Promise<T>;
  helloAndSync(health?: unknown): Promise<void>;
  close(): void;
}

function connectFakeMac(
  wsUrl: string,
  bearer: string,
): Promise<FakeMac> {
  return new Promise((resolve, reject) => {
    const frames: UplinkFrame[] = [];
    const socket = new WebSocket(wsUrl, {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    let closeResolve: () => void;
    const closed = new Promise<void>((r) => (closeResolve = r));
    socket.on('close', () => closeResolve());
    socket.on('message', (data) => {
      const frame = parseUplinkFrame(String(data));
      if (frame) frames.push(frame);
    });
    socket.on('unexpected-response', (_req, res) =>
      reject(new Error(`upgrade rejected: ${res.statusCode}`)),
    );
    socket.on('error', (err) => reject(err));
    socket.on('open', () => {
      const mac: FakeMac = {
        frames,
        socket,
        closed,
        send: (frame) => socket.send(serializeUplinkFrame(frame)),
        sendRaw: (raw) => socket.send(raw),
        waitFor: async (predicate, timeoutMs = 5_000) => {
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            const match = frames.find(predicate);
            if (match) return match;
            await new Promise((r) => setTimeout(r, 15));
          }
          throw new Error(
            `frame not observed; saw ${frames
              .map((f) => `${f.ch}/${f.t}`)
              .join(', ')}`,
          );
        },
        helloAndSync: async (health = HEALTH) => {
          mac.send({
            ch: 'ctrl',
            t: 'hello',
            userId: 999,
            machineId: 'mac-1',
            health,
          });
          const resync = await mac.waitFor(
            (f): f is CtrlResyncFrame => f.ch === 'ctrl' && f.t === 'resync',
          );
          mac.send({
            ch: 'ctrl',
            t: 'resync-done',
            throughSeq: resync.sinceSeq,
          });
        },
        close: () => socket.terminate(),
      };
      resolve(mac);
    });
  });
}

/** Collect SSE frames from a relay events stream until predicate or timeout. */
async function readSse(
  url: string,
  headers: Record<string, string>,
  isDone: (collected: string) => boolean,
  timeoutMs = 5_000,
): Promise<string> {
  const controller = new AbortController();
  const response = await fetch(url, {
    headers,
    signal: controller.signal,
  });
  if (!response.ok || !response.body) {
    controller.abort();
    throw new Error(`SSE connect failed: ${response.status}`);
  }
  let collected = '';
  const reader = response.body.getReader();
  const deadline = Date.now() + timeoutMs;
  const decoder = new TextDecoder();
  // Hold ONE pending read across poll ticks — racing a fresh reader.read()
  // per iteration would abandon promises that still consume (and drop) chunks.
  let pending: ReturnType<typeof reader.read> | null = null;
  while (Date.now() < deadline && !isDone(collected)) {
    pending ??= reader.read();
    const race = await Promise.race([
      pending,
      new Promise<'tick'>((r) => setTimeout(() => r('tick'), 50)),
    ]);
    if (race === 'tick') continue;
    pending = null;
    if (race.done) break;
    collected += decoder.decode(race.value, { stream: true });
  }
  controller.abort();
  return collected;
}

function sseDataPayloads(collected: string): Record<string, unknown>[] {
  return collected
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => {
      try {
        return JSON.parse(line.slice('data: '.length)) as Record<
          string,
          unknown
        >;
      } catch {
        return {};
      }
    })
    .filter((value) => Object.keys(value).length > 0);
}

function sessionEvent(
  directory: string,
  sessionId: string,
  id: string,
): { directory: string; payload: unknown } {
  return {
    directory,
    payload: {
      id,
      type: 'message.part.updated',
      properties: {
        part: {
          id: `prt_${id}`,
          messageID: `msg_${id}`,
          sessionID: sessionId,
          type: 'text',
          text: 'hello from the mac',
        },
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Track 2 contract — RelayUplinkServer + relay phone surface', () => {
  let fixture: PairedFixture;
  const cleanups: (() => Promise<void> | void)[] = [];

  beforeAll(async () => {
    fixture = await captureMacPairing();
  }, 30_000);

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function relayWithDevices(
    ownershipMap?: Record<string, { userId: number; directory: string }>,
  ): Promise<{ relay: RelayHarness; mac: FakeMac }> {
    const relay = await startRelay({ ownershipMap });
    cleanups.push(() => relay.close());
    const mac = await connectFakeMac(relay.wsUrl, 'mac-bearer');
    cleanups.push(() => mac.close());
    await mac.helloAndSync();
    mac.send({ ch: 'repl', t: 'devices', devices: fixture.deviceRows });
    // Wait until the replicated device authenticates.
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const probe = await fetch(
        `${relay.baseUrl}/relay/mobile-gateway/pty/x/connect`,
        { headers: { Authorization: `Device ${fixture.deviceToken}` } },
      );
      if (probe.status === 501) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    return { relay, mac };
  }

  it('rejects an uplink upgrade with a bad bearer', async () => {
    const relay = await startRelay();
    cleanups.push(() => relay.close());
    await expect(connectFakeMac(relay.wsUrl, 'wrong')).rejects.toThrow(
      /upgrade rejected: 401|socket hang up|ECONNRESET/,
    );
  });

  it('serves health verbatim with macOnline lifecycle (503 before any uplink)', async () => {
    const relay = await startRelay();
    cleanups.push(() => relay.close());

    const before = await fetch(`${relay.baseUrl}/relay/mobile-gateway/health`);
    expect(before.status).toBe(503);
    expect(((await before.json()) as { error: string }).error).toBe(
      'no_uplink',
    );

    const mac = await connectFakeMac(relay.wsUrl, 'mac-bearer');
    cleanups.push(() => mac.close());
    mac.send({
      ch: 'ctrl',
      t: 'hello',
      userId: 999,
      machineId: 'mac-1',
      health: HEALTH,
    });
    const resync = await mac.waitFor(
      (f): f is CtrlResyncFrame => f.ch === 'ctrl' && f.t === 'resync',
    );
    expect(resync.sinceSeq).toBe(0);

    // hello received but resync not finished: health cached, mac not online.
    const deadline = Date.now() + 5_000;
    let during: Record<string, unknown> | null = null;
    while (Date.now() < deadline) {
      const res = await fetch(`${relay.baseUrl}/relay/mobile-gateway/health`);
      if (res.status === 200) {
        during = (await res.json()) as Record<string, unknown>;
        break;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(during).not.toBeNull();
    expect(during!.macOnline).toBe(false);
    // Verbatim passthrough of every fingerprint-gated field.
    expect(during!.gatewayVersion).toBe(HEALTH.gatewayVersion);
    expect(during!.opencodeVersion).toBe(HEALTH.opencodeVersion);
    expect(during!.contractFingerprint).toBe(HEALTH.contractFingerprint);
    expect(during!.features).toEqual(HEALTH.features);

    mac.send({ ch: 'ctrl', t: 'resync-done', throughSeq: 0 });
    let after: Record<string, unknown> | null = null;
    const deadline2 = Date.now() + 5_000;
    while (Date.now() < deadline2) {
      const res = await fetch(`${relay.baseUrl}/relay/mobile-gateway/health`);
      const body = (await res.json()) as Record<string, unknown>;
      if (body.macOnline === true) {
        after = body;
        break;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(after).not.toBeNull();

    // Disconnect: health stays cached, macOnline flips false.
    mac.close();
    let offline: Record<string, unknown> | null = null;
    const deadline3 = Date.now() + 5_000;
    while (Date.now() < deadline3) {
      const res = await fetch(`${relay.baseUrl}/relay/mobile-gateway/health`);
      const body = (await res.json()) as Record<string, unknown>;
      if (res.status === 200 && body.macOnline === false) {
        offline = body;
        break;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(offline).not.toBeNull();
    expect(offline!.contractFingerprint).toBe(HEALTH.contractFingerprint);
  });

  it('replicated devices snapshot authenticates Device tokens; unknown tokens 401', async () => {
    const { relay } = await relayWithDevices();
    const ok = await fetch(
      `${relay.baseUrl}/relay/mobile-gateway/pty/x/connect`,
      { headers: { Authorization: `Device ${fixture.deviceToken}` } },
    );
    expect(ok.status).toBe(501); // authenticated, then PTY is 501 by contract

    const bad = await fetch(
      `${relay.baseUrl}/relay/mobile-gateway/pty/x/connect`,
      { headers: { Authorization: 'Device not-a-real-token' } },
    );
    expect(bad.status).toBe(401);

    const missing = await fetch(
      `${relay.baseUrl}/relay/mobile-gateway/projects`,
    );
    expect(missing.status).toBe(401);
  });

  it('snapshots are replace-all: a revoked device stops authenticating', async () => {
    const { relay, mac } = await relayWithDevices();
    const revokedRows = fixture.deviceRows.map((row) => ({
      ...row,
      revoked_at: new Date().toISOString(),
    }));
    mac.send({ ch: 'repl', t: 'devices', devices: revokedRows });
    const deadline = Date.now() + 5_000;
    let status = 0;
    while (Date.now() < deadline) {
      const res = await fetch(
        `${relay.baseUrl}/relay/mobile-gateway/pty/x/connect`,
        { headers: { Authorization: `Device ${fixture.deviceToken}` } },
      );
      status = res.status;
      if (status === 401) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(status).toBe(401);
  });

  it('tunnels catch-all requests over rpc with query string, surfacing the response', async () => {
    const { relay, mac } = await relayWithDevices();

    const answering = (async () => {
      const req = await mac.waitFor(
        (f): f is RpcReqFrame => f.ch === 'rpc' && f.t === 'req',
      );
      expect(req.method).toBe('POST');
      expect(req.path).toBe(
        '/mobile-gateway/opencode/session/ses_1/prompt_async?directory=%2Ftmp',
      );
      expect(req.headers['authorization']).toBe(
        `Device ${fixture.deviceToken}`,
      );
      expect(req.headers['x-rhythm-project-id']).toBe(PROJECT_ID);
      expect(
        JSON.parse(Buffer.from(req.bodyB64, 'base64').toString('utf8')),
      ).toEqual({ parts: [{ type: 'text', text: 'hi' }] });
      mac.send({
        ch: 'rpc',
        t: 'res',
        id: req.id,
        status: 202,
        headers: { 'content-type': 'application/json', 'x-relay-echo': '1' },
        bodyB64: Buffer.from(JSON.stringify({ accepted: true })).toString(
          'base64',
        ),
      });
    })();

    const response = await fetch(
      `${relay.baseUrl}/relay/mobile-gateway/opencode/session/ses_1/prompt_async?directory=%2Ftmp`,
      {
        method: 'POST',
        headers: {
          Authorization: `Device ${fixture.deviceToken}`,
          'X-Rhythm-Project-ID': PROJECT_ID,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ parts: [{ type: 'text', text: 'hi' }] }),
      },
    );
    await answering;
    expect(response.status).toBe(202);
    expect(response.headers.get('x-relay-echo')).toBe('1');
    expect(await response.json()).toEqual({ accepted: true });
  });

  it('POST /mobile-gateway/pair tunnels WITHOUT device auth (pairing bootstrap)', async () => {
    const { relay, mac } = await relayWithDevices();
    const answering = (async () => {
      const req = await mac.waitFor(
        (f): f is RpcReqFrame =>
          f.ch === 'rpc' && f.t === 'req' && f.path === '/mobile-gateway/pair',
      );
      mac.send({
        ch: 'rpc',
        t: 'res',
        id: req.id,
        status: 201,
        headers: { 'content-type': 'application/json' },
        bodyB64: Buffer.from(
          JSON.stringify({ deviceToken: 'fresh-token' }),
        ).toString('base64'),
      });
    })();
    const response = await fetch(`${relay.baseUrl}/relay/mobile-gateway/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingCode: 'abc', hostId: 'h', deviceName: 'p' }),
    });
    await answering;
    expect(response.status).toBe(201);
  });

  it('returns 503 mac_offline on tunneled paths when no Mac is connected', async () => {
    const relay = await startRelay();
    cleanups.push(() => relay.close());
    // Seed devices directly so auth passes without an uplink.
    const { initializeMobilePairingSchema } = await import(
      '../repositories/mobile_devices_repository'
    );
    initializeMobilePairingSchema(relay.db);
    const insert = relay.db.prepare(
      `INSERT INTO mobile_devices (id, host_id, user_id, name, token_verifier, revoked_at, created_at)
       VALUES (@id, @host_id, @user_id, @name, @token_verifier, @revoked_at, @created_at)`,
    );
    for (const row of fixture.deviceRows) insert.run(row);

    const response = await fetch(
      `${relay.baseUrl}/relay/mobile-gateway/projects`,
      { headers: { Authorization: `Device ${fixture.deviceToken}` } },
    );
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: string }).error).toBe(
      'mac_offline',
    );
  });

  it('serves scoped SSE from the relay hub and drops foreign sessions', async () => {
    const { relay, mac } = await relayWithDevices({
      ses_mine: { userId: fixture.userId, directory: PROJECT_ROOT },
    });

    const streaming = readSse(
      `${relay.baseUrl}/relay/mobile-gateway/events`,
      {
        Authorization: `Device ${fixture.deviceToken}`,
        'X-Rhythm-Project-ID': PROJECT_ID,
      },
      (collected) => collected.includes('prt_evt_mine'),
    );
    await new Promise((r) => setTimeout(r, 300)); // let the stream subscribe

    mac.send({
      ch: 'events',
      t: 'env',
      envelope: sessionEvent(PROJECT_ROOT, 'ses_other', 'evt_foreign'),
    });
    mac.send({
      ch: 'events',
      t: 'env',
      envelope: sessionEvent(PROJECT_ROOT, 'ses_mine', 'evt_mine'),
    });

    const collected = await streaming;
    const delivered = sseDataPayloads(collected);
    const types = delivered
      .map((envelope) => (envelope.payload as { properties?: { part?: { id?: string } } })
        ?.properties?.part?.id)
      .filter(Boolean);
    expect(types).toContain('prt_evt_mine');
    expect(types).not.toContain('prt_evt_foreign');
  });

  it('SSE responds 503 mac_offline when the hub is not live', async () => {
    const relay = await startRelay();
    cleanups.push(() => relay.close());
    const { initializeMobilePairingSchema } = await import(
      '../repositories/mobile_devices_repository'
    );
    initializeMobilePairingSchema(relay.db);
    const insert = relay.db.prepare(
      `INSERT INTO mobile_devices (id, host_id, user_id, name, token_verifier, revoked_at, created_at)
       VALUES (@id, @host_id, @user_id, @name, @token_verifier, @revoked_at, @created_at)`,
    );
    for (const row of fixture.deviceRows) insert.run(row);

    const response = await fetch(
      `${relay.baseUrl}/relay/mobile-gateway/events`,
      {
        headers: {
          Authorization: `Device ${fixture.deviceToken}`,
          'X-Rhythm-Project-ID': PROJECT_ID,
        },
      },
    );
    expect(response.status).toBe(503);
  });

  it('a second uplink supersedes the first', async () => {
    const relay = await startRelay();
    cleanups.push(() => relay.close());
    const first = await connectFakeMac(relay.wsUrl, 'mac-bearer');
    cleanups.push(() => first.close());
    await first.helloAndSync();

    const second = await connectFakeMac(relay.wsUrl, 'mac-bearer');
    cleanups.push(() => second.close());
    await second.helloAndSync();

    await Promise.race([
      first.closed,
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error('first uplink was not superseded')), 5_000),
      ),
    ]);
  });

  it('survives a malformed frame and keeps serving', async () => {
    const { relay, mac } = await relayWithDevices({
      ses_mine: { userId: fixture.userId, directory: PROJECT_ROOT },
    });
    mac.sendRaw('this is not json {');
    mac.sendRaw(JSON.stringify({ ch: 'nope', t: 'x' }));

    const health = await fetch(
      `${relay.baseUrl}/relay/mobile-gateway/health`,
    );
    expect(health.status).toBe(200);
    expect(((await health.json()) as { macOnline: boolean }).macOnline).toBe(
      true,
    );
  });
});
