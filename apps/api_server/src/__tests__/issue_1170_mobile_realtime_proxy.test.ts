import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { PassThrough } from 'node:stream';

import Database from 'better-sqlite3';
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { WebSocket } from 'ws';

import { createApp } from '../app';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { resetMobileGatewayRuntimeForTest } from '../services/mobile_gateway_runtime';
import { MobileOpenCodeProxy } from '../services/mobile_opencode_proxy';
import { attachWsGateway } from '../services/ws_gateway';
import { startTestServer } from './helpers/real_server';

type SseModule = {
  MobileSseProxy: new (options?: Record<string, unknown>) => {
    stream(input: Record<string, unknown>): Promise<void>;
  };
};

type PtyModule = {
  MobilePtyProxy: new (options: Record<string, unknown>) => {
    handleUpgrade(
      request: Record<string, unknown>,
      socket: PassThrough,
      head: Buffer,
    ): boolean;
    close(): void;
    activeConnectionCount(): number;
    bufferedBytes(): number;
  };
};

async function loadSseModule(): Promise<SseModule | null> {
  return vi
    .importActual<SseModule>('../services/mobile_sse_proxy')
    .catch(() => null);
}

async function loadPtyModule(): Promise<PtyModule | null> {
  return vi
    .importActual<PtyModule>('../services/mobile_pty_proxy')
    .catch(() => null);
}

function responseSink(): PassThrough & {
  statusCode: number;
  headers: Record<string, string>;
  setHeader(name: string, value: string): void;
  flushHeaders(): void;
} {
  const stream = new PassThrough() as ReturnType<typeof responseSink>;
  stream.statusCode = 200;
  stream.headers = {};
  stream.setHeader = (name: string, value: string) => {
    stream.headers[name.toLowerCase()] = value;
  };
  stream.flushHeaders = vi.fn();
  return stream;
}

const permissiveOwnershipRepository = {
  isResourceOwnedBy: () => true,
  claimResource: () => true,
  releaseResource: () => true,
};

function rawUpgradeRequest(input: {
  authorization?: string;
  projectId?: string;
  ticket?: string;
}): Record<string, unknown> {
  return {
    url: `/mobile-gateway/pty/pty-contract/connect${
      input.ticket ? `?ticket=${encodeURIComponent(input.ticket)}` : ''
    }`,
    headers: {
      ...(input.authorization
        ? { authorization: input.authorization }
        : {}),
      ...(input.projectId
        ? { 'x-rhythm-project-id': input.projectId }
        : {}),
    },
  };
}

function nonLoopbackIpv4(): string {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) {
        return address.address;
      }
    }
  }
  throw new Error(
    'A non-loopback IPv4 interface is required to verify the gateway boundary',
  );
}

function rejectedUpgradeStatus(
  url: string,
  headers: Record<string, string> = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('Timed out waiting for WebSocket rejection'));
    }, 2_000);
    ws.once('unexpected-response', (_request, response) => {
      clearTimeout(timer);
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    ws.once('open', () => {
      clearTimeout(timer);
      ws.close();
      reject(new Error('Remote legacy WebSocket unexpectedly opened'));
    });
    ws.once('error', () => undefined);
  });
}

