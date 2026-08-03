/**
 * Config Doctor track C, C1 — a run that times out (inactivity or hard
 * ceiling) must not silently discard output the model already produced
 * earlier in the same session (daily-dev-summary task
 * d324b36d-483a-4919-8e44-e895a0067188, 2026-08-01: a correct partial git
 * summary was produced, a retry then hung on `glob`, and the whole run
 * aborted with nothing persisted).
 *
 * Fix: on AgentRunTimeoutError, AgentRunner now reads the session's message
 * list (the same boundary the existing "empty response" fallback already
 * uses) and recovers the last assistant text BEFORE aborting the engine
 * session. That recovered text becomes the returned `result` and the
 * session's persisted preview, instead of the bare timeout string.
 *
 * Harness copied from r4_progress_aware_deadline.test.ts (fake timers,
 * mocked opencode_engine boundary).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';

const { mockAbortSession, mockCreateSession, mockListMessages, mockPrompt } =
  vi.hoisted(() => ({
    mockAbortSession: vi.fn(),
    mockCreateSession: vi.fn(),
    mockListMessages: vi.fn(),
    mockPrompt: vi.fn(),
  }));

vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: {
    streamSession: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    get isReady() {
      return true;
    },
    abortSession: mockAbortSession,
    createSession: mockCreateSession,
    listMessages: mockListMessages,
    prompt: mockPrompt,
  },
  opencodeSessionMap: new Map<string, string>(),
}));

import { run } from '../services/agent_runner';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';

const DEADLINE_ENV_KEYS = [
  'AGENT_RUN_TIMEOUT_MS',
  'AGENT_RUN_INACTIVITY_TIMEOUT_MS',
  'AGENT_RUN_HARD_TIMEOUT_MS',
] as const;

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

async function startRun(prompt: string) {
  const runPromise = run({ prompt });
  for (let i = 0; i < 500 && mockPrompt.mock.calls.length === 0; i += 1) {
    await vi.advanceTimersByTimeAsync(0);
  }
  expect(mockPrompt).toHaveBeenCalledOnce();
  return { runPromise };
}

describe('config-doctor C1 — recover partial result on timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    for (const key of DEADLINE_ENV_KEYS) delete process.env[key];
    setDb(makeDb());

    mockAbortSession.mockResolvedValue(true);
    mockCreateSession.mockResolvedValue({ id: 'sdk-c1' });
  });

  afterEach(() => {
    for (const key of DEADLINE_ENV_KEYS) delete process.env[key];
    vi.useRealTimers();
  });

  it('a hung retry after a good result still surfaces that result, not a blank error', async () => {
    process.env.AGENT_RUN_TIMEOUT_MS = '10000';
    process.env.AGENT_RUN_INACTIVITY_TIMEOUT_MS = '10000';
    process.env.AGENT_RUN_HARD_TIMEOUT_MS = '60000';

    const GOOD_SUMMARY =
      '6 commits on codex/mobile-fixes-rollup... Latest: 3984564fe... Uncommitted: 15 modified files plus 2 new...';

    // listMessages is polled by the activity probe AND by the timeout-path
    // recovery read — same fixture serves both: the last assistant message
    // already carries the good summary text, but no NEW fingerprint ever
    // appears, so the run still times out on inactivity.
    mockListMessages.mockResolvedValue([
      {
        info: { id: 'assistant-1', role: 'assistant', time: { created: 1 } },
        parts: [{ id: 'text-1', type: 'text', text: GOOD_SUMMARY }],
      },
    ]);
    mockPrompt.mockReturnValue(new Promise(() => {})); // retry hangs forever (e.g. stuck glob)

    const { runPromise } = await startRun('Summarize dev activity (retry)');
    // The activity probe observes this fixture's fingerprint once (a real,
    // unchanging progress marker), rearming the inactivity window from that
    // first tick — advance a bit past 10s of inactivity from there.
    await vi.advanceTimersByTimeAsync(12_000);
    const result = await runPromise;

    expect(result.status).toBe('error');
    expect(result.error).toMatch(/inactivity window/i);
    // The key assertion: result is NOT wiped to '' — the good partial survives.
    expect(result.result).toBe(GOOD_SUMMARY);

    const sessionsRepo = new AgentSessionsRepository();
    const row = sessionsRepo.findById(result.sessionId);
    expect(row?.status).toBe('error');
    expect(row?.lastPreview).toBe(GOOD_SUMMARY);

    const msgsRepo = new AgentSessionMessagesRepository();
    const persisted = msgsRepo.listBySession(result.sessionId, 50);
    expect(persisted.some((m) => m.role === 'output' && m.rawText === GOOD_SUMMARY)).toBe(true);
  });

  it('a timeout with truly no prior output still returns an empty result (no false positive)', async () => {
    process.env.AGENT_RUN_TIMEOUT_MS = '10000';
    process.env.AGENT_RUN_INACTIVITY_TIMEOUT_MS = '10000';
    process.env.AGENT_RUN_HARD_TIMEOUT_MS = '60000';

    mockListMessages.mockResolvedValue([]);
    mockPrompt.mockReturnValue(new Promise(() => {}));

    const { runPromise } = await startRun('Never produces activity');
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await runPromise;

    expect(result.status).toBe('error');
    expect(result.result).toBe('');
  });
});
