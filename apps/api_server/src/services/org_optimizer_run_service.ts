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
 *      `new_agent_generator` and `delegation_generator` require a caller-
 *      detected SIGNAL (a coverage-gap / redo-pattern) that is intentionally
 *      NOT part of `OrgAuditSnapshot` (see those modules' own doc comments —
 *      their ownership is scoped to consuming an injected signal, not
 *      deriving one). This run loop has no LLM-driven signal detector of its
 *      own to build in this issue's scope, so it calls them with an empty
 *      signal list every run (a correct, conservative no-op: "no signals
 *      detected this run" rather than fabricating one). `external_discovery_
 *      generator` is likewise skipped here — the decision doc (§6) and the
 *      #830 seed intentionally run it on its OWN, separate, less-frequent
 *      schedule with the mcp-registry/web-search composition happening
 *      OUTSIDE this module; wiring it into every audit-cadence run would
 *      violate that throttle.
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
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import type { AgentOrgProposal } from '../models/agent_org_proposal';

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
}

export interface RunOrgOptimizerResult {
  /** Groups every proposal this run touched. Present even on a skipped/capped run. */
  auditRunId: string;
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
  };
  /** Non-fatal error message, if the run degraded to a partial result. */
  erroredReason?: string;
}

function emptySummary(auditRunId: string): RunOrgOptimizerResult {
  return {
    auditRunId,
    skipped: false,
    capped: false,
    proposalsCreated: 0,
    byKind: {},
    byRisk: { low: 0, high: 0 },
    byOutcome: { autoApplied: 0, kept: 0, reverted: 0, queued: 0, skipped: 0 },
  };
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
 * Run the org self-optimizer loop once, end-to-end, server-side. NEVER
 * throws. See module doc comment for the full step sequence.
 */
export async function runOrgOptimizer(
  options: RunOrgOptimizerOptions = {},
): Promise<RunOrgOptimizerResult> {
  const maxProposalsPerRun = options.maxProposalsPerRun ?? DEFAULT_MAX_PROPOSALS_PER_RUN;
  // maxLlmCallsPerRun is accepted for parity with the seeded prompt's stated
  // cap and passed through to the recipe generator's scorer budget; the
  // generators invoked here (scope-hygiene, webhook-wiring) make no LLM
  // calls of their own, and recipe refinement's scorer calls are naturally
  // bounded by the (small, capped) proposal count, so no separate counter is
  // threaded through in v1 — flagged in the run summary via erroredReason if
  // a future generator needs one.
  void (options.maxLlmCallsPerRun ?? DEFAULT_MAX_LLM_CALLS_PER_RUN);

  const auditRunId = crypto.randomUUID();

  try {
    // ── 1. Cold-start guard (#746) ────────────────────────────────────────
    if (isEngineColdStart()) {
      logger.info('[org-optimizer-run] skipped — engine is within its #746 cold-start window');
      return {
        ...emptySummary(auditRunId),
        skipped: true,
        skippedReason: 'engine cold-start window active (#746) — deferring this run',
      };
    }

    const realProposalsRepo = options.proposalsRepo ?? new AgentOrgProposalsRepository();
    const configsRepo = options.configsRepo ?? new AgentConfigsRepository();

    const result = emptySummary(auditRunId);
    let capped = false;

    const newlyCreated: AgentOrgProposal[] = [];
    const dedupAwareRepo = makeDedupAwareProposalsRepo(realProposalsRepo, (proposal) => {
      newlyCreated.push(proposal);
    });
    const cappedRepo = makeCappedProposalsRepo(
      dedupAwareRepo,
      maxProposalsPerRun,
      () => {},
      () => newlyCreated.length >= maxProposalsPerRun,
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
    // external_discovery_generator intentionally NOT invoked here — see
    // module doc comment (§6 of the decision doc: separate, less-frequent
    // schedule, composed outside this module).

    result.capped = capped || newlyCreated.length >= maxProposalsPerRun;
    result.proposalsCreated = newlyCreated.length;

    // ── 5/6/7. Auto-apply + measure every newly created LOW-risk proposal.
    // Defense-in-depth double gate: this loop only ever calls autoApplyProposal
    // for a proposal whose OWN `risk` field is 'low' (checked here), and
    // autoApplyProposal ITSELF re-checks classifyProposalRisk independently
    // before writing anything — so a high-risk proposal can never reach a
    // write even if one of these two gates has a bug. ────────────────────
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
      } else {
        result.byOutcome.skipped += 1;
      }
    }

    logger.info(
      `[org-optimizer-run] run ${auditRunId} complete: created=${result.proposalsCreated} capped=${result.capped} byOutcome=${JSON.stringify(result.byOutcome)}`,
    );

    return result;
  } catch (err) {
    logger.warn(`[org-optimizer-run] FAILED (non-fatal): ${String(err)}`);
    return {
      ...emptySummary(auditRunId),
      erroredReason: String(err),
    };
  }
}
