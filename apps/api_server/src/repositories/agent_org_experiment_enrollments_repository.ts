/**
 * C1 — the pre-run reservation store.
 *
 * `run_episode_id` is UNIQUE, so `reserveAsync` is idempotent: a retried
 * dispatch for the same episode reads back the original reservation instead
 * of minting a second one or flipping the cohort.
 *
 * ponytail: SQLite only for this first slice — Postgres parity is explicit
 * C1 required_behavior and lands with the atomic-exposure-cap change, which
 * needs the same transaction on both engines anyway.
 */

import Database from 'better-sqlite3';

import { getDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import {
  ExperimentEnrollment,
  ExperimentEnrollmentCohort,
  ENROLLMENT_FAILURE_CODES,
  ENROLLMENT_FAILURE_CODE_REASONS,
  ExperimentEnrollmentFailureCode,
  ExperimentEnrollmentState,
  ReserveEnrollmentInput,
} from '../models/agent_org_experiment_enrollment';

const MAX_RESERVATION_RETRIES = 3;
const BUSY_RETRY_DELAY_MS = 10;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export interface EnrollmentFailure {
  failureCode: ExperimentEnrollmentFailureCode;
}

export type EnrollmentTransitionStatus =
  | 'applied'
  | 'no_op'
  | 'missing'
  | 'illegal_transition'
  | 'invalid_failure';

export interface EnrollmentTransitionResult {
  status: EnrollmentTransitionStatus;
  current: ExperimentEnrollment | null;
}

function isRetryableReservationError(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  const message = String(error);
  return (
    code === 'SQLITE_BUSY' ||
    code === 'SQLITE_LOCKED' ||
    /database is (?:busy|locked)/i.test(message) ||
    /SQLITE_(?:BUSY|LOCKED)/i.test(message)
  );
}

function isDuplicateEpisodeError(error: unknown): boolean {
  const message = String(error);
  return /SQLITE_CONSTRAINT/.test(message) && /run_episode_id/.test(message);
}

interface EnrollmentRow {
  id: string;
  run_episode_id: string;
  experiment_id: string;
  proposal_id: string;
  profile_id: string;
  cohort: string;
  assignment_digest: string;
  baseline_target_revision_hash: string;
  treatment_spec_hash: string;
  state: string;
  reserved_at: string;
  failure_code: string | null;
  failure_reason: string | null;
}

function rowToModel(row: EnrollmentRow): ExperimentEnrollment {
  return {
    id: row.id,
    runEpisodeId: row.run_episode_id,
    experimentId: row.experiment_id,
    proposalId: row.proposal_id,
    profileId: row.profile_id,
    cohort: row.cohort as ExperimentEnrollmentCohort,
    assignmentDigest: row.assignment_digest,
    baselineTargetRevisionHash: row.baseline_target_revision_hash,
    treatmentSpecHash: row.treatment_spec_hash,
    state: row.state as ExperimentEnrollmentState,
    reservedAt: row.reserved_at,
    failureCode: (row.failure_code ?? null) as ExperimentEnrollmentFailureCode | null,
    failureReason: row.failure_reason ?? null,
  };
}

function normalizeFailureCode(value: string): ExperimentEnrollmentFailureCode | null {
  return (ENROLLMENT_FAILURE_CODES as readonly string[]).includes(value)
    ? (value as ExperimentEnrollmentFailureCode)
    : null;
}

function makeInMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

export class AgentOrgExperimentEnrollmentsRepository {
  private db: Database.Database;

  private readonly COUNT_ACTIVE =
    `SELECT COUNT(*) as n FROM agent_org_experiment_enrollments WHERE experiment_id = ? AND state IN ('reserved', 'dispatched')`;

  constructor(db?: Database.Database) {
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
   * Reserve a cohort for a run episode before dispatch. Idempotent: an
   * existing reservation for `runEpisodeId` is returned unchanged rather than
   * duplicated or overwritten.
   */
  async reserveAsync(input: ReserveEnrollmentInput): Promise<ExperimentEnrollment | null> {
    if (!Number.isInteger(input.maxExposure) || input.maxExposure <= 0) {
      throw new Error(`agent org experiment enrollment: maxExposure must be a positive integer`);
    }

    for (const [field, value] of Object.entries({
      runEpisodeId: input.runEpisodeId,
      experimentId: input.experimentId,
      proposalId: input.proposalId,
      profileId: input.profileId,
      assignmentDigest: input.assignmentDigest,
      baselineTargetRevisionHash: input.baselineTargetRevisionHash,
      treatmentSpecHash: input.treatmentSpecHash,
    })) {
      if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`agent org experiment enrollment: '${field}' is required to reserve`);
      }
    }
    if (input.cohort !== 'baseline' && input.cohort !== 'candidate') {
      throw new Error(`agent org experiment enrollment: cohort must be 'baseline' or 'candidate'`);
    }

    const row = {
      id: input.id ?? crypto.randomUUID(),
      run_episode_id: input.runEpisodeId,
      experiment_id: input.experimentId,
      proposal_id: input.proposalId,
      profile_id: input.profileId,
      cohort: input.cohort,
      assignment_digest: input.assignmentDigest,
      baseline_target_revision_hash: input.baselineTargetRevisionHash,
      treatment_spec_hash: input.treatmentSpecHash,
      state: 'reserved' as ExperimentEnrollmentState,
      reserved_at: new Date().toISOString(),
    };

    for (let attempt = 1; attempt <= MAX_RESERVATION_RETRIES; attempt += 1) {
      try {
        const reserve = (): ExperimentEnrollment | null => {
          this.db.exec('BEGIN IMMEDIATE');

          const existing = this.db
            .prepare(`SELECT * FROM agent_org_experiment_enrollments WHERE run_episode_id = ?`)
            .get(row.run_episode_id) as EnrollmentRow | undefined;
          if (existing) {
            this.db.exec('COMMIT');
            return rowToModel(existing);
          }

          const active = this.db.prepare(this.COUNT_ACTIVE).get(input.experimentId) as { n: number };
          if (active.n >= input.maxExposure) {
            this.db.exec('COMMIT');
            return null;
          }

          this.db
            .prepare(
              `INSERT INTO agent_org_experiment_enrollments
                 (id, run_episode_id, experiment_id, proposal_id, profile_id, cohort,
                  assignment_digest, baseline_target_revision_hash, treatment_spec_hash, state, reserved_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            )
            .run(
              row.id,
              row.run_episode_id,
              row.experiment_id,
              row.proposal_id,
              row.profile_id,
              row.cohort,
              row.assignment_digest,
              row.baseline_target_revision_hash,
              row.treatment_spec_hash,
              row.state,
              row.reserved_at,
            );

          const stored = this.db
            .prepare(`SELECT * FROM agent_org_experiment_enrollments WHERE run_episode_id = ?`)
            .get(row.run_episode_id) as EnrollmentRow | undefined;
          if (!stored) {
            throw new Error(`agent org experiment enrollment '${row.id}' was not persisted`);
          }

          this.db.exec('COMMIT');
          return rowToModel(stored);
        };

        return reserve();
      } catch (err) {
        if (this.db.inTransaction) {
          this.db.exec('ROLLBACK');
        }

        if (isDuplicateEpisodeError(err)) {
          const winner = await this.findByRunEpisodeIdAsync(input.runEpisodeId);
          if (winner) return winner;
          throw err;
        }

        if (isRetryableReservationError(err) && attempt < MAX_RESERVATION_RETRIES) {
          await delay(BUSY_RETRY_DELAY_MS * attempt);
          continue;
        }

        throw err;
      }
    }

    return null;
  }

  async findByRunEpisodeIdAsync(runEpisodeId: string): Promise<ExperimentEnrollment | null> {
    const row = this.db
      .prepare(`SELECT * FROM agent_org_experiment_enrollments WHERE run_episode_id = ?`)
      .get(runEpisodeId) as EnrollmentRow | undefined;
    return row ? rowToModel(row) : null;
  }

  async listByExperimentAsync(experimentId: string): Promise<ExperimentEnrollment[]> {
    const rows = this.db
      .prepare(`SELECT * FROM agent_org_experiment_enrollments WHERE experiment_id = ?`)
      .all(experimentId) as EnrollmentRow[];
    return rows.map(rowToModel);
  }

  async markDispatchedAsync(runEpisodeId: string): Promise<EnrollmentTransitionResult> {
    const current = await this.findByRunEpisodeIdAsync(runEpisodeId);
    if (!current) {
      return { status: 'missing', current: null };
    }
    if (current.state === 'dispatched') {
      return { status: 'no_op', current };
    }
    if (current.state !== 'reserved') {
      return { status: 'illegal_transition', current };
    }

    const result = this.db
      .prepare(
        `UPDATE agent_org_experiment_enrollments
         SET state = ?, failure_code = NULL, failure_reason = NULL
       WHERE run_episode_id = ? AND state = ?`,
      )
      .run('dispatched', runEpisodeId, 'reserved');

    if (result.changes === 1) {
      const updated = await this.findByRunEpisodeIdAsync(runEpisodeId);
      return { status: 'applied', current: updated };
    }

    const latest = await this.findByRunEpisodeIdAsync(runEpisodeId);
    if (!latest) {
      return { status: 'missing', current: null };
    }
    if (latest.state === 'dispatched') {
      return { status: 'no_op', current: latest };
    }
    return { status: 'illegal_transition', current: latest };
  }

  async markTreatmentFailedAsync(
    runEpisodeId: string,
    failure: EnrollmentFailure,
  ): Promise<EnrollmentTransitionResult> {
    const current = await this.findByRunEpisodeIdAsync(runEpisodeId);
    if (!current) {
      return { status: 'missing', current: null };
    }
    if (current.state === 'treatment_failed') {
      return { status: 'no_op', current };
    }
    if (current.state !== 'reserved') {
      return { status: 'illegal_transition', current };
    }

    const failureCode = normalizeFailureCode(failure.failureCode);
    if (!failureCode) {
      return { status: 'invalid_failure', current };
    }

    const failureReason = ENROLLMENT_FAILURE_CODE_REASONS[failureCode];

    const result = this.db
      .prepare(
        `UPDATE agent_org_experiment_enrollments
         SET state = ?, failure_code = ?, failure_reason = ?
       WHERE run_episode_id = ? AND state = ?`,
      )
      .run('treatment_failed', failureCode, failureReason ?? null, runEpisodeId, 'reserved');

    if (result.changes === 1) {
      const updated = await this.findByRunEpisodeIdAsync(runEpisodeId);
      return { status: 'applied', current: updated };
    }

    const latest = await this.findByRunEpisodeIdAsync(runEpisodeId);
    if (!latest) {
      return { status: 'missing', current: null };
    }
    if (latest.state === 'treatment_failed') {
      return { status: 'no_op', current: latest };
    }
    return { status: 'illegal_transition', current: latest };
  }

  async markTerminalizedAsync(runEpisodeId: string): Promise<EnrollmentTransitionResult> {
    const current = await this.findByRunEpisodeIdAsync(runEpisodeId);
    if (!current) {
      return { status: 'missing', current: null };
    }
    if (current.state === 'terminalized') {
      return { status: 'no_op', current };
    }
    if (current.state !== 'dispatched') {
      return { status: 'illegal_transition', current };
    }

    const result = this.db
      .prepare(
        `UPDATE agent_org_experiment_enrollments
         SET state = ?, failure_code = NULL, failure_reason = NULL
       WHERE run_episode_id = ? AND state = ?`,
      )
      .run('terminalized', runEpisodeId, 'dispatched');

    if (result.changes === 1) {
      const updated = await this.findByRunEpisodeIdAsync(runEpisodeId);
      return { status: 'applied', current: updated };
    }

    const latest = await this.findByRunEpisodeIdAsync(runEpisodeId);
    if (!latest) {
      return { status: 'missing', current: null };
    }
    if (latest.state === 'terminalized') {
      return { status: 'no_op', current: latest };
    }
    return { status: 'illegal_transition', current: latest };
  }
}
