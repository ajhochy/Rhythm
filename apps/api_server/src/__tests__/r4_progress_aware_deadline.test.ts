/**
 * Workstream R4 acceptance contract — progress-aware AgentRunner deadlines.
 *
 * These tests use fake timers only. The OpenCode SDK is the true external
 * boundary; listMessages snapshots are the same runtime message/part state the
 * production stream bridge persists and displays.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockAbortSession,
  mockCreateSession,
  mockListMessages,
  mockPrompt,
} = vi.hoisted(() => ({
  mockAbortSession: vi.fn(),
  mockCreateSession: vi.fn(),
  mockListMessages: vi.fn(),
  mockPrompt: vi.fn(),
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

const DEADLINE_ENV_KEYS = [
  'AGENT_RUN_TIMEOUT_MS',
  'AGENT_RUN_INACTIVITY_TIMEOUT_MS',
  'AGENT_RUN_HARD_TIMEOUT_MS',
] as const;

function response(text: string) {
  return {
    info: { id: 'assistant-final', sessionID: 'sdk-r4' },
    parts: [{ id: 'text-final', type: 'text', text }],
  };
}

function activitySnapshot(step: number) {
  return [
    {
      info: {
        id: 'assistant-progress',
        role: 'assistant',
        time: { created: 1 },
      },
      parts: [
        {
          id: `tool-${step}`,
          messageID: 'assistant-progress',
          sessionID: 'sdk-r4',
          type: 'tool',
          tool: 'bash',
          state: {
            status: 'completed',
            input: { command: `printf step-${step}` },
            output: `step-${step}`,
          },
        },
      ],
    },
  ];
}

function deferredPrompt() {
  let resolve!: (value: ReturnType<typeof response>) => void;
  const promise = new Promise<ReturnType<typeof response>>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function startRun(prompt: string) {
  const runPromise = run({ prompt });
  for (let i = 0; i < 50 && mockPrompt.mock.calls.length === 0; i += 1) {
    await vi.advanceTimersByTimeAsync(0);
  }
  expect(mockPrompt).toHaveBeenCalledOnce();
  // Wrap the promise so this async helper does not adopt/await the run itself.
  return { runPromise };
}

describe('R4 — progress-aware AgentRunner deadline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    for (const key of DEADLINE_ENV_KEYS) delete process.env[key];

    mockAbortSession.mockResolvedValue(true);
    mockCreateSession.mockResolvedValue({ id: 'sdk-r4' });
    mockListMessages.mockResolvedValue([]);
  });

  afterEach(() => {
    for (const key of DEADLINE_ENV_KEYS) delete process.env[key];
    vi.useRealTimers();
  });

  it('issue-0-c1: progressing session survives past the old 600s', async () => {
    process.env.AGENT_RUN_TIMEOUT_MS = '600000';
    process.env.AGENT_RUN_INACTIVITY_TIMEOUT_MS = '600000';
    process.env.AGENT_RUN_HARD_TIMEOUT_MS = '1800000';
    const pending = deferredPrompt();
    mockPrompt.mockReturnValue(pending.promise);

    let step = 0;
    mockListMessages.mockImplementation(async () => activitySnapshot(step));
    const { runPromise } = await startRun('Keep making observable tool progress');

    for (step = 1; step <= 4; step += 1) {
      await vi.advanceTimersByTimeAsync(300_000);
      expect(mockAbortSession).not.toHaveBeenCalled();
    }

    pending.resolve(response('finished after twenty minutes'));
    const result = await runPromise;
    expect(result).toMatchObject({
      status: 'done',
      result: 'finished after twenty minutes',
    });
  });

  it('issue-0-c2: stalled session is aborted at the inactivity window', async () => {
    process.env.AGENT_RUN_TIMEOUT_MS = '10000';
    process.env.AGENT_RUN_INACTIVITY_TIMEOUT_MS = '10000';
    process.env.AGENT_RUN_HARD_TIMEOUT_MS = '60000';
    mockPrompt.mockReturnValue(new Promise(() => {}));

    const { runPromise } = await startRun('Never produces activity');
    await vi.advanceTimersByTimeAsync(9_999);
    expect(mockAbortSession).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    const result = await runPromise;
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/inactivity window/i);
    expect(mockAbortSession).toHaveBeenCalledWith('sdk-r4', process.cwd());
  });

  it('issue-0-c3: hard ceiling aborts even with continuous progress', async () => {
    process.env.AGENT_RUN_TIMEOUT_MS = '25000';
    process.env.AGENT_RUN_INACTIVITY_TIMEOUT_MS = '10000';
    process.env.AGENT_RUN_HARD_TIMEOUT_MS = '25000';
    mockPrompt.mockReturnValue(new Promise(() => {}));

    let step = 0;
    mockListMessages.mockImplementation(async () => activitySnapshot(step));
    const { runPromise } = await startRun('Progress forever');

    for (step = 1; step <= 4; step += 1) {
      await vi.advanceTimersByTimeAsync(5_000);
      expect(mockAbortSession).not.toHaveBeenCalled();
    }
    await vi.advanceTimersByTimeAsync(4_999);
    expect(mockAbortSession).not.toHaveBeenCalled();

    step += 1;
    await vi.advanceTimersByTimeAsync(1);
    const result = await runPromise;
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/hard ceiling/i);
    expect(mockAbortSession).toHaveBeenCalledOnce();
  });

  it('issue-0-c4: parent cancellation still propagates to children', async () => {
    process.env.AGENT_RUN_TIMEOUT_MS = '10000';
    process.env.AGENT_RUN_INACTIVITY_TIMEOUT_MS = '10000';
    process.env.AGENT_RUN_HARD_TIMEOUT_MS = '60000';
    mockPrompt.mockReturnValue(new Promise(() => {}));

    let childCancelledAt: number | null = null;
    mockAbortSession.mockImplementation(async (sessionId: string) => {
      // The engine's task tool already propagates its parent abort signal to
      // child sessions. This boundary fake proves AgentRunner still promptly
      // invokes that established parent-cancellation path.
      expect(sessionId).toBe('sdk-r4');
      childCancelledAt = Date.now();
      return true;
    });

    const startedAt = Date.now();
    const { runPromise } = await startRun('Parent with a delegated child');
    await vi.advanceTimersByTimeAsync(10_000);
    await runPromise;

    expect(childCancelledAt).toBe(startedAt + 10_000);
    expect(mockAbortSession).toHaveBeenCalledOnce();
  });
});
