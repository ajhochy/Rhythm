/**
 * D2.3 (#1433) — the bounded 3-strike auto-repair service.
 *
 * SECOND PASS (independent review): the original design declared a repair
 * "successful" the instant it found no run outcomes at
 * `now + attempt * 1ms` — which is ALWAYS true immediately after a repair in
 * real production timing (no agent turn has run yet), so it was a
 * guaranteed pass regardless of whether the fix actually helped. This
 * rewrite is a durable, evidence-gated state machine:
 *
 *   - `runAutoRepairAsync` processes ONE decision per call (one sweep tick —
 *     see post_apply_lifecycle.ts's `sweepPostApplyLifecycleAsync`, which now
 *     calls it on every tick for a tripped event, not just the first). It
 *     is always safe to call again: every durable transition is read back
 *     from `PostApplyEvent` at the top of the call, never carried in memory
 *     across calls.
 *   - An attempt's config mutation lands, then the event's
 *     `repairRecheckAfter` floor is set. A LATER tick only evaluates the
 *     D2.2 guardrail registry (`evaluateGuardrails`, the SAME registry +
 *     `DEFAULT_MIN_GUARDRAIL_SAMPLE_COUNT` threshold the pre-trip monitor
 *     uses) once enough REAL outcomes exist at/after that floor — "no
 *     evidence yet" always leaves the event exactly where it was (`pending`),
 *     never a success.
 *   - A diagnosis call that throws, times out, or returns null (provider
 *     down / unparseable response) is `deferred` — it consumes NO strike.
 *   - A genuine, parseable diagnosis that isn't actionable (wrong fixType,
 *     an unresolvable/protected patch, a vanished target) DOES consume a
 *     truthful attempt (`repairAttemptCount`), even though it produces no
 *     proposal — `repairProposalIdsJson.length` can be less than
 *     `repairAttemptCount`; the alert trail is honest about how many repairs
 *     were actually applied vs. how many attempts were made.
 *   - Every repair proposal is created (and every config mutation applied)
 *     through an attempt-scoped dedup key
 *     (`post-apply-repair:<proposalId>:attempt:<n>`) with the exact
 *     pre-mutation snapshot recorded on the proposal row BEFORE any mutation
 *     runs. A crash/restart between any two steps resumes from that durable
 *     row — it never re-derives "prior value" from a possibly-already-
 *     mutated live config, and never mutates twice for the same attempt.
 */

import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { AgentRunOutcomesRepository } from '../repositories/agent_run_outcomes_repository';
import { AgentOrgExperimentsRepository } from '../repositories/agent_org_experiments_repository';
import { AgentOrgExperimentEnrollmentsRepository } from '../repositories/agent_org_experiment_enrollments_repository';
import { PostApplyEventsRepository } from '../repositories/post_apply_events_repository';
import { MAX_REPAIR_ATTEMPTS, parseRepairProposalIds, type PostApplyEvent } from '../models/post_apply_event';
import {
  GUARDRAIL_NAMES,
  evaluateGuardrails,
  type GuardrailEvaluation,
  type GuardrailName,
} from '../models/guardrail_registry';
import { classifyProposalRisk } from './org_risk_classifier';
import {
  isConfigFieldSnapshot,
  landConfigFieldWithProjection,
  readAgentConfigField,
  UNSAFE_WHOLE_FIELD_SCOPE_FIELDS,
  type ConfigFieldSnapshot,
} from './org_proposal_apply';
import type { AgentOrgProposal } from '../models/agent_org_proposal';
import { resolveProfileMcpScope } from './agent_profile_scope';
import { resolveCoreCapabilitySurface } from './profile_capability_surface';
import {
  diagnosisToProposalKind,
  type DiagnoseCall,
  type DiagnosisContext,
} from './generators/workflow_signal_generator';
import { CONFIG_PATCH_FIELDS, type ConfigPatch, type DiagnosisResult } from './org_diagnosis_types';
import { DEFAULT_MIN_GUARDRAIL_SAMPLE_COUNT } from './post_apply_monitor';
import { createHash } from 'node:crypto';
import type { WorkflowFailureSignal } from './workflow_failure_signal_extractor';

// ---------------------------------------------------------------------------
// Global auto-revert trigger registry (D2.5 / D2.4 boundary)
// ---------------------------------------------------------------------------

type AutoRevertTrigger = (props: { proposalId: string }) => Promise<void> | void;

let globalAutoRevertTrigger: AutoRevertTrigger | undefined;

