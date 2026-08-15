/**
 * org_optimizer_run_service.ts — issue #850 (org-optimizer-16, the CAPSTONE
 * that makes the seeded optimizer actually run).
 *
 * `runOrgOptimizer()` is the single server-side entry point the new
 * `rhythm_run_org_optimizer` MCP tool calls. It performs the WHOLE loop in
 * one operation, per the decision doc's architecture
 * (docs/ai/decisions/2026-06-29-org-self-optimizer-cron.md §1):
 *
 *   1. Respect the #746 engine cold-start window — skip the entire run
 *      (no snapshot build, no proposals) rather than contend with a just-
 *      started engine.
 *   2. Build a fresh, read-only `OrgAuditSnapshot` (org_audit_service).
 *   3. Run the generators that can act directly on the snapshot:
 *        - scope_hygiene_generator  -> prune-scope / tighten-scope / consolidate-skill
 *        - recipe_generator         -> create-recipe / refine-recipe
 *        - webhook_wiring_generator -> webhook-wiring
 *        - workflow_signal_generator (#935) -> broaden-scope / create-recipe,
 *          from snapshot.workflowFailureSignals (#933/#934) — reuses these
 *          same two existing kinds rather than inventing a new lane
 *      `new_agent_generator` and `delegation_generator` require a caller-
 *      detected SIGNAL (a coverage-gap / redo-pattern) that is intentionally
 *      NOT part of `OrgAuditSnapshot` (see those modules' own doc comments —
 *      their ownership is scoped to consuming an injected signal, not
 *      deriving one). This run loop has no LLM-driven signal detector of its
 *      own to build in this issue's scope, so it calls them with an empty
 *      signal list every run (a correct, conservative no-op: "no signals
 *      detected this run" rather than fabricating one). `external_discovery_
 *      generator` DOES run inline in this loop on every pass (Stage B / #994,
 *      see below) — grounded on the open capability-gaps already on the
 *      snapshot (`taggedSnapshot.gaps`), so it needs no injected signal. This
 *      is IN ADDITION TO the #830 seed's own separate, less-frequent "Org
 *      External Discovery" scheduled task (decision doc §6), which still runs
 *      a deeper mcp-registry/web-search sweep on its own cadence (#1111
 *      reconciled this comment with the code — it had drifted stale since
 *      #994 stopped skipping the inline pass).
 *   4. Each generator persists (or, per the code above, is invoked with no
 *      signals to persist) its own proposals via `AgentOrgProposalsRepository
 *      .createAsync`, which is idempotent on `dedupKey` — the run loop relies
 *      on that existing dedup guard rather than re-implementing it.
 *   5. Enforce the #830 per-run proposal cap DURING generation: once the cap
 *      is hit, no further generator is invoked and the result is flagged
 *      `capped: true`.
 *   6. For every NEWLY CREATED proposal this run, immediately attempt the
 *      low-risk auto-apply lane (`org_proposal_apply.applyProposal`), which
 *      itself re-checks `classifyProposalRisk` and refuses (no-ops) any
 *      high-risk kind — this run loop does not need its own risk gate
 *      because that gate already lives in the auto-apply step and is the
 *      single source of truth (defense-in-depth: this module also never
 *      calls apply on a proposal whose OWN `risk` field is `'high'`, so a
 *      high-risk proposal is refused twice over before any write happens).
 *   7. Immediately measure every proposal the auto-apply step advanced to
 *      `measuring` (`org_proposal_measure.measureProposal`), so a run
 *      produces terminal `active`/`reverted` outcomes rather than leaving
 *      rows dangling in `measuring` until some later pass.
 *   8. Return a structured run summary: counts by kind, by risk, and by
 *      outcome (created/auto-applied/kept/reverted/queued/capped-skipped).
 *
 * NEVER throws — mirrors every other fire-and-forget optimizer module
 * (org_proposal_apply.ts / org_proposal_measure.ts / the six generators).
 * An unexpected error anywhere degrades to a best-effort partial summary
 * (`erroredReason` set) rather than crashing the calling MCP tool.
 */

import { logger } from '../utils/logger';
import { buildOrgAuditSnapshot } from './org_audit_service';
import { isEngineColdStart } from './skill_extractor';
import { classifyProposalRisk } from './org_risk_classifier';
import { applyProposal as autoApplyProposal } from './org_proposal_apply';
import { measureProposal } from './org_proposal_measure';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { generateScopeHygieneProposals } from './generators/scope_hygiene_generator';
import { generateRecipeProposals } from './generators/recipe_generator';
import { generateWebhookWiringProposals } from './generators/webhook_wiring_generator';
import { generateDelegationProposals } from './generators/delegation_generator';
import { generateWorkflowSignalProposals, generateDiagnosisProposals } from './generators/workflow_signal_generator';
import { generateRefineSkillProposals } from './generators/refine_skill_generator';
import { generateRunQualityProposals } from './generators/run_quality_generator';
import { runExternalDiscoveryGenerator } from './generators/external_discovery_generator';
import { discoverCandidatesFromEcosystem } from './generators/external_discovery_search';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import type { AgentOrgProposal } from '../models/agent_org_proposal';
import { resolveKnownMcpServerName } from './mcp_scope_name';
import {
  isGenerationAllowedForKind,
  mayAutoApply,
  mayMutateLifecycle,
  parseOptimizerPolicy,
  type OptimizerMode,
  type OptimizerPolicy,
} from './org_optimizer_policy';

