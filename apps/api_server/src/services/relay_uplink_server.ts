import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';

import {
  WebSocket,
  WebSocketServer,
  type RawData,
} from 'ws';

import { getDb } from '../database/db';
import { resolveLiveArtifactStorageDir } from '../config/env';
import {
  initializeMobilePairingSchema,
} from '../repositories/mobile_devices_repository';
import { OpencodeEventHub } from './opencode_event_hub';
import { logger } from '../utils/logger';
import {
  parseUplinkFrame,
  serializeUplinkFrame,
  type ReplDevicesFrame,
  type FileArtifactFrame,
  type ReplRowFrame,
  type RpcReqFrame,
  type RpcResFrame,
  type UplinkFrame,
} from './relay_uplink_protocol';

type BearerIdentity = { userId: number };
type BearerValidator = (token: string) => Promise<BearerIdentity | null>;

export interface RelayUplinkServerOptions {
  bearerValidator?: BearerValidator;
  hub?: OpencodeEventHub;
}

interface PendingRpc {
  resolve: (frame: RpcResFrame) => void;
  reject: (error: MacOfflineError) => void;
}

interface UplinkConnection {
  socket: WebSocket;
  authenticatedUserId: number;
  helloReceived: boolean;
}

const DEVICE_COLUMNS = [
  'id',
  'host_id',
  'user_id',
  'name',
  'token_verifier',
  'revoked_at',
  'created_at',
] as const;

const REPLICATED_TABLES = new Set([
  'agent_sessions',
  'agent_session_messages',
]);
const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function header(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name.toLowerCase()];
  return typeof value === 'string' ? value : null;
}

function rejectUnauthorized(socket: Duplex): void {
  if (socket.destroyed) return;
  const response =
    'HTTP/1.1 401 Unauthorized\r\n' +
    'Connection: close\r\n' +
    'Content-Length: 0\r\n' +
    'Cache-Control: no-store\r\n\r\n';
  socket.write(response, () => socket.destroy());
}

function rawText(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return Buffer.concat(data).toString('utf8');
}

function validIdentity(value: unknown): value is BearerIdentity {
  if (typeof value !== 'object' || value === null) return false;
  const userId = (value as { userId?: unknown }).userId;
  return Number.isSafeInteger(userId) && Number(userId) > 0;
}

async function defaultBearerValidator(
  token: string,
): Promise<BearerIdentity | null> {
  const baseUrl = (
    process.env.RHYTHM_CLOUD_API_URL ??
    process.env.PROD_API_URL ??
    'https://api.vcrcapps.com'
  ).replace(/\/$/, '');
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/auth/me`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload === null) return null;
  const user = (payload as { user?: unknown }).user;
  if (typeof user !== 'object' || user === null) return null;
  const userId = (user as { id?: unknown }).id;
  return Number.isSafeInteger(userId) && Number(userId) > 0
    ? { userId: Number(userId) }
    : null;
}

function tableExists(table: string): boolean {
  return getDb()
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
    )
    .get(table) !== undefined;
}

function replaceRows(
  table: string,
  rows: Record<string, unknown>[],
  requiredColumns?: readonly string[],
): void {
  const db = getDb();
  db.prepare(`DELETE FROM ${table}`).run();
  if (rows.length === 0) return;

  const availableColumns = new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
      .map((column) => column.name),
  );
  for (const row of rows) {
    const columns = (requiredColumns ?? Object.keys(row)).filter(
      (column) => availableColumns.has(column) && column in row,
    );
    if (columns.length === 0) continue;
    const names = columns.map((column) => `"${column}"`).join(', ');
    const placeholders = columns.map(() => '?').join(', ');
    db.prepare(
      `INSERT INTO ${table} (${names}) VALUES (${placeholders})`,
    ).run(...columns.map((column) => row[column]));
  }
}

function applyDevicesSnapshot(frame: ReplDevicesFrame): void {
  const db = getDb();
  initializeMobilePairingSchema(db);
  db.transaction(() => {
    replaceRows('mobile_devices', frame.devices, DEVICE_COLUMNS);
    if (
      frame.deviceProjects !== undefined &&
      tableExists('mobile_device_projects')
    ) {
      replaceRows('mobile_device_projects', frame.deviceProjects);
    }
  })();
}

function lastAppliedSeq(): number {
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO relay_sync_state (id, last_applied_seq)
     VALUES (1, 0)`,
  ).run();
  const row = db.prepare(
    `SELECT last_applied_seq FROM relay_sync_state WHERE id = 1`,
  ).get() as { last_applied_seq: number };
  return row.last_applied_seq;
}

