/**
 * C1/C2-C — pre-dispatch experiment enrollment ordering contract.
 *
 * Required behavior: AgentRunner must call reserveRunEnrollment() before
 * opencodeClient.prompt(), and the reserved -> dispatched transition (with
 * its immutable receipt) must happen ONLY inside the real prompt-dispatch
 * boundary's `beforeDispatch` hook — i.e. after `mockPrompt` is invoked
 * (representing the real OpencodeClientService constructing its SDK
 * request), immediately before the (mocked) SDK call it wraps. This file
 * mocks `opencode_engine` wholesale, so `mockPrompt`'s own implementation is
 * responsible for invoking the passed `beforeDispatch` hook (its 6th
 * positional argument) to faithfully mirror that real contract — the actual
 * ordering/throw-propagation guarantee at the OpencodeClientService layer is
 * pinned independently in opencode_client_service.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';

const {
  mockCreateSession,
  mockPrompt,
  mockAbortSession,
  mockReserveRunEnrollment,
  mockCommitReservedTreatmentDispatch,
  mockMarkRunEnrollmentPreDispatchFailed,
  mockMarkRunEnrollmentTargetDrifted,
  mockPrepareReservedTreatment,
} =
  vi.hoisted(() => ({
    mockCreateSession: vi.fn(),
    mockPrompt: vi.fn(),
    mockAbortSession: vi.fn(),
    mockReserveRunEnrollment: vi.fn(),
    mockCommitReservedTreatmentDispatch: vi.fn(),
    mockMarkRunEnrollmentPreDispatchFailed: vi.fn(),
    mockMarkRunEnrollmentTargetDrifted: vi.fn(),
    mockPrepareReservedTreatment: vi.fn(),
  }));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    get isReady() {
      return true;
    },
    createSession: mockCreateSession,
    prompt: mockPrompt,
    promptAsync: vi.fn(),
    abortSession: mockAbortSession,
    listMessages: vi.fn().mockResolvedValue([]),
  },
  opencodeSessionMap: new Map<string, string>(),
}));

vi.mock('../services/org_proposal_experiment_service', () => ({
  reserveRunEnrollment: mockReserveRunEnrollment,
  commitReservedTreatmentDispatch: mockCommitReservedTreatmentDispatch,
  markRunEnrollmentPreDispatchFailed: mockMarkRunEnrollmentPreDispatchFailed,
  markRunEnrollmentTargetDrifted: mockMarkRunEnrollmentTargetDrifted,
  prepareReservedTreatment: mockPrepareReservedTreatment,
  // Ordering-only fixtures in this file never throw this — plain `Error`
  // rejections exercise the generic (non-collision) lifecycle-error branch.
  // Still exported so AgentRunner's `instanceof` check has a real class to
  // check against instead of an undefined mock export.
  RunEnrollmentProfileCollisionError: class RunEnrollmentProfileCollisionError extends Error {},
}));

let activeDb: Database.Database | null = null;
function makeDb(): void {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  activeDb = db;
}

function teardownDb(): void {
  if (activeDb) {
    try {
      activeDb.close();
    } catch {
      // Ignore.
    }
    activeDb = null;
  }
}

describe('C1/C2-C — pre-dispatch enrollment is ordered before prompt dispatch, commit happens only at the real dispatch boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    makeDb();
    mockCreateSession.mockResolvedValue({ id: 'sdk-session-c1' });
    // Mirrors the real OpencodeClientService.prompt() boundary contract: the
    // hook (6th positional arg) runs, and only on success does the "SDK
    // call" (this mock's own resolution) proceed. A throwing hook propagates
    // unchanged and no "SDK call" (successful resolution) happens.
    mockPrompt.mockImplementation(async (_sid, _text, _model, _cwd, _opts, beforeDispatch) => {
      if (beforeDispatch) {
        await beforeDispatch();
      }
      return {
        info: { sessionID: 'sdk-session-c1' },
        parts: [{ type: 'text', text: 'Done' }],
      };
    });
    mockAbortSession.mockResolvedValue(true);
    mockMarkRunEnrollmentPreDispatchFailed.mockResolvedValue({
      status: 'applied',
      current: null,
    });
    mockMarkRunEnrollmentTargetDrifted.mockResolvedValue({
      status: 'applied',
      current: null,
    });
    // Ordering-only fixtures in this file are not exercising C2-A/C2-C
    // treatment preparation/commit details (see c2_a_reserved_treatment_dispatch.test.ts
    // for that) — a reserved enrollment here always prepares 'ready' and
    // commits successfully so dispatch proceeds.
    mockPrepareReservedTreatment.mockResolvedValue({
      status: 'ready',
      systemPromptOverride: 'irrelevant-to-this-fixture',
      receiptMaterial: {
        profileRevision: 1,
        targetRef: 'agent_config:agent-1',
        targetRevisionHash: 'sha256:' + '0'.repeat(64),
        treatmentSpecHash: '1'.repeat(64),
        effectivePromptHash: '2'.repeat(64),
      },
    });
    mockCommitReservedTreatmentDispatch.mockResolvedValue({
      id: 'receipt-id',
      runEpisodeId: 'irrelevant-to-this-fixture',
      cohort: 'baseline',
      finalizedAt: new Date().toISOString(),
    });
  });

  afterEach(() => {
    teardownDb();
    vi.restoreAllMocks();
  });

  async function freshRun() {
    const { run } = await import('../services/agent_runner');
    return run;
  }

  async function mockScope(overrides: Record<string, unknown> = {}) {
    const scopeModule = await import('../services/agent_profile_scope');
    vi.spyOn(scopeModule, 'resolveProfileScope').mockResolvedValue({
      model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-5' },
      mcpRoleConfig: null,
      allowedSkillsJson: null,
      systemPrompt: null,
      ocAgent: null,
      modelTierHint: null,
      ...overrides,
    } as never);
  }

  function reservedFixture(overrides: Record<string, unknown> = {}) {
    return {
      id: 'enrollment-id',
      runEpisodeId: 'run-episode',
      experimentId: 'exp-1',
      proposalId: 'proposal-1',
      profileId: 'agent-1',
      cohort: 'baseline',
      assignmentDigest: 'assign',
      baselineTargetRevisionHash: 'base',
      treatmentSpecHash: 'treat',
      state: 'reserved',
      reservedAt: new Date().toISOString(),
      failureCode: null,
      failureReason: null,
      ...overrides,
    };
  }

  it('reserves before preparing, and the commit hook runs INSIDE prompt() — after prompt() is invoked, before it resolves', async () => {
    await mockScope();
    let sessionId = '';
    mockReserveRunEnrollment.mockResolvedValue(reservedFixture());
    const run = await freshRun();

    await run({
      prompt: 'Hello',
      agentConfigId: 'agent-1',
      onSessionCreated: (id) => {
        sessionId = id;
      },
    });

    expect(mockReserveRunEnrollment).toHaveBeenCalledTimes(1);
    expect(mockReserveRunEnrollment).toHaveBeenCalledWith(sessionId, 'agent-1');
    expect(mockPrepareReservedTreatment).toHaveBeenCalledTimes(1);
    expect(mockPrompt).toHaveBeenCalledTimes(1);
    expect(mockCommitReservedTreatmentDispatch).toHaveBeenCalledTimes(1);

    // Never a standalone dispatched-transition call outside the hook: the
    // ONLY dispatch-commit surface is commitReservedTreatmentDispatch, and it
    // is invoked with the exact reserved enrollment + ready preparation.
    const [passedEnrollment, passedPreparation] = mockCommitReservedTreatmentDispatch.mock.calls[0];
    expect(passedEnrollment.runEpisodeId).toBe('run-episode');
    expect(passedPreparation.status).toBe('ready');

    expect(mockReserveRunEnrollment.mock.invocationCallOrder[0]).toBeLessThan(
      mockPrepareReservedTreatment.mock.invocationCallOrder[0],
    );
    expect(mockPrepareReservedTreatment.mock.invocationCallOrder[0]).toBeLessThan(
      mockPrompt.mock.invocationCallOrder[0],
    );
    expect(mockPrompt.mock.invocationCallOrder[0]).toBeLessThan(
      mockCommitReservedTreatmentDispatch.mock.invocationCallOrder[0],
    );
  });

  it('preserves explicit runEpisodeId (scheduled/occurrence-style IDs)', async () => {
    await mockScope();
    const run = await freshRun();
    const scheduledOccurrenceId = 'scheduled-occurrence-2026-08-17';

    await run({
      prompt: 'Hello',
      agentConfigId: 'agent-1',
      runEpisodeId: scheduledOccurrenceId,
    });

    expect(mockReserveRunEnrollment).toHaveBeenCalledTimes(1);
    expect(mockReserveRunEnrollment).toHaveBeenCalledWith(
      scheduledOccurrenceId,
      'agent-1',
    );
  });

  it('returns error and routes reserve errors to terminalization without prompt', async () => {
    await mockScope();
    const outcomeModule = await import('../services/run_outcome_service');
    const outcomeSpy = vi
      .spyOn(outcomeModule, 'recordTerminalOutcome')
      .mockResolvedValue(undefined);

    const runEpisodeId = 'scheduled-occurrence-2026-08-17';
    mockReserveRunEnrollment.mockRejectedValue(new Error('storage failure'));
    const run = await freshRun();

    const result = await run({
      prompt: 'Hello',
      agentConfigId: 'agent-1',
      runEpisodeId,
    });

    expect(mockReserveRunEnrollment).toHaveBeenCalledWith(runEpisodeId, 'agent-1');
    expect(mockPrompt).not.toHaveBeenCalled();
    expect(result.status).toBe('error');
    expect(result.error).toContain(
      'AgentRunner: enrollment lifecycle transition failed before prompt dispatch',
    );
    expect(mockMarkRunEnrollmentPreDispatchFailed).not.toHaveBeenCalled();
    expect(outcomeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: expect.any(String),
        terminalStatus: 'error',
        producedArtifact: false,
        runEpisodeId,
      }),
    );
    expect(mockCommitReservedTreatmentDispatch).not.toHaveBeenCalled();
  });

  it('returns error and routes preparation failures to terminalization without prompt or commit', async () => {
    await mockScope();
    const outcomeModule = await import('../services/run_outcome_service');
    const outcomeSpy = vi
      .spyOn(outcomeModule, 'recordTerminalOutcome')
      .mockResolvedValue(undefined);
    const runEpisodeId = 'scheduled-occurrence-2026-08-17';
    mockReserveRunEnrollment.mockResolvedValue(reservedFixture({ runEpisodeId }));
    mockPrepareReservedTreatment.mockResolvedValue({ status: 'invalid_binding' });
    const run = await freshRun();

    const result = await run({
      prompt: 'Hello',
      agentConfigId: 'agent-1',
      runEpisodeId,
    });

    expect(mockReserveRunEnrollment).toHaveBeenCalledWith(runEpisodeId, 'agent-1');
    expect(mockMarkRunEnrollmentPreDispatchFailed).toHaveBeenCalledWith(runEpisodeId);
    expect(mockPrompt).not.toHaveBeenCalled();
    expect(mockCommitReservedTreatmentDispatch).not.toHaveBeenCalled();
    expect(result.status).toBe('error');
    expect(result.error).toContain(
      'AgentRunner: enrollment lifecycle transition failed before prompt dispatch',
    );
    expect(outcomeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: expect.any(String),
        terminalStatus: 'error',
        producedArtifact: false,
        runEpisodeId,
      }),
    );
  });

  it('a throwing commit hook (drift/corruption at the real dispatch boundary) blocks the run — no successful dispatch', async () => {
    await mockScope();
    const runEpisodeId = 'run-episode-commit-throws';
    mockReserveRunEnrollment.mockResolvedValue(reservedFixture({ runEpisodeId }));
    const commitError = new Error('AgentRunner: treatment dispatch commit failed (target_drifted)');
    mockCommitReservedTreatmentDispatch.mockRejectedValue(commitError);

    const outcomeModule = await import('../services/run_outcome_service');
    const outcomeSpy = vi
      .spyOn(outcomeModule, 'recordTerminalOutcome')
      .mockResolvedValue(undefined);

    const run = await freshRun();
    const result = await run({
      prompt: 'Hello',
      agentConfigId: 'agent-1',
      runEpisodeId,
    });

    expect(mockPrompt).toHaveBeenCalledTimes(1);
    expect(mockCommitReservedTreatmentDispatch).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('error');
    expect(outcomeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: expect.any(String),
        terminalStatus: 'error',
        runEpisodeId,
      }),
    );
  });

  it('preserves the dispatched-commit path on a runtime prompt failure occurring AFTER a successful commit', async () => {
    await mockScope();
    const runEpisodeId = 'scheduled-occurrence-2026-08-17';
    mockReserveRunEnrollment.mockResolvedValue(reservedFixture({ runEpisodeId }));
    // The hook succeeds (commit applied) but the underlying "SDK call" this
    // mock represents still fails afterward — mirrors a real provider error
    // arriving after the boundary hook already committed the receipt.
    mockPrompt.mockImplementationOnce(async (_sid, _text, _model, _cwd, _opts, beforeDispatch) => {
      if (beforeDispatch) {
        await beforeDispatch();
      }
      throw new Error('provider timeout');
    });

    const outcomeModule = await import('../services/run_outcome_service');
    const outcomeSpy = vi
      .spyOn(outcomeModule, 'recordTerminalOutcome')
      .mockResolvedValue(undefined);

    const run = await freshRun();
    const result = await run({
      prompt: 'Hello',
      agentConfigId: 'agent-1',
      runEpisodeId,
    });

    expect(mockCommitReservedTreatmentDispatch).toHaveBeenCalledTimes(1);
    expect(mockPrompt).toHaveBeenCalled();
    expect(result.status).toBe('error');
    expect(outcomeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: expect.any(String),
        terminalStatus: 'error',
        producedArtifact: false,
        runEpisodeId,
      }),
    );
  });

  it('passes explicit runEpisodeId to terminal outcome when prompt returns no response and fails the still-reserved enrollment', async () => {
    await mockScope();
    const runEpisodeId = 'scheduled-occurrence-2026-08-17-no-response';
    mockReserveRunEnrollment.mockResolvedValue(reservedFixture({ runEpisodeId }));
    // The hook never runs to completion in a way that yields a response: the
    // "SDK call" this mock wraps resolves null even though the hook itself
    // (still invoked, per the real boundary contract) succeeded.
    mockPrompt.mockImplementationOnce(async (_sid, _text, _model, _cwd, _opts, beforeDispatch) => {
      if (beforeDispatch) {
        await beforeDispatch();
      }
      return null;
    });

    const outcomeModule = await import('../services/run_outcome_service');
    const outcomeSpy = vi
      .spyOn(outcomeModule, 'recordTerminalOutcome')
      .mockResolvedValue(undefined);

    const run = await freshRun();
    const result = await run({
      prompt: 'Hello',
      agentConfigId: 'agent-1',
      runEpisodeId,
    });

    expect(mockPrompt).toHaveBeenCalled();
    expect(result.status).toBe('error');
    expect(result.error).toContain('model produced no output');
    // C2-C — a still-reserved enrollment must never be left eligible after a
    // failed dispatch attempt. Since the fixture's hook succeeded, this is a
    // harmless no-op call in this specific scenario (the enrollment is
    // 'dispatched' from commit's point of view via the mock), but the
    // runner must still attempt it unconditionally whenever a reservation
    // was in play.
    expect(mockMarkRunEnrollmentPreDispatchFailed).toHaveBeenCalledWith(runEpisodeId);
    expect(outcomeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: expect.any(String),
        terminalStatus: 'error',
        producedArtifact: false,
        runEpisodeId,
      }),
    );
  });

  it('passes explicit runEpisodeId to terminalization on successful completion', async () => {
    await mockScope();
    const runEpisodeId = 'scheduled-occurrence-2026-08-17-success';
    mockReserveRunEnrollment.mockResolvedValue(reservedFixture({ runEpisodeId }));

    const outcomeModule = await import('../services/run_outcome_service');
    const outcomeSpy = vi
      .spyOn(outcomeModule, 'recordTerminalOutcome')
      .mockResolvedValue(undefined);

    const run = await freshRun();
    const result = await run({
      prompt: 'Hello',
      agentConfigId: 'agent-1',
      runEpisodeId,
    });

    expect(result.status).toBe('done');
    expect(mockCommitReservedTreatmentDispatch).toHaveBeenCalledTimes(1);
    expect(outcomeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: expect.any(String),
        terminalStatus: 'completed',
        scheduledOccurrenceId: null,
        runEpisodeId,
      }),
    );
  });
});