export function registerAutoRevertTrigger(
  trigger: AutoRevertTrigger,
): void {
  globalAutoRevertTrigger = trigger;
}

export function resetAutoRevertTriggerForTests(): void {
  globalAutoRevertTrigger = undefined;
}

// ---------------------------------------------------------------------------
// Per-event diagnosis timeout (D2.3, second pass)
// ---------------------------------------------------------------------------

/**
 * ponytail: fixed ceiling on one diagnosis call within one sweep tick. A
 * hung diagnosis (stuck provider call, dead engine) must not block every
 * OTHER tripped event's sweep turn. Upgrade to a per-kind/configurable value
 * if a real deployment needs a different ceiling.
 */
const REPAIR_DIAGNOSIS_TIMEOUT_MS = 45_000;

class RepairDiagnosisTimeoutError extends Error {
  constructor() {
    super('auto-repair diagnosis call exceeded the per-event timeout');
    this.name = 'RepairDiagnosisTimeoutError';
  }
}

/** Race `diagnose(ctx)` against a fixed ceiling; the timeout arm never leaks its timer. */
async function diagnoseWithTimeout(
  diagnose: DiagnoseCall,
  ctx: DiagnosisContext,
  timeoutMs: number,
): Promise<DiagnosisResult | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      diagnose(ctx),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new RepairDiagnosisTimeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** System actor id for a fully-automated apply — mirrors `LOCAL_OPERATOR_ACTOR_ID` in org_proposals_controller.ts. */
const AUTO_REPAIR_ACTOR_ID = 0;

/** One event's per-attempt idempotency key — see this module's doc comment. */
function repairAttemptDedupKey(proposalId: string, attempt: number): string {
  return `post-apply-repair:${proposalId}:attempt:${attempt}`;
}

/**
 * Re-resolve a (fully untrusted) `configPatch` and pin its `agentConfigId` to
 * the event's own failing profile — never the LLM-emitted id. Returns
 * undefined on any malformed shape, a protected scope field, or if the
 * target profile no longer exists. Mirrors `workflow_signal_generator.ts`'s
 * unexported `resolveConfigPatch` (duplicated rather than exported — that
 * module's control flow is intentionally untouched by this issue).
 *
 * The protected-field refusal reuses `UNSAFE_WHOLE_FIELD_SCOPE_FIELDS`
 * (org_proposal_apply.ts) rather than a bespoke field-name check: an
 * unattended repair must never gain authority a refine-config proposal is
 * explicitly denied, and this is the SAME set the human apply/revert paths
 * already use for that exact property, so it can never drift out of sync
 * if that set ever grows.
 */
function resolveRepairConfigPatch(
  raw: unknown,
  agentConfigId: string,
  configsRepo: AgentConfigsRepository,
): ConfigPatch | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.field !== 'string' || !(CONFIG_PATCH_FIELDS as readonly string[]).includes(r.field)) return undefined;
  if ((UNSAFE_WHOLE_FIELD_SCOPE_FIELDS as readonly string[]).includes(r.field)) return undefined;
  if (typeof r.value !== 'string') return undefined;
  if (!configsRepo.getById(agentConfigId)) return undefined;
  return { agentConfigId, field: r.field as ConfigPatch['field'], value: r.value };
}

/** Build the full `DiagnosisContext` the #971 diagnosis lane's `DiagnoseCall` contract requires. */
function buildRepairDiagnosisContext(
  profileId: string,
  configsRepo: AgentConfigsRepository,
  signals: WorkflowFailureSignal[],
): DiagnosisContext {
  const agentConfig = configsRepo.getById(profileId) ?? null;
  return {
    affectedSkill: profileId,
    signals,
    profile: null,
    agentConfig,
    mcpScope: resolveProfileMcpScope(
      agentConfig?.allowedMcpsJson ?? null,
      profileId,
      agentConfig?.label ?? null,
    ),
    coreCapabilities: agentConfig ? resolveCoreCapabilitySurface(agentConfig) : { actions: {}, granted: [] },
    skillBody: null,
    deniedTools: [],
    delegationOutbound: [],
    delegationInbound: [],
    priorAttempts: [],
  };
}

// ---------------------------------------------------------------------------
// Evidence gate — reuses D2.2's exact registry + threshold
// ---------------------------------------------------------------------------

interface RepairEvidenceDeps {
  outcomesRepo: AgentRunOutcomesRepository;
  experimentsRepo: AgentOrgExperimentsRepository;
  enrollmentsRepo: AgentOrgExperimentEnrollmentsRepository;
}

