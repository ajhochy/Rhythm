/**
 * C3 correction E2: canonical change hint over the EXISTING authenticated
 * uplink -> relay hub -> relay-only mobile qualifier, with no relay projects
 * row. Real role=all app pairs a device (Stage A); a real role=relay app, real
 * uplink WebSocket (fake Mac) and real HTTP SSE are Stage B. The origin
 * (host + authenticated user + connection generation) always comes from the
 * production authenticated connection, never from a payload or an injected
 * presumption. Mixed/foreign origins are made from REAL captured origin
 * objects of earlier/later connections, with only the weak online predicate
 * forced true.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';

import { COORDINATOR_CONVERSATION_SCHEMA_VERSION } from '../contracts/coordinator_conversation_contract';
import { runMigrations } from '../database/migrations';
import {
  parseUplinkFrame,
  serializeUplinkFrame,
  type CtrlResyncFrame,
  type UplinkFrame,
} from '../services/relay_uplink_protocol';

const HEALTH = {
  status: 'ok', gatewayVersion: '1', opencodeVersion: '1.14.49',
  contractFingerprint: 'f960fbd0deadbeef',
  features: ['pairing', 'device-revocation', 'project-scope', 'opencode-http-proxy'],
};
const MAC_DIRECTORY = '/Users/tester/Projects/demo';
const PROJECT_ID = 'proj_demo';
const ROOT_ID = 'root-local-1';
const CONVERSATION_ID = 'conversation-1';
const PRIVATE_TEXT = 'private transcript body that must never cross the relay hint';

interface PairedFixture { deviceToken: string; userId: number; deviceRows: Record<string, unknown>[]; }

async function captureMacPairing(): Promise<PairedFixture> {
  vi.resetModules();
  vi.stubEnv('RHYTHM_ROLE', 'all');
  vi.stubEnv('AGENT_LOCAL', 'true');
  const { setDb } = await import('../database/db');
  const { runMigrations: migrate } = await import('../database/migrations');
  const db = new Database(':memory:');
  migrate(db);
  setDb(db);
  const { installHumanApprovalTestCredentials } = await import('./helpers/human_approval_test_credentials');
  const humanCapabilityHeader = installHumanApprovalTestCredentials().capabilityHeader;
  const { UsersRepository } = await import('../repositories/users_repository');
  const { SessionsRepository } = await import('../repositories/sessions_repository');
  const user = new UsersRepository().create({ name: 'Relay Owner', email: `relay-${randomUUID()}@example.com` });
  const session = new SessionsRepository().create(user.id);
  const { createApp } = await import('../app');
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', () => r()));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const codeResponse = await fetch(`${baseUrl}/mobile-gateway/pairing-codes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json', ...humanCapabilityHeader },
    body: '{}',
  });
  expect(codeResponse.status).toBe(201);
  const code = (await codeResponse.json()) as { pairingCode: string; hostId: string };
  const pairResponse = await fetch(`${baseUrl}/mobile-gateway/pair`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairingCode: code.pairingCode, hostId: code.hostId, deviceName: 'Relay iPhone' }),
  });
  expect(pairResponse.status).toBe(201);
  const deviceToken = ((await pairResponse.json()) as { deviceToken: string }).deviceToken;
  const deviceRows = db.prepare('SELECT * FROM mobile_devices').all() as Record<string, unknown>[];
  await new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res())));
  db.close();
  vi.unstubAllEnvs();
  return { deviceToken, userId: user.id, deviceRows };
}

interface FakeMac {
  frames: UplinkFrame[]; socket: WebSocket; closed: Promise<void>;
  send(frame: UplinkFrame): void;
  waitFor<T extends UplinkFrame>(predicate: (f: UplinkFrame) => f is T, timeoutMs?: number): Promise<T>;
  helloAndSync(hostId: string, userId: number): Promise<void>;
  close(): void;
}

function connectFakeMac(wsUrl: string, bearer: string): Promise<FakeMac> {
  return new Promise((resolve, reject) => {
    const frames: UplinkFrame[] = [];
    const socket = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${bearer}` } });
    let closeResolve!: () => void;
    const closed = new Promise<void>((r) => (closeResolve = r));
    socket.on('close', () => closeResolve());
    socket.on('message', (data) => { const f = parseUplinkFrame(String(data)); if (f) frames.push(f); });
    socket.on('unexpected-response', (_req, res) => reject(new Error(`upgrade rejected: ${res.statusCode}`)));
    socket.on('error', (err) => reject(err));
    socket.on('open', () => {
      const mac: FakeMac = {
        frames, socket, closed,
        send: (frame) => socket.send(serializeUplinkFrame(frame)),
        waitFor: async (predicate, timeoutMs = 5_000) => {
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            const match = frames.find(predicate);
            if (match) return match;
            await new Promise((r) => setTimeout(r, 15));
          }
          throw new Error('frame not observed');
        },
        helloAndSync: async (hostId, userId) => {
          mac.send({ ch: 'ctrl', t: 'hello', userId, machineId: hostId, health: HEALTH });
          const resync = await mac.waitFor((f): f is CtrlResyncFrame => f.ch === 'ctrl' && f.t === 'resync');
          mac.send({ ch: 'ctrl', t: 'resync-done', throughSeq: resync.sinceSeq });
        },
        close: () => socket.terminate(),
      };
      resolve(mac);
    });
  });
}

async function readSse(url: string, headers: Record<string, string>, ms: number): Promise<string> {
  const controller = new AbortController();
  const response = await fetch(url, { headers, signal: controller.signal });
  if (!response.ok || !response.body) { controller.abort(); throw new Error(`SSE connect failed: ${response.status}`); }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let collected = '';
  const deadline = Date.now() + ms;
  let pending: ReturnType<typeof reader.read> | null = null;
  while (Date.now() < deadline) {
    pending ??= reader.read();
    const race = await Promise.race([pending, new Promise<'tick'>((r) => setTimeout(() => r('tick'), 50))]);
    if (race === 'tick') continue;
    pending = null;
    if (race.done) break;
    collected += decoder.decode(race.value, { stream: true });
  }
  controller.abort();
  return collected;
}

function payloadsOf(collected: string): Array<Record<string, any>> {
  return collected.split('\n').filter((l) => l.startsWith('data: ')).flatMap((l) => {
    try { return [JSON.parse(l.slice(6)) as Record<string, any>]; } catch { return []; }
  });
}
const hintFrames = (collected: string) =>
  payloadsOf(collected).filter((p) => p.payload?.type === 'rhythm.coordinator.changed');

/** A full agent_sessions row (all columns/defaults) as the Mac would replicate it. */
function macRow(id: string, userId: number, over: Record<string, unknown> = {}, conversation: Record<string, unknown> | null = {}): Record<string, unknown> {
  const db = new Database(':memory:');
  runMigrations(db);
  // The Mac owns referential integrity; the replica row is read as stored.
  db.pragma('foreign_keys = OFF');
  db.prepare(`INSERT INTO agent_sessions (id, name, agent_kind, status, cwd, category) VALUES (?, 'mirror', 'librarian', 'idle', '/tmp', 'chat')`).run(id);
  const now = '2026-10-06T12:00:00.000Z';
  const json = conversation === null ? null : JSON.stringify({
    schemaVersion: COORDINATOR_CONVERSATION_SCHEMA_VERSION, id: CONVERSATION_ID, sessionId: id,
    ownerUserId: userId, projectId: PROJECT_ID, controlRevision: 1, primaryOwnerRoot: true,
    goals: [], commandDedupe: [], continuations: [], createdAt: now, updatedAt: now, ...conversation,
  });
  db.prepare('UPDATE agent_sessions SET owner_user_id=?, project_id=?, coordinator_conversation_json=? WHERE id=?')
    .run(userId, PROJECT_ID, json, id);
  for (const [column, value] of Object.entries(over)) db.prepare(`UPDATE agent_sessions SET ${column}=? WHERE id=?`).run(value, id);
  const row = db.prepare('SELECT * FROM agent_sessions WHERE id=?').get(id) as Record<string, unknown>;
  db.close();
  return row;
}

