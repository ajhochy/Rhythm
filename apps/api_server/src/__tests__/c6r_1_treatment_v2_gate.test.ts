/**
 * C6 (repair) item 1 — treatment-v2 flag is load-bearing.
 *
 * docs/ai/contracts/issue-c6.json, criterion c6r-1. Before this change,
 * `env.treatmentV2Enabled` existed in config/env.ts but was never read by
 * org_proposal_experiment_service.ts or agent_runner.ts — a disabled flag
 * had NO effect on the reserve/prepare/commit chain. This file proves the
 * gate on the shared service functions directly (WS-boundary coverage lives
 * in c2_d_s4_ws_reserved_treatment_dispatch.test.ts's "C6 item 1" describe).
 *
 * Falsification: commenting out any of the three service guards or the
 * AgentRunner dispatch guard turns the corresponding test below red (recorded
 * in the run note).
 */
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { env } from '../config/env';
import { setDb, getDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentConfigsRepository, type RevisionedAgentConfig } from '../repositories/agent_configs_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { AgentOrgExperimentsRepository } from '../repositories/agent_org_experiments_repository';
import { AgentOrgExperimentEnrollmentsRepository } from '../repositories/agent_org_experiment_enrollments_repository';
import { AgentOrgTreatmentReceiptsRepository } from '../repositories/agent_org_treatment_receipts_repository';
import {
  commitReservedTreatmentDispatch,
  prepareReservedTreatment,
  reserveRunEnrollment,
  resolveRunEnrollment,
  TreatmentDispatchCommitError,
} from '../services/org_proposal_experiment_service';
import { PROPOSAL_EVIDENCE_BUNDLE_VERSION } from '../models/proposal_evidence_bundle';

const PROFILE_ID = 'c6r1-profile';
const BASELINE_PROMPT = 'c6r1 baseline prompt';
const CANDIDATE_PROMPT = 'c6r1 candidate prompt';
const TARGET_REF = `agent_config:${PROFILE_ID}`;
const ASSIGNMENT_KEY = 'c6r1-key';

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
    guardrails: ['terminal-error-rate'],
    experimentAdapter: 'paired-cohort-outcome',
    rollbackRule: 'revert',
    generatorVersion: 'v1',
    confidenceCalibrationVersion: 'v1',
  };
}

async function seedProfileAndExperiment(): Promise<RevisionedAgentConfig> {
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
    title: 'c6r1 proposal',
    targetRef: TARGET_REF,
    changeJson: JSON.stringify({
      configPatch: { agentConfigId: PROFILE_ID, field: 'system_prompt', value: CANDIDATE_PROMPT },
    }),
  });
  await new AgentOrgExperimentsRepository().declareAsync({
    proposalId: proposal.id,
    adapter: 'paired-cohort-outcome',
    evidenceBundleJson: JSON.stringify(bundle(hash)),
    baselineSpecJson: JSON.stringify(spec(BASELINE_PROMPT, hash)),
    candidateSpecJson: JSON.stringify(spec(CANDIDATE_PROMPT, hash)),
    assignmentKey: ASSIGNMENT_KEY,
    stoppingRule: { minSamplesPerCohort: 1, minEffect: 0.1 },
    maxExposure: 100,
  });
  return profile;
}

let originalTreatmentV2Enabled: boolean;

beforeEach(() => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  delete process.env.RHYTHM_OPTIMIZER_MODE;
  originalTreatmentV2Enabled = env.treatmentV2Enabled;
});

afterEach(() => {
  env.treatmentV2Enabled = originalTreatmentV2Enabled;
});

describe('C6 item 1 — treatment-v2 flag gates reserveRunEnrollment/resolveRunEnrollment/prepareReservedTreatment/commitReservedTreatmentDispatch', () => {
  it('reserveRunEnrollment returns null before the existing-enrollment lookup when disabled — no enrollment row is created', async () => {
    await seedProfileAndExperiment();
    env.treatmentV2Enabled = false;

    const runEpisodeId = 'c6r1-reserve-disabled';
    const reservation = await reserveRunEnrollment(runEpisodeId, PROFILE_ID);
    expect(reservation).toBeNull();

    const enrollment = await new AgentOrgExperimentEnrollmentsRepository().findByRunEpisodeIdAsync(
      runEpisodeId,
    );
    expect(enrollment).toBeNull();
  });

  it('resolveRunEnrollment returns null when disabled, even for a reservation made while enabled', async () => {
    await seedProfileAndExperiment();
    env.treatmentV2Enabled = true;
    const runEpisodeId = 'c6r1-resolve-disabled';
    const reservation = await reserveRunEnrollment(runEpisodeId, PROFILE_ID);
    expect(reservation).not.toBeNull();

    env.treatmentV2Enabled = false;
    const resolved = await resolveRunEnrollment(runEpisodeId);
    expect(resolved).toBeNull();
  });

  it('prepareReservedTreatment returns invalid_binding when disabled, even for a reservation made while enabled', async () => {
    await seedProfileAndExperiment();
    env.treatmentV2Enabled = true;
    const runEpisodeId = 'c6r1-prepare-disabled';
    const reservation = await reserveRunEnrollment(runEpisodeId, PROFILE_ID);
    expect(reservation).not.toBeNull();

    env.treatmentV2Enabled = false;
    const preparation = await prepareReservedTreatment(reservation!);
    expect(preparation.status).toBe('invalid_binding');
  });

  it('commitReservedTreatmentDispatch fails closed (no receipt written) when the flag turns off after reservation', async () => {
    await seedProfileAndExperiment();
    env.treatmentV2Enabled = true;
    const runEpisodeId = 'c6r1-commit-disabled';
    const reservation = await reserveRunEnrollment(runEpisodeId, PROFILE_ID);
    expect(reservation).not.toBeNull();
    const preparation = await prepareReservedTreatment(reservation!);
    expect(preparation.status).toBe('ready');
    if (preparation.status !== 'ready') throw new Error('unreachable');

    env.treatmentV2Enabled = false;
    await expect(
      commitReservedTreatmentDispatch(reservation!, preparation),
    ).rejects.toBeInstanceOf(TreatmentDispatchCommitError);

    const receipt = await new AgentOrgTreatmentReceiptsRepository().findByRunEpisodeIdAsync(runEpisodeId);
    expect(receipt).toBeNull();
    const enrollment = await new AgentOrgExperimentEnrollmentsRepository().findByRunEpisodeIdAsync(
      runEpisodeId,
    );
    // Fails closed via the same pre_dispatch_failed path prepareReservedTreatment
    // failures already use — never left silently 'reserved' as if nothing
    // had been attempted, and never 'dispatched' without a receipt.
    expect(enrollment?.state).toBe('treatment_failed');
  });

  it('enabled representative behavior is unchanged: reserve -> prepare -> commit succeeds end to end', async () => {
    await seedProfileAndExperiment();
    env.treatmentV2Enabled = true;
    const runEpisodeId = 'c6r1-enabled-happy-path';
    const reservation = await reserveRunEnrollment(runEpisodeId, PROFILE_ID);
    expect(reservation).not.toBeNull();
    const preparation = await prepareReservedTreatment(reservation!);
    expect(preparation.status).toBe('ready');
    if (preparation.status !== 'ready') throw new Error('unreachable');
    const receipt = await commitReservedTreatmentDispatch(reservation!, preparation);
    expect(receipt.runEpisodeId).toBe(runEpisodeId);

    const persisted = await new AgentOrgTreatmentReceiptsRepository().findByRunEpisodeIdAsync(runEpisodeId);
    expect(persisted).not.toBeNull();
  });
});