function applyReplicationRow(frame: ReplRowFrame): boolean {
  if (
    !Number.isSafeInteger(frame.seq) ||
    frame.seq <= 0 ||
    !REPLICATED_TABLES.has(frame.tbl) ||
    (frame.op !== 'upsert' && frame.op !== 'delete')
  ) {
    return false;
  }

  const db = getDb();
  // Replica semantics: replicated rows reference users/projects/tasks that
  // deliberately do NOT exist on the relay — referential integrity is the
  // single writer's (the Mac's) job. The pragma is a no-op inside a
  // transaction, so it is set here, outside it.
  db.pragma('foreign_keys = OFF');
  return db.transaction(() => {
    const current = lastAppliedSeq();
    if (frame.seq <= current) return false;

    if (frame.op === 'delete') {
      db.prepare(`DELETE FROM ${frame.tbl} WHERE id = ?`).run(frame.pk);
    } else {
      if (
        !frame.row ||
        !Object.hasOwn(frame.row, 'id') ||
        String(frame.row.id) !== frame.pk
      ) {
        return false;
      }
      const availableColumns = new Set(
        (db.prepare(`PRAGMA table_info(${frame.tbl})`).all() as Array<{ name: string }>)
          .map((column) => column.name),
      );
      const columns = Object.keys(frame.row);
      if (
        columns.length === 0 ||
        columns.some((column) => !availableColumns.has(column))
      ) {
        return false;
      }
      const names = columns
        .map((column) => `"${column.replaceAll('"', '""')}"`)
        .join(', ');
      const placeholders = columns.map(() => '?').join(', ');
      db.prepare(
        `INSERT OR REPLACE INTO ${frame.tbl} (${names}) VALUES (${placeholders})`,
      ).run(...columns.map((column) => frame.row![column]));
    }

    db.prepare(
      `UPDATE relay_sync_state SET last_applied_seq = ? WHERE id = 1`,
    ).run(frame.seq);
    return true;
  })();
}

export class MacOfflineError extends Error {
  constructor() {
    super('Mac uplink is offline');
    this.name = 'MacOfflineError';
  }
}

export class RelayUplinkServer {
  readonly hub: OpencodeEventHub;

  private readonly bearerValidator: BearerValidator;
  private readonly wss: WebSocketServer;
  private readonly connections = new Set<UplinkConnection>();
  private readonly pendingRpcs = new Map<string, PendingRpc>();
  private active: UplinkConnection | null = null;
  private health: unknown | null = null;
  private lastUplinkAt: string | null = null;
  private macOnline = false;
  private appliedSinceAck = 0;
  private readonly resyncedCallbacks = new Set<() => void>();

  constructor(options: RelayUplinkServerOptions = {}) {
    this.bearerValidator = options.bearerValidator ?? defaultBearerValidator;
    this.hub = options.hub ?? new OpencodeEventHub();
    this.wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  }

  handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): boolean {
    let url: URL;
    try {
      url = new URL(request.url ?? '/', 'http://relay.local');
    } catch {
      return false;
    }
    if (url.pathname !== '/relay/uplink') return false;

    const authorization = header(request, 'authorization');
    const match = authorization?.match(/^Bearer\s+(\S+)$/i);
    if (!match) {
      rejectUnauthorized(socket);
      return true;
    }

    void this.authorizeAndUpgrade(match[1], request, socket, head);
    return true;
  }

  isMacOnline(): boolean {
    return this.macOnline;
  }

  getHealth(): unknown | null {
    return this.health;
  }

  getLastUplinkAt(): string | null {
    return this.lastUplinkAt;
  }

  onResynced(callback: () => void): void {
    this.resyncedCallbacks.add(callback);
  }

  sendRpc(request: {
    method: string;
    path: string;
    headers: Record<string, string>;
    bodyB64: string;
  }): Promise<RpcResFrame> {
    const active = this.active;
    if (
      !this.macOnline ||
      !active ||
      active.socket.readyState !== WebSocket.OPEN
    ) {
      return Promise.reject(new MacOfflineError());
    }

    const id = randomUUID();
    const frame: RpcReqFrame = {
      ch: 'rpc',
      t: 'req',
      id,
      ...request,
    };
    return new Promise<RpcResFrame>((resolve, reject) => {
      this.pendingRpcs.set(id, { resolve, reject });
      try {
        active.socket.send(serializeUplinkFrame(frame), (error) => {
          if (!error) return;
          this.pendingRpcs.delete(id);
          reject(new MacOfflineError());
        });
      } catch {
        this.pendingRpcs.delete(id);
        reject(new MacOfflineError());
      }
    });
  }

  stop(): void {
    this.setOffline();
    for (const connection of this.connections) {
      try {
        connection.socket.terminate();
      } catch {
        // Already closed.
      }
    }
    this.connections.clear();
    this.active = null;
    this.wss.close();
  }

  private async authorizeAndUpgrade(
    token: string,
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    let identity: BearerIdentity | null = null;
    try {
      const candidate = await this.bearerValidator(token);
      identity = validIdentity(candidate) ? candidate : null;
    } catch {
      identity = null;
    }
    if (!identity || socket.destroyed) {
      rejectUnauthorized(socket);
      return;
    }
    try {
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.acceptConnection(ws, identity!.userId);
      });
    } catch {
      socket.destroy();
    }
  }

  private acceptConnection(socket: WebSocket, userId: number): void {
    const connection: UplinkConnection = {
      socket,
      authenticatedUserId: userId,
      helloReceived: false,
    };
    this.connections.add(connection);
    socket.on('message', (data, isBinary) => {
      if (isBinary) return;
      const frame = parseUplinkFrame(rawText(data));
      if (!frame) return;
      if (!connection.helloReceived) {
        if (
          frame.ch !== 'ctrl' ||
          frame.t !== 'hello' ||
          frame.userId !== connection.authenticatedUserId
        ) {
          socket.close(1008, 'hello required');
          return;
        }
        connection.helloReceived = true;
        if (this.active && this.active !== connection) {
          try {
            this.active.socket.close(1000, 'superseded');
          } catch {
            this.active.socket.terminate();
          }
        }
        this.active = connection;
        this.setOffline();
        this.active = connection;
        this.health = frame.health;
        this.stampUplink();
        socket.send(serializeUplinkFrame({
          ch: 'ctrl',
          t: 'resync',
          sinceSeq: lastAppliedSeq(),
        }));
        return;
      }
      if (this.active !== connection) return;
      this.handleFrame(frame);
    });
    const disconnected = () => this.disconnect(connection);
    socket.once('close', disconnected);
    socket.once('error', disconnected);
  }

  private handleFrame(frame: UplinkFrame): void {
    if (frame.ch === 'ctrl' && frame.t === 'health') {
      this.health = frame.health;
      this.stampUplink();
      return;
    }
    if (frame.ch === 'ctrl' && frame.t === 'resync-done') {
      this.stampUplink();
      this.macOnline = true;
      this.hub.setLive(true);
      for (const callback of this.resyncedCallbacks) {
        try {
          callback();
        } catch {
          // One observer cannot prevent the relay from becoming live.
        }
      }
      // Let already-queued repl frames advance the cumulative state before
      // answering. In normal protocol order they have already been applied.
      setImmediate(() => this.sendAck());
      return;
    }
    if (frame.ch === 'events' && frame.t === 'env') {
      this.hub.publish(frame.envelope);
      return;
    }
    if (frame.ch === 'repl' && frame.t === 'devices') {
      try {
        applyDevicesSnapshot(frame);
      } catch {
        // A bad snapshot is ignored without taking down the authenticated uplink.
      }
      return;
    }
    if (frame.ch === 'repl' && frame.t === 'row') {
      try {
        if (applyReplicationRow(frame)) {
          this.appliedSinceAck += 1;
          if (this.appliedSinceAck >= 100) this.sendAck();
        }
      } catch {
        // Reject malformed or inapplicable rows without dropping the uplink.
      }
      return;
    }
    if (frame.ch === 'rpc' && frame.t === 'res') {
      const pending = this.pendingRpcs.get(frame.id);
      if (!pending) return;
      this.pendingRpcs.delete(frame.id);
      pending.resolve(frame);
      return;
    }
    if (frame.ch === 'file' && frame.t === 'artifact') {
      if (
        typeof frame.artifactId !== 'string' ||
        !ARTIFACT_ID_PATTERN.test(frame.artifactId) ||
        typeof frame.meta !== 'object' ||
        frame.meta === null ||
        Array.isArray(frame.meta) ||
        (frame.dataB64 !== null && typeof frame.dataB64 !== 'string')
      ) {
        return;
      }
      void this.storeArtifact(frame).catch((error) => {
        logger.warn(
          `[RelayUplinkServer] failed to store artifact ${frame.artifactId}: ${String(error)}`,
        );
      });
    }
  }

  private stampUplink(): void {
    this.lastUplinkAt = new Date().toISOString();
  }

  private async storeArtifact(frame: FileArtifactFrame): Promise<void> {
    const storageDir = resolveLiveArtifactStorageDir();
    await mkdir(storageDir, { recursive: true });
    await writeFile(
      join(storageDir, `${frame.artifactId}.meta.json`),
      JSON.stringify(frame.meta),
    );
    if (typeof frame.dataB64 === 'string') {
      await writeFile(
        join(storageDir, frame.artifactId),
        Buffer.from(frame.dataB64, 'base64'),
      );
    }
  }

  private disconnect(connection: UplinkConnection): void {
    this.connections.delete(connection);
    if (this.active !== connection) return;
    this.active = null;
    this.setOffline();
  }

  private sendAck(): void {
    const active = this.active;
    if (!active || active.socket.readyState !== WebSocket.OPEN) return;
    try {
      active.socket.send(serializeUplinkFrame({
        ch: 'ctrl',
        t: 'ack',
        seq: lastAppliedSeq(),
      }));
      this.appliedSinceAck = 0;
    } catch {
      // Disconnect handling owns recovery and the next ack is cumulative.
    }
  }

  private setOffline(): void {
    this.macOnline = false;
    this.hub.setLive(false);
    for (const pending of this.pendingRpcs.values()) {
      pending.reject(new MacOfflineError());
    }
    this.pendingRpcs.clear();
  }
}

export const relayUplinkServer = new RelayUplinkServer();
