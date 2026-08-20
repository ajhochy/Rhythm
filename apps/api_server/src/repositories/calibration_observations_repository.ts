/**
 * C6 — versioned calibration observations repository (additive, dual-engine).
 *
 * Dual-engine, following AgentOrgExperimentsRepository: SQLite uses
 * synchronous better-sqlite3 with the throwaway `:memory:` fallback for tests
 * that never called initDb(); Postgres queries the pool directly with no
 * fallback. The column set MUST stay identical to the SQLite schema in
 * migrations.ts and postgres_bootstrap.ts — enforced by
 * skill_schema_parity.test.ts.
 *
 * INSERT-ONLY: an observation is written once and never mutated — there is
 * no update method and no delete method, matching AgentRunOutcomesRepository.
 * The schema enforces the same thing with triggers (see migrations.ts /
 * postgres_bootstrap.ts), so a future caller that bypasses this class still
 * cannot rewrite or remove history.
 *
 * C6 (repair item 2) — every read/write is EXPLICITLY owner-scoped via
 * {@link CalibrationOwnerScope}. There is no implicit "list everything"
 * method: a caller that genuinely needs a cross-owner admin view must name
 * that intent explicitly (see {@link listAllForLocalAdminAsync}), so a
 * future caller can never accidentally leak one user's calibration evidence
 * into another's ranking view.
 */
import Database from 'better-sqlite3';

import { env } from '../config/env';
import { getDb, getPostgresPool } from '../database/db';
import { runMigrations } from '../database/migrations';
import type { ExperimentDecision } from '../models/agent_org_experiment';
import {
  type CalibrationObservationInput,
  type CalibrationOwnerScope,
  type RevisionedCalibrationObservation,
} from '../models/calibration_observation';

interface ObservationRow {
  id: string;
  owner_id: number | null;
  source_event_id: string;
  observation_type: string;
  proposal_id: string;
  experiment_id: string | null;
  generator_version: string;
  detector_version: string;
  kind: string;
  treatment_version: string;
  metric_version: string;
  initial_confidence: number;
  human_decision: string | null;
  experiment_decision: string | null;
  experiment_effect: number | null;
  post_deploy_regression: number | null;
  revision: number;
  created_at: string | Date;
  updated_at: string | Date;
}

function toIso(value: string | Date): string {
  return typeof value === 'string' ? value : value.toISOString();
}

function rowToModel(row: ObservationRow): RevisionedCalibrationObservation {
  return {
    id: row.id,
    ownerId: row.owner_id ?? null,
    sourceEventId: row.source_event_id,
    observationType: row.observation_type,
    proposalId: row.proposal_id,
    experimentId: row.experiment_id ?? null,
    generatorVersion: row.generator_version,
    detectorVersion: row.detector_version,
    kind: row.kind,
    treatmentVersion: row.treatment_version,
    metricVersion: row.metric_version,
    initialConfidence: Number(row.initial_confidence),
    humanDecision: row.human_decision ?? null,
    experimentDecision: (row.experiment_decision as ExperimentDecision | null) ?? null,
    experimentEffect: row.experiment_effect ?? null,
    postDeployRegression: row.post_deploy_regression ?? null,
    revision: row.revision ?? 0,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function makeInMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

/** Fail-closed validation — a malformed observation is rejected, never silently coerced. */
function assertRequiredFields(input: CalibrationObservationInput): void {
  for (const [field, value] of Object.entries({
    sourceEventId: input.sourceEventId,
    observationType: input.observationType,
    proposalId: input.proposalId,
    generatorVersion: input.generatorVersion,
    detectorVersion: input.detectorVersion,
    kind: input.kind,
    treatmentVersion: input.treatmentVersion,
    metricVersion: input.metricVersion,
  })) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`calibration observation: '${field}' is required`);
    }
  }
  if (typeof input.initialConfidence !== 'number' || !Number.isFinite(input.initialConfidence)) {
    throw new Error(`calibration observation: 'initialConfidence' must be a finite number`);
  }
  if (input.scope.kind === 'owner' && !Number.isInteger(input.scope.ownerId)) {
    throw new Error(`calibration observation: scope.ownerId must be an integer when scope.kind is 'owner'`);
  }
}