/** #830 per-run budget defaults — a single run may never exceed these without an explicit override. */
const DEFAULT_MAX_PROPOSALS_PER_RUN = 20;
const DEFAULT_MAX_LLM_CALLS_PER_RUN = 40;

export interface RunOrgOptimizerOptions {
  /** Cap on NEW proposals created this run. Default 20 (matches the seeded audit prompt's stated cap). */
  maxProposalsPerRun?: number;
  /** Cap on LLM-scoring calls this run (the refine-* body measure path). Default 40. */
  maxLlmCallsPerRun?: number;
  /** Injectable proposals repo (tests only — defaults to a fresh AgentOrgProposalsRepository). */
  proposalsRepo?: AgentOrgProposalsRepository;
  /** Injectable configs repo (tests only — defaults to a fresh AgentConfigsRepository). */
  configsRepo?: AgentConfigsRepository;
  /**
   * W5 — operating mode. Anything not exactly `off|shadow|human_only|auto`
   * resolves to `shadow`. Defaults to `RHYTHM_OPTIMIZER_MODE`, and that
   * defaults to `shadow` too: the autonomous loop does not get write authority
   * over agent scope by omission.
   */
  mode?: string;
  /** W5 — comma-separated change families to refuse for generation/auto-apply. */
  disabledFamilies?: string;
  /** W5 — fully-formed policy, bypassing env/string parsing (tests). */
  policy?: OptimizerPolicy;
}

export interface RunOrgOptimizerResult {
  /** Groups every proposal this run touched. Present even on a skipped/capped run. */
  auditRunId: string;
  /** W5 — the mode this run actually operated under. */
  mode: OptimizerMode;
  /** True if the run was skipped entirely (cold-start) — see skippedReason. */
  skipped: boolean;
  skippedReason?: string;
  /** True if generation stopped early because maxProposalsPerRun was reached. */
  capped: boolean;
  /** Count of NEW proposals created this run (post-dedup — re-seen gaps do not count). */
  proposalsCreated: number;
  byKind: Record<string, number>;
  byRisk: { low: number; high: number };
  byOutcome: {
    autoApplied: number;
    kept: number;
    reverted: number;
    queued: number;
    skipped: number;
    /**
     * Durably unresolved measurements. Deliberately NOT folded into `skipped`:
     * `skipped` means "a later pass may decide", and an operator watching that
     * counter would never learn a proposal needs hands on it.
     */
    reconciliationRequired: number;
    /**
     * W5-c9 — retryable rows whose measurement budget is spent. They are NOT
     * measured again this pass and NOT written to (the lifecycle CAS token
     * belongs to real transitions); they are surfaced here and in the operator
     * report so a stuck measurement stops being an invisible forever-retry.
     */
    measuringInconclusive: number;
  };
  /**
   * W5 — what a SHADOW run would have done. Present only in shadow mode, and
   * the reason a shadow run is still worth reading: without it an operator
   * cannot tell "the loop found one candidate and held back" from "the loop
   * found nothing at all".
   */
  shadow?: {
    /** Proposals generated this run — every one of them a shadow candidate. */
    candidates: number;
    /** Of those, how many the auto-apply lane WOULD have taken under `auto`. */
    wouldAutoApply: number;
    /** Of those, how many would have been left in the human review queue. */
    wouldQueue: number;
  };
  /** W1 package C — what the bounded recovery sweep repaired or flagged. */
  recovery?: {
    projectionsRepaired: number;
    projectionsUnresolved: number;
    proposalsReconciled: number;
    proposalsHealthy: number;
  };
  /**
   * W5-c11 — true when `recovery` counts what the sweep WOULD have repaired
   * rather than what it did. Shadow must not make W1's repair path invisible,
   * but it must not write either, so the sweep runs with neutered writers.
   */
  recoveryReportOnly?: boolean;
  /**
   * Shadow only. Profiles whose file lags the database — what the sweep WOULD
   * have re-projected. Reported under its own name because reusing
   * `recovery.projectionsRepaired` claimed repairs that never happened, and
   * because the report-only stand-in cannot distinguish a projection that would
   * succeed from one that would fail: it never attempts either.
   */
  recoveryLagging?: number;
  /**
   * Shadow only. Incoherent `approved`/`applied` scope claims — a proposal
   * whose target no longer holds the exact bytes it was approved against,
   * which is what a crash between the scope commit and the profile projection
   * leaves behind.
   *
   * This has its own field for the same reason `recoveryLagging` does, and the
   * omission was worse: the sweep computed this count and the caller threw it
   * away, so in the DEFAULT mode there was no surface anywhere that reported
   * an incoherent claim. The dry-run CLI does not cover it either — the
   * reconciler filters `status='active'` while these rows are `approved` or
   * `applied`. W1's corrective-6 detection was live with its output
   * unreadable.
   */
  recoveryIncoherent?: number;
  /**
   * W6 experiment sweep — undecided experiments this run judged, by verdict.
   * `promoted` is the ONLY thing in the system that can set a proposal's
   * outcome_status to `verified`.
   */
  experiments?: {
    judged: number;
    promoted: number;
    regressed: number;
    inconclusive: number;
  };
  /**
   * True when `experiments` counts what the sweep WOULD have decided rather
   * than what it recorded. Same posture as `recoveryReportOnly`: judging writes
   * results, a decision, and the proposal's outcome_status (advancing its
   * lifecycle CAS token), so it belongs to the acting modes. Shadow still
   * computes and reports the verdict, because a shadow run that cannot say
   * "this experiment would promote" is blind rather than safe.
   */
  experimentsReportOnly?: boolean;
  /** Non-fatal error message, if the run degraded to a partial result. */
  erroredReason?: string;
}

