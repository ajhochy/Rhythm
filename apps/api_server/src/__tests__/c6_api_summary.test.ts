/**
 * C6-3 (backend half) — deployment status and causal outcome are already
 * separate fields on AgentOrgProposal (W6-c8: `status` vs `outcomeStatus`).
 * This proves the ADDITIVE `experimentSummary` this phase adds on top:
 * collecting progress, eligible/missing counts, treatment integrity,
 * guardrail status, terminal reason, tested spec fingerprints (never raw
 * bytes), and stale-before-apply conflicts (contract
 * docs/ai/contracts/issue-c6.json). The Flutter half of C6-3 is
 * apps/desktop_flutter/test/features/agent_optimizer/C6-3_summary_view_test.dart.
 *
 * Falsification note: the "never exposes raw content bytes" assertion is
 * load-bearing — if testedBaselineHash/testedCandidateHash were ever changed
 * to carry the raw spec JSON instead of a sha256 fingerprint, this test
 * fails.
 */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentOrgExperimentEnrollmentsRepository } from '../repositories/agent_org_experiment_enrollments_repository';
import { AgentOrgExperimentsRepository } from '../repositories/agent_org_experiments_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { buildExperimentSummaryAsync } from '../services/proposal_experiment_summary_service';
import { env } from '../config/env';
import { CalibrationObservationsRepository } from '../repositories/calibration_observations_repository';
import { UsersRepository } from '../repositories/users_repository';

let db: Database.Database;
let originalCalibrationEnabled: boolean;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  originalCalibrationEnabled = env.calibrationEnabled;
  env.calibrationEnabled = true;
});

afterEach(() => {
  env.calibrationEnabled = originalCalibrationEnabled;
});

function declareInput(proposalId: string, overrides: Record<string, unknown> = {}) {
  return {
    proposalId,
    adapter: 'system-prompt-v1',
    evidenceBundleJson: JSON.stringify({ experimentAdapter: 'system-prompt-v1' }),
    baselineSpecJson: JSON.stringify({ configRevision: 1 }),
    candidateSpecJson: JSON.stringify({ configRevision: 2 }),
    assignmentKey: 'exp-key-1',
    stoppingRule: { minSamplesPerCohort: 5, minEffect: 0.05 },
    maxExposure: 20,
    ...overrides,
  };
}

