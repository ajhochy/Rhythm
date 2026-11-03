/**
 * Regression suite for the 2026-09-30 relay outage class: a half-open uplink
 * that reports perfect health while every tunneled phone request hangs.
 *
 * Each test fails on the pre-fix code:
 *  - no ping/pong or idle timeout existed in relay_uplink_client.ts (zero
 *    matches for ping|pong|heartbeat|idle);
 *  - `lastUplinkAt` was stamped only on hello / ctrl-health / resync-done, so a
 *    frozen timestamp was the NORMAL look of a busy, healthy tunnel;
 *  - `macOnline` reported socket presence, so a dead tunnel read as online;
 *  - `sendRpc` had no timeout, so a tunneled request never settled.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer, type WebSocket as WsSocket } from 'ws';

import { OpencodeEventHub } from '../services/opencode_event_hub';
import {
  parseUplinkFrame,
  serializeUplinkFrame,
  type UplinkFrame,
} from '../services/relay_uplink_protocol';
import { RelayUplinkClient } from '../services/relay_uplink_client';
import {
  MacOfflineError,
  RelayUplinkServer,
} from '../services/relay_uplink_server';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';

// lastAppliedSeq() hits SQLite on the hello handshake.
beforeAll(() => {
  const db = new Database(':memory:');
  runMigrations(db);
  setDb(db);
});

const HEALTH = { gatewayVersion: '1', ok: true };
const DEVICES = [{ id: 'dev_1', token_sha256: 'abc', label: 'phone' }];

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

interface SilentRelay {
  url: string;
  connections: number;
  pings: number;
  sockets: WsSocket[];
  close(): Promise<void>;
}

/**
 * A relay that completes the WebSocket handshake and then says nothing — the
 * shape of a half-open Cloudflare tunnel. `autoPong: false` suppresses ws's
 * built-in pong so the client's idle timer is the only thing that can notice.
 */
function startSilentRelay(options: { autoPong: boolean }): Promise<SilentRelay> {
  return new Promise((resolve) => {
    const server = http.createServer();
    const wss = new WebSocketServer({ server, path: '/relay/uplink', autoPong: options.autoPong });
    const sockets: WsSocket[] = [];
    let connections = 0;
    let pings = 0;
    wss.on('connection', (socket) => {
      connections += 1;
      sockets.push(socket);
      socket.on('ping', () => { pings += 1; });
      socket.on('message', () => { /* swallowed: the tunnel is dead */ });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `ws://127.0.0.1:${port}/relay/uplink`,
        get connections() { return connections; },
        get pings() { return pings; },
        sockets,
        close: () => new Promise((done) => {
          for (const socket of sockets) socket.terminate();
          wss.close(() => server.close(() => done()));
        }),
      });
    });
  });
}

function makeClient(
  urls: string[],
  overrides: Partial<ConstructorParameters<typeof RelayUplinkClient>[0]> = {},
): RelayUplinkClient {
  return new RelayUplinkClient({
    urls,
    bearer: 'test-bearer',
    userId: 7,
    machineId: 'mac-heartbeat',
    hub: new OpencodeEventHub(),
    healthProvider: async () => HEALTH,
    devicesProvider: async () => ({ devices: DEVICES }),
    dispatchBaseUrl: 'http://127.0.0.1:9',
    reconnectBaseMs: 10,
    reconnectMaxMs: 50,
    ...overrides,
  });
}

describe('Mac uplink client — heartbeat and recovery', () => {
  it('pings a live uplink so the relay can observe it is still there', async () => {
    const relay = await startSilentRelay({ autoPong: true });
    cleanups.push(() => relay.close());
    const client = makeClient([relay.url], { heartbeatIntervalMs: 100, idleTimeoutMs: 10_000 });
    cleanups.push(() => client.stop());
    client.start();

    await waitFor(() => relay.pings >= 2);
    expect(relay.pings).toBeGreaterThanOrEqual(2);
    // Still healthy: pings alone must never cause a reconnect.
    expect(relay.connections).toBe(1);
  });

  it('terminates and redials a half-open socket that stops answering', async () => {
    // Pre-fix this hung forever: the socket stayed OPEN, isConnected() stayed
    // true, and dialLoop never ran again because no close event ever fired.
    const relay = await startSilentRelay({ autoPong: false });
    cleanups.push(() => relay.close());
    const client = makeClient([relay.url], { heartbeatIntervalMs: 50, idleTimeoutMs: 300 });
    cleanups.push(() => client.stop());
    client.start();

    await waitFor(() => relay.connections >= 2, 8_000);
    expect(relay.connections).toBeGreaterThanOrEqual(2);
  });

  it('keeps dialing after a dial pass throws', async () => {
    // dialLoop() used to have no try/catch: one throw left its promise
    // rejected and the Mac unreachable until the app was restarted.
    const relay = await startSilentRelay({ autoPong: true });
    cleanups.push(() => relay.close());
    const client = makeClient([relay.url], { heartbeatIntervalMs: 10_000, idleTimeoutMs: 10_000 });
    cleanups.push(() => client.stop());

    const internals = client as unknown as {
      dial: (url: string) => Promise<string>;
    };
    const realDial = internals.dial.bind(client);
    let calls = 0;
    internals.dial = async (url: string) => {
      calls += 1;
      if (calls === 1) throw new Error('synthetic dial explosion');
      return realDial(url);
    };

    client.start();
    await waitFor(() => relay.connections >= 1, 8_000);
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(relay.connections).toBeGreaterThanOrEqual(1);
  });
});