function emptySummary(auditRunId: string, mode: OptimizerMode): RunOrgOptimizerResult {
  return {
    auditRunId,
    mode,
    skipped: false,
    capped: false,
    proposalsCreated: 0,
    byKind: {},
    byRisk: { low: 0, high: 0 },
    byOutcome: {
      autoApplied: 0, kept: 0, reverted: 0, queued: 0, skipped: 0,
      reconciliationRequired: 0, measuringInconclusive: 0,
    },
  };
}

async function invalidateMalformedMcpScopeProposals(
  proposalsRepo: AgentOrgProposalsRepository,
): Promise<void> {
  for (const status of ['proposed', 'measuring']) {
    for (const proposal of await proposalsRepo.listByStatusAsync(status)) {
      if (!['broaden-scope', 'tighten-scope', 'prune-scope'].includes(proposal.kind) || !proposal.changeJson) continue;
      try {
        const change = JSON.parse(proposal.changeJson) as {
          field?: string;
          add?: unknown;
          remove?: unknown;
        };
        if (change.field !== 'allowedMcpsJson') continue;
        const names = [
          ...(Array.isArray(change.add) ? change.add : []),
          ...(Array.isArray(change.remove) ? change.remove : []),
        ].filter((name): name is string => typeof name === 'string');
        for (const name of names) {
          const { serverName, knownServerNames } = await resolveKnownMcpServerName(name);
          if (knownServerNames.length > 0 && serverName && serverName !== name) {
            await proposalsRepo.updateStatusAsync(proposal.id, 'rejected', {
              measureReason: `invalidated malformed MCP tool id '${name}'; server allowlists require '${serverName}'`,
            });
            break;
          }
        }
      } catch {
        // Existing malformed JSON is handled by the normal validator.
      }
    }
  }
}

/**
 * A tiny counting proposals-repo proxy that stops delegating `createAsync`
 * once `maxProposalsPerRun` NEW rows have been created this run, so the cap
 * is enforced centrally regardless of which generator is currently running.
 * "New" excludes dedup hits (the wrapped repo already returns the existing
 * row for a duplicate dedupKey without inserting) — we only count a create
 * as new when the returned row's `createdAt` fires the same run (approximated
 * here by tracking ids returned across calls: a repeat id for the same
 * dedupKey within one run is never new).
 */
function makeCappedProposalsRepo(
  real: AgentOrgProposalsRepository,
  maxProposalsPerRun: number,
  onCreated: (proposal: AgentOrgProposal) => void,
  isCapped: () => boolean,
): AgentOrgProposalsRepository {
  const seenIds = new Set<string>();
  const proxy = Object.create(real) as AgentOrgProposalsRepository;
  proxy.createAsync = async (input) => {
    if (isCapped()) {
      // Refuse further creation once capped. Throwing would break the
      // generators' own try/catch-per-item loops (they log and continue),
      // which is exactly the desired "stop taking new proposals" behavior
      // without aborting the generator's iteration over remaining items.
      throw new Error('org-optimizer-run: per-run proposal cap reached');
    }
    const created = await real.createAsync.call(real, input);
    if (!seenIds.has(created.id)) {
      seenIds.add(created.id);
      // Only a row whose dedupKey did NOT already exist before this call is
      // genuinely new. AgentOrgProposalsRepository.createAsync returns the
      // pre-existing row (unchanged) on a dedup hit, so comparing timestamps
      // is unreliable across a fast in-memory run; instead we rely on the
      // caller-visible cap check: track ids and let onCreated's own
      // dedup-aware caller (below) decide via a fresh existsByDedupKeyAsync
      // check performed BEFORE calling createAsync.
      onCreated(created);
    }
    return created;
  };
  return proxy;
}

