/**
 * End-to-end test for the Agents chat data path.
 *
 * Covers both directions of the round-trip:
 *
 *   Chat -> Server : a WS client sends `session.input` and we assert that
 *                    `opencodeClient.promptAsync` was invoked with the
 *                    correct sessionID, text, model, and cwd.
 *
 *   Server -> Chat : we push SDK events (`message.updated`,
 *                    `message.part.updated`, `message.part.delta`,
 *                    `session.idle`) into the mocked event stream and
 *                    assert that the WS client receives the corresponding
 *                    frames in order, carrying messageId and partId intact.
 *
 * This is the contract Opencode Desktop's renderer expects (see
 * /tmp/opencode-ref/packages/app/src/context/global-sync/event-reducer.ts).
 * If this test passes the Flutter chat thread WILL render assistant
 * turns; if it fails the UI cannot work no matter what the renderer does.
 */
import { vi, describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

// ---------------------------------------------------------------------------
// Hoisted shared state used inside vi.mock factories.
// ---------------------------------------------------------------------------
const { sessionMap, sdkEventQueue, sdkStream, promptAsyncSpy } = vi.hoisted(
  () => {
    const sessionMap = new Map<string, string>();
    const sdkEventQueue = {
      queue: [] as Array<Record<string, unknown>>,
      waiters: [] as Array<
        (v: IteratorResult<Record<string, unknown>>) => void
      >,
      closed: false,
      push(evt: Record<string, unknown>): void {
        if (this.closed) return;
        if (this.waiters.length > 0) {
          const w = this.waiters.shift()!;
          w({ value: evt, done: false });
        } else {
          this.queue.push(evt);
        }
      },
      end(): void {
        this.closed = true;
        while (this.waiters.length > 0) {
          this.waiters.shift()!({ value: undefined as never, done: true });
        }
      },
      reset(): void {
        this.queue.length = 0;
        this.waiters.length = 0;
        this.closed = false;
      },
    };
    const sdkStream: AsyncIterable<Record<string, unknown>> = {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<Record<string, unknown>>> {
            if (sdkEventQueue.queue.length > 0) {
              return Promise.resolve({
                value: sdkEventQueue.queue.shift()!,
                done: false,
              });
            }
            if (sdkEventQueue.closed) {
              return Promise.resolve({
                value: undefined as never,
                done: true,
              });
            }
            return new Promise((resolve) =>
              sdkEventQueue.waiters.push(resolve),
            );
          },
          return(): Promise<IteratorResult<Record<string, unknown>>> {
            return Promise.resolve({ value: undefined as never, done: true });
          },
        };
      },
    };
    return {
      sessionMap,
      sdkEventQueue,
      sdkStream,
      promptAsyncSpy: vi.fn().mockResolvedValue(true),
    };
  },
);

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    listProviders: vi.fn().mockResolvedValue(['openrouter']),
    listAuthedProviders: vi.fn().mockResolvedValue(['openrouter']),
    createSession: vi.fn().mockResolvedValue({ id: 'sdk-session-1' }),
    promptAsync: (...args: unknown[]) =>
      promptAsyncSpy(...args) as Promise<boolean>,
    subscribeToEvents: vi.fn().mockResolvedValue({ stream: sdkStream }),
  },
  opencodeSessionMap: sessionMap,
}));

import { streamBridge } from '../services/opencode_stream_bridge';
import { attachWsGateway } from '../services/ws_gateway';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

let cwdCounter = 0;
function uniqueCwd(): string {
  cwdCounter += 1;
  return `/tmp/rhythm-e2e-${cwdCounter}`;
}

interface Ctx {
  wsUrl: string;
  localSessionId: string;
  cwd: string;
}

// One HTTP server + WS gateway shared across all tests. ws_gateway's
// module-level `attached` guard prevents binding twice; sharing keeps
// the tests honest and removes per-test teardown races.
let sharedServer: http.Server | undefined;
let sharedWsUrl: string;

async function setupSuite(): Promise<void> {
  sharedServer = http.createServer();
  attachWsGateway(sharedServer);
  await new Promise<void>((resolve) => sharedServer!.listen(0, resolve));
  const addr = sharedServer!.address() as AddressInfo;
  sharedWsUrl = `ws://127.0.0.1:${addr.port}/ws/agents`;
}

