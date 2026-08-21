/**
 * D4.6 (#1444) — D2 post-apply regression feedback contract.
 *
 * Catches the regression where an auto-revert was terminal in the D2 event
 * ledger but never reached D4's durable trust state, allowing a later sweep
 * to retain or re-enable auto-promotion.
 */
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';
import { AgentOrgExperimentsRepository } from '../../repositories/agent_org_experiments_repository';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
import { NotificationsRepository } from '../../repositories/notifications_repository';
import { PostApplyEventsRepository } from '../../repositories/post_apply_events_repository';
import { PromotionTrustStateRepository } from '../../repositories/promotion_trust_state_repository';
import { UsersRepository } from '../../repositories/users_repository';
import { runAutoRevertAsync } from '../auto_revert_service';
import { computeTrustCountersAsync, recordTrustCountersAsync } from '../trust_counter_service';
import { logger } from '../../utils/logger';
import { NotificationService } from '../notification_service';

let db: Database.Database;
let configs: AgentConfigsRepository;
let proposals: AgentOrgProposalsRepository;
let events: PostApplyEventsRepository;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  configs = new AgentConfigsRepository();
  proposals = new AgentOrgProposalsRepository(db);
  events = new PostApplyEventsRepository(db);
});

async function seedSuccessfulAutoRevert(): Promise<{ proposalId: string; recipientUserId: number }> {
  const recipient = new UsersRepository().create({
    name: 'Regression owner',
    email: `regression-${crypto.randomUUID()}@example.test`,
  });
  configs.insert({
    id: 'profile-regression',
    label: 'Regression profile',
    icon: 'x',
    modelProvider: 'anthropic',
    modelId: 'claude-opus',
  });
  const proposal = await proposals.createAsync({
    id: `proposal-${crypto.randomUUID()}`,
    kind: 'refine-config',
    risk: 'low',
    status: 'measuring',
    title: 'Regression fixture',
    ownerUserId: recipient.id,
    changeJson: JSON.stringify({
      configPatch: {
        agentConfigId: 'profile-regression',
        field: 'model',
        value: 'anthropic/claude-opus',
      },
    }),
    beforeSnapshotJson: JSON.stringify({
      agentConfigId: 'profile-regression',
      field: 'model',
      priorValue: 'anthropic/claude-haiku',
      expectedAppliedValue: 'anthropic/claude-opus',
    }),
  });
  await events.createAsync({
    proposalId: proposal.id,
    profileId: 'profile-regression',
    changeType: 'prompt',
    preChangeSnapshotJson: '{}',
    monitoringWindowStart: '2026-08-21T00:00:00.000Z',
    monitoringWindowEnd: '2026-08-21T01:00:00.000Z',
  });
  await events.updateStatusAsync(proposal.id, { guardrailStatus: 'tripped' });
  return { proposalId: proposal.id, recipientUserId: recipient.id };
}

