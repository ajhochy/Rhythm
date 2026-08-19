/**
 * C2-B — raw-SQL proof that the treatment-receipt INSERT binding trigger
 * actually FIRES at the DB layer, not merely that the repository happens to
 * copy fields correctly. These tests bypass
 * AgentOrgTreatmentReceiptsRepository entirely and issue INSERT statements
 * directly against `agent_org_experiment_treatment_receipts`, proving:
 *
 *  - a receipt row byte-for-byte bound to an existing DISPATCHED enrollment
 *    inserts cleanly;
 *  - the enrollment must be `dispatched` at insert time — a `reserved`
 *    enrollment (even with every other field correct) is rejected;
 *  - every bound field (enrollment id, run episode, experiment, proposal,
 *    profile, cohort, assignment digest, baseline target revision hash,
 *    treatment spec hash) must match the enrollment row exactly — a raw SQL
 *    mismatch on any one of them is rejected, not merely caught by the
 *    repository;
 *  - a receipt referencing a nonexistent enrollment id is rejected (both by
 *    the FK and by the binding trigger's own lookup);
 *  - the existing target_ref / hash-format closed-domain CHECKs still fire
 *    for raw SQL, independent of any application-level validation.
 */

import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../migrations';

let db: Database.Database;

function hex64(seed: string): string {
  return createHash('sha256').update(seed).digest('hex');
}

function targetRevisionHash(seed: string): string {
  return `sha256:${hex64(seed)}`;
}

interface EnrollmentSeed {
  id: string;
  runEpisodeId: string;
  experimentId: string;
  proposalId: string;
  profileId: string;
  cohort: 'baseline' | 'candidate';
  assignmentDigest: string;
  baselineTargetRevisionHash: string;
  treatmentSpecHash: string;
  state: 'reserved' | 'dispatched';
}

