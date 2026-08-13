/**
 * Track 5 acceptance contract — relay-served mirror reads
 * (docs/ai/contracts/relay-t5-mirror-reads.md, plan S2.4).
 *
 * A relay whose replicated mirror is complete answers the three mirror-served
 * reads with the Mac ASLEEP. Ambiguity keeps the #1384 posture: tunnel to the
 * live engine when the Mac is reachable, honest 503 when it is not.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import express from 'express';
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

const PROJECT_ID = 'proj_relay_mirror';
const PROJECT_NAME = 'Relay mirror project';
const PROJECT_ROOT = '/Users/tester/Projects/mirror';

interface PairedFixture {
  deviceToken: string;
  userId: number;
  deviceRows: Record<string, unknown>[];
}

/** Stage A — real pairing on a role=all app; capture rows + token. */
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
    name: 'Mirror Relay Owner',
    email: `mr-${randomUUID()}@example.com`,
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
      deviceName: 'Mirror Relay iPhone',
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

interface RelayHarness {
  baseUrl: string;
  wsUrl: string;
  db: Database.Database;
  close: () => Promise<void>;
}

async function startRelay(fixture: PairedFixture): Promise<RelayHarness> {
  vi.resetModules();
  vi.stubEnv('RHYTHM_ROLE', 'relay');
  const { setDb } = await import('../database/db');
  const { runMigrations } = await import('../database/migrations');
  const db = new Database(':memory:');
  runMigrations(db);
  setDb(db);
  // Replica semantics (Track 4): replicated rows reference users/projects
  // that never exist on the relay; the applier runs with FKs off, so the
  // seeded state must too.
  db.pragma('foreign_keys = OFF');

  // Devices arrive via replication in production; seed directly here.
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
  app.use(express.json({ limit: '2mb' }));
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

/** Seed a complete, owned session + transcript into the relay mirror. */
async function seedMirror(
  ownerUserId: number,
  options: { completeInfo?: boolean } = {},
): Promise<{ sdkSessionId: string }> {
  const { AgentSessionsRepository } = await import(
    '../repositories/agent_sessions_repository'
  );
  const { AgentSessionMessagesRepository } = await import(
    '../repositories/agent_session_messages_repository'
  );
  const sessions = new AgentSessionsRepository();
  const local = sessions.insert({
    agentKind: 'claude-code',
    cwd: PROJECT_ROOT,
    name: 'Replicated chat',
    ownerUserId,
    projectId: PROJECT_ID,
    taskId: null,
    taskTitle: null,
  });
  const sdkSessionId = `ses_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  sessions.setSdkSessionId(local.id, sdkSessionId);

  const messages = new AgentSessionMessagesRepository();
  const sdkMessageId = 'msg_relay_mirror_1';
  messages.upsertPart(local.id, sdkMessageId, {
    id: 'prt_relay_mirror_1',
    type: 'text',
    text: 'served from the relay mirror with the mac asleep',
  });
  if (options.completeInfo !== false) {
    messages.upsertMessageInfo(
      local.id,
      sdkMessageId,
      'output',
      null,
      null,
      JSON.stringify({
        id: sdkMessageId,
        sessionID: sdkSessionId,
        role: 'assistant',
        modelID: 'claude-opus-5',
        providerID: 'anthropic',
        time: { created: 1_754_000_000_000, completed: 1_754_000_001_000 },
      }),
    );
  }
  return { sdkSessionId };
}

describe('Track 5 contract — relay-served mirror reads', () => {
  let fixture: PairedFixture;
  const cleanups: (() => Promise<void> | void)[] = [];

  beforeAll(async () => {
    fixture = await captureMacPairing();
  }, 30_000);

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  function get(relay: RelayHarness, path: string) {
    return fetch(`${relay.baseUrl}/relay/mobile-gateway/opencode${path}`, {
      headers: {
        Authorization: `Device ${fixture.deviceToken}`,
        'X-Rhythm-Project-ID': PROJECT_ID,
      },
    });
  }

  it('serves the transcript from the relay mirror with NO uplink at all', async () => {
    const relay = await startRelay(fixture);
    cleanups.push(() => relay.close());
    const { sdkSessionId } = await seedMirror(fixture.userId);

    const response = await get(
      relay,
      `/session/${encodeURIComponent(sdkSessionId)}/message`,
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('served from the relay mirror');
    expect(text).toContain(sdkSessionId);
  });

  it('serves the session list from the relay mirror offline', async () => {
    const relay = await startRelay(fixture);
    cleanups.push(() => relay.close());
    relay.db.prepare(
      `INSERT INTO projects
         (id, name, cwd, icon, vcs_root, vcs_branch, vcs_dirty,
          vcs_checked_at, created_at, archived_at)
       VALUES (?, ?, ?, NULL, NULL, NULL, 0, NULL, ?, NULL)`,
    ).run(PROJECT_ID, PROJECT_NAME, PROJECT_ROOT, new Date().toISOString());
    const { sdkSessionId } = await seedMirror(fixture.userId);

    const response = await get(relay, '/experimental/session');
    expect(response.status).toBe(200);
    const items = (await response.json()) as Array<Record<string, unknown>>;
    expect(items).toContainEqual(expect.objectContaining({
      id: sdkSessionId,
      projectId: PROJECT_ID,
      projectName: PROJECT_NAME,
    }));
    expect(JSON.stringify(items)).not.toContain(PROJECT_ROOT);
  });

  it('serves empty children authoritatively for an owned mirror session', async () => {
    const relay = await startRelay(fixture);
    cleanups.push(() => relay.close());
    const { sdkSessionId } = await seedMirror(fixture.userId);

    const response = await get(
      relay,
      `/session/${encodeURIComponent(sdkSessionId)}/children`,
    );
    expect(response.status).toBe(200);
  });

  it('503s mac_offline_and_mirror_incomplete when offline and the mirror cannot answer', async () => {
    const relay = await startRelay(fixture);
    cleanups.push(() => relay.close());
    const { sdkSessionId } = await seedMirror(fixture.userId, {
      completeInfo: false, // info_json missing → mirror-incomplete
    });

    const incomplete = await get(
      relay,
      `/session/${encodeURIComponent(sdkSessionId)}/message`,
    );
    expect(incomplete.status).toBe(503);
    expect(((await incomplete.json()) as { error: string }).error).toBe(
      'mac_offline_and_mirror_incomplete',
    );

    const unknown = await get(relay, '/session/ses_does_not_exist/message');
    expect(unknown.status).toBe(503);
  });

  it('tunnels a mirror-miss to the Mac when it is online', async () => {
    const relay = await startRelay(fixture);
    cleanups.push(() => relay.close());

    // Connect a fake Mac and finish the handshake so macOnline = true.
    const frames: UplinkFrame[] = [];
    const socket = new WebSocket(relay.wsUrl, {
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
    cleanups.push(() => socket.terminate());
    socket.send(
      serializeUplinkFrame({
        ch: 'ctrl',
        t: 'hello',
        userId: fixture.userId,
        machineId: 'm',
        health: { ok: 1 },
      }),
    );
    const waitFor = async <T extends UplinkFrame>(
      predicate: (frame: UplinkFrame) => frame is T,
    ): Promise<T> => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const match = frames.find(predicate);
        if (match) return match;
        await new Promise((r) => setTimeout(r, 15));
      }
      throw new Error(
        `frame not observed; saw ${frames.map((f) => `${f.ch}/${f.t}`).join(', ')}`,
      );
    };
    const resync = await waitFor(
      (f): f is CtrlResyncFrame => f.ch === 'ctrl' && f.t === 'resync',
    );
    socket.send(
      serializeUplinkFrame({
        ch: 'ctrl',
        t: 'resync-done',
        throughSeq: resync.sinceSeq,
      }),
    );

    const answering = (async () => {
      const req = await waitFor(
        (f): f is RpcReqFrame => f.ch === 'rpc' && f.t === 'req',
      );
      expect(req.path).toContain('/session/ses_not_mirrored/message');
      socket.send(
        serializeUplinkFrame({
          ch: 'rpc',
          t: 'res',
          id: req.id,
          status: 200,
          headers: { 'content-type': 'application/json' },
          bodyB64: Buffer.from(
            JSON.stringify([{ info: { id: 'msg_live' }, parts: [] }]),
          ).toString('base64'),
        }),
      );
    })();

    const response = await get(relay, '/session/ses_not_mirrored/message');
    await answering;
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('msg_live');
  });

  it('issue-1387-c7: tunnels owner catalog pages to the online Mac instead of a stale relay mirror', async () => {
    const relay = await startRelay(fixture);
    cleanups.push(() => relay.close());
    const { sdkSessionId: relayOnlySession } = await seedMirror(
      fixture.userId,
    );

    const frames: UplinkFrame[] = [];
    const socket = new WebSocket(relay.wsUrl, {
      headers: { Authorization: 'Bearer any' },
    });
    socket.on('message', (data) => {
      const frame = parseUplinkFrame(String(data));
      if (frame) frames.push(frame);
    });
    await new Promise<void>((resolve, reject) => {
      socket.on('open', () => resolve());
      socket.on('error', reject);
    });
    cleanups.push(() => socket.terminate());
    socket.send(
      serializeUplinkFrame({
        ch: 'ctrl',
        t: 'hello',
        userId: fixture.userId,
        machineId: 'm',
        health: { ok: 1 },
      }),
    );
    const waitFor = async <T extends UplinkFrame>(
      predicate: (frame: UplinkFrame) => frame is T,
    ): Promise<T> => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const match = frames.find(predicate);
        if (match) return match;
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      throw new Error(
        `frame not observed; saw ${frames.map((frame) => `${frame.ch}/${frame.t}`).join(', ')}`,
      );
    };
    const resync = await waitFor(
      (frame): frame is CtrlResyncFrame =>
        frame.ch === 'ctrl' && frame.t === 'resync',
    );
    socket.send(
      serializeUplinkFrame({
        ch: 'ctrl',
        t: 'resync-done',
        throughSeq: resync.sinceSeq,
      }),
    );

    const answering = (async () => {
      const request = await waitFor(
        (frame): frame is RpcReqFrame =>
          frame.ch === 'rpc' && frame.t === 'req',
      );
      expect(request.path).toContain('/experimental/session');
      socket.send(
        serializeUplinkFrame({
          ch: 'rpc',
          t: 'res',
          id: request.id,
          status: 200,
          headers: { 'content-type': 'application/json' },
          bodyB64: Buffer.from(
            JSON.stringify([
              {
                id: 'ses_mac_owner_catalog',
                projectId: PROJECT_ID,
                title: 'Mac catalog chat',
              },
            ]),
          ).toString('base64'),
        }),
      );
    })();

    const response = await fetch(
      `${relay.baseUrl}/relay/mobile-gateway/opencode/experimental/session?limit=10`,
      {
        headers: {
          Authorization: `Device ${fixture.deviceToken}`,
          'X-Rhythm-Project-ID': PROJECT_ID,
          'X-Rhythm-Session-Discovery': 'owner-unscoped',
        },
      },
    );
    await answering;
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('ses_mac_owner_catalog');
    expect(text).not.toContain(relayOnlySession);
  });

  it('requires device auth on mirror-served reads', async () => {
    const relay = await startRelay(fixture);
    cleanups.push(() => relay.close());
    await seedMirror(fixture.userId);
    const response = await fetch(
      `${relay.baseUrl}/relay/mobile-gateway/opencode/experimental/session`,
      { headers: { 'X-Rhythm-Project-ID': PROJECT_ID } },
    );
    expect(response.status).toBe(401);
  });
});
