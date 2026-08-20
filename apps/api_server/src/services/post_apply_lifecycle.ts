import { createHash } from 'node:crypto';

import { env } from '../config/env';
import type { AgentOrgProposal } from '../models/agent_org_proposal';
import type { PostApplyChangeType, PostApplyEvent } from '../models/post_apply_event';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { PostApplyEventsRepository } from '../repositories/post_apply_events_repository';
import { logger } from '../utils/logger';
import {
  registerAutoRevertTrigger,
  resetAutoRevertTriggerForTests,
  runAutoRepairAsync,
  type RunAutoRepairAsyncOptions,
} from './auto_repair_service';
import { runAutoRevertAsync } from './auto_revert_service';
import {
  evaluatePostApplyGuardrailsAsync,
  registerAutoRepairTrigger,
  resetAutoRepairTriggerForTests,
  startPostApplyMonitoringAsync,
} from './post_apply_monitor';

export interface PostApplyTarget {
  profileId: string;
  changeType: PostApplyChangeType;
}

interface LifecycleRegistration {
  diagnosis: RunAutoRepairAsyncOptions['diagnosis'];
  diagnosisReady: () => boolean | Promise<boolean>;
  now: () => Date;
}

let registration: LifecycleRegistration | null = null;
let sweepInFlight = false;

async function settleActive(proposalId: string): Promise<void> {
  const proposals = new AgentOrgProposalsRepository();
  const proposal = await proposals.findByIdAsync(proposalId);
  if (proposal?.status === 'measuring') {
    await proposals.updateStatusAsync(proposal.id, 'active', undefined, proposal.revision);
  }
}

async function repair(event: PostApplyEvent): Promise<void> {
  const current = registration;
  if (!current) {
    logger.warn(`[post-apply-lifecycle] repair deferred event=${event.id} outcome=unregistered`);
    return;
  }
  if (!(await current.diagnosisReady())) {
    logger.info(`[post-apply-lifecycle] repair deferred event=${event.id} outcome=engine-not-ready`);
    return;
  }
  await runAutoRepairAsync(event, {
    diagnosis: current.diagnosis,
    now: current.now(),
  });
}

/** Register the real monitor → repair → awaited revert composition once at boot. */
export function registerPostApplyLifecycleTriggers(input: {
  diagnosis: RunAutoRepairAsyncOptions['diagnosis'];
  diagnosisReady?: () => boolean | Promise<boolean>;
  now?: () => Date;
}): void {
  registration = {
    diagnosis: input.diagnosis,
    diagnosisReady: input.diagnosisReady ?? (() => true),
    now: input.now ?? (() => new Date()),
  };
  registerAutoRepairTrigger(repair);
  registerAutoRevertTrigger(async ({ proposalId }) => {
    const event = await new PostApplyEventsRepository().findByProposalIdAsync(proposalId);
    if (event) await runAutoRevertAsync(event);
  });
}

/** Finalize one successful, real profile mutation into D2 lifecycle ownership. */
export async function finalizePostApplyLifecycleAsync(
  proposal: AgentOrgProposal,
  target: PostApplyTarget | undefined,
): Promise<PostApplyEvent | null> {
  if (!target || env.dbClient === 'postgres') return null;
  if (!new AgentConfigsRepository().getById(target.profileId)) return null;

  const pointer = JSON.stringify({
    proposalId: proposal.id,
    profileId: target.profileId,
    proposalRevision: proposal.revision,
    beforeSnapshotSha256: createHash('sha256')
      .update(proposal.beforeSnapshotJson ?? '')
      .digest('hex'),
  });
  const event = await startPostApplyMonitoringAsync({
    proposalId: proposal.id,
    profileId: target.profileId,
    changeType: target.changeType,
    preChangeSnapshotJson: pointer,
  });

  if (proposal.status === 'applied') {
    await new AgentOrgProposalsRepository().updateStatusAsync(
      proposal.id,
      'measuring',
      undefined,
      proposal.revision,
    );
  }
  return event;
}

/** One bounded, non-overlapping scheduler sweep; failures are isolated per event. */
export async function sweepPostApplyLifecycleAsync(input: {
  now?: Date;
  limit?: number;
} = {}): Promise<{ processed: number; skipped: boolean }> {
  if (env.dbClient === 'postgres') return { processed: 0, skipped: true };
  if (sweepInFlight) return { processed: 0, skipped: true };
  sweepInFlight = true;
  let processed = 0;
  try {
    const events = await new PostApplyEventsRepository().listActionableAsync(input.limit ?? 50);
    for (const event of events) {
      try {
        if (event.guardrailStatus === 'tripped') {
          // Called every tick, not just the first: runAutoRepairAsync is
          // itself a durable, resumable one-decision-per-call state machine
          // (pending/advancing/repaired/exhausted) — see auto_repair_service.ts.
          await repair(event);
          processed += 1;
          continue;
        }
        const result = await evaluatePostApplyGuardrailsAsync(event, { now: input.now });
        if (result.action === 'cleared') {
          await new PostApplyEventsRepository().updateStatusAsync(event.proposalId, {
            revertStatus: 'not_needed',
          });
          await settleActive(event.proposalId);
        }
        processed += 1;
      } catch {
        logger.warn(`[post-apply-lifecycle] event=${event.id} outcome=failed-nonfatal`);
      }
    }
    if (processed > 0) {
      logger.info(`[post-apply-lifecycle] sweep processed=${processed} outcome=complete`);
    }
    return { processed, skipped: false };
  } finally {
    sweepInFlight = false;
  }
}

export function resetPostApplyLifecycleForTests(): void {
  registration = null;
  sweepInFlight = false;
  resetAutoRepairTriggerForTests();
  resetAutoRevertTriggerForTests();
}
