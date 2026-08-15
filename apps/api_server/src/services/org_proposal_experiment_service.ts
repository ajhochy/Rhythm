/**
 * W6 — the controlled experiment gate.
 *
 * This is the ONLY thing in the codebase that may establish VERIFIED
 * improvement. Everything else — one replay, one usage count, a shorter
 * allowlist, output length, the disappearance of a regex, one LLM score — is a
 * proxy, and an engine that promotes on a proxy optimises the proxy.
 *
 * Every refusal lands on `inconclusive`, never on a silent skip and never on
 * `regress`: an absent cohort or an invalid bundle is a failure to measure, not
 * evidence of harm.
 *
 * ── SHIPPED LIMITATION, stated rather than left as a silently-passing test ──
 *
 * NO PRODUCTION CALLER DECLARES, ASSIGNS, OR JUDGES AN EXPERIMENT. Every
 * function in this module is reachable only from its own tests: no route, no
 * controller and no path in org_optimizer_run_service.ts calls declareAsync,
 * assignSubjectAsync or judgeExperimentAsync. Consequently, in production
 * `agent_org_proposals.outcome_status` can only ever hold `unproven`,
 * `inconclusive` or `regressed` — the values the demoted measure path writes.
 * `verified` is unreachable outside the test suite until the wiring lands.
 *
 * That is BROADER than the limitation W6-c5 records (nothing populates
 * agent_run_outcomes.experiment_variant, so every cohort is empty in
 * production). Both are true; this one is the one that decides whether this
 * file is a live gate or a correct mechanism waiting to be plugged in. It is
 * currently the second, and W6-c12's positive control proves the mechanism
 * works, not that it runs.
 *
 * Wiring cohort assignment into run creation, and the experiment lifecycle into
 * the optimizer run service, is explicitly out of W6's scope — see the
 * contract's explicitly_out_of_scope list. W7's live gate is where this becomes
 * observable against a real sandbox.
 */

import { createHash } from 'node:crypto';

import { logger } from '../utils/logger';
import {
  EXPERIMENT_ADAPTERS,
  PRIMARY_METRICS,
  type ProposalEvidenceBundle,
} from '../models/proposal_evidence_bundle';
import type {
  AgentOrgExperiment,
  ExperimentDecision,
  ExperimentResults,
} from '../models/agent_org_experiment';
import type { AgentRunOutcome } from '../models/agent_run_outcome';
import { AgentOrgExperimentsRepository } from '../repositories/agent_org_experiments_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { AgentRunOutcomesRepository } from '../repositories/agent_run_outcomes_repository';
import { validateEvidenceBundle } from './proposal_evidence_validator';

export type Cohort = 'baseline' | 'candidate';

/**
 * W6-c4 — deterministic assignment. A pure function of recorded inputs: the
 * same subject and experiment always yield the same cohort, in any process, on
 * any run, recomputable without reading a stored value.
 *
 * ponytail: an even/odd split on a sha256 digest. Not a randomised balance
 * algorithm — with a large subject set the split is close enough to even, and a
 * skew that mattered would show up as the cohort sample counts in `results`.
 */
export function assignCohort(assignmentKey: string, subjectId: string): Cohort {
  const digest = createHash('sha256').update(`${assignmentKey}:${subjectId}`).digest();
  return digest[0] % 2 === 0 ? 'baseline' : 'candidate';
}

export type AssignmentResult =
  | { status: 'assigned'; cohort: Cohort }
  | { status: 'refused'; reason: string };

/**
 * W6-c14 — maximum exposure is ENFORCED. A cap that binds nothing leaves
 * promotion governed by whatever evidence happens to arrive.
 */
export function assignSubject(input: {
  assignmentKey: string;
  maxExposure: number;
  currentExposure: number;
  subjectId: string;
}): AssignmentResult {
  if (input.currentExposure >= input.maxExposure) {
    return {
      status: 'refused',
      reason:
        `maximum exposure reached (${input.currentExposure}/${input.maxExposure}) — ` +
        'no further subjects may be enrolled',
    };
  }
  return { status: 'assigned', cohort: assignCohort(input.assignmentKey, input.subjectId) };
}

