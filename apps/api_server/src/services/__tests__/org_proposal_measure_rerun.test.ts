/**
 * USO B4 (#1031) — the org-optimizer behavioral re-run (keep/revert measure
 * path) must route through AgentRunner.run() so it becomes an observable
 * `self_improvement` session, while preserving the keep/revert measurement
 * semantics (#981 refine-task / #821 measure paths depend on the outcome).
 *
 * These assert the routing contract and that keep/revert reads `res.result`:
 *   - run() is invoked with category:'self_improvement', the resolved model as
 *     modelOverride, mcpRole=patchedProfileId, and allowedMcpsJson:'{}'.
 *   - a clean res.result (no reproduced signature) → 'completed' (KEEP).
 *   - a reproduced-failure res.result → 'failed' (REVERT).
 *   - an empty/near-empty res.result → 'failed' (transport-empty).
 *   - run() status:'error' → 'infra-error' (same contract as the old !resp).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const runMock = vi.fn();
const resolveRunModelMock = vi.fn((_id?: string | null) => ({ providerID: 'anthropic', modelID: 'claude-sonnet-4-6' }));
const listBySessionMock = vi.fn((_sid?: string) => [] as unknown[]);

vi.mock('../agent_runner', () => ({
  run: (opts: unknown) => runMock(opts),
  resolveRunModel: (id?: string | null) => resolveRunModelMock(id),
}));

vi.mock('../../repositories/agent_session_messages_repository', () => ({
  AgentSessionMessagesRepository: class {
    listBySession(sid: string) {
      return listBySessionMock(sid);
    }
  },
}));

// Keep the failure classifier deterministic: no detector fires unless a test
// opts in. classifyRerunFailure now runs these over the REAL persisted
// messages for the rerun session (see listBySessionMock) — mocked here only
// to keep this file's focus on run()-routing, not detector behavior (that's
// covered by workflow_failure_signal_extractor.test.ts and the
// org_proposal_measure_rerun_integration.test.ts real-extractor suite).
//
// The terminal-success/integrity check itself is NOT mocked — classifyRerunFailure
// consumes the real `persisted_tool_evidence.ts` parser directly, so
// `listBySessionMock`'s fixture data must be producer-valid to be read as a
// genuine clean pass (see PRODUCER_VALID_SUCCESS_MESSAGES below).
const detectRetryLoopSignals = vi.fn(() => [] as { category: string }[]);
vi.mock('../workflow_failure_signal_extractor', () => ({
  detectRetryLoopSignals: (...args: unknown[]) => detectRetryLoopSignals(...(args as [])),
  detectHallucinatedClaimSignals: () => [],
  detectUnverifiedClaimSignals: () => [],
  detectToolUnavailableSignals: () => [],
  detectRepeatedCorrectionSignals: () => [],
  detectDelegateResultSignals: () => [],
}));

import { defaultRerunScenario } from '../org_proposal_measure';
import type { AgentOrgProposal } from '../../models/agent_org_proposal';

const proposal = { id: 'prop-1' } as AgentOrgProposal;
const ctx = {
  patchedProfileId: 'cfg-abc',
  sessionIds: ['sess-1'],
  categories: ['retry-loop'],
};

/** A replayable prompt message — read by defaultRerunScenario to find the original prompt. */
const REPLAYABLE_INPUT = { role: 'input', strippedText: 'do the failing thing', partsJson: null, sdkMessageId: null };

/** A single producer-valid completed, non-MCP-error tool part — genuine terminal success evidence. */
function terminalSuccessMessage() {
  return {
    role: 'output',
    strippedText: '',
    sdkMessageId: 'msg-rerun-1',
    partsJson: JSON.stringify([
      {
        id: 'prt-rerun-1',
        type: 'tool',
        sessionID: 'ses-rerun',
        messageID: 'msg-rerun-1',
        callID: 'call-rerun-1',
        tool: 'bash',
        state: {
          status: 'completed',
          input: { cmd: 'echo ok' },
          output: 'ok',
          title: 'Tool result',
          metadata: {},
          time: { start: 0, end: 1 },
        },
      },
    ]),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  detectRetryLoopSignals.mockReturnValue([]);
  resolveRunModelMock.mockReturnValue({ providerID: 'anthropic', modelID: 'claude-sonnet-4-6' });
  listBySessionMock.mockReturnValue([REPLAYABLE_INPUT, terminalSuccessMessage()]);
});

