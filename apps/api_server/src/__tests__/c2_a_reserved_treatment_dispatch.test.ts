/**
 * C2-A — join the accepted C1 reservation to real prompt dispatch.
 *
 * Required behavior under test (contract docs/ai/contracts/issue-causal-runtime-v2.json,
 * phase C2-A):
 *
 *  1. A real, non-null C1 reservation must deterministically supply the
 *     persisted experiment's exact valid system-prompt-v1 cohort spec to
 *     AgentRunner — with NO caller-supplied `opts.experimentTreatment`.
 *  2. If the target AgentConfig drifts between reservation and dispatch (a
 *     different durable fingerprint than the one the reservation was made
 *     against), no prompt is sent and the enrollment resolves to
 *     `treatment_failed` / `target_drifted`.
 *
 * Both tests exercise the REAL org_proposal_experiment_service and REAL
 * AgentConfigsRepository/AgentOrgExperimentsRepository — only the opencode
 * engine boundary and profile-scope resolution are mocked, mirroring
 * c2_experiment_treatment_dispatch.test.ts and experiment_cohort_wiring_contract.test.ts.
 */

import { createHash } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb, getDb } from '../database/db';
import { AgentConfigsRepository, type RevisionedAgentConfig } from '../repositories/agent_configs_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { AgentOrgExperimentsRepository } from '../repositories/agent_org_experiments_repository';
import { AgentOrgExperimentEnrollmentsRepository } from '../repositories/agent_org_experiment_enrollments_repository';
import {
  assignCohort,
  markRunEnrollmentDispatched,
  reserveRunEnrollment,
} from '../services/org_proposal_experiment_service';
import { PROPOSAL_EVIDENCE_BUNDLE_VERSION } from '../models/proposal_evidence_bundle';

