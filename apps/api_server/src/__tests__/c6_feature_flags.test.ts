/**
 * C6-5 — feature flags gate treatment-v2 and calibration; default optimizer
 * mode is shadow (contract docs/ai/contracts/issue-c6.json).
 *
 * Falsification note: the "no-op when off" assertions are the load-bearing
 * ones — flip `calibrationEnabled` to always-true internally and the
 * "persists nothing when disabled" / "stays uncalibrated when disabled"
 * tests below fail.
 */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { env } from '../config/env';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { CalibrationObservationsRepository } from '../repositories/calibration_observations_repository';
import { computeCalibrationSnapshotAsync } from '../services/calibration_snapshot_service';

let db: Database.Database;
let originalTreatmentV2: boolean;
let originalCalibration: boolean;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  originalTreatmentV2 = env.treatmentV2Enabled;
  originalCalibration = env.calibrationEnabled;
});

afterEach(() => {
  env.treatmentV2Enabled = originalTreatmentV2;
  env.calibrationEnabled = originalCalibration;
});

describe('C6-5 feature flags gate treatment-v2 and calibration; default optimizer mode is shadow', () => {
  it('both flags default false when their env vars are unset, and true only when explicitly "true"', async () => {
    const originalTreatmentV2Env = process.env.RHYTHM_TREATMENT_V2_ENABLED;
    const originalCalibrationEnv = process.env.RHYTHM_CALIBRATION_ENABLED;
    try {
      delete process.env.RHYTHM_TREATMENT_V2_ENABLED;
      delete process.env.RHYTHM_CALIBRATION_ENABLED;
      vi.resetModules();
      const unset = await import('../config/env');
      expect(unset.env.treatmentV2Enabled).toBe(false);
      expect(unset.env.calibrationEnabled).toBe(false);

      process.env.RHYTHM_TREATMENT_V2_ENABLED = 'true';
      process.env.RHYTHM_CALIBRATION_ENABLED = 'true';
      vi.resetModules();
      const enabled = await import('../config/env');
      expect(enabled.env.treatmentV2Enabled).toBe(true);
      expect(enabled.env.calibrationEnabled).toBe(true);
    } finally {
      if (originalTreatmentV2Env === undefined) {
        delete process.env.RHYTHM_TREATMENT_V2_ENABLED;
      } else {
        process.env.RHYTHM_TREATMENT_V2_ENABLED = originalTreatmentV2Env;
      }
      if (originalCalibrationEnv === undefined) {
        delete process.env.RHYTHM_CALIBRATION_ENABLED;
      } else {
        process.env.RHYTHM_CALIBRATION_ENABLED = originalCalibrationEnv;
      }
      vi.resetModules();
    }
  });

  it('CalibrationObservationsRepository persists nothing when calibrationEnabled is false', async () => {
    env.calibrationEnabled = false;
    const repo = new CalibrationObservationsRepository();
    const result = await repo.createAsync({
      scope: { kind: 'system-global' },
      sourceEventId: 'feature-flag-test-event-1',
      observationType: 'experiment-decision',
      proposalId: 'test-proposal-1',
      generatorVersion: 'gen-v1',
      detectorVersion: 'det-v1',
      kind: 'refine-config',
      treatmentVersion: 'system-prompt-v1',
      metricVersion: 'objective-success-rate-v1',
      initialConfidence: 0.5,
      humanDecision: null,
    });
    expect(result).toBeNull();
    expect(await repo.listAllForLocalAdminAsync()).toHaveLength(0);
  });

  it('CalibrationObservationsRepository persists normally once calibrationEnabled is true', async () => {
    env.calibrationEnabled = true;
    const repo = new CalibrationObservationsRepository();
    const result = await repo.createAsync({
      scope: { kind: 'system-global' },
      sourceEventId: 'feature-flag-test-event-2',
      observationType: 'experiment-decision',
      proposalId: 'test-proposal-1',
      generatorVersion: 'gen-v1',
      detectorVersion: 'det-v1',
      kind: 'refine-config',
      treatmentVersion: 'system-prompt-v1',
      metricVersion: 'objective-success-rate-v1',
      initialConfidence: 0.5,
      humanDecision: null,
    });
    expect(result).not.toBeNull();
    expect(await repo.listAllForLocalAdminAsync()).toHaveLength(1);
  });

  it('computeCalibrationSnapshotAsync stays uncalibrated when calibrationEnabled is false, even with abundant prior data', async () => {
    env.calibrationEnabled = true;
    const repo = new CalibrationObservationsRepository();
    for (let i = 0; i < 10; i += 1) {
      await repo.createAsync({
        scope: { kind: 'system-global' },
        sourceEventId: `feature-flag-test-event-snapshot-${i}`,
        observationType: 'experiment-decision',
        proposalId: 'test-proposal-1',
        generatorVersion: 'gen-v1',
        detectorVersion: 'det-v1',
        kind: 'refine-config',
        treatmentVersion: 'system-prompt-v1',
        metricVersion: 'objective-success-rate-v1',
        initialConfidence: 0.5,
        humanDecision: null,
        experimentDecision: 'promote',
      });
    }

    env.calibrationEnabled = false;
    const snapshot = await computeCalibrationSnapshotAsync({
      generatorVersion: 'gen-v1',
      detectorVersion: 'det-v1',
      kind: 'refine-config',
      treatmentVersion: 'system-prompt-v1',
      metricVersion: 'objective-success-rate-v1',
    });
    expect(snapshot.status).toBe('uncalibrated');
    expect(snapshot.calibratedConfidence).toBeUndefined();
  });
});
