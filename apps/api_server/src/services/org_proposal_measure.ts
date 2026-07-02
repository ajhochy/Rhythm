/**
 * org_proposal_measure.ts — #821 (org-optimizer-05)
 *
 * The measure/keep/revert step of the low-risk auto-apply path. Given a
 * proposal already `status='measuring'` (i.e. `org_proposal_apply.applyProposal`
 * has already snapshotted + applied it), decide whether to KEEP it
 * (`status='active'`) or AUTO-REVERT it (`status='reverted'`, replaying
 * `before_snapshot_json` via `org_proposal_apply.revertProposal`).
 *
 * Per-kind metric (docs/ai/decisions/2026-06-29-org-self-optimizer-cron.md §3):
 *
 *   - `tighten-scope` / `prune-scope` (mechanical, no LLM): keep iff
 *     scope-hygiene STRICTLY improves (fewer allowlist entries after the
 *     change than before — always true for a non-empty removal, so this is
 *     really a sanity check) AND the FUNCTIONAL GUARD passes: none of the
 *     removed names were actually exercised by the profile in the trailing
 *     window. The functional guard is the safety-critical half — a prune
 *     that removes something the profile is currently using must never be
 *     kept, however tidy the resulting allowlist looks.
 *
 *   - `refine-skill` / `consolidate-skill` / `refine-recipe` (body kinds):
 *     reuse the same purpose-anchored LLM scorer as the skill loop
 *     (`skill_refiner.scoreSkillBody`, injectable as `deps.scoreSkillBody`).
 *     Keep iff `post > baseline` (STRICTLY greater). A tie, a scorer error,
 *     or an unparseable score is NO improvement -> revert (fail-closed) —
 *     `scoreSkillBody` itself already fail-closes a throwing scorer to 0.
 *
 * Every other kind (nothing should reach here outside those five — the
 * caller only invokes this on a row whose proposal is already `risk='low'`)
 * is treated as `skipped`: not enough information to safely decide, so we
 * do nothing rather than guess.
 *
 * Operational envelope (mirrors skill_measurement.ts):
 *   • NEVER throws — the caller (the optimizer loop) is fire-and-forget.
 *   • An unexpected error anywhere in the decision (e.g. an injected metric
 *     hook throwing) resolves to 'skipped', leaving the row in `measuring`
 *     for a later pass rather than guessing keep or revert.
 */

import { logger } from '../utils/logger';
import { revertProposal, type ApplyDeps, type RevertPatch } from './org_proposal_apply';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import type { AgentOrgProposal } from '../models/agent_org_proposal';
import type { ScoreCall, SkillPurpose } from './skill_refiner';

export type MeasureOutcome = 'kept' | 'reverted' | 'skipped';

/** Shape of the `changeJson` payload for an `agent_configs` scope mutation (mirrors org_proposal_apply.ts). */
interface AgentConfigScopeChange {
  agentConfigId: string;
  field: 'allowedMcpsJson' | 'allowedSkillsJson';
  remove?: string[];
  add?: string[];
}

function isAgentConfigScopeChange(v: unknown): v is AgentConfigScopeChange {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.agentConfigId === 'string' &&
    (c.field === 'allowedMcpsJson' || c.field === 'allowedSkillsJson')
  );
}

/** Shape of the `changeJson` payload for a body-scored kind (refine-skill etc). */
interface BodyRefinementChange {
  skillName?: string;
  recipeName?: string;
  priorBody: string;
  revisedBody: string;
  description?: string | null;
  whenToUse?: string | null;
}

function isBodyRefinementChange(v: unknown): v is BodyRefinementChange {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return typeof c.priorBody === 'string' && typeof c.revisedBody === 'string';
}

export interface MeasureDeps extends ApplyDeps {
  /**
   * Resolve the set of tool/server names ACTUALLY exercised by the target
   * profile in the trailing window — the functional guard for
   * tighten-scope/prune-scope. Defaults to the real denied/used-tool
   * telemetry (best-effort; a real implementation would join
   * agent_sessions/tool-use telemetry). Tests inject a deterministic set.
   */
  exercisedTools?: (agentConfigId: string) => Promise<Set<string>>;
  /** Injectable purpose-anchored scorer (defaults to skill_refiner.scoreSkillBody's real impl). */
  scoreSkillBody?: ScoreCall;
}

/** Best-effort default: no telemetry wired yet, so nothing is presumed exercised. */
async function defaultExercisedTools(_agentConfigId: string): Promise<Set<string>> {
  return new Set<string>();
}

/**
 * Measure a `measuring` proposal and KEEP or REVERT it. NEVER throws.
 */
export async function measureProposal(
  proposal: AgentOrgProposal,
  deps: MeasureDeps = {},
): Promise<MeasureOutcome> {
  try {
    if (proposal.status !== 'measuring') {
      logger.warn(
        `[org-proposal-measure] '${proposal.id}' is not in status=measuring (got '${proposal.status}') — skipping`,
      );
      return 'skipped';
    }

    const proposalsRepo = deps.proposalsRepo ?? new AgentOrgProposalsRepository();

    if (proposal.kind === 'tighten-scope' || proposal.kind === 'prune-scope') {
      return await measureScopeChange(proposal, { ...deps, proposalsRepo });
    }

    if (
      proposal.kind === 'refine-skill' ||
      proposal.kind === 'consolidate-skill' ||
      proposal.kind === 'refine-recipe'
    ) {
      return await measureBodyRefinement(proposal, { ...deps, proposalsRepo });
    }

    logger.warn(`[org-proposal-measure] unsupported kind '${proposal.kind}' for '${proposal.id}' — skipping`);
    return 'skipped';
  } catch (err) {
    logger.warn(`[org-proposal-measure] FAILED (non-fatal): ${String(err)}`);
    return 'skipped';
  }
}

