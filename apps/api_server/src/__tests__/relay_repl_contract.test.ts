/**
 * Track 4 acceptance contract — outbox + row replication
 * (docs/ai/contracts/relay-t4-repl.md, plan S2.1–S2.3).
 *
 * Rows are the durable record: every mirror mutation appends a seq-stamped
 * outbox row inside the same transaction; the uplink replays rows > sinceSeq
 * after a gap; the relay applies idempotently, acks cumulatively, and kicks
 * its phones to refresh after a resync. Envelopes are never replayed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import WebSocket, { WebSocketServer, type WebSocket as WsSocket } from 'ws';

import {
  parseUplinkFrame,
  serializeUplinkFrame,
  type CtrlAckFrame,
  type CtrlResyncDoneFrame,
  type CtrlResyncFrame,
  type EventsEnvFrame,
  type ReplRowFrame,
  type UplinkFrame,
} from '../services/relay_uplink_protocol';

const RELAY_URLS_ENV = 'ws://127.0.0.1:1/relay/uplink'; // non-empty → hooks on

// ── shared helpers ───────────────────────────────────────────────────────────

async function freshMacModules() {
  vi.resetModules();
  vi.stubEnv('RHYTHM_ROLE', 'all');
  vi.stubEnv('RHYTHM_RELAY_URLS', RELAY_URLS_ENV);
  const { setDb } = await import('../database/db');
  const { runMigrations } = await import('../database/migrations');
  const db = new Database(':memory:');
  runMigrations(db);
  setDb(db);
  return { db };
}

function outboxRows(db: Database.Database): {
  seq: number;
  tbl: string;
  op: string;
  pk: string;
  row_json: string | null;
}[] {
  return db
    .prepare('SELECT seq, tbl, op, pk, row_json FROM relay_outbox ORDER BY seq')
    .all() as never;
}

async function seedSessionAndMessage(): Promise<{
  db: Database.Database;
  sessionPk: string;
}> {
  const { db } = await freshMacModules();
  const { AgentSessionsRepository } = await import(
    '../repositories/agent_sessions_repository'
  );
  const { UsersRepository } = await import('../repositories/users_repository');
  const user = new UsersRepository().create({
    name: 'Outbox Owner',
    email: `outbox-${randomUUID()}@example.com`,
  });
  const sessions = new AgentSessionsRepository();
  const local = sessions.insert({
    agentKind: 'claude-code',
    cwd: '/tmp/outbox',
    name: 'Outbox chat',
    ownerUserId: user.id,
    projectId: null,
    taskId: null,
    taskTitle: null,
  });
  return { db, sessionPk: String(local.id) };
}

interface FakeRelay {
  url: string;
  frames: UplinkFrame[];
  send(frame: UplinkFrame): void;
  waitFor<T extends UplinkFrame>(
    predicate: (frame: UplinkFrame) => frame is T,
    timeoutMs?: number,
  ): Promise<T>;
  close(): Promise<void>;
}

function startFakeRelay(): Promise<FakeRelay> {
  return new Promise((resolve) => {
    const server = http.createServer();
    const wss = new WebSocketServer({ server, path: '/relay/uplink' });
    const frames: UplinkFrame[] = [];
    const sockets: WsSocket[] = [];
    wss.on('connection', (socket) => {
      sockets.push(socket);
      socket.on('message', (data) => {
        const frame = parseUplinkFrame(String(data));
        if (frame) frames.push(frame);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `ws://127.0.0.1:${port}/relay/uplink`,
        frames,
        send: (frame) =>
          sockets[sockets.length - 1]!.send(serializeUplinkFrame(frame)),
        waitFor: async (predicate, timeoutMs = 5_000) => {
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            const match = frames.find(predicate);
            if (match) return match;
            await new Promise((r) => setTimeout(r, 15));
          }
          throw new Error(
            `frame not observed; saw ${frames
              .map((f) => `${f.ch}/${f.t}${f.ch === 'repl' && f.t === 'row' ? `#${(f as ReplRowFrame).seq}` : ''}`)
              .join(', ')}`,
          );
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

const isRow = (f: UplinkFrame): f is ReplRowFrame =>
  f.ch === 'repl' && f.t === 'row';
const isResyncDone = (f: UplinkFrame): f is CtrlResyncDoneFrame =>
  f.ch === 'ctrl' && f.t === 'resync-done';
const isEnv = (f: UplinkFrame): f is EventsEnvFrame =>
  f.ch === 'events' && f.t === 'env';

// ─────────────────────────────────────────────────────────────────────────────

describe('Track 4 — outbox hooks', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('message mutators append one verbatim outbox row each; applyPartDelta none', async () => {
    const { db, sessionPk } = await seedSessionAndMessage();
    const { AgentSessionMessagesRepository } = await import(
      '../repositories/agent_session_messages_repository'
    );
    const messages = new AgentSessionMessagesRepository();
    const before = outboxRows(db).length;

    messages.upsertPart(sessionPk, 'msg_ob_1', {
      id: 'prt_ob_1',
      type: 'text',
      text: 'hello',
    });
    const afterPart = outboxRows(db);
    expect(afterPart.length).toBe(before + 1);
    const partRow = afterPart[afterPart.length - 1]!;
    expect(partRow.tbl).toBe('agent_session_messages');
    expect(partRow.op).toBe('upsert');
    const parsed = JSON.parse(partRow.row_json!) as Record<string, unknown>;
    // Verbatim: the row_json IS the stored row.
    const stored = db
      .prepare('SELECT * FROM agent_session_messages WHERE id = ?')
      .get(Number(parsed.id)) as Record<string, unknown>;
    expect(parsed).toEqual(stored);

    messages.upsertMessageInfo(
      sessionPk,
      'msg_ob_1',
      'output',
      null,
      null,
      JSON.stringify({ id: 'msg_ob_1', role: 'assistant' }),
    );
    expect(outboxRows(db).length).toBe(before + 2);

    // applyPartDelta is excluded from replication by design.
    messages.applyPartDelta(
      sessionPk,
      'msg_ob_1',
      'prt_ob_1',
      'text',
      ' world',
    );
    expect(outboxRows(db).length).toBe(before + 2);

    messages.deleteBySdkMessageId(sessionPk, 'msg_ob_1');
    const afterDelete = outboxRows(db);
    expect(afterDelete[afterDelete.length - 1]!.op).toBe('delete');
  });

  it('session insert/reconcile append outbox rows with verbatim payloads', async () => {
    const { db } = await seedSessionAndMessage();
    const rows = outboxRows(db);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.some((row) => row.tbl === 'agent_sessions')).toBe(true);
    const sessionRow = rows.find((row) => row.tbl === 'agent_sessions')!;
    const parsed = JSON.parse(sessionRow.row_json!) as Record<string, unknown>;
    const stored = db
      .prepare('SELECT * FROM agent_sessions WHERE id = ?')
      .get(parsed.id) as Record<string, unknown>;
    expect(parsed).toEqual(stored);
  });

  it('hooks are inert without a configured relay', async () => {
    vi.resetModules();
    vi.stubEnv('RHYTHM_ROLE', 'all');
    vi.stubEnv('RHYTHM_RELAY_URLS', '');
    const { setDb } = await import('../database/db');
    const { runMigrations } = await import('../database/migrations');
    const db = new Database(':memory:');
    runMigrations(db);
    setDb(db);
    const { AgentSessionsRepository } = await import(
      '../repositories/agent_sessions_repository'
    );
    const { UsersRepository } = await import(
      '../repositories/users_repository'
    );
    const user = new UsersRepository().create({
      name: 'No Relay',
      email: `norelay-${randomUUID()}@example.com`,
    });
    new AgentSessionsRepository().insert({
      agentKind: 'claude-code',
      cwd: '/tmp/norelay',
      name: 'No relay chat',
      ownerUserId: user.id,
      projectId: null,
      taskId: null,
      taskTitle: null,
    });
    expect(outboxRows(db).length).toBe(0);
  });
});

describe('Track 4 — uplink client replay, ordering, ack/prune', () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function clientHarness() {
    const { db } = await seedSessionAndMessage(); // seeds outbox rows too
    const relay = await startFakeRelay();
    cleanups.push(() => relay.close());
    const { RelayUplinkClient } = await import(
      '../services/relay_uplink_client'
    );
    const { OpencodeEventHub } = await import(
      '../services/opencode_event_hub'
    );
    const hub = new OpencodeEventHub();
    const client = new RelayUplinkClient({
      urls: [relay.url],
      bearer: 'b',
      userId: 1,
      machineId: 'm',
      hub,
      healthProvider: async () => ({ ok: true }),
      devicesProvider: async () => ({ devices: [] }),
      dispatchBaseUrl: 'http://127.0.0.1:9',
      reconnectBaseMs: 10,
      reconnectMaxMs: 50,
    });
    cleanups.push(() => client.stop());
    client.start();
    await relay.waitFor(
      (f): f is UplinkFrame => f.ch === 'ctrl' && f.t === 'hello',
    );
    return { db, relay, client, hub };
  }

  it('replays outbox rows > sinceSeq in order, then resync-done with the last seq', async () => {
    const { db, relay } = await clientHarness();
    const all = outboxRows(db);
    expect(all.length).toBeGreaterThanOrEqual(1);
    const maxSeq = all[all.length - 1]!.seq;

    relay.send({ ch: 'ctrl', t: 'resync', sinceSeq: 0 });
    const done = await relay.waitFor(isResyncDone);
    expect(done.throughSeq).toBe(maxSeq);

    const streamed = relay.frames.filter(isRow);
    expect(streamed.map((f) => f.seq)).toEqual(all.map((r) => r.seq));
    expect(streamed[0]!.tbl).toBe(all[0]!.tbl);
    // resync-done comes after every replayed row
    expect(relay.frames.findIndex(isResyncDone)).toBeGreaterThan(
      relay.frames.map(isRow).lastIndexOf(true),
    );
  });

  it('flushOutbox emits new rows before subsequently published envelopes', async () => {
    const { db, relay, client, hub } = await clientHarness();
    relay.send({ ch: 'ctrl', t: 'resync', sinceSeq: 0 });
    await relay.waitFor(isResyncDone);
    const baselineRows = relay.frames.filter(isRow).length;

    const { AgentSessionMessagesRepository } = await import(
      '../repositories/agent_session_messages_repository'
    );
    const sessionId = (db
      .prepare('SELECT id FROM agent_sessions LIMIT 1')
      .get() as { id: string | number }).id;
    new AgentSessionMessagesRepository().upsertPart(sessionId, 'msg_ord', {
      id: 'prt_ord',
      type: 'text',
      text: 'ordered',
    });
    await client.flushOutbox();
    hub.publish({ directory: '/tmp/outbox', payload: { id: 'evt_ord', type: 'message.part.updated' } });

    await relay.waitFor(isEnv);
    const rowIndex = relay.frames.findIndex(
      (f) => isRow(f) && relay.frames.indexOf(f) >= baselineRows,
    );
    const envIndex = relay.frames.findIndex(isEnv);
    expect(rowIndex).toBeGreaterThanOrEqual(0);
    expect(rowIndex).toBeLessThan(envIndex);
  });

  it('ctrl/ack prunes the outbox through the acked seq', async () => {
    const { db, relay } = await clientHarness();
    const maxSeq = outboxRows(db)[outboxRows(db).length - 1]!.seq;
    relay.send({ ch: 'ctrl', t: 'resync', sinceSeq: 0 });
    await relay.waitFor(isResyncDone);
    relay.send({ ch: 'ctrl', t: 'ack', seq: maxSeq });
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && outboxRows(db).length > 0) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(outboxRows(db).length).toBe(0);
  });
});

describe('Track 4 — relay applier', () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  /** Capture realistic rows from a Mac db, then boot a relay and replicate. */
  async function applierHarness() {
    const { db: macDb } = await seedSessionAndMessage();
    const { AgentSessionMessagesRepository } = await import(
      '../repositories/agent_session_messages_repository'
    );
    const sessionId = (macDb
      .prepare('SELECT id FROM agent_sessions LIMIT 1')
      .get() as { id: string | number }).id;
    new AgentSessionMessagesRepository().upsertPart(sessionId, 'msg_ap', {
      id: 'prt_ap',
      type: 'text',
      text: 'apply me',
    });
    const sessionRows = macDb
      .prepare('SELECT * FROM agent_sessions')
      .all() as Record<string, unknown>[];
    const messageRows = macDb
      .prepare('SELECT * FROM agent_session_messages')
      .all() as Record<string, unknown>[];
    macDb.close();

    vi.resetModules();
    vi.stubEnv('RHYTHM_ROLE', 'relay');
    vi.stubEnv('RHYTHM_RELAY_URLS', '');
    const { setDb } = await import('../database/db');
    const { runMigrations } = await import('../database/migrations');
    const relayDb = new Database(':memory:');
    runMigrations(relayDb);
    setDb(relayDb);
    const { RelayUplinkServer } = await import(
      '../services/relay_uplink_server'
    );
    const uplink = new RelayUplinkServer({
      bearerValidator: async () => ({ userId: 1 }),
    });
    const server = http.createServer();
    server.on('upgrade', (request, socket, head) => {
      if (!uplink.handleUpgrade(request, socket, head)) socket.destroy();
    });
    server.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server.once('listening', () => r()));
    const { port } = server.address() as AddressInfo;
    cleanups.push(
      () =>
        new Promise<void>((res) => {
          uplink.stop();
          server.close(() => res());
        }),
    );

    const frames: UplinkFrame[] = [];
    const socket = new WebSocket(`ws://127.0.0.1:${port}/relay/uplink`, {
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

    const send = (frame: UplinkFrame) =>
      socket.send(serializeUplinkFrame(frame));
    const waitFor = async <T extends UplinkFrame>(
      predicate: (frame: UplinkFrame) => frame is T,
      timeoutMs = 5_000,
    ): Promise<T> => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const match = frames.find(predicate);
        if (match) return match;
        await new Promise((r) => setTimeout(r, 15));
      }
      throw new Error(
        `frame not observed; saw ${frames.map((f) => `${f.ch}/${f.t}`).join(', ')}`,
      );
    };

    send({ ch: 'ctrl', t: 'hello', userId: 1, machineId: 'm', health: { ok: 1 } });
    const resync = await waitFor(
      (f): f is CtrlResyncFrame => f.ch === 'ctrl' && f.t === 'resync',
    );
    return {
      relayDb,
      uplink,
      port,
      send,
      waitFor,
      frames,
      resync,
      sessionRows,
      messageRows,
    };
  }

  function rowFrame(
    seq: number,
    tbl: string,
    row: Record<string, unknown>,
  ): ReplRowFrame {
    return {
      ch: 'repl',
      t: 'row',
      seq,
      tbl,
      op: 'upsert',
      pk: String(row.id),
      row,
    };
  }

  it('applies rows idempotently, persists sync state, acks, and rejects foreign tables', async () => {
    const h = await applierHarness();
    expect(h.resync.sinceSeq).toBe(0);
    h.send({ ch: 'ctrl', t: 'resync-done', throughSeq: 0 });

    let seq = 0;
    for (const row of h.sessionRows) h.send(rowFrame(++seq, 'agent_sessions', row));
    for (const row of h.messageRows) {
      h.send(rowFrame(++seq, 'agent_session_messages', row));
    }
    // Whitelist: a foreign table must NOT be applied.
    h.send(rowFrame(++seq, 'users', { id: 999, name: 'evil', email: 'x@x' }));

    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const applied = h.relayDb
        .prepare('SELECT COUNT(*) AS n FROM agent_session_messages')
        .get() as { n: number };
      if (applied.n === h.messageRows.length) break;
      await new Promise((r) => setTimeout(r, 25));
    }

    const sessions = h.relayDb
      .prepare('SELECT * FROM agent_sessions')
      .all() as Record<string, unknown>[];
    expect(sessions).toEqual(h.sessionRows);
    const messages = h.relayDb
      .prepare('SELECT * FROM agent_session_messages')
      .all() as Record<string, unknown>[];
    expect(messages).toEqual(h.messageRows);
    const evil = h.relayDb
      .prepare('SELECT COUNT(*) AS n FROM users WHERE id = 999')
      .get() as { n: number };
    expect(evil.n).toBe(0);

    // Re-apply the same rows: idempotent, no duplicates, no crash.
    for (const row of h.sessionRows) h.send(rowFrame(1, 'agent_sessions', row));
    await new Promise((r) => setTimeout(r, 200));
    expect(
      (h.relayDb.prepare('SELECT COUNT(*) AS n FROM agent_sessions').get() as {
        n: number;
      }).n,
    ).toBe(h.sessionRows.length);

    // Cumulative ack arrived and sync state advanced past the last real row.
    const ack = await h.waitFor(
      (f): f is CtrlAckFrame => f.ch === 'ctrl' && f.t === 'ack',
    );
    expect(ack.seq).toBeGreaterThanOrEqual(1);
    const state = h.relayDb
      .prepare('SELECT last_applied_seq FROM relay_sync_state WHERE id = 1')
      .get() as { last_applied_seq: number } | undefined;
    expect(state?.last_applied_seq ?? 0).toBeGreaterThanOrEqual(
      h.sessionRows.length + h.messageRows.length,
    );
  });

  it('a reconnect resync offers the persisted last_applied_seq', async () => {
    const h = await applierHarness();
    h.send({ ch: 'ctrl', t: 'resync-done', throughSeq: 0 });
    h.send(rowFrame(7, 'agent_sessions', h.sessionRows[0]!));
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const state = h.relayDb
        .prepare('SELECT last_applied_seq FROM relay_sync_state WHERE id = 1')
        .get() as { last_applied_seq: number } | undefined;
      if ((state?.last_applied_seq ?? 0) >= 7) break;
      await new Promise((r) => setTimeout(r, 25));
    }

    // A second uplink (supersedes the first) must be offered sinceSeq = 7.
    const frames2: UplinkFrame[] = [];
    const socket2 = new WebSocket(`ws://127.0.0.1:${h.port}/relay/uplink`, {
      headers: { Authorization: 'Bearer any' },
    });
    socket2.on('message', (data) => {
      const frame = parseUplinkFrame(String(data));
      if (frame) frames2.push(frame);
    });
    await new Promise<void>((res, rej) => {
      socket2.on('open', () => res());
      socket2.on('error', rej);
    });
    cleanups.push(() => socket2.terminate());
    socket2.send(
      serializeUplinkFrame({
        ch: 'ctrl',
        t: 'hello',
        userId: 1,
        machineId: 'm2',
        health: { ok: 1 },
      }),
    );
    const deadline2 = Date.now() + 5_000;
    let resync2: CtrlResyncFrame | undefined;
    while (Date.now() < deadline2 && !resync2) {
      resync2 = frames2.find(
        (f): f is CtrlResyncFrame => f.ch === 'ctrl' && f.t === 'resync',
      );
      await new Promise((r) => setTimeout(r, 15));
    }
    expect(resync2?.sinceSeq).toBe(7);
  });
});