interface RepairEvidenceResult {
  /** True once at least one closed-registry guardrail has enough samples to trust. */
  sufficientEvidence: boolean;
  /** True iff any sufficiently-sampled guardrail is breached. */
  breached: boolean;
  evaluations: GuardrailEvaluation[];
  durableIdsByGuardrail: Record<GuardrailName, string[]>;
}

/**
 * Evaluate the D2.2 guardrail registry against outcomes finalized at/after
 * `recheckAfter` — this attempt's own re-check floor. "No evidence yet"
 * (every applicable guardrail below `DEFAULT_MIN_GUARDRAIL_SAMPLE_COUNT`)
 * reports `sufficientEvidence: false`; the caller must leave the event
 * exactly where it is rather than treat silence as a pass.
 */
async function evaluateRepairEvidence(
  event: PostApplyEvent,
  recheckAfter: string,
  deps: RepairEvidenceDeps,
): Promise<RepairEvidenceResult> {
  const [outcomes, experiments] = await Promise.all([
    deps.outcomesRepo.listByProfileSinceAsync(event.profileId, recheckAfter),
    deps.experimentsRepo.listByProposalAsync(event.proposalId).catch(() => []),
  ]);
  const enrollmentLists = await Promise.all(
    experiments.map((experiment) => deps.enrollmentsRepo.listByExperimentAsync(experiment.id)),
  );
  const enrollments = enrollmentLists.flat();

  const evaluations = evaluateGuardrails(GUARDRAIL_NAMES, {
    outcomes,
    enrollments,
    minSampleCount: DEFAULT_MIN_GUARDRAIL_SAMPLE_COUNT,
  });
  return {
    sufficientEvidence: evaluations.some((e) => e.sampleCount >= DEFAULT_MIN_GUARDRAIL_SAMPLE_COUNT),
    breached: evaluations.some((e) => e.breached),
    evaluations,
    durableIdsByGuardrail: {
      'terminal-error-rate': outcomes.map((outcome) => outcome.id).slice(0, 5),
      'treatment-integrity-failure-rate': enrollments.map((enrollment) => enrollment.id).slice(0, 5),
    },
  };
}

function buildPostApplyRegressionSignals(
  event: PostApplyEvent,
  evidence: RepairEvidenceResult,
): WorkflowFailureSignal[] {
  return evidence.evaluations
    .filter((evaluation) => evaluation.breached && evaluation.sampleCount >= DEFAULT_MIN_GUARDRAIL_SAMPLE_COUNT)
    .map((evaluation) => ({
      category: 'post-apply-regression',
      sessionIds: evidence.durableIdsByGuardrail[evaluation.guardrail],
      agentConfigId: event.profileId,
      count: evaluation.sampleCount,
      confidence: 'high',
      evidence:
        `proposalId=${event.proposalId} guardrail=${evaluation.guardrail} rate=${evaluation.rate} ` +
        `sampleCount=${evaluation.sampleCount} windowStart=${event.monitoringWindowStart} ` +
        `windowEnd=${event.monitoringWindowEnd}`,
      dedupToken: `${event.proposalId}:${evaluation.guardrail}`,
    }));
}

// ---------------------------------------------------------------------------
// Attempt application — idempotent, crash-safe
// ---------------------------------------------------------------------------

interface ApplyAttemptDeps {
  configsRepo: AgentConfigsRepository;
  proposalsRepo: AgentOrgProposalsRepository;
}

/**
 * Land a durable repair proposal's config mutation (idempotent — a no-op
 * write if a prior crashed run already landed it) and, ONLY once the live
 * opencode profile file is confirmed consistent with it
 * ({@link landConfigFieldWithProjection}), claim the proposal `applied`.
 *
 * ROOT-CAUSE FIX (D2 post-apply lifecycle repair): previously this claimed
 * the proposal unconditionally after the DB write, ignoring a
 * `blocked`/`failed`/`missing` projection outcome — so a repair could be
 * recorded as landed while the profile the engine actually serves still
 * reflected the pre-repair value. Returns `'conflict'` (never claims, never
 * double-mutates) whenever the field can't be safely mutated THIS call, or
 * mutated but the projection is not yet settled — either way the proposal
 * stays `proposed` and a later call resumes safely.
 */
