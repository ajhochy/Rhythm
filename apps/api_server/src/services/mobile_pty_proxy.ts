import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import {
  WebSocket,
  WebSocketServer,
  type RawData,
} from 'ws';

import { AppError } from '../errors/app_error';
import { OPENCODE_ENGINE_PORT } from './opencode_client_service';
import { getMobilePairingService } from './mobile_gateway_runtime';
import {
  resolveMobileProject,
  type MobileProjectScope,
} from './mobile_project_scope';
import type { MobileDevice } from './mobile_pairing_service';

type WebSocketLike = WebSocket;
type AuthenticateDevice = (token: string) => MobileDevice | null;
type ResolveProject = (projectId: unknown) => MobileProjectScope;
type EngineFactory = (url: string) => WebSocketLike;
type ClientUpgrade = (
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  connected: (client: WebSocketLike) => void,
) => void;

export interface MobilePtyProxyOptions {
  authenticateDevice?: AuthenticateDevice;
  resolveProject?: ResolveProject;
  engineBaseUrl?: string;
  engineFactory?: EngineFactory;
  clientUpgrade?: ClientUpgrade;
  maxFrameBytes?: number;
  maxBufferedBytes?: number;
  maxConnections?: number;
  connectTimeoutMs?: number;
  revalidateIntervalMs?: number;
}

interface ActiveConnection {
  client: WebSocketLike;
  engine: WebSocketLike;
  token: string;
  deviceId: string;
  timer: NodeJS.Timeout;
  cleanup: () => void;
}

const DEFAULT_MAX_FRAME_BYTES = 1024 * 1024;
const DEFAULT_MAX_BUFFERED_BYTES = 1024 * 1024;
const DEFAULT_MAX_CONNECTIONS = 128;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

function header(
  request: IncomingMessage,
  name: string,
): string | null {
  const value = request.headers[name.toLowerCase()];
  return typeof value === 'string' ? value : null;
}

function reasonPhrase(status: number): string {
  if (status === 400) return 'Bad Request';
  if (status === 401) return 'Unauthorized';
  if (status === 403) return 'Forbidden';
  if (status === 404) return 'Not Found';
  if (status === 409) return 'Conflict';
  if (status === 503) return 'Service Unavailable';
  if (status === 504) return 'Gateway Timeout';
  return 'Bad Gateway';
}

function rejectUpgrade(socket: Duplex, status: number): void {
  if (socket.destroyed) return;
  const phrase = reasonPhrase(status);
  socket.end(
    `HTTP/1.1 ${status} ${phrase}\r\n` +
      'Connection: close\r\n' +
      'Content-Length: 0\r\n' +
      'Cache-Control: no-store\r\n\r\n',
  );
}

function safeClose(
  ws: WebSocketLike,
  code = 1000,
  reason = '',
): void {
  if (
    ws.readyState !== WebSocket.OPEN &&
    ws.readyState !== WebSocket.CONNECTING
  ) {
    return;
  }
  try {
    if (ws.readyState === WebSocket.CONNECTING) {
      ws.once('error', () => undefined);
      ws.terminate();
      return;
    }
    ws.close(code, Buffer.from(reason).subarray(0, 123).toString());
  } catch {
    try {
      ws.terminate();
    } catch {
      // Already closed.
    }
  }
}

function rawLength(data: RawData): number {
  if (Buffer.isBuffer(data)) return data.byteLength;
  if (data instanceof ArrayBuffer) return data.byteLength;
  return data.reduce((total, chunk) => total + chunk.byteLength, 0);
}

function propagatedCloseCode(code: number): number {
  if (
    (code >= 1000 &&
      code <= 1014 &&
      code !== 1004 &&
      code !== 1005 &&
      code !== 1006) ||
    (code >= 3000 && code <= 4999)
  ) {
    return code;
  }
  return 1000;
}

