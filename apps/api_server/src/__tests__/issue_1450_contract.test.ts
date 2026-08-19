/**
 * Contract test for issue #1450 — C2-D (S2): add run_episode_id column to
 * agent_run_outcomes with receipt-backed filtering.
 *
 * See docs/ai/contracts/issue-1450.json for the criterion -> test mapping.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentConfigsRepository, type RevisionedAgentConfig } from '../repositories/agent_configs_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { AgentOrgExperimentsRepository } from '../repositories/agent_org_experiments_repository';
import { AgentRunOutcomesRepository } from '../repositories/agent_run_outcomes_repository';
import {
  reserveRunEnrollment,
  prepareReservedTreatment,
  commitReservedTreatmentDispatch,
} from '../services/org_proposal_experiment_service';
import { recordTerminalOutcome } from '../services/run_outcome_service';
import { PROPOSAL_EVIDENCE_BUNDLE_VERSION } from '../models/proposal_evidence_bundle';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  process.env.RHYTHM_OPTIMIZER_MODE = 'shadow';
});

describe('issue-1450-c1 — run_episode_id is additive in both engines', () => {
  it('SQLite migrations add the column', () => {
    const cols = (db.pragma('table_info(agent_run_outcomes)') as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toContain('run_episode_id');
  });

  it('Postgres bootstrap adds the column via a single-line guarded ALTER', () => {
    const pgSource = readFileSync(
      join(__dirname, '..', 'database', 'postgres_bootstrap.ts'),
      'utf8',
    );
    expect(pgSource).toMatch(
      /ALTER TABLE agent_run_outcomes ADD COLUMN IF NOT EXISTS run_episode_id/,
    );
  });
});

describe('issue-1450-c2 — AgentRunOutcomesRepository.finalizeAsync accepts and persists run_episode_id', () => {
  it('round-trips a non-null run_episode_id', async () => {
    const repo = new AgentRunOutcomesRepository(db);
    await repo.finalizeAsync({
      rootSessionId: 'ses-c2-1450',
      runEpisodeId: 'episode-c2-1450',
      terminalStatus: 'completed',
      objectiveVerdict: 'success',
      objectiveEvidence: { producedArtifact: true, errorCount: 0, approvalDenied: false },
    });
    const stored = await repo.findOutcomeAsync('ses-c2-1450');
    expect(stored).not.toBeNull();
    expect(stored!.runEpisodeId).toBe('episode-c2-1450');
  });

  it('a run finalized without an explicit run_episode_id persists null, not a guess', async () => {
    const repo = new AgentRunOutcomesRepository(db);
    await repo.finalizeAsync({
      rootSessionId: 'ses-c2-1450-null',
      terminalStatus: 'completed',
      objectiveVerdict: 'success',
      objectiveEvidence: { producedArtifact: true, errorCount: 0, approvalDenied: false },
    });
    const stored = await repo.findOutcomeAsync('ses-c2-1450-null');
    expect(stored!.runEpisodeId).toBeNull();
  });
});

describe('issue-1450-c3 — recordTerminalOutcome passes the computed runEpisodeId to the repository', () => {
  it('persists the EXPLICIT runEpisodeId when it differs from the session id', async () => {
    await recordTerminalOutcome({
      sessionId: 'ses-c3-explicit',
      terminalStatus: 'completed',
      runEpisodeId: 'episode-c3-explicit',
      evidence: { producedArtifact: true, errorCount: 0, approvalDenied: false },
    });
    const repo = new AgentRunOutcomesRepository(db);
    const stored = await repo.findOutcomeAsync('ses-c3-explicit');
    expect(stored!.runEpisodeId).toBe('episode-c3-explicit');
  });

  it('regression: with no explicit runEpisodeId, persists the rootSessionId fallback (matches L213 computation)', async () => {
    await recordTerminalOutcome({
      sessionId: 'ses-c3-fallback',
      terminalStatus: 'completed',
      evidence: { producedArtifact: true, errorCount: 0, approvalDenied: false },
    });
    const repo = new AgentRunOutcomesRepository(db);
    const stored = await repo.findOutcomeAsync('ses-c3-fallback');
    expect(stored!.runEpisodeId).toBe('ses-c3-fallback');
  });
});

describe('issue-1450-c4 — promotion/judgement: receipt-backed filtering excludes unreceipted outcomes', () => {
  const PROFILE_ID = 'issue-1450-c4-profile';
  const BASELINE_PROMPT = 'issue-1450 baseline prompt';
  const CANDIDATE_PROMPT = 'issue-1450 candidate prompt';
  const TARGET_REF = `agent_config:${PROFILE_ID}`;
  const ASSIGNMENT_KEY = 'issue-1450-c4-key';

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
      agentConfigId: PROFILE_ID,
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
      guardrails: ['none'],
      experimentAdapter: 'paired-cohort-outcome',
      rollbackRule: 'revert',
      generatorVersion: 'v1',
      confidenceCalibrationVersion: 'v1',
    };
  }

  async function seedExperiment() {
    const profile = await new AgentConfigsRepository().insert({
      id: PROFILE_ID,
      label: PROFILE_ID,
      icon: 'x',
      systemPrompt: BASELINE_PROMPT,
    });
    const hash = fingerprint(profile);
    const proposal = await new AgentOrgProposalsRepository().createAsync({
      kind: 'refine-config',
      risk: 'low',
      status: 'active',
      title: 'issue-1450 proposal',
      targetRef: TARGET_REF,
      changeJson: JSON.stringify({
        configPatch: { agentConfigId: PROFILE_ID, field: 'system_prompt', value: CANDIDATE_PROMPT },
      }),
    });
    const experiment = await new AgentOrgExperimentsRepository().declareAsync({
      proposalId: proposal.id,
      adapter: 'paired-cohort-outcome',
      evidenceBundleJson: JSON.stringify(bundle(hash)),
      baselineSpecJson: JSON.stringify(spec(BASELINE_PROMPT, hash)),
      candidateSpecJson: JSON.stringify(spec(CANDIDATE_PROMPT, hash)),
      assignmentKey: ASSIGNMENT_KEY,
      stoppingRule: { minSamplesPerCohort: 1, minEffect: 0.1 },
      maxExposure: 100,
    });
    return { proposal, experiment };
  }

  /** Reserve + prepare + commit a REAL treatment receipt for one run episode. */
  async function driveReceiptBackedRun(runEpisodeId: string): Promise<void> {
    const enrollment = await reserveRunEnrollment(runEpisodeId, PROFILE_ID);
    if (!enrollment) throw new Error('test setup: expected a reservation');
    const preparation = await prepareReservedTreatment(enrollment);
    if (preparation.status !== 'ready') {
      throw new Error(`test setup: expected ready preparation, got ${preparation.status}`);
    }
    await commitReservedTreatmentDispatch(enrollment, preparation);
    await recordTerminalOutcome({
      sessionId: runEpisodeId,
      runEpisodeId,
      terminalStatus: 'completed',
      evidence: { producedArtifact: true, errorCount: 0, approvalDenied: false },
    });
  }

  it('excludes an outcome whose run_episode_id has no matching treatment receipt', async () => {
    const { proposal, experiment } = await seedExperiment();
    const outcomes = new AgentRunOutcomesRepository(db);

    // A receipt-backed run: went through reserve -> prepare -> commit, so a
    // real agent_org_experiment_treatment_receipts row exists for it.
    const receiptBackedEpisode = 'episode-receipt-backed';
    await driveReceiptBackedRun(receiptBackedEpisode);

    // An UNRECEIPTED outcome: same proposal/cohort labelling, but its
    // run_episode_id was never reserved/dispatched/committed — no receipt
    // row exists for it. This is exactly the untreated-dispatch case the
    // contract's global invariant forbids counting toward a verdict.
    await outcomes.finalizeAsync({
      rootSessionId: 'ses-unreceipted',
      runEpisodeId: 'episode-unreceipted-no-receipt',
      proposalId: proposal.id,
      experimentVariant: 'candidate',
      terminalStatus: 'completed',
      objectiveVerdict: 'success',
      objectiveEvidence: { producedArtifact: true, errorCount: 0, approvalDenied: false },
    });

    // Sanity: the OLD unfiltered read counts BOTH rows (proves the fixture
    // itself is valid and the exclusion below is really about receipts, not
    // an unrelated cohort/proposal mismatch).
    const unfiltered = await outcomes.listByExperimentAsync(proposal.id);
    expect(unfiltered.length).toBe(2);

    const receiptBacked = await outcomes.listReceiptBackedByExperimentAsync(experiment.id, proposal.id);
    expect(receiptBacked.map((o) => o.rootSessionId)).toEqual([receiptBackedEpisode]);
    expect(receiptBacked.map((o) => o.rootSessionId)).not.toContain('ses-unreceipted');
  });

  it('includes every outcome that DOES have a matching receipt (positive control)', async () => {
    const { proposal, experiment } = await seedExperiment();
    const outcomes = new AgentRunOutcomesRepository(db);

    await driveReceiptBackedRun('episode-positive-1');

    const receiptBacked = await outcomes.listReceiptBackedByExperimentAsync(experiment.id, proposal.id);
    expect(receiptBacked).toHaveLength(1);
    expect(receiptBacked[0]!.rootSessionId).toBe('episode-positive-1');
  });
});
