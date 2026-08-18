/**
 * C2-B — the treatment receipt repository.
 *
 * Covers: the atomic reserved -> dispatched + receipt-finalize primitive
 * (rollback on failure, idempotent identical retry, fail-closed mismatched
 * retry), exact binding to the enrollment row (caller input cannot relabel
 * it), immutability, and the no-raw-prompt-bytes guarantee.
 */

import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { AgentOrgExperimentEnrollmentsRepository } from '../agent_org_experiment_enrollments_repository';
import { AgentOrgTreatmentReceiptsRepository } from '../agent_org_treatment_receipts_repository';
import type { ReserveEnrollmentInput } from '../../models/agent_org_experiment_enrollment';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
});

const RAW_BASELINE_PROMPT = 'You are the baseline receipt-repo assistant, never persisted raw.';
const RAW_CANDIDATE_PROMPT = 'You are the candidate receipt-repo assistant, never persisted raw.';

function hex64(seed: string): string {
  return createHash('sha256').update(seed).digest('hex');
}

function targetRevisionHash(seed: string): string {
  return `sha256:${hex64(seed)}`;
}

async function reserve(overrides: Partial<ReserveEnrollmentInput> = {}) {
  const repo = new AgentOrgExperimentEnrollmentsRepository(db);
  return repo.reserveAsync({
    maxExposure: 100,
    runEpisodeId: 'run-episode-1',
    experimentId: 'experiment-1',
    proposalId: 'proposal-1',
    profileId: 'profile-1',
    cohort: 'candidate',
    assignmentDigest: 'assignment-digest-1',
    baselineTargetRevisionHash: targetRevisionHash('baseline-1'),
    treatmentSpecHash: hex64('spec-1'),
    ...overrides,
  });
}