function safePtyId(encoded: string): string | null {
  try {
    const value = decodeURIComponent(encoded);
    return /^[A-Za-z0-9_-]{1,256}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Authenticates a mobile upgrade before connecting to OpenCode, then bridges
 * the already-issued single-use OpenCode ticket without exposing credentials
 * in logs or inventing a second PTY authorization mechanism.
 */
export class MobilePtyProxy {
  private readonly authenticateDevice: AuthenticateDevice;
  private readonly resolveProject: ResolveProject;
  private readonly engineBaseUrl: string;
  private readonly engineFactory: EngineFactory;
  private readonly clientUpgrade: ClientUpgrade;
  private readonly maxFrameBytes: number;
  private readonly maxBufferedBytes: number;
  private readonly maxConnections: number;
  private readonly connectTimeoutMs: number;
  private readonly revalidateIntervalMs: number;
  private readonly clientWss: WebSocketServer;
  private readonly pending = new Map<WebSocketLike, () => void>();
  private readonly active = new Set<ActiveConnection>();

  constructor(options: MobilePtyProxyOptions = {}) {
    this.authenticateDevice =
      options.authenticateDevice ??
      ((token) => getMobilePairingService().authenticateDevice(token));
    this.resolveProject = options.resolveProject ?? resolveMobileProject;
    this.engineBaseUrl = (
      options.engineBaseUrl ?? `ws://127.0.0.1:${OPENCODE_ENGINE_PORT}`
    ).replace(/\/$/, '');
    this.maxFrameBytes =
      options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
    this.maxBufferedBytes =
      options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
    this.maxConnections =
      options.maxConnections ?? DEFAULT_MAX_CONNECTIONS;
    this.connectTimeoutMs =
      options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.revalidateIntervalMs = options.revalidateIntervalMs ?? 1_000;
    this.engineFactory =
      options.engineFactory ??
      ((url) => new WebSocket(url, {
        maxPayload: this.maxFrameBytes,
        perMessageDeflate: false,
      }));
    this.clientWss = new WebSocketServer({
      noServer: true,
      maxPayload: this.maxFrameBytes,
      perMessageDeflate: false,
    });
    this.clientUpgrade =
      options.clientUpgrade ??
      ((request, socket, head, connected) => {
        this.clientWss.handleUpgrade(
          request,
          socket,
          head,
          connected,
        );
      });
  }

  handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): boolean {
    let url: URL;
    try {
      url = new URL(request.url ?? '/', 'http://mobile.local');
    } catch {
      return false;
    }
    const match = url.pathname.match(
      /^\/mobile-gateway\/pty\/([^/]+)\/connect$/,
    );
    if (!match) return false;

    const authorization = header(request, 'authorization');
    const tokenMatch = authorization?.match(/^Device\s+(\S+)$/i);
    if (!tokenMatch) {
      rejectUpgrade(socket, 401);
      return true;
    }
    const token = tokenMatch[1];
    const device = this.authenticateDevice(token);
    if (!device) {
      rejectUpgrade(socket, 401);
      return true;
    }

    const projectId = header(request, 'x-rhythm-project-id');
    let project: MobileProjectScope;
    try {
      project = this.resolveProject(projectId);
    } catch (error) {
      rejectUpgrade(
        socket,
        error instanceof AppError ? error.statusCode : 500,
      );
      return true;
    }

    const ptyId = safePtyId(match[1]);
    const tickets = url.searchParams.getAll('ticket');
    if (
      !ptyId ||
      tickets.length !== 1 ||
      tickets[0].length < 16 ||
      tickets[0].length > 4_096
    ) {
      rejectUpgrade(socket, 400);
      return true;
    }
    if (this.pending.size + this.active.size >= this.maxConnections) {
      rejectUpgrade(socket, 503);
      return true;
    }

    const upstreamUrl = new URL(
      `/pty/${encodeURIComponent(ptyId)}/connect`,
      this.engineBaseUrl,
    );
    upstreamUrl.searchParams.set('directory', project.root);
    upstreamUrl.searchParams.set('ticket', tickets[0]);

    let engine: WebSocketLike;
    try {
      engine = this.engineFactory(upstreamUrl.toString());
    } catch {
      rejectUpgrade(socket, 502);
      return true;
    }
    let settled = false;
    let connectTimer: NodeJS.Timeout | null = null;
    const cleanupPending = (): void => {
      this.pending.delete(engine);
      if (connectTimer) clearTimeout(connectTimer);
      socket.off('close', onSocketClose);
      socket.off('error', onSocketClose);
      engine.off('open', onOpen);
      engine.off('close', onEngineClose);
      engine.off('error', onEngineError);
      engine.off('unexpected-response', onUnexpectedResponse);
    };
    const fail = (status: number): void => {
      if (settled) return;
      settled = true;
      cleanupPending();
      safeClose(engine, 1008, 'gateway rejected');
      rejectUpgrade(socket, status);
    };
    const onSocketClose = (): void => fail(502);
    const onEngineClose = (): void => fail(403);
    const onEngineError = (): void => fail(502);
    const onUnexpectedResponse = (
      _request: unknown,
      response: { statusCode?: number },
    ): void => {
      fail(response.statusCode === 403 ? 403 : 502);
    };
    const onOpen = (): void => {
      if (settled) return;
      const activeDevice = this.authenticateDevice(token);
      if (!activeDevice || activeDevice.id !== device.id) {
        fail(401);
        return;
      }
      try {
        const currentProject = this.resolveProject(project.id);
        if (currentProject.root !== project.root) {
          fail(403);
          return;
        }
      } catch {
        fail(403);
        return;
      }

      settled = true;
      cleanupPending();
      try {
        this.clientUpgrade(request, socket, head, (client) => {
          this.bridge(client, engine, token, device.id);
        });
      } catch {
        safeClose(engine, 1011, 'gateway upgrade failed');
        rejectUpgrade(socket, 502);
      }
    };
    socket.once('close', onSocketClose);
    socket.once('error', onSocketClose);
    engine.once('open', onOpen);
    engine.once('close', onEngineClose);
    engine.once('error', onEngineError);
    engine.once('unexpected-response', onUnexpectedResponse);
    connectTimer = setTimeout(() => fail(504), this.connectTimeoutMs);
    connectTimer.unref();
    this.pending.set(engine, () => fail(503));
    return true;
  }

  activeConnectionCount(): number {
    return this.pending.size + this.active.size;
  }

  bufferedBytes(): number {
    let total = 0;
    for (const connection of this.active) {
      total += connection.client.bufferedAmount;
      total += connection.engine.bufferedAmount;
    }
    return total;
  }

  close(): void {
    for (const reject of [...this.pending.values()]) reject();
    for (const connection of [...this.active]) {
      safeClose(connection.client, 1001, 'shutdown');
      safeClose(connection.engine, 1001, 'shutdown');
      connection.cleanup();
    }
    this.clientWss.close();
  }

  private bridge(
    client: WebSocketLike,
    engine: WebSocketLike,
    token: string,
    deviceId: string,
  ): void {
    let closed = false;
    const connection = {} as ActiveConnection;
    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(connection.timer);
      client.off('message', onClientMessage);
      engine.off('message', onEngineMessage);
      client.off('close', onClientClose);
      engine.off('close', onEngineClose);
      client.off('error', onClientError);
      engine.off('error', onEngineError);
      this.active.delete(connection);
    };
    const shutdown = (code: number, reason: string): void => {
      if (closed) return;
      safeClose(client, code, reason);
      safeClose(engine, code, reason);
      cleanup();
    };
    const send = (
      target: WebSocketLike,
      data: RawData,
      binary: boolean,
    ): void => {
      const length = rawLength(data);
      if (
        length > this.maxFrameBytes ||
        target.bufferedAmount + length > this.maxBufferedBytes
      ) {
        shutdown(1009, 'buffer limit');
        return;
      }
      try {
        target.send(data, { binary }, (error) => {
          if (error) shutdown(1011, 'bridge write failed');
        });
      } catch {
        shutdown(1011, 'bridge write failed');
      }
    };
    const onClientMessage = (data: RawData, binary: boolean) =>
      send(engine, data, binary);
    const onEngineMessage = (data: RawData, binary: boolean) =>
      send(client, data, binary);
    const onClientClose = (code: number, reason: Buffer) => {
      if (!closed) {
        safeClose(engine, propagatedCloseCode(code), reason.toString());
      }
      cleanup();
    };
    const onEngineClose = (code: number, reason: Buffer) => {
      if (!closed) {
        safeClose(client, propagatedCloseCode(code), reason.toString());
      }
      cleanup();
    };
    const onClientError = () => shutdown(1011, 'client connection failed');
    const onEngineError = () => shutdown(1011, 'engine connection failed');

    connection.client = client;
    connection.engine = engine;
    connection.token = token;
    connection.deviceId = deviceId;
    connection.cleanup = cleanup;
    connection.timer = setInterval(() => {
      let device: MobileDevice | null = null;
      try {
        device = this.authenticateDevice(token);
      } catch {
        // A closed/unavailable auth store is fail-closed for a live socket.
      }
      if (!device || device.id !== deviceId) {
        shutdown(4401, 'device revoked');
      }
    }, this.revalidateIntervalMs);
    connection.timer.unref();
    this.active.add(connection);

    client.on('message', onClientMessage);
    engine.on('message', onEngineMessage);
    client.once('close', onClientClose);
    engine.once('close', onEngineClose);
    client.once('error', onClientError);
    engine.once('error', onEngineError);
  }
}
