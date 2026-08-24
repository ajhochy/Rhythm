/**
 * C6-2 — versioned calibration snapshots per homogeneous family (contract
 * docs/ai/contracts/issue-causal-runtime-v2.json, phase C6).
 *
 * A snapshot is a read-only, deterministic AGGREGATE over every
 * {@link CalibrationObservation} recorded for one homogeneous family tuple
 * (generatorVersion, detectorVersion, kind, treatmentVersion, metricVersion).
 * It never persists anything itself — the observations already did that.
 *
 * Fail-closed: below {@link MIN_DECIDED_OBSERVATIONS_FOR_CALIBRATION} decided
 * observations (or when calibration is disabled), the family stays explicitly
 * `uncalibrated`. This function never fabricates a confidence number.
 *
 * HARD INVARIANT (do not weaken): this module has no import of, and no path
 * to, anything that mutates an `agent_org_proposals` row, an experiment's
 * decision, or a CAS/human-gate primitive. A snapshot is for ranking/
 * review-threshold display ONLY — see c6_calibration_snapshot.test.ts's
 * "never mutates proposal state" assertion, which proves this behaviorally
 * rather than just by import inspection.
 */
import { env } from '../config/env';
import type { ExperimentDecision } from '../models/agent_org_experiment';
import type { CalibrationOwnerScope } from '../models/calibration_observation';
import { CalibrationObservationsRepository } from '../repositories/calibration_observations_repository';

export interface CalibrationFamilyKey {
  generatorVersion: string;
  detectorVersion: string;
  kind: string;
  treatmentVersion: string;
  metricVersion: string;
}

export type CalibrationSnapshotStatus = 'calibrated' | 'uncalibrated';

export interface CalibrationSnapshot {
  family: CalibrationFamilyKey;
  status: CalibrationSnapshotStatus;
  /** Every observation recorded for this family, decided or not. */
  observationCount: number;
  /** Observations that reached an experiment decision — the ones scored below. */
  decidedCount: number;
  /**
   * Present only when `status === 'calibrated'`. The mean of a fixed,
   * deterministic score over every decided observation's
   * `experimentDecision` (promote=1, regress=0, inconclusive=0.5) — never
   * the raw `initialConfidence` guess, which this snapshot exists to correct.
   */
  calibratedConfidence?: number;
}

// ponytail: fixed floor, matching guardrail_registry.ts's fixed-threshold
// style — upgrade to a declared per-family bound if a real family ever needs
// a different minimum.
export const MIN_DECIDED_OBSERVATIONS_FOR_CALIBRATION = 5;

function decisionScore(decision: ExperimentDecision): number {
  if (decision === 'promote') return 1;
  if (decision === 'regress') return 0;
  return 0.5; // 'inconclusive'
}

function uncalibrated(family: CalibrationFamilyKey, observationCount: number, decidedCount: number): CalibrationSnapshot {
  return { family, status: 'uncalibrated', observationCount, decidedCount };
}

/**
 * Compute the current snapshot for one family, WITHIN one owner scope (C6
 * repair item 2 — never a cross-owner aggregate). Read-only: takes an
 * optional repository instance purely for test injection (in-memory SQLite
 * fixtures).
 */
export async function computeCalibrationSnapshotAsync(
  family: CalibrationFamilyKey,
  scope: CalibrationOwnerScope = { kind: 'system-global' },
  repo: CalibrationObservationsRepository = new CalibrationObservationsRepository(),
): Promise<CalibrationSnapshot> {
  // C6-5 — calibration ships disabled by default. Off means "never
  // calibrated", not "throw" — this is a ranking hint, not a required path.
  if (!env.calibrationEnabled) return uncalibrated(family, 0, 0);

  const observations = await repo.listByFamilyAsync(
    scope,
    family.generatorVersion,
    family.detectorVersion,
    family.kind,
    family.treatmentVersion,
    family.metricVersion,
  );
  const decisionObservations = observations.filter((o) => o.observationType === 'experiment-decision');
  const decided = decisionObservations.filter(
    (o): o is typeof o & { experimentDecision: ExperimentDecision } =>
      o.experimentDecision != null,
  );

  if (decided.length < MIN_DECIDED_OBSERVATIONS_FOR_CALIBRATION) {
    return uncalibrated(family, decisionObservations.length, decided.length);
  }

  const calibratedConfidence =
    decided.reduce((sum, o) => sum + decisionScore(o.experimentDecision), 0) / decided.length;

  return {
    family,
    status: 'calibrated',
    observationCount: decisionObservations.length,
    decidedCount: decided.length,
    calibratedConfidence,
  };
}