describe('defaultRerunScenario routes the behavioral re-run through AgentRunner.run', () => {
  it('routes as a self_improvement run with the resolved model, role, and empty MCP allowlist', async () => {
    runMock.mockResolvedValue({
      sessionId: 'rerun-sess',
      status: 'done',
      result: 'A sufficiently long, clean output with no failure signature at all.',
    });

    const outcome = await defaultRerunScenario(proposal, ctx);

    expect(runMock).toHaveBeenCalledTimes(1);
    const opts = runMock.mock.calls[0][0];
    expect(opts).toMatchObject({
      prompt: 'do the failing thing',
      category: 'self_improvement',
      modelOverride: { providerID: 'anthropic', modelID: 'claude-sonnet-4-6' },
      mcpRole: 'cfg-abc',
      allowedMcpsJson: '{}',
    });
    // Observable session name carries the proposal id.
    expect(opts.sessionName).toContain('prop-1');
    // Clean res.result → KEEP.
    expect(outcome.status).toBe('completed');
  });

  it('reads res.result for the keep decision — a reproduced signature → failed (REVERT)', async () => {
    // A detector now emits the same category the proposal was diagnosed for.
    detectRetryLoopSignals.mockReturnValue([{ category: 'retry-loop' }]);

    runMock.mockResolvedValue({
      sessionId: 'rerun-sess',
      status: 'done',
      result: 'Retrying again and again, the same output that still fails the task.',
    });

    const outcome = await defaultRerunScenario(proposal, ctx);
    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toContain('retry-loop');
  });

  it('treats a near-empty res.result as transport-empty → failed', async () => {
    runMock.mockResolvedValue({ sessionId: 'rerun-sess', status: 'done', result: 'too short' });
    const outcome = await defaultRerunScenario(proposal, ctx);
    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toContain('no substantive output');
  });

  it('maps run() status:error to infra-error (same contract as the old !resp path)', async () => {
    runMock.mockResolvedValue({ sessionId: 'rerun-sess', status: 'error', result: '', error: 'engine down' });
    const outcome = await defaultRerunScenario(proposal, ctx);
    expect(outcome.status).toBe('infra-error');
    expect(outcome.reason).toContain('engine down');
  });

  it('returns infra-error when no replayable prompt exists (never calls run)', async () => {
    listBySessionMock.mockReturnValue([]);
    const outcome = await defaultRerunScenario(proposal, ctx);
    expect(outcome.status).toBe('infra-error');
    expect(runMock).not.toHaveBeenCalled();
  });

  it('W3 corrective: retry-loop category with NO structured tool-attempt evidence at all -> infra-error, never completed', async () => {
    // Nothing reproduced AND no readable tool-attempt evidence at all — this
    // must NEVER be treated as a clean pass (that was the original bug: a
    // synthetic partsJson:null double always looked evidence-free and always
    // kept). The rerun session's real persisted messages carry only the
    // replayable prompt, no tool parts whatsoever.
    listBySessionMock.mockReturnValue([REPLAYABLE_INPUT]);
    runMock.mockResolvedValue({
      sessionId: 'rerun-sess',
      status: 'done',
      result: 'A sufficiently long, clean-looking output with no lexical failure signature.',
    });

    const outcome = await defaultRerunScenario(proposal, ctx);

    expect(outcome.status).toBe('infra-error');
    expect(outcome.reason).toContain('inconclusive');
  });

  it('W3 final architectural corrective: retry-loop category with ONLY a pending tool attempt -> infra-error, never completed', async () => {
    // A nonzero attempt count is not proof of a clean pass — a lone pending
    // attempt is exactly zero terminal success evidence.
    listBySessionMock.mockReturnValue([
      REPLAYABLE_INPUT,
      {
        role: 'output',
        strippedText: '',
        sdkMessageId: 'msg-rerun-1',
        partsJson: JSON.stringify([
          {
            id: 'prt-rerun-1', type: 'tool', sessionID: 'ses-rerun', messageID: 'msg-rerun-1',
            callID: 'call-rerun-1', tool: 'bash', state: { status: 'pending', input: {}, raw: 'echo ok' },
          },
        ]),
      },
    ]);
    runMock.mockResolvedValue({
      sessionId: 'rerun-sess',
      status: 'done',
      result: 'A sufficiently long, clean-looking output with no lexical failure signature.',
    });

    const outcome = await defaultRerunScenario(proposal, ctx);

    expect(outcome.status).toBe('infra-error');
    expect(outcome.reason).toContain('inconclusive');
  });
});
