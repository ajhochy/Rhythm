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
import { resolveRelayArtifactStorageDir } from '../config/env';
import {
  initializeMobilePairingSchema,
  MobileDevicesRepository,
} from '../repositories/mobile_devices_repository';
import { MobileCloudIdentityService } from './mobile_cloud_identity_service';
import { getMobilePairingService } from './mobile_gateway_runtime';
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
  type PtyFrame,
  type UplinkFrame,
} from './relay_uplink_protocol';

type BearerIdentity = { userId: number };
type BearerValidator = (token: string) => Promise<BearerIdentity | null>;

export interface RelayUplinkServerOptions {
  bearerValidator?: BearerValidator;
  hub?: OpencodeEventHub;
  requireEnrollment?: boolean;
  credentialRecheckIntervalMs?: number;
  credentialRecheckTimeoutMs?: number;
}

interface PendingRpc {
  resolve: (frame: RpcResFrame) => void;
  reject: (error: MacOfflineError) => void;
}

interface UplinkConnection {
  socket: WebSocket;
  authenticatedUserId: number;
  bearer: string;
  recheckTimer: NodeJS.Timeout | null;
  rechecking: boolean;
  helloReceived: boolean;
  hostId: string | null;
}

interface RelayPtyConnection {
  phone: WebSocket;
  uplink: WebSocket;
  deviceId: string;
  deviceToken: string;
  hostId: string;
  userId: number;
  deviceRecheckTimer: NodeJS.Timeout;
  ready: boolean;
  pending: Array<{ dataB64: string; binary: boolean }>;
  pendingBytes: number;
  timer: NodeJS.Timeout;
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
const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;
const PTY_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;
const PTY_MAX_FRAME_BYTES = 1024 * 1024;
const PTY_MAX_PENDING_BYTES = 1024 * 1024;
const PTY_MAX_WIRE_BUFFER_BYTES = 2 * 1024 * 1024;
const PTY_MAX_CONNECTIONS = 128;
const DEFAULT_UPLINK_RECHECK_MS = 30_000;
const DEFAULT_UPLINK_RECHECK_TIMEOUT_MS = 6_000;

function safeDiagnosticId(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value)
    ? value
    : 'unknown';
}

function safePtyCloseCode(code: number): number {
  return Number.isInteger(code) && (
    (code >= 1000 && code <= 1014 && ![1004, 1005, 1006].includes(code)) ||
    (code >= 3000 && code <= 4999)
  ) ? code : 1008;
}

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