async function landAndClaimRepairAttempt(
  proposal: AgentOrgProposal,
  snapshot: ConfigFieldSnapshot,
  deps: ApplyAttemptDeps,
): Promise<{ proposalId: string } | 'conflict'> {
  if (proposal.status === 'proposed') {
    const result = landConfigFieldWithProjection(
      deps.configsRepo,
      snapshot.agentConfigId,
      snapshot.field,
      snapshot.priorValue,
      snapshot.expectedAppliedValue ?? null,
      'config-update',
    );
    if (result.status !== 'landed') return 'conflict';
    // Landed AND confirmed projected — claim exactly once, same order and
    // the same primitive (`claimAppliedWithSnapshotAsync`) the human-approval
    // path (org_proposals_controller.ts's approve()) uses.
    await deps.proposalsRepo.claimAppliedWithSnapshotAsync(
      proposal.id,
      AUTO_REPAIR_ACTOR_ID,
      proposal.beforeSnapshotJson,
      proposal.changeJson,
    );
  }
  return { proposalId: proposal.id };
}

/**
 * Resume a durable repair attempt that already has a dedup-keyed proposal
 * row (created by a prior call, possibly crashed before mutating, claiming,
 * or updating the event) — never re-diagnoses, never mints a second proposal
 * for the same attempt number.
 */
async function resumeRepairAttempt(
  proposal: AgentOrgProposal,
  deps: ApplyAttemptDeps,
): Promise<{ proposalId: string } | 'conflict'> {
  const parsed = proposal.beforeSnapshotJson ? JSON.parse(proposal.beforeSnapshotJson) : null;
  if (!isConfigFieldSnapshot(parsed)) return 'conflict';
  return landAndClaimRepairAttempt(proposal, parsed, deps);
}

/**
 * Create a brand-new repair attempt's durable proposal (snapshotted BEFORE
 * any mutation) from a fresh diagnosis, then land + claim it. Only reached
 * when {@link resumeRepairAttempt}'s dedup-key lookup found nothing for this
 * exact attempt number.
 */
async function createRepairAttempt(
  event: PostApplyEvent,
  attempt: number,
  patch: ConfigPatch,
  diagnosisResult: DiagnosisResult,
  deps: ApplyAttemptDeps,
): Promise<{ proposalId: string } | 'conflict'> {
  const { configsRepo, proposalsRepo } = deps;
  const config = configsRepo.getById(patch.agentConfigId);
  if (!config) return 'conflict';
  const snapshot: ConfigFieldSnapshot = {
    agentConfigId: patch.agentConfigId,
    field: patch.field,
    priorValue: readAgentConfigField(config, patch.field),
    expectedAppliedValue: patch.value,
  };
  const kind = diagnosisToProposalKind(diagnosisResult) ?? 'refine-config';
  const auditChangeJson = JSON.stringify({
    source: 'auto-repair-service',
    profileId: event.profileId,
    field: patch.field,
    valueSha256: createHash('sha256').update(patch.value).digest('hex'),
  });
  const proposal = await proposalsRepo.createAsync({
    kind,
    risk: classifyProposalRisk({ kind, changeJson: auditChangeJson }),
    status: 'proposed',
    title: `Post-apply repair attempt ${attempt}`,
    rationale: 'Automated post-apply guardrail repair',
    targetRef: `profile:${event.profileId}`,
    changeJson: auditChangeJson,
    beforeSnapshotJson: JSON.stringify(snapshot),
    dedupKey: repairAttemptDedupKey(event.proposalId, attempt),
  });
  return landAndClaimRepairAttempt(proposal, snapshot, deps);
}

// ---------------------------------------------------------------------------
// runAutoRepairAsync
// ---------------------------------------------------------------------------

export interface RunAutoRepairAsyncOptions {
  diagnosis: { diagnose: DiagnoseCall; configsRepo: AgentConfigsRepository };
  /** Defaults to `new Date()`. */
  now?: Date;
  /** Per-call override for the global trigger registered via {@link registerAutoRevertTrigger}. */
  triggerAutoRevert?: AutoRevertTrigger;
  eventsRepo?: PostApplyEventsRepository;
  proposalsRepo?: AgentOrgProposalsRepository;
  outcomesRepo?: AgentRunOutcomesRepository;
  experimentsRepo?: AgentOrgExperimentsRepository;
  enrollmentsRepo?: AgentOrgExperimentEnrollmentsRepository;
  /** Test seam: overrides {@link REPAIR_DIAGNOSIS_TIMEOUT_MS} for one call. */
  diagnosisTimeoutMs?: number;
}

