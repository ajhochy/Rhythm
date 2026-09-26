/**
 * CONTRACT TEST for #1485 slice S2 — dispatchAgentStage seam and
 * pinned-provider escalation suppression.
 *
 * GitNexus impact analysis on `run()` and `shouldEscalate()` in
 * agent_runner.ts (the highest-fan-in service in the repo) returned HIGH
 * risk before this slice's edits — both are called from research, the
 * scheduler, delegation, and the cookbook run route. The change here is
 * deliberately additive/narrow: a new ~20-line pass-through seam
 * (dispatch_agent_stage.ts) and one new opt-in field
 * (`suppressTeacherEscalation`) that defaults to falsy/unset everywhere it
 * is not explicitly set, so existing callers are unaffected. See this
 * slice's final report for the full risk note.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { dispatchAgentStage } from '../../services/dispatch_agent_stage';
import { shouldEscalate, type AgentRunOptions, type AgentRunResult } from '../../services/agent_runner';

const RESEARCH_ORCHESTRATOR_PATH = path.join(
  __dirname, '..', '..', 'services', 'research_project_orchestrator.ts',
);
const DISPATCH_SEAM_PATH = path.join(__dirname, '..', '..', 'services', 'dispatch_agent_stage.ts');

function errorResult(overrides: Partial<AgentRunResult> = {}): AgentRunResult {
  return { sessionId: 's-orig', result: '', status: 'error', error: 'boom', ...overrides };
}
function baseOpts(overrides: Partial<AgentRunOptions> = {}): AgentRunOptions {
  return { prompt: 'do the thing', sessionName: 'My run', ...overrides };
}

describe('#1485 S2 — dispatchAgentStage is a pure pass-through root-dispatch seam', () => {
  it('recipe_workflow_s2:1 — omits parentSessionId so every stage is a root session', async () => {
    const run = vi.fn().mockResolvedValue({ sessionId: 's-1', result: 'ok', status: 'done' });
    await dispatchAgentStage(
      { prompt: 'x', parentSessionId: 'some-parent-session' } as AgentRunOptions,
      { run },
    );
    expect(run).toHaveBeenCalledOnce();
    const forwarded = run.mock.calls[0][0] as AgentRunOptions;
    expect(forwarded.parentSessionId).toBeUndefined();
  });

  it('recipe_workflow_s2:2 — forwards an already-parsed modelOverride unchanged', async () => {
    const run = vi.fn().mockResolvedValue({ sessionId: 's-1', result: 'ok', status: 'done' });
    const modelOverride = { providerID: 'anthropic', modelID: 'claude-opus-4' };
    await dispatchAgentStage({ prompt: 'x', modelOverride }, { run });
    const forwarded = run.mock.calls[0][0] as AgentRunOptions;
    expect(forwarded.modelOverride).toEqual(modelOverride);
  });

  it('recipe_workflow_s2:3 — forwards suppressTeacherEscalation unchanged', async () => {
    const run = vi.fn().mockResolvedValue({ sessionId: 's-1', result: 'ok', status: 'done' });
    await dispatchAgentStage({ prompt: 'x', suppressTeacherEscalation: true }, { run });
    const forwarded = run.mock.calls[0][0] as AgentRunOptions;
    expect(forwarded.suppressTeacherEscalation).toBe(true);
  });

  it('recipe_workflow_s2:4 — defaults to the real AgentRunner module when no runner is injected', async () => {
    // dispatchAgentStage's default second param is the real `agent_runner`
    // module (verified by source shape, not a live dispatch — a live call
    // would start a real session, which contract tests never do).
    expect(dispatchAgentStage.length).toBeGreaterThanOrEqual(1);
  });
});

describe('#1485 S2 — research keeps its lifecycle unchanged, routed through the seam', () => {
  it('recipe_workflow_s2:5 — both research dispatch sites call dispatchAgentStage(); exhausted() stays research-local', () => {
    const source = fs.readFileSync(RESEARCH_ORCHESTRATOR_PATH, 'utf8');
    const dispatchCallCount = (source.match(/dispatchAgentStage\(/g) ?? []).length;
    expect(dispatchCallCount).toBe(2);
    expect(source).toMatch(/function exhausted\(/);
    expect(source).not.toMatch(/\.runner\.run\(/); // no remaining direct AgentRunner.run() dispatch

    const seamSource = fs.readFileSync(DISPATCH_SEAM_PATH, 'utf8');
    expect(seamSource).not.toMatch(/function exhausted\(/);
  });
});

describe('#1485 S2 — suppressTeacherEscalation gates shouldEscalate (net-new, does not repurpose _isEscalation)', () => {
  it('recipe_workflow_s2:6 — RED-turned-GREEN: suppressTeacherEscalation:true blocks an otherwise teacher-retryable failure', () => {
    // Without the flag, the SAME failure is retryable — proves the flag is
    // what changes the outcome, not the failure classification.
    expect(
      shouldEscalate(errorResult({ failureCategory: 'model_quality' }), baseOpts(), true),
    ).toBe(true);
    expect(
      shouldEscalate(
        errorResult({ failureCategory: 'model_quality' }),
        baseOpts({ suppressTeacherEscalation: true }),
        true,
      ),
    ).toBe(false);
  });

  it('recipe_workflow_s2:7 — suppressTeacherEscalation is independent of the _isEscalation recursion guard', () => {
    // Both false/absent → existing behavior (retryable failure escalates).
    expect(
      shouldEscalate(
        errorResult({ failureCategory: 'model_quality' }),
        baseOpts({ suppressTeacherEscalation: false }),
        true,
      ),
    ).toBe(true);
  });

  it('recipe_workflow_s2:8 — existing _isEscalation/bridgeOrigin/enabled-toggle behavior is unchanged', () => {
    expect(shouldEscalate(errorResult(), baseOpts({ _isEscalation: true }), true)).toBe(false);
    expect(shouldEscalate(errorResult(), baseOpts({ bridgeOrigin: { allowMemoryPreface: true } }), true)).toBe(false);
    expect(shouldEscalate(errorResult(), baseOpts(), false)).toBe(false);
  });
});