/**
 * Mechanical measure for tighten-scope/prune-scope: keep iff the allowlist
 * strictly shrank AND none of the removed names were actually exercised in
 * the trailing window (functional guard). Revert otherwise.
 */
async function measureScopeChange(
  proposal: AgentOrgProposal,
  deps: Required<Pick<MeasureDeps, 'proposalsRepo'>> & MeasureDeps,
): Promise<MeasureOutcome> {
  const proposalsRepo = deps.proposalsRepo!;

  let change: unknown;
  try {
    change = proposal.changeJson ? JSON.parse(proposal.changeJson) : null;
  } catch (err) {
    logger.warn(`[org-proposal-measure] malformed changeJson for '${proposal.id}': ${String(err)}`);
    return 'skipped';
  }

  if (!isAgentConfigScopeChange(change)) {
    logger.warn(`[org-proposal-measure] '${proposal.id}' changeJson is not a scope change — skipping`);
    return 'skipped';
  }

  const removed = change.remove ?? [];
  if (removed.length === 0) {
    // Nothing was actually removed — no hygiene improvement to speak of.
    return await doRevert(proposal, deps);
  }

  const exercisedTools = deps.exercisedTools ?? defaultExercisedTools;
  const exercised = await exercisedTools(change.agentConfigId);

  const guardFailed = removed.some((name) => exercised.has(name));
  if (guardFailed) {
    logger.info(
      `[org-proposal-measure] functional guard FAILED for '${proposal.id}' — a removed scope was actually exercised`,
    );
    return await doRevert(proposal, deps, {
      measureReason: `scope-hygiene: functional guard failed — a removed entry (${removed.join(',')}) was exercised in the trailing window`,
    });
  }

  // Hygiene strictly improved (non-empty removal) and the functional guard
  // passed (nothing removed was in active use) -> keep.
  await proposalsRepo.updateStatusAsync(proposal.id, 'active', {
    measureReason: `scope-hygiene: removed ${removed.length} dead/unused entr${removed.length === 1 ? 'y' : 'ies'}; functional guard passed`,
  });
  logger.info(`[org-proposal-measure] KEPT scope change for '${proposal.id}'`);
  return 'kept';
}

/**
 * LLM-scored measure for refine-skill/consolidate-skill/refine-recipe: keep
 * iff post > baseline (STRICTLY greater) via the injected purpose-anchored
 * scorer. Ties and scorer errors are NO improvement -> revert (fail-closed).
 */
async function measureBodyRefinement(
  proposal: AgentOrgProposal,
  deps: Required<Pick<MeasureDeps, 'proposalsRepo'>> & MeasureDeps,
): Promise<MeasureOutcome> {
  const proposalsRepo = deps.proposalsRepo!;

  let change: unknown;
  try {
    change = proposal.changeJson ? JSON.parse(proposal.changeJson) : null;
  } catch (err) {
    logger.warn(`[org-proposal-measure] malformed changeJson for '${proposal.id}': ${String(err)}`);
    return 'skipped';
  }

  if (!isBodyRefinementChange(change)) {
    logger.warn(`[org-proposal-measure] '${proposal.id}' changeJson is not a body refinement — skipping`);
    return 'skipped';
  }

  const { scoreSkillBody: scorer } = await import('./skill_refiner');
  const scoreFn = deps.scoreSkillBody ?? scorer;

  const purpose: SkillPurpose = {
    name: change.skillName ?? change.recipeName ?? proposal.title,
    description: change.description ?? null,
    whenToUse: change.whenToUse ?? null,
  };

  const baseline = await scoreFn(purpose, change.priorBody ?? '');
  const post = await scoreFn(purpose, change.revisedBody ?? '');

  const improved = post.score > baseline.score; // STRICTLY greater
  const reason = `baseline=${baseline.score} (${baseline.reason}); post=${post.score} (${post.reason}); decision=${improved ? 'keep' : 'revert'}`;

  if (improved) {
    await proposalsRepo.updateStatusAsync(proposal.id, 'active', {
      baselineScore: baseline.score,
      postScore: post.score,
      measureReason: reason,
    });
    logger.info(`[org-proposal-measure] KEPT '${proposal.id}' (post ${post.score} > baseline ${baseline.score})`);
    return 'kept';
  }

  // Scores + reason are persisted as part of the SAME status-changing update
  // that performs the revert (updateStatusAsync only allows patch fields
  // alongside a real transition) — see doRevert's `patch` param.
  return await doRevert(proposal, deps, {
    baselineScore: baseline.score,
    postScore: post.score,
    measureReason: reason,
  });
}

/**
 * Revert via org_proposal_apply.revertProposal, mapping its outcome to ours.
 * `patch` (audit fields — measureReason/baselineScore/postScore) is applied
 * in the SAME DB update that performs the `measuring -> reverted` status
 * transition, since the repository only accepts patch fields alongside a
 * real status change.
 */
async function doRevert(
  proposal: AgentOrgProposal,
  deps: MeasureDeps,
  patch?: RevertPatch,
): Promise<MeasureOutcome> {
  const outcome = await revertProposal(proposal, deps, patch);
  return outcome === 'reverted' ? 'reverted' : 'skipped';
}
