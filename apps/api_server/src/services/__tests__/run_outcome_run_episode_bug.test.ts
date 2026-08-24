/**
 * C2-D (S1) — the run-episode identity bug in recordTerminalOutcome.
 *
 * `runEpisodeId` is computed at ~L213 as `event.runEpisodeId ?? rootSessionId`,
 * and used correctly for `markRunEnrollmentTerminalized(runEpisodeId)` at ~L219.
 * But the cohort/proposal lookup at ~L249 calls `resolveRunEnrollment(rootSessionId)`
 * instead of `resolveRunEnrollment(runEpisodeId)`, silently dropping an explicit
 * `runEpisodeId` and resolving the wrong enrollment when they differ.
 *
 * This test proves the bug: when an explicit `runEpisodeId` is provided that
 * differs from `rootSessionId`, the enrollment resolution MUST use `runEpisodeId`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../database/migrations';
import { env } from '../../config/env';
import { setDb } from '../../database/db';
import { AgentConfigsRepository, type RevisionedAgentConfig } from '../../repositories/agent_configs_repository';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
import { AgentOrgExperimentsRepository } from '../../repositories/agent_org_experiments_repository';
import { AgentOrgExperimentEnrollmentsRepository } from '../../repositories/agent_org_experiment_enrollments_repository';
import { AgentSessionsRepository } from '../../repositories/agent_sessions_repository';
import {
  reserveRunEnrollment,
  markRunEnrollmentDispatched,
  assignCohort,
} from '../org_proposal_experiment_service';
import { PROPOSAL_EVIDENCE_BUNDLE_VERSION } from '../../models/proposal_evidence_bundle';
import { createHash } from 'node:crypto';

const TEST_PROFILE_ID = 'c2d-s1-profile';
const BASELINE_PROMPT = 'C2-D baseline prompt';
const CANDIDATE_PROMPT = 'C2-D candidate prompt';
const TARGET_REF = `agent_config:${TEST_PROFILE_ID}`;
const ASSIGNMENT_KEY = 'c2d-s1-outcome-bug';

function canonicalizeForHash(input: unknown): string {
  if (Array.isArray(input)) return `[${input.map(canonicalizeForHash).join(',')}]`;
  if (input && typeof input === 'object') {
    const entries = Object.keys(input as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeForHash((input as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(input);
}

function fingerprint(p: RevisionedAgentConfig): string {
  return `sha256:${createHash('sha256')
    .update(canonicalizeForHash({ id: p.id, revision: p.revision, systemPrompt: p.systemPrompt ?? '__null__' }))
    .digest('hex')}`;
}

function spec(candidateValue: string, hash: string): Record<string, unknown> {
  return {
    agentConfigId: TEST_PROFILE_ID,
    field: 'system_prompt',
    priorValue: BASELINE_PROMPT,
    currentValue: BASELINE_PROMPT,
    candidateValue,
    evidenceTarget: { ref: TARGET_REF, hash },
  };
}

function bundle(hash: string): Record<string, unknown> {
  return {
    version: PROPOSAL_EVIDENCE_BUNDLE_VERSION,
    sourceEvidence: { sessionIds: ['seed'], eventIds: ['seed'] },
    counterEvidenceSearch: { query: 'q', searchedAt: new Date().toISOString(), contradictingCount: 0 },
    target: { ref: TARGET_REF, hash },
    expectedOutcome: 'success',
    primaryMetric: { name: 'objective-success-rate', direction: 'increase' },
    guardrails: ['terminal-error-rate'],
    experimentAdapter: 'paired-cohort-outcome',
    rollbackRule: 'revert',
    generatorVersion: 'v1',
    confidenceCalibrationVersion: 'v1',
  };
}

let db: Database.Database;
let originalTreatmentV2Enabled: boolean;

describe('C2-D (S1) — recordTerminalOutcome uses runEpisodeId (not rootSessionId) for enrollment resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    process.env.RHYTHM_OPTIMIZER_MODE = 'shadow';
    // C6 item 1 — this suite exercises the real reserve/resolve chain, which
    // now requires treatment-v2 to be enabled.
    originalTreatmentV2Enabled = env.treatmentV2Enabled;
    env.treatmentV2Enabled = true;
  });

  afterEach(() => {
    try { db.close(); } catch { /* ignore */ }
    vi.restoreAllMocks();
    delete process.env.RHYTHM_OPTIMIZER_MODE;
    env.treatmentV2Enabled = originalTreatmentV2Enabled;
  });

  it('resolves the enrollment bound to the explicit runEpisodeId, not rootSessionId', async () => {
    const profile = await new AgentConfigsRepository().insert({
      id: TEST_PROFILE_ID,
      label: TEST_PROFILE_ID,
      icon: 'x',
      systemPrompt: BASELINE_PROMPT,
    });
    const hash = fingerprint(profile);
    const proposal = await new AgentOrgProposalsRepository().createAsync({
      kind: 'refine-config',
      risk: 'low',
      status: 'active',
      title: 'C2-D proposal',
      targetRef: TARGET_REF,
      changeJson: JSON.stringify({
        configPatch: { agentConfigId: TEST_PROFILE_ID, field: 'system_prompt', value: CANDIDATE_PROMPT },
      }),
    });
    await new AgentOrgExperimentsRepository().declareAsync({
      proposalId: proposal.id,
      adapter: 'paired-cohort-outcome',
      evidenceBundleJson: JSON.stringify(bundle(hash)),
      baselineSpecJson: JSON.stringify(spec(BASELINE_PROMPT, hash)),
      candidateSpecJson: JSON.stringify(spec(CANDIDATE_PROMPT, hash)),
      assignmentKey: ASSIGNMENT_KEY,
      stoppingRule: { minSamplesPerCohort: 2, minEffect: 0.1 },
      maxExposure: 100,
    });

    // Create a root session so resolveRootSessionIdAsync returns a real id
    const sessionRepo = new AgentSessionsRepository();
    const rootSession = sessionRepo.insert({
      agentKind: 'chat',
      taskId: null,
      cwd: '/tmp',
      name: 'test-session',
    } as never);
    const rootSessionId = rootSession.id;

    // Use a runEpisodeId that is DISTINCT from rootSessionId — this is the
    // case the bug silently breaks.
    const runEpisodeId = 'c2d-s1-explicit-episode-id';
    expect(runEpisodeId).not.toBe(rootSessionId);

    // Reserve + dispatch so the enrollment exists and is dispatched
    const enrollment = await reserveRunEnrollment(runEpisodeId, TEST_PROFILE_ID);
    expect(enrollment).not.toBeNull();
    expect(enrollment!.runEpisodeId).toBe(runEpisodeId);
    await markRunEnrollmentDispatched(runEpisodeId);

    // Now record a terminal outcome with the explicit runEpisodeId
    const { recordTerminalOutcome } = await import('../run_outcome_service');
    await recordTerminalOutcome({
      sessionId: rootSessionId,
      terminalStatus: 'completed',
      runEpisodeId,
      evidence: { producedArtifact: true, errorCount: 0, approvalDenied: false },
    });

    // Read back the outcome — it must carry the enrollment's experimentVariant
    // and proposalId, proving the enrollment was resolved via runEpisodeId.
    const { AgentRunOutcomesRepository } = await import('../../repositories/agent_run_outcomes_repository');
    const outcomesRepo = new AgentRunOutcomesRepository();
    const outcome = await outcomesRepo.findByRootSessionIdAsync(rootSessionId);

    // The outcome's experimentVariant should match the enrollment's cohort,
    // and the proposalId should match — proving the enrollment was resolved
    // via runEpisodeId, not rootSessionId.
    expect(outcome).not.toBeNull();
    expect(outcome!.outcome.experimentVariant).toBe(enrollment!.cohort);
    expect(outcome!.outcome.proposalId).toBe(enrollment!.proposalId);
  });
});