function rejectUpgradeStatus(socket: Duplex, status: 400 | 503): void {
  if (socket.destroyed) return;
  const phrase = status === 400 ? 'Bad Request' : 'Service Unavailable';
  socket.write(
    `HTTP/1.1 ${status} ${phrase}\r\nConnection: close\r\n` +
      'Content-Length: 0\r\nCache-Control: no-store\r\n\r\n',
    () => socket.destroy(),
  );
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
  const user = await new MobileCloudIdentityService().authenticateBearerToken(
    token,
  );
  return user ? { userId: user.id } : null;
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
  private readonly requireEnrollment: boolean;
  private readonly credentialRecheckIntervalMs: number;
  private readonly credentialRecheckTimeoutMs: number;
  private readonly wss: WebSocketServer;
  private readonly ptyWss: WebSocketServer;
  private readonly connections = new Set<UplinkConnection>();
  private readonly ptyConnections = new Map<string, RelayPtyConnection>();
  private readonly pendingRpcs = new Map<string, PendingRpc>();
  private active: UplinkConnection | null = null;
  private health: unknown | null = null;
  private lastUplinkAt: string | null = null;
  private macOnline = false;
  private appliedSinceAck = 0;
  private readonly resyncedCallbacks = new Set<() => void>();

  constructor(options: RelayUplinkServerOptions = {}) {
    this.bearerValidator = options.bearerValidator ?? defaultBearerValidator;
    this.requireEnrollment = options.requireEnrollment ??
      options.bearerValidator === undefined;
    this.credentialRecheckIntervalMs = Math.max(
      10, options.credentialRecheckIntervalMs ?? DEFAULT_UPLINK_RECHECK_MS,
    );
    this.credentialRecheckTimeoutMs = Math.max(
      10, options.credentialRecheckTimeoutMs ?? DEFAULT_UPLINK_RECHECK_TIMEOUT_MS,
    );
    this.hub = options.hub ?? new OpencodeEventHub();
    this.wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
    this.ptyWss = new WebSocketServer({
      noServer: true,
      maxPayload: PTY_MAX_FRAME_BYTES,
      perMessageDeflate: false,
    });
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
    if (url.pathname !== '/relay/uplink') {
      const match = url.pathname.match(
        /^\/relay\/mobile-gateway\/pty\/([^/]+)\/connect$/,
      );
      if (!match) return false;
      this.upgradePty(request, socket, head, url, match[1]);
      return true;
    }

    const authorization = header(request, 'authorization');
    const match = authorization?.match(/^Bearer\s+(\S+)$/i);
    if (!match) {
      rejectUnauthorized(socket);
      return true;
    }

    void this.authorizeAndUpgrade(match[1], request, socket, head);
    return true;
  }

  private upgradePty(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    url: URL,
    encodedPtyId: string,
  ): void {
    const authorization = header(request, 'authorization');
    const token = authorization?.match(/^Device\s+(\S+)$/i)?.[1];
    let device: ReturnType<ReturnType<typeof getMobilePairingService>['authenticateDevice']> = null;
    try {
      device = token ? getMobilePairingService().authenticateDevice(token) : null;
    } catch {
      device = null;
    }
    if (!device) {
      rejectUnauthorized(socket);
      return;
    }
    let ptyId: string;
    try {
      ptyId = decodeURIComponent(encodedPtyId);
    } catch {
      rejectUpgradeStatus(socket, 400);
      return;
    }
    const projectId = header(request, 'x-rhythm-project-id')?.trim() ?? '';
    const tickets = url.searchParams.getAll('ticket');
    if (
      !PTY_ID_PATTERN.test(ptyId) ||
      !PTY_ID_PATTERN.test(projectId) ||
      tickets.length !== 1 ||
      tickets[0].length < 16 ||
      tickets[0].length > 4_096
    ) {
      rejectUpgradeStatus(socket, 400);
      return;
    }
    const active = this.active;
    if (!active || !this.isHostOnline(device.hostId, device.userId)) {
      rejectUpgradeStatus(socket, 503);
      return;
    }
    if (this.ptyConnections.size >= PTY_MAX_CONNECTIONS) {
      rejectUpgradeStatus(socket, 503);
      return;
    }
    const id = randomUUID();
    this.ptyWss.handleUpgrade(request, socket, head, (phone) => {
      const timer = setTimeout(() => this.closePty(id, 1013), 10_000);
      const connection: RelayPtyConnection = {
        phone,
        uplink: active.socket,
        deviceId: device.id,
        deviceToken: token!,
        hostId: device.hostId,
        userId: device.userId,
        deviceRecheckTimer: setInterval(() => {
          if (!this.isPtyDeviceActive(connection)) this.closePty(id, 4401);
        }, 1_000),
        ready: false,
        pending: [],
        pendingBytes: 0,
        timer,
      };
      this.ptyConnections.set(id, connection);
      phone.on('message', (data, binary) => {
        if (!this.isPtyDeviceActive(connection)) {
          this.closePty(id, 4401);
          return;
        }
        const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        if (bytes.byteLength > PTY_MAX_FRAME_BYTES) {
          this.closePty(id, 1009);
          return;
        }
        const payload = { dataB64: bytes.toString('base64'), binary };
        if (!connection.ready) {
          connection.pendingBytes += bytes.byteLength;
          if (connection.pendingBytes > PTY_MAX_PENDING_BYTES) {
            this.closePty(id, 1009);
            return;
          }
          connection.pending.push(payload);
          return;
        }
        if (!this.sendPtyFrame(active.socket, { ch: 'pty', t: 'data', id, ...payload })) {
          this.closePty(id, 1013);
        }
      });
      phone.once('close', (code) => this.closePty(id, safePtyCloseCode(code)));
      phone.once('error', () => this.closePty(id, 1011));
      if (!this.sendPtyFrame(active.socket, {
        ch: 'pty', t: 'open', id, ptyId, projectId,
        deviceToken: token!, ticket: tickets[0],
      })) this.closePty(id, 1013);
    });
  }

  private sendPtyFrame(socket: WebSocket, frame: PtyFrame): boolean {
    const encoded = serializeUplinkFrame(frame);
    if (socket.readyState !== WebSocket.OPEN ||
      socket.bufferedAmount + Buffer.byteLength(encoded) > PTY_MAX_WIRE_BUFFER_BYTES) {
      return false;
    }
    try {
      socket.send(encoded);
      return true;
    } catch {
      return false;
    }
  }

  private isPtyDeviceActive(connection: RelayPtyConnection): boolean {
    try {
      const device = getMobilePairingService()
        .authenticateDevice(connection.deviceToken);
      return device?.id === connection.deviceId &&
        device.hostId === connection.hostId &&
        device.userId === connection.userId &&
        this.isHostOnline(connection.hostId, connection.userId);
    } catch {
      return false;
    }
  }

  private closePty(id: string, code: number): void {
    const connection = this.ptyConnections.get(id);
    if (!connection) return;
    this.ptyConnections.delete(id);
    clearTimeout(connection.timer);
    clearInterval(connection.deviceRecheckTimer);
    connection.deviceToken = '';
    const safeCode = safePtyCloseCode(code);
    this.sendPtyFrame(connection.uplink, { ch: 'pty', t: 'close', id, code: safeCode });
    if (connection.phone.readyState === WebSocket.OPEN) {
      connection.phone.close(safeCode, 'relay pty closed');
    } else if (connection.phone.readyState === WebSocket.CONNECTING) {
      connection.phone.terminate();
    }
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

  isHostOnline(hostId: string, userId: number): boolean {
    return this.macOnline && this.active?.hostId === hostId &&
      this.active.authenticatedUserId === userId;
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
      if (connection.recheckTimer) clearInterval(connection.recheckTimer);
      try {
        connection.socket.terminate();
      } catch {
        // Already closed.
      }
    }
    this.connections.clear();
    this.active = null;
    this.wss.close();
    this.ptyWss.close();
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
        this.acceptConnection(ws, identity!.userId, token);
      });
    } catch {
      socket.destroy();
    }
  }

  private acceptConnection(socket: WebSocket, userId: number, bearer: string): void {
    const connection: UplinkConnection = {
      socket,
      authenticatedUserId: userId,
      bearer,
      recheckTimer: null,
      rechecking: false,
      helloReceived: false,
      hostId: null,
    };
    this.connections.add(connection);
    connection.recheckTimer = setInterval(() => {
      if (connection.rechecking || socket.readyState !== WebSocket.OPEN) return;
      connection.rechecking = true;
      let timeout: NodeJS.Timeout | null = null;
      const expiry = new Promise<null>((resolve) => {
        const timer = setTimeout(() => resolve(null), this.credentialRecheckTimeoutMs);
        timer.unref();
        timeout = timer;
      });
      void Promise.race([this.bearerValidator(connection.bearer), expiry]).then((identity) => {
        if (!validIdentity(identity) || identity.userId !== connection.authenticatedUserId) {
          if (!this.connections.has(connection)) return;
          logger.warn(
            `[RelayUplinkServer] uplink credential invalid userId=${connection.authenticatedUserId} hostId=${safeDiagnosticId(connection.hostId)} state=offline reason=credential_invalid_or_unavailable`,
          );
          socket.terminate();
          this.disconnect(connection);
        }
      }).catch(() => {
        if (!this.connections.has(connection)) return;
        logger.warn(
          `[RelayUplinkServer] uplink credential invalid userId=${connection.authenticatedUserId} hostId=${safeDiagnosticId(connection.hostId)} state=offline reason=credential_validator_error`,
        );
        socket.terminate();
        this.disconnect(connection);
      }).finally(() => {
        if (timeout) clearTimeout(timeout);
        connection.rechecking = false;
      });
    }, this.credentialRecheckIntervalMs);
    connection.recheckTimer.unref();
    socket.on('message', (data, isBinary) => {
      if (isBinary) return;
      const frame = parseUplinkFrame(rawText(data));
      if (!frame) return;
      if (!connection.helloReceived) {
        let enrollment: { hostId: string; userId: number } | null = null;
        if (this.requireEnrollment) {
          const db = getDb();
          initializeMobilePairingSchema(db);
          enrollment = new MobileDevicesRepository(db).findSoleEnrollment();
        }
        if (
          frame.ch !== 'ctrl' ||
          frame.t !== 'hello' ||
          frame.userId !== connection.authenticatedUserId ||
          (this.requireEnrollment && (
            !enrollment ||
            enrollment.userId !== connection.authenticatedUserId ||
            enrollment.hostId !== frame.machineId
          ))
        ) {
          socket.close(1008, 'hello required');
          return;
        }
        connection.helloReceived = true;
        connection.hostId = frame.machineId;
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
    if (frame.ch === 'pty') {
      const connection = this.ptyConnections.get(frame.id);
      if (!connection || connection.uplink !== this.active?.socket) return;
      if (!this.isPtyDeviceActive(connection)) {
        this.closePty(frame.id, 4401);
        return;
      }
      if (frame.t === 'ready') {
        connection.ready = true;
        clearTimeout(connection.timer);
        for (const payload of connection.pending) {
          if (!this.sendPtyFrame(connection.uplink, {
            ch: 'pty', t: 'data', id: frame.id, ...payload,
          })) {
            this.closePty(frame.id, 1013);
            return;
          }
        }
        connection.pending.length = 0;
        connection.pendingBytes = 0;
      } else if (frame.t === 'data' && connection.ready &&
        typeof frame.dataB64 === 'string' &&
        frame.dataB64.length <= PTY_MAX_FRAME_BYTES * 2 &&
        connection.phone.readyState === WebSocket.OPEN) {
        const bytes = Buffer.from(frame.dataB64, 'base64');
        if (bytes.byteLength <= PTY_MAX_FRAME_BYTES &&
          connection.phone.bufferedAmount + bytes.byteLength <= PTY_MAX_PENDING_BYTES) {
          connection.phone.send(bytes, { binary: frame.binary === true }, (error) => {
            if (error) this.closePty(frame.id, 1011);
          });
        } else {
          this.closePty(frame.id, 1009);
        }
      } else if (frame.t === 'close') {
        this.closePty(frame.id, safePtyCloseCode(frame.code));
      }
      return;
    }
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
          `[RelayUplinkServer] artifact storage failed artifactId=${safeDiagnosticId(frame.artifactId)} userId=${this.active?.authenticatedUserId ?? 'unknown'} sessionId=${safeDiagnosticId(frame.meta.sessionId)} state=online reason=${error instanceof Error ? error.name : 'UnknownError'}`,
        );
      });
    }
  }

  private stampUplink(): void {
    this.lastUplinkAt = new Date().toISOString();
  }

  private async storeArtifact(frame: FileArtifactFrame): Promise<void> {
    const storageDir = resolveRelayArtifactStorageDir();
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
    if (connection.recheckTimer) clearInterval(connection.recheckTimer);
    connection.bearer = '';
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
    for (const id of this.ptyConnections.keys()) this.closePty(id, 1013);
    this.macOnline = false;
    this.hub.setLive(false);
    for (const pending of this.pendingRpcs.values()) {
      pending.reject(new MacOfflineError());
    }
    this.pendingRpcs.clear();
  }
}

export const relayUplinkServer = new RelayUplinkServer();
