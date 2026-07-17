import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

// OCU-29 (#1070) — consolidated /global/event stream + heartbeat watchdog.

const { broadcastSpy, sessionMap, subscribeGlobalSpy } = vi.hoisted(() => ({
  broadcastSpy: vi.fn(),
  sessionMap: new Map<string, string>(),
  subscribeGlobalSpy: vi.fn(),
}));

vi.mock('../services/ws_gateway', () => ({
  broadcast: (m: unknown) => broadcastSpy(m),
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

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

/** A finite async iterable that yields the given frames then ends. */
async function* framesOf(frames: unknown[]) {
  for (const f of frames) yield f as never;
}

describe('OCU-29 (#1070) global SSE consolidation', () => {
  let repo: AgentSessionsRepository;

  beforeEach(() => {
    process.env.RHYTHM_SSE_GLOBAL = '1';
    setDb(makeDb());
    sessionMap.clear();
    broadcastSpy.mockClear();
    subscribeGlobalSpy.mockReset();
    repo = new AgentSessionsRepository();
  });
  afterEach(() => {
    delete process.env.RHYTHM_SSE_GLOBAL;
    vi.useRealTimers();
  });

  it('routes multi-directory events from ONE global stream to the right sessions', async () => {
    const a = repo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/repo-a', name: 'A' } as never);
    const b = repo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/repo-b', name: 'B' } as never);
    repo.setSdkSessionId(a.id, 'ses_a');
    repo.setSdkSessionId(b.id, 'ses_b');

    // The global stream carries unwrapped events (with __directory) for BOTH dirs.
    // First subscribe yields the frames; the self-heal resubscribe (fired when a
    // finite stream ends) gets an empty stream so it doesn't replay.
    subscribeGlobalSpy.mockResolvedValueOnce({
      abort: () => {},
      stream: framesOf([
        { type: 'session.status', __directory: '/repo-a', properties: { sessionID: 'ses_a', status: { type: 'busy' } } },
        { type: 'session.status', __directory: '/repo-b', properties: { sessionID: 'ses_b', status: { type: 'idle' } } },
        // Heartbeat is swallowed (no broadcast).
        { type: 'server.heartbeat', properties: {} },
      ]),
    });
    subscribeGlobalSpy.mockResolvedValue({ abort: () => {}, stream: framesOf([]) });

    const bridge = new OpencodeStreamBridge();
    await bridge.ensureGlobalStream();
    // Let the async listener drain the finite stream.
    await new Promise((r) => setTimeout(r, 10));

    const statusFrames = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((f) => f.type === 'session.status');
    expect(statusFrames.find((f) => f.id === a.id && f.working === true)).toBeTruthy();
    expect(statusFrames.find((f) => f.id === b.id && f.working === false)).toBeTruthy();
    // Heartbeat never produced a generic event frame.
    expect(broadcastSpy.mock.calls.map((c) => c[0] as Record<string, unknown>).find((f) => f.eventType === 'server.heartbeat')).toBeUndefined();
  });

  it('adapts the envelope: a worktree.ready frame relays as a typed WS frame', async () => {
    subscribeGlobalSpy.mockResolvedValue({
      abort: () => {},
      stream: framesOf([{ type: 'worktree.ready', __directory: '/repo', properties: { name: 'wt', branch: 'b' } }]),
    });
    const bridge = new OpencodeStreamBridge();
    await bridge.ensureGlobalStream();
    await new Promise((r) => setTimeout(r, 10));
    expect(broadcastSpy).toHaveBeenCalledWith({ v: 1, type: 'worktree.ready', name: 'wt', branch: 'b' });
  });

  it('watchdog resubscribes after the idle window with no zombie work', async () => {
    let aborted = 0;
    // First subscribe: a stream that never ends (stalls). Second: empty.
    let call = 0;
    subscribeGlobalSpy.mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return {
          abort: () => {
            aborted += 1;
          },
          // A stream that never yields — simulates a dead connection.
          stream: (async function* () {
            await new Promise(() => {}); // never resolves
          })(),
        };
      }
      return { abort: () => {}, stream: framesOf([]) };
    });

    vi.useFakeTimers();
    const bridge = new OpencodeStreamBridge();
    await bridge.ensureGlobalStream();
    expect(subscribeGlobalSpy).toHaveBeenCalledTimes(1);

    // Advance past the watchdog window; the interval (fires every ~10s) detects
    // no activity beyond 30s → resubscribe (aborts the stalled stream, subscribes
    // again). Advance 45s to clear the strict > 30s check on a tick boundary.
    await vi.advanceTimersByTimeAsync(45_000);
    expect(aborted).toBe(1);
    expect(subscribeGlobalSpy).toHaveBeenCalledTimes(2);
  });

  it('fallback flag RHYTHM_SSE_GLOBAL=0 does NOT start the global stream', async () => {
    process.env.RHYTHM_SSE_GLOBAL = '0';
    const s = repo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/repo', name: 'S' } as never);
    const bridge = new OpencodeStreamBridge();
    await bridge.streamSession(s.id, 'ses_x', '/repo');
    expect(subscribeGlobalSpy).not.toHaveBeenCalled();
  });
});