export interface ExperimentDeps {
  experimentsRepo?: AgentOrgExperimentsRepository;
  outcomesRepo?: AgentRunOutcomesRepository;
  proposalsRepo?: AgentOrgProposalsRepository;
}

/** Live exposure is the number of ledger rows already enrolled in the experiment. */
export async function assignSubjectAsync(
  experimentId: string,
  subjectId: string,
  deps: ExperimentDeps = {},
): Promise<AssignmentResult> {
  const experimentsRepo = deps.experimentsRepo ?? new AgentOrgExperimentsRepository();
  const experiment = await experimentsRepo.findByIdAsync(experimentId);
  if (!experiment) {
    return { status: 'refused', reason: `experiment '${experimentId}' does not exist` };
  }
  const outcomesRepo = deps.outcomesRepo ?? new AgentRunOutcomesRepository();
  const enrolled = await outcomesRepo.listByExperimentAsync(experiment.proposalId);
  return assignSubject({
    assignmentKey: experiment.assignmentKey,
    maxExposure: experiment.maxExposure,
    currentExposure: enrolled.length,
    subjectId,
  });
}

export interface DecisionResult {
  decision: ExperimentDecision;
  reason: string;
  results: ExperimentResults | null;
}

function inconclusive(reason: string, results: ExperimentResults | null = null): DecisionResult {
  return { decision: 'inconclusive', reason, results };
}

/**
 * W6-c12 — all three decisions are reachable on THIS path.
 *
 * Order matters, and every gate before the comparison is a refusal:
 *   1. the evidence bundle must be present and valid       (W6-c13 / W6-c2)
 *   2. the adapter must be registered AND promotion-capable (W6-c13 / W6-c6)
 *   3. both cohorts must be non-empty                       (W6-c5)
 *   4. the PREDECLARED stopping rule must be satisfied       (W6-c3)
 * Only then are the two primary-metric values compared, which is the only
 * place `promote` or `regress` can come from.
 */
export function decideExperiment(input: {
  experiment: AgentOrgExperiment;
  baseline: AgentRunOutcome[];
  candidate: AgentRunOutcome[];
}): DecisionResult {
  const { experiment, baseline, candidate } = input;

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(experiment.evidenceBundleJson) as unknown;
  } catch {
    return inconclusive('the stored evidence bundle is not parseable JSON');
  }
  const validation = validateEvidenceBundle(parsed);
  if (!validation.valid) {
    return inconclusive(
      `the evidence bundle is not valid: ${validation.reasons.join('; ')}`,
    );
  }
  const bundle: ProposalEvidenceBundle = validation.bundle;

  const adapter = EXPERIMENT_ADAPTERS[bundle.experimentAdapter];
  if (!adapter) {
    return inconclusive(
      `experiment adapter '${bundle.experimentAdapter}' is not in the closed registry`,
    );
  }
  if (!adapter.canEstablishVerified) {
    return inconclusive(
      `adapter '${adapter.name}' cannot establish verified improvement: ${adapter.note}`,
    );
  }

  // A result must never be judged against a rule that did not predate it.
  if (
    experiment.resultsRecordedAt &&
    experiment.declaredAt > experiment.resultsRecordedAt
  ) {
    return inconclusive(
      'the experiment was declared after the results it is being judged on',
    );
  }

  if (baseline.length === 0) {
    return inconclusive('the baseline cohort is empty — nothing to compare against');
  }
  if (candidate.length === 0) {
    return inconclusive('the candidate cohort is empty — nothing to compare');
  }

  const metric = PRIMARY_METRICS[bundle.primaryMetric.name];
  const results: ExperimentResults = {
    baseline: { sampleCount: baseline.length, primaryMetricValue: metric(baseline) },
    candidate: { sampleCount: candidate.length, primaryMetricValue: metric(candidate) },
  };

  const { minSamplesPerCohort, minEffect } = experiment.stoppingRule;
  if (
    results.baseline.sampleCount < minSamplesPerCohort ||
    results.candidate.sampleCount < minSamplesPerCohort
  ) {
    return inconclusive(
      `the predeclared stopping rule is not satisfied: ${results.baseline.sampleCount} baseline / ` +
        `${results.candidate.sampleCount} candidate samples, ${minSamplesPerCohort} required per cohort`,
      results,
    );
  }

  // `direction` says which way is better; the effect is always signed so that
  // positive means the candidate improved.
  const raw = results.candidate.primaryMetricValue - results.baseline.primaryMetricValue;
  const effect = bundle.primaryMetric.direction === 'increase' ? raw : -raw;
  const summary =
    `${bundle.primaryMetric.name} baseline=${results.baseline.primaryMetricValue} ` +
    `candidate=${results.candidate.primaryMetricValue} effect=${effect.toFixed(4)} ` +
    `(direction=${bundle.primaryMetric.direction}, minEffect=${minEffect})`;

  if (effect >= minEffect) return { decision: 'promote', reason: `promote: ${summary}`, results };
  if (effect <= -minEffect) return { decision: 'regress', reason: `regress: ${summary}`, results };
  return inconclusive(
    `the move is smaller than the predeclared minimum effect: ${summary}`,
    results,
  );
}

