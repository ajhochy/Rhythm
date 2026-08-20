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

import { env } from '../config/env';
import { logger } from '../utils/logger';
import { parseOptimizerPolicy, type OptimizerPolicy } from './org_optimizer_policy';
import {
  EXPERIMENT_ADAPTERS,
  PRIMARY_METRICS,
  type ProposalEvidenceBundle,
} from '../models/proposal_evidence_bundle';
import {
  EXPLICIT_USER_VERDICT_METRIC_NAME,
  computeExplicitUserVerdictRate,
} from '../models/feedback_metric_adapter';
import { evaluateGuardrails } from '../models/guardrail_registry';
import {
  validateSystemPromptV1Spec,
  validateStrictRefineConfigChange,
  resolveEffectiveSystemPrompt,
  type SystemPromptV1TreatmentSpec,
} from '../models/experiment_treatment_adapter';
import type {
  AgentOrgExperiment,
  ExperimentDecision,
  ExperimentResults,
  MissingnessSummary,
} from '../models/agent_org_experiment';
import type { AgentOrgProposal } from '../models/agent_org_proposal';
import type { AgentRunOutcome, UserVerdict } from '../models/agent_run_outcome';
import { AgentOrgExperimentsRepository } from '../repositories/agent_org_experiments_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { AgentRunOutcomesRepository } from '../repositories/agent_run_outcomes_repository';
import { AgentConfigsRepository, type RevisionedAgentConfig } from '../repositories/agent_configs_repository';
import { AgentOrgExperimentEnrollmentsRepository } from '../repositories/agent_org_experiment_enrollments_repository';
import type { ExperimentEnrollment } from '../models/agent_org_experiment_enrollment';
import { validateEvidenceBundle } from './proposal_evidence_validator';
import { parseStrictJson } from './strict_json';
import {
  AgentOrgTreatmentReceiptsRepository,
  type DispatchReceiptResult,
  type FinalizeReceiptMaterial,
} from '../repositories/agent_org_treatment_receipts_repository';

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

/**
 * C5 — exported (was module-private) so proposal_evidence_builder.ts can
 * compute the EXACT SAME target ref this module's own eligibility check
 * (findEligibleExperiment, below) requires. A second, hand-copied
 * implementation of "the target ref" is a landmine the day one drifts from
 * the other; there is exactly one, here.
 */
export function toProfileTargetRef(profileId: string): string {
  return `agent_config:${profileId}`;
}

const SYSTEM_PROMPT_DURABLE_FINGERPRINT_NULL_SENTINEL = '__system-prompt-null__';

/**
 * C5 — exported for the same reason as {@link toProfileTargetRef}: the
 * evidence builder must fill `target.hash` with the EXACT fingerprint this
 * module's eligibility check (`findEligibleExperiment`) will later recompute
 * and compare against — reusing this function is what makes that equality
 * possible at all, rather than hoping two independent hash implementations
 * never diverge.
 */
