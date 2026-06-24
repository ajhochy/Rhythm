/**
 * P4-1 — teacher-escalation → draft skill capture.
 *
 * The auto-escalation inside AgentRunner.run() is isTestEnv()-guarded (it never
 * fires under VITEST), so it is NOT exercised here directly. Instead the
 * escalation DECISION and CONTROL FLOW are exposed as two pure/testable units —
 * `shouldEscalate(result, opts, enabled?)` and `escalateAndCapture(opts,
 * originalResult, deps)` with injectable `runFn` + `distillFn` — and those are
 * tested directly. No real model/LLM is ever hit: runFn and distillFn are
 * vi.fn() injections.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  shouldEscalate,
  escalateAndCapture,
  resolveTeacherModel,
  type AgentRunOptions,
  type AgentRunResult,
  type EscalateDeps,
} from '../services/agent_runner';

const TEACHER = { providerID: 'anthropic', modelID: 'claude-opus-4-8' };

function errorResult(overrides: Partial<AgentRunResult> = {}): AgentRunResult {
  return { sessionId: 's-orig', result: '', status: 'error', error: 'boom', ...overrides };
}
function doneResult(overrides: Partial<AgentRunResult> = {}): AgentRunResult {
  return { sessionId: 's-teacher', result: 'ok', status: 'done', ...overrides };
}
function baseOpts(overrides: Partial<AgentRunOptions> = {}): AgentRunOptions {
  return { prompt: 'do the thing', sessionName: 'My run', ...overrides };
}

/** Build EscalateDeps with sensible spies; override piecemeal per test. */
function makeDeps(overrides: Partial<EscalateDeps> = {}): EscalateDeps {
  return {
    runFn: vi.fn().mockResolvedValue(doneResult()),
    distillFn: vi.fn().mockResolvedValue(undefined),
    teacherModel: TEACHER,
    ...overrides,
  };
}

describe('shouldEscalate', () => {
  it('error result + enabled + not-already-escalation → true', () => {
    expect(shouldEscalate(errorResult(), baseOpts(), true)).toBe(true);
  });

  it('non-error (done) result → false', () => {
    expect(shouldEscalate(doneResult(), baseOpts(), true)).toBe(false);
  });

  it('toggle OFF → false even on error', () => {
    expect(shouldEscalate(errorResult(), baseOpts(), false)).toBe(false);
  });

  it('_isEscalation:true original → false (recursion guard)', () => {
    expect(shouldEscalate(errorResult(), baseOpts({ _isEscalation: true }), true)).toBe(false);
  });
});

describe('escalateAndCapture', () => {
  it('re-runs with teacher modelOverride + _isEscalation:true; on done, captures with source=teacher-escalation', async () => {
    const runFn = vi.fn().mockResolvedValue(doneResult({ sessionId: 's-teacher' }));
    const distillFn = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ runFn, distillFn });

    const out = await escalateAndCapture(baseOpts(), errorResult(), deps);

    // runFn called once with teacher model forced + recursion guard set.
    expect(runFn).toHaveBeenCalledOnce();
    const reRunOpts = runFn.mock.calls[0][0] as AgentRunOptions;
    expect(reRunOpts._isEscalation).toBe(true);
    expect(reRunOpts.modelOverride).toEqual(TEACHER);
    expect(reRunOpts.prompt).toBe('do the thing'); // SAME opts
    expect(reRunOpts.sessionName).toBe('My run (teacher escalation)');

    // distill called on the ESCALATED session id with source='teacher-escalation'.
    // (fire-and-forget — flush microtasks so the .then chain runs)
    await Promise.resolve();
    await Promise.resolve();
    expect(distillFn).toHaveBeenCalledOnce();
    expect(distillFn.mock.calls[0][0]).toBe('s-teacher');
    expect(distillFn.mock.calls[0][1]).toEqual({ source: 'teacher-escalation' });

    // returns the SUCCESSFUL escalated result.
    expect(out.status).toBe('done');
    expect(out.sessionId).toBe('s-teacher');
  });

  it('escalated run also error → no distill, no second escalation (runFn called once), returns ORIGINAL error', async () => {
    const runFn = vi.fn().mockResolvedValue(errorResult({ sessionId: 's-teacher', error: 'still broken' }));
    const distillFn = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ runFn, distillFn });

    const original = errorResult({ sessionId: 's-orig', error: 'boom' });
    const out = await escalateAndCapture(baseOpts(), original, deps);

    expect(runFn).toHaveBeenCalledOnce(); // exactly one re-run, no recursion
    expect(distillFn).not.toHaveBeenCalled();
    expect(out).toBe(original); // original error surfaced to the caller
  });

  it('distill is fire-and-forget: a throwing distillFn does NOT reject escalateAndCapture', async () => {
    const runFn = vi.fn().mockResolvedValue(doneResult());
    const distillFn = vi.fn().mockRejectedValue(new Error('distill exploded'));
    const deps = makeDeps({ runFn, distillFn });

    // Must resolve to the successful escalated result, never reject.
    const out = await escalateAndCapture(baseOpts(), errorResult(), deps);
    expect(out.status).toBe('done');
    await Promise.resolve();
    await Promise.resolve();
    expect(distillFn).toHaveBeenCalledOnce();
  });

  it('distill is fire-and-forget: a SYNCHRONOUSLY-throwing distillFn does NOT reject', async () => {
    const runFn = vi.fn().mockResolvedValue(doneResult());
    const distillFn = vi.fn(() => {
      throw new Error('sync explode');
    });
    const deps = makeDeps({ runFn, distillFn: distillFn as unknown as EscalateDeps['distillFn'] });

    const out = await escalateAndCapture(baseOpts(), errorResult(), deps);
    expect(out.status).toBe('done');
    expect(distillFn).toHaveBeenCalledOnce();
  });

  it('a rejecting runFn does NOT throw into the caller — falls back to the original result', async () => {
    const runFn = vi.fn().mockRejectedValue(new Error('re-run blew up'));
    const distillFn = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ runFn, distillFn });

    const original = errorResult({ sessionId: 's-orig' });
    const out = await escalateAndCapture(baseOpts(), original, deps);

    expect(out).toBe(original);
    expect(distillFn).not.toHaveBeenCalled();
  });

  it('captured skill records source=teacher-escalation (asserted via the distillFn arg)', async () => {
    let capturedSource: string | undefined;
    const distillFn = vi.fn(async (_sid: string, opts?: { source?: string }) => {
      capturedSource = opts?.source;
      return undefined;
    });
    const deps = makeDeps({ runFn: vi.fn().mockResolvedValue(doneResult()), distillFn });

    await escalateAndCapture(baseOpts(), errorResult(), deps);
    await Promise.resolve();
    await Promise.resolve();
    expect(capturedSource).toBe('teacher-escalation');
  });
});

describe('resolveTeacherModel', () => {
  it("parses 'provider/modelId'", () => {
    expect(resolveTeacherModel('anthropic/claude-opus-4-8')).toEqual({
      providerID: 'anthropic',
      modelID: 'claude-opus-4-8',
    });
  });

  it('preserves slashes in the model id (splits on the first / only)', () => {
    expect(resolveTeacherModel('openrouter/anthropic/claude-opus')).toEqual({
      providerID: 'openrouter',
      modelID: 'anthropic/claude-opus',
    });
  });

  it('returns undefined for malformed values', () => {
    expect(resolveTeacherModel('')).toBeUndefined();
    expect(resolveTeacherModel('noslash')).toBeUndefined();
    expect(resolveTeacherModel('/leading')).toBeUndefined();
    expect(resolveTeacherModel('trailing/')).toBeUndefined();
  });
});
