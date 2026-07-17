/**
 * P2-2 — AgentRunner fires queueSkillExtraction (fire-and-forget) on success.
 *
 * vi.mock's the skill_extractor module so queueSkillExtraction is a spy. The
 * unit-level behavior of queueSkillExtraction lives in skill_extractor_wiring.test.ts
 * (which must NOT mock the module). Kept separate so the module mock here does
 * not shadow the real function there.
 *
 *  • AgentRunner calls queueSkillExtraction once, on the SUCCESS path, with the
 *    recorded rhythm session id — and does not block on it (the run resolves).
 *  • AgentRunner does NOT call it on the error/timeout path.
 *
 * #1109 — also mocks harvested_skill_evaluator so scheduleIdleEvaluation is a
 * spy: proves the SUCCESS path calls the new scheduling function instead of
 * invoking evaluateHarvestedDrafts directly (the old per-turn hot-path call).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';

// ── opencode_engine mock so nothing real launches ──────────────────────────────

const { mockCreateSession, mockPrompt, mockAbortSession } = vi.hoisted(() => ({
  mockCreateSession: vi.fn(),
  mockPrompt: vi.fn(),
  mockAbortSession: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    get isReady() {
      return true;
    },
    createSession: mockCreateSession,
    prompt: mockPrompt,
    abortSession: mockAbortSession,
    listMessages: vi.fn().mockResolvedValue([]),
  },
  opencodeSessionMap: new Map<string, string>(),
}));

// ── skill_extractor mock — spy on queueSkillExtraction, keep the rest real ──────

const { mockQueue } = vi.hoisted(() => ({ mockQueue: vi.fn() }));
vi.mock('../services/skill_extractor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/skill_extractor')>();
  return { ...actual, queueSkillExtraction: mockQueue };
});

// #1109 — harvested_skill_evaluator mock — spy on scheduleIdleEvaluation,
// keep evaluateHarvestedDrafts real (though it should never be called
// directly by agent_runner.ts anymore).
const { mockScheduleIdleEvaluation } = vi.hoisted(() => ({ mockScheduleIdleEvaluation: vi.fn() }));
vi.mock('../services/harvested_skill_evaluator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/harvested_skill_evaluator')>();
  return { ...actual, scheduleIdleEvaluation: mockScheduleIdleEvaluation };
});

// ── DB helpers ──────────────────────────────────────────────────────────────────

let _activeDb: Database.Database | null = null;
function makeDb(): void {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  _activeDb = db;
}
function teardownDb(): void {
  if (_activeDb) {
    try {
      _activeDb.close();
    } catch {
      /* ignore */
    }
    _activeDb = null;
  }
}

describe('P2-2 — AgentRunner fires queueSkillExtraction (no await) on success', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    makeDb();
    mockCreateSession.mockResolvedValue({ id: 'sdk-session-1' });
    mockPrompt.mockResolvedValue({
      info: { sessionID: 'sdk-session-1' },
      parts: [{ type: 'text', text: 'Done' }],
    });
    mockAbortSession.mockResolvedValue(true);
  });

  afterEach(() => {
    teardownDb();
    vi.restoreAllMocks();
  });

  it('invokes queueSkillExtraction with the rhythm session id; the run still resolves', async () => {
    const { run } = await import('../services/agent_runner');

    const result = await run({ prompt: 'hello' });

    expect(result.status).toBe('done');
    expect(result.result).toBe('Done');
    // Called once, on the success path, with the recorded rhythm session id.
    expect(mockQueue).toHaveBeenCalledOnce();
    const calledWith = mockQueue.mock.calls[0][0] as string;
    expect(typeof calledWith).toBe('string');
    expect(calledWith.length).toBeGreaterThan(0);
    expect(calledWith).toBe(result.sessionId);
  });

  it('does NOT invoke queueSkillExtraction on the timeout (error) path', async () => {
    process.env.AGENT_RUN_TIMEOUT_MS = '50';
    mockPrompt.mockReturnValue(new Promise(() => {}));

    const { run } = await import('../services/agent_runner');
    const result = await run({ prompt: 'never resolves' });

    expect(result.status).toBe('error');
    expect(mockQueue).not.toHaveBeenCalled();

    delete process.env.AGENT_RUN_TIMEOUT_MS;
  });

  it('#1109 — invokes scheduleIdleEvaluation (not evaluateHarvestedDrafts directly) on success', async () => {
    const { run } = await import('../services/agent_runner');

    const result = await run({ prompt: 'hello' });

    expect(result.status).toBe('done');
    expect(mockScheduleIdleEvaluation).toHaveBeenCalledOnce();
  });

  it('#1109 — does NOT invoke scheduleIdleEvaluation on the timeout (error) path', async () => {
    process.env.AGENT_RUN_TIMEOUT_MS = '50';
    mockPrompt.mockReturnValue(new Promise(() => {}));

    const { run } = await import('../services/agent_runner');
    const result = await run({ prompt: 'never resolves' });

    expect(result.status).toBe('error');
    expect(mockScheduleIdleEvaluation).not.toHaveBeenCalled();

    delete process.env.AGENT_RUN_TIMEOUT_MS;
  });
});
