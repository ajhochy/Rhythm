import { WebSocket, type RawData } from 'ws';
import { readFile } from 'node:fs/promises';

import { logger } from '../utils/logger';
import { RelayOutboxRepository } from '../repositories/relay_outbox_repository';
import { OpencodeEventHub, type HubSubscription } from './opencode_event_hub';
import {
  parseUplinkFrame,
  serializeUplinkFrame,
  type CtrlResyncFrame,
  type FileArtifactFrame,
  type RpcReqFrame,
  type RpcResFrame,
  type UplinkFrame,
} from './relay_uplink_protocol';

export interface RelayUplinkClientOptions {
  urls: string[];
  bearer: string;
  userId: number;
  machineId: string;
  hub: OpencodeEventHub;
  healthProvider: () => Promise<unknown>;
  devicesProvider: () => Promise<{
    devices: Record<string, unknown>[];
    deviceProjects?: Record<string, unknown>[];
  }>;
  dispatchBaseUrl: string;
  fetchFn?: typeof fetch;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  hubMaxQueue?: number;
  maxInflightRpc?: number;
}

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const RPC_TIMEOUT_MS = 30_000;
const ARTIFACT_BASE64_LIMIT_BYTES = 8 * 1024 * 1024;

type DialResult = 'failed' | 'closed' | 'stopped';

export class RelayUplinkClient {
  private readonly options: RelayUplinkClientOptions;
  private readonly fetchFn: typeof fetch;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly hubMaxQueue: number;
  private readonly maxInflightRpc: number;

  private running = false;
  private ready = false;
  private socket: WebSocket | null = null;
  private redialTimer: ReturnType<typeof setTimeout> | null = null;
  private redialWake: (() => void) | null = null;
  private hubSubscription: HubSubscription | null = null;
  private dialTask: Promise<void> | null = null;
  private hubTask: Promise<void> | null = null;
  private inflightRpc = 0;
  private lastSentSeq = 0;
  private readonly pendingInbound: Array<{
    frame: UplinkFrame;
    socket: WebSocket;
  }> = [];
  private readonly rpcQueue: Array<{
    frame: RpcReqFrame;
    socket: WebSocket;
  }> = [];

  constructor(options: RelayUplinkClientOptions) {
    this.options = options;
    this.fetchFn = options.fetchFn ?? fetch;
    this.reconnectBaseMs = options.reconnectBaseMs ?? 1_000;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 60_000;
    this.hubMaxQueue = options.hubMaxQueue ?? 4_096;
    this.maxInflightRpc = options.maxInflightRpc ?? 16;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.hubTask = this.forwardHubEnvelopes();
    if (this.options.urls.length > 0) {
      this.dialTask = this.dialLoop();
    }
  }

  async stop(): Promise<void> {
    if (!this.running && !this.socket && !this.dialTask && !this.hubTask) {
      return;
    }

    this.running = false;
    this.ready = false;
    this.cancelRedial();
    this.hubSubscription?.close();
    this.hubSubscription = null;
    this.pendingInbound.length = 0;
    this.rpcQueue.length = 0;

    const socket = this.socket;
    if (socket) {
      this.socket = null;
      await this.closeSocket(socket);
    }

    await Promise.allSettled(
      [this.dialTask, this.hubTask].filter(
        (task): task is Promise<void> => task !== null,
      ),
    );
    this.dialTask = null;
    this.hubTask = null;
  }

  isConnected(): boolean {
    return this.ready && this.socket?.readyState === WebSocket.OPEN;
  }

  async sendHealth(): Promise<void> {
    const health = await this.options.healthProvider();
    this.sendFrame({ ch: 'ctrl', t: 'health', health });
  }

  async sendDevicesSnapshot(): Promise<void> {
    const snapshot = await this.options.devicesProvider();
    this.sendFrame({ ch: 'repl', t: 'devices', ...snapshot });
  }

  async pushArtifact(input: {
    artifactId: string;
    meta: Record<string, unknown>;
    filePath: string;
  }): Promise<void> {
    try {
      const bytes = await readFile(input.filePath);
      const encoded = bytes.toString('base64');
      const frame: FileArtifactFrame = {
        ch: 'file',
        t: 'artifact',
        artifactId: input.artifactId,
        meta: input.meta,
        dataB64:
          Buffer.byteLength(encoded, 'ascii') <= ARTIFACT_BASE64_LIMIT_BYTES
            ? encoded
            : null,
      };
      if (!this.sendFrame(frame)) {
        logger.warn(
          `[RelayUplinkClient] artifact push skipped while offline: ${input.artifactId}`,
        );
      }
    } catch (error) {
      logger.warn(
        `[RelayUplinkClient] artifact push failed for ${input.artifactId}: ${String(error)}`,
      );
    }
  }