const { mockCreateSession, mockPrompt, mockAbortSession } = vi.hoisted(() => ({
  mockCreateSession: vi.fn(),
  mockPrompt: vi.fn(),
  mockAbortSession: vi.fn(),
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

const TEST_PROFILE_ID = 'c2a-profile';
const BASELINE_SYSTEM_PROMPT = 'You are the C2-A baseline assistant.';
const CANDIDATE_SYSTEM_PROMPT = 'You are the C2-A refined candidate assistant.';
const PROFILE_TARGET_REF = `agent_config:${TEST_PROFILE_ID}`;
const ASSIGNMENT_KEY = 'c2-a-reserved-treatment-fixture';

function canonicalizeForHash(input: unknown): string {
  if (Array.isArray(input)) {
    return `[${input.map((item) => canonicalizeForHash(item)).join(',')}]`;
  }
  if (input && typeof input === 'object') {
    const entries = Object.keys(input as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeForHash((input as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(input);
}

function durableTargetFingerprint(profile: RevisionedAgentConfig): string {
  return `sha256:${createHash('sha256')
    .update(
      canonicalizeForHash({
        id: profile.id,
        revision: profile.revision,
        systemPrompt: profile.systemPrompt ?? '__system-prompt-null__',
      }),
    )
    .digest('hex')}`;
}

function systemPromptSpec(candidateValue: string, profileTargetHash: string): Record<string, unknown> {
  return {
    agentConfigId: TEST_PROFILE_ID,
    field: 'system_prompt',
    priorValue: BASELINE_SYSTEM_PROMPT,
    currentValue: BASELINE_SYSTEM_PROMPT,
    candidateValue,
    evidenceTarget: { ref: PROFILE_TARGET_REF, hash: profileTargetHash },
  };
}

function bundle(profileTargetHash: string): Record<string, unknown> {
  return {
    version: PROPOSAL_EVIDENCE_BUNDLE_VERSION,
    sourceEvidence: { sessionIds: ['seed-session'], eventIds: ['seed-event'] },
    counterEvidenceSearch: {
      query: 'contradicting evidence for the C2-A refinement',
      searchedAt: new Date().toISOString(),
      contradictingCount: 0,
    },
    target: { ref: PROFILE_TARGET_REF, hash: profileTargetHash },
    expectedOutcome: 'more runs reach an objective success verdict',
    primaryMetric: { name: 'objective-success-rate', direction: 'increase' },
    guardrails: ['revert if the terminal error rate rises'],
    experimentAdapter: 'paired-cohort-outcome',
    rollbackRule: 'restore before_snapshot_json',
    generatorVersion: 'c2a-generator-v1',
    confidenceCalibrationVersion: 'calibration-v1',
  };
}

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
      /* ignore */
    }
    activeDb = null;
  }
}

async function seedProfile(): Promise<RevisionedAgentConfig> {
  return new AgentConfigsRepository().insert({
    id: TEST_PROFILE_ID,
    label: TEST_PROFILE_ID,
    icon: 'x',
    systemPrompt: BASELINE_SYSTEM_PROMPT,
  });
}

async function declareExperiment(profileTargetHash: string): Promise<void> {
  const proposal = await new AgentOrgProposalsRepository().createAsync({
    kind: 'refine-recipe',
    risk: 'low',
    status: 'active',
    title: 'C2-A refine the assistant prompt',
    targetRef: 'recipe:c2a',
  });
  await new AgentOrgExperimentsRepository().declareAsync({
    proposalId: proposal.id,
    adapter: 'paired-cohort-outcome',
    evidenceBundleJson: JSON.stringify(bundle(profileTargetHash)),
    baselineSpecJson: JSON.stringify(systemPromptSpec(BASELINE_SYSTEM_PROMPT, profileTargetHash)),
    candidateSpecJson: JSON.stringify(systemPromptSpec(CANDIDATE_SYSTEM_PROMPT, profileTargetHash)),
    assignmentKey: ASSIGNMENT_KEY,
    stoppingRule: { minSamplesPerCohort: 3, minEffect: 0.2 },
    maxExposure: 100,
  });
}

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

describe('C2-A — a real C1 reservation supplies the bound cohort spec at dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    makeDb();
    delete process.env.RHYTHM_OPTIMIZER_MODE;
    mockCreateSession.mockResolvedValue({ id: 'sdk-session-c2a' });
    mockPrompt.mockResolvedValue({
      info: { sessionID: 'sdk-session-c2a' },
      parts: [{ type: 'text', text: 'Done' }],
    });
    mockAbortSession.mockResolvedValue(true);
  });

  afterEach(() => {
    teardownDb();
    vi.restoreAllMocks();
  });

  it('dispatches the exact bound cohort system prompt with no opts.experimentTreatment supplied', async () => {
    const profile = await seedProfile();
    const profileTargetHash = durableTargetFingerprint(profile);
    await declareExperiment(profileTargetHash);
    await mockScope();

    const runEpisodeId = 'c2a-run-episode-1';
    const expectedCohort = assignCohort(ASSIGNMENT_KEY, runEpisodeId);
    const expectedOverride =
      expectedCohort === 'baseline' ? BASELINE_SYSTEM_PROMPT : CANDIDATE_SYSTEM_PROMPT;

    const run = await freshRun();
    const result = await run({
      prompt: 'Hello',
      agentConfigId: TEST_PROFILE_ID,
      runEpisodeId,
    });

    expect(result.status).toBe('done');
    expect(mockPrompt).toHaveBeenCalledTimes(1);
    const opts = mockPrompt.mock.calls[0][4] as Record<string, unknown>;
    expect(opts.system).toBe(expectedOverride);

    const enrollment = await new AgentOrgExperimentEnrollmentsRepository().findByRunEpisodeIdAsync(
      runEpisodeId,
    );
    expect(enrollment?.state).toBe('dispatched');
    expect(enrollment?.cohort).toBe(expectedCohort);
  });

  it('sends no prompt and resolves treatment_failed/target_drifted when the target drifts before dispatch', async () => {
    const profile = await seedProfile();
    const profileTargetHash = durableTargetFingerprint(profile);
    await declareExperiment(profileTargetHash);
    await mockScope();

    const runEpisodeId = 'c2a-run-episode-drift';

    // Reserve BEFORE the target drifts (mirrors the real pre-dispatch commit).
    const reservation = await reserveRunEnrollment(runEpisodeId, TEST_PROFILE_ID);
    expect(reservation).not.toBeNull();

    // Mutate the durable AgentConfig AFTER reservation but BEFORE dispatch —
    // this bumps `revision`, changing the durable target fingerprint.
    new AgentConfigsRepository().update(TEST_PROFILE_ID, {
      systemPrompt: 'a completely different prompt nobody reserved against',
    });

    const run = await freshRun();
    const result = await run({
      prompt: 'Hello',
      agentConfigId: TEST_PROFILE_ID,
      runEpisodeId,
    });

    expect(mockPrompt).not.toHaveBeenCalled();
    expect(result.status).toBe('error');

    const enrollment = await new AgentOrgExperimentEnrollmentsRepository().findByRunEpisodeIdAsync(
      runEpisodeId,
    );
    expect(enrollment?.state).toBe('treatment_failed');
    expect(enrollment?.failureCode).toBe('target_drifted');
  });

  it('proves BOTH cohorts through the real C1 reservation path and AgentRunner with distinct bound prompts', async () => {
    const profile = await seedProfile();
    const profileTargetHash = durableTargetFingerprint(profile);
    await declareExperiment(profileTargetHash);
    await mockScope();

    // Deterministically find one baseline and one candidate runEpisodeId from
    // the REAL assignCohort function — not a hand-picked pair.
    let baselineRunEpisodeId: string | null = null;
    let candidateRunEpisodeId: string | null = null;
    for (let i = 0; i < 200 && (!baselineRunEpisodeId || !candidateRunEpisodeId); i += 1) {
      const candidateId = `c2a-dual-cohort-${i}`;
      const cohort = assignCohort(ASSIGNMENT_KEY, candidateId);
      if (cohort === 'baseline' && !baselineRunEpisodeId) baselineRunEpisodeId = candidateId;
      if (cohort === 'candidate' && !candidateRunEpisodeId) candidateRunEpisodeId = candidateId;
    }
    expect(baselineRunEpisodeId).not.toBeNull();
    expect(candidateRunEpisodeId).not.toBeNull();

    const run = await freshRun();

    const baselineResult = await run({
      prompt: 'Hello',
      agentConfigId: TEST_PROFILE_ID,
      runEpisodeId: baselineRunEpisodeId!,
    });
    const baselineOpts = mockPrompt.mock.calls[0][4] as Record<string, unknown>;

    mockPrompt.mockClear();
    const candidateResult = await run({
      prompt: 'Hello',
      agentConfigId: TEST_PROFILE_ID,
      runEpisodeId: candidateRunEpisodeId!,
    });
    const candidateOpts = mockPrompt.mock.calls[0][4] as Record<string, unknown>;

    expect(baselineResult.status).toBe('done');
    expect(candidateResult.status).toBe('done');
    expect(baselineOpts.system).toBe(BASELINE_SYSTEM_PROMPT);
    expect(candidateOpts.system).toBe(CANDIDATE_SYSTEM_PROMPT);
    expect(baselineOpts.system).not.toBe(candidateOpts.system);

    // Fire-and-forget completion terminalization (recordTerminalOutcome inside
    // AgentRunner) races the test's own read-back, so a fully successful run
    // may already show either 'dispatched' or 'terminalized' by now — both
    // prove the enrollment WAS dispatched; only 'reserved'/'treatment_failed'
    // would mean dispatch never happened.
    const enrollmentsRepo = new AgentOrgExperimentEnrollmentsRepository();
    const baselineEnrollment = await enrollmentsRepo.findByRunEpisodeIdAsync(baselineRunEpisodeId!);
    const candidateEnrollment = await enrollmentsRepo.findByRunEpisodeIdAsync(candidateRunEpisodeId!);
    expect(['dispatched', 'terminalized']).toContain(baselineEnrollment?.state);
    expect(baselineEnrollment?.cohort).toBe('baseline');
    expect(['dispatched', 'terminalized']).toContain(candidateEnrollment?.state);
    expect(candidateEnrollment?.cohort).toBe('candidate');
  });

  it('fails closed with no prompt when a different profile collides on an already-bound run episode, leaving the original enrollment intact', async () => {
    const profileA = await seedProfile();
    const profileTargetHash = durableTargetFingerprint(profileA);
    await declareExperiment(profileTargetHash);
    await new AgentConfigsRepository().insert({
      id: 'c2a-profile-b',
      label: 'c2a-profile-b',
      icon: 'x',
      systemPrompt: 'a distinct profile b prompt',
    });
    await mockScope();

    const runEpisodeId = 'c2a-collision-episode';
    const originalReservation = await reserveRunEnrollment(runEpisodeId, TEST_PROFILE_ID);
    expect(originalReservation).not.toBeNull();

    const run = await freshRun();
    const result = await run({
      prompt: 'Hello',
      agentConfigId: 'c2a-profile-b',
      runEpisodeId,
    });

    expect(mockPrompt).not.toHaveBeenCalled();
    expect(result.status).toBe('error');

    const enrollment = await new AgentOrgExperimentEnrollmentsRepository().findByRunEpisodeIdAsync(
      runEpisodeId,
    );
    expect(enrollment).toEqual(originalReservation);
    expect(enrollment?.profileId).toBe(TEST_PROFILE_ID);
    expect(enrollment?.state).toBe('reserved');
  });

  it('does not terminalize an already-DISPATCHED enrollment when a different profile collides on the same run episode', async () => {
    const profileA = await seedProfile();
    const profileTargetHash = durableTargetFingerprint(profileA);
    await declareExperiment(profileTargetHash);
    await new AgentConfigsRepository().insert({
      id: 'c2a-profile-b-dispatched',
      label: 'c2a-profile-b-dispatched',
      icon: 'x',
      systemPrompt: 'a distinct profile b prompt',
    });
    await mockScope();

    const runEpisodeId = 'c2a-collision-dispatched-episode';
    const originalReservation = await reserveRunEnrollment(runEpisodeId, TEST_PROFILE_ID);
    expect(originalReservation).not.toBeNull();

    // Legally transition profile A's row all the way to `dispatched` — exactly
    // what a real in-flight run does — BEFORE profile B collides on the same
    // episode. This is the scenario the plain 'reserved' collision test above
    // cannot exercise: markTerminalizedAsync only fires from `dispatched`.
    const dispatchTransition = await markRunEnrollmentDispatched(runEpisodeId);
    expect(dispatchTransition.status).toBe('applied');

    // Capture (but do not suppress) the fire-and-forget terminal hook so the
    // test can await it deterministically instead of guessing at a timeout.
    const outcomeModule = await import('../services/run_outcome_service');
    const originalRecordTerminalOutcome = outcomeModule.recordTerminalOutcome;
    let capturedTerminalHook: Promise<void> | null = null;
    const outcomeSpy = vi
      .spyOn(outcomeModule, 'recordTerminalOutcome')
      .mockImplementation((event) => {
        const settled = originalRecordTerminalOutcome(event);
        capturedTerminalHook = settled;
        return settled;
      });

    const run = await freshRun();
    const result = await run({
      prompt: 'Hello',
      agentConfigId: 'c2a-profile-b-dispatched',
      runEpisodeId,
    });

    expect(mockPrompt).not.toHaveBeenCalled();
    expect(result.status).toBe('error');

    expect(capturedTerminalHook).not.toBeNull();
    await capturedTerminalHook;

    // Profile A's already-dispatched enrollment must remain untouched: still
    // dispatched, still bound to profile A, same cohort, no failure recorded.
    const enrollment = await new AgentOrgExperimentEnrollmentsRepository().findByRunEpisodeIdAsync(
      runEpisodeId,
    );
    expect(enrollment?.state).toBe('dispatched');
    expect(enrollment?.profileId).toBe(TEST_PROFILE_ID);
    expect(enrollment?.cohort).toBe(originalReservation!.cohort);
    expect(enrollment?.failureCode).toBeNull();

    // B's collision must not borrow A's run-episode identity: the terminal
    // hook invoked for B's failure must never carry E, the episode bound to A.
    expect(outcomeSpy).toHaveBeenCalledTimes(1);
    const eventArg = outcomeSpy.mock.calls[0][0];
    expect(eventArg.runEpisodeId).not.toBe(runEpisodeId);
    expect(eventArg.experimentVariant ?? null).toBeNull();
    expect(eventArg.proposalId ?? null).toBeNull();

    // No enrollment row for B ever inherited A's experiment/cohort identity.
    const bEnrollment = eventArg.sessionId
      ? await new AgentOrgExperimentEnrollmentsRepository().findByRunEpisodeIdAsync(
          eventArg.sessionId,
        )
      : null;
    expect(bEnrollment).toBeNull();
  });

  it('sends no prompt and fails closed (pre_dispatch_failed) when the binding is invalid but the target has not drifted', async () => {
    const profile = await seedProfile();
    const profileTargetHash = durableTargetFingerprint(profile);
    await declareExperiment(profileTargetHash);
    await mockScope();

    const runEpisodeId = 'c2a-invalid-binding-episode';
    const reservation = await reserveRunEnrollment(runEpisodeId, TEST_PROFILE_ID);
    expect(reservation).not.toBeNull();

    // Corrupt the immutable treatment-spec binding directly (a column the
    // state-transition trigger does not guard) without touching the target
    // AgentConfig — this must surface as invalid_binding, not target_drifted.
    getDb()
      .prepare(`UPDATE agent_org_experiment_enrollments SET treatment_spec_hash = ? WHERE run_episode_id = ?`)
      .run('corrupted-treatment-spec-hash', runEpisodeId);

    const run = await freshRun();
    const result = await run({
      prompt: 'Hello',
      agentConfigId: TEST_PROFILE_ID,
      runEpisodeId,
    });

    expect(mockPrompt).not.toHaveBeenCalled();
    expect(result.status).toBe('error');

    const enrollment = await new AgentOrgExperimentEnrollmentsRepository().findByRunEpisodeIdAsync(
      runEpisodeId,
    );
    expect(enrollment?.state).toBe('treatment_failed');
    expect(enrollment?.failureCode).toBe('pre_dispatch_failed');
  });

  it('a real reserved treatment cannot be overridden by caller-supplied opts.experimentTreatment', async () => {
    const profile = await seedProfile();
    const profileTargetHash = durableTargetFingerprint(profile);
    await declareExperiment(profileTargetHash);
    await mockScope();

    const runEpisodeId = 'c2a-override-attempt-episode';
    const reservation = await reserveRunEnrollment(runEpisodeId, TEST_PROFILE_ID);
    expect(reservation).not.toBeNull();
    const expectedOverride =
      reservation!.cohort === 'baseline' ? BASELINE_SYSTEM_PROMPT : CANDIDATE_SYSTEM_PROMPT;

    const run = await freshRun();
    const result = await run({
      prompt: 'Hello',
      agentConfigId: TEST_PROFILE_ID,
      runEpisodeId,
      experimentTreatment: {
        adapter: 'system-prompt-v1',
        cohort: 'candidate',
        spec: {
          agentConfigId: TEST_PROFILE_ID,
          field: 'system_prompt',
          priorValue: 'attacker prior',
          currentValue: 'attacker baseline override',
          candidateValue: 'attacker candidate override',
          evidenceTarget: { ref: PROFILE_TARGET_REF, hash: profileTargetHash },
        },
      },
    });

    expect(result.status).toBe('done');
    const opts = mockPrompt.mock.calls[0][4] as Record<string, unknown>;
    expect(opts.system).toBe(expectedOverride);
    expect(opts.system).not.toBe('attacker baseline override');
    expect(opts.system).not.toBe('attacker candidate override');
  });
});
