/**
 * Workstream C — an AUTH failure must hop the #930 fallback cascade.
 *
 * Before this suite, `onSessionError` only cascaded on `classifyProviderError
 * === 'rate_limit'`; 'auth' and 'other' finalized the turn. That made the
 * user's canonical scenario — "personal account not authed, switch to team,
 * then Codex, then Gemini..." — a no-op on BOTH desktop clients whenever the
 * failure was a credential problem rather than a quota problem.
 *
 * Run: cd apps/api_server && npx vitest run src/services/__tests__/turn_redispatch_auth_cascade.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../opencode_engine', () => ({
  opencodeClient: {},
  opencodeSessionMap: new Map<string, string>(),
}));

import {
  retainTurn,
  noteUserMessage,
  onSessionError,
  advanceFallbackCascade,
  redispatchTurn,
  _resetForTests,
  RedispatchDeps,
} from '../turn_redispatch';

const SID = 'local-session-auth';
const SDK = 'sdk-session-auth';
const MSG = 'msg_user_auth';

function engineDeps(): RedispatchDeps {
  return {
    abort: vi.fn().mockResolvedValue(true),
    revert: vi.fn().mockResolvedValue(undefined),
    prepare: vi.fn().mockResolvedValue(true),
    prompt: vi.fn().mockResolvedValue(true),
    clearError: vi.fn(),
    setError: vi.fn(),
  };
}

function seedAnthropicTurn(): void {
  retainTurn(SID, {
    sdkSessionId: SDK,
    data: 'PREFACE\n\noriginal user prompt',
    cwd: '/tmp/work',
    model: { providerID: 'anthropic', modelID: 'claude-opus-4-7' },
    mcpRoleConfig: null,
  });
  noteUserMessage(SID, MSG);
}

beforeEach(() => {
  _resetForTests();
});

describe('auth failures hop the cascade', () => {
  it('a 401 on the active tier cascades instead of finalizing', () => {
    seedAnthropicTurn();
    expect(
      onSessionError(SID, 'Anthropic 401 invalid bearer token', {
        name: 'APIError',
        data: { statusCode: 401 },
      }),
    ).toBe('cascade');
  });

  it('the plugin "no usable account" throw cascades (it carries no HTTP status)', () => {
    seedAnthropicTurn();
    const message =
      'Rhythm account store has no usable Anthropic account — connect one in Settings.';
    expect(onSessionError(SID, message, { message })).toBe('cascade');
  });

  it('an expired-credentials throw cascades', () => {
    seedAnthropicTurn();
    const message =
      'Claude Code credentials are unavailable or expired. Run `claude` to refresh them.';
    expect(onSessionError(SID, message, { message })).toBe('cascade');
  });

  it('walks each authed tier at most once, then terminates (no retry storm)', async () => {
    seedAnthropicTurn();
    const engine = engineDeps();
    const cascadeDeps = {
      listAuthedProviders: vi
        .fn()
        .mockResolvedValue(['anthropic', 'openai', 'google', 'openrouter']),
      persistDecision: vi.fn(),
      notifyDecision: vi.fn(),
      redispatch: (id: string) => redispatchTurn(id, engine),
    };
    const authErr = { name: 'APIError', data: { statusCode: 401 } };

    expect(onSessionError(SID, 'anthropic 401', authErr)).toBe('cascade');
    expect(
      await advanceFallbackCascade(SID, { message: 'anthropic 401' }, cascadeDeps),
    ).toMatchObject({ outcome: 'redispatched', decision: { providerID: 'openai' } });

    expect(onSessionError(SID, 'openai 401', authErr)).toBe('cascade');
    expect(
      await advanceFallbackCascade(SID, { message: 'openai 401' }, cascadeDeps),
    ).toMatchObject({ outcome: 'redispatched', decision: { providerID: 'google' } });

    expect(onSessionError(SID, 'google 403', authErr)).toBe('cascade');
    expect(
      await advanceFallbackCascade(SID, { message: 'google 403' }, cascadeDeps),
    ).toMatchObject({ outcome: 'redispatched', decision: { providerID: 'openrouter' } });

    expect(onSessionError(SID, 'openrouter 401', authErr)).toBe('cascade');
    const terminal = await advanceFallbackCascade(
      SID,
      { message: 'openrouter 401' },
      cascadeDeps,
    );
    expect(terminal.outcome).toBe('terminal');
    // Bounded: three hops off the starting tier, never a fourth.
    expect(cascadeDeps.persistDecision).toHaveBeenCalledTimes(3);
  });

  it('non-auth, non-rate-limit errors still finalize (unchanged)', () => {
    seedAnthropicTurn();
    expect(
      onSessionError(SID, 'tool_use ids were found without tool_result', {
        name: 'APIError',
        data: { statusCode: 400 },
      }),
    ).toBe('finalize');
  });

  it('the handoff signal names the error class so the UI can say WHY it moved', async () => {
    seedAnthropicTurn();
    const notifyDecision = vi.fn();
    onSessionError(SID, 'anthropic 401', { name: 'APIError', data: { statusCode: 401 } });
    await advanceFallbackCascade(
      SID,
      { message: 'anthropic 401' },
      {
        listAuthedProviders: vi.fn().mockResolvedValue(['anthropic', 'openai']),
        persistDecision: vi.fn(),
        notifyDecision,
        redispatch: (id: string) => redispatchTurn(id, engineDeps()),
      },
    );
    expect(notifyDecision).toHaveBeenCalledWith(
      SID,
      expect.objectContaining({ providerID: 'openai' }),
      expect.objectContaining({ errorClass: 'auth' }),
    );
  });
});
