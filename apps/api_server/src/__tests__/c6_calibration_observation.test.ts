/**
 * C6-1 — calibration observations are persisted with all required fields and
 * fail-closed on missing data (contract docs/ai/contracts/issue-c6.json).
 *
 * Falsification note: every "fails closed" assertion below is a real
 * regression catcher — remove the corresponding guard in
 * calibration_observations_repository.ts and the matching `it` turns green
 * for the wrong reason (no throw) or persists malformed data silently.
 */
import Database from 'better-sqlite3';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

import { env } from '../config/env';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { CalibrationObservationsRepository } from '../repositories/calibration_observations_repository';

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

let eventCounter = 0;

function fullInput(overrides: Record<string, unknown> = {}) {
  eventCounter += 1;
  return {
    scope: { kind: 'system-global' as const },
    sourceEventId: `test-event-${eventCounter}`,
    observationType: 'experiment-decision',
    proposalId: 'test-proposal-1',
    generatorVersion: 'gen-v1',
    detectorVersion: 'det-v1',
    kind: 'refine-config',
    treatmentVersion: 'system-prompt-v1',
    metricVersion: 'objective-success-rate-v1',
    initialConfidence: 0.4,
    humanDecision: 'approved',
    experimentDecision: 'promote' as const,
    experimentEffect: 0.12,
    postDeployRegression: null,
    ...overrides,
  };
}

describe('C6-1 calibration observations are persisted with all required fields and fail-closed on missing data', () => {
  it('persists an observation with every field and reads it back unchanged', async () => {
    const repo = new CalibrationObservationsRepository();
    const created = await repo.createAsync(fullInput());
    expect(created).not.toBeNull();
    expect(created!.generatorVersion).toBe('gen-v1');
    expect(created!.detectorVersion).toBe('det-v1');
    expect(created!.kind).toBe('refine-config');
    expect(created!.treatmentVersion).toBe('system-prompt-v1');
    expect(created!.metricVersion).toBe('objective-success-rate-v1');
    expect(created!.initialConfidence).toBe(0.4);
    expect(created!.humanDecision).toBe('approved');
    expect(created!.experimentDecision).toBe('promote');
    expect(created!.experimentEffect).toBe(0.12);
    expect(created!.postDeployRegression).toBeNull();
    expect(created!.revision).toBe(0);

    const read = await repo.findByIdAsync(created!.id);
    expect(read).toEqual(created);
  });

  it('fails closed when a family field is missing (empty kind)', async () => {
    const repo = new CalibrationObservationsRepository();
    await expect(repo.createAsync(fullInput({ kind: '' }))).rejects.toThrow(/kind/);
  });

  it('fails closed when initialConfidence is not a finite number', async () => {
    const repo = new CalibrationObservationsRepository();
    await expect(
      repo.createAsync(fullInput({ initialConfidence: Number.NaN })),
    ).rejects.toThrow(/initialConfidence/);
  });

  it('persists multiple observations sharing the same family (no upsert-on-family)', async () => {
    const repo = new CalibrationObservationsRepository();
    await repo.createAsync(fullInput({ experimentDecision: 'promote' }));
    await repo.createAsync(fullInput({ experimentDecision: 'regress' }));
    const family = await repo.listByFamilyAsync(
      { kind: 'system-global' },
      'gen-v1', 'det-v1', 'refine-config', 'system-prompt-v1', 'objective-success-rate-v1',
    );
    expect(family).toHaveLength(2);
    expect(family.map((o) => o.experimentDecision).sort()).toEqual(['promote', 'regress']);
  });

  it('never persists a row when calibration is disabled (RHYTHM_CALIBRATION_ENABLED=false)', async () => {
    env.calibrationEnabled = false;
    const repo = new CalibrationObservationsRepository();
    const result = await repo.createAsync(fullInput());
    expect(result).toBeNull();
    const all = await repo.listAllForLocalAdminAsync();
    expect(all).toHaveLength(0);
  });

  it('is immutable: a raw UPDATE against calibration_observations is rejected by the schema', async () => {
    const repo = new CalibrationObservationsRepository();
    const created = await repo.createAsync(fullInput());
    expect(() =>
      db.prepare(`UPDATE calibration_observations SET initial_confidence = 0.99 WHERE id = ?`).run(created!.id),
    ).toThrow(/immutable/);
  });

  it('is immutable: a raw DELETE against calibration_observations is rejected by the schema', async () => {
    const repo = new CalibrationObservationsRepository();
    const created = await repo.createAsync(fullInput());
    expect(() =>
      db.prepare(`DELETE FROM calibration_observations WHERE id = ?`).run(created!.id),
    ).toThrow(/immutable/);
  });
});