function regressionNotificationCount(recipientUserId: number, proposalId: string): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM notifications
          WHERE recipient_user_id = ?
            AND type = 'auto_promotion_disabled_regression'
            AND entity_type = 'agent_org_proposal'
            AND entity_id = ?`,
      )
      .get(recipientUserId, proposalId) as { count: number }
  ).count;
}

describe('D4.6 (#1444) post-apply regression feedback', () => {
  it('issue-1444-c1: successful auto-revert disables the enabled promotion gate', async () => {
    const trust = new PromotionTrustStateRepository();
    await trust.updateAsync({
      autoPromotionEnabled: true,
      enabledAt: '2026-08-21T00:00:00.000Z',
    });
    const { proposalId } = await seedSuccessfulAutoRevert();
    const event = await events.findByProposalIdAsync(proposalId);

    const result = await runAutoRevertAsync(event!);

    expect(result.outcome).toBe('reverted');
    const state = await trust.getSingletonAsync();
    expect(state.totalRegressions).toBe(1);
    expect(state.autoPromotionEligible).toBe(false);
    expect(state.autoPromotionEnabled).toBe(false);
    expect(state.enabledAt).toBeNull();
  });

  it('issue-1444-c2: successful auto-revert contributes exactly one durable regression across repeated retries', async () => {
    const { proposalId } = await seedSuccessfulAutoRevert();
    const event = await events.findByProposalIdAsync(proposalId);

    const first = await runAutoRevertAsync(event!);
    const second = await runAutoRevertAsync(first.event);
    const counters = await computeTrustCountersAsync();

    expect(first.outcome).toBe('reverted');
    expect(second.outcome).toBe('not-tripped');
    expect(counters.totalRegressions).toBe(1);
  });

  it('issue-1444-c3: successful auto-revert writes one sanitized user-visible notification', async () => {
    const { proposalId, recipientUserId } = await seedSuccessfulAutoRevert();
    const event = await events.findByProposalIdAsync(proposalId);

    const first = await runAutoRevertAsync(event!);
    await runAutoRevertAsync(first.event);

    expect(regressionNotificationCount(recipientUserId, proposalId)).toBe(1);
    const message = db
      .prepare(
        `SELECT message FROM notifications
          WHERE recipient_user_id = ? AND entity_id = ? AND type = 'auto_promotion_disabled_regression'`,
      )
      .get(recipientUserId, proposalId) as { message: string };
    expect(message.message).toContain('Auto-promotion was disabled');
    expect(message.message).not.toContain('claude-opus');
    expect(message.message).not.toContain('configPatch');
  });

  it('uses the durable notification idempotency key if post-commit delivery is retried after a crash', async () => {
    const { proposalId, recipientUserId } = await seedSuccessfulAutoRevert();
    const notifications = new NotificationService(new NotificationsRepository());

    await notifications.notifyAutoPromotionDisabledDueToRegressionAsync(proposalId, recipientUserId);
    await notifications.notifyAutoPromotionDisabledDueToRegressionAsync(proposalId, recipientUserId);

    expect(regressionNotificationCount(recipientUserId, proposalId)).toBe(1);
  });

  it('issue-1444-c4: later refresh preserves the regression count and cannot re-enable promotion', async () => {
    const trust = new PromotionTrustStateRepository();
    await trust.updateAsync({ autoPromotionEnabled: true, enabledAt: '2026-08-21T00:00:00.000Z' });
    const { proposalId } = await seedSuccessfulAutoRevert();
    const event = await events.findByProposalIdAsync(proposalId);
    await runAutoRevertAsync(event!);

    const refreshed = await recordTrustCountersAsync();

    expect(refreshed.totalRegressions).toBe(1);
    expect(refreshed.autoPromotionEligible).toBe(false);
    expect(refreshed.autoPromotionEnabled).toBe(false);
    expect(refreshed.enabledAt).toBeNull();
  });

  it('counts a fixed-horizon experiment regress and a distinct successful D2 auto-revert without mutating the experiment decision', async () => {
    const experimentProposal = await proposals.createAsync({
      kind: 'refine-config',
      risk: 'low',
      title: 'Fixed-horizon regression fixture',
    });
    const experiments = new AgentOrgExperimentsRepository();
    const experiment = await experiments.declareAsync({
      proposalId: experimentProposal.id,
      adapter: 'system-prompt-v1',
      evidenceBundleJson: JSON.stringify({ experimentAdapter: 'system-prompt-v1' }),
      baselineSpecJson: '{}',
      candidateSpecJson: '{}',
      assignmentKey: `feedback-${crypto.randomUUID()}`,
      stoppingRule: { minSamplesPerCohort: 5, minEffect: 0.05 },
      maxExposure: 20,
    });
    await experiments.recordDecisionAsync(experiment.id, 'regress', 'fixed horizon regression');

    const { proposalId } = await seedSuccessfulAutoRevert();
    const event = await events.findByProposalIdAsync(proposalId);
    await runAutoRevertAsync(event!);

    const counters = await computeTrustCountersAsync();
    expect(counters.totalRegressions).toBe(2);
    expect((await experiments.findByIdAsync(experiment.id))?.decision).toBe('regress');
  });

  it('deduplicates a successful D2 auto-revert whose proposal already has a fixed-horizon regress decision', async () => {
    const { proposalId } = await seedSuccessfulAutoRevert();
    const experiments = new AgentOrgExperimentsRepository();
    const experiment = await experiments.declareAsync({
      proposalId,
      adapter: 'system-prompt-v1',
      evidenceBundleJson: JSON.stringify({ experimentAdapter: 'system-prompt-v1' }),
      baselineSpecJson: '{}',
      candidateSpecJson: '{}',
      assignmentKey: `overlap-${crypto.randomUUID()}`,
      stoppingRule: { minSamplesPerCohort: 5, minEffect: 0.05 },
      maxExposure: 20,
    });
    await experiments.recordDecisionAsync(experiment.id, 'regress', 'fixed horizon regression');
    const event = await events.findByProposalIdAsync(proposalId);

    await runAutoRevertAsync(event!);

    expect((await computeTrustCountersAsync()).totalRegressions).toBe(1);
    expect((await experiments.findByIdAsync(experiment.id))?.decision).toBe('regress');
  });

  it('isolates a notification failure after the durable revert and disablement commit', async () => {
    const trust = new PromotionTrustStateRepository();
    await trust.updateAsync({ autoPromotionEnabled: true, enabledAt: '2026-08-21T00:00:00.000Z' });
    const { proposalId } = await seedSuccessfulAutoRevert();
    const event = await events.findByProposalIdAsync(proposalId);
    const warning = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    const result = await runAutoRevertAsync(event!, {
      postCommit: {
        notifyAutoPromotionDisabledAsync: async () => {
          throw new Error('Bearer secret-not-for-logs');
        },
      },
    });

    expect(result.outcome).toBe('reverted');
    expect((await events.findByProposalIdAsync(proposalId))?.revertStatus).toBe('reverted');
    const state = await trust.getSingletonAsync();
    expect(state.totalRegressions).toBe(1);
    expect(state.autoPromotionEnabled).toBe(false);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining(`proposal '${proposalId}'`));
    expect(warning.mock.calls.flat().join(' ')).not.toContain('secret-not-for-logs');
  });

  it('does not count repaired, clear, failed, or no-op post-apply events as regressions', async () => {
    for (const [suffix, revertStatus] of [
      ['repair', 'none'],
      ['clear', 'not_needed'],
      ['failed', 'revert_failed'],
    ] as const) {
      const proposal = await proposals.createAsync({
        id: `ignored-${suffix}`,
        kind: 'refine-config',
        risk: 'low',
        title: `Ignored ${suffix}`,
      });
      await events.createAsync({
        proposalId: proposal.id,
        profileId: `profile-${suffix}`,
        changeType: 'prompt',
        preChangeSnapshotJson: '{}',
        monitoringWindowStart: '2026-08-21T00:00:00.000Z',
        monitoringWindowEnd: '2026-08-21T01:00:00.000Z',
      });
      await events.updateStatusAsync(proposal.id, { revertStatus });
    }

    expect((await computeTrustCountersAsync()).totalRegressions).toBe(0);
  });
});
