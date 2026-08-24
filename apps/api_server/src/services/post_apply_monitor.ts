/**
 * D2.2 (#1432) — the post-apply guardrail monitor.
 *
 * Starts watching an affected profile's runs after ANY proposal is applied
 * (wired at the real apply boundary in D2.5), and evaluates C3's closed
 * guardrail registry (`models/guardrail_registry.ts` —
 * `terminal-error-rate` / `treatment-integrity-failure-rate`, via the
 * existing `evaluateGuardrails` — never reimplemented here) against the
 * profile's run outcomes since the monitoring window opened.
 *
 * Poll-driven, not push-driven: {@link evaluatePostApplyGuardrailsAsync} is
 * meant to be called on a recurring sweep (mirroring the org-optimizer's
 * existing cron-sweep design — see `org_optimizer_run_service.ts`) for every
 * PostApplyEvent still in the `monitoring` state, until it trips or its
 * window expires. Once an event leaves `monitoring` (tripped/clear), further
 * calls are a permanent no-op — "the monitor stops".
 *
 * Unlike the experiment evidence bundle's guardrail declaration (C3), this
 * monitor is a blanket safety net applied to every applied proposal
 * regardless of kind: it always evaluates every closed-registry guardrail,
 * not a per-proposal declared subset. A proposal that happens to have gone
 * through the causal-runtime-v2 experiment machinery additionally gets its
 * enrollment rows folded in (so `treatment-integrity-failure-rate` can see
 * them); a plain (non-experiment) applied proposal simply has an empty
 * enrollment set, so that guardrail can never fire for it — by design, not
 * an oversight.
 */

import { logger } from '../utils/logger';
import { PostApplyEventsRepository } from '../repositories/post_apply_events_repository';
import { AgentRunOutcomesRepository } from '../repositories/agent_run_outcomes_repository';
import { AgentOrgExperimentsRepository } from '../repositories/agent_org_experiments_repository';
import { AgentOrgExperimentEnrollmentsRepository } from '../repositories/agent_org_experiment_enrollments_repository';
import { GUARDRAIL_NAMES, evaluateGuardrails, type GuardrailEvaluation } from '../models/guardrail_registry';
import type { PostApplyChangeType, PostApplyEvent } from '../models/post_apply_event';

/** ponytail: fixed 1-hour observation window — upgrade to a per-kind config if a real change needs a different period. */
export const DEFAULT_MONITORING_WINDOW_MS = 60 * 60 * 1000;

/**
 * ponytail: fixed floor matching guardrail_registry's "avoid tripping on
 * n=1" doc comment. Exported so auto_repair_service.ts's post-repair
 * evidence gate uses the SAME threshold as the pre-trip monitor — one
 * definition of "enough samples to trust," never two that can drift apart.
 */
export const DEFAULT_MIN_GUARDRAIL_SAMPLE_COUNT = 5;

export type AutoRepairTrigger = (event: PostApplyEvent) => Promise<void> | void;

function logOnlyAutoRepairTrigger(event: PostApplyEvent): void {
  logger.warn(
    `[post-apply-monitor] guardrail tripped for proposal '${event.proposalId}' but no auto-repair ` +
      'trigger is registered yet (D2.3 not wired) — recorded tripped only',
  );
}

/** D2.3 registers the real auto-repair service here once it exists. */
let registeredAutoRepairTrigger: AutoRepairTrigger = logOnlyAutoRepairTrigger;

export function registerAutoRepairTrigger(trigger: AutoRepairTrigger): void {
  registeredAutoRepairTrigger = trigger;
}

/** Test-only: restore the unregistered (log-only) stub. */
export function resetAutoRepairTriggerForTests(): void {
  registeredAutoRepairTrigger = logOnlyAutoRepairTrigger;
}

export interface StartPostApplyMonitoringInput {
  proposalId: string;
  profileId: string;
  changeType: PostApplyChangeType;
  preChangeSnapshotJson: string;
  now?: Date;
  windowMs?: number;
}

/** Start watching an affected profile's runs after a proposal is applied. */
export async function startPostApplyMonitoringAsync(
  input: StartPostApplyMonitoringInput,
  deps: { eventsRepo?: PostApplyEventsRepository } = {},
): Promise<PostApplyEvent> {
  const eventsRepo = deps.eventsRepo ?? new PostApplyEventsRepository();
  const now = input.now ?? new Date();
  const windowMs = input.windowMs ?? DEFAULT_MONITORING_WINDOW_MS;
  return eventsRepo.createAsync({
    proposalId: input.proposalId,
    profileId: input.profileId,
    changeType: input.changeType,
    preChangeSnapshotJson: input.preChangeSnapshotJson,
    monitoringWindowStart: now.toISOString(),
    monitoringWindowEnd: new Date(now.getTime() + windowMs).toISOString(),
  });
}

