import type { ExperimentDecision } from './agent_org_experiment';

/**
 * C6 (repair item 2) — explicit, closed ownership scope for a calibration
 * observation/query. Nullable-owner convention matching
 * `agent_org_proposals.owner_user_id` (added #1175, never exposed on the
 * model until this repair): `owner` means "this user's own calibration
 * evidence", `system-global` means the historical org-wide, no-owner rows.
 * Every repository read/write is scoped through one of these — there is no
 * implicit "everything" query (see {@link CalibrationObservationsRepository}).
 */
export type CalibrationOwnerScope =
  | { kind: 'owner'; ownerId: number }
  | { kind: 'system-global' };

/**
 * C6 — versioned calibration observations (contract
 * docs/ai/contracts/issue-causal-runtime-v2.json, phase C6).
 *
 * One row per real observation event (e.g. a proposal/experiment of a given
 * generator/detector/kind/treatment/metric version family reaching a human or
 * experiment decision, plus any later post-deploy regression measurement).
 * Deliberately NOT unique on the family tuple: many observations legitimately
 * accumulate for the same family over time, and it is exactly that
 * accumulation calibration_snapshot_service.ts reads to decide whether a
 * family has enough evidence to be calibrated at all — insufficient data
 * remains explicitly uncalibrated, never a fabricated confidence number.
 * Calibration is used for ranking and review-threshold purposes ONLY — it
 * must never bypass validation, risk policy, CAS, or human gates (hard
 * invariant: calibration data must not become a new authorization path).
 *
 * `sourceEventId` + `observationType` (+ owner) are UNIQUE (see migration):
 * a caller may safely re-attempt recording the SAME deterministic event
 * (e.g. `experiment-decision:<experimentId>`) after a crash without ever
 * duplicating it — `createAsync` is idempotent on this triple, not an
 * upsert (the row's other fields are never rewritten once inserted).
 *
 * INSERT-ONLY: written once at creation and never mutated afterward — see
 * the no-update/no-delete migration triggers. `revision` stays fixed at 0;
 * it exists only for shape parity with the repo's other Revisioned* models,
 * not because this row is ever CAS-updated.
 */
export interface CalibrationObservation {
  id: string;
  /** Null means system-global (no owner) — see {@link CalibrationOwnerScope}. */
  ownerId: number | null;
  /** Deterministic identity of the real event this observation records (e.g. `experiment-decision:<experimentId>`). */
  sourceEventId: string;
  /** e.g. `experiment-decision` | `post-deploy-regression` | `legacy` (pre-migration backfill). */
  observationType: string;
  proposalId: string;
  experimentId: string | null;
  generatorVersion: string;
  detectorVersion: string;
  kind: string;
  treatmentVersion: string;
  metricVersion: string;
  initialConfidence: number;
  humanDecision: string | null;
  experimentDecision?: ExperimentDecision | null;
  experimentEffect?: number | null;
  postDeployRegression?: number | null;
  /** Always 0 — see the class doc comment above. Never incremented. */
  revision?: number;
  createdAt: string;
  updatedAt: string;
}

/** Input shape for {@link CalibrationObservationsRepository.createAsync}. */
export interface CalibrationObservationInput {
  id?: string;
  scope: CalibrationOwnerScope;
  sourceEventId: string;
  observationType: string;
  proposalId: string;
  experimentId?: string | null;
  generatorVersion: string;
  detectorVersion: string;
  kind: string;
  treatmentVersion: string;
  metricVersion: string;
  initialConfidence: number;
  humanDecision: string | null;
  experimentDecision?: ExperimentDecision | null;
  experimentEffect?: number | null;
  postDeployRegression?: number | null;
}

/** Repository-backed observation row with its (always-0) revision field present. */
export type RevisionedCalibrationObservation = CalibrationObservation & { revision: number };

/**
 * Build a {@link CalibrationObservation} from a plain JSON object (camelCase keys).
 * Round-trips losslessly with {@link calibrationObservationToJson}.
 */
export function calibrationObservationFromJson(json: Record<string, unknown>): RevisionedCalibrationObservation {
  return {
    id: json.id as string,
    ownerId: (json.ownerId as number | null) ?? null,
    sourceEventId: json.sourceEventId as string,
    observationType: json.observationType as string,
    proposalId: json.proposalId as string,
    experimentId: (json.experimentId as string | null) ?? null,
    generatorVersion: json.generatorVersion as string,
    detectorVersion: json.detectorVersion as string,
    kind: json.kind as string,
    treatmentVersion: json.treatmentVersion as string,
    metricVersion: json.metricVersion as string,
    initialConfidence: Number(json.initialConfidence),
    humanDecision: (json.humanDecision as string) ?? null,
    experimentDecision: (json.experimentDecision as ExperimentDecision | null) ?? null,
    experimentEffect: typeof json.experimentEffect === 'number' ? json.experimentEffect : null,
    postDeployRegression: typeof json.postDeployRegression === 'number' ? json.postDeployRegression : null,
    revision: (json.revision as number) ?? 0,
    createdAt: json.createdAt as string,
    updatedAt: json.updatedAt as string,
  };
}

/** Serialize a {@link CalibrationObservation} to a plain JSON object (camelCase keys). */
export function calibrationObservationToJson(obs: CalibrationObservation): Record<string, unknown> {
  return {
    id: obs.id,
    ownerId: obs.ownerId,
    sourceEventId: obs.sourceEventId,
    observationType: obs.observationType,
    proposalId: obs.proposalId,
    experimentId: obs.experimentId,
    generatorVersion: obs.generatorVersion,
    detectorVersion: obs.detectorVersion,
    kind: obs.kind,
    treatmentVersion: obs.treatmentVersion,
    metricVersion: obs.metricVersion,
    initialConfidence: obs.initialConfidence,
    humanDecision: obs.humanDecision,
    experimentDecision: obs.experimentDecision,
    experimentEffect: obs.experimentEffect,
    postDeployRegression: obs.postDeployRegression,
    revision: obs.revision,
    createdAt: obs.createdAt,
    updatedAt: obs.updatedAt,
  };
}