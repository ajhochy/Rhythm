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
  redispatchTurn,
  _resetForTests,
  RedispatchDeps,
} from '../turn_redispatch';

const SID = 'local-session-1';
const SDK = 'sdk-session-1';
const MSG = 'msg_user_1';

function makeDeps(overrides?: Partial<RedispatchDeps>): RedispatchDeps & {
  revert: ReturnType<typeof vi.fn>;
  prompt: ReturnType<typeof vi.fn>;
  clearError: ReturnType<typeof vi.fn>;
  setError: ReturnType<typeof vi.fn>;
} {
  return {
    revert: vi.fn().mockResolvedValue(undefined),
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

describe('race ordering A — session.error arrives while the route is deciding', () => {
  it('defers the error, then decideHandoff → redispatch-now → revert + re-prompt on the new provider', async () => {
    seedTurn();
    beginHandoff(SID);
    expect(onSessionError(SID, 'anthropic 429')).toBe('defer');

    expect(decideHandoff(SID, 'openai', 'gpt-5.3-codex', false)).toBe('redispatch-now');

    const deps = makeDeps();
    await expect(redispatchTurn(SID, deps)).resolves.toBe(true);
    expect(deps.clearError).toHaveBeenCalledWith(SID);
    expect(deps.revert).toHaveBeenCalledWith(SDK, MSG);
    expect(deps.prompt).toHaveBeenCalledWith(
      SDK,
      'PREFACE\n\noriginal user prompt',
      { providerID: 'openai', modelID: 'gpt-5.3-codex' },
      '/tmp/work',
      { permissionMode: 'bypassPermissions' },
      [{ type: 'text', text: 'PREFACE\n\noriginal user prompt' }],
    );
    expect(deps.setError).not.toHaveBeenCalled();
  });
});

describe('race ordering B — route decides before session.error arrives', () => {
  it('decideHandoff → await-error; the arriving error returns redispatch and the re-dispatch succeeds', async () => {
    seedTurn();
    beginHandoff(SID);
    expect(decideHandoff(SID, 'google', 'gemini-2.5-pro', false)).toBe('await-error');

    expect(onSessionError(SID, 'anthropic 529')).toBe('redispatch');

    const deps = makeDeps();
    await expect(redispatchTurn(SID, deps)).resolves.toBe(true);
    expect(deps.revert).toHaveBeenCalledWith(SDK, MSG);
    expect(deps.prompt).toHaveBeenCalledWith(
      SDK,
      expect.any(String),
      { providerID: 'google', modelID: 'gemini-2.5-pro' },
      '/tmp/work',
      expect.anything(),
      expect.anything(),
    );
  });
});

describe('error-first ordering — the bridge finalized status=error before the route intake', () => {
  it('decideHandoff(sessionAlreadyErrored=true) → redispatch-now and clearError is invoked', async () => {
    seedTurn();
    beginHandoff(SID);
    expect(decideHandoff(SID, 'openai', 'gpt-5.3-codex', true)).toBe('redispatch-now');

    const deps = makeDeps();
    await expect(redispatchTurn(SID, deps)).resolves.toBe(true);
    expect(deps.clearError).toHaveBeenCalledWith(SID);
  });
});

describe('at-most-once', () => {
  it('a session.error AFTER a successful re-dispatch finalizes normally — no second retry', async () => {
    seedTurn();
    beginHandoff(SID);
    decideHandoff(SID, 'openai', 'gpt-5.3-codex', false);
    expect(onSessionError(SID, 'anthropic 429')).toBe('redispatch');
    await redispatchTurn(SID, makeDeps());

    // The RETRY turn fails (e.g. #913 tool-pairing 400 on the new provider):
    expect(onSessionError(SID, 'openai 400 tool pairing')).toBe('finalize');
    // And there is no lingering state — a further error also finalizes.
    expect(onSessionError(SID, 'again')).toBe('finalize');
  });
});

describe('retained-turn buffer lifecycle', () => {
  it('clearTurn on normal completion drops the buffer → later re-dispatch declines and finalizes the error', async () => {
    seedTurn();
    clearTurn(SID); // turn completed normally (session.idle)

    beginHandoff(SID);
    onSessionError(SID, 'anthropic 429');
    decideHandoff(SID, 'openai', 'gpt-5.3-codex', false);
    const deps = makeDeps();
    await expect(redispatchTurn(SID, deps)).resolves.toBe(false);
    expect(deps.revert).not.toHaveBeenCalled();
    expect(deps.prompt).not.toHaveBeenCalled();
    expect(deps.setError).toHaveBeenCalledWith(SID, 'anthropic 429');
  });

  it('clearTurn is a no-op while a handoff decision is in flight (idle-after-error race)', async () => {
    seedTurn();
    beginHandoff(SID);
    onSessionError(SID, 'anthropic 429'); // deferred; engine now emits session.idle
    clearTurn(SID); // must NOT wipe the retained turn mid-decision

    decideHandoff(SID, 'openai', 'gpt-5.3-codex', false);
    const deps = makeDeps();
    await expect(redispatchTurn(SID, deps)).resolves.toBe(true);
  });

  it('a missing revert target (no user message seen) declines rather than guessing', async () => {
    retainTurn(SID, { sdkSessionId: SDK, data: 'x' }); // no noteUserMessage
    beginHandoff(SID);
    onSessionError(SID, 'anthropic 429');
    decideHandoff(SID, 'openai', 'gpt-5.3-codex', false);
    const deps = makeDeps();
    await expect(redispatchTurn(SID, deps)).resolves.toBe(false);
    expect(deps.setError).toHaveBeenCalledWith(SID, 'anthropic 429');
  });

  it('retainTurn for a NEW user turn resets stale handoff state', () => {
    seedTurn();
    beginHandoff(SID);
    decideHandoff(SID, 'openai', 'gpt-5.3-codex', false); // stale 'decided'
    seedTurn(); // next user turn
    expect(onSessionError(SID, 'unrelated failure')).toBe('finalize');
  });

  it('buffer is bounded: oldest entry evicted past the cap', async () => {
    for (let i = 0; i < 200; i++) {
      retainTurn(`s-${i}`, { sdkSessionId: `sdk-${i}`, data: 'd' });
    }
    seedTurn('s-overflow'); // 201st insert — evicts s-0
    beginHandoff('s-0');
    onSessionError('s-0', 'err');
    decideHandoff('s-0', 'openai', 'gpt-5.3-codex', false);
    const deps = makeDeps();
    await expect(redispatchTurn('s-0', deps)).resolves.toBe(false); // retained turn gone

    beginHandoff('s-overflow');
    onSessionError('s-overflow', 'err');
    decideHandoff('s-overflow', 'openai', 'gpt-5.3-codex', false);
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
    decideHandoff(SID, 'openai', 'gpt-5.3-codex', false);
    const deps = makeDeps({ revert: vi.fn().mockRejectedValue(new Error('revert 502')) });
    await expect(redispatchTurn(SID, deps)).resolves.toBe(false);
    expect(deps.setError).toHaveBeenCalledWith(SID, 'anthropic 429');
    expect(onSessionError(SID, 'later')).toBe('finalize'); // at-most-once held
  });

  it('promptAsync returning false (silent no-op) finalizes rather than hanging', async () => {
    seedTurn();
    beginHandoff(SID);
    onSessionError(SID, 'anthropic 429');
    decideHandoff(SID, 'openai', 'gpt-5.3-codex', false);
    const deps = makeDeps({ prompt: vi.fn().mockResolvedValue(false) });
    await expect(redispatchTurn(SID, deps)).resolves.toBe(false);
    expect(deps.setError).toHaveBeenCalledWith(SID, 'anthropic 429');
  });
});
