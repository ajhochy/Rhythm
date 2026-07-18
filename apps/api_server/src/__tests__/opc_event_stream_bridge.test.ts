/**
 * EVENT-STREAM BRIDGE — the #685 path, end-to-end at the SDK boundary.
 *
 * The #685 false-green: subscribeToEvents treated `client.event.subscribe()` as
 * a hey-api `{ data, error }` envelope and returned `raw.data`. The real SDK
 * returns a ServerSentEventsResult = `{ stream }` directly, so the wrapper
 * always saw `undefined` → "No event stream available" → the agent transcript
 * never streamed. The old test stubbed the bridge/service, so it never noticed.
 *
 * This test wires the REAL pieces together and fakes ONLY the SDK client, with
 * the REAL SDK shape (`event.subscribe` -> `{ stream: AsyncIterable<Event> }`):
 *
 *   streamBridge.streamSession (REAL)
 *     -> opencodeClient.subscribeToEvents (REAL service, consumes { stream })
 *        -> fakeClient.event.subscribe() -> { stream }   (REAL SDK shape)
 *     -> bridge._relayEvent -> ws_gateway.broadcast (spied)
 *
 * If the service regresses to reading `raw.data`, subscribeToEvents returns null,
 * the bridge logs "No event stream available", and ZERO broadcasts happen — this
 * test goes red. (Verified by reverting the fix; see the PR notes.)
 *
 * It also asserts the session/directory filter: an event for session A maps to
 * local A (never B), and events for an explicitly stopped session are dropped.
 *
 * Run with:
 *   cd apps/api_server && npx vitest run src/__tests__/opc_event_stream_bridge.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { OpencodeClientService } from '../services/opencode_client_service';

// ---------------------------------------------------------------------------
// Hoisted shared state for the mocks.
// ---------------------------------------------------------------------------
const {
  broadcasts,
  sessionUpdated,
  service,
  sessionMap,
  subscribeSpy,
} = vi.hoisted(() => {
  return {
    broadcasts: [] as Array<Record<string, unknown>>,
    sessionUpdated: [] as unknown[],
    // Lazily constructed in beforeEach to keep the import order clean.
    service: { ref: null as unknown as OpencodeClientService },
    sessionMap: new Map<string, string>(),
    subscribeSpy: vi.fn(),
  };
});

// ws_gateway is the assertion surface — capture every broadcast frame.
vi.mock('../services/ws_gateway', () => ({
  broadcast: (msg: Record<string, unknown>) => {
    broadcasts.push(msg);
  },
  broadcastSessionUpdated: (s: unknown) => {
    sessionUpdated.push(s);
  },
  broadcastSessionRemoved: vi.fn(),
}));

// opencode_engine exports the REAL service instance (with a fake SDK client
// injected below) and a REAL session map — NOT a mock of the service methods.
vi.mock('../services/opencode_engine', () => ({
  get opencodeClient() {
    return service.ref;
  },
  opencodeSessionMap: sessionMap,
}));

// Import the bridge AFTER the mocks are registered. It is a singleton that
// closes over the mocked engine + gateway.
import { streamBridge } from '../services/opencode_stream_bridge';
import type { Event } from '@opencode-ai/sdk';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an async iterable from a fixed list of events (real SSE stream shape). */
function streamOf(events: Event[]): { stream: AsyncIterable<Event> } {
  async function* gen() {
    for (const e of events) {
      yield e;
    }
  }
  return { stream: gen() };
}

/** Inject a fake SDK client into a real service and mark it ready. */
function injectClient(svc: OpencodeClientService, client: unknown) {
  (svc as unknown as Record<string, unknown>)['status'] = 'ready';
  (svc as unknown as Record<string, unknown>)['client'] = client;
}

