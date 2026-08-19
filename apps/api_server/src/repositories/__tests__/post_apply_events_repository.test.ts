/**
 * D2.1 (#1431) — the post-apply monitor/repair/revert lifecycle repository.
 *
 * Covers: one event per applied proposal (idempotent create), find by
 * proposal id, status/repair/revert/alert updates, the 3-attempt repair cap,
 * and the no-raw-secret-persisted guarantee (redaction happens INSIDE the
 * repository, not left to callers to remember).
 */
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../database/migrations';
import { AgentOrgProposalsRepository } from '../agent_org_proposals_repository';
import { PostApplyEventsRepository } from '../post_apply_events_repository';

let db: Database.Database;
let proposalsRepo: AgentOrgProposalsRepository;
let repo: PostApplyEventsRepository;

async function createAppliedProposal(id: string) {
  return proposalsRepo.createAsync({
    id,
    kind: 'refine-config',
    risk: 'high',
    title: `test proposal ${id}`,
    status: 'applied',
  });
}

beforeEach(async () => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  proposalsRepo = new AgentOrgProposalsRepository(db);
  repo = new PostApplyEventsRepository(db);
  await createAppliedProposal('proposal-1');
});

describe('D2.1 PostApplyEventsRepository', () => {
  it('creates one event carrying every required field with monitoring defaults', async () => {
    const created = await repo.createAsync({
      proposalId: 'proposal-1',
      profileId: 'profile-1',
      changeType: 'prompt',
      preChangeSnapshotJson: JSON.stringify({ profileId: 'profile-1', revisionBefore: 4 }),
      monitoringWindowStart: '2026-08-18T00:00:00.000Z',
      monitoringWindowEnd: '2026-08-18T01:00:00.000Z',
    });

    expect(created.proposalId).toBe('proposal-1');
    expect(created.profileId).toBe('profile-1');
    expect(created.changeType).toBe('prompt');
    expect(created.guardrailStatus).toBe('monitoring');
    expect(created.revertStatus).toBe('none');
    expect(created.repairProposalIdsJson).toBe('[]');
    expect(created.alertPayloadJson).toBeNull();
    expect(created.id).toBeTruthy();
    expect(created.createdAt).toBeTruthy();
    expect(created.updatedAt).toBeTruthy();
  });

  it('is idempotent per proposal id — one event per applied proposal', async () => {
    const first = await repo.createAsync({
      proposalId: 'proposal-1',
      profileId: 'profile-1',
      changeType: 'prompt',
      preChangeSnapshotJson: '{}',
      monitoringWindowStart: '2026-08-18T00:00:00.000Z',
      monitoringWindowEnd: '2026-08-18T01:00:00.000Z',
    });
    // Regression this catches: a second apply-triggered create for the same
    // proposal minting a SECOND row (breaking "one event per applied
    // proposal" and orphaning whichever the monitor reads next).
    const second = await repo.createAsync({
      proposalId: 'proposal-1',
      profileId: 'profile-1',
      changeType: 'tool',
      preChangeSnapshotJson: '{"different":true}',
      monitoringWindowStart: '2026-08-18T00:00:00.000Z',
      monitoringWindowEnd: '2026-08-18T02:00:00.000Z',
    });
    expect(second.id).toBe(first.id);
    expect(second.changeType).toBe('prompt');

    const count = db
      .prepare(`SELECT COUNT(*) as n FROM agent_org_post_apply_events WHERE proposal_id = ?`)
      .get('proposal-1') as { n: number };
    expect(count.n).toBe(1);
  });

  it('findByProposalIdAsync returns null for a proposal with no event', async () => {
    expect(await repo.findByProposalIdAsync('no-such-proposal')).toBeNull();
  });

  it('updateStatusAsync transitions guardrailStatus and revertStatus', async () => {
    await repo.createAsync({
      proposalId: 'proposal-1',
      profileId: 'profile-1',
      changeType: 'scope',
      preChangeSnapshotJson: '{}',
      monitoringWindowStart: '2026-08-18T00:00:00.000Z',
      monitoringWindowEnd: '2026-08-18T01:00:00.000Z',
    });

    const tripped = await repo.updateStatusAsync('proposal-1', { guardrailStatus: 'tripped' });
    expect(tripped?.guardrailStatus).toBe('tripped');

    const reverted = await repo.updateStatusAsync('proposal-1', { revertStatus: 'reverted' });
    expect(reverted?.revertStatus).toBe('reverted');
    // A revert-status update must not clobber the already-tripped guardrail status.
    expect(reverted?.guardrailStatus).toBe('tripped');
  });

  it('updateStatusAsync returns null for a proposal with no event', async () => {
    expect(await repo.updateStatusAsync('no-such-proposal', { guardrailStatus: 'clear' })).toBeNull();
  });

  it('caps repairProposalIds at MAX_REPAIR_ATTEMPTS (3)', async () => {
    await repo.createAsync({
      proposalId: 'proposal-1',
      profileId: 'profile-1',
      changeType: 'prompt',
      preChangeSnapshotJson: '{}',
      monitoringWindowStart: '2026-08-18T00:00:00.000Z',
      monitoringWindowEnd: '2026-08-18T01:00:00.000Z',
    });

    // Regression this catches: a caller (or a bug in the 3-strike loop)
    // recording a 4th repair attempt silently past the documented ceiling.
    const updated = await repo.updateStatusAsync('proposal-1', {
      repairProposalIdsJson: JSON.stringify(['repair-1', 'repair-2', 'repair-3', 'repair-4']),
    });
    const ids = JSON.parse(updated!.repairProposalIdsJson) as string[];
    expect(ids.length).toBe(3);
    expect(ids).toEqual(['repair-1', 'repair-2', 'repair-3']);
  });

  it('redacts secret-shaped text out of preChangeSnapshotJson and alertPayloadJson before persisting', async () => {
    const secretSnapshot = JSON.stringify({
      note: 'token Bearer sk-abcdefghijklmnopqrstuvwx should never reach disk',
    });
    const created = await repo.createAsync({
      proposalId: 'proposal-1',
      profileId: 'profile-1',
      changeType: 'prompt',
      preChangeSnapshotJson: secretSnapshot,
      monitoringWindowStart: '2026-08-18T00:00:00.000Z',
      monitoringWindowEnd: '2026-08-18T01:00:00.000Z',
    });
    // Regression this catches: a raw bearer-token/secret shape persisted
    // verbatim in the new lifecycle table because the repository trusted
    // the caller instead of redacting at the write boundary itself.
    expect(created.preChangeSnapshotJson).not.toContain('sk-abcdefghijklmnopqrstuvwx');
    expect(created.preChangeSnapshotJson).toContain('[redacted]');

    const withAlert = await repo.updateStatusAsync('proposal-1', {
      alertPayloadJson: JSON.stringify({ detail: 'Bearer ghp_0123456789abcdef0123 leaked in log' }),
    });
    expect(withAlert?.alertPayloadJson).not.toContain('ghp_0123456789abcdef0123');
    expect(withAlert?.alertPayloadJson).toContain('[redacted]');
  });

  it('rejects an unknown changeType at the database layer (closed CHECK constraint)', () => {
    expect(() => {
      db.prepare(
        `INSERT INTO agent_org_post_apply_events
           (id, proposal_id, profile_id, change_type, pre_change_snapshot_json,
            monitoring_window_start, monitoring_window_end, guardrail_status,
            repair_proposal_ids_json, revert_status, alert_payload_json, created_at, updated_at)
         VALUES ('evt-x','proposal-1','profile-1','not-a-real-type','{}','2026-08-18T00:00:00.000Z',
                 '2026-08-18T01:00:00.000Z','monitoring','[]','none',NULL,
                 '2026-08-18T00:00:00.000Z','2026-08-18T00:00:00.000Z')`,
      ).run();
    }).toThrow();
  });
});