async function teardownSuite(): Promise<void> {
  if (!sharedServer) return;
  sharedServer.closeAllConnections?.();
  await new Promise<void>((resolve) => sharedServer!.close(() => resolve()));
}

async function setupCtx(): Promise<Ctx> {
  sdkEventQueue.reset();
  sessionMap.clear();
  promptAsyncSpy.mockClear();
  promptAsyncSpy.mockResolvedValue(true);

  setDb(makeDb());
  const repo = new AgentSessionsRepository();
  const cwd = uniqueCwd();
  const seeded = repo.insert({
    agentKind: 'claude-code',
    taskId: null,
    taskTitle: null,
    cwd,
    name: 'e2e',
  });
  sessionMap.set(seeded.id, 'sdk-session-1');

  await streamBridge.streamSession(seeded.id, 'sdk-session-1', cwd);

  return { wsUrl: sharedWsUrl, localSessionId: seeded.id, cwd };
}

interface Client {
  ws: WebSocket;
  frames: Record<string, unknown>[];
}

function openClient(url: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const frames: Record<string, unknown>[] = [];
    // Attach the message listener BEFORE 'open' so we don't drop the
    // initial sessions.list snapshot the server sends synchronously
    // after handshake — Node's EventEmitter does not buffer unhandled
    // events.
    ws.on('message', (raw) => {
      try {
        frames.push(JSON.parse(String(raw)));
      } catch {
        /* ignore */
      }
    });
    ws.once('open', () => resolve({ ws, frames }));
    ws.once('error', reject);
  });
}