describe('C6-3 desktop UI surfaces deployment status, causal outcome, collecting progress, missing counts, treatment integrity, guardrail status, experiment terminal reason, baseline/candidate hashes, and stale-before-apply conflicts', () => {
  it('reports no_experiment when the proposal has never declared one', async () => {
    const proposal = await new AgentOrgProposalsRepository().createAsync({
      kind: 'refine-config',
      risk: 'low',
      title: 'no experiment yet',
    });
    const summary = await buildExperimentSummaryAsync(proposal);
    expect(summary.collectingProgress).toBe('no_experiment');
    expect(summary.eligibleCount).toBe(0);
    expect(summary.missingCount).toBe(0);
    expect(summary.treatmentIntegrity).toBe('unknown');
    expect(summary.guardrailStatus).toBe('unknown');
    expect(summary.terminalReason).toBeNull();
    expect(summary.testedBaselineHash).toBeNull();
    expect(summary.testedCandidateHash).toBeNull();
    expect(summary.staleBeforeApplyConflict).toBe(false);
  });

  it('reports collecting progress + eligible/missing enrollment counts for an undecided experiment', async () => {
    const proposal = await new AgentOrgProposalsRepository().createAsync({
      kind: 'refine-config',
      risk: 'low',
      title: 'collecting',
    });
    const experiment = await new AgentOrgExperimentsRepository().declareAsync(declareInput(proposal.id));

    const enrollmentsRepo = new AgentOrgExperimentEnrollmentsRepository();
    // 2 successfully terminalized (eligible), 1 treatment_failed (missing).
    for (let i = 0; i < 2; i += 1) {
      const enrollment = await enrollmentsRepo.reserveAsync({
        maxExposure: 20,
        runEpisodeId: `ep-ok-${i}`,
        experimentId: experiment.id,
        proposalId: proposal.id,
        profileId: 'profile-1',
        cohort: i % 2 === 0 ? 'baseline' : 'candidate',
        assignmentDigest: 'digest',
        baselineTargetRevisionHash: `sha256:${'a'.repeat(64)}`,
        treatmentSpecHash: 'b'.repeat(64),
      });
      await enrollmentsRepo.markDispatchedAsync(enrollment!.runEpisodeId);
      await enrollmentsRepo.markTerminalizedAsync(enrollment!.runEpisodeId);
    }
    const failed = await enrollmentsRepo.reserveAsync({
      maxExposure: 20,
      runEpisodeId: 'ep-failed',
      experimentId: experiment.id,
      proposalId: proposal.id,
      profileId: 'profile-1',
      cohort: 'baseline',
      assignmentDigest: 'digest',
      baselineTargetRevisionHash: `sha256:${'a'.repeat(64)}`,
      treatmentSpecHash: 'b'.repeat(64),
    });
    await enrollmentsRepo.markTreatmentFailedAsync(failed!.runEpisodeId, { failureCode: 'prompt_timeout' });

    const summary = await buildExperimentSummaryAsync(proposal);
    expect(summary.collectingProgress).toBe('collecting');
    expect(summary.eligibleCount).toBe(2);
    expect(summary.missingCount).toBe(1);
    expect(summary.terminalReason).toBeNull();
  });

  it('reports decided progress + terminal reason once the experiment records a decision', async () => {
    const proposal = await new AgentOrgProposalsRepository().createAsync({
      kind: 'refine-config',
      risk: 'low',
      title: 'decided',
    });
    const experiment = await new AgentOrgExperimentsRepository().declareAsync(declareInput(proposal.id));
    await new AgentOrgExperimentsRepository().recordDecisionAsync(
      experiment.id,
      'regress',
      'candidate underperformed the baseline',
    );

    const summary = await buildExperimentSummaryAsync(proposal);
    expect(summary.collectingProgress).toBe('decided');
    expect(summary.terminalReason).toBe('candidate underperformed the baseline');
  });

  it('task-c6-calibration-c5: exposes an owner-scoped calibration snapshot on the proposal summary', async () => {
    const owner = new UsersRepository().create({ name: 'Owner 71', email: 'owner-71@example.com' });
    const other = new UsersRepository().create({ name: 'Owner 72', email: 'owner-72@example.com' });
    const proposal = await new AgentOrgProposalsRepository().createAsync({
      kind: 'refine-config',
      risk: 'low',
      title: 'owner one',
      ownerUserId: owner.id,
    });
    await new AgentOrgExperimentsRepository().declareAsync(declareInput(proposal.id, {
      adapter: 'single-replay',
      evidenceBundleJson: JSON.stringify({
        version: 'proposal-evidence-v2',
        sourceEvidence: { sessionIds: ['ses-1'], eventIds: [] },
        counterEvidenceSearch: { query: 'q', searchedAt: '2026-08-20T00:00:00.000Z', contradictingCount: 0, method: 'same-profile-ledger-scan', coverage: 1 },
        target: { ref: 'agent_config:1', hash: 'sha256:abc' },
        expectedOutcome: 'better',
        primaryMetric: { name: 'objective-success-rate', direction: 'increase' },
        guardrails: ['terminal-error-rate'],
        experimentAdapter: 'single-replay',
        rollbackRule: 'restore',
        generatorVersion: 'gen-owner',
        confidenceCalibrationVersion: 'confidence-v1',
        initialConfidence: 0.7,
        detectorVersion: 'det-owner',
        treatmentVersion: 'system-prompt-v1',
        metricVersion: 'metric-owner',
      }),
    }));
    const observations = new CalibrationObservationsRepository();
    for (let i = 0; i < 5; i += 1) {
      await observations.createAsync({
        scope: { kind: 'owner', ownerId: owner.id },
        sourceEventId: `owner-71-decision-${i}`,
        observationType: 'experiment-decision',
        proposalId: proposal.id,
        generatorVersion: 'gen-owner',
        detectorVersion: 'det-owner',
        kind: 'refine-config',
        treatmentVersion: 'system-prompt-v1',
        metricVersion: 'metric-owner',
        initialConfidence: 0.7,
        humanDecision: null,
        experimentDecision: i < 4 ? 'promote' : 'regress',
      });
    }

    const summary = await buildExperimentSummaryAsync(proposal);
    expect(summary.calibrationStatus).toBe('calibrated');
    expect(summary.calibratedConfidence).toBeCloseTo(0.8, 10);

    const otherOwner = { ...proposal, ownerUserId: other.id };
    const isolated = await buildExperimentSummaryAsync(otherOwner);
    expect(isolated.calibrationStatus).toBe('uncalibrated');
    expect(isolated.calibratedConfidence).toBeNull();
  });

  it('exposes tested baseline/candidate spec fingerprints as sha256 hashes, never the raw spec bytes', async () => {
    const proposal = await new AgentOrgProposalsRepository().createAsync({
      kind: 'refine-config',
      risk: 'low',
      title: 'hash fingerprints',
    });
    await new AgentOrgExperimentsRepository().declareAsync(declareInput(proposal.id));

    const summary = await buildExperimentSummaryAsync(proposal);
    expect(summary.testedBaselineHash).toMatch(/^[0-9a-f]{64}$/);
    expect(summary.testedCandidateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(summary.testedBaselineHash).not.toBe(summary.testedCandidateHash);
    // Never the raw content bytes.
    expect(summary.testedBaselineHash).not.toContain('configRevision');
    expect(summary.testedCandidateHash).not.toContain('configRevision');
  });

  it('detects a stale-before-apply conflict when the live target drifted after a promoted experiment', async () => {
    const configsRepo = new AgentConfigsRepository();
    const config = configsRepo.insert({
      label: 'target profile',
      icon: 'robot',
      systemPrompt: 'ORIGINAL PROMPT',
    });

    const proposal = await new AgentOrgProposalsRepository().createAsync({
      kind: 'refine-config',
      risk: 'low',
      title: 'refine system prompt',
      status: 'proposed',
      changeJson: JSON.stringify({
        configPatch: { agentConfigId: config.id, field: 'system_prompt', value: 'NEW PROMPT' },
      }),
    });

    const experiment = await new AgentOrgExperimentsRepository().declareAsync(
      declareInput(proposal.id, {
        candidateSpecJson: JSON.stringify({
          agentConfigId: config.id,
          field: 'system_prompt',
          priorValue: 'ORIGINAL PROMPT',
          currentValue: 'ORIGINAL PROMPT',
          candidateValue: 'NEW PROMPT',
          evidenceTarget: { ref: `agent_config:${config.id}`, hash: `sha256:${'c'.repeat(64)}` },
        }),
      }),
    );
    await new AgentOrgExperimentsRepository().recordDecisionAsync(experiment.id, 'promote', 'candidate won');

    const beforeDrift = await buildExperimentSummaryAsync(proposal);
    expect(beforeDrift.staleBeforeApplyConflict).toBe(false);

    // The live target changes after the experiment was tested.
    configsRepo.update(config.id, { systemPrompt: 'SOMEONE ELSE EDITED THIS' });

    const afterDrift = await buildExperimentSummaryAsync(proposal);
    expect(afterDrift.staleBeforeApplyConflict).toBe(true);
  });
});
