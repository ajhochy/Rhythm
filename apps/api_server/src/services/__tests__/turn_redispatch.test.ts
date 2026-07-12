/**
 * #930 — mid-run cross-provider re-dispatch: deterministic unit tests for the
 * turn_redispatch state machine + engine-boundary calls (deps injected — no
 * real engine, DB writes only via the injected setError/clearError fakes).
 * Run: cd apps/api_server && npx vitest run src/services/__tests__/turn_redispatch.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../opencode_engine', () => ({
  opencodeClient: {},
  opencodeSessionMap: new Map<string, string>(),
}));

import {
  retainTurn,
  noteUserMessage,
  clearTurn,
  beginHandoff,
  onSessionError,
  decideHandoff,
  failHandoff,
  advanceFallbackCascade,
  redispatchTurn,
  _resetForTests,
  RedispatchDeps,
} from '../turn_redispatch';

const SID = 'local-session-1';
const SDK = 'sdk-session-1';
const MSG = 'msg_user_1';

function makeDeps(overrides?: Partial<RedispatchDeps>): RedispatchDeps & {
  abort: ReturnType<typeof vi.fn>;
  revert: ReturnType<typeof vi.fn>;
  prepare: ReturnType<typeof vi.fn>;
  prompt: ReturnType<typeof vi.fn>;
  clearError: ReturnType<typeof vi.fn>;
  setError: ReturnType<typeof vi.fn>;
} {
  return {
    abort: vi.fn().mockResolvedValue(true),
    revert: vi.fn().mockResolvedValue(undefined),
    prepare: vi.fn().mockResolvedValue(true),
    prompt: vi.fn().mockResolvedValue(true),
    clearError: vi.fn(),
    setError: vi.fn(),
    ...(overrides ?? {}),
  } as never;
}

function seedTurn(id = SID): void {
  retainTurn(id, {
    sdkSessionId: SDK,
    data: 'PREFACE\n\noriginal user prompt',
    parts: [{ type: 'text', text: 'PREFACE\n\noriginal user prompt' }],
    cwd: '/tmp/work',
    sdkOpts: { permissionMode: 'bypassPermissions' },
  });
  noteUserMessage(id, MSG);
}

beforeEach(() => {
  _resetForTests();
});

describe('happy path — exhausted report on a spinning in-flight turn', () => {
  it('decide → proceed → abort + revert + re-prompt on the new provider (same engine session)', async () => {
    seedTurn();
    beginHandoff(SID);
    expect(decideHandoff(SID, 'openai', 'gpt-5.3-codex')).toBe('proceed');

    const deps = makeDeps();
    await expect(redispatchTurn(SID, deps)).resolves.toBe(true);
    expect(deps.clearError).toHaveBeenCalledWith(SID);
    expect(deps.abort).toHaveBeenCalledWith(SDK, '/tmp/work');
    expect(deps.revert).toHaveBeenCalledWith(SDK, MSG);
    expect(deps.prompt).toHaveBeenCalledWith(
      SDK,
      'PREFACE\n\noriginal user prompt',
      { providerID: 'openai', modelID: 'gpt-5.3-codex' },
      '/tmp/work',
      { permissionMode: 'bypassPermissions' },
      [{ type: 'text', text: 'PREFACE\n\noriginal user prompt' }],
    );
    // abort precedes revert precedes prompt — the retry loop must die first.
    expect(deps.abort.mock.invocationCallOrder[0]).toBeLessThan(
      deps.revert.mock.invocationCallOrder[0],
    );
    expect(deps.revert.mock.invocationCallOrder[0]).toBeLessThan(
      deps.prompt.mock.invocationCallOrder[0],
    );
    expect(deps.setError).not.toHaveBeenCalled();
  });

  it('a fast session.error racing the decision is deferred, then consumed by the re-dispatch', async () => {
    seedTurn();
    beginHandoff(SID);
    expect(onSessionError(SID, 'anthropic 429')).toBe('defer');
    expect(decideHandoff(SID, 'google', 'gemini-2.5-pro')).toBe('proceed');

    const deps = makeDeps();
    await expect(redispatchTurn(SID, deps)).resolves.toBe(true);
    expect(deps.prompt).toHaveBeenCalledWith(
      SDK,
      expect.any(String),
      { providerID: 'google', modelID: 'gemini-2.5-pro' },
      '/tmp/work',
      expect.anything(),
      expect.anything(),
    );
    expect(deps.setError).not.toHaveBeenCalled();
  });
});

describe('single-flight — duplicate exhausted reports from the engine retry loop', () => {
  it('only the first decideHandoff proceeds; later reports are stale no-ops', async () => {
    seedTurn();
    beginHandoff(SID);
    expect(decideHandoff(SID, 'openai', 'gpt-5.3-codex')).toBe('proceed');
    await redispatchTurn(SID, makeDeps());

    // A second report for the same spinning turn: no-clobber + stale.
    beginHandoff(SID);
    expect(decideHandoff(SID, 'openai', 'gpt-5.3-codex')).toBe('stale');
  });

  it('decideHandoff without a prior beginHandoff is stale', () => {
    expect(decideHandoff(SID, 'openai', 'gpt-5.3-codex')).toBe('stale');
  });
});

describe('at-most-once', () => {
  it('a non-rate-limit session.error AFTER a successful re-dispatch finalizes normally', async () => {
    seedTurn();
    beginHandoff(SID);
    decideHandoff(SID, 'openai', 'gpt-5.3-codex');
    await redispatchTurn(SID, makeDeps());

    // The RETRY turn fails (e.g. #913 tool-pairing 400 on the new provider):
    expect(onSessionError(SID, 'openai 400 tool pairing')).toBe('finalize');
    // And there is no lingering state — a further error also finalizes.
    expect(onSessionError(SID, 'again')).toBe('finalize');
  });
});

describe('bounded multi-tier rate-limit cascade', () => {
  it('walks Anthropic -> Codex -> Gemini -> OpenRouter once each, then terminates', async () => {
    retainTurn(SID, {
      sdkSessionId: SDK,
      data: 'PREFACE\n\noriginal user prompt',
      cwd: '/tmp/work',
      model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-6' },
      mcpRoleConfig: null,
    });
    noteUserMessage(SID, MSG);
    const engine = makeDeps();
    const cascadeDeps = {
      listAuthedProviders: vi
        .fn()
        .mockResolvedValue(['anthropic', 'openai', 'google', 'openrouter']),
      persistDecision: vi.fn(),
      notifyDecision: vi.fn(),
      redispatch: (id: string) => redispatchTurn(id, engine),
    };

    const first = await advanceFallbackCascade(
      SID,
      { providerID: 'anthropic', message: 'Anthropic exhausted' },
      cascadeDeps,
    );
    expect(first).toMatchObject({
      outcome: 'redispatched',
      decision: { tier: { id: 'codex' }, providerID: 'openai' },
    });

    expect(
      onSessionError(SID, 'OpenAI 429', {
        name: 'APIError',
        data: { statusCode: 429, isRetryable: true },
      }),
    ).toBe('cascade');
    const second = await advanceFallbackCascade(SID, { message: 'OpenAI 429' }, cascadeDeps);
    expect(second).toMatchObject({
      outcome: 'redispatched',
      decision: { tier: { id: 'gemini' }, providerID: 'google' },
    });

    expect(
      onSessionError(SID, 'Google RESOURCE_EXHAUSTED', {
        name: 'APIError',
        data: { statusCode: 429, isRetryable: true },
      }),
    ).toBe('cascade');
    const third = await advanceFallbackCascade(SID, { message: 'Google exhausted' }, cascadeDeps);
    expect(third).toMatchObject({
      outcome: 'redispatched',
      decision: { tier: { id: 'openrouter-free' }, providerID: 'openrouter' },
    });

    expect(
      onSessionError(SID, 'OpenRouter 429', {
        name: 'APIError',
        data: { statusCode: 429, isRetryable: true },
      }),
    ).toBe('cascade');
    await expect(
      advanceFallbackCascade(SID, { message: 'OpenRouter exhausted' }, cascadeDeps),
    ).resolves.toEqual({ outcome: 'terminal', error: 'OpenRouter 429' });

    expect((engine.prompt as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[2]))
      .toEqual([
        { providerID: 'openai', modelID: 'gpt-5.4' },
        { providerID: 'google', modelID: 'gemini-2.5-pro' },
        { providerID: 'openrouter', modelID: 'openrouter/free' },
      ]);
    expect(engine.prepare.mock.calls.map((call) => call[2])).toEqual([
      'openai',
      'google',
      'openrouter',
    ]);
  });
});

describe('retained-turn buffer lifecycle', () => {
  it('an exhausted report with NO in-flight turn (buffer cleared on idle) is a benign no-op — never errors the session', async () => {
    seedTurn();
    clearTurn(SID); // turn completed normally (session.idle)

    beginHandoff(SID);
    decideHandoff(SID, 'openai', 'gpt-5.3-codex');
    const deps = makeDeps();
    await expect(redispatchTurn(SID, deps)).resolves.toBe(false);
    expect(deps.abort).not.toHaveBeenCalled();
    expect(deps.revert).not.toHaveBeenCalled();
    expect(deps.prompt).not.toHaveBeenCalled();
    expect(deps.setError).not.toHaveBeenCalled(); // idle session stays idle
    // State cleared: later errors finalize normally.
    expect(onSessionError(SID, 'later')).toBe('finalize');
  });

  it('clearTurn is a no-op while the route is deciding (idle-mid-decision race)', async () => {
    seedTurn();
    beginHandoff(SID);
    clearTurn(SID); // must NOT wipe the retained turn mid-decision

    decideHandoff(SID, 'openai', 'gpt-5.3-codex');
    const deps = makeDeps();
    await expect(redispatchTurn(SID, deps)).resolves.toBe(true);
  });

  it('an in-flight turn with no revert target (user message never seen) is aborted + finalized, not guessed', async () => {
    retainTurn(SID, { sdkSessionId: SDK, data: 'x' }); // no noteUserMessage
    beginHandoff(SID);
    onSessionError(SID, 'anthropic 429');
    decideHandoff(SID, 'openai', 'gpt-5.3-codex');
    const deps = makeDeps();
    await expect(redispatchTurn(SID, deps)).resolves.toBe(false);
    expect(deps.abort).toHaveBeenCalledWith(SDK, undefined);
    expect(deps.setError).toHaveBeenCalledWith(SID, 'anthropic 429');
  });

  it('retainTurn for a NEW user turn resets stale handoff state', () => {
    seedTurn();
    beginHandoff(SID);
    decideHandoff(SID, 'openai', 'gpt-5.3-codex'); // stale 'redispatched'
    seedTurn(); // next user turn
    expect(onSessionError(SID, 'unrelated failure')).toBe('finalize');
  });

  it('buffer is bounded: oldest entry evicted past the cap', async () => {
    for (let i = 0; i < 200; i++) {
      retainTurn(`s-${i}`, { sdkSessionId: `sdk-${i}`, data: 'd' });
    }
    seedTurn('s-overflow'); // 201st insert — evicts s-0
    beginHandoff('s-0');
    decideHandoff('s-0', 'openai', 'gpt-5.3-codex');
    const deps = makeDeps();
    await expect(redispatchTurn('s-0', deps)).resolves.toBe(false); // retained turn gone → benign no-op

    beginHandoff('s-overflow');
    decideHandoff('s-overflow', 'openai', 'gpt-5.3-codex');
    const deps2 = makeDeps();
    await expect(redispatchTurn('s-overflow', deps2)).resolves.toBe(true); // newest kept
  });
});

describe('failure/fallback paths', () => {
  it('no handoff in flight → session.error finalizes normally', () => {
    expect(onSessionError(SID, 'boom')).toBe('finalize');
  });

  it('failHandoff returns the deferred error so the route can finalize it', () => {
    beginHandoff(SID);
    expect(onSessionError(SID, 'anthropic 429')).toBe('defer');
    expect(failHandoff(SID)).toBe('anthropic 429');
    // State cleared — subsequent errors finalize normally.
    expect(onSessionError(SID, 'later')).toBe('finalize');
  });

  it('failHandoff without a deferred error returns undefined', () => {
    beginHandoff(SID);
    expect(failHandoff(SID)).toBeUndefined();
  });

  it('revert rejection finalizes with the ORIGINAL error and never retries again', async () => {
    seedTurn();
    beginHandoff(SID);
    onSessionError(SID, 'anthropic 429');
    decideHandoff(SID, 'openai', 'gpt-5.3-codex');
    const deps = makeDeps({ revert: vi.fn().mockRejectedValue(new Error('revert 502')) });
    await expect(redispatchTurn(SID, deps)).resolves.toBe(false);
    expect(deps.setError).toHaveBeenCalledWith(SID, 'anthropic 429');
    expect(onSessionError(SID, 'later')).toBe('finalize'); // at-most-once held
  });

  it('promptAsync returning false (silent no-op) finalizes rather than hanging', async () => {
    seedTurn();
    beginHandoff(SID);
    onSessionError(SID, 'anthropic 429');
    decideHandoff(SID, 'openai', 'gpt-5.3-codex');
    const deps = makeDeps({ prompt: vi.fn().mockResolvedValue(false) });
    await expect(redispatchTurn(SID, deps)).resolves.toBe(false);
    expect(deps.setError).toHaveBeenCalledWith(SID, 'anthropic 429');
  });
});