/**
 * Wrap a proposals repo so `createAsync` only invokes `onNew` when the
 * dedup_key did not already exist prior to this call — i.e. a genuinely new
 * row was inserted, not a dedup-hit re-return of an existing one. This is
 * the authoritative "new this run" signal the cap and the summary counters
 * key off of.
 */
function makeDedupAwareProposalsRepo(
  real: AgentOrgProposalsRepository,
  onNew: (proposal: AgentOrgProposal) => void,
): AgentOrgProposalsRepository {
  const proxy = Object.create(real) as AgentOrgProposalsRepository;
  proxy.createAsync = async (input) => {
    const existedBefore = input.dedupKey
      ? await real.existsByDedupKeyAsync.call(real, input.dedupKey)
      : false;
    const created = await real.createAsync.call(real, input);
    if (!existedBefore) {
      onNew(created);
    }
    return created;
  };
  return proxy;
}

/**
 * W5-c2 — the per-change-family kill switch, enforced at the ONE seam every
 * generator (present and future) has to pass through to persist anything. A
 * per-generator gate would have to be re-derived every time a generator learns
 * a new kind; this cannot be bypassed by adding a generator.
 *
 * Refusal is a throw because that is exactly how the existing per-run cap
 * refuses, and every generator already tolerates it (they log and continue).
 */
function makeFamilyGatedProposalsRepo(
  real: AgentOrgProposalsRepository,
  policy: OptimizerPolicy,
): AgentOrgProposalsRepository {
  const proxy = Object.create(real) as AgentOrgProposalsRepository;
  proxy.createAsync = async (input) => {
    if (!isGenerationAllowedForKind(policy, input.kind)) {
      throw new Error(`org-optimizer-run: change family for kind '${input.kind}' is disabled by policy`);
    }
    return await real.createAsync.call(real, input);
  };
  return proxy;
}

/**
 * W5-c11 — the W1 recovery sweep, run for its CLASSIFICATION only.
 *
 * `runOrgOptimizer` is the sweep's only production caller, so gating it behind
 * the mutation phases would make W1 corrective-6's repair path dead code from
 * the moment shadow became the default. Instead the same sweep runs with its
 * two writers replaced by non-writing stand-ins that report what they WOULD
 * have done, so drift stays visible without a single byte changing. The
 * detection logic is not duplicated — it is the same function.
 */
async function runRecoverySweepReportOnly(
  proposalsRepo: AgentOrgProposalsRepository,
): Promise<RunOrgOptimizerResult['recovery']> {
  const { runRecoverySweep } = await import('./org_proposal_recovery_service');
  const readOnlyProposals = Object.create(proposalsRepo) as AgentOrgProposalsRepository;
  // Reports "this row WOULD have been marked" by handing back the row exactly
  // as it is — a read, not a write, and truthy so the sweep still counts it.
  readOnlyProposals.markReconciliationRequiredAsync = async (input) =>
    await proposalsRepo.findByIdAsync(input.proposalId);
  return await runRecoverySweep({
    proposalsRepo: readOnlyProposals,
    // Reports the profile as one this sweep would have re-projected, without
    // rendering or replacing any file. `stale` is the existing outcome that
    // means "nothing of the caller's was written".
    project: (input) => ({
      kind: 'stale',
      requestedRevision: input.expectedRevision,
      currentRevision: input.expectedRevision,
    }),
  });
}

/**
 * Run the org self-optimizer loop once, end-to-end, server-side. NEVER
 * throws. See module doc comment for the full step sequence.
 */
