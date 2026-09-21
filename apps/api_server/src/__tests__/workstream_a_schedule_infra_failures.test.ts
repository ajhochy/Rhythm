/**
 * Workstream A acceptance contract — the three ways scheduled agent runs were
 * failing silently in September 2026.
 *
 * Class 2  ai-trend-research-daily reported "model produced no output — check
 *          the agent profile model is valid and the provider is authenticated"
 *          every day after the default Anthropic account expired
 *          2026-09-18T11:11:54Z. Nothing on the run path read the account's
 *          `needs_relogin` status, so the misdirecting message was all anyone got.
 * Class 3a ffb-daily-dashboard-update was aborted ~17 min into a healthy
 *          `refresh_all.py daily` bash call that had requested the engine's
 *          maximum 1_200_000 ms tool timeout — the runner's inactivity window
 *          was 600_000 ms, so ANY tool call over ten minutes was a guaranteed kill.
 * Class 3b theological-research-daily stalled on `agent-reach doctor --json`,
 *          and reported only "no progress for 600000ms (inactivity window)" —
 *          true, unactionable, and indistinguishable from a dead engine.
 *
 * Fake timers only; the OpenCode SDK is the real boundary and is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockAbortSession,
  mockCreateSession,
  mockListMessages,
  mockPrompt,
  mockDefaultAccount,
} = vi.hoisted(() => ({
  mockAbortSession: vi.fn(),
  mockCreateSession: vi.fn(),
  mockListMessages: vi.fn(),
  mockPrompt: vi.fn(),
  mockDefaultAccount: vi.fn(),
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

vi.mock('../services/anthropic_accounts_service', () => ({
  anthropicAccountsService: { defaultAccount: mockDefaultAccount },
}));

import {
  MAX_ENGINE_TOOL_TIMEOUT_MS,
  getRunInactivityTimeoutMs,
  run,
} from '../services/agent_runner';

const DEADLINE_ENV_KEYS = [
  'AGENT_RUN_TIMEOUT_MS',
  'AGENT_RUN_INACTIVITY_TIMEOUT_MS',
  'AGENT_RUN_HARD_TIMEOUT_MS',
] as const;

/** A snapshot whose newest part is a tool that started and never finished. */
function hungToolSnapshot() {
  return [
    {
      info: { id: 'assistant-hung', role: 'assistant', time: { created: 1 } },
      parts: [
        {
          id: 'tool-hung',
          messageID: 'assistant-hung',
          sessionID: 'sdk-wa',
          type: 'tool',
          tool: 'bash',
          state: {
            status: 'running',
            input: { command: 'agent-reach doctor --json 2>&1' },
          },
        },
      ],
    },
  ];
}

async function startRun(prompt: string) {
  const runPromise = run({ prompt });
  for (let i = 0; i < 50 && mockPrompt.mock.calls.length === 0; i += 1) {
    await vi.advanceTimersByTimeAsync(0);
  }
  expect(mockPrompt).toHaveBeenCalledOnce();
  return { runPromise };
}

describe('Workstream A — scheduled agent run infra failures', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    for (const key of DEADLINE_ENV_KEYS) delete process.env[key];

    mockAbortSession.mockResolvedValue(true);
    mockCreateSession.mockResolvedValue({ id: 'sdk-wa' });
    mockListMessages.mockResolvedValue([]);
    // Default: a healthy account, so the preflight never interferes.
    mockDefaultAccount.mockReturnValue({ id: 'personal', status: 'ok' });
  });

  afterEach(() => {
    for (const key of DEADLINE_ENV_KEYS) delete process.env[key];
    vi.useRealTimers();
  });

  it('class 3a: the default inactivity window outlasts the engine max tool timeout', () => {
    // No env override — this is the shipped DEFAULT, the value every scheduled
    // run actually used when ffb-daily-dashboard-update was killed mid-script.
    // A single tool call publishes no new message parts while it runs, so a
    // window at or below the engine's tool cap kills healthy long calls by
    // construction. Asserted directly rather than by advancing 1.2M ms through
    // a 1s activity poll, which is 1.2M fake-timer iterations.
    expect(getRunInactivityTimeoutMs()).toBeGreaterThan(MAX_ENGINE_TOOL_TIMEOUT_MS);
  });

  it('class 3b: an inactivity timeout names the tool call it stalled on', async () => {
    process.env.AGENT_RUN_INACTIVITY_TIMEOUT_MS = '5000';
    process.env.AGENT_RUN_HARD_TIMEOUT_MS = '60000';
    mockPrompt.mockReturnValue(new Promise(() => {}));
    mockListMessages.mockResolvedValue(hungToolSnapshot());

    const { runPromise } = await startRun('Run the theological research scan');
    // The first poll observes the tool part (a fingerprint change, so it rearms
    // once); every later poll sees the same stuck part and does not.
    await vi.advanceTimersByTimeAsync(20_000);

    const result = await runPromise;
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/inactivity window/i);
    // The whole point: the operator can see WHAT hung.
    expect(result.error).toContain('last activity:');
    expect(result.error).toContain('bash');
    expect(result.error).toContain('agent-reach doctor --json');
    expect(result.error).toContain('running');
  });

  it('class 2: an expired default account fails fast instead of "no output"', async () => {
    mockDefaultAccount.mockReturnValue({ id: 'personal', status: 'needs_relogin' });
    mockPrompt.mockReturnValue(new Promise(() => {}));

    const result = await run({ prompt: 'Run today’s AI trend scan' });

    expect(result.status).toBe('error');
    expect(result.error).toMatch(/needs re-login/i);
    expect(result.error).toContain('personal');
    // The misdirecting message must be gone.
    expect(result.error).not.toMatch(/produced no output/i);
    // And no session/turn was paid for.
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockPrompt).not.toHaveBeenCalled();
  });

  it('class 2: a healthy account is not blocked, and a missing one fails open', async () => {
    mockPrompt.mockResolvedValue({
      info: { id: 'assistant-final', sessionID: 'sdk-wa' },
      parts: [{ id: 'text-final', type: 'text', text: 'done' }],
    });

    const ok = await run({ prompt: 'healthy account' });
    expect(ok.status).toBe('done');

    // API-key-only setups have no account row at all — they must still run.
    mockDefaultAccount.mockReturnValue(undefined);
    const noAccount = await run({ prompt: 'no account configured' });
    expect(noAccount.status).toBe('done');
  });
});
