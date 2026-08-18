/**
 * C2-B — the treatment receipt store.
 *
 * `dispatchAndFinalizeReceiptAsync` is the atomic primitive a later phase's
 * dispatch boundary will call: from a RESERVED enrollment, transition it to
 * `dispatched` and insert its immutable receipt in the SAME SQLite
 * transaction. Every binding field (experiment/proposal/profile/cohort/
 * assignment/target/spec) is copied from the enrollment row read fresh
 * INSIDE the transaction — the public API takes only `runEpisodeId` plus the
 * two fields the enrollment row cannot supply (the live profile revision and
 * the effective-prompt hash), so a caller has no parameter through which to
 * relabel the binding.
 *
 * ponytail: SQLite only for this slice, mirroring
 * AgentOrgExperimentEnrollmentsRepository — this primitive is not yet wired
 * into any dispatch boundary.
 */

import Database from 'better-sqlite3';

import { getDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import {
  TreatmentReceipt,
  TreatmentReceiptCohort,
  TREATMENT_RECEIPT_SCHEMA_VERSION,
  buildTargetRef,
  isHex64,
  isTargetRevisionHash,
} from '../models/agent_org_treatment_receipt';
import { ExperimentEnrollment, ExperimentEnrollmentCohort } from '../models/agent_org_experiment_enrollment';

/**
 * C2-C — the full safe material a caller must supply to finalize a receipt.
 * `targetRef`/`targetRevisionHash`/`treatmentSpecHash` are NOT trusted as
 * ground truth on their own: `dispatchAndFinalizeReceiptAsync` re-checks each
 * against the enrollment row read fresh inside the transaction and fails
 * closed (`binding_mismatch`) on any mismatch, so a caller cannot finalize a
 * receipt under stale or foreign safe material. Never the raw prompt.
 */
export interface FinalizeReceiptMaterial {
  profileRevision: number;
  /** Must equal exactly `agent_config:<enrollment.profileId>`. */
  targetRef: string;
  /** Must equal exactly `enrollment.baselineTargetRevisionHash`. */
  targetRevisionHash: string;
  /** Must equal exactly `enrollment.treatmentSpecHash`. */
  treatmentSpecHash: string;
  /** Bare lowercase 64-hex hash of the exact effective system-prompt override — never the prompt bytes. */
  effectivePromptHash: string;
}

export type DispatchReceiptStatus =
  | 'applied'
  | 'idempotent'
  | 'missing'
  | 'illegal_transition'
  | 'mismatched_retry'
  | 'invalid_material'
  | 'binding_mismatch';

export interface DispatchReceiptResult {
  status: DispatchReceiptStatus;
  receipt: TreatmentReceipt | null;
  enrollment: ExperimentEnrollment | null;
}

interface ReceiptRow {
  id: string;
  schema_version: number;
  enrollment_id: string;
  run_episode_id: string;
  experiment_id: string;
  proposal_id: string;
  profile_id: string;
  cohort: string;
  assignment_digest: string;
  adapter: string;
  target_ref: string;
  baseline_target_revision_hash: string;
  profile_revision: number;
  treatment_spec_hash: string;
  effective_prompt_hash: string;
  finalized_at: string;
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

function enrollmentFromRow(row: EnrollmentRow): ExperimentEnrollment {
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
    state: row.state as ExperimentEnrollment['state'],
    reservedAt: row.reserved_at,
    failureCode: (row.failure_code ?? null) as ExperimentEnrollment['failureCode'],
    failureReason: row.failure_reason ?? null,
  };
}

function receiptFromRow(row: ReceiptRow): TreatmentReceipt {
  return {
    schemaVersion: row.schema_version as typeof TREATMENT_RECEIPT_SCHEMA_VERSION,
    id: row.id,
    enrollmentId: row.enrollment_id,
    runEpisodeId: row.run_episode_id,
    experimentId: row.experiment_id,
    proposalId: row.proposal_id,
    profileId: row.profile_id,
    cohort: row.cohort as TreatmentReceiptCohort,
    assignmentDigest: row.assignment_digest,
    adapter: row.adapter as TreatmentReceipt['adapter'],
    targetRef: row.target_ref,
    baselineTargetRevisionHash: row.baseline_target_revision_hash,
    profileRevision: row.profile_revision,
    treatmentSpecHash: row.treatment_spec_hash,
    effectivePromptHash: row.effective_prompt_hash,
    finalizedAt: row.finalized_at,
  };
}

function makeInMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

const CANONICAL_TARGET_REF_RE = /^agent_config:.+$/;

function isValidMaterial(material: FinalizeReceiptMaterial): boolean {
  return (
    Number.isInteger(material.profileRevision) &&
    material.profileRevision >= 0 &&
    typeof material.targetRef === 'string' &&
    CANONICAL_TARGET_REF_RE.test(material.targetRef) &&
    isTargetRevisionHash(material.targetRevisionHash) &&
    isHex64(material.treatmentSpecHash) &&
    isHex64(material.effectivePromptHash)
  );
}

/** Every field that must match byte-for-byte for a retry to be a legal idempotent no-op. */
function receiptsMatch(a: TreatmentReceipt, b: TreatmentReceipt): boolean {
  return (
    a.enrollmentId === b.enrollmentId &&
    a.runEpisodeId === b.runEpisodeId &&
    a.experimentId === b.experimentId &&
    a.proposalId === b.proposalId &&
    a.profileId === b.profileId &&
    a.cohort === b.cohort &&
    a.assignmentDigest === b.assignmentDigest &&
    a.adapter === b.adapter &&
    a.targetRef === b.targetRef &&
    a.baselineTargetRevisionHash === b.baselineTargetRevisionHash &&
    a.profileRevision === b.profileRevision &&
    a.treatmentSpecHash === b.treatmentSpecHash &&
    a.effectivePromptHash === b.effectivePromptHash
  );
}

export class AgentOrgTreatmentReceiptsRepository {
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

  async findByRunEpisodeIdAsync(runEpisodeId: string): Promise<TreatmentReceipt | null> {
    const row = this.db
      .prepare(`SELECT * FROM agent_org_experiment_treatment_receipts WHERE run_episode_id = ?`)
      .get(runEpisodeId) as ReceiptRow | undefined;
    return row ? receiptFromRow(row) : null;
  }

  async findByEnrollmentIdAsync(enrollmentId: string): Promise<TreatmentReceipt | null> {
    const row = this.db
      .prepare(`SELECT * FROM agent_org_experiment_treatment_receipts WHERE enrollment_id = ?`)
      .get(enrollmentId) as ReceiptRow | undefined;
    return row ? receiptFromRow(row) : null;
  }

  /**
   * From a RESERVED enrollment: transition reserved -> dispatched and insert
   * its immutable receipt in one SQLite transaction. Rolls back to the
   * original reserved state (and no receipt) on any failure.
   */
  async dispatchAndFinalizeReceiptAsync(
    runEpisodeId: string,
    material: FinalizeReceiptMaterial,
  ): Promise<DispatchReceiptResult> {
    if (!isValidMaterial(material)) {
      return { status: 'invalid_material', receipt: null, enrollment: null };
    }

    this.db.exec('BEGIN IMMEDIATE');
    try {
      const enrollmentRow = this.db
        .prepare(`SELECT * FROM agent_org_experiment_enrollments WHERE run_episode_id = ?`)
        .get(runEpisodeId) as EnrollmentRow | undefined;
      if (!enrollmentRow) {
        this.db.exec('COMMIT');
        return { status: 'missing', receipt: null, enrollment: null };
      }
      const enrollment = enrollmentFromRow(enrollmentRow);

      // C2-C — fail closed unless the caller's claimed safe material is
      // EXACTLY the enrollment's own binding, re-read fresh inside this
      // transaction. A caller cannot finalize a receipt under stale/foreign
      // material (e.g. a different profile's target, an old target
      // revision, or a superseded treatment spec) even if `isValidMaterial`
      // accepts its shape. No write has occurred yet at this point.
      const expectedTargetRef = buildTargetRef(enrollment.profileId);
      if (
        material.targetRef !== expectedTargetRef ||
        material.targetRevisionHash !== enrollment.baselineTargetRevisionHash ||
        material.treatmentSpecHash !== enrollment.treatmentSpecHash
      ) {
        this.db.exec('COMMIT');
        return { status: 'binding_mismatch', receipt: null, enrollment };
      }

      const candidate: TreatmentReceipt = {
        schemaVersion: TREATMENT_RECEIPT_SCHEMA_VERSION,
        id: crypto.randomUUID(),
        enrollmentId: enrollment.id,
        runEpisodeId: enrollment.runEpisodeId,
        experimentId: enrollment.experimentId,
        proposalId: enrollment.proposalId,
        profileId: enrollment.profileId,
        cohort: enrollment.cohort,
        assignmentDigest: enrollment.assignmentDigest,
        adapter: 'system-prompt-v1',
        targetRef: buildTargetRef(enrollment.profileId),
        baselineTargetRevisionHash: enrollment.baselineTargetRevisionHash,
        profileRevision: material.profileRevision,
        treatmentSpecHash: enrollment.treatmentSpecHash,
        effectivePromptHash: material.effectivePromptHash,
        finalizedAt: new Date().toISOString(),
      };

      const existingRow = this.db
        .prepare(`SELECT * FROM agent_org_experiment_treatment_receipts WHERE enrollment_id = ?`)
        .get(enrollment.id) as ReceiptRow | undefined;

      if (existingRow) {
        const existing = receiptFromRow(existingRow);
        this.db.exec('COMMIT');
        if (receiptsMatch(existing, candidate)) {
          return { status: 'idempotent', receipt: existing, enrollment };
        }
        return { status: 'mismatched_retry', receipt: existing, enrollment };
      }

      if (enrollment.state !== 'reserved') {
        this.db.exec('COMMIT');
        return { status: 'illegal_transition', receipt: null, enrollment };
      }

      // Transition reserved -> dispatched FIRST, in the SAME transaction: the
      // receipts table's own INSERT-time binding trigger requires the bound
      // enrollment to already be `dispatched`, so the INSERT below must never
      // run against a still-`reserved` row. Any failure from here on
      // (including the trigger itself rejecting a corrupted binding) throws
      // and rolls back this UPDATE too, leaving the enrollment reserved and
      // no receipt row.
      const dispatchResult = this.db
        .prepare(
          `UPDATE agent_org_experiment_enrollments
             SET state = 'dispatched', failure_code = NULL, failure_reason = NULL
           WHERE run_episode_id = ? AND state = 'reserved'`,
        )
        .run(runEpisodeId);
      if (dispatchResult.changes !== 1) {
        throw new Error(`agent org treatment receipt: enrollment '${runEpisodeId}' was not reserved at commit time`);
      }

      this.db
        .prepare(
          `INSERT INTO agent_org_experiment_treatment_receipts
             (id, schema_version, enrollment_id, run_episode_id, experiment_id, proposal_id, profile_id, cohort,
              assignment_digest, adapter, target_ref, baseline_target_revision_hash, profile_revision,
              treatment_spec_hash, effective_prompt_hash, finalized_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          candidate.id,
          candidate.schemaVersion,
          candidate.enrollmentId,
          candidate.runEpisodeId,
          candidate.experimentId,
          candidate.proposalId,
          candidate.profileId,
          candidate.cohort,
          candidate.assignmentDigest,
          candidate.adapter,
          candidate.targetRef,
          candidate.baselineTargetRevisionHash,
          candidate.profileRevision,
          candidate.treatmentSpecHash,
          candidate.effectivePromptHash,
          candidate.finalizedAt,
        );

      const updatedEnrollmentRow = this.db
        .prepare(`SELECT * FROM agent_org_experiment_enrollments WHERE run_episode_id = ?`)
        .get(runEpisodeId) as EnrollmentRow;

      this.db.exec('COMMIT');
      return { status: 'applied', receipt: candidate, enrollment: enrollmentFromRow(updatedEnrollmentRow) };
    } catch (err) {
      if (this.db.inTransaction) {
        this.db.exec('ROLLBACK');
      }
      throw err;
    }
  }
}