/** Drive a RelayUplinkServer over a real loopback WS, bypassing enrollment. */
async function startRelayServer(): Promise<{
  uplink: RelayUplinkServer;
  connect(): Promise<WebSocket>;
  close(): Promise<void>;
}> {
  const uplink = new RelayUplinkServer({
    bearerValidator: async () => ({ userId: 7 }),
    requireEnrollment: false,
    credentialRecheckIntervalMs: 60_000,
  });
  const server = http.createServer();
  server.on('upgrade', (req, socket, head) => {
    if (!uplink.handleUpgrade(req, socket, head)) socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    uplink,
    connect: () => new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/relay/uplink`, {
        headers: { Authorization: 'Bearer test-bearer' },
      });
      socket.once('open', () => resolve(socket));
      socket.once('error', reject);
    }),
    close: async () => {
      uplink.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function handshake(uplink: RelayUplinkServer, socket: WebSocket): Promise<void> {
  const sawResync = new Promise<void>((resolve) => {
    socket.on('message', (data) => {
      const frame = parseUplinkFrame(String(data));
      if (frame?.ch === 'ctrl' && frame.t === 'resync') resolve();
    });
  });
  socket.send(serializeUplinkFrame({
    ch: 'ctrl', t: 'hello', userId: 7, machineId: 'mac-heartbeat', health: HEALTH,
  }));
  await sawResync;
  socket.send(serializeUplinkFrame({ ch: 'ctrl', t: 'resync-done', throughSeq: 0 }));
  await waitFor(() => uplink.isMacOnline());
}

describe('Relay uplink server — honest liveness', () => {
  it('stamps lastUplinkAt on ordinary data frames, not only ctrl frames', async () => {
    // A frozen lastUplinkAt used to be the normal look of a BUSY tunnel, which
    // is exactly what made it useless as evidence during the outage.
    const harness = await startRelayServer();
    cleanups.push(() => harness.close());
    const socket = await harness.connect();
    cleanups.push(() => { socket.terminate(); });
    await handshake(harness.uplink, socket);

    const before = harness.uplink.getLastUplinkAt();
    expect(before).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 20));

    socket.send(serializeUplinkFrame({
      ch: 'events', t: 'env', envelope: { payload: { type: 'noop' } },
    } as UplinkFrame));

    await waitFor(() => harness.uplink.getLastUplinkAt() !== before);
    expect(harness.uplink.getLastUplinkAt()).not.toBe(before);
  });

  it('reports the Mac offline once lastUplinkAt goes stale', async () => {
    const harness = await startRelayServer();
    cleanups.push(() => harness.close());
    const socket = await harness.connect();
    cleanups.push(() => { socket.terminate(); });
    await handshake(harness.uplink, socket);
    expect(harness.uplink.isMacOnline()).toBe(true);

    // Socket stays OPEN; only the evidence ages. Pre-fix this stayed true.
    const internals = harness.uplink as unknown as { lastUplinkAtMs: number };
    internals.lastUplinkAtMs = Date.now() - 10 * 60_000;
    expect(harness.uplink.isMacOnline()).toBe(false);
  });

  it('offlineReason names the cause, the remedy, and the last contact time', async () => {
    const harness = await startRelayServer();
    cleanups.push(() => harness.close());

    expect(harness.uplink.offlineReason()).toContain('never connected');

    const socket = await harness.connect();
    cleanups.push(() => { socket.terminate(); });
    await handshake(harness.uplink, socket);

    const reason = harness.uplink.offlineReason();
    expect(reason).toContain('restarted');
    expect(reason).toContain(harness.uplink.getLastUplinkAt()!);
  });

  it('rejects a tunneled request that the Mac never answers', async () => {
    // Pre-fix sendRpc had no timer: the promise never settled, Express held the
    // phone's connection open, and the phone rendered its own fetch failure as
    // "A network error occurred."
    const harness = await startRelayServer();
    cleanups.push(() => harness.close());
    const socket = await harness.connect();
    cleanups.push(() => { socket.terminate(); });
    await handshake(harness.uplink, socket);

    vi.useFakeTimers();
    try {
      const pending = harness.uplink.sendRpc({
        method: 'GET',
        path: '/mobile-gateway/opencode/session',
        headers: {},
        bodyB64: '',
      });
      const settled = pending.then(
        () => 'resolved',
        (error) => (error instanceof MacOfflineError ? 'mac_offline' : 'other'),
      );
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await settled).toBe('mac_offline');
    } finally {
      vi.useRealTimers();
    }
    expect(harness.uplink.isMacOnline()).toBe(false);
  });
});
