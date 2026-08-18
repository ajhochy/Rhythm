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
 * ── WIRED (post-W6). What runs in production, and what still does not ──
 *
 * The lifecycle now has real production callers:
 *
 *   declare  — POST /agent-org-proposals/:id/experiment. An OPERATOR supplies
 *              the evidence bundle. Nothing auto-declares, because a bundle
 *              requires a counter-evidence search and source event IDs that no
 *              generator produces today; synthesising them would be fabricated
 *              evidence, which is worse than no experiment.
 *   assign   — {@link resolveRunEnrollment}, called by run_outcome_service's
 *              terminal hook BEFORE the ledger row is inserted (see below).
 *   judge    — the optimizer run loop's experiment sweep: persisted under the
 *              acting modes, computed REPORT-ONLY under `shadow`.
 *
 * `agent_org_proposals.outcome_status` can therefore now reach `verified` in
 * production, which it could not before.
 *
 * ── REMAINING LIMITATION, stated rather than left to be discovered ──
 *
 * NOTHING APPLIES `baseline_spec_json` / `candidate_spec_json` PER RUN. The two
 * arms are randomly split but they are not differentially TREATED: the
 * proposal's change is already deployed to the whole population by the time any
 * run is enrolled. So a `promote` today attests that a randomised split of the
 * run population differed past the predeclared stopping rule — not that the
 * candidate arm received the change and the baseline arm did not.
 *
 * That is why judging is gated to the acting optimizer modes: on a default
 * (`shadow`) install nothing is ever promoted automatically. Per-run spec
 * application is the follow-up that turns this from an A/A split into a real
 * controlled experiment; the enrollment point below is where it plugs in.
 */

import { createHash } from 'node:crypto';

import { logger } from '../utils/logger';
import { parseOptimizerPolicy, type OptimizerPolicy } from './org_optimizer_policy';
import {
  EXPERIMENT_ADAPTERS,
  PRIMARY_METRICS,
  type ProposalEvidenceBundle,
} from '../models/proposal_evidence_bundle';
import {
  validateSystemPromptV1Spec,
  type SystemPromptV1TreatmentSpec,
} from '../models/experiment_treatment_adapter';
import type {
  AgentOrgExperiment,
  ExperimentDecision,
  ExperimentResults,
} from '../models/agent_org_experiment';
import type { AgentRunOutcome } from '../models/agent_run_outcome';
import { AgentOrgExperimentsRepository } from '../repositories/agent_org_experiments_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { AgentRunOutcomesRepository } from '../repositories/agent_run_outcomes_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentOrgExperimentEnrollmentsRepository } from '../repositories/agent_org_experiment_enrollments_repository';
import type { ExperimentEnrollment } from '../models/agent_org_experiment_enrollment';
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