/** Owner-scoped SQL predicate: NULL owner_id for system-global, exact match for owner. */
function ownerPredicate(scope: CalibrationOwnerScope, placeholder: string): { sql: string; param: number | null } {
  if (scope.kind === 'system-global') {
    return { sql: 'owner_id IS NULL', param: null };
  }
  return { sql: `owner_id = ${placeholder}`, param: scope.ownerId };
}

export class CalibrationObservationsRepository {
  /** SQLite-only handle. Never populated (and never used) under Postgres. */
  private db: Database.Database | null;

  constructor(db?: Database.Database) {
    if (env.dbClient === 'postgres') {
      this.db = null;
      return;
    }
    if (db) {
      this.db = db;
    } else {
      try {
        this.db = getDb();
      } catch {
        this.db = makeInMemoryDb();
      }
    }
  }

  /**
   * Persist one immutable observation. C6-5 — calibration ships disabled by
   * default (`RHYTHM_CALIBRATION_ENABLED`): when off, no calibration
   * observation is ever persisted and this returns `null` instead of writing
   * a row, matching the flag-off no-op shape used elsewhere in this codebase
   * (e.g. agentSchedulerService.ts's `researchProjectsEnabled` gate).
   *
   * Idempotent on `(scope, sourceEventId, observationType)` — a caller that
   * safely retries recording the SAME deterministic event (e.g. after a
   * crash between the real decision write and this call) gets the EXISTING
   * row back unchanged, never a duplicate insert and never a thrown unique-
   * constraint error. This is a proactive check (mirrors
   * AgentOrgProposalsRepository's dedupKey pattern); the DB's own unique
   * index is defense-in-depth for a genuinely concurrent writer.
   */
  async createAsync(
    input: CalibrationObservationInput,
  ): Promise<RevisionedCalibrationObservation | null> {
    if (!env.calibrationEnabled) return null;
    assertRequiredFields(input);

    const existing = await this.findByEventIdentityAsync(
      input.scope,
      input.sourceEventId,
      input.observationType,
    );
    if (existing) return existing;

    const row = {
      id: input.id ?? crypto.randomUUID(),
      owner_id: input.scope.kind === 'owner' ? input.scope.ownerId : null,
      source_event_id: input.sourceEventId,
      observation_type: input.observationType,
      proposal_id: input.proposalId,
      experiment_id: input.experimentId ?? null,
      generator_version: input.generatorVersion,
      detector_version: input.detectorVersion,
      kind: input.kind,
      treatment_version: input.treatmentVersion,
      metric_version: input.metricVersion,
      initial_confidence: input.initialConfidence,
      human_decision: input.humanDecision ?? null,
      experiment_decision: input.experimentDecision ?? null,
      experiment_effect: input.experimentEffect ?? null,
      post_deploy_regression: input.postDeployRegression ?? null,
    };

    const insertSql = (ph: string) =>
      `INSERT INTO calibration_observations
         (id, owner_id, source_event_id, observation_type, proposal_id, experiment_id,
          generator_version, detector_version, kind, treatment_version,
          metric_version, initial_confidence, human_decision, experiment_decision,
          experiment_effect, post_deploy_regression)
       VALUES (${ph})`;

    try {
      if (env.dbClient === 'postgres') {
        await getPostgresPool().query(
          insertSql('$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16'),
          Object.values(row),
        );
      } else {
        this.db!.prepare(insertSql('?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?')).run(...Object.values(row));
      }
    } catch (err) {
      // Defense-in-depth: a concurrent writer raced us between the
      // findByEventIdentityAsync check and this insert on the SAME event
      // identity — return the now-existing row rather than surfacing a raw
      // unique-constraint error for a legitimate idempotent retry.
      const raced = await this.findByEventIdentityAsync(
        input.scope,
        input.sourceEventId,
        input.observationType,
      );
      if (raced) return raced;
      throw err;
    }

    const stored = await this.findByIdAsync(row.id);
    if (!stored) throw new Error(`calibration observation '${row.id}' was not persisted`);
    return stored;
  }

