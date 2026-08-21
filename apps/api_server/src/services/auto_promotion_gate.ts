/**
 * D4.3 (#1441) — the fail-closed bridge from a durably verified experiment to
 * the existing approval execution path. Availability intentionally defaults
 * to false; the env-backed production implementation belongs to #1442.
 */
import { PromotionTrustStateRepository } from '../repositories/promotion_trust_state_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { ToolSafetyReportsRepository } from '../repositories/tool_safety_reports_repository';
import { PostApplyEventsRepository } from '../repositories/post_apply_events_repository';
import {
  applyApprovedProposalAsync,
  reconstructPostApplyTarget,
} from './org_proposal_apply_service';
import { evaluateToolInstallSafetyAsync } from './tool_install_safety_policy';

export interface AutoPromotionAvailability {
  isAvailable(): boolean | Promise<boolean>;
}

/** Production-safe until #1442 explicitly wires an operator-controlled source. */
export const unavailableAutoPromotionAvailability: AutoPromotionAvailability = {
  isAvailable: () => false,
};

export type AutoPromotionResult = {
  status:
    | 'unavailable'
    | 'ineligible'
    | 'not-verified'
    | 'tool-safety-blocked'
    | 'conflict'
    | 'apply-failed'
    | 'enrollment-pending'
    | 'applied'
    | 'already-applied';
};

export interface AutoPromotionGateDeps {
  availability?: AutoPromotionAvailability;
  trustStateRepo?: PromotionTrustStateRepository;
  proposalsRepo?: AgentOrgProposalsRepository;
  reports?: ToolSafetyReportsRepository;
  postApplyEvents?: PostApplyEventsRepository;
  /** Narrow failure-injection seam; production uses the shared D2 finalizer. */
  finalizePostApply?: typeof import('./post_apply_lifecycle').finalizePostApplyLifecycleAsync;
}

/**
 * The approval repository requires a non-negative actor id for its audit
 * column. `0` is its established local-system actor; no user confirmation is
 * represented by this value and the gate's durable predicates are still the
 * only authority for this call.
 */
const AUTO_PROMOTION_ACTOR_ID = 0;

function isAlreadyApplied(status: string): boolean {
  return status === 'applied' || status === 'measuring' || status === 'active';
}

/**
 * Attempts one verified proposal. Every unavailable dependency, stale/missing
 * safety report, failed CAS, or apply error returns a non-success result and
 * leaves the human review path intact. No proposal-kind allowlist exists here:
 * each existing validator and applier remains authoritative.
 */
export async function attemptAutoPromotionAsync(
  proposalId: string,
  deps: AutoPromotionGateDeps = {},
): Promise<AutoPromotionResult> {
  const availability = deps.availability ?? unavailableAutoPromotionAvailability;
  try {
    if (!(await availability.isAvailable())) return { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  }

  const trust = deps.trustStateRepo ?? new PromotionTrustStateRepository();
  let state;
  try {
    state = await trust.getSingletonAsync();
  } catch {
    return { status: 'unavailable' };
  }
  if (
    !state.autoPromotionEligible ||
    !state.autoPromotionEnabled ||
    state.totalRegressions !== 0 ||
    state.enabledAt === null
  ) return { status: 'ineligible' };

  const proposals = deps.proposalsRepo ?? new AgentOrgProposalsRepository();
  let proposal;
  try {
    proposal = await proposals.findByIdAsync(proposalId);
  } catch {
    return { status: 'not-verified' };
  }
  if (!proposal || proposal.outcomeStatus !== 'verified') return { status: 'not-verified' };
  const events = deps.postApplyEvents ?? new PostApplyEventsRepository();
  if (isAlreadyApplied(proposal.status)) {
    const target = reconstructPostApplyTarget(proposal);
    // Truly non-profile mutations have no D2 target and retain their ordinary
    // already-applied state. A recognized profile mutation must prove D2.
    if (!target) return { status: 'already-applied' };
    try {
      if (await events.findByProposalIdAsync(proposal.id)) return { status: 'already-applied' };
      const finalizePostApplyLifecycleAsync = deps.finalizePostApply ??
        (await import('./post_apply_lifecycle')).finalizePostApplyLifecycleAsync;
      const enrolled = await finalizePostApplyLifecycleAsync(proposal, target);
      if (!enrolled || !(await events.findByProposalIdAsync(proposal.id))) {
        return { status: 'enrollment-pending' };
      }
      return { status: 'already-applied' };
    } catch {
      return { status: 'enrollment-pending' };
    }
  }

  if (proposal.kind === 'tool-install') {
    // Supplying a throwing vetter prevents this read-only gate from creating a
    // fresh report. Automation requires the latest *durable* SAFE report; it
    // cannot manufacture vetting or a conditional human confirmation.
    let safety;
    try {
      safety = await evaluateToolInstallSafetyAsync(proposal, {
        explicitHumanConfirmation: false,
        deps: {
          reports: deps.reports ?? new ToolSafetyReportsRepository(),
          vet: async () => { throw new Error('automatic promotion cannot synthesize a vetting report'); },
        },
      });
    } catch {
      return { status: 'tool-safety-blocked' };
    }
    if (!safety.allowed || safety.verdict !== 'safe') return { status: 'tool-safety-blocked' };
  }

  try {
    const outcome = await applyApprovedProposalAsync({
      proposal,
      decidedByUserId: AUTO_PROMOTION_ACTOR_ID,
      explicitHumanConfirmation: false,
      proposalsRepo: proposals,
      finalizePostApply: deps.finalizePostApply,
      requirePostApplyEnrollment: true,
    });
    if (outcome.kind === 'applied') {
      const target = reconstructPostApplyTarget(outcome.proposal);
      if (target && !(await events.findByProposalIdAsync(outcome.proposal.id))) {
        return { status: 'enrollment-pending' };
      }
      return { status: 'applied' };
    }
    if (outcome.kind === 'enrollment-pending') return { status: 'enrollment-pending' };
    if (outcome.kind === 'failed') return { status: 'apply-failed' };
    return { status: 'conflict' };
  } catch {
    // The durable state is deliberately not inferred from an exception. A
    // subsequent sweep re-reads and either retries a still-reviewable row or
    // reports already-applied; this result never claims a successful apply.
    return { status: 'apply-failed' };
  }
}