function canonicalizeForHash(input: unknown): string {
  if (Array.isArray(input)) {
    return `[${input.map((item) => canonicalizeForHash(item)).join(',')}]`;
  }
  if (input && typeof input === 'object') {
    const entries = Object.keys(input as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeForHash((input as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(input);
}

interface EligibleExperimentMatch {
  experiment: AgentOrgExperiment;
  evidenceBundle: ProposalEvidenceBundle;
  baselineSpec: SystemPromptV1TreatmentSpec;
  candidateSpec: SystemPromptV1TreatmentSpec;
  targetRevisionFingerprint: string;
}

function toProfileTargetRef(profileId: string): string {
  return `agent_config:${profileId}`;
}

const SYSTEM_PROMPT_DURABLE_FINGERPRINT_NULL_SENTINEL = '__system-prompt-null__';

function buildProfileRevisionFingerprint(profile: { id: string; revision: number; systemPrompt: string | null }): string {
  return `sha256:${createHash('sha256')
    .update(
      canonicalizeForHash({
        id: profile.id,
        revision: profile.revision,
        systemPrompt: profile.systemPrompt ?? SYSTEM_PROMPT_DURABLE_FINGERPRINT_NULL_SENTINEL,
      }),
    )
    .digest('hex')}`;
}

function buildHashes(input: {
  targetRevisionFingerprint: string;
  treatmentSpec: SystemPromptV1TreatmentSpec;
}): {
  baselineTargetRevisionHash: string;
  treatmentSpecHash: string;
} {
  return {
    baselineTargetRevisionHash: input.targetRevisionFingerprint,
    treatmentSpecHash: createHash('sha256').update(canonicalizeForHash(input.treatmentSpec)).digest('hex'),
  };
}

function findEligibleExperiment(
  experiments: AgentOrgExperiment[],
  profileId: string,
  targetRevisionFingerprint: string,
): EligibleExperimentMatch | null {
  const expectedProfileRef = toProfileTargetRef(profileId);

  for (const experiment of experiments) {
    if (experiment.adapter !== 'paired-cohort-outcome') continue;

    let evidenceBundle: ProposalEvidenceBundle;
    try {
      const parsed = JSON.parse(experiment.evidenceBundleJson);
      const validatedBundle = validateEvidenceBundle(parsed);
      if (!validatedBundle.valid) continue;
      evidenceBundle = validatedBundle.bundle;
    } catch {
      continue;
    }

    if (evidenceBundle.target.ref !== expectedProfileRef) continue;
    if (evidenceBundle.target.hash !== targetRevisionFingerprint) continue;

    let baselineSpec: ReturnType<typeof validateSystemPromptV1Spec>;
    let candidateSpec: ReturnType<typeof validateSystemPromptV1Spec>;
    try {
      baselineSpec = validateSystemPromptV1Spec(JSON.parse(experiment.baselineSpecJson));
      candidateSpec = validateSystemPromptV1Spec(JSON.parse(experiment.candidateSpecJson));
    } catch {
      continue;
    }
    if (!baselineSpec.valid || !candidateSpec.valid) continue;
    if (
      baselineSpec.spec.agentConfigId !== candidateSpec.spec.agentConfigId ||
      baselineSpec.spec.agentConfigId !== profileId ||
      baselineSpec.spec.field !== 'system_prompt' ||
      candidateSpec.spec.field !== 'system_prompt'
    ) {
      continue;
    }
    if (
      baselineSpec.spec.evidenceTarget.ref !== evidenceBundle.target.ref ||
      baselineSpec.spec.evidenceTarget.hash !== targetRevisionFingerprint ||
      candidateSpec.spec.evidenceTarget.ref !== evidenceBundle.target.ref ||
      candidateSpec.spec.evidenceTarget.hash !== targetRevisionFingerprint
    ) {
      continue;
    }

    return {
      experiment,
      evidenceBundle,
      baselineSpec: baselineSpec.spec,
      candidateSpec: candidateSpec.spec,
      targetRevisionFingerprint,
    };
  }

  return null;
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

/** What a finishing run carries into the ledger when it is enrolled. */
export interface RunEnrollment {
  proposalId: string;
  experimentVariant: Cohort;
  runEpisodeId: string;
}

/**
 * C1 — Reserve a cohort for a run episode BEFORE dispatch.
 *
 * This is the pre-run commitment: it picks the experiment (oldest undecided
 * matching the run's profile), assigns the cohort deterministically, enforces
 * the exposure cap atomically with the reservation, and persists an
 * `ExperimentEnrollment` record keyed by `runEpisodeId`. The terminal hook
 * will later resolve this reservation via `resolveRunEnrollment`.
 *
 * Returns the enrollment if reserved, or null if the run is not eligible
 * (optimizer off, no matching experiment, cap exhausted, profile mismatch).
 */
export async function reserveRunEnrollment(
  runEpisodeId: string,
  profileId: string,
  deps: ExperimentDeps & { policy?: OptimizerPolicy } = {},
): Promise<ExperimentEnrollment | null> {
  const policy =
    deps.policy ??
    parseOptimizerPolicy({
      mode: process.env.RHYTHM_OPTIMIZER_MODE,
      disabledFamilies: process.env.RHYTHM_OPTIMIZER_DISABLED_FAMILIES,
    });
  if (policy.mode === 'off') return null;

  const experimentsRepo = deps.experimentsRepo ?? new AgentOrgExperimentsRepository();
  const undecided = await experimentsRepo.listUndecidedAsync();
  if (undecided.length === 0) return null;

  const profileConfigRepo = new AgentConfigsRepository();
  const targetProfile = profileConfigRepo.getById(profileId);
  if (!targetProfile) return null;
  const targetRevisionFingerprint = buildProfileRevisionFingerprint(targetProfile);

  // Find an experiment whose evidence target matches this run's profile.
  // In C1 we filter by profileId; C2 will also require the treatment adapter
  // to support the experiment's proposal shape.
  const match = findEligibleExperiment(undecided, profileId, targetRevisionFingerprint);
  const experiment = match?.experiment;
  if (!experiment) return null;

  const enrollmentsRepo = new AgentOrgExperimentEnrollmentsRepository();

  // Deterministic cohort assignment.
  const assignment = assignSubject({
    assignmentKey: experiment.assignmentKey,
    maxExposure: experiment.maxExposure,
    currentExposure: 0,
    subjectId: runEpisodeId,
  });
  if (assignment.status === 'refused') return null;

  const { baselineTargetRevisionHash, treatmentSpecHash } = buildHashes({
    targetRevisionFingerprint: match.targetRevisionFingerprint,
    treatmentSpec: match!.candidateSpec,
  });

  // Persist the enrollment reservation.
  const enrollment = await enrollmentsRepo.reserveAsync({
    maxExposure: experiment.maxExposure,
    runEpisodeId,
    experimentId: experiment.id,
    proposalId: experiment.proposalId,
    profileId,
    cohort: assignment.cohort,
    assignmentDigest: createHash('sha256')
      .update(`${experiment.assignmentKey}:${runEpisodeId}`)
      .digest('hex'),
    baselineTargetRevisionHash,
    treatmentSpecHash,
  });

  return enrollment;
}

/**
 * C1 — Resolve a preexisting enrollment at FINALIZATION.
 *
 * Reads the enrollment record created by `reserveRunEnrollment` (never
 * invents one). The ledger row written here carries the cohort from the
 * reservation, not from a fresh assignment. This guarantees the cohort
 * cannot change between dispatch and finalization.
 */
export async function resolveRunEnrollment(
  runEpisodeId: string,
  deps: ExperimentDeps & { policy?: OptimizerPolicy } = {},
): Promise<RunEnrollment | null> {
  try {
    const policy =
      deps.policy ??
      parseOptimizerPolicy({
        mode: process.env.RHYTHM_OPTIMIZER_MODE,
        disabledFamilies: process.env.RHYTHM_OPTIMIZER_DISABLED_FAMILIES,
      });
    if (policy.mode === 'off') return null;

    const enrollmentsRepo = new AgentOrgExperimentEnrollmentsRepository();
    const enrollment = await enrollmentsRepo.findByRunEpisodeIdAsync(runEpisodeId);
    if (!enrollment) return null;

    // Verify the enrollment is still for an undecided experiment.
    const experimentsRepo = deps.experimentsRepo ?? new AgentOrgExperimentsRepository();
    const experiment = await experimentsRepo.findByIdAsync(enrollment.experimentId);
    if (!experiment || experiment.decision) return null;

    return {
      proposalId: enrollment.proposalId,
      experimentVariant: enrollment.cohort,
      runEpisodeId: enrollment.runEpisodeId,
    };
  } catch (err) {
    logger.warn(
      `[org-proposal-experiment] run enrollment resolution skipped for '${runEpisodeId}' (non-fatal): ${String(err)}`,
    );
    return null;
  }
}

/**
 * C1-B2 / #737: transition the reservation to dispatched.
 *
 * The reservation write must remain observable to the caller. Any repository
 * error is intentionally surfaced (including `missing`), so the runner can fail
 * closed rather than silently dispatching when transition state is unknown.
 */
export async function markRunEnrollmentDispatched(
  runEpisodeId: string,
): Promise<ReturnType<AgentOrgExperimentEnrollmentsRepository['markDispatchedAsync']>> {
  const enrollmentsRepo = new AgentOrgExperimentEnrollmentsRepository();
  return enrollmentsRepo.markDispatchedAsync(runEpisodeId);
}

/**
 * C1-B2 / #737: transition reserved rows to pre-dispatch-failed.
 *
 * Uses the accepted code-only API so downstream reasoning never persists
 * arbitrary text; failure details are standardized by the enrollment domain.
 */
export async function markRunEnrollmentPreDispatchFailed(
  runEpisodeId: string,
): Promise<ReturnType<AgentOrgExperimentEnrollmentsRepository['markTreatmentFailedAsync']>> {
  const enrollmentsRepo = new AgentOrgExperimentEnrollmentsRepository();
  return enrollmentsRepo.markTreatmentFailedAsync(runEpisodeId, {
    failureCode: 'pre_dispatch_failed',
  });
}

/**
 * C1-B2 / #737: terminalize a dispatched row before ledger finalization.
 *
 * This keeps terminalization independent from outcome finalization so ledger
 * durability issues cannot block experiment lifecycle completion.
 */
export async function markRunEnrollmentTerminalized(
  runEpisodeId: string,
): Promise<ReturnType<AgentOrgExperimentEnrollmentsRepository['markTerminalizedAsync']>> {
  const enrollmentsRepo = new AgentOrgExperimentEnrollmentsRepository();
  return enrollmentsRepo.markTerminalizedAsync(runEpisodeId);
}

/** A terminal verdict — persisted to `agent_org_experiments.decision`. */
export interface ExperimentDecisionResult {
  status: 'decided';
  decision: ExperimentDecision;
  reason: string;
  results: ExperimentResults | null;
}

/**
 * C0 — nonterminal. Distinct from {@link ExperimentDecision}: `collecting`
 * never reaches the DB decision domain (`promote|inconclusive|regress`) and is
 * never persisted. `results` here are recomputable interim numbers for
 * display only — they must never be written into the immutable
 * results/decision columns, because more valid observations may still arrive
 * under `maxExposure`.
 */
export interface ExperimentCollectingResult {
  status: 'collecting';
  reason: string;
  results: ExperimentResults | null;
}

export type ExperimentEvaluation = ExperimentDecisionResult | ExperimentCollectingResult;

function decided(
  decision: ExperimentDecision,
  reason: string,
  results: ExperimentResults | null = null,
): ExperimentEvaluation {
  return { status: 'decided', decision, reason, results };
}

function inconclusive(reason: string, results: ExperimentResults | null = null): ExperimentEvaluation {
  return decided('inconclusive', reason, results);
}

function collecting(reason: string, results: ExperimentResults | null = null): ExperimentEvaluation {
  return { status: 'collecting', reason, results };
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
}): ExperimentEvaluation {
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

  const metric = PRIMARY_METRICS[bundle.primaryMetric.name];
  const results: ExperimentResults = {
    baseline: { sampleCount: baseline.length, primaryMetricValue: metric(baseline) },
    candidate: { sampleCount: candidate.length, primaryMetricValue: metric(candidate) },
  };

  // C0 — an empty or undersized cohort is NONTERMINAL. Interim results are
  // recomputable on the next sweep and must never freeze a proposal's
  // outcome while more valid observations may still arrive under
  // `maxExposure`. Only once total eligible exposure reaches `maxExposure`
  // without enough valid observations does this become a real terminal
  // inconclusive, with the final counts and an explicit reason.
  const { minSamplesPerCohort, minEffect } = experiment.stoppingRule;
  const undersized =
    results.baseline.sampleCount < minSamplesPerCohort ||
    results.candidate.sampleCount < minSamplesPerCohort;

  if (undersized) {
    let reason: string;
    if (results.baseline.sampleCount === 0) {
      reason = 'the baseline cohort is empty — nothing to compare against';
    } else if (results.candidate.sampleCount === 0) {
      reason = 'the candidate cohort is empty — nothing to compare';
    } else {
      reason =
        `the predeclared stopping rule is not satisfied: ${results.baseline.sampleCount} baseline / ` +
        `${results.candidate.sampleCount} candidate samples, ${minSamplesPerCohort} required per cohort`;
    }

    const eligibleExposure = results.baseline.sampleCount + results.candidate.sampleCount;
    if (eligibleExposure >= experiment.maxExposure) {
      return inconclusive(
        `terminal: maximum exposure (${eligibleExposure}/${experiment.maxExposure}) reached ` +
          `without enough valid observations — ${reason}`,
        results,
      );
    }
    return collecting(reason, results);
  }

  // `direction` says which way is better; the effect is always signed so that
  // positive means the candidate improved.
  const raw = results.candidate.primaryMetricValue - results.baseline.primaryMetricValue;
  const effect = bundle.primaryMetric.direction === 'increase' ? raw : -raw;
  const summary =
    `${bundle.primaryMetric.name} baseline=${results.baseline.primaryMetricValue} ` +
    `candidate=${results.candidate.primaryMetricValue} effect=${effect.toFixed(4)} ` +
    `(direction=${bundle.primaryMetric.direction}, minEffect=${minEffect})`;

  if (effect >= minEffect) return decided('promote', `promote: ${summary}`, results);
  if (effect <= -minEffect) return decided('regress', `regress: ${summary}`, results);
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
 * C0 — temporary fail-closed promotion gate for PRODUCTION reads only.
 *
 * `decideExperiment` is left alone: paired-cohort-outcome's raw comparison is
 * still a real, testable decision-table result (promote stays reachable
 * there, deliberately, so the pure comparison itself keeps being provable).
 * What this refuses is treating that raw comparison as PROOF outside a test:
 * paired-cohort-outcome randomly splits enrolled runs, but nothing yet
 * applies a differential treatment per run (that is C1/C2) — the proposal's
 * change is already live for the whole population by the time any run
 * enrols. So today a `promote` from this adapter attests that a randomised
 * split of an already-uniform population differed past the stopping rule,
 * which is an A/A result, not a causal effect. Remove this gate only once a
 * receipt-filtered treatment-v2 adapter exists and an experiment's adapter
 * carries it.
 */
function gateProductionPromotion(
  experiment: AgentOrgExperiment,
  evaluation: ExperimentEvaluation,
): ExperimentEvaluation {
  if (
    evaluation.status === 'decided' &&
    evaluation.decision === 'promote' &&
    experiment.adapter === 'paired-cohort-outcome'
  ) {
    return decided(
      'inconclusive',
      `promote refused (C0 fail-closed gate): 'paired-cohort-outcome' has no treatment-v2 ` +
        `receipts yet, so this randomised split cannot be distinguished from an A/A result — ` +
        `${evaluation.reason}`,
      evaluation.results,
    );
  }
  return evaluation;
}

/**
 * Read the cohorts from W4's ledger and decide. Writes NOTHING — this is the
 * whole of the computation, shared by the persisting path below and by the
 * optimizer's shadow-mode report-only sweep, so the two can never drift into
 * disagreeing about what the verdict would have been. Also applies the C0
 * production promotion gate, so shadow's "would decide" report is truthful
 * about what the acting path would actually persist.
 */
export async function computeDecisionAsync(
  experiment: AgentOrgExperiment,
  deps: ExperimentDeps = {},
): Promise<ExperimentEvaluation> {
  const outcomesRepo = deps.outcomesRepo ?? new AgentRunOutcomesRepository();
  const enrolled = await outcomesRepo.listByExperimentAsync(experiment.proposalId);
  const evaluation = decideExperiment({
    experiment,
    baseline: enrolled.filter((o) => o.experimentVariant === 'baseline'),
    candidate: enrolled.filter((o) => o.experimentVariant === 'candidate'),
  });
  return gateProductionPromotion(experiment, evaluation);
}

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
): Promise<ExperimentEvaluation> {
  const experimentsRepo = deps.experimentsRepo ?? new AgentOrgExperimentsRepository();
  const experiment = await experimentsRepo.findByIdAsync(experimentId);
  if (!experiment) {
    return inconclusive(`experiment '${experimentId}' does not exist`);
  }

  // A decided experiment is history. Re-judging it would recompute against a
  // ledger that has moved on, and every re-run bumped the proposal's CAS
  // revision for a fact that did not change.
  if (experiment.decision) {
    return decided(experiment.decision, experiment.decisionReason ?? 'already decided', experiment.results);
  }

  const evaluation = await computeDecisionAsync(experiment, deps);

  // C0 — collecting is nonterminal. Never write results_json,
  // results_recorded_at, decision, decided_at, or the proposal's
  // outcome_status: the experiment stays undecided (`listUndecidedAsync`
  // still returns it) and a future sweep recomputes from scratch against
  // whatever the ledger looks like then.
  if (evaluation.status === 'collecting') {
    return evaluation;
  }

  if (evaluation.results && !experiment.results) {
    await experimentsRepo.recordResultsAsync(experiment.id, evaluation.results);
  }
  await experimentsRepo.recordDecisionAsync(experiment.id, evaluation.decision, evaluation.reason);

  await writeOutcomeStatus(
    experiment.proposalId,
    OUTCOME_BY_DECISION[evaluation.decision],
    deps.proposalsRepo,
  );

  return evaluation;
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
