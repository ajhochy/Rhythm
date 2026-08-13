/**
 * Wire protocol for the Mac ⇄ Synology-relay uplink
 * (docs/ai/plan-synology-relay.md §2).
 *
 * One WebSocket, dialed BY the Mac. JSON text frames, all shaped
 * `{ ch, t, ... }`. This module is the single source of truth for the frame
 * shapes — both ends (relay_uplink_client.ts on the Mac,
 * relay_uplink_server.ts on the relay) import from here and nowhere else.
 *
 * Ordering rules the shapes encode:
 *  - `repl/row` frames carry a monotonic `seq`; they are replayable and are
 *    the durable record (outbox-backed from Phase 2 on).
 *  - `events/env` frames are NEVER replayed. A relay that missed some relies
 *    on the phone's reconnect-refresh, exactly like today's phones.
 *  - Within one live stream, rows for a bridge event are emitted BEFORE the
 *    event's envelope (persist-before-publish, extended across the wire).
 */

/** The engine-shaped `/global/event` envelope. Never reshaped in transit. */
export interface UplinkEnvelope {
  directory?: string;
  payload?: unknown;
}

// ── ctrl ─────────────────────────────────────────────────────────────────────

export interface CtrlHelloFrame {
  ch: 'ctrl';
  t: 'hello';
  userId: number;
  machineId: string;
  /** The Mac's /mobile-gateway/health response body, verbatim. */
  health: unknown;
}

export interface CtrlHealthFrame {
  ch: 'ctrl';
  t: 'health';
  health: unknown;
}

export interface CtrlResyncFrame {
  ch: 'ctrl';
  t: 'resync';
  /** Relay's last applied repl seq; 0 on a fresh relay. */
  sinceSeq: number;
}

export interface CtrlResyncDoneFrame {
  ch: 'ctrl';
  t: 'resync-done';
  throughSeq: number;
}

export interface CtrlAckFrame {
  ch: 'ctrl';
  t: 'ack';
  /** Cumulative: the Mac may prune outbox rows with seq <= this. */
  seq: number;
}

// ── repl ─────────────────────────────────────────────────────────────────────

export interface ReplRowFrame {
  ch: 'repl';
  t: 'row';
  seq: number;
  tbl: string;
  op: 'upsert' | 'delete';
  pk: string;
  /** Full row as stored (verbatim strings). Absent for op='delete'. */
  row?: Record<string, unknown>;
}

export interface ReplDevicesFrame {
  ch: 'repl';
  t: 'devices';
  /** Full-table snapshots, applied replace-all in one transaction. */
  devices: Record<string, unknown>[];
  /** Device→project scope rows, when the schema stores them separately. */
  deviceProjects?: Record<string, unknown>[];
}

// ── events ───────────────────────────────────────────────────────────────────

export interface EventsEnvFrame {
  ch: 'events';
  t: 'env';
  envelope: UplinkEnvelope;
}

// ── rpc ──────────────────────────────────────────────────────────────────────

export interface RpcReqFrame {
  ch: 'rpc';
  t: 'req';
  id: string;
  method: string;
  /** `/relay` prefix already stripped; always starts with `/mobile-gateway/`. */
  path: string;
  headers: Record<string, string>;
  /** Base64 body; empty string when there is no body. */
  bodyB64: string;
}

export interface RpcResFrame {
  ch: 'rpc';
  t: 'res';
  id: string;
  status: number;
  headers: Record<string, string>;
  bodyB64: string;
}

// ── file ─────────────────────────────────────────────────────────────────────

export interface FileArtifactFrame {
  ch: 'file';
  t: 'artifact';
  artifactId: string;
  meta: Record<string, unknown>;
  /** null = metadata-only (artifact exceeded the push size cap). */
  dataB64: string | null;
}

export type UplinkFrame =
  | CtrlHelloFrame
  | CtrlHealthFrame
  | CtrlResyncFrame
  | CtrlResyncDoneFrame
  | CtrlAckFrame
  | ReplRowFrame
  | ReplDevicesFrame
  | EventsEnvFrame
  | RpcReqFrame
  | RpcResFrame
  | FileArtifactFrame;

const CHANNELS = new Set(['ctrl', 'repl', 'events', 'rpc', 'file']);

/**
 * Parse one wire frame. Returns null (never throws) on garbage — an uplink
 * peer must survive a malformed frame without dropping the connection.
 * Shape validation is per-channel minimal: enough that a handler can trust
 * the discriminants; field-level validation stays in the handlers.
 */
export function parseUplinkFrame(raw: string): UplinkFrame | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const frame = value as { ch?: unknown; t?: unknown };
  if (typeof frame.ch !== 'string' || !CHANNELS.has(frame.ch)) return null;
  if (typeof frame.t !== 'string' || frame.t.length === 0) return null;
  return value as UplinkFrame;
}

export function serializeUplinkFrame(frame: UplinkFrame): string {
  return JSON.stringify(frame);
}
