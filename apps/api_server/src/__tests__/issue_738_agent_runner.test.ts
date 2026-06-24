/**
 * #738 — AgentRunner service tests
 *
 * All tests mock opencode_engine so nothing real launches.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Hoist mocks so they're available when vi.mock factory runs ────────────────

const {
  mockCreateSession,
  mockPromptAsync,
  mockAbortSession,
  mockListMessages,
} = vi.hoisted(() => ({
  mockCreateSession: vi.fn(),
  mockPromptAsync: vi.fn(),
  mockAbortSession: vi.fn(),
  mockListMessages: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    get isReady() { return true; },
    createSession: mockCreateSession,
    promptAsync: mockPromptAsync,
    abortSession: mockAbortSession,
    listMessages: mockListMessages,
  },
  opencodeSessionMap: new Map<string, string>(),
}));

// ── Import after mock ─────────────────────────────────────────────────────────

import { run, _activeRunCount } from '../services/agent_runner';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** A minimal SDK Message with one text part that arrives "now". */
function makeAssistantMessage(text: string, createdAt: number): Record<string, unknown> {
  return {
    id: 'msg-1',
    sessionID: 'sess-1',
    role: 'assistant',
    time: { created: createdAt },
    parts: [{ type: 'text', text, id: 'p-1', sessionID: 'sess-1', messageID: 'msg-1' }],
  };
}

describe('#738 — AgentRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: session creates fine, prompt enqueues fine
    mockCreateSession.mockResolvedValue({ id: 'sdk-session-1' });
    mockPromptAsync.mockResolvedValue(true);
    mockAbortSession.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ── A. Successful run ─────────────────────────────────────────────────────

  it('returns done status and result text when assistant replies', async () => {
    const promptSentBefore = Date.now();

    // listMessages returns the assistant reply on the second poll call
    mockListMessages
      .mockResolvedValueOnce([]) // first poll: no reply yet
      .mockResolvedValueOnce([
        makeAssistantMessage('Hello from agent', promptSentBefore + 100),
      ]);

    const result = await run({ prompt: 'Say hello' });

    expect(result.status).toBe('done');
    expect(result.result).toBe('Hello from agent');
    // sessionId is now the Rhythm session id (from _recordSession); it may differ
    // from the opencode session id since the DB is not initialized in this test.
    expect(typeof result.sessionId).toBe('string');
    expect(mockCreateSession).toHaveBeenCalledOnce();
    // #738-fix: promptAsync must be called WITH a resolved model (not undefined).
    // The DB is not initialized in this test so MRU lookup falls back to the
    // hardcoded default: anthropic / claude-sonnet-4-5.
    expect(mockPromptAsync).toHaveBeenCalledWith(
      'sdk-session-1',
      'Say hello',
      { providerID: 'anthropic', modelID: 'claude-sonnet-4-5' },
      undefined,
    );
  });

  // ── B. Timeout path ───────────────────────────────────────────────────────

  it('calls abortSession and returns error on timeout', async () => {
    // Use a very short timeout
    process.env.AGENT_RUN_TIMEOUT_MS = '100';

    // listMessages always returns empty (no reply ever)
    mockListMessages.mockResolvedValue([]);

    const result = await run({ prompt: 'Timeout test' });

    expect(result.status).toBe('error');
    expect(result.error).toMatch(/timed out/i);
    expect(mockAbortSession).toHaveBeenCalledWith('sdk-session-1', undefined);

    delete process.env.AGENT_RUN_TIMEOUT_MS;
  });

  // ── C. Slot released after successful run ─────────────────────────────────

  it('releases the concurrency slot after a successful run', async () => {
    const promptSentBefore = Date.now();
    mockListMessages.mockResolvedValue([
      makeAssistantMessage('Done', promptSentBefore + 100),
    ]);

    const beforeCount = _activeRunCount();
    await run({ prompt: 'Slot release test' });
    const afterCount = _activeRunCount();

    expect(afterCount).toBe(beforeCount);
  });

  it('releases the concurrency slot after a failed run (timeout)', async () => {
    process.env.AGENT_RUN_TIMEOUT_MS = '50';
    mockListMessages.mockResolvedValue([]);

    const beforeCount = _activeRunCount();
    await run({ prompt: 'Error release test' });
    const afterCount = _activeRunCount();

    expect(afterCount).toBe(beforeCount);

    delete process.env.AGENT_RUN_TIMEOUT_MS;
  });

  // ── D. Session creation failure ───────────────────────────────────────────

  it('returns error when createSession returns null', async () => {
    mockCreateSession.mockResolvedValue(null);

    const result = await run({ prompt: 'No session' });

    expect(result.status).toBe('error');
    expect(result.error).toMatch(/failed to create/i);
    expect(mockPromptAsync).not.toHaveBeenCalled();
  });

  // ── E. promptAsync failure ────────────────────────────────────────────────

  it('returns error when promptAsync returns false', async () => {
    mockPromptAsync.mockResolvedValue(false);

    const result = await run({ prompt: 'Bad prompt' });

    expect(result.status).toBe('error');
    expect(result.error).toMatch(/promptAsync returned false/i);
  });

  // ── F. Concurrency cap rejects (N+1)th run ────────────────────────────────

  it('rejects the (N+1)th run when concurrency cap is reached', async () => {
    // Use a very short timeout so the first run completes (times out) promptly
    process.env.AGENT_RUN_TIMEOUT_MS = '100';
    process.env.MAX_CONCURRENT_AGENT_RUNS = '1';

    // First run: listMessages never resolves during the run window (times out)
    let firstRunResolve!: (v: unknown[]) => void;
    const firstRunListMessages = new Promise<unknown[]>((resolve) => {
      firstRunResolve = resolve;
    });
    mockListMessages.mockReturnValue(firstRunListMessages);

    // Start first run — don't await yet; let it acquire the slot
    const firstRunPromise = run({ prompt: 'First' });

    // Give the first run 20ms to acquire its slot (before timeout fires at 100ms)
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    // Second run should be rejected immediately (cap = 1, slot taken)
    const secondResult = await run({ prompt: 'Second' });

    expect(secondResult.status).toBe('error');
    expect(secondResult.error).toMatch(/concurrency cap/i);

    // Unblock and await first run (it will time out at 100ms and release slot)
    firstRunResolve([]); // return empty so it just times out cleanly
    const firstResult = await firstRunPromise;
    expect(firstResult.status).toBe('error'); // timed out

    // Slot should be released now — a new run should be accepted
    const thirdResult = await run({
      prompt: 'Third (after slot released)',
      // Reset timeout for this final assertion run
    });
    // Third run will time out too (listMessages returns nothing) — that's fine;
    // the key check is it was NOT rejected with concurrency error
    expect(thirdResult.error).not.toMatch(/concurrency cap/i);

    delete process.env.AGENT_RUN_TIMEOUT_MS;
    delete process.env.MAX_CONCURRENT_AGENT_RUNS;
  }, 10_000); // extend test timeout to 10s
});