async function waitFor<T>(
  predicate: () => T | undefined,
  timeoutMs = 2000,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = predicate();
    if (v !== undefined && v !== null && v !== false) return v as T;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

describe('Agents WS end-to-end chat data flow', () => {
  let ctx: Ctx;

  // Vitest doesn't have a built-in beforeAll-async on Suite ordering
  // guarantee with mocks, but a one-shot lazy init in beforeEach is
  // safe and idempotent because attachWsGateway is itself idempotent.
  beforeEach(async () => {
    if (!sharedServer) await setupSuite();
    ctx = await setupCtx();
  });

  afterEach(async () => {
    // No per-test server teardown — the suite owns it.
    void ctx;
  });

  afterAll(async () => {
    await teardownSuite();
  });

  // --- Direction 1: Chat -> Server ----------------------------------------
  it('forwards a session.input WS frame to opencodeClient.promptAsync', async () => {
    const { ws, frames } = await openClient(ctx.wsUrl);

    // Initial sessions.list snapshot should land.
    await waitFor(() => frames.find((f) => f.type === 'sessions.list'));

    ws.send(
      JSON.stringify({
        v: 1,
        type: 'session.input',
        id: ctx.localSessionId,
        data: 'hello from the chat box',
      }),
    );

    await waitFor(() => promptAsyncSpy.mock.calls.length > 0 || undefined);
    expect(promptAsyncSpy).toHaveBeenCalledTimes(1);
    const [opencodeId, text, model, cwd] = promptAsyncSpy.mock.calls[0];
    expect(opencodeId).toBe('sdk-session-1');
    expect(text).toBe('hello from the chat box');
    expect(cwd).toBe(ctx.cwd);
    expect(model).toMatchObject({ providerID: 'openrouter' });
    ws.close();
  });

  // --- Direction 2: Server -> Chat ----------------------------------------
  it('forwards SDK message events to the WS client with messageId + partId intact', async () => {
    const { ws, frames } = await openClient(ctx.wsUrl);
    await waitFor(() => frames.find((f) => f.type === 'sessions.list'));

    sdkEventQueue.push({
      type: 'message.updated',
      properties: {
        info: {
          id: 'msg-1',
          sessionID: 'sdk-session-1',
          role: 'assistant',
          time: { created: Date.now() },
        },
      },
    });
    sdkEventQueue.push({
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'part-1',
          messageID: 'msg-1',
          sessionID: 'sdk-session-1',
          type: 'text',
          text: '',
        },
      },
    });
    sdkEventQueue.push({
      type: 'message.part.delta',
      properties: {
        messageID: 'msg-1',
        partID: 'part-1',
        field: 'text',
        delta: 'Hello, ',
        part: { sessionID: 'sdk-session-1' },
      },
    });
    sdkEventQueue.push({
      type: 'message.part.delta',
      properties: {
        messageID: 'msg-1',
        partID: 'part-1',
        field: 'text',
        delta: 'world!',
        part: { sessionID: 'sdk-session-1' },
      },
    });
    sdkEventQueue.push({
      type: 'session.idle',
      properties: { sessionID: 'sdk-session-1' },
    });

    await waitFor(
      () =>
        frames.find(
          (f) =>
            f.type === 'session.status' &&
            (f as { working?: boolean }).working === false,
        ),
    );

    const byType = (t: string) => frames.filter((f) => f.type === t);

    const updates = byType('message.updated');
    expect(updates.length).toBeGreaterThanOrEqual(1);
    expect((updates[0].info as Record<string, unknown>).id).toBe('msg-1');
    expect((updates[0].info as Record<string, unknown>).role).toBe(
      'assistant',
    );
    expect(updates[0].id).toBe(ctx.localSessionId);

    const partsUpdated = byType('message.part.updated');
    expect(partsUpdated.length).toBeGreaterThanOrEqual(1);
    expect((partsUpdated[0].part as Record<string, unknown>).id).toBe(
      'part-1',
    );
    expect((partsUpdated[0].part as Record<string, unknown>).messageID).toBe(
      'msg-1',
    );

    const deltas = byType('message.part.delta');
    expect(deltas.length).toBe(2);
    expect(deltas[0].messageId).toBe('msg-1');
    expect(deltas[0].partId).toBe('part-1');
    expect(deltas[0].delta).toBe('Hello, ');
    expect(deltas[1].delta).toBe('world!');
    expect(deltas[0].id).toBe(ctx.localSessionId);

    const idle = byType('session.status').filter(
      (f) => (f as { working?: boolean }).working === false,
    );
    expect(idle.length).toBeGreaterThanOrEqual(1);
    ws.close();
  });

  // --- Full round-trip ----------------------------------------------------
  it('round-trip: client prompt -> server prompt call -> SDK events -> client frames', async () => {
    const { ws, frames } = await openClient(ctx.wsUrl);
    await waitFor(() => frames.find((f) => f.type === 'sessions.list'));

    ws.send(
      JSON.stringify({
        v: 1,
        type: 'session.input',
        id: ctx.localSessionId,
        data: 'what is 2+2?',
      }),
    );

    await waitFor(() => promptAsyncSpy.mock.calls.length > 0 || undefined);
    expect(promptAsyncSpy).toHaveBeenCalled();

    sdkEventQueue.push({
      type: 'message.updated',
      properties: {
        info: {
          id: 'msg-rt',
          sessionID: 'sdk-session-1',
          role: 'assistant',
        },
      },
    });
    sdkEventQueue.push({
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'part-rt',
          messageID: 'msg-rt',
          sessionID: 'sdk-session-1',
          type: 'text',
          text: '',
        },
      },
    });
    sdkEventQueue.push({
      type: 'message.part.delta',
      properties: {
        messageID: 'msg-rt',
        partID: 'part-rt',
        field: 'text',
        delta: '2+2 = 4',
        part: { sessionID: 'sdk-session-1' },
      },
    });
    sdkEventQueue.push({
      type: 'session.idle',
      properties: { sessionID: 'sdk-session-1' },
    });

    await waitFor(
      () =>
        frames.find(
          (f) =>
            f.type === 'session.status' &&
            (f as { working?: boolean }).working === false,
        ),
    );

    const deltas = frames.filter((f) => f.type === 'message.part.delta');
    expect(deltas.length).toBe(1);
    expect(deltas[0].delta).toBe('2+2 = 4');
    expect(deltas[0].messageId).toBe('msg-rt');
    expect(deltas[0].partId).toBe('part-rt');

    const partUpdated = frames.filter(
      (f) => f.type === 'message.part.updated',
    );
    expect(partUpdated.length).toBeGreaterThanOrEqual(1);
    ws.close();
  });
});
