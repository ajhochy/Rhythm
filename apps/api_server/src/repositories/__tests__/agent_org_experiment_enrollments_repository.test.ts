/**
 * C1 — pre-run episode enrollment.
 *
 * Today (base commit) cohort assignment happens at run FINALIZATION
 * (`resolveRunEnrollment`, called from `recordTerminalOutcome`). There is no
 * record of a reservation made BEFORE dispatch, so nothing can gate treatment
 * application on "did this exact run episode already reserve a cohort" or
 * enforce the exposure cap atomically against reservations rather than
 * finished runs.
 *
 * This is the first RED test for C1: a dedicated reservation keyed by a
 * stable `runEpisodeId`, persisted before any run outcome exists, and
 * idempotent per episode (reserving the same episode twice must never mint a
 * second cohort assignment — a retried dispatch for the same episode must see
 * the original commitment, not a fresh coin flip).
 */

import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { AgentOrgExperimentsRepository } from '../agent_org_experiments_repository';
import { AgentOrgExperimentEnrollmentsRepository } from '../agent_org_experiment_enrollments_repository';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
});

async function declaredExperiment() {
  const experiments = new AgentOrgExperimentsRepository();
  return experiments.declareAsync({
    proposalId: 'prop-1',
    adapter: 'paired-cohort-outcome',
    evidenceBundleJson: JSON.stringify({ version: 'proposal-evidence-v1' }),
    baselineSpecJson: JSON.stringify({ configRevision: 4 }),
    candidateSpecJson: JSON.stringify({ configRevision: 5 }),
    assignmentKey: 'exp-key-1',
    stoppingRule: { minSamplesPerCohort: 10, minEffect: 0.05 },
    maxExposure: 20,
  });
}

describe('C1 pre-run enrollment reservation', () => {
  it('persists a reservation keyed by a stable runEpisodeId before any outcome exists', async () => {
    const experiment = await declaredExperiment();
    const enrollments = new AgentOrgExperimentEnrollmentsRepository();

    const reserved = await enrollments.reserveAsync({
      runEpisodeId: 'episode-1',
      experimentId: experiment.id,
      proposalId: experiment.proposalId,
      profileId: 'profile-1',
      cohort: 'baseline',
      assignmentDigest: 'digest-1',
      baselineTargetRevisionHash: 'rev-hash-1',
      treatmentSpecHash: 'spec-hash-1',
    });

    expect(reserved.runEpisodeId).toBe('episode-1');
    expect(reserved.cohort).toBe('baseline');
    expect(reserved.state).toBe('reserved');
    expect(reserved.baselineTargetRevisionHash).toBe('rev-hash-1');
    expect(reserved.treatmentSpecHash).toBe('spec-hash-1');

    const found = await enrollments.findByRunEpisodeIdAsync('episode-1');
    expect(found).not.toBeNull();
    expect(found!.id).toBe(reserved.id);
  });

  it('is idempotent per run episode — reserving the same episode twice returns the original cohort', async () => {
    const experiment = await declaredExperiment();
    const enrollments = new AgentOrgExperimentEnrollmentsRepository();

    const first = await enrollments.reserveAsync({
      runEpisodeId: 'episode-2',
      experimentId: experiment.id,
      proposalId: experiment.proposalId,
      profileId: 'profile-1',
      cohort: 'candidate',
      assignmentDigest: 'digest-2',
      baselineTargetRevisionHash: 'rev-hash-2',
      treatmentSpecHash: 'spec-hash-2',
    });

    // A retried dispatch for the SAME episode must never mint a second
    // reservation or flip the cohort — it must see the original commitment.
    const second = await enrollments.reserveAsync({
      runEpisodeId: 'episode-2',
      experimentId: experiment.id,
      proposalId: experiment.proposalId,
      profileId: 'profile-1',
      cohort: 'baseline',
      assignmentDigest: 'digest-2',
      baselineTargetRevisionHash: 'rev-hash-2',
      treatmentSpecHash: 'spec-hash-2',
    });

    expect(second.id).toBe(first.id);
    expect(second.cohort).toBe('candidate');

    const all = db
      .prepare(`SELECT COUNT(*) as n FROM agent_org_experiment_enrollments WHERE run_episode_id = ?`)
      .get('episode-2') as { n: number };
    expect(all.n).toBe(1);
  });
});