  private async dialLoop(): Promise<void> {
    let backoffMs = this.reconnectBaseMs;

    while (this.running) {
      let connectedDuringPass = false;

      for (const url of this.options.urls) {
        if (!this.running) return;
        const result = await this.dial(url);
        if (result === 'stopped') return;
        if (result === 'closed') {
          connectedDuringPass = true;
          break;
        }
      }

      if (!this.running) return;
      if (connectedDuringPass) {
        backoffMs = this.reconnectBaseMs;
        await this.waitForRedial(backoffMs);
      } else {
        await this.waitForRedial(backoffMs);
        backoffMs = Math.min(
          this.reconnectMaxMs,
          Math.max(this.reconnectBaseMs, backoffMs * 2),
        );
      }
    }
  }

  private dial(url: string): Promise<DialResult> {
    return new Promise((resolve) => {
      if (!this.running) {
        resolve('stopped');
        return;
      }

      let socket: WebSocket;
      try {
        socket = new WebSocket(url, {
          headers: { Authorization: `Bearer ${this.options.bearer}` },
        });
      } catch {
        resolve('failed');
        return;
      }
      this.socket = socket;
      this.lastSentSeq = 0;
      let opened = false;
      let settled = false;

      const settle = (result: DialResult): void => {
        if (settled) return;
        settled = true;
        if (this.socket === socket) {
          this.socket = null;
          this.ready = false;
        }
        this.removePendingInbound(socket);
        resolve(result);
      };

      socket.on('open', () => {
        opened = true;
        void this.initializeConnection(socket).catch((error) => {
          logger.warn(
            `[RelayUplinkClient] connection initialization failed: ${String(error)}`,
          );
          socket.terminate();
        });
      });
      socket.on('message', (data: RawData) => {
        this.handleMessage(socket, data);
      });
      socket.on('error', () => {
        // The close event drives failover/reconnect. Error must stay contained.
      });
      socket.on('close', () => {
        settle(this.running ? (opened ? 'closed' : 'failed') : 'stopped');
      });
    });
  }

  private async initializeConnection(socket: WebSocket): Promise<void> {
    const health = await this.options.healthProvider();
    if (!this.sendFrameOn(socket, {
      ch: 'ctrl',
      t: 'hello',
      userId: this.options.userId,
      machineId: this.options.machineId,
      health,
    })) {
      return;
    }

    const snapshot = await this.options.devicesProvider();
    if (!this.sendFrameOn(socket, {
      ch: 'repl',
      t: 'devices',
      ...snapshot,
    })) {
      return;
    }

    if (this.running && this.socket === socket) {
      this.ready = true;
      this.flushPendingInbound(socket);
    }
  }

  private handleMessage(socket: WebSocket, data: RawData): void {
    const frame = parseUplinkFrame(data.toString());
    if (!frame) return;

    if (!this.ready || this.socket !== socket) {
      if (this.running && this.socket === socket) {
        this.pendingInbound.push({ frame, socket });
      }
      return;
    }

    this.processFrame(socket, frame);
  }

  private processFrame(socket: WebSocket, frame: UplinkFrame): void {
    if (frame.ch === 'ctrl' && frame.t === 'resync') {
      this.handleResync(socket, frame);
      return;
    }
    if (frame.ch === 'ctrl' && frame.t === 'ack') {
      try {
        new RelayOutboxRepository().pruneThrough(frame.seq);
      } catch {
        // Phase-1/unit harnesses may not initialize SQLite. A malformed ack or
        // unavailable local DB must not take down the uplink connection.
      }
      return;
    }
    if (frame.ch === 'rpc' && frame.t === 'req') {
      this.rpcQueue.push({ frame, socket });
      this.pumpRpcQueue();
    }
  }

  private flushPendingInbound(socket: WebSocket): void {
    const pending = this.pendingInbound.splice(0);
    for (const item of pending) {
      if (item.socket === socket) {
        this.processFrame(socket, item.frame);
      } else {
        this.pendingInbound.push(item);
      }
    }
  }

  private removePendingInbound(socket: WebSocket): void {
    for (let index = this.pendingInbound.length - 1; index >= 0; index -= 1) {
      if (this.pendingInbound[index]?.socket === socket) {
        this.pendingInbound.splice(index, 1);
      }
    }
  }

  private handleResync(socket: WebSocket, frame: CtrlResyncFrame): void {
    let throughSeq = frame.sinceSeq;
    this.lastSentSeq = frame.sinceSeq;
    try {
      const outbox = new RelayOutboxRepository();
      while (true) {
        const rows = outbox.listSince(throughSeq, 500);
        if (rows.length === 0) break;
        for (const row of rows) {
          const sent = this.sendFrameOn(socket, {
            ch: 'repl',
            t: 'row',
            seq: row.seq,
            tbl: row.tbl,
            op: row.op,
            pk: row.pk,
            ...(row.row === null ? {} : { row: row.row }),
          });
          if (!sent) return;
          throughSeq = row.seq;
          this.lastSentSeq = row.seq;
        }
        if (rows.length < 500) break;
      }
    } catch {
      // Preserve Phase-1 behavior for harnesses without an initialized DB.
    }
    if (!this.sendFrameOn(socket, {
      ch: 'ctrl',
      t: 'resync-done',
      throughSeq,
    })) {
      return;
    }
    this.flushOutbox();
  }

