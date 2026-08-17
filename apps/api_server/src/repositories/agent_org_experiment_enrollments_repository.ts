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
import type {
  ExperimentEnrollment,
  ExperimentEnrollmentCohort,
  ExperimentEnrollmentState,
  ReserveEnrollmentInput,
} from '../models/agent_org_experiment_enrollment';

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
  };
}

function makeInMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

export class AgentOrgExperimentEnrollmentsRepository {
  private db: Database.Database;

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
  async reserveAsync(input: ReserveEnrollmentInput): Promise<ExperimentEnrollment> {
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

    const existing = await this.findByRunEpisodeIdAsync(input.runEpisodeId);
    if (existing) return existing;

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

    try {
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
    } catch (err) {
      // A concurrent reserver for the same episode lost the race to the
      // UNIQUE constraint — read back the winner instead of failing.
      if (/unique/i.test(String(err))) {
        const winner = await this.findByRunEpisodeIdAsync(input.runEpisodeId);
        if (winner) return winner;
      }
      throw err;
    }

    const stored = await this.findByRunEpisodeIdAsync(input.runEpisodeId);
    if (!stored) throw new Error(`agent org experiment enrollment '${row.id}' was not persisted`);
    return stored;
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
}