export function buildProfileRevisionFingerprint(profile: { id: string; revision: number; systemPrompt: string | null }): string {
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

/**
 * C2-B — a reservable/preparable system-prompt-v1 treatment must be backed by
 * an EXACT strict `refine-config` proposal row, not merely by an experiment
 * whose baseline/candidate specs happen to validate and whose evidence hash
 * happens to collide. Checks, in order:
 *
 *   1. `kind` is exactly `refine-config`;
 *   2. `targetRef` is exactly `agent_config:<profileId>`;
 *   3. `changeJson` parses with {@link parseStrictJson} (duplicate-key
 *      rejecting) into the exact strict shape {@link validateStrictRefineConfigChange}
 *      accepts — outer `configPatch` only, inner exactly
 *      `{ agentConfigId, field, value }`, no smuggled keys anywhere;
 *   4. the patch's `agentConfigId` is the exact profile and `value` is the
 *      exact candidate value the treatment spec declares.
 *
 * Never throws: any parse/shape/lookup failure is a plain `false`, so a
 * corrupted or unrelated proposal fails the binding closed rather than
 * surfacing as an unhandled rejection on a hot path.
 */
async function validateProposalTreatmentBinding(
  proposalsRepo: AgentOrgProposalsRepository,
  proposalId: string,
  expectedProfileId: string,
  expectedCandidateValue: string,
): Promise<boolean> {
  let proposal: AgentOrgProposal | null;
  try {
    proposal = await proposalsRepo.findByIdAsync(proposalId);
  } catch {
    return false;
  }
  if (!proposal) return false;
  if (proposal.kind !== 'refine-config') return false;
  if (proposal.targetRef !== toProfileTargetRef(expectedProfileId)) return false;

  let parsedChange: unknown;
  try {
    parsedChange = parseStrictJson(proposal.changeJson ?? '', 'changeJson');
  } catch {
    return false;
  }
  const validation = validateStrictRefineConfigChange(parsedChange);
  if (!validation.valid) return false;
  if (validation.patch.agentConfigId !== expectedProfileId) return false;
  if (validation.patch.value !== expectedCandidateValue) return false;
  return true;
}

/**
 * C2-B — bind spec CONTENT to the durable target, not merely its hash: the
 * baseline cohort's effective prompt (`currentValue`) and the candidate
 * spec's `priorValue`/`currentValue` must equal the profile's CURRENT durable
 * `systemPrompt` exactly. This is defense in depth alongside the fingerprint
 * hash equality already enforced elsewhere — a spec whose declared "current"
 * text silently diverged from the real row can never bind.
 */
function specsBindToDurableSystemPrompt(
  baselineSpec: SystemPromptV1TreatmentSpec,
  candidateSpec: SystemPromptV1TreatmentSpec,
  durableSystemPrompt: string | null,
): boolean {
  return (
    baselineSpec.currentValue === durableSystemPrompt &&
    candidateSpec.priorValue === durableSystemPrompt &&
    candidateSpec.currentValue === durableSystemPrompt
  );
}

async function findEligibleExperiment(
  experiments: AgentOrgExperiment[],
  profileId: string,
  targetProfile: RevisionedAgentConfig,
  targetRevisionFingerprint: string,
  proposalsRepo: AgentOrgProposalsRepository,
): Promise<EligibleExperimentMatch | null> {
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
    if (!specsBindToDurableSystemPrompt(baselineSpec.spec, candidateSpec.spec, targetProfile.systemPrompt)) {
      continue;
    }
    const boundToProposal = await validateProposalTreatmentBinding(
      proposalsRepo,
      experiment.proposalId,
      profileId,
      candidateSpec.spec.candidateValue,
    );
    if (!boundToProposal) continue;

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

/**
 * C3 — evaluate an eligible experiment's DECLARED guardrails (closed
 * registry, guardrail_registry.ts) against its receipt-backed outcomes and
 * enrollment history. A breach stops new enrollment: it records a terminal
 * `regress` decision (idempotent — a race that beats this to
 * `recordDecisionAsync` just means the experiment was already stopped, which
 * is the same outcome) and returns true so the caller refuses to reserve.
 * Never mutates the durable target — this is a ledger/decision write only.
 *
 * Fails OPEN on an internal error (a DB read failing here is a transient
 * fault, not a proven breach) — matching `resolveRunEnrollment`'s posture of
 * "non-fatal, log and continue" for the same class of failure.
 */
async function guardrailsBreachedAsync(
  match: EligibleExperimentMatch,
  deps: ExperimentDeps,
): Promise<boolean> {
  try {
    const outcomesRepo = deps.outcomesRepo ?? new AgentRunOutcomesRepository();
    const enrollmentsRepo = new AgentOrgExperimentEnrollmentsRepository();
    const [outcomes, enrollments] = await Promise.all([
      outcomesRepo.listReceiptBackedByExperimentAsync(match.experiment.id, match.experiment.proposalId),
      enrollmentsRepo.listByExperimentAsync(match.experiment.id),
    ]);
    const evaluations = evaluateGuardrails(match.evidenceBundle.guardrails, {
      outcomes,
      enrollments,
      minSampleCount: match.experiment.stoppingRule.minSamplesPerCohort,
    });
    const breach = evaluations.find((e) => e.breached);
    if (!breach) return false;

    const experimentsRepo = deps.experimentsRepo ?? new AgentOrgExperimentsRepository();
    await experimentsRepo
      .recordDecisionAsync(
        match.experiment.id,
        'regress',
        `guardrail '${breach.guardrail}' breached: rate=${breach.rate.toFixed(4)} over ${breach.sampleCount} samples`,
      )
      .catch(() => {
        // Already decided by a racing check (or a prior sweep) — the
        // experiment is stopped either way, which is all this call needs.
      });
    await writeOutcomeStatus(match.experiment.proposalId, 'regressed', deps.proposalsRepo).catch(() => {});
    return true;
  } catch (err) {
    logger.warn(
      `[org-proposal-experiment] guardrail evaluation skipped for '${match.experiment.id}' (non-fatal): ${String(err)}`,
    );
    return false;
  }
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
  /** C3 — the profile this run's treatment was bound to, off the pre-run reservation. Never a terminal-time guess. */
  profileId: string;
  /**
   * C3 — the durable AgentConfig revision the treatment was actually
   * dispatched against, read from this run episode's OWN finalized treatment
   * receipt (`profileRevision`, never mutated after C2's dispatch-time
   * check). Null when no receipt exists yet (e.g. a reservation that never
   * reached dispatch) — never fabricated.
   */
  configRevision: number | null;
}

/**
 * A run episode ID collided with an ALREADY-BOUND enrollment for a DIFFERENT
 * profile. This is a fail-closed error, never an ordinary ineligibility: a
 * caller catching this must send no prompt and inject no treatment, rather
 * than falling back to dispatching untreated. Carries no raw identifiers (no
 * runEpisodeId, profileId, or hashes) so it is safe to surface in logs/errors
 * verbatim.
 */
export class RunEnrollmentProfileCollisionError extends Error {
  constructor() {
    super(
      'run episode is already enrolled under a different profile — refusing to reuse or reassign it',
    );
    this.name = 'RunEnrollmentProfileCollisionError';
  }
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
 *
 * Throws {@link RunEnrollmentProfileCollisionError} if `runEpisodeId` is
 * already bound to a DIFFERENT profile's enrollment — a confirmed collision,
 * never silently resolved to the wrong profile's binding and never treated as
 * ordinary ineligibility (which would let the caller fall through to an
 * untreated dispatch). The pre-existing enrollment itself is left untouched.
 */
export async function reserveRunEnrollment(
  runEpisodeId: string,
  profileId: string,
  deps: ExperimentDeps & { policy?: OptimizerPolicy } = {},
): Promise<ExperimentEnrollment | null> {
  // C6 item 1 — treatment-v2 ships disabled by default
  // (RHYTHM_TREATMENT_V2_ENABLED). Checked BEFORE the existing-enrollment
  // idempotency lookup below: disabled means "never reserve a new cohort",
  // full stop — not "look up what may already exist". A run dispatched while
  // the flag is off is an ordinary untreated dispatch, never an experiment.
  if (!env.treatmentV2Enabled) return null;

  // Idempotency comes FIRST: `run_episode_id` is UNIQUE and a committed
  // reservation's binding must never be re-derived from whatever the
  // eligibility inputs (policy, target fingerprint, undecided experiments)
  // happen to look like on a later call for the SAME episode — that would
  // silently drop an already-reserved enrollment the moment the target drifts
  // or the optimizer is toggled off, instead of surfacing the drift through
  // prepareReservedTreatment where it belongs.
  const enrollmentsRepo = new AgentOrgExperimentEnrollmentsRepository();
  const existing = await enrollmentsRepo.findByRunEpisodeIdAsync(runEpisodeId);
  if (existing) {
    if (existing.profileId !== profileId) throw new RunEnrollmentProfileCollisionError();
    return existing;
  }

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

  // Find an experiment whose evidence target matches this run's profile and
  // whose treatment specs are backed by an exact strict refine-config
  // proposal row (C2-B) — never an unrelated proposal that merely shares a
  // colliding evidence hash.
  const proposalsRepo = deps.proposalsRepo ?? new AgentOrgProposalsRepository();
  const match = await findEligibleExperiment(
    undecided,
    profileId,
    targetProfile,
    targetRevisionFingerprint,
    proposalsRepo,
  );
  const experiment = match?.experiment;
  if (!experiment) return null;

  // C3 — a breached guardrail stops new enrollment before assignment. The
  // terminal decision this records makes the experiment absent from every
  // FUTURE `listUndecidedAsync()` call on its own, so this check does not
  // need to re-run per reservation once it has fired once.
  if (await guardrailsBreachedAsync(match, deps)) return null;

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

  // `reserveAsync` has its own atomic idempotent read-back for a concurrent
  // insert racing on the same runEpisodeId — re-check here too, so a
  // concurrent DIFFERENT-profile race is fail-closed the same way the
  // up-front idempotency check above is, rather than silently handing back
  // the other profile's binding.
  if (enrollment && enrollment.profileId !== profileId) {
    throw new RunEnrollmentProfileCollisionError();
  }

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
  // C6 item 1 — disabled runs cannot attach experimental outcomes, even if a
  // reservation exists from before the flag was turned off.
  if (!env.treatmentV2Enabled) return null;
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

    // C3 — the config revision the run executed under comes from its OWN
    // finalized treatment receipt, never a terminal-time guess. Absent for a
    // reservation that never reached dispatch.
    const receipt = await new AgentOrgTreatmentReceiptsRepository().findByRunEpisodeIdAsync(runEpisodeId);

    return {
      proposalId: enrollment.proposalId,
      experimentVariant: enrollment.cohort,
      runEpisodeId: enrollment.runEpisodeId,
      profileId: enrollment.profileId,
      configRevision: receipt?.profileRevision ?? null,
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
 * C2-A — the narrow, service-owned pre-dispatch preparation gate.
 *
 * Called AFTER a reservation exists but BEFORE it is marked dispatched. Never
 * trusts the reservation's stored hashes as ground truth on their own — it
 * re-reads the target AgentConfig, recomputes the SAME durable fingerprint
 * `reserveRunEnrollment` used, and only returns 'ready' when every binding the
 * reservation depends on still holds:
 *
 *   1. the target's CURRENT fingerprint equals baselineTargetRevisionHash
 *      (else 'target_drifted' — a confirmed target mismatch, the one case
 *      that earns its own closed failure code);
 *   2. the experiment still exists and its baseline/candidate specs still
 *      validate, still target this exact profile/field, and their evidence
 *      target hash still matches the current fingerprint;
 *   3. the candidate spec's recomputed hash still equals the reservation's
 *      treatmentSpecHash (the immutable binding has not been superseded).
 *
 * Only on 'ready' does the caller learn the effective system prompt — and
 * only for the reservation's OWN cohort, never the other arm's.
 */
/** Safe (never raw-prompt-bearing) material a later phase needs to finalize a receipt. */
export interface TreatmentReceiptMaterial {
  profileRevision: number;
  targetRef: string;
  targetRevisionHash: string;
  treatmentSpecHash: string;
  /** Bare lowercase 64-hex hash of the exact effective system-prompt override. */
  effectivePromptHash: string;
}

export type ReservedTreatmentPreparation =
  | { status: 'ready'; systemPromptOverride: string; receiptMaterial: TreatmentReceiptMaterial }
  | { status: 'target_drifted' }
  | { status: 'invalid_binding' };

export async function prepareReservedTreatment(
  enrollment: ExperimentEnrollment,
  deps: ExperimentDeps = {},
): Promise<ReservedTreatmentPreparation> {
  // C6 item 1 — a reservation made while the flag was on cannot be prepared
  // (or, downstream in commitReservedTreatmentDispatch, committed) once the
  // flag is off. This is the fail-closed path that keeps
  // commitReservedTreatmentDispatch from ever reaching a receipt write for a
  // now-disabled reservation.
  if (!env.treatmentV2Enabled) return { status: 'invalid_binding' };
  try {
    const profile = new AgentConfigsRepository().getById(enrollment.profileId);
    if (!profile) return { status: 'invalid_binding' };

    const currentFingerprint = buildProfileRevisionFingerprint(profile);
    if (currentFingerprint !== enrollment.baselineTargetRevisionHash) {
      return { status: 'target_drifted' };
    }

    const experimentsRepo = deps.experimentsRepo ?? new AgentOrgExperimentsRepository();
    const experiment = await experimentsRepo.findByIdAsync(enrollment.experimentId);
    if (!experiment) return { status: 'invalid_binding' };

    let baselineSpec: ReturnType<typeof validateSystemPromptV1Spec>;
    let candidateSpec: ReturnType<typeof validateSystemPromptV1Spec>;
    try {
      baselineSpec = validateSystemPromptV1Spec(JSON.parse(experiment.baselineSpecJson));
      candidateSpec = validateSystemPromptV1Spec(JSON.parse(experiment.candidateSpecJson));
    } catch {
      return { status: 'invalid_binding' };
    }
    if (!baselineSpec.valid || !candidateSpec.valid) return { status: 'invalid_binding' };

    // Both specs' evidenceTarget must revalidate against the EXACT canonical
    // ref for this reservation's own profile, not just the current hash — a
    // ref pointing at a different (or malformed) target must never be treated
    // as bound to this profile merely because its hash happens to match.
    const expectedRef = toProfileTargetRef(enrollment.profileId);
    if (
      baselineSpec.spec.agentConfigId !== enrollment.profileId ||
      candidateSpec.spec.agentConfigId !== enrollment.profileId ||
      baselineSpec.spec.field !== 'system_prompt' ||
      candidateSpec.spec.field !== 'system_prompt' ||
      baselineSpec.spec.evidenceTarget.ref !== expectedRef ||
      candidateSpec.spec.evidenceTarget.ref !== expectedRef ||
      baselineSpec.spec.evidenceTarget.hash !== currentFingerprint ||
      candidateSpec.spec.evidenceTarget.hash !== currentFingerprint
    ) {
      return { status: 'invalid_binding' };
    }

    const recomputedTreatmentSpecHash = createHash('sha256')
      .update(canonicalizeForHash(candidateSpec.spec))
      .digest('hex');
    if (recomputedTreatmentSpecHash !== enrollment.treatmentSpecHash) {
      return { status: 'invalid_binding' };
    }

    // C2-B — content-bind both specs to the durable target text (defense in
    // depth alongside the fingerprint-hash equality above), and require the
    // experiment's OWN proposal row to be an exact strict refine-config
    // binding for this profile/candidate value. A proposal corrupted (wrong
    // kind/target/shape/value) AFTER a legal reservation fails preparation
    // closed here — no dispatch can occur under an unbound treatment.
    if (!specsBindToDurableSystemPrompt(baselineSpec.spec, candidateSpec.spec, profile.systemPrompt)) {
      return { status: 'invalid_binding' };
    }
    const proposalsRepo = deps.proposalsRepo ?? new AgentOrgProposalsRepository();
    const boundToProposal = await validateProposalTreatmentBinding(
      proposalsRepo,
      experiment.proposalId,
      enrollment.profileId,
      candidateSpec.spec.candidateValue,
    );
    if (!boundToProposal) return { status: 'invalid_binding' };

    const boundSpec = enrollment.cohort === 'baseline' ? baselineSpec.spec : candidateSpec.spec;
    const systemPromptOverride = resolveEffectiveSystemPrompt(boundSpec, enrollment.cohort);
    return {
      status: 'ready',
      systemPromptOverride,
      receiptMaterial: {
        profileRevision: profile.revision,
        targetRef: expectedRef,
        targetRevisionHash: currentFingerprint,
        treatmentSpecHash: enrollment.treatmentSpecHash,
        effectivePromptHash: createHash('sha256').update(systemPromptOverride).digest('hex'),
      },
    };
  } catch {
    // A storage/parser dependency error can carry arbitrary bytes (including
    // raw prompt/system-prompt content echoed back by a driver) — never
    // interpolate it into a log line. The closed message below is sufficient
    // to classify the failure without risking a leak on this safety path.
    logger.warn(
      `[org-proposal-experiment] treatment preparation failed for '${enrollment.runEpisodeId}' (non-fatal)`,
    );
    return { status: 'invalid_binding' };
  }
}

/**
 * C2-A: terminalize a reserved row as a confirmed target-drift failure. Kept
 * distinct from `markRunEnrollmentPreDispatchFailed` so the one closed reason
 * that means "the target moved" is never conflated with the generic
 * pre-dispatch failure bucket.
 */
export async function markRunEnrollmentTargetDrifted(
  runEpisodeId: string,
): Promise<ReturnType<AgentOrgExperimentEnrollmentsRepository['markTreatmentFailedAsync']>> {
  const enrollmentsRepo = new AgentOrgExperimentEnrollmentsRepository();
  return enrollmentsRepo.markTreatmentFailedAsync(runEpisodeId, {
    failureCode: 'target_drifted',
  });
}

/** C2-C — a closed reason code only; never carries profile/run/prompt/hash bytes. */
export type TreatmentDispatchCommitFailureReason = 'target_drifted' | 'pre_dispatch_failed';

/**
 * C2-C — thrown by {@link commitReservedTreatmentDispatch}. The message is a
 * fixed, canonical string keyed only on the closed reason code — never the
 * caller's enrollment/profile/prompt/hash bytes or a wrapped driver error.
 */
export class TreatmentDispatchCommitError extends Error {
  constructor(readonly reason: TreatmentDispatchCommitFailureReason) {
    super(`AgentRunner: treatment dispatch commit failed (${reason})`);
    this.name = 'TreatmentDispatchCommitError';
  }
}

/** Safe identity of a committed receipt — never prompt/hash-adjacent secrets beyond what's already public. */
export interface CommittedTreatmentReceipt {
  id: string;
  runEpisodeId: string;
  cohort: Cohort;
  finalizedAt: string;
}

export interface TreatmentDispatchCommitDeps extends ExperimentDeps {
  receiptsRepo?: AgentOrgTreatmentReceiptsRepository;
}

function receiptMaterialsEqual(a: TreatmentReceiptMaterial, b: TreatmentReceiptMaterial): boolean {
  return (
    a.profileRevision === b.profileRevision &&
    a.targetRef === b.targetRef &&
    a.targetRevisionHash === b.targetRevisionHash &&
    a.treatmentSpecHash === b.treatmentSpecHash &&
    a.effectivePromptHash === b.effectivePromptHash
  );
}

/**
 * C2-C — the ONLY place a reserved enrollment may become `dispatched` with a
 * durable receipt. This is meant to be wired as the real prompt-dispatch
 * boundary's `beforeDispatch` hook (see OpencodeClientService.prompt /
 * promptAsync): it runs AFTER the exact effective system override is already
 * baked into the constructed SDK request and IMMEDIATELY BEFORE the real SDK
 * call, closing the gap between "we prepared a treatment" and "the model saw
 * it" during which the durable target could still drift (skill/memory
 * preface construction, an MCP readiness preflight, session creation, etc.
 * all run in between).
 *
 * Re-runs `prepareReservedTreatment` FRESH against the durable
 * profile/proposal/spec — the caller's `initialPreparation` is never trusted
 * as still-current on its own — and requires the fresh result to reproduce
 * the caller's `initialPreparation` EXACTLY (byte-equal system override, and
 * every safe receiptMaterial field equal). Any drift, corruption, or
 * mismatch fails closed and marks the reservation terminal; NOTHING here
 * ever re-reads or trusts a caller-supplied `opts.experimentTreatment` — a
 * real reservation's binding comes ONLY from the enrollment + durable
 * target.
 *
 * On success, `dispatchAndFinalizeReceiptAsync` performs the atomic
 * reserved -> dispatched transition AND the immutable receipt insert in one
 * transaction; only 'applied' (first commit) or 'idempotent' (exact retry)
 * count as success. Returns only safe receipt identity. Every failure path
 * throws {@link TreatmentDispatchCommitError} — a closed, generic error with
 * no profile/run/prompt/hash bytes — so the boundary hook's contract ("a
 * throwing hook blocks the SDK call") stops dispatch cleanly.
 */
export async function commitReservedTreatmentDispatch(
  enrollment: ExperimentEnrollment,
  initialPreparation: Extract<ReservedTreatmentPreparation, { status: 'ready' }>,
  deps: TreatmentDispatchCommitDeps = {},
): Promise<CommittedTreatmentReceipt> {
  let fresh: ReservedTreatmentPreparation;
  try {
    fresh = await prepareReservedTreatment(enrollment, deps);
  } catch {
    await markRunEnrollmentPreDispatchFailed(enrollment.runEpisodeId).catch(() => {});
    throw new TreatmentDispatchCommitError('pre_dispatch_failed');
  }

  if (fresh.status === 'target_drifted') {
    await markRunEnrollmentTargetDrifted(enrollment.runEpisodeId).catch(() => {});
    throw new TreatmentDispatchCommitError('target_drifted');
  }
  if (fresh.status !== 'ready') {
    await markRunEnrollmentPreDispatchFailed(enrollment.runEpisodeId).catch(() => {});
    throw new TreatmentDispatchCommitError('pre_dispatch_failed');
  }

  const reproducesInitialPreparation =
    fresh.systemPromptOverride === initialPreparation.systemPromptOverride &&
    receiptMaterialsEqual(fresh.receiptMaterial, initialPreparation.receiptMaterial);
  if (!reproducesInitialPreparation) {
    // The durable target/spec moved between the initial (early) preparation
    // and this real dispatch-boundary re-verification — the same class of
    // failure `prepareReservedTreatment` itself calls `target_drifted`.
    await markRunEnrollmentTargetDrifted(enrollment.runEpisodeId).catch(() => {});
    throw new TreatmentDispatchCommitError('target_drifted');
  }

  const receiptsRepo = deps.receiptsRepo ?? new AgentOrgTreatmentReceiptsRepository();
  const material: FinalizeReceiptMaterial = fresh.receiptMaterial;
  let result: DispatchReceiptResult;
  try {
    result = await receiptsRepo.dispatchAndFinalizeReceiptAsync(enrollment.runEpisodeId, material);
  } catch {
    await markRunEnrollmentPreDispatchFailed(enrollment.runEpisodeId).catch(() => {});
    throw new TreatmentDispatchCommitError('pre_dispatch_failed');
  }

  if ((result.status !== 'applied' && result.status !== 'idempotent') || !result.receipt) {
    await markRunEnrollmentPreDispatchFailed(enrollment.runEpisodeId).catch(() => {});
    throw new TreatmentDispatchCommitError('pre_dispatch_failed');
  }

  return {
    id: result.receipt.id,
    runEpisodeId: result.receipt.runEpisodeId,
    cohort: result.receipt.cohort,
    finalizedAt: result.receipt.finalizedAt,
  };
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
 * C4 — the fixed-horizon v2 stopping rule's predeclared confidence
 * criterion (docs/ai/contracts/issue-causal-runtime-v2.json, phase C4).
 * Closed and immutable, matching EXPERIMENT_ADAPTERS/GUARDRAIL_REGISTRY's
 * style: NOT a per-bundle or per-experiment declared value. A point
 * estimate crossing `minEffect` is not enough on its own — without also
 * requiring statistical significance at a fixed, predeclared level, ANY
 * interim look that happens to cross `minEffect` by sampling noise would
 * promote, which is exactly the "optional stopping" failure mode a real
 * experiment must refuse.
 *
 * ponytail: a fixed 95% (z=1.96), not per-bundle configurable — upgrade to a
 * declared bundle field if a real proposal ever needs a different level.
 */
const FIXED_HORIZON_CONFIDENCE_LEVEL = 0.95;
const FIXED_HORIZON_Z_CRITICAL = 1.96;

/**
 * C4 — versioned so a stored decision can always be traced to the exact
 * deterministic procedure that produced it. Bump this string (never mutate
 * the math behind an already-shipped version) if the procedure ever changes.
 */
const ANALYSIS_VERSION = 'fixed-horizon-v2-normal-approx-1';

/**
 * C4 — deterministic effect + uncertainty for a two-cohort comparison,
 * suitable for both a strictly binary metric (objective-success-rate,
 * terminal-error-rate: every observation is 0 or 1) and the bounded
 * 0/0.5/1 explicit-user-verdict-rate scale, WITHOUT a stats-library
 * dependency.
 *
 * For any [0,1]-bounded random variable with mean `p`, Popoviciu's
 * inequality bounds its variance by `p(1-p)` (the maximum, achieved by a
 * two-point {0,1} distribution) — the exact variance a strictly Bernoulli
 * metric has, and a CONSERVATIVE (never understated) bound for the
 * 0/0.5/1 metric. Using `p(1-p)/n` as each cohort's variance-of-the-mean is
 * therefore the same standard error a two-proportion z-test would use, and
 * never overstates significance for a bounded non-binary metric.
 */
function computeFixedHorizonAnalysis(input: {
  baselineP: number;
  baselineN: number;
  candidateP: number;
  candidateN: number;
  direction: 'increase' | 'decrease';
}): {
  effect: number;
  standardError: number;
  ciLower: number;
  ciUpper: number;
  significant: boolean;
} {
  const varianceBound = (p: number): number => p * (1 - p);
  const standardError = Math.sqrt(
    varianceBound(input.baselineP) / input.baselineN +
      varianceBound(input.candidateP) / input.candidateN,
  );
  const raw = input.candidateP - input.baselineP;
  const effect = input.direction === 'increase' ? raw : -raw;
  // A zero standard error means every observation in BOTH cohorts landed on
  // the same extreme (both cohorts entirely 0 or entirely 1) — there is no
  // sampling variability left to test against, so any nonzero effect is as
  // significant as this procedure can certify; a zero effect is never
  // significant regardless of sample size.
  const significant =
    standardError === 0 ? effect !== 0 : Math.abs(effect) / standardError >= FIXED_HORIZON_Z_CRITICAL;
  const marginOfError = standardError === 0 ? 0 : FIXED_HORIZON_Z_CRITICAL * standardError;
  return {
    effect,
    standardError,
    ciLower: effect - marginOfError,
    ciUpper: effect + marginOfError,
    significant,
  };
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
  /**
   * C3 — the latest explicit-user verdict per root session, keyed by
   * `rootSessionId`. Only consulted when the bundle's `primaryMetric.name`
   * is `explicit-user-verdict-rate`; a run absent from this map is read as
   * "no response", never a score. Omit entirely for objective metrics.
   */
  explicitUserVerdicts?: ReadonlyMap<string, UserVerdict>;
}): ExperimentEvaluation {
  const { experiment, baseline, candidate, explicitUserVerdicts } = input;

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

  // C3 — `explicit-user-verdict-rate` reads the append-only FEEDBACK stream
  // instead of objective evidence, so it needs its own resolution path (it is
  // never added to PRIMARY_METRICS, which is fixed to `(cohort:
  // AgentRunOutcome[]) => number`). `responseRate` is tracked per cohort so a
  // material imbalance between arms can refuse promotion below, and a
  // response rate below the bundle's predeclared minimum coverage makes the
  // metric value itself unavailable (never zero, never guessed).
  const isFeedbackMetric = bundle.primaryMetric.name === EXPLICIT_USER_VERDICT_METRIC_NAME;
  let results: ExperimentResults;
  let baselineResponseRate: number | null = null;
  let candidateResponseRate: number | null = null;
  let metricUnavailableReason: string | null = null;

  if (isFeedbackMetric) {
    const minCoverage = bundle.primaryMetric.minResponseCoverage ?? 1;
    const verdictsOf = (cohort: AgentRunOutcome[]): Array<UserVerdict | null> =>
      cohort.map((o) => explicitUserVerdicts?.get(o.rootSessionId) ?? null);
    const baselineMetric = computeExplicitUserVerdictRate(verdictsOf(baseline), minCoverage);
    const candidateMetric = computeExplicitUserVerdictRate(verdictsOf(candidate), minCoverage);
    baselineResponseRate = baselineMetric.responseRate;
    candidateResponseRate = candidateMetric.responseRate;
    results = {
      baseline: {
        sampleCount: baseline.length,
        primaryMetricValue: baselineMetric.value ?? 0,
        responseRate: baselineMetric.responseRate,
      },
      candidate: {
        sampleCount: candidate.length,
        primaryMetricValue: candidateMetric.value ?? 0,
        responseRate: candidateMetric.responseRate,
      },
    };
    if (baselineMetric.value === null || candidateMetric.value === null) {
      metricUnavailableReason =
        `explicit-user-verdict-rate is unavailable: baseline response rate ` +
        `${(baselineMetric.responseRate * 100).toFixed(1)}%, candidate response rate ` +
        `${(candidateMetric.responseRate * 100).toFixed(1)}%, minimum required ` +
        `${(minCoverage * 100).toFixed(1)}%`;
    }
  } else {
    const metric = PRIMARY_METRICS[bundle.primaryMetric.name];
    results = {
      baseline: { sampleCount: baseline.length, primaryMetricValue: metric(baseline) },
      candidate: { sampleCount: candidate.length, primaryMetricValue: metric(candidate) },
    };
  }

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

  // C3 — the feedback metric can go silent even once the SAMPLE floor is
  // met (enough runs, not enough responses). Below the predeclared minimum
  // response coverage the metric value itself is unavailable — collecting
  // while more responses may still arrive, terminal inconclusive once
  // `maxExposure` is reached, exactly mirroring the undersized-sample
  // handling above, just gated on responses instead of runs.
  if (metricUnavailableReason) {
    const eligibleExposure = results.baseline.sampleCount + results.candidate.sampleCount;
    if (eligibleExposure >= experiment.maxExposure) {
      return inconclusive(
        `terminal: maximum exposure (${eligibleExposure}/${experiment.maxExposure}) reached — ` +
          metricUnavailableReason,
        results,
      );
    }
    return collecting(metricUnavailableReason, results);
  }

  // C3 — refuse promotion on a MATERIAL response-rate imbalance between
  // arms: differential non-response is exactly the kind of confound
  // (differential attrition) that can make an average-of-responders
  // comparison meaningless even when each arm's own average looks fine.
  // Always inconclusive, never regress — an imbalance is a data-quality
  // problem, not evidence the candidate is worse.
  //
  // ponytail: a fixed 0.2 (20 percentage points) ceiling, not per-bundle
  // configurable — upgrade to a declared bundle field if a real proposal
  // ever needs a different bar.
  const RESPONSE_RATE_IMBALANCE_MAX = 0.2;
  if (
    baselineResponseRate !== null &&
    candidateResponseRate !== null &&
    Math.abs(baselineResponseRate - candidateResponseRate) > RESPONSE_RATE_IMBALANCE_MAX
  ) {
    return inconclusive(
      `promotion refused: material response-rate imbalance between arms (baseline ` +
        `${(baselineResponseRate * 100).toFixed(1)}%, candidate ${(candidateResponseRate * 100).toFixed(1)}%)`,
      results,
    );
  }

  // C4 — the fixed-horizon v2 decision: a deterministic, versioned effect +
  // uncertainty computation, not a bare point-estimate comparison. A point
  // estimate crossing minEffect is necessary but never sufficient on its
  // own — this is exactly the "peek once, happen to clear the bar" failure
  // mode a real experiment must not reward. Only an effect that ALSO clears
  // the predeclared, closed confidence criterion may promote or regress;
  // `direction` says which way is better, and `effect` is always signed so
  // that positive means the candidate improved.
  const analysis = computeFixedHorizonAnalysis({
    baselineP: results.baseline.primaryMetricValue,
    baselineN: results.baseline.sampleCount,
    candidateP: results.candidate.primaryMetricValue,
    candidateN: results.candidate.sampleCount,
    direction: bundle.primaryMetric.direction,
  });
  const resultsWithAnalysis: ExperimentResults = {
    ...results,
    analysisVersion: ANALYSIS_VERSION,
    confidenceLevel: FIXED_HORIZON_CONFIDENCE_LEVEL,
    effect: analysis.effect,
    standardError: analysis.standardError,
    ciLower: analysis.ciLower,
    ciUpper: analysis.ciUpper,
  };
  const summary =
    `${bundle.primaryMetric.name} baseline=${results.baseline.primaryMetricValue} ` +
    `candidate=${results.candidate.primaryMetricValue} effect=${analysis.effect.toFixed(4)} ` +
    `(direction=${bundle.primaryMetric.direction}, minEffect=${minEffect}, ` +
    `confidence=${FIXED_HORIZON_CONFIDENCE_LEVEL})`;

  if (analysis.effect >= minEffect) {
    if (analysis.significant) return decided('promote', `promote: ${summary}`, resultsWithAnalysis);
    return inconclusive(
      `the effect meets the predeclared minimum but is not statistically significant at the ` +
        `predeclared ${(FIXED_HORIZON_CONFIDENCE_LEVEL * 100).toFixed(0)}% confidence level: ${summary}`,
      resultsWithAnalysis,
    );
  }
  if (analysis.effect <= -minEffect) {
    if (analysis.significant) return decided('regress', `regress: ${summary}`, resultsWithAnalysis);
    return inconclusive(
      `the effect meets the predeclared minimum but is not statistically significant at the ` +
        `predeclared ${(FIXED_HORIZON_CONFIDENCE_LEVEL * 100).toFixed(0)}% confidence level: ${summary}`,
      resultsWithAnalysis,
    );
  }
  return inconclusive(
    `the move is smaller than the predeclared minimum effect: ${summary}`,
    resultsWithAnalysis,
  );
}

/** How a decision maps onto the proposal's OUTCOME field (never its status). */
const OUTCOME_BY_DECISION = {
  promote: 'verified',
  regress: 'regressed',
  inconclusive: 'inconclusive',
} as const;

/**
 * C3 — peek at a bundle's `primaryMetric.name` (WITHOUT the full validator —
 * `decideExperiment` runs that itself) purely to decide whether fetching
 * feedback is worth it. A broken/foreign bundle here just means "don't
 * bother fetching feedback"; `decideExperiment`'s own validation still
 * produces the correct refusal either way.
 */
async function resolveExplicitUserVerdictsIfNeeded(
  experiment: AgentOrgExperiment,
  outcomes: AgentRunOutcome[],
  outcomesRepo: AgentRunOutcomesRepository,
): Promise<ReadonlyMap<string, UserVerdict> | undefined> {
  try {
    const parsed = JSON.parse(experiment.evidenceBundleJson) as { primaryMetric?: { name?: unknown } };
    if (parsed?.primaryMetric?.name !== EXPLICIT_USER_VERDICT_METRIC_NAME) return undefined;
  } catch {
    return undefined;
  }
  if (outcomes.length === 0) return new Map();
  return outcomesRepo.listLatestExplicitUserVerdictsAsync(outcomes.map((o) => o.rootSessionId));
}

/**
 * C3 — promote is real only once RECEIPT-BACKED (treatment-v2) cohorts
 * INDEPENDENTLY reproduce it against the SAME predeclared stopping rule.
 *
 * `decideExperiment` is left alone: paired-cohort-outcome's raw comparison
 * over the UNFILTERED ledger is still a real, testable decision-table result
 * (promote/regress/inconclusive all stay reachable there, deliberately, so
 * the pure comparison itself keeps being provable and regress/inconclusive
 * stay reachable through the normal sweep without needing receipts to exist
 * yet). What this refuses is treating an UNFILTERED promote as PROOF: absent
 * real treatment-v2 receipts proving BOTH cohorts actually received their
 * bound treatment, a `promote` from this adapter cannot be told apart from
 * an A/A result. Once receipt-backed cohorts reproduce the SAME promote
 * outcome under the SAME stopping rule, this is causal enough to verify.
 */
/**
 * C4 — fixed thresholds for the sample-integrity checks a receipt-backed
 * promote must ALSO clear, on top of statistical significance. Any breach
 * means the sample cannot be trusted for a causal verdict, so promotion is
 * refused (pushed to inconclusive) rather than silently promoted through a
 * compromised sample.
 *
 * ponytail: fixed constants, matching GUARDRAIL_REGISTRY's closed/fixed
 * style — not per-bundle configurable. Upgrade to a declared bundle field if
 * a real proposal ever needs different bounds.
 */
const SAMPLE_RATIO_MIN = 0.5;
const MAX_MISSING_OUTCOME_RATE = 0.3;

/**
 * C4 — detect a compromised receipt-backed sample: cohort sizes diverging
 * far from the declared 1:1 assignment (assignCohort is an even/odd split),
 * an excessive share of enrolled runs never producing a receipt-backed
 * outcome, or a receipt-backed outcome whose ledger cohort disagrees with
 * its OWN enrollment's reserved cohort (a data-integrity failure that would
 * otherwise silently mislabel a sample). Any hit blocks promotion.
 */
async function checkSampleIntegrityAsync(
  experiment: AgentOrgExperiment,
  receiptBaseline: AgentRunOutcome[],
  receiptCandidate: AgentRunOutcome[],
): Promise<{ failure: string | null; missingness: MissingnessSummary }> {
  const enrollmentsRepo = new AgentOrgExperimentEnrollmentsRepository();
  const enrollments = await enrollmentsRepo.listByExperimentAsync(experiment.id);
  const baselineEnrolled = enrollments.filter((e) => e.cohort === 'baseline').length;
  const candidateEnrolled = enrollments.filter((e) => e.cohort === 'candidate').length;
  const missingness: MissingnessSummary = {
    baselineEnrolled,
    baselineMissing: Math.max(0, baselineEnrolled - receiptBaseline.length),
    candidateEnrolled,
    candidateMissing: Math.max(0, candidateEnrolled - receiptCandidate.length),
  };

  const nBaseline = receiptBaseline.length;
  const nCandidate = receiptCandidate.length;
  const larger = Math.max(nBaseline, nCandidate);
  const smaller = Math.min(nBaseline, nCandidate);
  if (larger > 0 && smaller / larger < SAMPLE_RATIO_MIN) {
    return {
      failure:
        `sample-ratio mismatch: baseline=${nBaseline} candidate=${nCandidate} diverges from ` +
        'the declared 1:1 assignment',
      missingness,
    };
  }

  const enrolledTotal = baselineEnrolled + candidateEnrolled;
  const receiptTotal = nBaseline + nCandidate;
  const missingRate = enrolledTotal > 0 ? 1 - receiptTotal / enrolledTotal : 0;
  if (missingRate > MAX_MISSING_OUTCOME_RATE) {
    return {
      failure:
        `excessive missing outcomes: only ${receiptTotal}/${enrolledTotal} enrolled runs ` +
        'produced a receipt-backed outcome',
      missingness,
    };
  }

  const enrollmentByEpisode = new Map(enrollments.map((e) => [e.runEpisodeId, e]));
  for (const outcome of [...receiptBaseline, ...receiptCandidate]) {
    const enrollment = outcome.runEpisodeId ? enrollmentByEpisode.get(outcome.runEpisodeId) : undefined;
    if (enrollment && enrollment.cohort !== outcome.experimentVariant) {
      return {
        failure: 'treatment-receipt mismatch: an outcome\'s ledger cohort disagrees with its own enrollment',
        missingness,
      };
    }
  }

  return { failure: null, missingness };
}

async function gateProductionPromotionAsync(
  experiment: AgentOrgExperiment,
  evaluation: ExperimentEvaluation,
  outcomesRepo: AgentRunOutcomesRepository,
): Promise<ExperimentEvaluation> {
  if (
    evaluation.status !== 'decided' ||
    evaluation.decision !== 'promote' ||
    experiment.adapter !== 'paired-cohort-outcome'
  ) {
    return evaluation;
  }

  const receiptBacked = await outcomesRepo.listReceiptBackedByExperimentAsync(
    experiment.id,
    experiment.proposalId,
  );
  const receiptBaseline = receiptBacked.filter((o) => o.experimentVariant === 'baseline');
  const receiptCandidate = receiptBacked.filter((o) => o.experimentVariant === 'candidate');
  const explicitUserVerdicts = await resolveExplicitUserVerdictsIfNeeded(
    experiment,
    receiptBacked,
    outcomesRepo,
  );
  const receiptEvaluation = decideExperiment({
    experiment,
    baseline: receiptBaseline,
    candidate: receiptCandidate,
    explicitUserVerdicts,
  });
  if (receiptEvaluation.status === 'decided' && receiptEvaluation.decision === 'promote') {
    const integrity = await checkSampleIntegrityAsync(experiment, receiptBaseline, receiptCandidate);
    const resultsWithMissingness = receiptEvaluation.results
      ? { ...receiptEvaluation.results, missingness: integrity.missingness }
      : receiptEvaluation.results;
    if (integrity.failure) {
      return decided(
        'inconclusive',
        `promote refused (C4 sample-integrity gate): ${integrity.failure}`,
        resultsWithMissingness,
      );
    }
    return { ...receiptEvaluation, results: resultsWithMissingness };
  }

  return decided(
    'inconclusive',
    `promote refused (C3 fail-closed gate): 'paired-cohort-outcome' has no treatment-v2 ` +
      `receipt-backed cohorts reproducing this effect — ${evaluation.reason}`,
    evaluation.results,
  );
}

/**
 * Read the cohorts from W4's ledger and decide. Writes NOTHING — this is the
 * whole of the computation, shared by the persisting path below and by the
 * optimizer's shadow-mode report-only sweep, so the two can never drift into
 * disagreeing about what the verdict would have been. Also applies the C3
 * receipt-backed production promotion gate, so shadow's "would decide"
 * report is truthful about what the acting path would actually persist.
 */
export async function computeDecisionAsync(
  experiment: AgentOrgExperiment,
  deps: ExperimentDeps = {},
): Promise<ExperimentEvaluation> {
  const outcomesRepo = deps.outcomesRepo ?? new AgentRunOutcomesRepository();
  const enrolled = await outcomesRepo.listByExperimentAsync(experiment.proposalId);
  const baseline = enrolled.filter((o) => o.experimentVariant === 'baseline');
  const candidate = enrolled.filter((o) => o.experimentVariant === 'candidate');
  const explicitUserVerdicts = await resolveExplicitUserVerdictsIfNeeded(experiment, enrolled, outcomesRepo);
  const evaluation = decideExperiment({ experiment, baseline, candidate, explicitUserVerdicts });
  return gateProductionPromotionAsync(experiment, evaluation, outcomesRepo);
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
    const { recordExperimentDecisionObservationAsync } = await import('./calibration_observation_service');
    await recordExperimentDecisionObservationAsync(experiment);
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
  const decidedExperiment = await experimentsRepo.recordDecisionAsync(experiment.id, evaluation.decision, evaluation.reason);
  const { recordExperimentDecisionObservationAsync } = await import('./calibration_observation_service');
  await recordExperimentDecisionObservationAsync(decidedExperiment);

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
