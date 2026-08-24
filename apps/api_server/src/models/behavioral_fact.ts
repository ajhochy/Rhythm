/**
 * C5 — the normalized immutable behavioral fact VIEW (contract
 * docs/ai/contracts/issue-causal-runtime-v2.json, phase C5, requirement 1).
 *
 * NOT a new table. `AgentRunOutcome` (W4) is ALREADY the normalized,
 * immutable, safe-aggregate-only ledger row this requirement asks for: one
 * finalized row per root run, written once and never mutated again (see
 * agent_run_outcome.ts's module doc), already carrying a stable id,
 * source session identity, and profileId/configRevision. Building a SECOND
 * physical store to duplicate that would be exactly the kind of thing this
 * campaign's ponytail/reuse posture forbids — this is a pure projection over
 * the existing ledger row.
 *
 * `factFamily` and `detectorVersion` are closed/fixed today because exactly
 * one detector produces facts: the deterministic run-outcome finalizer
 * (run_outcome_service.ts's finalizeVerdict, called from the W4 terminal
 * hook). Add a new family/detector version constant here — never repurpose
 * an existing one — the day a second detector (e.g. an LLM-diagnosis signal
 * extractor) starts emitting its own normalized facts.
 */

import type { AgentRunOutcome } from './agent_run_outcome';

export type BehavioralFactFamily = 'run-outcome-v1';

export const BEHAVIORAL_FACT_FAMILIES: readonly BehavioralFactFamily[] = ['run-outcome-v1'] as const;

/** The one detector that produces `run-outcome-v1` facts today. */
export const RUN_OUTCOME_DETECTOR_VERSION = 'run-outcome-finalizer-v1';

/** Safe, closed enum/aggregate values only — never raw prompt/output/tool-argument content. */
export interface BehavioralFactAggregate {
  terminalStatus: AgentRunOutcome['terminalStatus'];
  objectiveVerdict: AgentRunOutcome['objectiveVerdict'];
  producedArtifact: boolean | null;
  errorCount: number | null;
}

export interface BehavioralFact {
  /** Stable, immutable — the ledger row's own id. Never regenerated on read. */
  factId: string;
  factFamily: BehavioralFactFamily;
  detectorVersion: string;
  profileId: string | null;
  configRevision: number | null;
  /** The run(s) this fact was observed from — root + child session, deduped. */
  sourceSessionIds: string[];
  /** The event(s) this fact is bound to. One per fact today: the ledger row itself. */
  sourceEventIds: string[];
  /**
   * Whether this fact carries any observable evidence at all. Mirrors W4's
   * "null means not observable, never coerced to a default" rule
   * (ObjectiveEvidence) — a fact with no observable evidence is NOT the same
   * as a fact evidencing a good or bad outcome, and a caller selecting
   * "qualifying" facts must be able to tell the two apart.
   */
  evidenceAvailable: boolean;
  /** When the underlying run was finalized (immutable, set once). */
  recordedAt: string;
  aggregate: BehavioralFactAggregate;
}

/**
 * The view: exactly one immutable behavioral fact per finalized run-outcome
 * ledger row. Pure function — no I/O, no DB access — so it can be applied to
 * anything the ledger already returns without a second query.
 */
export function behavioralFactFromRunOutcome(outcome: AgentRunOutcome): BehavioralFact {
  const sourceSessionIds = [...new Set(
    [outcome.rootSessionId, outcome.sessionId].filter((id): id is string => typeof id === 'string' && id.length > 0),
  )];
  return {
    factId: outcome.id,
    factFamily: 'run-outcome-v1',
    detectorVersion: RUN_OUTCOME_DETECTOR_VERSION,
    profileId: outcome.profileId,
    configRevision: outcome.configRevision,
    sourceSessionIds,
    sourceEventIds: [outcome.id],
    evidenceAvailable:
      outcome.objectiveEvidence.producedArtifact !== null || outcome.objectiveEvidence.errorCount !== null,
    recordedAt: outcome.finalizedAt,
    aggregate: {
      terminalStatus: outcome.terminalStatus,
      objectiveVerdict: outcome.objectiveVerdict,
      producedArtifact: outcome.objectiveEvidence.producedArtifact,
      errorCount: outcome.objectiveEvidence.errorCount,
    },
  };
}