export type RunAutoRepairOutcome =
  /** Guardrail cleared with sufficient post-repair evidence; original stays. */
  | 'repaired'
  /** All MAX_REPAIR_ATTEMPTS consumed and still breaching; auto-revert triggered. */
  | 'exhausted'
  /** Diagnosis unavailable (throw/timeout/null) or a write conflict — no strike consumed. */
  | 'deferred'
  /** An attempt's mutation landed and is awaiting sufficient post-repair evidence. */
  | 'pending'
  /** The latest attempt's evidence resolved (cleared-with-more-attempts-remaining
   *  is impossible by definition; this is "still breaching, attempts remain"
   *  OR "non-actionable diagnosis, attempts remain") — the NEXT tick starts a new attempt. */
  | 'advancing'
  | 'not-tripped';

export interface RunAutoRepairAsyncResult {
  outcome: RunAutoRepairOutcome;
  attempts: number;
  event: PostApplyEvent;
}

/**
 * Process ONE repair decision for a currently-`tripped` PostApplyEvent —
 * meant to be called on every sweep tick (see post_apply_lifecycle.ts) until
 * it resolves `repaired` or `exhausted`. A no-op (0 attempts) when the event
 * isn't tripped. Every durable field is read back from `event`/the
 * repository at the top of this call, so calling it again after a crash
 * simply resumes — see this module's doc comment.
 */