  /** Send the durable live tail after the last row emitted on this socket. */
  flushOutbox(): void {
    const socket = this.socket;
    if (!this.ready || !socket || socket.readyState !== WebSocket.OPEN) return;
    try {
      const outbox = new RelayOutboxRepository();
      while (true) {
        const rows = outbox.listSince(this.lastSentSeq, 500);
        for (const row of rows) {
          const sent = this.sendFrameOn(socket, {
            ch: 'repl',
            t: 'row',
            seq: row.seq,
            tbl: row.tbl,
            op: row.op,
            pk: row.pk,
            ...(row.row === null ? {} : { row: row.row }),
          });
          if (!sent) return;
          this.lastSentSeq = row.seq;
        }
        if (rows.length < 500) break;
      }
    } catch {
      // Persistence and event fan-out must remain fail-soft if replication is
      // unavailable; reconnect/resync will retry every durable row later.
    }
  }

  private pumpRpcQueue(): void {
    while (
      this.running &&
      this.inflightRpc < this.maxInflightRpc &&
      this.rpcQueue.length > 0
    ) {
      const request = this.rpcQueue.shift()!;
      this.inflightRpc += 1;
      void this.dispatchRpc(request.frame)
        .then((response) => {
          this.sendFrameOn(request.socket, response);
        })
        .catch(() => {
          this.sendFrameOn(
            request.socket,
            this.failedRpcResponse(request.frame.id),
          );
        })
        .finally(() => {
          this.inflightRpc -= 1;
          this.pumpRpcQueue();
        });
    }
  }

  private async dispatchRpc(frame: RpcReqFrame): Promise<RpcResFrame> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);

    try {
      const response = await this.fetchFn(
        `${this.options.dispatchBaseUrl.replace(/\/$/, '')}${frame.path}`,
        {
          method: frame.method,
          headers: frame.headers,
          body:
            frame.bodyB64.length === 0
              ? undefined
              : Buffer.from(frame.bodyB64, 'base64'),
          signal: controller.signal,
        },
      );
      const headers: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
          headers[name] = value;
        }
      });
      const body = Buffer.from(await response.arrayBuffer()).toString('base64');
      return {
        ch: 'rpc',
        t: 'res',
        id: frame.id,
        status: response.status,
        headers,
        bodyB64: body,
      };
    } catch {
      return this.failedRpcResponse(frame.id);
    } finally {
      clearTimeout(timeout);
    }
  }

  private failedRpcResponse(id: string): RpcResFrame {
    return {
      ch: 'rpc',
      t: 'res',
      id,
      status: 502,
      headers: { 'content-type': 'application/json' },
      bodyB64: Buffer.from(
        JSON.stringify({ error: 'uplink_dispatch_failed' }),
      ).toString('base64'),
    };
  }

  private async forwardHubEnvelopes(): Promise<void> {
    while (this.running) {
      const subscription = this.options.hub.subscribe(this.hubMaxQueue);
      this.hubSubscription = subscription;
      try {
        for await (const envelope of subscription.stream) {
          if (!this.running) return;
          this.sendFrame({ ch: 'events', t: 'env', envelope });
        }
      } catch {
        // A hub or socket failure must never escape into the publisher path.
      } finally {
        subscription.close();
        if (this.hubSubscription === subscription) {
          this.hubSubscription = null;
        }
      }
    }
  }

  private sendFrame(frame: UplinkFrame): boolean {
    const socket = this.socket;
    if (!this.ready || !socket) return false;
    return this.sendFrameOn(socket, frame);
  }

  private sendFrameOn(socket: WebSocket, frame: UplinkFrame): boolean {
    if (!this.running || socket.readyState !== WebSocket.OPEN) return false;
    try {
      socket.send(serializeUplinkFrame(frame), (error) => {
        if (error) {
          // The close/error handlers own reconnect. A send callback is terminal.
          try {
            socket.terminate();
          } catch {
            // Already closed.
          }
        }
      });
      return true;
    } catch {
      try {
        socket.terminate();
      } catch {
        // Already closed.
      }
      return false;
    }
  }

  private waitForRedial(delayMs: number): Promise<void> {
    if (!this.running) return Promise.resolve();
    return new Promise((resolve) => {
      this.redialWake = resolve;
      this.redialTimer = setTimeout(() => {
        this.redialTimer = null;
        this.redialWake = null;
        resolve();
      }, delayMs);
    });
  }

  private cancelRedial(): void {
    if (this.redialTimer) {
      clearTimeout(this.redialTimer);
      this.redialTimer = null;
    }
    const wake = this.redialWake;
    this.redialWake = null;
    wake?.();
  }

  private closeSocket(socket: WebSocket): Promise<void> {
    if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise((resolve) => {
      socket.once('close', () => resolve());
      try {
        if (socket.readyState === WebSocket.CONNECTING) {
          socket.terminate();
        } else {
          socket.close();
        }
      } catch {
        resolve();
      }
    });
  }
}