describe('Track 4 — resync notification for phone-stream refresh', () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('fires onResynced after resync-done so the router can kick phone SSE', async () => {
    vi.resetModules();
    vi.stubEnv('RHYTHM_ROLE', 'relay');
    const { setDb } = await import('../database/db');
    const { runMigrations } = await import('../database/migrations');
    const db = new Database(':memory:');
    runMigrations(db);
    setDb(db);
    const { RelayUplinkServer } = await import(
      '../services/relay_uplink_server'
    );
    const uplink = new RelayUplinkServer({
      bearerValidator: async () => ({ userId: 1 }),
    });
    const server = http.createServer();
    server.on('upgrade', (request, socket, head) => {
      if (!uplink.handleUpgrade(request, socket, head)) socket.destroy();
    });
    server.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server.once('listening', () => r()));
    const { port } = server.address() as AddressInfo;
    cleanups.push(
      () =>
        new Promise<void>((res) => {
          uplink.stop();
          server.close(() => res());
        }),
    );

    let resyncedCalls = 0;
    uplink.onResynced(() => {
      resyncedCalls += 1;
    });

    const socket = new WebSocket(`ws://127.0.0.1:${port}/relay/uplink`, {
      headers: { Authorization: 'Bearer any' },
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
        userId: 1,
        machineId: 'm',
        health: { ok: 1 },
      }),
    );
    socket.send(
      serializeUplinkFrame({ ch: 'ctrl', t: 'resync-done', throughSeq: 0 }),
    );
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && resyncedCalls === 0) {
      await new Promise((r) => setTimeout(r, 15));
    }
    expect(resyncedCalls).toBe(1);
    db.close();
  });
});

describe('Track 4 — bridge source contract', () => {
  it('persists, flushes the outbox, then publishes to the hub — in that order', () => {
    const source = readFileSync(
      path.join(__dirname, '../services/opencode_stream_bridge.ts'),
      'utf8',
    );
    const relayEventIndex = source.indexOf('this._relayEvent(');
    const flushIndex = source.indexOf('flushOutbox');
    const publishIndex = source.indexOf('this._publishToHub(');
    expect(relayEventIndex).toBeGreaterThan(-1);
    expect(flushIndex).toBeGreaterThan(-1);
    expect(publishIndex).toBeGreaterThan(-1);
    expect(relayEventIndex).toBeLessThan(flushIndex);
    expect(flushIndex).toBeLessThan(publishIndex);
  });
});