export async function runOrgOptimizer(
  options: RunOrgOptimizerOptions = {},
): Promise<RunOrgOptimizerResult> {
  const maxProposalsPerRun = options.maxProposalsPerRun ?? DEFAULT_MAX_PROPOSALS_PER_RUN;
  // maxLlmCallsPerRun bounds the #971 LLM-diagnosis lane's per-run diagnosis
  // calls (see the diagnosis generator step below). The other generators
  // invoked here (scope-hygiene, webhook-wiring, the deterministic
  // workflow-signal lane) make no LLM calls of their own, and recipe
  // refinement's scorer calls are naturally bounded by the (small, capped)
  // proposal count, so this single budget only needs threading into diagnosis.
  const maxLlmCallsPerRun = options.maxLlmCallsPerRun ?? DEFAULT_MAX_LLM_CALLS_PER_RUN;

  const auditRunId = crypto.randomUUID();

  // ── 0. W5 policy. Resolved first, because `off` must not even build a
  // snapshot and `shadow` decides whether any writer runs at all. Resolved
  // INSIDE the try: reading options.mode/options.policy runs caller-supplied
  // property getters, and this function's contract is that it never throws.
  let policy = parseOptimizerPolicy({});
  let mode = policy.mode;

  try {
    policy = options.policy ?? parseOptimizerPolicy({
      mode: options.mode ?? process.env.RHYTHM_OPTIMIZER_MODE,
      disabledFamilies: options.disabledFamilies ?? process.env.RHYTHM_OPTIMIZER_DISABLED_FAMILIES,
    });
    mode = policy.mode;
    if (mode === 'off') {
      logger.info('[org-optimizer-run] skipped — optimizer mode is off');
      return {
        ...emptySummary(auditRunId, mode),
        skipped: true,
        skippedReason: 'optimizer mode is off',
      };
    }

    // ── 1. Cold-start guard (#746) ────────────────────────────────────────
    if (isEngineColdStart()) {
      logger.info('[org-optimizer-run] skipped — engine is within its #746 cold-start window');
      return {
        ...emptySummary(auditRunId, mode),
        skipped: true,
        skippedReason: 'engine cold-start window active (#746) — deferring this run',
      };
    }

    const realProposalsRepo = options.proposalsRepo ?? new AgentOrgProposalsRepository();
    const configsRepo = options.configsRepo ?? new AgentConfigsRepository();
    // Invalidating a malformed row is a WRITE, so it belongs to the acting
    // modes only — shadow reports, it does not clean up.
    if (mayMutateLifecycle(policy)) {
      await invalidateMalformedMcpScopeProposals(realProposalsRepo);
    }

    const result = emptySummary(auditRunId, mode);
    let capped = false;

    const newlyCreated: AgentOrgProposal[] = [];
    const dedupAwareRepo = makeDedupAwareProposalsRepo(realProposalsRepo, (proposal) => {
      newlyCreated.push(proposal);
    });
    const cappedRepo = makeFamilyGatedProposalsRepo(
      makeCappedProposalsRepo(
        dedupAwareRepo,
        maxProposalsPerRun,
        () => {},
        () => newlyCreated.length >= maxProposalsPerRun,
      ),
      policy,
    );

    // ── 2. Build the read-only audit snapshot ─────────────────────────────
    const snapshot = await buildOrgAuditSnapshot();
    // Every proposal created this run must carry the SAME auditRunId, so the
    // snapshot's own (fresh) auditRunId is overridden by this run's id at the
    // generator call sites below rather than trusted from the snapshot.
    const taggedSnapshot = { ...snapshot, auditRunId };

    // ── 3/4. Run the snapshot-driven generators (each persists its own
    // proposals via the capped, dedup-aware repo) ─────────────────────────
    const generatorSteps: Array<() => Promise<void>> = [
      async () => {
        await generateScopeHygieneProposals(taggedSnapshot, { proposalsRepo: cappedRepo });
      },
      async () => {
        await generateRecipeProposals(taggedSnapshot, { proposalsRepo: cappedRepo });
      },
      async () => {
        await generateWebhookWiringProposals(taggedSnapshot, cappedRepo);
      },
      async () => {
        // #935 — workflow_failure_signal_extractor.ts (#933) signals, already
        // present on taggedSnapshot via buildOrgAuditSnapshot (#934). Runs
        // through the SAME capped, dedup-aware repo as every other
        // generator, so the #830 per-run cap and dedup guard cover it for
        // free — no separate cap/dedup logic needed here (#936).
        await generateWorkflowSignalProposals(taggedSnapshot, { proposalsRepo: cappedRepo });
      },
      async () => {
        // #971 — LLM diagnosis lane, ADDITIVE to the deterministic
        // workflow-signal lane above. Groups behavioral failure signals by
        // (profile, error signature) and emits the richer, human-gated
        // refine-config / refine-scope / workflow-prompt-fix / refine-task kinds
        // the approval loop measures and reverts. Runs through the SAME capped,
        // dedup-aware repo (so the #830 per-run cap + dedup cover it) and is
        // bounded by maxLlmCallsPerRun. Never throws.
        await generateDiagnosisProposals(taggedSnapshot, {
          proposalsRepo: cappedRepo,
          configsRepo,
          maxDiagnoseCalls: maxLlmCallsPerRun,
        });
      },
      async () => {
        // #976 — per-skill QUALITY lane. Surveys snapshot.skills for weak
        // active/published skills and emits human-gated (risk:'high')
        // refine-skill proposals with a pre-drafted body. Runs through the
        // SAME capped, dedup-aware repo (#830 cap + dedup for free) and bounds
        // its LLM rewrite drafts by maxLlmCallsPerRun. Never throws.
        await generateRefineSkillProposals(taggedSnapshot, {
          proposalsRepo: cappedRepo,
          maxDrafts: maxLlmCallsPerRun,
        });
      },
      async () => {
        // Run-QUALITY lane (#865 scorecard as a proposal signal). Adapts the
        // per-agent quality rollup (escalation rate / repeated-mistake
        // clusters) into the SAME #971 diagnosable failure signals and reuses
        // generateDiagnosisProposals — so it emits the identical human-gated
        // refine-config / refine-scope / workflow-prompt-fix / refine-task
        // proposal INPUTS through the SAME capped, dedup-aware repo (the #830
        // per-run cap + dedup cover it) and the SAME registered appliers. No
        // new kind, applier, apply path, or budget. Never throws.
        await generateRunQualityProposals(taggedSnapshot, {
          diagnosis: { proposalsRepo: cappedRepo, configsRepo, maxDiagnoseCalls: maxLlmCallsPerRun },
        });
      },
    ];

    for (const step of generatorSteps) {
      if (newlyCreated.length >= maxProposalsPerRun) {
        capped = true;
        break;
      }
      try {
        await step();
      } catch (err) {
        // A cap-reached throw from cappedRepo.createAsync surfaces here for
        // generators that do not already catch per-item (defense-in-depth —
        // scope_hygiene/recipe/webhook_wiring all catch per-item internally,
        // but a future generator might not).
        if (newlyCreated.length >= maxProposalsPerRun) {
          capped = true;
        } else {
          logger.warn(`[org-optimizer-run] generator step failed (non-fatal): ${String(err)}`);
        }
      }
    }

    // new_agent_generator / delegation_generator: no caller-derived signal
    // detector exists in this run loop's scope (see module doc). Calling
    // generateDelegationProposals([], configs) is a correct, explicit no-op
    // ("no redo/coverage-gap signals detected this run") rather than a
    // silent omission — kept here so the six-generator sweep is
    // documented as complete even though two contribute zero proposals
    // without an injected signal.
    if (newlyCreated.length < maxProposalsPerRun) {
      try {
        const configs = configsRepo.list();
        generateDelegationProposals([], configs); // no signals this run -> []
      } catch (err) {
        logger.warn(`[org-optimizer-run] delegation no-signal pass failed (non-fatal): ${String(err)}`);
      }
    }
    // Stage B (Plan B) — external discovery now RUNS in the optimizer loop,
    // grounded on the open capability-gaps surfaced into the snapshot. Real
    // ecosystem search (skills.sh + mcp-registry), judge, and #873 pre-vet all
    // live inside discoverCandidatesFromEcosystem; the generator enforces
    // gap-grounding / provenance / dedup / cap and emits HIGH-risk, human-gated
    // external-adoption proposals (never auto-applied by the loop below). The
    // per-run proposal cap still applies via the shared newlyCreated budget.
    if (newlyCreated.length < maxProposalsPerRun) {
      try {
        await runExternalDiscoveryGenerator({
          gaps: taggedSnapshot.gaps,
          discoverCandidates: discoverCandidatesFromEcosystem,
          maxResults: maxProposalsPerRun - newlyCreated.length,
          proposalsRepo: cappedRepo,
        });
      } catch (err) {
        logger.warn(`[org-optimizer-run] external-discovery step failed (non-fatal): ${String(err)}`);
      }
    }

    result.capped = capped || newlyCreated.length >= maxProposalsPerRun;
    result.proposalsCreated = newlyCreated.length;

    // ── 5/6/7. Auto-apply + measure every newly created LOW-risk proposal.
    // Defense-in-depth double gate: this loop only ever calls autoApplyProposal
    // for a proposal whose OWN `risk` field is 'low' (checked here), and
    // autoApplyProposal ITSELF re-checks classifyProposalRisk independently
    // before writing anything — so a high-risk proposal can never reach a
    // write even if one of these two gates has a bug. ────────────────────
    const shadowing = !mayAutoApply(policy);
    if (mode === 'shadow') {
      result.shadow = { candidates: newlyCreated.length, wouldAutoApply: 0, wouldQueue: 0 };
    }

    for (const proposal of newlyCreated) {
      result.byKind[proposal.kind] = (result.byKind[proposal.kind] ?? 0) + 1;

      const risk = classifyProposalRisk({
        kind: proposal.kind,
        changeJson: proposal.changeJson,
        external: proposal.external,
      });
      if (risk === 'low') {
        result.byRisk.low += 1;
      } else {
        result.byRisk.high += 1;
      }

      // W5-c3/c4: outside `auto` the loop has no authority to write to a
      // target on its own. It still RANKS every candidate, so the summary says
      // what the run would have done rather than going quiet.
      if (shadowing) {
        const wouldApply =
          proposal.risk === 'low' && risk === 'low' && isGenerationAllowedForKind(policy, proposal.kind);
        if (result.shadow) {
          if (wouldApply) result.shadow.wouldAutoApply += 1;
          else result.shadow.wouldQueue += 1;
        }
        result.byOutcome.queued += 1;
        continue;
      }

      if (!isGenerationAllowedForKind(policy, proposal.kind)) {
        // A kill switch refuses the AUTONOMOUS lane. The row stays in the human
        // review queue, where an approval remains a separate authority.
        result.byOutcome.queued += 1;
        continue;
      }

      if (proposal.risk !== 'low' || risk !== 'low') {
        // HIGH-risk (or anything not affirmatively low by BOTH the stored
        // field and the live predicate) stays 'proposed' for the human
        // review queue. Never call autoApplyProposal for it.
        result.byOutcome.queued += 1;
        continue;
      }

      const applyResult = await autoApplyProposal(proposal, { proposalsRepo: realProposalsRepo });
      if (applyResult.status === 'refused-high-risk') {
        // Should be unreachable given the gate above, but if the classifier
        // and this loop ever disagree, the auto-apply step's OWN refusal is
        // still authoritative — the proposal simply stays 'proposed'.
        result.byOutcome.queued += 1;
        continue;
      }
      if (applyResult.status === 'skipped') {
        result.byOutcome.skipped += 1;
        continue;
      }

      result.byOutcome.autoApplied += 1;

      const measuring = await realProposalsRepo.findByIdAsync(proposal.id);
      if (!measuring || measuring.status !== 'measuring') {
        // Non-measurable applies (e.g. a kind whose apply step leaves it
        // 'applied' rather than 'measuring') have no further outcome to
        // record — already counted as autoApplied above.
        continue;
      }

      const measureOutcome = await measureProposal(measuring, { proposalsRepo: realProposalsRepo });
      if (measureOutcome === 'kept') {
        result.byOutcome.kept += 1;
      } else if (measureOutcome === 'reverted') {
        result.byOutcome.reverted += 1;
      } else if (measureOutcome === 'reconciliation-required') {
        result.byOutcome.reconciliationRequired += 1;
      } else {
        result.byOutcome.skipped += 1;
      }
    }

    // ── 9. Measure sweep (#971-3, closes F3). The auto-apply loop above only
    // measures rows THIS run created. Human-APPROVED proposals reach `measuring`
    // via the approve route and would otherwise sit there forever. Sweep EVERY
    // row still in `measuring` and measure it. Rows created+measured this run are
    // excluded (they already had their attempt above — re-measuring immediately
    // would repeat a possibly-expensive behavioral re-run in the same pass); a
    // row this run left `skipped` (still `measuring`) is retried on the NEXT
    // run's sweep, not this one. Localized, self-contained, never throws. ─────
    // The CLASSIFICATION half runs under every non-`off` mode; only the
    // measuring half is gated. classifyStuckMeasurement writes nothing by
    // explicit design — the verdict is reported, never persisted — so gating it
    // on `mayMutateLifecycle` made `measuringInconclusive` structurally always
    // zero in the DEFAULT mode, which is the one W5 itself chose. The concrete
    // hole: a human approves a prune-scope proposal, its single measure attempt
    // hits unavailable telemetry and returns `skipped`, the row stays
    // `measuring` — and every later run skipped the sweep entirely, so it sat
    // there forever, never retried, never classified, never in a run summary.
    // W5's own acceptance ("stuck measuring work becomes inspectable
    // /inconclusive instead of eternal") was unmet in shadow. This is the same
    // reconciliation the plan already made for the recovery sweep, applied
    // consistently to its sibling in the same function.
    try {
      const measuredThisRun = new Set(newlyCreated.map((p) => p.id));
      const stillMeasuring = await realProposalsRepo.listByStatusAsync('measuring');
      const { classifyStuckMeasurement } = await import('./org_proposal_reconciler');
      for (const row of stillMeasuring) {
        if (measuredThisRun.has(row.id)) continue;
        // W5-c9: a row that has been retryable-but-undecided past its budget is
        // classified inconclusive and left alone. Measuring it again is the
        // silent forever-retry this criterion exists to end; writing the verdict
        // to the row would advance its lifecycle CAS token for something that is
        // not a domain change, so the verdict is reported, not persisted.
        const budget = classifyStuckMeasurement(row);
        if (budget.verdict === 'inconclusive') {
          result.byOutcome.measuringInconclusive += 1;
          logger.warn(`[org-optimizer-run] '${row.id}' measurement ${budget.reason}`);
          continue;
        }
        if (!mayMutateLifecycle(policy)) continue;
        const outcome = await measureProposal(row, { proposalsRepo: realProposalsRepo });
        if (outcome === 'kept') result.byOutcome.kept += 1;
        else if (outcome === 'reverted') result.byOutcome.reverted += 1;
        else if (outcome === 'reconciliation-required') result.byOutcome.reconciliationRequired += 1;
        else result.byOutcome.skipped += 1;
      }
    } catch (err) {
      logger.warn(`[org-optimizer-run] measuring-row sweep failed (non-fatal): ${String(err)}`);
    }

    // ── 9b. W6 experiment sweep. The controlled-experiment gate is the ONLY
    // thing that may establish verified improvement, and before this it had no
    // production caller at all. Judge every undecided experiment; the gate
    // itself decides promote | inconclusive | regress and refuses on an invalid
    // bundle, a non-promoting adapter, an empty cohort or an unmet stopping
    // rule. Never throws. ────────────────────────────────────────────────────
    try {
      const { AgentOrgExperimentsRepository } = await import(
        '../repositories/agent_org_experiments_repository'
      );
      const { computeDecisionAsync, judgeExperimentAsync } = await import(
        './org_proposal_experiment_service'
      );
      const undecided = await new AgentOrgExperimentsRepository().listUndecidedAsync();
      const acting = mayMutateLifecycle(policy);
      const tally = { judged: 0, promoted: 0, regressed: 0, inconclusive: 0 };
      for (const experiment of undecided) {
        // Acting modes RECORD the verdict (results, decision, and the
        // proposal's outcome_status). Shadow computes the identical verdict
        // through the shared code path and persists nothing, so a default
        // install can never auto-promote.
        const decided = acting
          ? await judgeExperimentAsync(experiment.id)
          : await computeDecisionAsync(experiment);
        tally.judged += 1;
        if (decided.decision === 'promote') tally.promoted += 1;
        else if (decided.decision === 'regress') tally.regressed += 1;
        else tally.inconclusive += 1;
        logger.info(
          `[org-optimizer-run] experiment '${experiment.id}' (proposal '${experiment.proposalId}') ` +
          `${acting ? 'decided' : 'WOULD decide'} ${decided.decision}: ${decided.reason}`,
        );
      }
      if (tally.judged > 0) {
        result.experiments = tally;
        if (!acting) result.experimentsReportOnly = true;
      }
    } catch (err) {
      logger.warn(`[org-optimizer-run] experiment sweep failed (non-fatal): ${String(err)}`);
    }

    // ── 10. Bounded recovery sweep. The database commit, the profile file and
    // the engine reload cannot be committed together, so a crash between them
    // leaves a detectable lag. This is the thing that acts on that detection.
    // Bounded and never-throwing: a reconciler that can stall or crash the run
    // is worse than a lagging file. ───────────────────────────────────────────
    try {
      if (mayMutateLifecycle(policy)) {
        const { runRecoverySweep } = await import('./org_proposal_recovery_service');
        result.recovery = await runRecoverySweep({ proposalsRepo: realProposalsRepo });
      } else {
        const reported = (await runRecoverySweepReportOnly(realProposalsRepo)) ?? {
          projectionsRepaired: 0,
          projectionsUnresolved: 0,
          proposalsReconciled: 0,
          proposalsHealthy: 0,
        };
        result.recoveryReportOnly = true;
        result.recoveryLagging = reported.projectionsRepaired;
        result.recoveryIncoherent = reported.proposalsReconciled;
        // Zero the acting counters: in shadow nothing was repaired and nothing
        // was reconciled, and a reader who misses `recoveryReportOnly` must not
        // be told otherwise. `projectionsUnresolved` is unknowable here — the
        // stand-in never attempts a projection — so it stays 0 rather than
        // implying every lagging profile would have succeeded.
        result.recovery = {
          ...reported,
          projectionsRepaired: 0,
          proposalsReconciled: 0,
        };
      }
    } catch (err) {
      logger.warn(`[org-optimizer-run] recovery sweep failed (non-fatal): ${String(err)}`);
    }

    logger.info(
      `[org-optimizer-run] run ${auditRunId} complete: mode=${mode} created=${result.proposalsCreated} ` +
      `capped=${result.capped} byOutcome=${JSON.stringify(result.byOutcome)} ` +
      `recovery=${JSON.stringify(result.recovery ?? null)}`,
    );

    return result;
  } catch (err) {
    logger.warn(`[org-optimizer-run] FAILED (non-fatal): ${String(err)}`);
    return {
      ...emptySummary(auditRunId, mode),
      erroredReason: String(err),
    };
  }
}