export async function runAutoRepairAsync(
  event: PostApplyEvent,
  options: RunAutoRepairAsyncOptions,
): Promise<RunAutoRepairAsyncResult> {
  if (event.guardrailStatus !== 'tripped') {
    return { outcome: 'not-tripped', attempts: 0, event };
  }

  const { diagnosis, now = new Date(), triggerAutoRevert } = options;
  const { diagnose, configsRepo } = diagnosis;
  const eventsRepo = options.eventsRepo ?? new PostApplyEventsRepository();
  const proposalsRepo = options.proposalsRepo ?? new AgentOrgProposalsRepository();
  const outcomesRepo = options.outcomesRepo ?? new AgentRunOutcomesRepository();
  const experimentsRepo = options.experimentsRepo ?? new AgentOrgExperimentsRepository();
  const enrollmentsRepo = options.enrollmentsRepo ?? new AgentOrgExperimentEnrollmentsRepository();

  const triggerRevert = async (fallback: PostApplyEvent): Promise<PostApplyEvent> => {
    const trigger = triggerAutoRevert ?? globalAutoRevertTrigger;
    if (trigger) await trigger({ proposalId: event.proposalId });
    return (await eventsRepo.findByProposalIdAsync(event.proposalId)) ?? fallback;
  };

  // ── Awaiting evidence for the most recently applied attempt ─────────────
  if (event.repairRecheckAfter) {
    const { sufficientEvidence, breached } = await evaluateRepairEvidence(event, event.repairRecheckAfter, {
      outcomesRepo,
      experimentsRepo,
      enrollmentsRepo,
    });

    if (!sufficientEvidence) {
      return { outcome: 'pending', attempts: event.repairAttemptCount, event };
    }

    if (!breached) {
      const cleared =
        (await eventsRepo.updateStatusAsync(event.proposalId, {
          guardrailStatus: 'clear',
          revertStatus: 'not_needed',
          repairRecheckAfter: null,
        })) ?? event;
      const original = await proposalsRepo.findByIdAsync(event.proposalId);
      if (original?.status === 'measuring') {
        await proposalsRepo.updateStatusAsync(original.id, 'active', undefined, original.revision);
      }
      return { outcome: 'repaired', attempts: cleared.repairAttemptCount, event: cleared };
    }

    // Still breaching with sufficient evidence — this attempt has failed.
    const advanced =
      (await eventsRepo.updateStatusAsync(event.proposalId, { repairRecheckAfter: null })) ?? event;
    if (advanced.repairAttemptCount >= MAX_REPAIR_ATTEMPTS) {
      const final = await triggerRevert(advanced);
      return { outcome: 'exhausted', attempts: advanced.repairAttemptCount, event: final };
    }
    return { outcome: 'advancing', attempts: advanced.repairAttemptCount, event: advanced };
  }

  // ── Defensive: attempts already exhausted but revert never landed (e.g. a
  // crash cleared the pending marker but died before the trigger fired) —
  // retrigger; runAutoRevertAsync is a safe no-op once the event has already
  // left this state.
  if (event.repairAttemptCount >= MAX_REPAIR_ATTEMPTS) {
    const final = await triggerRevert(event);
    return { outcome: 'exhausted', attempts: event.repairAttemptCount, event: final };
  }

  // ── Make attempt (repairAttemptCount + 1) ────────────────────────────────
  const nextAttempt = event.repairAttemptCount + 1;

  const recordLandedAttempt = async (proposalId: string): Promise<RunAutoRepairAsyncResult> => {
    const nextRepairIds = [...parseRepairProposalIds(event.repairProposalIdsJson), proposalId];
    const updated =
      (await eventsRepo.updateStatusAsync(event.proposalId, {
        repairProposalIdsJson: JSON.stringify(nextRepairIds),
        repairAttemptCount: nextAttempt,
        repairRecheckAfter: now.toISOString(),
      })) ?? event;
    return { outcome: 'pending', attempts: nextAttempt, event: updated };
  };

  // ROOT-CAUSE FIX (D2 post-apply lifecycle repair): resume a durable
  // attempt BEFORE diagnosing again. A crash (or a prior tick's
  // not-yet-settled projection — see landConfigFieldWithProjection) can
  // leave a dedup-keyed proposal already `proposed` or even `applied` for
  // this exact attempt number while the EVENT's own durable fields
  // (repairAttemptCount/repairRecheckAfter/repairProposalIdsJson) never
  // committed. Previously this always re-diagnosed first — wasteful, AND
  // wrong whenever that fresh diagnose call throws/times out/returns null,
  // because it reported `deferred` without ever looking at the durable
  // attempt that just needed its mutation/claim/event-update finished.
  const existingAttempt = await proposalsRepo.findByDedupKeyAsync(
    repairAttemptDedupKey(event.proposalId, nextAttempt),
  );
  if (existingAttempt) {
    const resumed = await resumeRepairAttempt(existingAttempt, { configsRepo, proposalsRepo });
    if (resumed === 'conflict') {
      return { outcome: 'deferred', attempts: event.repairAttemptCount, event };
    }
    return await recordLandedAttempt(resumed.proposalId);
  }

  const diagnosisEvidence = await evaluateRepairEvidence(event, event.monitoringWindowStart, {
    outcomesRepo,
    experimentsRepo,
    enrollmentsRepo,
  });
  const signals = buildPostApplyRegressionSignals(event, diagnosisEvidence);
  if (signals.length === 0) {
    return { outcome: 'deferred', attempts: event.repairAttemptCount, event };
  }

  const ctx = buildRepairDiagnosisContext(event.profileId, configsRepo, signals);
  let result: DiagnosisResult | null;
  try {
    result = await diagnoseWithTimeout(diagnose, ctx, options.diagnosisTimeoutMs ?? REPAIR_DIAGNOSIS_TIMEOUT_MS);
  } catch {
    // A transient engine/provider failure or a timeout is not evidence that
    // the applied change is bad. Leave the event tripped for a later
    // scheduler sweep — no strike consumed.
    return { outcome: 'deferred', attempts: event.repairAttemptCount, event };
  }
  if (!result) {
    // Provider unreachable or an unparseable response — same non-evidence
    // treatment as a thrown failure.
    return { outcome: 'deferred', attempts: event.repairAttemptCount, event };
  }

  if (result.fixType === 'config-change') {
    const patch = resolveRepairConfigPatch(result.configPatch, event.profileId, configsRepo);
    if (patch) {
      const applied = await createRepairAttempt(event, nextAttempt, patch, result, { configsRepo, proposalsRepo });
      if (applied === 'conflict') {
        // Nothing was mutated this tick (target vanished, or the live
        // value/revision drifted since it was last observed) — no strike
        // consumed; retry next tick with a fresh read.
        return { outcome: 'deferred', attempts: event.repairAttemptCount, event };
      }
      return await recordLandedAttempt(applied.proposalId);
    }
  }

  // Genuine, parseable diagnosis that is NOT actionable here (wrong
  // fixType, an unresolvable/protected patch, a vanished target): a real
  // strike, truthfully recorded, with no proposal to show for it because
  // nothing was mutated.
  const updated =
    (await eventsRepo.updateStatusAsync(event.proposalId, { repairAttemptCount: nextAttempt })) ?? event;
  if (nextAttempt >= MAX_REPAIR_ATTEMPTS) {
    const final = await triggerRevert(updated);
    return { outcome: 'exhausted', attempts: nextAttempt, event: final };
  }
  return { outcome: 'advancing', attempts: nextAttempt, event: updated };
}