  async findByIdAsync(id: string): Promise<RevisionedCalibrationObservation | null> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `SELECT * FROM calibration_observations WHERE id = $1`,
        [id],
      );
      return r.rows.length > 0 ? rowToModel(r.rows[0] as ObservationRow) : null;
    }
    const row = this.db!
      .prepare(`SELECT * FROM calibration_observations WHERE id = ?`)
      .get(id) as ObservationRow | undefined;
    return row ? rowToModel(row) : null;
  }

  /** The exact row a `(scope, sourceEventId, observationType)` triple identifies, or null. */
  async findByEventIdentityAsync(
    scope: CalibrationOwnerScope,
    sourceEventId: string,
    observationType: string,
  ): Promise<RevisionedCalibrationObservation | null> {
    if (env.dbClient === 'postgres') {
      const owner = ownerPredicate(scope, '$1');
      const args = owner.param !== null ? [owner.param, sourceEventId, observationType] : [sourceEventId, observationType];
      const sql = owner.param !== null
        ? `SELECT * FROM calibration_observations WHERE ${owner.sql} AND source_event_id = $2 AND observation_type = $3`
        : `SELECT * FROM calibration_observations WHERE ${owner.sql} AND source_event_id = $1 AND observation_type = $2`;
      const r = await getPostgresPool().query(sql, args);
      return r.rows.length > 0 ? rowToModel(r.rows[0] as ObservationRow) : null;
    }
    const owner = ownerPredicate(scope, '?');
    const args = owner.param !== null ? [owner.param, sourceEventId, observationType] : [sourceEventId, observationType];
    const sql = `SELECT * FROM calibration_observations WHERE ${owner.sql} AND source_event_id = ? AND observation_type = ?`;
    const row = this.db!.prepare(sql).get(...args) as ObservationRow | undefined;
    return row ? rowToModel(row) : null;
  }

  /** Every observation recorded for a homogeneous family WITHIN one owner scope, oldest first. */
  async listByFamilyAsync(
    scope: CalibrationOwnerScope,
    generatorVersion: string,
    detectorVersion: string,
    kind: string,
    treatmentVersion: string,
    metricVersion: string,
  ): Promise<RevisionedCalibrationObservation[]> {
    if (env.dbClient === 'postgres') {
      const owner = ownerPredicate(scope, '$1');
      const rest = owner.param !== null
        ? ['$2', '$3', '$4', '$5', '$6']
        : ['$1', '$2', '$3', '$4', '$5'];
      const sql = `SELECT * FROM calibration_observations
        WHERE ${owner.sql} AND generator_version = ${rest[0]} AND detector_version = ${rest[1]} AND kind = ${rest[2]}
          AND treatment_version = ${rest[3]} AND metric_version = ${rest[4]}
        ORDER BY created_at, id`;
      const args = [
        ...(owner.param !== null ? [owner.param] : []),
        generatorVersion,
        detectorVersion,
        kind,
        treatmentVersion,
        metricVersion,
      ];
      const r = await getPostgresPool().query(sql, args);
      return (r.rows as ObservationRow[]).map(rowToModel);
    }
    const owner = ownerPredicate(scope, '?');
    const sql = `SELECT * FROM calibration_observations
      WHERE ${owner.sql} AND generator_version = ? AND detector_version = ? AND kind = ?
        AND treatment_version = ? AND metric_version = ?
      ORDER BY created_at, id`;
    const args = [
      ...(owner.param !== null ? [owner.param] : []),
      generatorVersion,
      detectorVersion,
      kind,
      treatmentVersion,
      metricVersion,
    ];
    const rows = this.db!.prepare(sql).all(...args) as ObservationRow[];
    return rows.map(rowToModel);
  }

  /**
   * Trusted local-admin/operator escape hatch ONLY — every OTHER method on
   * this class is owner-scoped by construction. Named explicitly (never
   * called "listAll") so a caller that reaches for it has to say, in the
   * call site itself, that it intends a cross-owner view. Not used by any
   * ranking/display path — see calibration_snapshot_service.ts, which is
   * always scope-bound.
   */
  async listAllForLocalAdminAsync(): Promise<RevisionedCalibrationObservation[]> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(`SELECT * FROM calibration_observations ORDER BY created_at, id`);
      return (r.rows as ObservationRow[]).map(rowToModel);
    }
    const rows = this.db!
      .prepare(`SELECT * FROM calibration_observations ORDER BY created_at, id`)
      .all() as ObservationRow[];
    return rows.map(rowToModel);
  }
}