/** How a decision maps onto the proposal's OUTCOME field (never its status). */
const OUTCOME_BY_DECISION = {
  promote: 'verified',
  regress: 'regressed',
  inconclusive: 'inconclusive',
} as const;

/**
 * Read the cohorts from W4's ledger, decide, and record durably: the results
 * and the decision on the experiment row, and the resulting outcome_status on
 * the proposal through the revision-fenced write.
 *
 * The proposal's DEPLOYMENT status is never touched here.
 */
export async function judgeExperimentAsync(
  experimentId: string,
  deps: ExperimentDeps = {},
): Promise<DecisionResult> {
  const experimentsRepo = deps.experimentsRepo ?? new AgentOrgExperimentsRepository();
  const experiment = await experimentsRepo.findByIdAsync(experimentId);
  if (!experiment) {
    return inconclusive(`experiment '${experimentId}' does not exist`);
  }

  // A decided experiment is history. Re-judging it would recompute against a
  // ledger that has moved on, and every re-run bumped the proposal's CAS
  // revision for a fact that did not change.
  if (experiment.decision) {
    return {
      decision: experiment.decision,
      reason: experiment.decisionReason ?? 'already decided',
      results: experiment.results,
    };
  }

  const outcomesRepo = deps.outcomesRepo ?? new AgentRunOutcomesRepository();
  const enrolled = await outcomesRepo.listByExperimentAsync(experiment.proposalId);
  const baseline = enrolled.filter((o) => o.experimentVariant === 'baseline');
  const candidate = enrolled.filter((o) => o.experimentVariant === 'candidate');

  const decided = decideExperiment({ experiment, baseline, candidate });

  if (decided.results && !experiment.results) {
    await experimentsRepo.recordResultsAsync(experiment.id, decided.results);
  }
  if (!experiment.decision) {
    await experimentsRepo.recordDecisionAsync(experiment.id, decided.decision, decided.reason);
  }

  await writeOutcomeStatus(
    experiment.proposalId,
    OUTCOME_BY_DECISION[decided.decision],
    deps.proposalsRepo,
  );

  return decided;
}

/**
 * Revision-fenced outcome write. Never throws: an experiment verdict that could
 * not be stamped on the proposal is a logged, visible gap, not a reason to take
 * down the caller (the human-approved lane calls into this path
 * fire-and-forget).
 */
export async function writeOutcomeStatus(
  proposalId: string,
  outcomeStatus: (typeof OUTCOME_BY_DECISION)[keyof typeof OUTCOME_BY_DECISION],
  proposalsRepo?: AgentOrgProposalsRepository,
): Promise<boolean> {
  const repo = proposalsRepo ?? new AgentOrgProposalsRepository();
  try {
    const current = await repo.findByIdAsync(proposalId);
    if (!current) return false;
    // An established verdict is never downgraded by a later, weaker one — the
    // same guard recordDiagnosticOutcome applies on the measure side.
    if (current.outcomeStatus === 'verified' && outcomeStatus !== 'verified') return false;
    const written = await repo.setOutcomeStatusAtRevisionAsync({
      proposalId,
      expectedRevision: current.revision,
      outcomeStatus,
    });
    return written !== null;
  } catch (err) {
    logger.warn(
      `[org-proposal-experiment] could not record outcome_status for '${proposalId}': ${String(err)}`,
    );
    return false;
  }
}
