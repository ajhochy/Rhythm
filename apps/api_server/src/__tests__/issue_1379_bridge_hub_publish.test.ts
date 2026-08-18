/**
 * #1379 Phase 2 — the bridge is the fan-out producer.
 *
 * Driven through the real `OpencodeStreamBridge` against a real SQLite mirror,
 * so these assert the two properties the mobile transport depends on:
 *   1. every `/global/event` frame is re-published as its original
 *      `{directory, payload}` envelope (the mobile project filter is fail-closed
 *      on `directory`, so an unwrapped frame would be silently dropped), and
 *   2. the frame is persisted to the mirror BEFORE it is published, so a phone
 *      never renders a part the transcript endpoint would not yet return.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import {
  opencodeEventHub,
  type GlobalEventEnvelope,
} from '../services/opencode_event_hub';

const { sessionMap, subscribeGlobalSpy } = vi.hoisted(() => ({
  sessionMap: new Map<string, string>(),
  subscribeGlobalSpy: vi.fn(),
}));

vi.mock('../services/ws_gateway', () => ({
  broadcast: vi.fn(),
  broadcastSessionUpdated: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    subscribeToGlobalEvents: (...a: unknown[]) => subscribeGlobalSpy(...a),
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    getSessionStatuses: vi.fn().mockResolvedValue({}),
    listQuestions: vi.fn().mockResolvedValue([]),
    listPermissions: vi.fn().mockResolvedValue([]),
  },
  opencodeSessionMap: sessionMap,
}));

import { OpencodeStreamBridge } from '../services/opencode_stream_bridge';

async function* framesOf(frames: unknown[]) {
  for (const f of frames) yield f as never;
}

describe('#1379 Phase 2 — bridge publishes to the mobile fan-out hub', () => {
  let repo: AgentSessionsRepository;

  beforeEach(() => {
    process.env.RHYTHM_SSE_GLOBAL = '1';
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    sessionMap.clear();
    subscribeGlobalSpy.mockReset();
    opencodeEventHub.setLive(false);
    repo = new AgentSessionsRepository();
  });

  afterEach(() => {
    delete process.env.RHYTHM_SSE_GLOBAL;
    opencodeEventHub.setLive(false);
  });

  it('re-publishes each frame as its original directory-wrapped envelope', async () => {
    const session = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/repo-a',
      name: 'A',
    } as never);
    repo.setSdkSessionId(session.id, 'ses_a');

    subscribeGlobalSpy.mockResolvedValueOnce({
      abort: () => {},
      stream: framesOf([
        {
          type: 'session.status',
          __directory: '/repo-a',
          properties: { sessionID: 'ses_a', status: { type: 'busy' } },
        },
      ]),
    });
    subscribeGlobalSpy.mockResolvedValue({
      abort: () => {},
      stream: framesOf([]),
    });

    const subscription = opencodeEventHub.subscribe(16);
    const received: GlobalEventEnvelope[] = [];
    const draining = (async () => {
      for await (const envelope of subscription.stream) received.push(envelope);
    })();

    const bridge = new OpencodeStreamBridge();
    await bridge.ensureGlobalStream();
    await new Promise((r) => setTimeout(r, 20));
    subscription.close();
    await draining;

    expect(received).toHaveLength(1);
    expect(received[0].directory).toBe('/repo-a');
    const payload = received[0].payload as Record<string, unknown>;
    expect(payload.type).toBe('session.status');
    // `__directory` is the transport's own annotation and must not leak into
    // the payload the phone parses as an engine event.
    expect(payload).not.toHaveProperty('__directory');
  });

  it('marks the hub live so mobile can stop dialing the engine', async () => {
    subscribeGlobalSpy.mockResolvedValue({
      abort: () => {},
      stream: framesOf([]),
    });
    expect(opencodeEventHub.isLive()).toBe(false);
    const bridge = new OpencodeStreamBridge();
    await bridge.ensureGlobalStream();
    expect(opencodeEventHub.isLive()).toBe(true);
  });

  it('leaves the hub unavailable when the engine cannot be subscribed', async () => {
    subscribeGlobalSpy.mockResolvedValue(null);
    const bridge = new OpencodeStreamBridge();
    await bridge.ensureGlobalStream();
    expect(opencodeEventHub.isLive()).toBe(false);
  });

  it('persists a message part before the phone can see it', async () => {
    const session = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/repo-a',
      name: 'A',
    } as never);
    repo.setSdkSessionId(session.id, 'ses_a');
    sessionMap.set(session.id, 'ses_a');

    subscribeGlobalSpy.mockResolvedValueOnce({
      abort: () => {},
      stream: framesOf([
        {
          type: 'message.part.updated',
          __directory: '/repo-a',
          properties: {
            part: {
              id: 'prt_1',
              messageID: 'msg_1',
              sessionID: 'ses_a',
              type: 'text',
              text: 'persisted first',
            },
          },
        },
      ]),
    });
    subscribeGlobalSpy.mockResolvedValue({
      abort: () => {},
      stream: framesOf([]),
    });

    const messages = new AgentSessionMessagesRepository();
    const mirroredAtPublish: boolean[] = [];
    const subscription = opencodeEventHub.subscribe(16);
    const draining = (async () => {
      for await (const _envelope of subscription.stream) {
        void _envelope;
        // Read the mirror at the exact moment the frame is fanned out.
        mirroredAtPublish.push(
          JSON.stringify(messages.listBySession(session.id)).includes(
            'persisted first',
          ),
        );
      }
    })();

    const bridge = new OpencodeStreamBridge();
    await bridge.ensureGlobalStream();
    await new Promise((r) => setTimeout(r, 20));
    subscription.close();
    await draining;

    expect(mirroredAtPublish).toEqual([true]);
  });
});