export type PostApplyMonitorAction = 'tripped' | 'cleared' | 'still-monitoring' | 'no-op-terminal';

export interface PostApplyMonitorResult {
  action: PostApplyMonitorAction;
  event: PostApplyEvent;
  breaches: GuardrailEvaluation[];
}

export interface PostApplyMonitorDeps {
  eventsRepo?: PostApplyEventsRepository;
  outcomesRepo?: AgentRunOutcomesRepository;
  experimentsRepo?: AgentOrgExperimentsRepository;
  enrollmentsRepo?: AgentOrgExperimentEnrollmentsRepository;
  /** Overrides the globally registered trigger for this one call (test seam). */
  triggerAutoRepair?: AutoRepairTrigger;
  now?: Date;
  minSampleCount?: number;
}

/**
 * Evaluate one PostApplyEvent's guardrails against its profile's run
 * outcomes since the monitoring window started.
 *
 *   - Any breached guardrail -> records `tripped` and triggers auto-repair
 *     (D2.3's real service once registered via {@link registerAutoRepairTrigger};
 *     a log-only stub until then).
 *   - No breach AND the window has expired -> records `clear`, no repair.
 *   - No breach AND the window is still open -> no state change; call again
 *     on the next sweep tick.
 *   - Already left `monitoring` (tripped/clear) -> permanent no-op.
 */
export async function evaluatePostApplyGuardrailsAsync(
  event: PostApplyEvent,
  deps: PostApplyMonitorDeps = {},
): Promise<PostApplyMonitorResult> {
  if (event.guardrailStatus !== 'monitoring') {
    return { action: 'no-op-terminal', event, breaches: [] };
  }

  const eventsRepo = deps.eventsRepo ?? new PostApplyEventsRepository();
  const outcomesRepo = deps.outcomesRepo ?? new AgentRunOutcomesRepository();
  const experimentsRepo = deps.experimentsRepo ?? new AgentOrgExperimentsRepository();
  const enrollmentsRepo = deps.enrollmentsRepo ?? new AgentOrgExperimentEnrollmentsRepository();
  const now = deps.now ?? new Date();

  const [allOutcomes, experiments] = await Promise.all([
    outcomesRepo.listByProfileSinceAsync(event.profileId, event.monitoringWindowStart),
    experimentsRepo.listByProposalAsync(event.proposalId).catch(() => []),
  ]);
  const windowEndMs = new Date(event.monitoringWindowEnd).getTime();
  const outcomes = allOutcomes.filter(
    (outcome) => new Date(outcome.finalizedAt).getTime() <= windowEndMs,
  );
  const enrollmentLists = await Promise.all(
    experiments.map((experiment) => enrollmentsRepo.listByExperimentAsync(experiment.id)),
  );
  const enrollments = enrollmentLists.flat();

  const evaluations = evaluateGuardrails(GUARDRAIL_NAMES, {
    outcomes,
    enrollments,
    minSampleCount: deps.minSampleCount ?? DEFAULT_MIN_GUARDRAIL_SAMPLE_COUNT,
  });
  const breaches = evaluations.filter((e) => e.breached);

  if (breaches.length > 0) {
    const tripped = await eventsRepo.transitionGuardrailStatusAsync(
      event.proposalId,
      'monitoring',
      'tripped',
    );
    if (!tripped) {
      const winner = await eventsRepo.findByProposalIdAsync(event.proposalId);
      return { action: 'no-op-terminal', event: winner ?? event, breaches };
    }
    logger.warn(
      `[post-apply-monitor] guardrail(s) tripped for proposal '${event.proposalId}': ` +
        breaches.map((b) => `${b.guardrail}=${b.rate.toFixed(4)} over ${b.sampleCount} samples`).join(', '),
    );
    const triggerAutoRepair = deps.triggerAutoRepair ?? registeredAutoRepairTrigger;
    await triggerAutoRepair(tripped);
    return { action: 'tripped', event: tripped, breaches };
  }

  const windowExpired = now.getTime() >= new Date(event.monitoringWindowEnd).getTime();
  if (windowExpired) {
    const updated = await eventsRepo.transitionGuardrailStatusAsync(
      event.proposalId,
      'monitoring',
      'clear',
    );
    if (!updated) {
      const winner = await eventsRepo.findByProposalIdAsync(event.proposalId);
      return { action: 'no-op-terminal', event: winner ?? event, breaches: [] };
    }
    return {
      action: 'cleared',
      event: updated,
      breaches: [],
    };
  }

  return { action: 'still-monitoring', event, breaches: [] };
}
