/**
 * C6-2 — calibration snapshots are versioned per homogeneous family;
 * insufficient data is explicitly uncalibrated, never fabricated (contract
 * docs/ai/contracts/issue-c6.json).
 *
 * Falsification note: the "never mutates proposal state" test is the load-
 * bearing one — remove the fail-closed threshold and this service would
 * start reporting a `calibrated` confidence number after a single
 * observation; wire it (hypothetically) into an approval gate and this test
 * would be the only thing proving it still cannot move a real proposal's
 * status/outcomeStatus.
 */
import Database from 'better-sqlite3';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

import { env } from '../config/env';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { CalibrationObservationsRepository } from '../repositories/calibration_observations_repository';
import {
  computeCalibrationSnapshotAsync,
  MIN_DECIDED_OBSERVATIONS_FOR_CALIBRATION,
  type CalibrationFamilyKey,
} from '../services/calibration_snapshot_service';

let db: Database.Database;
let originalCalibrationEnabled: boolean;

const FAMILY: CalibrationFamilyKey = {
  generatorVersion: 'gen-v1',
  detectorVersion: 'det-v1',
  kind: 'refine-config',
  treatmentVersion: 'system-prompt-v1',
  metricVersion: 'objective-success-rate-v1',
};

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

let eventCounter = 0;

async function seedDecided(count: number, decision: 'promote' | 'regress' | 'inconclusive') {
  const repo = new CalibrationObservationsRepository();
  for (let i = 0; i < count; i += 1) {
    eventCounter += 1;
    await repo.createAsync({
      ...FAMILY,
      scope: { kind: 'system-global' },
      sourceEventId: `snapshot-test-event-${eventCounter}`,
      observationType: 'experiment-decision',
      proposalId: 'test-proposal-1',
      initialConfidence: 0.5,
      humanDecision: null,
      experimentDecision: decision,
    });
  }
}

describe('C6-2 calibration snapshots are versioned per homogeneous family; insufficient data is explicitly uncalibrated, never fabricated', () => {
  it('is uncalibrated with zero observations', async () => {
    const snapshot = await computeCalibrationSnapshotAsync(FAMILY);
    expect(snapshot.status).toBe('uncalibrated');
    expect(snapshot.calibratedConfidence).toBeUndefined();
    expect(snapshot.observationCount).toBe(0);
  });

  it(`stays uncalibrated below the ${MIN_DECIDED_OBSERVATIONS_FOR_CALIBRATION}-decided-observation floor`, async () => {
    await seedDecided(MIN_DECIDED_OBSERVATIONS_FOR_CALIBRATION - 1, 'promote');
    const snapshot = await computeCalibrationSnapshotAsync(FAMILY);
    expect(snapshot.status).toBe('uncalibrated');
    expect(snapshot.calibratedConfidence).toBeUndefined();
    expect(snapshot.decidedCount).toBe(MIN_DECIDED_OBSERVATIONS_FOR_CALIBRATION - 1);
  });

  it('becomes calibrated at the floor with the exact deterministic score, never a fabricated number', async () => {
    // 3 promote (score 1) + 2 regress (score 0) => mean 0.6, not 0.5 (the
    // seeded initialConfidence) — proves the snapshot scores real decisions,
    // it does not just echo the input guess back.
    await seedDecided(3, 'promote');
    await seedDecided(2, 'regress');
    const snapshot = await computeCalibrationSnapshotAsync(FAMILY);
    expect(snapshot.status).toBe('calibrated');
    expect(snapshot.decidedCount).toBe(5);
    expect(snapshot.calibratedConfidence).toBeCloseTo(0.6, 10);
  });

  it('task-c6-calibration-c4: counts only experiment-decision observations', async () => {
    await seedDecided(5, 'promote');
    await new CalibrationObservationsRepository().createAsync({
      ...FAMILY,
      scope: { kind: 'system-global' },
      sourceEventId: 'post-deploy-regression:proposal-1:7',
      observationType: 'post-deploy-regression',
      proposalId: 'proposal-1',
      initialConfidence: 0.5,
      humanDecision: null,
      postDeployRegression: 1,
    });

    const snapshot = await computeCalibrationSnapshotAsync(FAMILY);
    expect(snapshot.observationCount).toBe(5);
    expect(snapshot.decidedCount).toBe(5);
  });

  it('stays uncalibrated when calibration is disabled, even with abundant decided data', async () => {
    await seedDecided(10, 'promote');
    env.calibrationEnabled = false;
    const snapshot = await computeCalibrationSnapshotAsync(FAMILY);
    expect(snapshot.status).toBe('uncalibrated');
    expect(snapshot.calibratedConfidence).toBeUndefined();
  });

  it('never mutates a real proposal status or outcome status (ranking-only hard invariant)', async () => {
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'refine-config',
      risk: 'low',
      title: 'seed proposal for calibration invariant test',
    } as never);
    expect(proposal.status).toBe('proposed');
    expect(proposal.outcomeStatus).toBe('unproven');

    await seedDecided(10, 'promote'); // plenty to reach 'calibrated'
    const snapshot = await computeCalibrationSnapshotAsync(FAMILY);
    expect(snapshot.status).toBe('calibrated');

    const reread = await proposalsRepo.findByIdAsync(proposal.id);
    expect(reread!.status).toBe('proposed');
    expect(reread!.outcomeStatus).toBe('unproven');
    expect(reread!.revision).toBe(proposal.revision);
  });
});