function insertEnrollment(seed: EnrollmentSeed): void {
  db.prepare(
    `INSERT INTO agent_org_experiment_enrollments
       (id, run_episode_id, experiment_id, proposal_id, profile_id, cohort,
        assignment_digest, baseline_target_revision_hash, treatment_spec_hash, state, reserved_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    seed.id,
    seed.runEpisodeId,
    seed.experimentId,
    seed.proposalId,
    seed.profileId,
    seed.cohort,
    seed.assignmentDigest,
    seed.baselineTargetRevisionHash,
    seed.treatmentSpecHash,
    seed.state,
    new Date().toISOString(),
  );
}

function baseSeed(overrides: Partial<EnrollmentSeed> = {}): EnrollmentSeed {
  return {
    id: 'trigger-enrollment-1',
    runEpisodeId: 'trigger-run-episode-1',
    experimentId: 'trigger-experiment-1',
    proposalId: 'trigger-proposal-1',
    profileId: 'trigger-profile-1',
    cohort: 'candidate',
    assignmentDigest: 'trigger-assignment-digest-1',
    baselineTargetRevisionHash: targetRevisionHash('trigger-baseline-1'),
    treatmentSpecHash: hex64('trigger-spec-1'),
    state: 'dispatched',
    ...overrides,
  };
}

/** A receipt row byte-for-byte bound to `seed`, insertable via raw SQL. */
function receiptRowFor(seed: EnrollmentSeed, overrides: Record<string, unknown> = {}) {
  return {
    id: `receipt-for-${seed.id}`,
    schema_version: 1,
    enrollment_id: seed.id,
    run_episode_id: seed.runEpisodeId,
    experiment_id: seed.experimentId,
    proposal_id: seed.proposalId,
    profile_id: seed.profileId,
    cohort: seed.cohort,
    assignment_digest: seed.assignmentDigest,
    adapter: 'system-prompt-v1',
    target_ref: `agent_config:${seed.profileId}`,
    baseline_target_revision_hash: seed.baselineTargetRevisionHash,
    profile_revision: 1,
    treatment_spec_hash: seed.treatmentSpecHash,
    effective_prompt_hash: hex64('trigger-effective-1'),
    finalized_at: new Date().toISOString(),
    ...overrides,
  };
}

function insertReceipt(row: Record<string, unknown>): void {
  const columns = Object.keys(row);
  db.prepare(
    `INSERT INTO agent_org_experiment_treatment_receipts (${columns.join(', ')})
       VALUES (${columns.map(() => '?').join(', ')})`,
  ).run(...columns.map((c) => row[c]));
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
});

describe('agent_org_experiment_treatment_receipts INSERT binding trigger (raw SQL)', () => {
  it('accepts a receipt row that matches its dispatched enrollment byte-for-byte', () => {
    const seed = baseSeed();
    insertEnrollment(seed);

    expect(() => insertReceipt(receiptRowFor(seed))).not.toThrow();
  });

  it('rejects a receipt row when the bound enrollment is still reserved (not dispatched)', () => {
    const seed = baseSeed({
      id: 'trigger-enrollment-not-dispatched',
      runEpisodeId: 'trigger-run-episode-not-dispatched',
      state: 'reserved',
    });
    insertEnrollment(seed);

    expect(() => insertReceipt(receiptRowFor(seed))).toThrow(/does not match its bound dispatched enrollment/);
  });

  it('rejects a receipt referencing a nonexistent enrollment id', () => {
    const seed = baseSeed({ id: 'trigger-enrollment-ghost', runEpisodeId: 'trigger-run-episode-ghost' });
    // Deliberately never insert the enrollment row.
    expect(() =>
      insertReceipt(receiptRowFor(seed, { id: 'receipt-ghost-enrollment' })),
    ).toThrow();
  });

  const mismatchCases: [string, Record<string, unknown>][] = [
    ['run_episode_id', { run_episode_id: 'a-different-run-episode' }],
    ['experiment_id', { experiment_id: 'a-different-experiment' }],
    ['proposal_id', { proposal_id: 'a-different-proposal' }],
    ['profile_id', { profile_id: 'a-different-profile', target_ref: 'agent_config:a-different-profile' }],
    ['cohort', { cohort: 'baseline' }],
    ['assignment_digest', { assignment_digest: 'a-different-digest' }],
    ['baseline_target_revision_hash', { baseline_target_revision_hash: targetRevisionHash('a-different-baseline') }],
    ['treatment_spec_hash', { treatment_spec_hash: hex64('a-different-spec') }],
  ];

  it.each(mismatchCases)(
    'rejects a receipt row whose %s does not match the bound dispatched enrollment',
    (_field, override) => {
      const seed = baseSeed({
        id: `trigger-enrollment-mismatch-${_field}`,
        runEpisodeId: `trigger-run-episode-mismatch-${_field}`,
      });
      insertEnrollment(seed);

      expect(() =>
        insertReceipt(receiptRowFor(seed, { id: `receipt-mismatch-${_field}`, ...override })),
      ).toThrow(/does not match its bound dispatched enrollment/);
    },
  );

  it('still enforces the existing target_ref closed-domain CHECK independent of the binding trigger', () => {
    const seed = baseSeed({ id: 'trigger-enrollment-bad-ref', runEpisodeId: 'trigger-run-episode-bad-ref' });
    insertEnrollment(seed);

    expect(() =>
      insertReceipt(receiptRowFor(seed, { id: 'receipt-bad-ref', target_ref: 'agent_config:someone-else' })),
    ).toThrow();
  });

  it('still enforces the existing hash-format closed-domain CHECKs independent of the binding trigger', () => {
    const seed = baseSeed({ id: 'trigger-enrollment-bad-hash', runEpisodeId: 'trigger-run-episode-bad-hash' });
    insertEnrollment(seed);

    expect(() =>
      insertReceipt(receiptRowFor(seed, { id: 'receipt-bad-hash', effective_prompt_hash: 'not-a-hex-hash' })),
    ).toThrow();
  });

  it('the enrollment_id foreign key rejects a receipt for a deleted/nonexistent enrollment even if the trigger lookup changes', () => {
    const seed = baseSeed({ id: 'trigger-enrollment-fk', runEpisodeId: 'trigger-run-episode-fk' });
    insertEnrollment(seed);
    const row = receiptRowFor(seed, { id: 'receipt-fk-orphan', enrollment_id: 'no-such-enrollment-id' });

    expect(() => insertReceipt(row)).toThrow();
  });
});
