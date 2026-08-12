/**
 * Track 1 acceptance contract — RelayUplinkClient
 * (docs/ai/contracts/relay-t1-uplink-client.md, plan §2 + S1.1–S1.3, S1.5).
 *
 * These tests ARE the acceptance criteria: a fake relay (real `ws` server on a
 * loopback port) receives the client's frames; a real local HTTP server plays
 * the Mac's 4002 gateway for RPC dispatch. Implementation must make every test
 * pass without modifying this file.
 */
import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';

import { OpencodeEventHub } from '../services/opencode_event_hub';
import {
  parseUplinkFrame,
  serializeUplinkFrame,
  type CtrlHelloFrame,
  type CtrlResyncDoneFrame,
  type EventsEnvFrame,
  type ReplDevicesFrame,
  type RpcResFrame,
  type UplinkFrame,
} from '../services/relay_uplink_protocol';
import { RelayUplinkClient } from '../services/relay_uplink_client';

const HEALTH = { gatewayVersion: '1', opencodeVersion: '1.14.49', ok: true };
const DEVICES = [{ id: 'dev_1', token_sha256: 'abc', label: 'phone' }];

interface FakeRelay {
  url: string;
  frames: UplinkFrame[];
  connections: number;
  authHeaders: (string | undefined)[];
  socket(): WsSocket;
  send(frame: UplinkFrame): void;
  waitFor<T extends UplinkFrame>(
    predicate: (frame: UplinkFrame) => frame is T,
    timeoutMs?: number,
  ): Promise<T>;
  waitForConnection(count: number, timeoutMs?: number): Promise<void>;
  dropSockets(): void;
  close(): Promise<void>;
}

function startFakeRelay(): Promise<FakeRelay> {
  return new Promise((resolve) => {
    const server = http.createServer();
    const wss = new WebSocketServer({ server, path: '/relay/uplink' });
    const frames: UplinkFrame[] = [];
    const authHeaders: (string | undefined)[] = [];
    const sockets: WsSocket[] = [];
    let connections = 0;
    const waiters: (() => void)[] = [];

    wss.on('connection', (socket, request) => {
      connections += 1;
      authHeaders.push(request.headers.authorization);
      sockets.push(socket);
      socket.on('message', (data) => {
        const frame = parseUplinkFrame(String(data));
        if (frame) {
          frames.push(frame);
          for (const wake of waiters.splice(0)) wake();
        }
      });
      for (const wake of waiters.splice(0)) wake();
    });

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `ws://127.0.0.1:${port}/relay/uplink`,
        frames,
        get connections() {
          return connections;
        },
        authHeaders,
        socket: () => sockets[sockets.length - 1]!,
        send: (frame) =>
          sockets[sockets.length - 1]!.send(serializeUplinkFrame(frame)),
        waitFor: async (predicate, timeoutMs = 5_000) => {
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            const match = frames.find(predicate);
            if (match) return match;
            await new Promise<void>((wake) => {
              waiters.push(wake);
              setTimeout(wake, 25);
            });
          }
          throw new Error(
            `contract frame not observed; saw: ${frames
              .map((f) => `${f.ch}/${f.t}`)
              .join(', ')}`,
          );
        },
        waitForConnection: async (count, timeoutMs = 5_000) => {
          const deadline = Date.now() + timeoutMs;
          while (connections < count && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 20));
          }
          if (connections < count) {
            throw new Error(`expected ${count} connections, saw ${connections}`);
          }
        },
        dropSockets: () => {
          for (const socket of sockets) socket.terminate();
        },
        close: () =>
          new Promise<void>((res) => {
            for (const socket of sockets) socket.terminate();
            wss.close(() => server.close(() => res()));
          }),
      });
    });
  });
}

/** A loopback port that is guaranteed closed (bound, then released). */
async function deadPort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

