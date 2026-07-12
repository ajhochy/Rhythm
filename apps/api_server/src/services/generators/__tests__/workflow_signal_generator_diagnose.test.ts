// USO B2 (#1029) — defaultDiagnose routes the optimizer LLM diagnosis through
// AgentRunner.run() (an observable `self_improvement` session) instead of a
// direct opencode engine call, then feeds run().result into the EXISTING
// JSON diagnosis parser. This suite is a SIBLING file so its `../agent_runner`
// mock stays scoped here and never touches the injected-diagnose describes in
// workflow_signal_generator.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DiagnosisContext } from '../workflow_signal_generator';

// The run() mock — asserted below; resolveRunModel returns a fixed model so we
// can prove modelOverride pins it (run() must NOT re-resolve).
const run = vi.fn();
const FIXED_MODEL = { providerID: 'anthropic', modelID: 'claude-sonnet-4-6' };

vi.mock('../../agent_runner', () => ({
  run: (...a: unknown[]) => run(...a),
  resolveRunModel: () => FIXED_MODEL,
}));

function makeCtx(overrides: Partial<DiagnosisContext> = {}): DiagnosisContext {
  return {
    affectedSkill: 'secretary',
    signals: [
      {
        category: 'retry-loop',
        sessionIds: ['s1'],
        agentConfigId: 'secretary',
        count: 1,
        confidence: 'medium',
        evidence: 'retry-loop across 1 session',
        dedupToken: 'secretary',
      },
    ],
    profile: null,
    agentConfig: null,
    skillBody: null,
    deniedTools: [],
    delegationOutbound: [],
    delegationInbound: [],
    ...overrides,
  };
}

const VALID_DIAGNOSIS = JSON.stringify({
  diagnosis: 'The profile lacks the send-email MCP tool.',
  rootCause: 'scope',
  fixType: 'scope-change',
  concreteFix: 'Add gmail-work to allowedMcps.',
  confidence: 'high',
  scopePatch: { addMcps: ['gmail-work'] },
});

beforeEach(() => {
  run.mockReset();
});

describe('USO B2 #1029: defaultDiagnose via AgentRunner.run()', () => {
  it('calls run() as a self_improvement session with the zero-tool config and pinned model', async () => {
    run.mockResolvedValue({ sessionId: 'sess-1', result: VALID_DIAGNOSIS, status: 'done' });
    const { defaultDiagnose } = await import('../workflow_signal_generator');

    const result = await defaultDiagnose(makeCtx());

    expect(run).toHaveBeenCalledTimes(1);
    const opts = run.mock.calls[0][0];
    expect(opts.category).toBe('self_improvement');
    expect(opts.modelOverride).toEqual(FIXED_MODEL); // pinned — run() must not re-resolve
    expect(opts.mcpRole).toBe('org-optimizer-diagnose');
    expect(opts.allowedMcpsJson).toBe('{}');
    expect(opts.agentConfigId).toBeUndefined(); // null-config is what builds the zero-tool config
    expect(opts.sessionName).toContain('secretary');
    expect(typeof opts.prompt).toBe('string');

    // run().result is fed into the existing parser unchanged.
    expect(result).not.toBeNull();
    expect(result?.rootCause).toBe('scope');
    expect(result?.fixType).toBe('scope-change');
    expect(result?.scopePatch).toEqual({ addMcps: ['gmail-work'] });
  });

  it('parses a fenced JSON result (skills/memory-preface tolerance)', async () => {
    // If run() prepends/wraps the assistant reply, the parser strips a single
    // ```json fence. Prove the diagnosis still parses out of run().result.
    run.mockResolvedValue({
      sessionId: 'sess-2',
      result: '```json\n' + VALID_DIAGNOSIS + '\n```',
      status: 'done',
    });
    const { defaultDiagnose } = await import('../workflow_signal_generator');

    const result = await defaultDiagnose(makeCtx());
    expect(result?.rootCause).toBe('scope');
  });

  it('returns null when run() reports an error or empty result', async () => {
    run.mockResolvedValue({ sessionId: '', result: '', status: 'error', error: 'engine down' });
    const { defaultDiagnose } = await import('../workflow_signal_generator');
    expect(await defaultDiagnose(makeCtx())).toBeNull();
  });

  it('returns null when run().result is unparseable', async () => {
    run.mockResolvedValue({ sessionId: 'sess-3', result: 'sorry, I cannot help', status: 'done' });
    const { defaultDiagnose } = await import('../workflow_signal_generator');
    expect(await defaultDiagnose(makeCtx())).toBeNull();
  });
});