describe('AgentOrgTreatmentReceiptsRepository.dispatchAndFinalizeReceiptAsync', () => {
  it('atomically transitions reserved -> dispatched and finalizes the receipt', async () => {
    const enrollment = await reserve();
    expect(enrollment).not.toBeNull();

    const receipts = new AgentOrgTreatmentReceiptsRepository(db);
    const result = await receipts.dispatchAndFinalizeReceiptAsync(enrollment!.runEpisodeId, {
      profileRevision: 3,
      effectivePromptHash: hex64(RAW_CANDIDATE_PROMPT),
    });

    expect(result.status).toBe('applied');
    expect(result.enrollment?.state).toBe('dispatched');
    expect(result.receipt).not.toBeNull();
    expect(result.receipt).toMatchObject({
      enrollmentId: enrollment!.id,
      runEpisodeId: enrollment!.runEpisodeId,
      experimentId: enrollment!.experimentId,
      proposalId: enrollment!.proposalId,
      profileId: enrollment!.profileId,
      cohort: enrollment!.cohort,
      assignmentDigest: enrollment!.assignmentDigest,
      adapter: 'system-prompt-v1',
      targetRef: `agent_config:${enrollment!.profileId}`,
      baselineTargetRevisionHash: enrollment!.baselineTargetRevisionHash,
      profileRevision: 3,
      treatmentSpecHash: enrollment!.treatmentSpecHash,
      effectivePromptHash: hex64(RAW_CANDIDATE_PROMPT),
    });

    const stored = db
      .prepare(`SELECT state FROM agent_org_experiment_enrollments WHERE run_episode_id = ?`)
      .get(enrollment!.runEpisodeId) as { state: string };
    expect(stored.state).toBe('dispatched');
  });

  it('returns missing when no enrollment exists for the run episode', async () => {
    const receipts = new AgentOrgTreatmentReceiptsRepository(db);
    const result = await receipts.dispatchAndFinalizeReceiptAsync('no-such-episode', {
      profileRevision: 1,
      effectivePromptHash: hex64('x'),
    });
    expect(result.status).toBe('missing');
    expect(result.receipt).toBeNull();
  });

  it('rejects invalid material and leaves the enrollment reserved with no receipt (rollback)', async () => {
    const enrollment = await reserve({ runEpisodeId: 'run-episode-invalid-material' });

    const receipts = new AgentOrgTreatmentReceiptsRepository(db);
    const result = await receipts.dispatchAndFinalizeReceiptAsync(enrollment!.runEpisodeId, {
      profileRevision: -1,
      effectivePromptHash: 'not-a-hex-hash',
    });

    expect(result.status).toBe('invalid_material');
    expect(result.receipt).toBeNull();

    const stored = db
      .prepare(`SELECT state FROM agent_org_experiment_enrollments WHERE run_episode_id = ?`)
      .get(enrollment!.runEpisodeId) as { state: string };
    expect(stored.state).toBe('reserved');

    const count = (
      db.prepare(`SELECT COUNT(*) AS n FROM agent_org_experiment_treatment_receipts`).get() as {
        n: number;
      }
    ).n;
    expect(count).toBe(0);
  });

  it('refuses to finalize a receipt for an already-dispatched enrollment with no matching receipt (illegal transition)', async () => {
    const enrollment = await reserve({ runEpisodeId: 'run-episode-already-dispatched' });
    await new AgentOrgExperimentEnrollmentsRepository(db).markDispatchedAsync(enrollment!.runEpisodeId);

    const receipts = new AgentOrgTreatmentReceiptsRepository(db);
    const result = await receipts.dispatchAndFinalizeReceiptAsync(enrollment!.runEpisodeId, {
      profileRevision: 1,
      effectivePromptHash: hex64('late'),
    });

    expect(result.status).toBe('illegal_transition');
    expect(result.receipt).toBeNull();

    const count = (
      db.prepare(`SELECT COUNT(*) AS n FROM agent_org_experiment_treatment_receipts`).get() as {
        n: number;
      }
    ).n;
    expect(count).toBe(0);
  });

  it('an identical retry after success is idempotent and returns the exact existing receipt', async () => {
    const enrollment = await reserve({ runEpisodeId: 'run-episode-idempotent' });
    const receipts = new AgentOrgTreatmentReceiptsRepository(db);
    const material = { profileRevision: 2, effectivePromptHash: hex64(RAW_BASELINE_PROMPT) };

    const first = await receipts.dispatchAndFinalizeReceiptAsync(enrollment!.runEpisodeId, material);
    expect(first.status).toBe('applied');

    const second = await receipts.dispatchAndFinalizeReceiptAsync(enrollment!.runEpisodeId, material);
    expect(second.status).toBe('idempotent');
    expect(second.receipt).toEqual(first.receipt);

    const count = (
      db.prepare(`SELECT COUNT(*) AS n FROM agent_org_experiment_treatment_receipts`).get() as {
        n: number;
      }
    ).n;
    expect(count).toBe(1);
  });

  it('a mismatched retry (different effective hash) is fail-closed rejected without mutating the existing receipt', async () => {
    const enrollment = await reserve({ runEpisodeId: 'run-episode-mismatch' });
    const receipts = new AgentOrgTreatmentReceiptsRepository(db);
    const first = await receipts.dispatchAndFinalizeReceiptAsync(enrollment!.runEpisodeId, {
      profileRevision: 1,
      effectivePromptHash: hex64(RAW_BASELINE_PROMPT),
    });
    expect(first.status).toBe('applied');

    const mismatched = await receipts.dispatchAndFinalizeReceiptAsync(enrollment!.runEpisodeId, {
      profileRevision: 1,
      effectivePromptHash: hex64(RAW_CANDIDATE_PROMPT),
    });
    expect(mismatched.status).toBe('mismatched_retry');
    expect(mismatched.receipt).toEqual(first.receipt);

    const count = (
      db.prepare(`SELECT COUNT(*) AS n FROM agent_org_experiment_treatment_receipts`).get() as {
        n: number;
      }
    ).n;
    expect(count).toBe(1);
  });

  it('a mismatched retry (different profileRevision, same effective hash) is fail-closed rejected without mutation', async () => {
    const enrollment = await reserve({ runEpisodeId: 'run-episode-mismatch-revision' });
    const receipts = new AgentOrgTreatmentReceiptsRepository(db);
    const first = await receipts.dispatchAndFinalizeReceiptAsync(enrollment!.runEpisodeId, {
      profileRevision: 1,
      effectivePromptHash: hex64(RAW_BASELINE_PROMPT),
    });
    expect(first.status).toBe('applied');

    const mismatched = await receipts.dispatchAndFinalizeReceiptAsync(enrollment!.runEpisodeId, {
      profileRevision: 2,
      effectivePromptHash: hex64(RAW_BASELINE_PROMPT),
    });
    expect(mismatched.status).toBe('mismatched_retry');
    expect(mismatched.receipt).toEqual(first.receipt);

    const count = (
      db.prepare(`SELECT COUNT(*) AS n FROM agent_org_experiment_treatment_receipts`).get() as {
        n: number;
      }
    ).n;
    expect(count).toBe(1);
  });

  it('persists schema_version durably in the receipts table row — not merely returned in memory', async () => {
    const enrollment = await reserve({ runEpisodeId: 'run-episode-schema-version' });
    const receipts = new AgentOrgTreatmentReceiptsRepository(db);
    const result = await receipts.dispatchAndFinalizeReceiptAsync(enrollment!.runEpisodeId, {
      profileRevision: 1,
      effectivePromptHash: hex64('schema-version-check'),
    });
    expect(result.status).toBe('applied');
    expect(result.receipt?.schemaVersion).toBe(1);

    const row = db
      .prepare(`SELECT schema_version FROM agent_org_experiment_treatment_receipts WHERE run_episode_id = ?`)
      .get(enrollment!.runEpisodeId) as { schema_version: number };
    expect(row.schema_version).toBe(1);
  });

  it('rejects a schema_version outside the closed domain at the DB layer', async () => {
    const enrollment = await reserve({ runEpisodeId: 'run-episode-schema-version-domain' });
    await new AgentOrgExperimentEnrollmentsRepository(db).markDispatchedAsync(enrollment!.runEpisodeId);

    expect(() =>
      db
        .prepare(
          `INSERT INTO agent_org_experiment_treatment_receipts
             (id, schema_version, enrollment_id, run_episode_id, experiment_id, proposal_id, profile_id, cohort,
              assignment_digest, adapter, target_ref, baseline_target_revision_hash, profile_revision,
              treatment_spec_hash, effective_prompt_hash, finalized_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          'raw-bad-schema-version',
          2,
          enrollment!.id,
          enrollment!.runEpisodeId,
          enrollment!.experimentId,
          enrollment!.proposalId,
          enrollment!.profileId,
          enrollment!.cohort,
          enrollment!.assignmentDigest,
          'system-prompt-v1',
          `agent_config:${enrollment!.profileId}`,
          enrollment!.baselineTargetRevisionHash,
          1,
          enrollment!.treatmentSpecHash,
          hex64('bad-schema-version'),
          new Date().toISOString(),
        ),
    ).toThrow();
  });

  it('rolls back the reserved -> dispatched transition when the receipt INSERT fails AFTER the update (not merely early invalid-material validation)', async () => {
    const enrollment = await reserve({ runEpisodeId: 'run-episode-post-update-rollback' });

    // Corrupt the enrollment's own treatment_spec_hash directly via raw SQL —
    // the enrollments table has no format CHECK on this column, so this
    // succeeds and is invisible to `isValidMaterial` (which only validates
    // the caller-supplied `material`, never the enrollment row). The
    // reserved -> dispatched UPDATE therefore succeeds first; the INSERT that
    // copies this corrupted hash into the receipts row then fails the
    // receipts table's own hex64 CHECK — a DB-layer failure AFTER the update,
    // inside the same transaction.
    db.prepare(`UPDATE agent_org_experiment_enrollments SET treatment_spec_hash = ? WHERE run_episode_id = ?`).run(
      'not-a-valid-hex64-hash',
      enrollment!.runEpisodeId,
    );

    const receipts = new AgentOrgTreatmentReceiptsRepository(db);
    await expect(
      receipts.dispatchAndFinalizeReceiptAsync(enrollment!.runEpisodeId, {
        profileRevision: 1,
        effectivePromptHash: hex64('post-update-rollback'),
      }),
    ).rejects.toThrow();

    const stored = db
      .prepare(`SELECT state FROM agent_org_experiment_enrollments WHERE run_episode_id = ?`)
      .get(enrollment!.runEpisodeId) as { state: string };
    expect(stored.state).toBe('reserved');

    const count = (
      db.prepare(`SELECT COUNT(*) AS n FROM agent_org_experiment_treatment_receipts`).get() as {
        n: number;
      }
    ).n;
    expect(count).toBe(0);
  });

  it('copies binding fields from the enrollment row — caller cannot relabel experiment/proposal/profile/cohort', async () => {
    const enrollment = await reserve({
      runEpisodeId: 'run-episode-no-relabel',
      experimentId: 'real-experiment',
      proposalId: 'real-proposal',
      profileId: 'real-profile',
    });

    const receipts = new AgentOrgTreatmentReceiptsRepository(db);
    // The public API only accepts (runEpisodeId, material) — there is no
    // parameter through which a caller could pass a different
    // experimentId/proposalId/profileId/cohort/assignmentDigest, so this test
    // pins that surface rather than attempting to smuggle one through.
    const result = await receipts.dispatchAndFinalizeReceiptAsync(enrollment!.runEpisodeId, {
      profileRevision: 5,
      effectivePromptHash: hex64('no-relabel'),
    });

    expect(result.receipt?.experimentId).toBe('real-experiment');
    expect(result.receipt?.proposalId).toBe('real-proposal');
    expect(result.receipt?.profileId).toBe('real-profile');
  });

  it('never stores raw baseline/candidate prompt bytes anywhere in the receipt row', async () => {
    const enrollment = await reserve({ runEpisodeId: 'run-episode-no-raw-bytes' });
    const receipts = new AgentOrgTreatmentReceiptsRepository(db);
    await receipts.dispatchAndFinalizeReceiptAsync(enrollment!.runEpisodeId, {
      profileRevision: 1,
      effectivePromptHash: hex64(RAW_CANDIDATE_PROMPT),
    });

    const row = db
      .prepare(`SELECT * FROM agent_org_experiment_treatment_receipts WHERE run_episode_id = ?`)
      .get(enrollment!.runEpisodeId) as Record<string, unknown>;
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(RAW_BASELINE_PROMPT);
    expect(serialized).not.toContain(RAW_CANDIDATE_PROMPT);
  });

  it('is immutable once finalized — UPDATE and DELETE are both rejected', async () => {
    const enrollment = await reserve({ runEpisodeId: 'run-episode-immutable' });
    const receipts = new AgentOrgTreatmentReceiptsRepository(db);
    await receipts.dispatchAndFinalizeReceiptAsync(enrollment!.runEpisodeId, {
      profileRevision: 1,
      effectivePromptHash: hex64('immutable'),
    });

    expect(() =>
      db
        .prepare(`UPDATE agent_org_experiment_treatment_receipts SET profile_revision = 99 WHERE run_episode_id = ?`)
        .run(enrollment!.runEpisodeId),
    ).toThrow(/immutable/);
    expect(() =>
      db
        .prepare(`DELETE FROM agent_org_experiment_treatment_receipts WHERE run_episode_id = ?`)
        .run(enrollment!.runEpisodeId),
    ).toThrow(/immutable/);
  });

  it('findByRunEpisodeIdAsync and findByEnrollmentIdAsync read back the finalized receipt', async () => {
    const enrollment = await reserve({ runEpisodeId: 'run-episode-find' });
    const receipts = new AgentOrgTreatmentReceiptsRepository(db);
    const applied = await receipts.dispatchAndFinalizeReceiptAsync(enrollment!.runEpisodeId, {
      profileRevision: 1,
      effectivePromptHash: hex64('find-me'),
    });

    expect(await receipts.findByRunEpisodeIdAsync(enrollment!.runEpisodeId)).toEqual(applied.receipt);
    expect(await receipts.findByEnrollmentIdAsync(enrollment!.id)).toEqual(applied.receipt);
    expect(await receipts.findByRunEpisodeIdAsync('nope')).toBeNull();
  });
});