/** Let the fire-and-forget _listen loop drain the async generator. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

const CWD = '/Users/ajhochhalter/work';

describe('event-stream bridge: real SSE { stream } reaches the WS gateway', () => {
  let repo: AgentSessionsRepository;
  let db: Database.Database;

  beforeEach(() => {
    // OCU-29 (#1070) — this suite asserts the LEGACY per-directory subscribe
    // path (subscribeSpy checks the ?directory= filter). Pin the fallback flag
    // so streamSession uses per-directory /event, not the new /global/event.
    process.env.RHYTHM_SSE_GLOBAL = '0';
    broadcasts.length = 0;
    sessionUpdated.length = 0;
    sessionMap.clear();
    subscribeSpy.mockReset();
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    repo = new AgentSessionsRepository();
    service.ref = new OpencodeClientService();
    // Reset bridge state between tests (clears stoppedSessions / pendingText /
    // any directory subscription left from a prior test).
    streamBridge.dispose();
  });

  afterEach(() => {
    streamBridge.dispose();
    db.close();
    delete process.env.RHYTHM_SSE_GLOBAL;
  });

  it('subscribes with the directory filter and bridges a session A delta to the gateway as id=localA', async () => {
    const sessionA = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: CWD,
      name: 'A',
    });
    sessionMap.set(sessionA.id, 'sdkA');

    const fakeClient = {
      event: {
        subscribe: (opts?: { query?: { directory?: string } }) => {
          subscribeSpy(opts);
          return Promise.resolve(
            streamOf([
              {
                type: 'message.part.delta',
                properties: {
                  sessionID: 'sdkA',
                  messageID: 'mA',
                  partID: 'pA',
                  field: 'text',
                  delta: 'hello from A',
                },
              } as unknown as Event,
            ]),
          );
        },
      },
    };
    injectClient(service.ref, fakeClient);

    await streamBridge.streamSession(sessionA.id, 'sdkA', CWD);
    await flush();

    // Directory filter: subscribe was called with the session's cwd.
    expect(subscribeSpy).toHaveBeenCalledTimes(1);
    expect(subscribeSpy).toHaveBeenCalledWith({ query: { directory: CWD } });

    // The delta reached the gateway, keyed by the LOCAL session id.
    const deltaFrame = broadcasts.find((b) => b.type === 'message.part.delta');
    expect(deltaFrame, 'no message.part.delta was broadcast — the stream was dropped').toBeDefined();
    expect(deltaFrame!.id).toBe(sessionA.id);
    expect(deltaFrame!.delta).toBe('hello from A');
    // Never keyed by the raw SDK id.
    expect(deltaFrame!.id).not.toBe('sdkA');
  });

  it('routes each event to its own local session — A’s events never leak to B', async () => {
    const sessionA = repo.insert({
      agentKind: 'claude-code', taskId: null, taskTitle: null, cwd: CWD, name: 'A',
    });
    const sessionB = repo.insert({
      agentKind: 'claude-code', taskId: null, taskTitle: null, cwd: CWD, name: 'B',
    });
    sessionMap.set(sessionA.id, 'sdkA');
    sessionMap.set(sessionB.id, 'sdkB');

    const fakeClient = {
      event: {
        subscribe: () =>
          Promise.resolve(
            streamOf([
              {
                type: 'message.part.delta',
                properties: { sessionID: 'sdkA', messageID: 'mA', partID: 'pA', field: 'text', delta: 'A-text' },
              } as unknown as Event,
              {
                type: 'message.part.delta',
                properties: { sessionID: 'sdkB', messageID: 'mB', partID: 'pB', field: 'text', delta: 'B-text' },
              } as unknown as Event,
            ]),
          ),
      },
    };
    injectClient(service.ref, fakeClient);

    await streamBridge.streamSession(sessionA.id, 'sdkA', CWD);
    await flush();

    const deltas = broadcasts.filter((b) => b.type === 'message.part.delta');
    const aFrame = deltas.find((d) => d.delta === 'A-text');
    const bFrame = deltas.find((d) => d.delta === 'B-text');
    expect(aFrame!.id).toBe(sessionA.id);
    expect(bFrame!.id).toBe(sessionB.id);
    // No cross-contamination: A's text is never broadcast under B's id.
    expect(deltas.some((d) => d.id === sessionB.id && d.delta === 'A-text')).toBe(false);
    expect(deltas.some((d) => d.id === sessionA.id && d.delta === 'B-text')).toBe(false);
  });

  it('drops events for a session that was explicitly stopped', async () => {
    const live = repo.insert({
      agentKind: 'claude-code', taskId: null, taskTitle: null, cwd: CWD, name: 'live',
    });
    const stopped = repo.insert({
      agentKind: 'claude-code', taskId: null, taskTitle: null, cwd: CWD, name: 'stopped',
    });
    sessionMap.set(live.id, 'sdkLive');
    sessionMap.set(stopped.id, 'sdkStopped');

    const fakeClient = {
      event: {
        subscribe: () =>
          Promise.resolve(
            streamOf([
              {
                type: 'message.part.delta',
                properties: { sessionID: 'sdkStopped', messageID: 'mS', partID: 'pS', field: 'text', delta: 'should be dropped' },
              } as unknown as Event,
              {
                type: 'message.part.delta',
                properties: { sessionID: 'sdkLive', messageID: 'mL', partID: 'pL', field: 'text', delta: 'should survive' },
              } as unknown as Event,
            ]),
          ),
      },
    };
    injectClient(service.ref, fakeClient);

    // Mark the stopped session BEFORE the events are drained.
    streamBridge.stopStream(stopped.id);
    await streamBridge.streamSession(live.id, 'sdkLive', CWD);
    await flush();

    const deltas = broadcasts.filter((b) => b.type === 'message.part.delta');
    expect(deltas.some((d) => d.delta === 'should survive' && d.id === live.id)).toBe(true);
    // The stopped session produced no delta frame.
    expect(deltas.some((d) => d.id === stopped.id)).toBe(false);
    expect(deltas.some((d) => d.delta === 'should be dropped')).toBe(false);
  });

  it('finalizes the assistant turn on session.idle (delta accumulated -> transcript.append)', async () => {
    const session = repo.insert({
      agentKind: 'claude-code', taskId: null, taskTitle: null, cwd: CWD, name: 'turn',
    });
    sessionMap.set(session.id, 'sdkTurn');

    const fakeClient = {
      event: {
        subscribe: () =>
          Promise.resolve(
            streamOf([
              {
                type: 'message.part.delta',
                properties: { sessionID: 'sdkTurn', messageID: 'm1', partID: 'p1', field: 'text', delta: 'final answer' },
              } as unknown as Event,
              { type: 'session.idle', properties: { sessionID: 'sdkTurn' } } as unknown as Event,
            ]),
          ),
      },
    };
    injectClient(service.ref, fakeClient);

    await streamBridge.streamSession(session.id, 'sdkTurn', CWD);
    await flush();

    const append = broadcasts.find((b) => b.type === 'transcript.append');
    expect(append, 'session.idle did not finalize the turn into transcript.append').toBeDefined();
    expect(append!.id).toBe(session.id);
    expect(append!.text).toBe('final answer');
    // A working:false status was also broadcast on idle.
    expect(
      broadcasts.some((b) => b.type === 'session.status' && b.id === session.id && b.working === false),
    ).toBe(true);
  });
});
