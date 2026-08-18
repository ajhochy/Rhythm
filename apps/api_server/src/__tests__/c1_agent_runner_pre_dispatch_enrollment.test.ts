/**
 * C1 — pre-dispatch experiment enrollment ordering contract.
 *
 * Required behavior: AgentRunner must call reserveRunEnrollment() before
 * opencodeClient.prompt() so a stable runEpisodeId is reserved before any
 * model dispatch.
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
  mockMarkRunEnrollmentDispatched,
  mockMarkRunEnrollmentPreDispatchFailed,
} =
  vi.hoisted(() => ({
    mockCreateSession: vi.fn(),
    mockPrompt: vi.fn(),
    mockAbortSession: vi.fn(),
    mockReserveRunEnrollment: vi.fn(),
    mockMarkRunEnrollmentDispatched: vi.fn(),
    mockMarkRunEnrollmentPreDispatchFailed: vi.fn(),
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
  markRunEnrollmentDispatched: mockMarkRunEnrollmentDispatched,
  markRunEnrollmentPreDispatchFailed: mockMarkRunEnrollmentPreDispatchFailed,
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

describe('C1 — pre-dispatch enrollment is ordered before prompt dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    makeDb();
    mockCreateSession.mockResolvedValue({ id: 'sdk-session-c1' });
    mockPrompt.mockResolvedValue({
      info: { sessionID: 'sdk-session-c1' },
      parts: [{ type: 'text', text: 'Done' }],
    });
    mockAbortSession.mockResolvedValue(true);
    mockMarkRunEnrollmentDispatched.mockResolvedValue({ status: 'applied', current: null });
    mockMarkRunEnrollmentPreDispatchFailed.mockResolvedValue({
      status: 'applied',
      current: null,
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

  it('calls reserveRunEnrollment before dispatch transition and prompt', async () => {
    await mockScope();
    let sessionId = '';
    mockReserveRunEnrollment.mockResolvedValue({
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
    } as never);
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
    expect(mockMarkRunEnrollmentDispatched).toHaveBeenCalledTimes(1);
    expect(mockMarkRunEnrollmentDispatched).toHaveBeenCalledWith(sessionId);
    expect(mockReserveRunEnrollment.mock.invocationCallOrder[0]).toBeLessThan(
      mockMarkRunEnrollmentDispatched.mock.invocationCallOrder[0],
    );
    expect(mockMarkRunEnrollmentDispatched.mock.invocationCallOrder[0]).toBeLessThan(
      mockPrompt.mock.invocationCallOrder[0],
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
    expect(mockMarkRunEnrollmentDispatched).not.toHaveBeenCalled();
  });

  it('returns error and routes dispatch-confirmation errors to terminalization without prompt', async () => {
    await mockScope();
    const outcomeModule = await import('../services/run_outcome_service');
    const outcomeSpy = vi
      .spyOn(outcomeModule, 'recordTerminalOutcome')
      .mockResolvedValue(undefined);
    const runEpisodeId = 'scheduled-occurrence-2026-08-17';
    mockReserveRunEnrollment.mockResolvedValue({
      id: 'enrollment-id',
      runEpisodeId,
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
    } as never);
    mockMarkRunEnrollmentDispatched.mockRejectedValue(new Error('storage failure'));
    const run = await freshRun();

    const result = await run({
      prompt: 'Hello',
      agentConfigId: 'agent-1',
      runEpisodeId,
    });

    expect(mockReserveRunEnrollment).toHaveBeenCalledWith(runEpisodeId, 'agent-1');
    expect(mockMarkRunEnrollmentDispatched).toHaveBeenCalledWith(runEpisodeId);
    expect(mockMarkRunEnrollmentPreDispatchFailed).toHaveBeenCalledWith(runEpisodeId);
    expect(mockPrompt).not.toHaveBeenCalled();
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

  it('fails closed when dispatch transition cannot be confirmed', async () => {
    await mockScope();
    let sessionId = '';
    mockReserveRunEnrollment.mockResolvedValue({
      id: 'enrollment-id',
      runEpisodeId: 'ep-1',
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
    } as never);
    mockMarkRunEnrollmentDispatched.mockResolvedValue({
      status: 'illegal_transition',
      current: {
        id: 'enrollment-id',
        runEpisodeId: 'ep-1',
        experimentId: 'exp-1',
        proposalId: 'proposal-1',
        profileId: 'agent-1',
        cohort: 'candidate',
        assignmentDigest: 'assign',
        baselineTargetRevisionHash: 'base',
        treatmentSpecHash: 'treat',
        state: 'reserved',
        reservedAt: new Date().toISOString(),
        failureCode: null,
        failureReason: null,
      } as never,
    });
    const outcomeModule = await import('../services/run_outcome_service');
    const outcomeSpy = vi
      .spyOn(outcomeModule, 'recordTerminalOutcome')
      .mockResolvedValue(undefined);
    const run = await freshRun();

    const result = await run({
      prompt: 'Hello',
      agentConfigId: 'agent-1',
      onSessionCreated: (id) => {
        sessionId = id;
      },
    });

    expect(mockMarkRunEnrollmentDispatched).toHaveBeenCalledTimes(1);
    expect(mockMarkRunEnrollmentDispatched).toHaveBeenCalledWith(sessionId);
    expect(mockMarkRunEnrollmentPreDispatchFailed).toHaveBeenCalledWith(sessionId);
    expect(mockPrompt).not.toHaveBeenCalled();
    expect(result.status).toBe('error');
    expect(result.error).toContain('enrollment lifecycle');
    expect(outcomeSpy).toHaveBeenCalledTimes(1);
    expect(outcomeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        terminalStatus: 'error',
        producedArtifact: false,
        runEpisodeId: sessionId,
      }),
    );
  });

  it('preserves dispatched enrollment path on runtime prompt failure', async () => {
    await mockScope();
    const runEpisodeId = 'scheduled-occurrence-2026-08-17';
    mockReserveRunEnrollment.mockResolvedValue({
      id: 'enrollment-id',
      runEpisodeId,
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
    } as never);
    mockMarkRunEnrollmentDispatched.mockResolvedValue({ status: 'applied', current: null });
    mockPrompt.mockRejectedValueOnce(new Error('provider timeout'));

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

    expect(mockMarkRunEnrollmentDispatched).toHaveBeenCalledWith(runEpisodeId);
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

  it('passes explicit runEpisodeId to terminal outcome when prompt returns no response', async () => {
    await mockScope();
    const runEpisodeId = 'scheduled-occurrence-2026-08-17-no-response';
    mockReserveRunEnrollment.mockResolvedValue({
      id: 'enrollment-id',
      runEpisodeId,
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
    } as never);
    mockMarkRunEnrollmentDispatched.mockResolvedValue({ status: 'applied', current: null });
    mockPrompt.mockResolvedValueOnce(null);

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
    mockReserveRunEnrollment.mockResolvedValue({
      id: 'enrollment-id',
      runEpisodeId,
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
    } as never);
    mockMarkRunEnrollmentDispatched.mockResolvedValue({ status: 'applied', current: null });

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
