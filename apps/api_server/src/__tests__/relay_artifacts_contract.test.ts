/**
 * Track 7 acceptance contract — artifact push-on-produce + relay serve
 * (docs/ai/contracts/relay-t7-artifacts.md, plan S3.1–S3.3).
 *
 * Artifacts are immutable blobs: the Mac pushes bytes once at generation,
 * the relay serves them locally with the Mac asleep, tunnels-and-caches on a
 * miss, and never lets an artifact id reach the filesystem unvalidated.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import express from 'express';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import WebSocket, { WebSocketServer, type WebSocket as WsSocket } from 'ws';

import {
  parseUplinkFrame,
  serializeUplinkFrame,
  type CtrlResyncFrame,
  type FileArtifactFrame,
  type RpcReqFrame,
  type UplinkFrame,
} from '../services/relay_uplink_protocol';

const PROJECT_ID = 'proj_artifacts';

// ── fixture: a real paired device (device rows + token) ─────────────────────

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
    name: 'Artifact Owner',
    email: `art-${randomUUID()}@example.com`,
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
      deviceName: 'Artifact iPhone',
    }),
  });
  expect(pairResponse.status).toBe(201);
  const deviceToken = ((await pairResponse.json()) as { deviceToken: string })
    .deviceToken;
  const deviceRows = db
    .prepare('SELECT * FROM mobile_devices')
    .all() as Record<string, unknown>[];
  await new Promise<void>((res, rej) =>
    server.close((e) => (e ? rej(e) : res())),
  );
  db.close();
  vi.unstubAllEnvs();
  return { deviceToken, userId: user.id, deviceRows };
}

// ── relay harness ────────────────────────────────────────────────────────────

interface RelayHarness {
  baseUrl: string;
  wsUrl: string;
  storageDir: string;
  close: () => Promise<void>;
}

async function startRelay(fixture: PairedFixture): Promise<RelayHarness> {
  vi.resetModules();
  vi.stubEnv('RHYTHM_ROLE', 'relay');
  const storageDir = mkdtempSync(join(tmpdir(), 'relay-artifacts-'));
  vi.stubEnv('LIVE_ARTIFACT_STORAGE_DIR', storageDir);

  const { setDb } = await import('../database/db');
  const { runMigrations } = await import('../database/migrations');
  const db = new Database(':memory:');
  runMigrations(db);
  setDb(db);
  db.pragma('foreign_keys = OFF');

  const { initializeMobilePairingSchema } = await import(
    '../repositories/mobile_devices_repository'
  );
  initializeMobilePairingSchema(db);
  const insert = db.prepare(
    `INSERT INTO mobile_devices (id, host_id, user_id, name, token_verifier, revoked_at, created_at)
     VALUES (@id, @host_id, @user_id, @name, @token_verifier, @revoked_at, @created_at)`,
  );
  for (const row of fixture.deviceRows) insert.run(row);

  const { RelayUplinkServer } = await import(
    '../services/relay_uplink_server'
  );
  const { createRelayGatewayRouter } = await import(
    '../routes/relay_gateway_routes'
  );
  const { errorHandler } = await import('../middleware/error_handler');
  const uplink = new RelayUplinkServer({
    bearerValidator: async () => ({ userId: fixture.userId }),
  });
  const app = express();
  app.use(express.json({ limit: '16mb' }));
  app.use('/relay', createRelayGatewayRouter({ uplink }));
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
    storageDir,
    close: async () => {
      uplink.stop();
      await new Promise<void>((res) => server.close(() => res()));
      db.close();
      rmSync(storageDir, { recursive: true, force: true });
      vi.unstubAllEnvs();
      vi.resetModules();
    },
  };
}

interface FakeMac {
  frames: UplinkFrame[];
  send(frame: UplinkFrame): void;
  waitFor<T extends UplinkFrame>(
    predicate: (frame: UplinkFrame) => frame is T,
    timeoutMs?: number,
  ): Promise<T>;
  close(): void;
}

async function connectFakeMac(wsUrl: string): Promise<FakeMac> {
  const frames: UplinkFrame[] = [];
  const socket = new WebSocket(wsUrl, {
    headers: { Authorization: 'Bearer any' },
  });
  socket.on('message', (data) => {
    const frame = parseUplinkFrame(String(data));
    if (frame) frames.push(frame);
  });
  await new Promise<void>((res, rej) => {
    socket.on('open', () => res());
    socket.on('error', rej);
  });
  const mac: FakeMac = {
    frames,
    send: (frame) => socket.send(serializeUplinkFrame(frame)),
    waitFor: async (predicate, timeoutMs = 5_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const match = frames.find(predicate);
        if (match) return match;
        await new Promise((r) => setTimeout(r, 15));
      }
      throw new Error(
        `frame not observed; saw ${frames.map((f) => `${f.ch}/${f.t}`).join(', ')}`,
      );
    },
    close: () => socket.terminate(),
  };
  mac.send({ ch: 'ctrl', t: 'hello', userId: 1, machineId: 'm', health: { ok: 1 } });
  const resync = await mac.waitFor(
    (f): f is CtrlResyncFrame => f.ch === 'ctrl' && f.t === 'resync',
  );
  mac.send({ ch: 'ctrl', t: 'resync-done', throughSeq: resync.sinceSeq });
  return mac;
}

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8,
]);

describe('Track 7 contract — artifacts + presence', () => {
  let fixture: PairedFixture;
  const cleanups: (() => Promise<void> | void)[] = [];

  beforeAll(async () => {
    fixture = await captureMacPairing();
  }, 30_000);

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  function getArtifact(relay: RelayHarness, id: string) {
    return fetch(
      `${relay.baseUrl}/relay/mobile-gateway/artifacts/${encodeURIComponent(id)}`,
      {
        headers: {
          Authorization: `Device ${fixture.deviceToken}`,
          'X-Rhythm-Project-ID': PROJECT_ID,
        },
      },
    );
  }

  it('a pushed artifact serves from the relay store with the Mac gone', async () => {
    const relay = await startRelay(fixture);
    cleanups.push(() => relay.close());
    const mac = await connectFakeMac(relay.wsUrl);
    mac.send({
      ch: 'file',
      t: 'artifact',
      artifactId: 'art_push_1',
      meta: { contentType: 'image/png', filename: 'render.png' },
      dataB64: PNG_BYTES.toString('base64'),
    });
    // Wait for the bytes to land, then kill the Mac.
    const deadline = Date.now() + 5_000;
    let partitionedBytes: Buffer | null = null;
    while (Date.now() < deadline) {
      try {
        partitionedBytes = readFileSync(join(relay.storageDir, 'relay-artifacts', 'art_push_1'));
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 25));
      }
    }
    expect(partitionedBytes).toEqual(PNG_BYTES);
    mac.close();

    const response = await getArtifact(relay, 'art_push_1');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/png');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG_BYTES);
  });

  it('continues serving relay artifacts written at the legacy storage root', async () => {
    const relay = await startRelay(fixture);
    cleanups.push(() => relay.close());
    writeFileSync(join(relay.storageDir, 'art_legacy_1'), PNG_BYTES);
    writeFileSync(
      join(relay.storageDir, 'art_legacy_1.meta.json'),
      JSON.stringify({ contentType: 'image/png' }),
    );

    const response = await getArtifact(relay, 'art_legacy_1');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/png');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG_BYTES);
  });

  it('tunnels a miss when the Mac is online and caches the bytes for offline reuse', async () => {
    const relay = await startRelay(fixture);
    cleanups.push(() => relay.close());
    const mac = await connectFakeMac(relay.wsUrl);

    const answering = (async () => {
      const req = await mac.waitFor(
        (f): f is RpcReqFrame => f.ch === 'rpc' && f.t === 'req',
      );
      expect(req.path).toContain('/mobile-gateway/artifacts/art_lazy_1');
      mac.send({
        ch: 'rpc',
        t: 'res',
        id: req.id,
        status: 200,
        headers: { 'content-type': 'image/png' },
        bodyB64: PNG_BYTES.toString('base64'),
      });
    })();

    const first = await getArtifact(relay, 'art_lazy_1');
    await answering;
    expect(first.status).toBe(200);
    expect(Buffer.from(await first.arrayBuffer())).toEqual(PNG_BYTES);

    // Cache must satisfy the next read with the Mac gone.
    mac.close();
    const deadline = Date.now() + 5_000;
    let second: Response | null = null;
    while (Date.now() < deadline) {
      second = await getArtifact(relay, 'art_lazy_1');
      if (second.status === 200) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(second!.status).toBe(200);
    expect(Buffer.from(await second!.arrayBuffer())).toEqual(PNG_BYTES);
    expect(second!.headers.get('content-type')).toContain('image/png');
  });

  it('404s mac_offline for unknown artifacts with no Mac, 400s invalid ids', async () => {
    const relay = await startRelay(fixture);
    cleanups.push(() => relay.close());

    const unknown = await getArtifact(relay, 'art_never_pushed');
    expect(unknown.status).toBe(404);

    const traversal = await getArtifact(relay, '..%2F..%2Fetc%2Fpasswd');
    expect(traversal.status).toBe(400);
  });

  it('metadata-only frames store the sidecar without bytes', async () => {
    const relay = await startRelay(fixture);
    cleanups.push(() => relay.close());
    const mac = await connectFakeMac(relay.wsUrl);
    mac.send({
      ch: 'file',
      t: 'artifact',
      artifactId: 'art_meta_only',
      meta: { contentType: 'video/mp4' },
      dataB64: null,
    });
    const deadline = Date.now() + 5_000;
    let metadataStored = false;
    while (Date.now() < deadline) {
      try {
        readFileSync(join(relay.storageDir, 'relay-artifacts', 'art_meta_only.meta.json'));
        metadataStored = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 25));
      }
    }
    expect(metadataStored).toBe(true);
    mac.close();
    // No bytes cached → offline read is an honest 404.
    const response = await getArtifact(relay, 'art_meta_only');
    expect(response.status).toBe(404);
  });

  it('health carries lastUplinkAt once an uplink has connected', async () => {
    const relay = await startRelay(fixture);
    cleanups.push(() => relay.close());

    const before = await fetch(`${relay.baseUrl}/relay/health`);
    const beforeBody = (await before.json()) as { lastUplinkAt?: string | null };
    expect(beforeBody.lastUplinkAt ?? null).toBeNull();

    const mac = await connectFakeMac(relay.wsUrl);
    cleanups.push(() => mac.close());
    const deadline = Date.now() + 5_000;
    let stamped: string | null = null;
    while (Date.now() < deadline && !stamped) {
      const res = await fetch(`${relay.baseUrl}/relay/mobile-gateway/health`);
      if (res.status === 200) {
        const body = (await res.json()) as { lastUplinkAt?: string };
        if (typeof body.lastUplinkAt === 'string') stamped = body.lastUplinkAt;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(stamped).not.toBeNull();
    expect(Number.isNaN(Date.parse(stamped!))).toBe(false);
  });
});

describe('Track 7 — Mac-side push', () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function clientWithFakeRelay() {
    vi.resetModules();
    vi.stubEnv('RHYTHM_ROLE', 'all');
    const { setDb } = await import('../database/db');
    const { runMigrations } = await import('../database/migrations');
    const db = new Database(':memory:');
    runMigrations(db);
    setDb(db);

    const frames: UplinkFrame[] = [];
    const server = http.createServer();
    const wss = new WebSocketServer({ server, path: '/relay/uplink' });
    const sockets: WsSocket[] = [];
    wss.on('connection', (socket) => {
      sockets.push(socket);
      socket.on('message', (data) => {
        const frame = parseUplinkFrame(String(data));
        if (frame) frames.push(frame);
      });
    });
    server.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server.once('listening', () => r()));
    const { port } = server.address() as AddressInfo;
    cleanups.push(
      () =>
        new Promise<void>((res) => {
          for (const socket of sockets) socket.terminate();
          wss.close(() => server.close(() => res()));
        }),
    );

    const { RelayUplinkClient } = await import(
      '../services/relay_uplink_client'
    );
    const { OpencodeEventHub } = await import(
      '../services/opencode_event_hub'
    );
    const client = new RelayUplinkClient({
      urls: [`ws://127.0.0.1:${port}/relay/uplink`],
      bearer: 'b',
      userId: 1,
      machineId: 'm',
      hub: new OpencodeEventHub(),
      healthProvider: async () => ({ ok: true }),
      devicesProvider: async () => ({ devices: [] }),
      dispatchBaseUrl: 'http://127.0.0.1:9',
      reconnectBaseMs: 10,
      reconnectMaxMs: 50,
    });
    cleanups.push(() => client.stop());
    client.start();
    const waitFor = async <T extends UplinkFrame>(
      predicate: (frame: UplinkFrame) => frame is T,
      timeoutMs = 5_000,
    ): Promise<T> => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const match = frames.find(predicate);
        if (match) return match;
        await new Promise((r) => setTimeout(r, 15));
      }
      throw new Error(
        `frame not observed; saw ${frames.map((f) => `${f.ch}/${f.t}`).join(', ')}`,
      );
    };
    await waitFor(
      (f): f is UplinkFrame => f.ch === 'ctrl' && f.t === 'hello',
    );
    return { client, waitFor };
  }

  const isArtifact = (f: UplinkFrame): f is FileArtifactFrame =>
    f.ch === 'file' && f.t === 'artifact';

  it('pushArtifact sends bytes for small files', async () => {
    const { client, waitFor } = await clientWithFakeRelay();
    const dir = mkdtempSync(join(tmpdir(), 'push-artifact-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const filePath = join(dir, 'small.png');
    writeFileSync(filePath, PNG_BYTES);

    await client.pushArtifact({
      artifactId: 'art_small',
      meta: { contentType: 'image/png' },
      filePath,
    });
    const frame = await waitFor(isArtifact);
    expect(frame.artifactId).toBe('art_small');
    expect(frame.dataB64).toBe(PNG_BYTES.toString('base64'));
    expect(frame.meta).toEqual({ contentType: 'image/png' });
  });

  it('pushArtifact sends metadata-only above the 8MB encoded cap', async () => {
    const { client, waitFor } = await clientWithFakeRelay();
    const dir = mkdtempSync(join(tmpdir(), 'push-artifact-big-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const filePath = join(dir, 'big.bin');
    writeFileSync(filePath, Buffer.alloc(9 * 1024 * 1024, 7)); // 9MB raw > 8MB b64 cap

    await client.pushArtifact({
      artifactId: 'art_big',
      meta: { contentType: 'application/octet-stream' },
      filePath,
    });
    const frame = await waitFor(isArtifact);
    expect(frame.artifactId).toBe('art_big');
    expect(frame.dataB64).toBeNull();
  });

  it('pushArtifact never throws for an unreadable file', async () => {
    const { client } = await clientWithFakeRelay();
    await expect(
      client.pushArtifact({
        artifactId: 'art_gone',
        meta: {},
        filePath: '/nonexistent/path.bin',
      }),
    ).resolves.toBeUndefined();
  });
});

describe('Track 7 — bridge source contract', () => {
  it('pushes artifacts from the generated-media registration handler', () => {
    const source = readFileSync(
      join(__dirname, '../services/opencode_stream_bridge.ts'),
      'utf8',
    );
    const registrationIndex = source.indexOf('registerGeneratedMediaPart(');
    const pushIndex = source.indexOf('pushArtifact');
    expect(registrationIndex).toBeGreaterThan(-1);
    expect(pushIndex).toBeGreaterThan(registrationIndex);
  });
});
