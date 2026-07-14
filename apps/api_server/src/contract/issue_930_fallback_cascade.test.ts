import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyProviderError,
  nextFallbackTier,
} from '../services/model_fallback';
import {
  _resetForTests,
  beginHandoff,
  decideHandoff,
  noteUserMessage,
  onSessionError,
  redispatchTurn,
  retainTurn,
  type RedispatchDeps,
} from '../services/turn_redispatch';

const SID = 'contract-session';
const SDK = 'contract-sdk-session';

function deps(): RedispatchDeps & { prepare: ReturnType<typeof vi.fn> } {
  return {
    abort: vi.fn().mockResolvedValue(undefined),
    revert: vi.fn().mockResolvedValue(undefined),
    prepare: vi.fn().mockResolvedValue(true),
    prompt: vi.fn().mockResolvedValue(true),
    clearError: vi.fn(),
    setError: vi.fn(),
  } as RedispatchDeps & { prepare: ReturnType<typeof vi.fn> };
}

describe('issue #930 fallback cascade contract', () => {
  beforeEach(() => _resetForTests());

  it('issue-930-c1: structured provider errors retain rate-limit classification', () => {
    // Regression caught: the bridge previously reduced the real APIError to a
    // display string, while classifyProviderError accepted only a number.
    expect(
      classifyProviderError({
        name: 'APIError',
        data: { statusCode: 429, isRetryable: true, message: 'Too Many Requests' },
      } as unknown as number),
    ).toBe('rate_limit');
    expect(
      classifyProviderError({
        name: 'APIError',
        data: {
          statusCode: 400,
          isRetryable: false,
          message: 'Quota exhausted',
          responseBody: '{"error":{"code":"insufficient_quota"}}',
        },
      } as unknown as number),
    ).toBe('rate_limit');
    expect(classifyProviderError({ data: { statusCode: 401 } } as unknown as number)).toBe('auth');
    expect(classifyProviderError({ data: { statusCode: 400, message: 'Bad schema' } } as unknown as number)).toBe('other');
  });

  it('issue-930-c2: a redispatched Codex rate limit remains cascade-eligible', async () => {
    // Regression caught: phase=redispatched unconditionally finalized every
    // second provider failure, preventing Codex -> Gemini.
    retainTurn(SID, {
      sdkSessionId: SDK,
      data: 'retained prompt',
      model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-6' },
    } as Parameters<typeof retainTurn>[1]);
    noteUserMessage(SID, 'user-message-1');
    beginHandoff(SID, 'anthropic', 'Anthropic exhausted');
    decideHandoff(SID, 'openai', 'gpt-5.4', 'codex');
    expect(await redispatchTurn(SID, deps())).toBe(true);

    const action = onSessionError(
      SID,
      'Too Many Requests',
      { name: 'APIError', data: { statusCode: 429, isRetryable: true } },
    );
    expect(action).toBe('cascade');
  });

  it('issue-930-c3: Gemini session preparation precedes the redispatch prompt', async () => {
    // Regression caught: redispatchTurn called promptAsync directly, so a
    // Gemini hop inherited an uncapped function-declaration surface.
    const d = deps();
    retainTurn(SID, {
      sdkSessionId: SDK,
      data: 'retained prompt',
      model: { providerID: 'openai', modelID: 'gpt-5.4' },
      mcpRoleConfig: null,
    } as Parameters<typeof retainTurn>[1]);
    noteUserMessage(SID, 'user-message-1');
    beginHandoff(SID, 'openai', 'OpenAI exhausted');
    decideHandoff(SID, 'google', 'gemini-2.5-pro', 'gemini');

    expect(await redispatchTurn(SID, d)).toBe(true);
    expect(d.prepare).toHaveBeenCalledWith(SDK, null, 'google');
    expect(d.prepare.mock.invocationCallOrder[0]).toBeLessThan(
      (d.prompt as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
    );
  });

  it('issue-930-c4: visited tiers are skipped and the final tier is terminal', () => {
    // Regression caught: nextFallbackTier had no visited set and could not
    // enforce an at-most-once attempt per tier.
    const authed = ['anthropic', 'openai', 'google', 'openrouter'];
    expect(nextFallbackTier('codex', authed, ['team-claude', 'personal-claude', 'codex']))
      .toMatchObject({ id: 'gemini' });
    expect(
      nextFallbackTier('codex', authed, [
        'team-claude',
        'personal-claude',
        'codex',
        'gemini',
      ]),
    ).toMatchObject({ id: 'openrouter-free' });
    expect(
      nextFallbackTier('openrouter-free', authed, [
        'team-claude',
        'personal-claude',
        'codex',
        'gemini',
        'openrouter-free',
      ]),
    ).toBeUndefined();
  });
});