function macHint(over: Record<string, unknown> = {}): { directory: string; payload: unknown } {
  return {
    directory: MAC_DIRECTORY,
    payload: {
      type: 'rhythm.coordinator.changed', id: `mac-${randomUUID().slice(0, 8)}`,
      properties: { projectId: PROJECT_ID, conversationId: CONVERSATION_ID, localSessionId: ROOT_ID, ...over },
    },
  };
}

describe('C3 E2 relay canonical change hint', () => {
  let fixture: PairedFixture;
  const cleanups: Array<() => Promise<void> | void> = [];
  const deviceId = () => String(fixture.deviceRows[0].id);
  const hostId = () => String(fixture.deviceRows[0].host_id);

  beforeAll(async () => { fixture = await captureMacPairing(); }, 30_000);
  afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c(); });

  interface Relay {
    baseUrl: string; wsUrl: string; db: Database.Database;
    uplink: import('../services/relay_uplink_server').RelayUplinkServer;
    shape: typeof import('../services/mobile_opencode_security').shapeRelayCoordinatorChanged;
    repo: import('../repositories/coordinator_conversations_repository').CoordinatorConversationsRepository;
  }

  async function startRelay(): Promise<Relay> {
    vi.resetModules();
    vi.stubEnv('RHYTHM_ROLE', 'relay');
    const { setDb } = await import('../database/db');
    const { runMigrations: migrate } = await import('../database/migrations');
    const db = new Database(':memory:');
    migrate(db);
    setDb(db);
    const { RelayUplinkServer } = await import('../services/relay_uplink_server');
    const { createRelayGatewayRouter } = await import('../routes/relay_gateway_routes');
    const { errorHandler } = await import('../middleware/error_handler');
    const { shapeRelayCoordinatorChanged } = await import('../services/mobile_opencode_security');
    const { CoordinatorConversationsRepository } = await import('../repositories/coordinator_conversations_repository');
    const express = (await import('express')).default;
    const uplink = new RelayUplinkServer({
      bearerValidator: async (token: string) => (token === 'mac-bearer' ? { userId: fixture.userId } : null),
    });
    const app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use('/relay', createRelayGatewayRouter({
      uplink,
      ownershipRepository: {
        isResourceOwnedBy: (kind: string, id: string) => kind === 'session' && id === 'ses_owned',
        isResourceExplicitlyOwnedBy: (kind: string, id: string) => kind === 'session' && id === 'ses_owned',
        resolveSessionDirectoryForOwner: () => null,
      } as never,
    }));
    app.use(errorHandler);
    const server = http.createServer(app);
    server.on('upgrade', (request, socket, head) => { if (!uplink.handleUpgrade(request, socket, head)) socket.destroy(); });
    server.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server.once('listening', () => r()));
    const { port } = server.address() as AddressInfo;
    cleanups.push(async () => {
      uplink.stop();
      await new Promise<void>((res) => server.close(() => res()));
      db.close();
      vi.unstubAllEnvs();
      vi.resetModules();
    });
    return {
      baseUrl: `http://127.0.0.1:${port}`, wsUrl: `ws://127.0.0.1:${port}/relay/uplink`, db, uplink,
      shape: shapeRelayCoordinatorChanged,
      repo: new CoordinatorConversationsRepository(db),
    };
  }

  async function connectMac(relay: Relay, host: string, withDevices = true): Promise<FakeMac> {
    const mac = await connectFakeMac(relay.wsUrl, 'mac-bearer');
    cleanups.push(() => mac.close());
    await mac.helloAndSync(host, fixture.userId);
    if (withDevices) mac.send({ ch: 'repl', t: 'devices', devices: fixture.deviceRows });
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && !relay.uplink.isHostOnline(host, fixture.userId)) await new Promise((r) => setTimeout(r, 20));
    return mac;
  }

  const sseUrl = (relay: Relay, path = '/relay/mobile-gateway/events') => `${relay.baseUrl}${path}`;
  const sseHeaders = (project = PROJECT_ID) => ({ Authorization: `Device ${fixture.deviceToken}`, 'X-Rhythm-Project-ID': project });
  let seq = 0;
  const upsert = (mac: FakeMac, row: Record<string, unknown>) => {
    seq += 1;
    mac.send({ ch: 'repl', t: 'row', seq, tbl: 'agent_sessions', op: 'upsert', pk: String(row.id), row });
    return seq;
  };

  function deps(relay: Relay, over: Record<string, unknown> = {}) {
    return {
      attached: { id: deviceId(), userId: fixture.userId, hostId: hostId() },
      currentDevice: () => ({ id: deviceId(), userId: fixture.userId, hostId: hostId() }),
      envelopeOrigin: (e: unknown) => relay.uplink.envelopeOrigin(e),
      mirrorOrigin: (id: string) => relay.uplink.mirrorOrigin(id),
      currentOrigin: () => relay.uplink.currentOrigin(),
      isHostOnline: (h: string, u: number) => relay.uplink.isHostOnline(h, u),
      mirroredRoot: (id: string) => relay.repo.findMirroredPrimaryRoot(id),
      ...over,
    };
  }
  const project = { id: PROJECT_ID, root: '/' };

  function capture(relay: Relay): { envelopes: Array<{ directory?: string; payload: any }>; stop(): Promise<void> } {
    const sub = relay.uplink.hub.subscribe(64);
    const envelopes: Array<{ directory?: string; payload: any }> = [];
    const draining = (async () => { for await (const e of sub.stream) envelopes.push(e as never); })();
    return { envelopes, stop: async () => { sub.close(); await draining; } };
  }
  const settle = () => new Promise((r) => setTimeout(r, 120));

  it('delivers Mac hint and apply-recovery hint to the opaque project feed with no relay projects row, no Mac directory, no content', async () => {
    const relay = await startRelay();
    const mac = await connectMac(relay, hostId());
    expect(relay.db.prepare('SELECT COUNT(*) AS n FROM projects').get()).toMatchObject({ n: 0 });
    const streaming = readSse(sseUrl(relay), sseHeaders(), 1_500);
    await new Promise((r) => setTimeout(r, 300));
    upsert(mac, macRow(ROOT_ID, fixture.userId, { name: PRIVATE_TEXT }));
    await new Promise((r) => setTimeout(r, 150));
    mac.send({ ch: 'events', t: 'env', envelope: macHint() });
    const collected = await streaming;
    const hints = hintFrames(collected);
    expect(hints).toHaveLength(2);
    for (const hint of hints) {
      expect(hint).toEqual({
        directory: PROJECT_ID,
        payload: {
          type: 'rhythm.coordinator.changed', id: expect.stringMatching(/^[A-Za-z0-9_-]{1,128}$/),
          properties: { projectId: PROJECT_ID, conversationId: CONVERSATION_ID, localSessionId: ROOT_ID },
        },
      });
    }
    expect(new Set(hints.map((h) => h.payload.id)).size).toBe(2);
    expect(collected).not.toContain(MAC_DIRECTORY);
    expect(collected).not.toContain(PRIVATE_TEXT);
    expect(collected).not.toMatch(/token|grant|permission|"sessionID"|ownerUserId|controlRevision/i);
  }, 20_000);

  it('drops an event that precedes its row without backlog, then emits one recovery hint on the qualifying apply and accepts a later Mac hint', async () => {
    const relay = await startRelay();
    const mac = await connectMac(relay, hostId());
    const streaming = readSse(sseUrl(relay), sseHeaders(), 1_800);
    await new Promise((r) => setTimeout(r, 300));
    mac.send({ ch: 'events', t: 'env', envelope: macHint({ conversationId: CONVERSATION_ID }) });
    await new Promise((r) => setTimeout(r, 250));
    upsert(mac, macRow(ROOT_ID, fixture.userId));
    await new Promise((r) => setTimeout(r, 250));
    mac.send({ ch: 'events', t: 'env', envelope: macHint() });
    const hints = hintFrames(await streaming);
    // early event: dropped (no row yet); apply: one recovery hint; later event: accepted.
    expect(hints).toHaveLength(2);
  }, 20_000);

  it('applied fresh and duplicate/failed/disqualified applies: only a fresh qualifying apply is hinted', async () => {
    const relay = await startRelay();
    const mac = await connectMac(relay, hostId());
    const cap = capture(relay);
    const row = macRow(ROOT_ID, fixture.userId);
    const first = upsert(mac, row);
    await settle();
    const fresh = upsert(mac, row); // fresh seq, unchanged identity: output-only recovery
    await settle();
    mac.send({ ch: 'repl', t: 'row', seq: fresh, tbl: 'agent_sessions', op: 'upsert', pk: ROOT_ID, row }); // duplicate seq
    mac.send({ ch: 'repl', t: 'row', seq: fresh + 1, tbl: 'agent_sessions', op: 'upsert', pk: 'mismatched-pk', row }); // failed apply
    await settle();
    expect(first).toBeLessThan(fresh);
    const afterApplies = cap.envelopes.length;
    expect(afterApplies).toBe(2);
    seq = fresh + 1;
    upsert(mac, macRow(ROOT_ID, fixture.userId, { archived_at: '2026-10-06T13:00:00Z' })); // disqualified
    await settle();
    expect(cap.envelopes.length).toBe(afterApplies);
    expect(relay.uplink.mirrorOrigin(ROOT_ID)).toBeNull();
    await cap.stop();
  }, 20_000);

  it('never hints for ordinary, child, malformed or non-primary mirrored rows, and a delete forgets the origin', async () => {
    const relay = await startRelay();
    const mac = await connectMac(relay, hostId());
    const cap = capture(relay);
    upsert(mac, macRow('ordinary-1', fixture.userId, {}, { primaryOwnerRoot: false }));
    upsert(mac, macRow('child-1', fixture.userId, { parent_session_id: ROOT_ID }));
    upsert(mac, macRow('system-1', fixture.userId, { is_system: 1 }));
    upsert(mac, macRow('malformed-1', fixture.userId, { coordinator_conversation_json: '{not json' }));
    upsert(mac, macRow('none-1', fixture.userId, {}, null));
    upsert(mac, macRow('foreign-owner-1', fixture.userId + 1000, {}, { ownerUserId: fixture.userId + 1000 }));
    await settle();
    expect(cap.envelopes).toHaveLength(0);
    upsert(mac, macRow(ROOT_ID, fixture.userId));
    await settle();
    expect(cap.envelopes).toHaveLength(1);
    expect(relay.uplink.mirrorOrigin(ROOT_ID)).not.toBeNull();
    seq += 1;
    mac.send({ ch: 'repl', t: 'row', seq, tbl: 'agent_sessions', op: 'delete', pk: ROOT_ID });
    await settle();
    expect(relay.uplink.mirrorOrigin(ROOT_ID)).toBeNull();
    await cap.stop();
  }, 20_000);

  it('qualifier negatives: missing origin, wrong project/conversation/local row, rebound/revoked device, raw spoof', async () => {
    const relay = await startRelay();
    const mac = await connectMac(relay, hostId());
    const cap = capture(relay);
    upsert(mac, macRow(ROOT_ID, fixture.userId));
    await settle();
    mac.send({ ch: 'events', t: 'env', envelope: macHint() });
    await settle();
    const macEvent = cap.envelopes.find((e) => e.directory === MAC_DIRECTORY)!;
    expect(relay.shape(macEvent, project, deps(relay))).not.toBeNull();

    // Same wire object cloned or hand-built has no authenticated origin.
    expect(relay.shape(structuredClone(macEvent), project, deps(relay))).toBeNull();
    expect(relay.shape(macHint(), project, deps(relay))).toBeNull();
    // Wrong opaque project / conversation / local row.
    expect(relay.shape(macEvent, { id: 'proj_other', root: '/' }, deps(relay))).toBeNull();
    mac.send({ ch: 'events', t: 'env', envelope: macHint({ conversationId: 'conversation-stale' }) });
    mac.send({ ch: 'events', t: 'env', envelope: macHint({ localSessionId: 'other-row' }) });
    await settle();
    for (const e of cap.envelopes.filter((x) => x.directory === MAC_DIRECTORY).slice(1)) {
      expect(relay.shape(e, project, deps(relay))).toBeNull();
    }
    // Rebound / revoked / foreign device.
    const device = { id: deviceId(), userId: fixture.userId, hostId: hostId() };
    expect(relay.shape(macEvent, project, deps(relay, { currentDevice: () => null }))).toBeNull();
    expect(relay.shape(macEvent, project, deps(relay, { currentDevice: () => ({ ...device, id: 'other-device' }) }))).toBeNull();
    expect(relay.shape(macEvent, project, deps(relay, { currentDevice: () => ({ ...device, hostId: 'rebound-host' }) }))).toBeNull();
    expect(relay.shape(macEvent, project, deps(relay, { currentDevice: () => ({ ...device, userId: device.userId + 1 }) }))).toBeNull();
    // Body-bearing / extra-key hint objects.
    const body = { ...macEvent, payload: { ...macEvent.payload, properties: { ...macEvent.payload.properties, text: PRIVATE_TEXT } } };
    expect(relay.shape(body, project, deps(relay))).toBeNull();
    // Mirror row archived in the replica after the hint was queued.
    relay.db.prepare(`UPDATE agent_sessions SET archived_at='x' WHERE id=?`).run(ROOT_ID);
    expect(relay.shape(macEvent, project, deps(relay))).toBeNull();
    await cap.stop();
  }, 20_000);

  it('H1/H2 origins with identical user and IDs: only matching H1/H1 on the current generation qualifies, online true for both', async () => {
    const relay = await startRelay();
    const H1 = hostId();
    const H2 = 'host-two-same-user';
    const cap = capture(relay);

    const macA = await connectMac(relay, H1);
    upsert(macA, macRow(ROOT_ID, fixture.userId));
    await settle();
    macA.send({ ch: 'events', t: 'env', envelope: macHint() });
    await settle();
    const originH1 = relay.uplink.currentOrigin()!;
    const mirrorH1 = relay.uplink.mirrorOrigin(ROOT_ID)!;
    const eventH1 = cap.envelopes.filter((e) => e.directory === MAC_DIRECTORY).at(-1)!;
    expect(originH1.hostId).toBe(H1);
    expect(relay.shape(eventH1, project, deps(relay))).not.toBeNull(); // matching H1/H1/current

    // Real single-active-uplink supersession by an authenticated H2 connection.
    const macB = await connectMac(relay, H2, false);
    await Promise.race([macA.closed, new Promise((_, rej) => setTimeout(() => rej(new Error('H1 not superseded')), 5_000))]);
    expect(relay.uplink.isHostOnline(H1, fixture.userId)).toBe(false);
    expect(relay.uplink.isHostOnline(H2, fixture.userId)).toBe(true);
    expect(relay.uplink.mirrorOrigin(ROOT_ID)).toBeNull(); // no inheritance across hosts
    macA.send({ ch: 'events', t: 'env', envelope: macHint() }); // old socket: ignored (not active)
    upsert(macB, macRow(ROOT_ID, fixture.userId)); // identical IDs, H2 apply
    await settle();
    macB.send({ ch: 'events', t: 'env', envelope: macHint() });
    await settle();
    const originH2 = relay.uplink.currentOrigin()!;
    const mirrorH2 = relay.uplink.mirrorOrigin(ROOT_ID)!;
    const eventH2 = cap.envelopes.filter((e) => e.directory === MAC_DIRECTORY).at(-1)!;
    const applyHintH2 = cap.envelopes.filter((e) => e.directory === undefined).at(-1)!;
    expect(originH2.hostId).toBe(H2);
    expect(mirrorH2.hostId).toBe(H2);
    expect(cap.envelopes.filter((e) => e.directory === MAC_DIRECTORY)).toHaveLength(2); // the stale H1 socket added none

    const bothOnline = { isHostOnline: () => true }; // weak predicate TRUE for H1 and H2
    // H1 device vs H2 event / H2 mirror / H2 apply hint: all drop.
    expect(relay.shape(eventH2, project, deps(relay, bothOnline))).toBeNull();
    expect(relay.shape(applyHintH2, project, deps(relay, bothOnline))).toBeNull();
    // Old H1 event with the H2 mirror, and mixed combinations.
    expect(relay.shape(eventH1, project, deps(relay, bothOnline))).toBeNull();
    expect(relay.shape(eventH1, project, deps(relay, { ...bothOnline, mirrorOrigin: () => mirrorH1 }))).toBeNull(); // H1/H1 but stale generation
    expect(relay.shape(eventH2, project, deps(relay, { ...bothOnline, mirrorOrigin: () => mirrorH1 }))).toBeNull(); // mixed
    expect(relay.shape(eventH1, project, deps(relay, { ...bothOnline, mirrorOrigin: () => mirrorH2 }))).toBeNull(); // mixed
    // A device genuinely bound to H2 on the same user and IDs does qualify the H2 pair.
    const h2Device = { id: deviceId(), userId: fixture.userId, hostId: H2 };
    expect(relay.shape(eventH2, project, deps(relay, { ...bothOnline, attached: h2Device, currentDevice: () => h2Device }))).not.toBeNull();
    await cap.stop();
  }, 30_000);

  it('same-host reconnect changes the generation: an event queued before it is dropped although host, user and online match', async () => {
    const relay = await startRelay();
    const cap = capture(relay);
    const first = await connectMac(relay, hostId());
    upsert(first, macRow(ROOT_ID, fixture.userId));
    await settle();
    first.send({ ch: 'events', t: 'env', envelope: macHint() });
    await settle();
    const queued = cap.envelopes.filter((e) => e.directory === MAC_DIRECTORY).at(-1)!;
    const generationBefore = relay.uplink.currentOrigin()!.generation;
    expect(relay.shape(queued, project, deps(relay))).not.toBeNull();

    const second = await connectMac(relay, hostId(), false);
    await first.closed;
    expect(relay.uplink.isHostOnline(hostId(), fixture.userId)).toBe(true);
    expect(relay.uplink.currentOrigin()!.generation).not.toBe(generationBefore);
    expect(relay.uplink.mirrorOrigin(ROOT_ID)).toBeNull(); // persisted row is not re-attributed
    expect(relay.shape(queued, project, deps(relay))).toBeNull();
    // Until a real authenticated apply arrives, even a fresh Mac event cannot qualify...
    second.send({ ch: 'events', t: 'env', envelope: macHint() });
    await settle();
    const fresh = cap.envelopes.filter((e) => e.directory === MAC_DIRECTORY).at(-1)!;
    expect(relay.shape(fresh, project, deps(relay))).toBeNull();
    // ...after which the new generation recovers.
    upsert(second, macRow(ROOT_ID, fixture.userId));
    await settle();
    expect(relay.shape(fresh, project, deps(relay))).not.toBeNull();
    await cap.stop();
  }, 30_000);

  it('over real SSE: device revocation before drain, per-SDK feed and raw spoof deliver nothing', async () => {
    const relay = await startRelay();
    const mac = await connectMac(relay, hostId());
    upsert(mac, macRow(ROOT_ID, fixture.userId));
    await settle();

    // Per-SDK-session feed can never carry the hint.
    const perSession = readSse(sseUrl(relay, '/relay/mobile-gateway/sessions/ses_owned/events'), sseHeaders(), 1_200);
    await new Promise((r) => setTimeout(r, 300));
    mac.send({ ch: 'events', t: 'env', envelope: macHint() });
    upsert(mac, macRow(ROOT_ID, fixture.userId));
    expect(hintFrames(await perSession)).toHaveLength(0);

    // Raw engine-shaped spoof lacking an origin-stamped canonical path still needs mirror+origin; a
    // hint object that skipped the authenticated uplink (hub publish) has no origin.
    const spoof = readSse(sseUrl(relay), sseHeaders(), 1_200);
    await new Promise((r) => setTimeout(r, 300));
    relay.uplink.hub.publish(macHint() as never);
    expect(hintFrames(await spoof)).toHaveLength(0);

    // Revoke the replicated device row, then a valid hint must not reach the stream.
    const revoked = readSse(sseUrl(relay), sseHeaders(), 1_200);
    await new Promise((r) => setTimeout(r, 300));
    relay.db.prepare(`UPDATE mobile_devices SET revoked_at='2026-10-06T00:00:00Z' WHERE id=?`).run(deviceId());
    mac.send({ ch: 'events', t: 'env', envelope: macHint() });
    upsert(mac, macRow(ROOT_ID, fixture.userId));
    const outcome = await revoked.catch((error: Error) => error.message);
    expect(typeof outcome === 'string' ? hintFrames(outcome) : []).toHaveLength(0);
  }, 30_000);
});
