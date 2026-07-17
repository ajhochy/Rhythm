/**
 * OPC-#710 — Instant new session (one-click create + auto-title)
 *
 * c2: bridge session.updated handler -> updateName + broadcastSessionUpdated
 * c4(server): createSession accepts empty name
 *
 * Wires the REAL bridge._relayEvent through a real DB + real session-map.
 * The ONLY fake is the SDK client shape (real SDK shape: EventSessionUpdated).
 *
 * Run with:
 *   cd apps/api_server && npx vitest run src/__tests__/opc_instant_new_session.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { OpencodeClientService } from '../services/opencode_client_service';

// ---------------------------------------------------------------------------
// Hoisted shared state
// ---------------------------------------------------------------------------
const {
  broadcasts,
  sessionUpdatedCalls,
  service,
  sessionMap,
} = vi.hoisted(() => {
  return {
    broadcasts: [] as Array<Record<string, unknown>>,
    sessionUpdatedCalls: [] as unknown[],
    service: { ref: null as unknown as OpencodeClientService },
    sessionMap: new Map<string, string>(),
  };
});

vi.mock('../services/ws_gateway', () => ({
  broadcast: (msg: Record<string, unknown>) => {
    broadcasts.push(msg);
  },
  broadcastSessionUpdated: (s: unknown) => {
    sessionUpdatedCalls.push(s);
  },
  broadcastSessionRemoved: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  get opencodeClient() {
    return service.ref;
  },
  opencodeSessionMap: sessionMap,
}));

import { streamBridge } from '../services/opencode_stream_bridge';
import type { Event } from '@opencode-ai/sdk';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function streamOf(events: Event[]): { stream: AsyncIterable<Event> } {
  async function* gen() {
    for (const e of events) {
      yield e;
    }
  }
  return { stream: gen() };
}

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

const CWD = '/Users/test/project';

describe('OPC-#710 — instant new session / auto-title', () => {
  let repo: AgentSessionsRepository;
  let db: Database.Database;

  beforeEach(() => {
    // OCU-29 (#1070) — this suite drives the REAL per-directory event.subscribe
    // path with an injected fake SDK client; pin the fallback flag so
    // streamSession uses /event (not the new consolidated /global/event).
    process.env.RHYTHM_SSE_GLOBAL = '0';
    broadcasts.length = 0;
    sessionUpdatedCalls.length = 0;
    sessionMap.clear();
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    repo = new AgentSessionsRepository();
    service.ref = new OpencodeClientService();
    streamBridge.dispose();
  });

  afterEach(() => {
    streamBridge.dispose();
    db.close();
    delete process.env.RHYTHM_SSE_GLOBAL;
  });

  // c2: bridge session.updated -> updateName + broadcast
  it('c2a: session.updated with a non-empty title persists the name and broadcasts SessionUpdatedMessage', async () => {
    // Create a session with an empty name (as instant-create would produce).
    const session = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: CWD,
      name: '',
    });
    sessionMap.set(session.id, 'sdkSession1');

    const fakeClient = {
      event: {
        subscribe: () =>
          Promise.resolve(
            streamOf([
              {
                type: 'session.updated',
                properties: {
                  info: {
                    id: 'sdkSession1',
                    projectID: 'proj1',
                    directory: CWD,
                    title: 'My Auto Title',
                    version: '1',
                    time: { created: Date.now(), updated: Date.now() },
                  },
                },
              } as unknown as Event,
            ]),
          ),
      },
    };
    injectClient(service.ref, fakeClient);

    await streamBridge.streamSession(session.id, 'sdkSession1', CWD);
    await flush();

    // The session name should be updated in the DB.
    const updated = repo.findById(session.id);
    expect(updated?.name, 'name was not updated in the DB').toBe('My Auto Title');

    // broadcastSessionUpdated should have been called with the updated session.
    expect(sessionUpdatedCalls.length, 'broadcastSessionUpdated not called').toBeGreaterThan(0);
    const broadcastedSession = sessionUpdatedCalls[sessionUpdatedCalls.length - 1] as { name: string; id: string };
    expect(broadcastedSession.name).toBe('My Auto Title');
    expect(broadcastedSession.id).toBe(session.id);
  });

  it('c2b: session.updated with empty title does NOT update the name (preserves existing)', async () => {
    const session = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: CWD,
      name: 'Existing Name',
    });
    sessionMap.set(session.id, 'sdkSession2');

    const fakeClient = {
      event: {
        subscribe: () =>
          Promise.resolve(
            streamOf([
              {
                type: 'session.updated',
                properties: {
                  info: {
                    id: 'sdkSession2',
                    projectID: 'proj1',
                    directory: CWD,
                    title: '',
                    version: '1',
                    time: { created: Date.now(), updated: Date.now() },
                  },
                },
              } as unknown as Event,
            ]),
          ),
      },
    };
    injectClient(service.ref, fakeClient);

    await streamBridge.streamSession(session.id, 'sdkSession2', CWD);
    await flush();

    // The session name should be unchanged when title is empty.
    const notUpdated = repo.findById(session.id);
    expect(notUpdated?.name).toBe('Existing Name');
  });

  // c4(server): createSession accepts empty name
  it('c4(server): repo.insert accepts empty name without error', () => {
    const session = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: CWD,
      name: '',
    });
    expect(session.id).toBeTruthy();
    expect(session.name).toBe('');
  });
});