describe('issue #1170 mobile realtime proxy contract', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('issue-1170-c1: authentication is rejected before any upstream SSE or PTY connection', async () => {
    const sseModule = await loadSseModule();
    const ptyModule = await loadPtyModule();
    expect(sseModule, 'mobile_sse_proxy.ts must exist').not.toBeNull();
    expect(ptyModule, 'mobile_pty_proxy.ts must exist').not.toBeNull();
    if (!sseModule || !ptyModule) return;

    const fetchFn = vi.fn();
    const request = new EventEmitter();
    const response = responseSink();
    const sse = new sseModule.MobileSseProxy({
      fetchFn,
      ownershipRepository: permissiveOwnershipRepository,
    });
    await expect(sse.stream({
      request,
      response,
      project: { id: 'project-contract', root: '/sandbox/project' },
      isDeviceActive: () => false,
    })).rejects.toMatchObject({ statusCode: 401 });
    expect(fetchFn).not.toHaveBeenCalled();

    const authenticateDevice = vi.fn(() => null);
    const resolveProject = vi.fn();
    const engineFactory = vi.fn();
    const pty = new ptyModule.MobilePtyProxy({
      authenticateDevice,
      resolveProject,
      engineFactory,
    });
    const socket = new PassThrough();
    const matched = pty.handleUpgrade(
      rawUpgradeRequest({ projectId: 'project-contract', ticket: 'ticket' }),
      socket,
      Buffer.alloc(0),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(matched).toBe(true);
    expect(socket.read()?.toString()).toContain('401 Unauthorized');
    expect(authenticateDevice).not.toHaveBeenCalled();
    expect(resolveProject).not.toHaveBeenCalled();
    expect(engineFactory).not.toHaveBeenCalled();
    pty.close();

    const db = new Database(':memory:');
    runMigrations(db);
    setDb(db);
    const server = await startTestServer(createApp());
    try {
      const unauthenticated = await fetch(
        `${server.baseUrl}/mobile-gateway/events`,
        { headers: { 'X-Rhythm-Project-ID': 'missing-project' } },
      );
      // Regression caught: if project lookup or the upstream fetch happens
      // before auth, this becomes a 404/502 instead of the credential-safe 401.
      expect(unauthenticated.status).toBe(401);
      expect(await unauthenticated.json()).toMatchObject({
        error: { code: 'UNAUTHORIZED' },
      });
    } finally {
      await server.close();
      db.close();
      resetMobileGatewayRuntimeForTest();
    }
  });

  it('issue-1170-c2: a revoked device cannot open SSE or complete a PTY upgrade', async () => {
    const sseModule = await loadSseModule();
    const ptyModule = await loadPtyModule();
    expect(sseModule).not.toBeNull();
    expect(ptyModule).not.toBeNull();
    if (!sseModule || !ptyModule) return;

    const fetchFn = vi.fn();
    const sse = new sseModule.MobileSseProxy({
      fetchFn,
      ownershipRepository: permissiveOwnershipRepository,
    });
    await expect(sse.stream({
      request: new EventEmitter(),
      response: responseSink(),
      project: { id: 'project-contract', root: '/sandbox/project' },
      isDeviceActive: () => false,
    })).rejects.toMatchObject({
      statusCode: 401,
      code: 'UNAUTHORIZED',
    });
    expect(fetchFn).not.toHaveBeenCalled();

    const resolveProject = vi.fn();
    const engineFactory = vi.fn();
    const pty = new ptyModule.MobilePtyProxy({
      authenticateDevice: vi.fn(() => null),
      resolveProject,
      engineFactory,
    });
    const socket = new PassThrough();
    expect(pty.handleUpgrade(rawUpgradeRequest({
      authorization: 'Device revoked-token',
      projectId: 'project-contract',
      ticket: 'ticket',
    }), socket, Buffer.alloc(0))).toBe(true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(socket.read()?.toString()).toContain('401 Unauthorized');
    expect(resolveProject).not.toHaveBeenCalled();
    expect(engineFactory).not.toHaveBeenCalled();
    pty.close();
  });

  it('issue-1170-c3: disconnect and overload paths abort upstream work and release bounded state', async () => {
    const sseModule = await loadSseModule();
    const ptyModule = await loadPtyModule();
    expect(sseModule).not.toBeNull();
    expect(ptyModule).not.toBeNull();
    if (!sseModule || !ptyModule) return;

    let upstreamSignal: AbortSignal | undefined;
    const encoder = new TextEncoder();
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(
          'data: {"directory":"/sandbox/project","payload":{"id":"evt-1","type":"server.connected","properties":{}}}\n\n',
        ));
      },
    });
    const sse = new sseModule.MobileSseProxy({
      ownershipRepository: permissiveOwnershipRepository,
      fetchFn: vi.fn(async (
        _url: string | URL | Request,
        init?: RequestInit,
      ) => {
        upstreamSignal = init?.signal ?? undefined;
        return new Response(upstreamBody, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }),
      reconnectBaseMs: 5,
      reconnectMaxMs: 10,
    });
    const request = new EventEmitter();
    const response = responseSink();
    const streaming = sse.stream({
      request,
      response,
      project: { id: 'project-contract', root: '/sandbox/project' },
      userId: 1,
      isDeviceActive: () => true,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    request.emit('close');
    await streaming;
    expect(upstreamSignal?.aborted).toBe(true);
    expect(request.listenerCount('close')).toBe(0);
    expect(response.listenerCount('close')).toBe(0);

    const fakeEngine = new EventEmitter() as EventEmitter & {
      readyState: number;
      bufferedAmount: number;
      send: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
      terminate: ReturnType<typeof vi.fn>;
    };
    fakeEngine.readyState = WebSocket.CONNECTING;
    fakeEngine.bufferedAmount = 0;
    fakeEngine.send = vi.fn();
    fakeEngine.close = vi.fn(() => {
      fakeEngine.readyState = WebSocket.CLOSED;
      fakeEngine.emit('close', 1000, Buffer.alloc(0));
    });
    fakeEngine.terminate = vi.fn();
    const fakeClient = new EventEmitter() as EventEmitter & {
      readyState: number;
      bufferedAmount: number;
      send: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
      terminate: ReturnType<typeof vi.fn>;
    };
    fakeClient.readyState = WebSocket.OPEN;
    fakeClient.bufferedAmount = 0;
    fakeClient.send = vi.fn();
    fakeClient.close = vi.fn(() => {
      fakeClient.readyState = WebSocket.CLOSED;
      fakeClient.emit('close', 1000, Buffer.alloc(0));
    });
    fakeClient.terminate = vi.fn();
    const pty = new ptyModule.MobilePtyProxy({
      authenticateDevice: vi.fn(() => ({
        id: 'device-contract',
        userId: 1,
      })),
      ownershipRepository: permissiveOwnershipRepository,
      resolveProject: vi.fn(() => ({
        id: 'project-contract',
        root: '/sandbox/project',
      })),
      engineFactory: vi.fn(() => fakeEngine),
      clientUpgrade: vi.fn((
        _request: unknown,
        _socket: unknown,
        _head: unknown,
        connected: (client: typeof fakeClient) => void,
      ) => connected(fakeClient)),
      maxBufferedBytes: 4,
    });
    const clientSocket = new PassThrough();
    expect(pty.handleUpgrade(rawUpgradeRequest({
      authorization: 'Device active-token',
      projectId: 'project-contract',
      ticket: 'ticket-contract-123',
    }), clientSocket, Buffer.alloc(0))).toBe(true);
    fakeEngine.emit('open');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(pty.activeConnectionCount()).toBe(1);
    fakeClient.emit('message', Buffer.from('12345'), false);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(pty.bufferedBytes()).toBeLessThanOrEqual(4);
    expect(fakeClient.close).toHaveBeenCalled();
    fakeClient.emit('close', 1009, Buffer.from('buffer limit'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(pty.activeConnectionCount()).toBe(0);
    expect(pty.bufferedBytes()).toBe(0);
    expect(fakeEngine.close.mock.calls.length + fakeEngine.terminate.mock.calls.length)
      .toBeGreaterThan(0);
    pty.close();

    const pendingEngine = new EventEmitter() as EventEmitter & {
      readyState: number;
      bufferedAmount: number;
      close: ReturnType<typeof vi.fn>;
      terminate: ReturnType<typeof vi.fn>;
    };
    pendingEngine.readyState = WebSocket.CONNECTING;
    pendingEngine.bufferedAmount = 0;
    pendingEngine.close = vi.fn();
    pendingEngine.terminate = vi.fn();
    const pendingProxy = new ptyModule.MobilePtyProxy({
      authenticateDevice: vi.fn(() => ({
        id: 'device-contract',
        userId: 1,
      })),
      ownershipRepository: permissiveOwnershipRepository,
      resolveProject: vi.fn(() => ({
        id: 'project-contract',
        root: '/sandbox/project',
      })),
      engineFactory: vi.fn(() => pendingEngine),
      connectTimeoutMs: 5,
    });
    const pendingSocket = new PassThrough();
    let pendingResponse = '';
    pendingSocket.on('data', (chunk) => {
      pendingResponse += chunk.toString();
    });
    expect(pendingProxy.handleUpgrade(rawUpgradeRequest({
      authorization: 'Device active-token',
      projectId: 'project-contract',
      ticket: 'ticket-contract-123',
    }), pendingSocket, Buffer.alloc(0))).toBe(true);
    expect(pendingProxy.activeConnectionCount()).toBe(1);
    await expect.poll(() => pendingProxy.activeConnectionCount(), {
      timeout: 1_000,
    }).toBe(0);
    expect(pendingResponse).toContain('504 Gateway Timeout');
    expect(pendingEngine.terminate).toHaveBeenCalled();
    expect(pendingEngine.listenerCount('open')).toBe(0);
    expect(pendingSocket.listenerCount('close')).toBe(0);
    pendingProxy.close();
  });

  it('issue-1170-c3: fatal SSE frame and buffer overflow abort once, report the error, and release all state', async () => {
    const sseModule = await loadSseModule();
    expect(sseModule).not.toBeNull();
    if (!sseModule) return;

    const oversized = new TextEncoder().encode(
      `data: ${JSON.stringify({
        directory: '/sandbox/project',
        payload: {
          id: 'evt-oversized',
          type: 'session.updated',
          properties: { padding: 'x'.repeat(1_024) },
        },
      })}\n\n`,
    );
    const scenarios = [
      {
        maxFrameBytes: 2_048,
        maxBufferedBytes: 256,
        code: 'UPSTREAM_STREAM_TOO_LARGE',
      },
      {
        maxFrameBytes: 128,
        maxBufferedBytes: 2_048,
        code: 'UPSTREAM_EVENT_TOO_LARGE',
      },
    ];
    for (const scenario of scenarios) {
      let upstreamSignal: AbortSignal | undefined;
      const fetchFn = vi.fn(async (
        _url: string | URL | Request,
        init?: RequestInit,
      ) => {
        upstreamSignal = init?.signal ?? undefined;
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(oversized);
            controller.close();
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      });
      const proxy = new sseModule.MobileSseProxy({
        fetchFn,
        ownershipRepository: permissiveOwnershipRepository,
        maxFrameBytes: scenario.maxFrameBytes,
        maxBufferedBytes: scenario.maxBufferedBytes,
        reconnectBaseMs: 1,
        reconnectMaxMs: 2,
      });
      const request = new EventEmitter();
      const response = responseSink();
      let output = '';
      response.on('data', (chunk) => {
        output += chunk.toString();
      });

      const streaming = proxy.stream({
        request,
        response,
        project: { id: 'project-contract', root: '/sandbox/project' },
        userId: 1,
        isDeviceActive: () => true,
      });
      const result = await Promise.race([
        streaming.then(() => 'closed'),
        new Promise<'timeout'>((resolve) =>
          setTimeout(() => resolve('timeout'), 100)),
      ]);
      if (result === 'timeout') request.emit('close');
      await streaming;

      expect(result).toBe('closed');
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(upstreamSignal?.aborted).toBe(true);
      expect(output).toContain('"type":"gateway.error"');
      expect(output).toContain(`"code":"${scenario.code}"`);
      expect(request.listenerCount('close')).toBe(0);
      expect(response.listenerCount('close')).toBe(0);
      expect(response.writableEnded).toBe(true);
    }
  });

  it('issue-1170-c3: a stalled downstream drain fails once without reconnecting or retaining state', async () => {
    vi.useFakeTimers();
    const sseModule = await loadSseModule();
    expect(sseModule).not.toBeNull();
    if (!sseModule) return;

    const request = new EventEmitter();
    const upstreamSignals: AbortSignal[] = [];
    const frame = new TextEncoder().encode(
      'data: {"payload":{"id":"evt-stalled","type":"server.connected","properties":{}}}\n\n',
    );
    const fetchFn = vi.fn(async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      if (fetchFn.mock.calls.length > 1) request.emit('close');
      if (init?.signal) upstreamSignals.push(init.signal);
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(frame);
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });
    const proxy = new sseModule.MobileSseProxy({
      fetchFn,
      ownershipRepository: permissiveOwnershipRepository,
      maxFrameBytes: 512,
      maxBufferedBytes: 512,
      reconnectBaseMs: 250,
      reconnectMaxMs: 250,
    });
    const response = responseSink();
    const originalWrite = response.write.bind(response);
    vi.spyOn(response, 'write').mockImplementation((chunk) => {
      originalWrite(chunk);
      return false;
    });
    const endSpy = vi.spyOn(response, 'end');
    let output = '';
    response.on('data', (chunk) => {
      output += chunk.toString();
    });
    const startedAt = Date.now();
    let completedAt: number | null = null;
    const streaming = proxy.stream({
      request,
      response,
      project: { id: 'project-contract', root: '/sandbox/project' },
      userId: 1,
      isDeviceActive: () => true,
    }).then(() => {
      completedAt = Date.now();
    });

    await vi.advanceTimersByTimeAsync(5_300);
    await streaming;

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(completedAt).not.toBeNull();
    expect(completedAt! - startedAt).toBeLessThanOrEqual(5_050);
    expect(output.match(/"type":"gateway.error"/g)).toHaveLength(1);
    expect(output).toContain('"code":"STREAM_BACKPRESSURE"');
    expect(Buffer.byteLength(output, 'utf8')).toBeLessThanOrEqual(512);
    expect(upstreamSignals).toHaveLength(1);
    expect(upstreamSignals[0].aborted).toBe(true);
    expect(endSpy).toHaveBeenCalledTimes(1);
    expect(response.writableEnded).toBe(true);
    expect(request.listenerCount('close')).toBe(0);
    expect(response.listenerCount('close')).toBe(0);
    expect(response.listenerCount('drain')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('issue-1170-c1: legacy WebSockets accept actual loopback sockets but reject remote sockets before routing', async () => {
    const server = createServer((_request, response) => response.end());
    const wss = attachWsGateway(server);
    await new Promise<void>((resolve) => {
      server.listen(0, '0.0.0.0', resolve);
    });
    const address = server.address();
    expect(address).not.toBeNull();
    expect(typeof address).not.toBe('string');
    if (!address || typeof address === 'string') return;

    let loopback: WebSocket | null = null;
    try {
      loopback = await new Promise<WebSocket>((resolve, reject) => {
        const ws = new WebSocket(
          `ws://127.0.0.1:${address.port}/ws/agents`,
          {
            headers: {
              Host: 'malicious.example',
              'X-Forwarded-For': '203.0.113.10',
            },
          },
        );
        ws.once('open', () => resolve(ws));
        ws.once('error', reject);
      });
      expect(loopback.readyState).toBe(WebSocket.OPEN);

      const remoteHost = nonLoopbackIpv4();
      const spoofedHeaders = {
        Host: '127.0.0.1',
        'X-Forwarded-For': '127.0.0.1',
      };
      expect(await rejectedUpgradeStatus(
        `ws://${remoteHost}:${address.port}/ws/agents`,
        spoofedHeaders,
      )).toBe(403);
      expect(await rejectedUpgradeStatus(
        `ws://${remoteHost}:${address.port}/ws/pty/pty-contract`,
        spoofedHeaders,
      )).toBe(403);
    } finally {
      if (loopback) {
        await new Promise<void>((resolve) => {
          loopback!.once('close', () => resolve());
          loopback!.close();
        });
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('roadmap: SSE reconnects, forwards heartbeats, filters projects, and dedupes bounded event IDs', async () => {
    const sseModule = await loadSseModule();
    expect(sseModule).not.toBeNull();
    if (!sseModule) return;

    const encoder = new TextEncoder();
    const responseFor = (frames: string, hold = false) =>
      new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(frames));
          if (!hold) controller.close();
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    const firstFrames = [
      'data: {"directory":"/outside/project","payload":{"id":"evt-wrong","type":"session.created","properties":{"info":{"id":"ses-wrong"}}}}',
      '',
      'data: {"payload":{"id":"heartbeat-1","type":"server.heartbeat","properties":{}}}',
      '',
      'data: {"directory":"/sandbox/project","payload":{"id":"evt-1","type":"session.created","properties":{"info":{"id":"ses-one"}}}}',
      '',
      '',
    ].join('\n');
    const secondFrames = [
      'data: {"directory":"/sandbox/project","payload":{"id":"evt-1","type":"session.created","properties":{"info":{"id":"ses-one"}}}}',
      '',
      'data: {"directory":"/sandbox/project","payload":{"id":"evt-2","type":"session.updated","properties":{"info":{"id":"ses-one"}}}}',
      '',
      '',
    ].join('\n');
    let attempt = 0;
    const fetchFn = vi.fn(async () =>
      responseFor(attempt++ === 0 ? firstFrames : secondFrames, attempt > 1));
    const proxy = new sseModule.MobileSseProxy({
      fetchFn,
      ownershipRepository: permissiveOwnershipRepository,
      reconnectBaseMs: 1,
      reconnectMaxMs: 2,
      maxDedupeEntries: 2,
    });
    const request = new EventEmitter();
    const response = responseSink();
    let output = '';
    response.on('data', (chunk) => {
      output += chunk.toString();
    });
    const streaming = proxy.stream({
      request,
      response,
      project: { id: 'project-contract', root: '/sandbox/project' },
      userId: 1,
      isDeviceActive: () => true,
    });

    await expect.poll(() => output, { timeout: 2_000 })
      .toContain('evt-2');
    request.emit('close');
    await streaming;
    expect(fetchFn.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(output).toContain('server.heartbeat');
    expect(output).not.toContain('evt-wrong');
    expect(output.match(/id: evt-1/g)).toHaveLength(1);
    expect(output).toContain('id: evt-2');
    expect(output).toContain('"directory":"project-contract"');
    expect(output).not.toContain('/sandbox/project');
    expect(request.listenerCount('close')).toBe(0);
    expect(response.listenerCount('close')).toBe(0);
  });

  it('issue-1170-c4: session-scoped SSE accepts the real session.updated info.id shape', async () => {
    const sseModule = await loadSseModule();
    expect(sseModule).not.toBeNull();
    if (!sseModule) return;

    const frames = [
      'data: {"directory":"/sandbox/project","payload":{"id":"evt-other","type":"session.updated","properties":{"info":{"id":"ses-other"}}}}',
      '',
      'data: {"directory":"/sandbox/project","payload":{"id":"evt-target","type":"session.updated","properties":{"info":{"id":"ses-target"}}}}',
      '',
      '',
    ].join('\n');
    const proxy = new sseModule.MobileSseProxy({
      ownershipRepository: permissiveOwnershipRepository,
      fetchFn: vi.fn(async (input) => {
        const url = new URL(String(input));
        if (url.pathname === '/session') {
          return new Response(JSON.stringify([{
            id: 'ses-target',
            directory: '/sandbox/project',
          }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(frames));
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }),
    });
    const request = new EventEmitter();
    const response = responseSink();
    let output = '';
    response.on('data', (chunk) => {
      output += chunk.toString();
    });
    const streaming = proxy.stream({
      request,
      response,
      project: { id: 'project-contract', root: '/sandbox/project' },
      userId: 1,
      sessionId: 'ses-target',
      isDeviceActive: () => true,
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    request.emit('close');
    await streaming;
    expect(output).toContain('evt-target');
    expect(output).not.toContain('evt-other');
    expect(output).toContain('"directory":"project-contract"');
    expect(output).not.toContain('/sandbox/project');
  });

  it('roadmap: PTY bridge preserves text/binary frames, ticket scope, close codes, and active revocation', async () => {
    const ptyModule = await loadPtyModule();
    expect(ptyModule).not.toBeNull();
    if (!ptyModule) return;

    const socket = () => {
      const ws = new EventEmitter() as EventEmitter & {
        readyState: number;
        bufferedAmount: number;
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
        terminate: ReturnType<typeof vi.fn>;
      };
      ws.readyState = WebSocket.OPEN;
      ws.bufferedAmount = 0;
      ws.send = vi.fn();
      ws.close = vi.fn((code: number, reason: string) => {
        ws.readyState = WebSocket.CLOSED;
        ws.emit('close', code, Buffer.from(reason));
      });
      ws.terminate = vi.fn();
      return ws;
    };
    const client = socket();
    const engine = socket();
    engine.readyState = WebSocket.CONNECTING;
    const engineFactory = vi.fn((_url: string) => engine);
    let active = true;
    const proxy = new ptyModule.MobilePtyProxy({
      authenticateDevice: vi.fn(() =>
        active ? { id: 'device-contract', userId: 1 } : null),
      ownershipRepository: permissiveOwnershipRepository,
      resolveProject: vi.fn(() => ({
        id: 'project-contract',
        root: '/sandbox/project',
      })),
      engineFactory,
      clientUpgrade: vi.fn((
        _request: unknown,
        _socket: unknown,
        _head: unknown,
        connected: (connectedClient: typeof client) => void,
      ) => connected(client)),
      revalidateIntervalMs: 5,
    });
    const rawSocket = new PassThrough();
    expect(proxy.handleUpgrade(rawUpgradeRequest({
      authorization: 'Device active-token',
      projectId: 'project-contract',
      ticket: 'ticket-contract-123',
    }), rawSocket, Buffer.alloc(0))).toBe(true);
    expect(engineFactory).toHaveBeenCalledTimes(1);
    const upstream = new URL(String(engineFactory.mock.calls[0][0]));
    expect(upstream.pathname).toBe('/pty/pty-contract/connect');
    expect(upstream.searchParams.get('directory')).toBe('/sandbox/project');
    expect(upstream.searchParams.get('ticket'))
      .toBe('ticket-contract-123');
    expect(upstream.searchParams.get('token')).toBeNull();

    engine.readyState = WebSocket.OPEN;
    engine.emit('open');
    client.emit('message', Buffer.from('text-input'), false);
    client.emit('message', Buffer.from([0, 1, 2]), true);
    engine.emit('message', Buffer.from('text-output'), false);
    engine.emit('message', Buffer.from([3, 4, 5]), true);
    expect(engine.send.mock.calls.map((call) => call[1]?.binary))
      .toEqual([false, true]);
    expect(client.send.mock.calls.map((call) => call[1]?.binary))
      .toEqual([false, true]);

    active = false;
    await expect.poll(() => client.close.mock.calls.length, {
      timeout: 1_000,
    }).toBeGreaterThan(0);
    expect(client.close.mock.calls.at(-1)?.[0]).toBe(4401);
    expect(engine.close.mock.calls.at(-1)?.[0]).toBe(4401);
    expect(proxy.activeConnectionCount()).toBe(0);
    proxy.close();
  });

  it('roadmap: PTY ticket issuance reuses the engine connect-ticket guard without leaking it', async () => {
    const upstream = vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = new URL(String(input));
      if (url.pathname === '/pty' && init?.method === 'GET') {
        return new Response(JSON.stringify([{
          id: 'pty-contract',
          cwd: '/sandbox/project',
        }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({
        ticket: 'engine-issued-ticket',
        expires_in: 30,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const proxy = new MobileOpenCodeProxy({
      baseUrl: 'http://127.0.0.1:4897',
      ownershipRepository: permissiveOwnershipRepository,
      fetchFn: upstream,
    });
    const result = await proxy.forward({
      method: 'POST',
      path: '/pty/pty-contract/connect-token',
      query: new URLSearchParams(),
      project: { id: 'project-contract', root: '/sandbox/project' },
      userId: 1,
    });
    expect(result.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);
    const headers = new Headers(upstream.mock.calls[1][1]?.headers);
    expect(headers.get('x-opencode-ticket')).toBe('1');
    expect(headers.get('authorization')).toBeNull();
    expect(String(upstream.mock.calls[1][0])).not.toContain('Device');
  });
});