function startGatewayStub(): Promise<{
  baseUrl: string;
  requests: {
    method: string;
    url: string;
    headers: http.IncomingHttpHeaders;
    body: string;
  }[];
  close: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    const requests: {
      method: string;
      url: string;
      headers: http.IncomingHttpHeaders;
      body: string;
    }[] = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        requests.push({
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          body,
        });
        res.statusCode = 201;
        res.setHeader('content-type', 'application/json');
        res.setHeader('x-contract', 'yes');
        res.end(JSON.stringify({ echoed: body }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}

function makeClient(
  urls: string[],
  overrides: Partial<ConstructorParameters<typeof RelayUplinkClient>[0]> = {},
): { client: RelayUplinkClient; hub: OpencodeEventHub } {
  const hub = new OpencodeEventHub();
  const client = new RelayUplinkClient({
    urls,
    bearer: 'test-bearer',
    userId: 7,
    machineId: 'mac-contract',
    hub,
    healthProvider: async () => HEALTH,
    devicesProvider: async () => ({ devices: DEVICES }),
    dispatchBaseUrl: 'http://127.0.0.1:9', // overridden where RPC is exercised
    reconnectBaseMs: 10,
    reconnectMaxMs: 50,
    ...overrides,
  });
  return { client, hub };
}

const isHello = (f: UplinkFrame): f is CtrlHelloFrame =>
  f.ch === 'ctrl' && f.t === 'hello';
const isDevices = (f: UplinkFrame): f is ReplDevicesFrame =>
  f.ch === 'repl' && f.t === 'devices';
const isEnv = (f: UplinkFrame): f is EventsEnvFrame =>
  f.ch === 'events' && f.t === 'env';
const isResyncDone = (f: UplinkFrame): f is CtrlResyncDoneFrame =>
  f.ch === 'ctrl' && f.t === 'resync-done';
const isRpcRes = (f: UplinkFrame): f is RpcResFrame =>
  f.ch === 'rpc' && f.t === 'res';

describe('Track 1 contract — RelayUplinkClient', () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('skips a dead candidate, connects with the bearer, sends hello then devices', async () => {
    const relay = await startFakeRelay();
    cleanups.push(() => relay.close());
    const dead = await deadPort();

    const { client } = makeClient([
      `ws://127.0.0.1:${dead}/relay/uplink`,
      relay.url,
    ]);
    cleanups.push(() => client.stop());
    client.start();

    const hello = await relay.waitFor(isHello);
    expect(hello.userId).toBe(7);
    expect(hello.machineId).toBe('mac-contract');
    expect(hello.health).toEqual(HEALTH);
    expect(relay.authHeaders[0]).toBe('Bearer test-bearer');

    const devices = await relay.waitFor(isDevices);
    expect(devices.devices).toEqual(DEVICES);

    // hello strictly precedes the devices snapshot
    expect(relay.frames.findIndex(isHello)).toBeLessThan(
      relay.frames.findIndex(isDevices),
    );
    expect(client.isConnected()).toBe(true);
  });

  it('answers ctrl/resync with an immediate resync-done (Phase 1 stub)', async () => {
    const relay = await startFakeRelay();
    cleanups.push(() => relay.close());
    const { client } = makeClient([relay.url]);
    cleanups.push(() => client.stop());
    client.start();
    await relay.waitFor(isHello);

    relay.send({ ch: 'ctrl', t: 'resync', sinceSeq: 41 });
    const done = await relay.waitFor(isResyncDone);
    expect(done.throughSeq).toBe(41);
  });

  it('forwards hub envelopes verbatim on the events channel', async () => {
    const relay = await startFakeRelay();
    cleanups.push(() => relay.close());
    const { client, hub } = makeClient([relay.url]);
    cleanups.push(() => client.stop());
    client.start();
    await relay.waitFor(isHello);

    const envelope = {
      directory: '/Users/x/proj',
      payload: {
        type: 'message.part.updated',
        properties: { part: { id: 'prt_1', sessionID: 'ses_1' } },
      },
    };
    hub.publish(envelope);

    const frame = await relay.waitFor(isEnv);
    expect(frame.envelope).toEqual(envelope);
    // Byte-transparency: serialization of the forwarded envelope is identical.
    expect(JSON.stringify(frame.envelope)).toBe(JSON.stringify(envelope));
  });

  it('replays rpc/req against the local gateway and answers rpc/res', async () => {
    const relay = await startFakeRelay();
    cleanups.push(() => relay.close());
    const gateway = await startGatewayStub();
    cleanups.push(() => gateway.close());

    const { client } = makeClient([relay.url], {
      dispatchBaseUrl: gateway.baseUrl,
    });
    cleanups.push(() => client.stop());
    client.start();
    await relay.waitFor(isHello);

    const body = JSON.stringify({ parts: [{ type: 'text', text: 'hi' }] });
    relay.send({
      ch: 'rpc',
      t: 'req',
      id: 'rpc-1',
      method: 'POST',
      path: '/mobile-gateway/opencode/session/ses_1/prompt_async',
      headers: {
        authorization: 'Device dtok',
        'x-rhythm-project-id': 'proj-1',
        'content-type': 'application/json',
      },
      bodyB64: Buffer.from(body).toString('base64'),
    });

    const res = await relay.waitFor(isRpcRes);
    expect(res.id).toBe('rpc-1');
    expect(res.status).toBe(201);
    expect(res.headers['x-contract']).toBe('yes');
    expect(
      JSON.parse(Buffer.from(res.bodyB64, 'base64').toString('utf8')),
    ).toEqual({ echoed: body });

    expect(gateway.requests).toHaveLength(1);
    const seen = gateway.requests[0]!;
    expect(seen.method).toBe('POST');
    expect(seen.url).toBe('/mobile-gateway/opencode/session/ses_1/prompt_async');
    expect(seen.headers.authorization).toBe('Device dtok');
    expect(seen.headers['x-rhythm-project-id']).toBe('proj-1');
    expect(seen.body).toBe(body);
  });

  it('answers rpc/res 502 uplink_dispatch_failed when the gateway is unreachable', async () => {
    const relay = await startFakeRelay();
    cleanups.push(() => relay.close());
    const dead = await deadPort();
    const { client } = makeClient([relay.url], {
      dispatchBaseUrl: `http://127.0.0.1:${dead}`,
    });
    cleanups.push(() => client.stop());
    client.start();
    await relay.waitFor(isHello);

    relay.send({
      ch: 'rpc',
      t: 'req',
      id: 'rpc-dead',
      method: 'GET',
      path: '/mobile-gateway/projects',
      headers: {},
      bodyB64: '',
    });
    const res = await relay.waitFor(isRpcRes);
    expect(res.id).toBe('rpc-dead');
    expect(res.status).toBe(502);
    expect(
      JSON.parse(Buffer.from(res.bodyB64, 'base64').toString('utf8')),
    ).toEqual({ error: 'uplink_dispatch_failed' });
  });

  it('reconnects after a drop and re-runs hello + devices', async () => {
    const relay = await startFakeRelay();
    cleanups.push(() => relay.close());
    const { client } = makeClient([relay.url]);
    cleanups.push(() => client.stop());
    client.start();
    await relay.waitForConnection(1);
    await relay.waitFor(isHello);

    relay.dropSockets();
    await relay.waitForConnection(2);
    const hellos = relay.frames.filter(isHello);
    const deadline = Date.now() + 5_000;
    while (relay.frames.filter(isHello).length < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(relay.frames.filter(isHello).length).toBeGreaterThanOrEqual(2);
    expect(relay.frames.filter(isDevices).length).toBeGreaterThanOrEqual(2);
    expect(hellos[0]!.userId).toBe(7);
  });

  it('sendHealth pushes a fresh ctrl/health frame', async () => {
    const relay = await startFakeRelay();
    cleanups.push(() => relay.close());
    let calls = 0;
    const { client } = makeClient([relay.url], {
      healthProvider: async () => ({ ...HEALTH, calls: ++calls }),
    });
    cleanups.push(() => client.stop());
    client.start();
    await relay.waitFor(isHello);

    await client.sendHealth();
    const healthFrame = await relay.waitFor(
      (f): f is UplinkFrame & { health: unknown } =>
        f.ch === 'ctrl' && f.t === 'health',
    );
    expect((healthFrame.health as { calls: number }).calls).toBeGreaterThan(1);
  });

  it('stop() closes the socket and stays closed', async () => {
    const relay = await startFakeRelay();
    cleanups.push(() => relay.close());
    const { client } = makeClient([relay.url]);
    client.start();
    await relay.waitForConnection(1);
    await client.stop();
    await new Promise((r) => setTimeout(r, 150)); // > several backoff periods
    expect(relay.connections).toBe(1);
    expect(client.isConnected()).toBe(false);
  });
});
