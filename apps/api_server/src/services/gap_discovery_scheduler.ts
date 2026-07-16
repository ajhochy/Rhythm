/**
 * gap_discovery_scheduler.ts — #1112 (Discovery-004): make external discovery
 * capability-gap-DRIVEN, not timer-only.
 *
 * Before this, a newly-recorded capability gap (skill_extractor.ts's Stage A
 * step 3) sat inert until the next weekly "Org External Discovery" cron pass
 * (or the shared runOrgOptimizer() sweep) happened to reach it, last, under
 * the shared #830 per-run proposal cap. This module lets a NEW gap schedule
 * its own debounced discovery pass instead of waiting.
 *
 * Debounce shape mirrors harvested_skill_evaluator.ts's #1109
 * `scheduleIdleEvaluation` EXACTLY: a module-level setTimeout coalesces a
 * BURST of gap inserts (e.g. several harvester sessions completing back to
 * back) into ONE pass fired after the debounce window elapses, rather than
 * one discovery session per gap.
 *
 * Dedicated budget, not the shared runOrgOptimizer() cap: this module calls
 * runExternalDiscoveryGenerator DIRECTLY — the plain, deterministic,
 * non-agent server-side function (see external_discovery_generator.ts) —
 * never the full six-generator optimizer loop. A gap-triggered pass costs at
 * most maxGapsPerPass() ecosystem searches + judge calls, on its OWN budget,
 * independent of and never competing with runOrgOptimizer's #830 per-run cap.
 *
 * Bounded, rate-limited backlog drain: a single pass only considers the
 * OLDEST maxGapsPerPass() open gaps (AgentCapabilityGapsRepository
 * .listOpenAsync() already orders by created_at ascending), so a large
 * existing backlog (152 open gaps measured pre-#1112) drains a few at a time
 * across successive passes instead of fanning out one ecosystem search per
 * backlogged gap in a single burst (respects #1110's cheap-tier cost
 * posture — the judge call inside candidateBeatsDraft still routes through
 * AgentRunner, so it needs the SAME #746 cold-start guard runOrgOptimizer
 * itself checks; this module checks it independently since it never goes
 * through runOrgOptimizer).
 */

import { logger } from '../utils/logger';
import { env } from '../config/env';
import { isEngineColdStart } from './skill_extractor';
import {
  AgentCapabilityGapsRepository,
  type CapabilityGapRow,
} from '../repositories/agent_capability_gaps_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import {
  runExternalDiscoveryGenerator,
  type RunGeneratorResult,
} from './generators/external_discovery_generator';
import { discoverCandidatesFromEcosystem } from './generators/external_discovery_search';
import type { OrgAuditGap } from './org_audit_service';

/** Debounce window before a coalesced gap-driven pass fires. Default 5 min; override via RHYTHM_GAP_DISCOVERY_DEBOUNCE_MS (ms), same parsing style as harvested_skill_evaluator.ts. */
function gapDiscoveryDebounceMs(): number {
  const raw = process.env.RHYTHM_GAP_DISCOVERY_DEBOUNCE_MS;
  if (raw === undefined) return 300_000;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 300_000;
}

/** Bounded, rate-limited backlog drain: at most this many open gaps considered per pass. */
function maxGapsPerPass(): number {
  const raw = process.env.RHYTHM_GAP_DISCOVERY_MAX_GAPS_PER_PASS;
  if (raw === undefined) return 5;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

/** Dedicated per-pass proposal budget — independent of runOrgOptimizer's shared #830 cap. */
function maxProposalsPerPass(): number {
  const raw = process.env.RHYTHM_GAP_DISCOVERY_MAX_PROPOSALS_PER_PASS;
  if (raw === undefined) return 3;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

/**
 * CapabilityGapRow -> OrgAuditGap. Mirrors org_audit_service.ts's own private
 * `detectCapabilityGaps` mapping (not exported, and org_audit_service.ts is
 * outside this issue's file ownership, so this is a small, deliberate
 * duplication of that same six-field mapping rather than an out-of-scope
 * edit to export it).
 */
function toAuditGap(row: CapabilityGapRow): OrgAuditGap {
  return {
    gapId: row.dedupKey,
    kind: 'capability-gap',
    evidence: `capability-gap intent="${row.intentTitle}" agent=${row.agentConfigId ?? '(unassigned)'} sampleSession=${row.sampleSessionId ?? '(none)'}`,
    agentConfigId: row.agentConfigId ?? undefined,
    sampleSessionId: row.sampleSessionId ?? undefined,
    intentTitle: row.intentTitle,
    intentProblem: row.intentProblem ?? undefined,
    intentTags: row.intentTags ?? [],
  };
}

export interface GapDiscoveryDeps {
  gapsRepo?: AgentCapabilityGapsRepository;
  proposalsRepo?: AgentOrgProposalsRepository;
  discoverCandidates?: typeof discoverCandidatesFromEcosystem;
}

export type GapDiscoveryPassResult = RunGeneratorResult & {
  /** How many open gaps this pass actually considered (bounded by maxGapsPerPass()). */
  gapsConsidered: number;
  /** True when the pass was skipped entirely (cold-start / role gate) rather than run. */
  skipped: boolean;
  skippedReason?: string;
};

const EMPTY_RESULT: Omit<GapDiscoveryPassResult, 'skipped' | 'skippedReason'> = {
  emitted: 0,
  droppedNoGap: 0,
  droppedMissingProvenance: 0,
  droppedDuplicate: 0,
  errored: false,
  gapsConsidered: 0,
};

/**
 * Run one gap-driven discovery pass: read the CURRENT open-gap backlog
 * (oldest first), slice to maxGapsPerPass(), and run the discovery generator
 * with a dedicated proposal budget. Never throws (mirrors
 * runExternalDiscoveryGenerator's own operational envelope).
 */
export async function runGapDrivenDiscoveryPass(
  deps: GapDiscoveryDeps = {},
): Promise<GapDiscoveryPassResult> {
  try {
    // Role gate (not engine gate — mirrors #1113's org_optimizer_seed.ts fix):
    // agent execution never runs under the 'cloud' deployment role.
    if (!env.agentExecutionEnabled) {
      return { ...EMPTY_RESULT, skipped: true, skippedReason: 'agent execution disabled for this deployment role' };
    }
    // #746 cold-start guard: the judge call inside candidateBeatsDraft routes
    // through AgentRunner (skill_refiner.scoreSkillBody), same as every other
    // self-improvement LLM call. runOrgOptimizer checks this itself before
    // its own (inline) external-discovery step; this module bypasses
    // runOrgOptimizer entirely so it must check independently.
    if (isEngineColdStart()) {
      logger.info('[gap-discovery-scheduler] skipped — engine is within its #746 cold-start window');
      return { ...EMPTY_RESULT, skipped: true, skippedReason: 'engine cold-start window active (#746)' };
    }

    const gapsRepo = deps.gapsRepo ?? new AgentCapabilityGapsRepository();
    const openGaps = await gapsRepo.listOpenAsync();
    const slice = openGaps.slice(0, maxGapsPerPass());

    logger.info(
      `[gap-discovery-scheduler] running gap-driven discovery pass — ${slice.length}/${openGaps.length} open gaps considered this pass`,
    );

    if (slice.length === 0) {
      return { ...EMPTY_RESULT, skipped: false };
    }

    const result = await runExternalDiscoveryGenerator({
      gaps: slice.map(toAuditGap),
      discoverCandidates: deps.discoverCandidates ?? discoverCandidatesFromEcosystem,
      maxResults: maxProposalsPerPass(),
      proposalsRepo: deps.proposalsRepo,
    });

    logger.info(
      `[gap-discovery-scheduler] pass complete — emitted=${result.emitted} droppedNoGap=${result.droppedNoGap} droppedMissingProvenance=${result.droppedMissingProvenance} droppedDuplicate=${result.droppedDuplicate}`,
    );

    return { ...result, gapsConsidered: slice.length, skipped: false };
  } catch (err) {
    logger.warn(`[gap-discovery-scheduler] pass FAILED (non-fatal): ${String(err)}`);
    return { ...EMPTY_RESULT, errored: true, skipped: false };
  }
}

let _pendingTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Fire-and-forget debounced scheduling — call this whenever a NEW capability
 * gap is recorded (skill_extractor.ts's gap-write branch, only on a
 * genuinely new insert, never on a dedup hit). If a pass is already pending,
 * this is a no-op: the pending pass fires once the debounce window elapses
 * regardless of how many more gaps arrive before then, so a burst of gaps
 * collapses into exactly ONE discovery pass. Never throws — the eventual
 * pass's own rejection is caught here (mirrors scheduleIdleEvaluation's own
 * posture).
 *
 * `runFn` is an injectable seam for tests (defaults to the real
 * {@link runGapDrivenDiscoveryPass}) — production callers (skill_extractor.ts)
 * call this with no arguments.
 */
export function scheduleGapDrivenDiscovery(
  runFn: () => Promise<unknown> = runGapDrivenDiscoveryPass,
): void {
  if (_pendingTimer) {
    logger.info('[gap-discovery-scheduler] pass already pending — coalescing this gap into it');
    return; // already pending — coalesce
  }
  const debounceMs = gapDiscoveryDebounceMs();
  logger.info(`[gap-discovery-scheduler] scheduling a gap-driven discovery pass in ${debounceMs}ms`);
  const timer = setTimeout(() => {
    _pendingTimer = null;
    Promise.resolve(runFn()).catch((err) =>
      logger.warn(`[gap-discovery-scheduler] scheduled pass failed (non-fatal): ${String(err)}`),
    );
  }, debounceMs);
  // Don't hold the process open for this alone (mirrors harvested_skill_evaluator.ts's idle timer).
  timer.unref?.();
  _pendingTimer = timer;
}

/** Test-only: cancel any pending timer + reset state. */
export function _resetGapDiscoverySchedulerForTests(): void {
  if (_pendingTimer) clearTimeout(_pendingTimer);
  _pendingTimer = null;
}
