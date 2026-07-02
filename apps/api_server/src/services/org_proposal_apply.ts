/**
 * org_proposal_apply.ts — #821 (org-optimizer-05)
 *
 * The low-risk AUTO-APPLY step of the org self-optimizer. Takes a
 * `agent_org_proposals` row already classified `risk='low'` by
 * `classifyProposalRisk` (#820), captures `before_snapshot_json` (the exact
 * prior value of whatever it is about to change), applies the change, and
 * transitions the row `proposed -> applied -> measuring` (the state machine
 * in `agent_org_proposals_repository.ts` permits `proposed -> applied`
 * directly — the auto-apply lane per the maintainer's full-autonomy-with-
 * rollback policy, docs/ai/decisions/2026-07-02-autonomy-and-vault-intent.md).
 *
 * `applyProposal` re-checks `classifyProposalRisk` itself rather than
 * trusting the row's stored `risk` column or the caller — this is the load-
 * bearing guard that keeps the auto path low-risk-only even if a caller bug
 * or a future queue regression tries to push a high-risk proposal through.
 *
 * `revertProposal` (used by #821's measure step, `org_proposal_measure.ts`,
 * on a non-improving change) replays `before_snapshot_json` to restore the
 * exact prior state and sets `status='reverted'`. The reverted row is NOT
 * deleted — it remains in the table so `existsByDedupKeyAsync` continues to
 * report the dedup_key as seen, preventing an apply/revert flip-flop loop
 * where the same change gets re-proposed every optimizer run.
 *
 * Only ONE apply target kind is wired in v1: `agent_configs` scope fields
 * (`allowedMcpsJson` / `allowedSkillsJson`), covering `tighten-scope` and
 * `prune-scope` — the two mechanical LOW-risk kinds with a concrete field to
 * snapshot/mutate/restore. `refine-skill` / `consolidate-skill` /
 * `refine-recipe` proposals are also accepted here (their `changeJson` is
 * carried through to `measuring` unmodified — the LLM-scored measure step is
 * what determines keep/revert for those kinds; per the skill loop precedent
 * `skill_apply.ts` these kinds are typically applied by the skill loop
 * itself before this function is invoked, so this function's SNAPSHOT for
 * them is a "prior body" record already present on the change payload
 * rather than a live-system read).
 *
 * Operational envelope (mirrors skill_apply.ts):
 *   • NEVER throws — the caller (the optimizer loop) is fire-and-forget.
 *   • On any unexpected error (malformed changeJson, missing target, etc.),
 *     resolve to `{ status: 'skipped' }` rather than throwing or leaving the
 *     row in an inconsistent state.
 */

import { logger } from '../utils/logger';
import { classifyProposalRisk } from './org_risk_classifier';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import {
  isConsolidationPairingChange,
  draftConsolidationPayload,
  type DraftedConsolidationPayload,
} from './skill_consolidation_drafter';
import type { AgentOrgProposal } from '../models/agent_org_proposal';

export type ApplyOutcome = 'applied-ok' | 'refused-high-risk' | 'skipped';

export interface ApplyResult {
  status: ApplyOutcome;
  reason?: string;
}

/** Shape of the `changeJson` payload for an `agent_configs` scope mutation. */
interface AgentConfigScopeChange {
  agentConfigId: string;
  field: 'allowedMcpsJson' | 'allowedSkillsJson';
  /** Names to remove from the current allowlist (prune-scope / tighten-scope). */
  remove?: string[];
  /** Names to add to the current allowlist (broaden-scope — never reaches here; HIGH). */
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

export interface ApplyDeps {
  /** Injectable proposals repo (defaults to a fresh AgentOrgProposalsRepository). */
  proposalsRepo?: AgentOrgProposalsRepository;
  /** Injectable configs repo (defaults to a fresh AgentConfigsRepository). */
  configsRepo?: AgentConfigsRepository;
  /** Injectable skills repo — used by consolidate-skill apply/revert (#852). */
  skillsRepo?: AgentSkillsRepository;
}

/**
 * Apply a low-risk proposal: snapshot -> mutate -> status='measuring'.
 * NEVER throws. Re-validates risk via {@link classifyProposalRisk} — refuses
 * (and makes NO changes) if the proposal is high-risk by that predicate,
 * regardless of what `proposal.risk` says.
 */
export async function applyProposal(
  proposal: AgentOrgProposal,
  deps: ApplyDeps = {},
): Promise<ApplyResult> {
  try {
    const risk = classifyProposalRisk({
      kind: proposal.kind,
      changeJson: proposal.changeJson,
      external: proposal.external,
    });
    if (risk === 'high') {
      logger.info(
        `[org-proposal-apply] refused '${proposal.id}' (kind=${proposal.kind}) — classified high-risk`,
      );
      return { status: 'refused-high-risk' };
    }

    const proposalsRepo = deps.proposalsRepo ?? new AgentOrgProposalsRepository();
    const configsRepo = deps.configsRepo ?? new AgentConfigsRepository();

    let change: unknown;
    try {
      change = proposal.changeJson ? JSON.parse(proposal.changeJson) : null;
    } catch (err) {
      logger.warn(
        `[org-proposal-apply] malformed changeJson for '${proposal.id}' (non-fatal): ${String(err)}`,
      );
      return { status: 'skipped', reason: 'malformed-change-json' };
    }

    if (isAgentConfigScopeChange(change)) {
      return await applyAgentConfigScopeChange(proposal, change, { proposalsRepo, configsRepo });
    }

    // #852 — consolidate-skill: scope_hygiene_generator.ts only ever emits
    // the pairing shape ({skillIdA, skillIdB, titleA, titleB, similarity}),
    // never a pre-drafted body. Draft it HERE, at apply time, so the
    // resulting change_json is already a BodyRefinementChange by the time
    // the proposal reaches 'measuring' (see skill_consolidation_drafter.ts
    // module doc for why apply-time is the right place: it is the one point
    // both the auto lane and a future human-approved lane pass through).
    if (proposal.kind === 'consolidate-skill' && isConsolidationPairingChange(change)) {
      return await applyConsolidateSkillChange(proposal, change, {
        proposalsRepo,
        skillsRepo: deps.skillsRepo,
      });
    }

    // Non-scope kinds (refine-skill/refine-recipe; consolidate-skill already
    // pre-drafted above): the
    // change payload already carries its own prior/revised bodies (see
    // module doc comment). Snapshot the whole payload as before_snapshot_json
    // verbatim — the measure step (#821 org_proposal_measure.ts) reads the
    // prior body back out of it — and move straight to measuring.
    const updated = await proposalsRepo.updateStatusAsync(proposal.id, 'applied', {
      beforeSnapshotJson: proposal.changeJson ?? JSON.stringify({}),
    });
    if (!updated) {
      return { status: 'skipped', reason: 'proposal-not-found' };
    }
    await proposalsRepo.updateStatusAsync(proposal.id, 'measuring');

    logger.info(`[org-proposal-apply] applied '${proposal.id}' (kind=${proposal.kind}) -> measuring`);
    return { status: 'applied-ok' };
  } catch (err) {
    logger.warn(`[org-proposal-apply] FAILED (non-fatal): ${String(err)}`);
    return { status: 'skipped', reason: String(err) };
  }
}

/**
 * Apply an `agent_configs` scope mutation (tighten-scope / prune-scope):
 * snapshot the field's current value, remove the named entries, persist the
 * change, then transition the proposal to measuring.
 */
async function applyAgentConfigScopeChange(
  proposal: AgentOrgProposal,
  change: AgentConfigScopeChange,
  deps: Required<Pick<ApplyDeps, 'proposalsRepo' | 'configsRepo'>>,
): Promise<ApplyResult> {
  const { proposalsRepo, configsRepo } = deps;

  const config = configsRepo.getById(change.agentConfigId);
  if (!config) {
    logger.warn(
      `[org-proposal-apply] no agent_config '${change.agentConfigId}' for proposal '${proposal.id}'`,
    );
    return { status: 'skipped', reason: 'target-not-found' };
  }

  const priorValue = config[change.field] ?? null;
  const beforeSnapshot = JSON.stringify({ [change.field]: priorValue });

  // 1. Snapshot FIRST (before any mutation) — this is what makes the apply
  //    reversible by construction.
  const snapshotted = await proposalsRepo.updateStatusAsync(proposal.id, 'applied', {
    beforeSnapshotJson: beforeSnapshot,
  });
  if (!snapshotted) {
    return { status: 'skipped', reason: 'proposal-not-found' };
  }

  // 2. Mutate — remove the named entries from the current allowlist.
  const currentList: string[] = priorValue ? safeParseStringArray(priorValue) : [];
  const removeSet = new Set(change.remove ?? []);
  const nextList = currentList.filter((name) => !removeSet.has(name));

  configsRepo.update(change.agentConfigId, { [change.field]: JSON.stringify(nextList) });

  // 3. Advance to measuring.
  await proposalsRepo.updateStatusAsync(proposal.id, 'measuring');

  logger.info(
    `[org-proposal-apply] applied scope prune for '${proposal.id}' on agent_config '${change.agentConfigId}' (${change.field}: removed ${[...removeSet].join(',')}) -> measuring`,
  );
  return { status: 'applied-ok' };
}

/** Shape of the before_snapshot_json a consolidate-skill apply writes (#852). */
interface ConsolidateSkillRevertSnapshot {
  survivorSkillId: string;
  survivorPriorBody: string | null;
  survivorPriorStatus: string;
  retiredSkillId: string;
  retiredPriorBody: string | null;
  retiredPriorStatus: string;
}

function isConsolidateSkillRevertSnapshot(v: unknown): v is ConsolidateSkillRevertSnapshot {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return typeof c.survivorSkillId === 'string' && typeof c.retiredSkillId === 'string';
}

function safeParseStringArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * #852 — Apply a consolidate-skill proposal: resolve both source skills,
 * draft the merged body (skill_consolidation_drafter.ts), write it onto the
 * SURVIVOR (skill A) immediately, retire the redundant skill (skill B,
 * `status='retired'`) immediately, snapshot BOTH skills' pre-merge state
 * into `before_snapshot_json`, reshape `change_json` into the
 * `BodyRefinementChange` shape `org_proposal_measure.ts` recognizes, and
 * transition to `measuring`.
 *
 * Applying the merge (and the retirement) up front — rather than waiting for
 * the measure step to decide — mirrors the `refine-skill` precedent (the
 * skill loop applies before `org_proposal_apply` runs; see this module's
 * doc comment) and is what makes `measureBodyRefinement`'s "score priorBody
 * vs revisedBody" comparison meaningful: `priorBody` is scored as a
 * completely separate concern (the score call takes an explicit body
 * argument, it does not read the live skill), so applying early has no
 * effect on the measure comparison itself, only on how quickly the merge is
 * visible if a caller reads the live skill mid-`measuring`.
 *
 * A missing source skill (deleted since the proposal was generated) is a
 * skip, not a failure — the pairing signal is now stale.
 */
async function applyConsolidateSkillChange(
  proposal: AgentOrgProposal,
  change: { skillIdA: string; skillIdB: string },
  deps: { proposalsRepo: AgentOrgProposalsRepository; skillsRepo?: AgentSkillsRepository },
): Promise<ApplyResult> {
  const { proposalsRepo } = deps;
  const skillsRepo = deps.skillsRepo ?? new AgentSkillsRepository();

  const skillA = skillsRepo.getById(change.skillIdA);
  const skillB = skillsRepo.getById(change.skillIdB);
  if (!skillA || !skillB) {
    logger.warn(
      `[org-proposal-apply] consolidate-skill '${proposal.id}' references a missing skill (a=${change.skillIdA}, b=${change.skillIdB}) — skipping`,
    );
    return { status: 'skipped', reason: 'target-not-found' };
  }

  const drafted: DraftedConsolidationPayload = draftConsolidationPayload(skillA, skillB);

  // Snapshot BOTH skills' pre-merge state — the survivor's prior body/status
  // AND the retired skill's full row content — so revert can restore both.
  const beforeSnapshot = JSON.stringify({
    survivorSkillId: drafted.survivorSkillId,
    survivorPriorBody: skillA.body ?? null,
    survivorPriorStatus: skillA.status,
    retiredSkillId: drafted.retiredSkillId,
    retiredPriorBody: drafted.retiredPriorBody,
    retiredPriorStatus: drafted.retiredPriorStatus,
  });

  // The BodyRefinementChange-shaped payload measureBodyRefinement will read,
  // PLUS the retirement metadata a later revert needs (additive fields the
  // measure step's isBodyRefinementChange()/measureBodyRefinement() simply
  // ignore — see skill_consolidation_drafter.ts's DraftedConsolidationPayload
  // doc comment).
  const draftedChangeJson = JSON.stringify(drafted);

  // 1. Snapshot + reshape change_json FIRST — reversible by construction.
  const snapshotted = await proposalsRepo.updateStatusAsync(proposal.id, 'applied', {
    beforeSnapshotJson: beforeSnapshot,
    changeJson: draftedChangeJson,
  });
  if (!snapshotted) {
    return { status: 'skipped', reason: 'proposal-not-found' };
  }

  // 2. Mutate the live skills: write the merged body onto the survivor,
  //    retire the redundant one. Never throws — a write failure here is
  //    reported as skipped (the snapshot already recorded above still makes
  //    a later best-effort revert possible for whichever half succeeded).
  try {
    skillsRepo.update(drafted.survivorSkillId, { body: drafted.revisedBody });
    skillsRepo.update(drafted.retiredSkillId, { status: 'retired' });
  } catch (err) {
    logger.warn(
      `[org-proposal-apply] consolidate-skill '${proposal.id}' failed writing merged/retired skills (non-fatal): ${String(err)}`,
    );
    return { status: 'skipped', reason: 'skill-write-failed' };
  }

  // 3. Advance to measuring.
  await proposalsRepo.updateStatusAsync(proposal.id, 'measuring');

  logger.info(
    `[org-proposal-apply] applied consolidate-skill for '${proposal.id}' (survivor=${drafted.survivorSkillId}, retired=${drafted.retiredSkillId}) -> measuring`,
  );
  return { status: 'applied-ok' };
}

export type RevertOutcome = 'reverted' | 'skipped';

/** Audit fields the measure step may want persisted alongside the revert transition. */
export interface RevertPatch {
  baselineScore?: number | null;
  postScore?: number | null;
  measureReason?: string | null;
}

/**
 * Restore a measuring proposal to its `before_snapshot_json` state and mark
 * it `reverted`. NEVER throws. The row is retained (not deleted) so the
 * dedup guard continues to treat the change as seen. `patch` (optional) is
 * applied in the SAME update that performs the status transition, so a
 * caller (e.g. the LLM-scored measure step) can persist baseline/post scores
 * and a reason atomically with the revert.
 */
export async function revertProposal(
  proposal: AgentOrgProposal,
  deps: ApplyDeps = {},
  patch?: RevertPatch,
): Promise<RevertOutcome> {
  try {
    const proposalsRepo = deps.proposalsRepo ?? new AgentOrgProposalsRepository();
    const configsRepo = deps.configsRepo ?? new AgentConfigsRepository();

    if (!proposal.beforeSnapshotJson) {
      logger.warn(`[org-proposal-apply] no before_snapshot_json for '${proposal.id}' — cannot revert`);
      return 'skipped';
    }

    let snapshot: Record<string, unknown>;
    try {
      snapshot = JSON.parse(proposal.beforeSnapshotJson);
    } catch (err) {
      logger.warn(`[org-proposal-apply] unparseable snapshot for '${proposal.id}': ${String(err)}`);
      return 'skipped';
    }

    let change: unknown = null;
    try {
      change = proposal.changeJson ? JSON.parse(proposal.changeJson) : null;
    } catch {
      change = null;
    }

    if (isAgentConfigScopeChange(change)) {
      const priorValue = snapshot[change.field];
      configsRepo.update(change.agentConfigId, {
        [change.field]: typeof priorValue === 'string' ? priorValue : null,
      });
    } else if (proposal.kind === 'consolidate-skill' && isConsolidateSkillRevertSnapshot(snapshot)) {
      // #852 — restore BOTH skills to their exact pre-merge state: the
      // survivor's original body/status, and the retired skill's original
      // body/status (undoing the retirement, not just the body write).
      const skillsRepo = deps.skillsRepo ?? new AgentSkillsRepository();
      skillsRepo.update(snapshot.survivorSkillId, {
        body: snapshot.survivorPriorBody,
        status: snapshot.survivorPriorStatus,
      });
      skillsRepo.update(snapshot.retiredSkillId, {
        body: snapshot.retiredPriorBody,
        status: snapshot.retiredPriorStatus,
      });
    }
    // Other non-scope kinds (refine-skill/refine-recipe) carry no live-system
    // side effect to undo here (the skill/recipe body itself is restored by
    // the skill loop's own revert path when those kinds are actually wired
    // to it); reverting the proposal's OWN status is still the correct
    // action for the dedup guard.

    await proposalsRepo.updateStatusAsync(proposal.id, 'reverted', patch);
    logger.info(`[org-proposal-apply] reverted '${proposal.id}' (kind=${proposal.kind})`);
    return 'reverted';
  } catch (err) {
    logger.warn(`[org-proposal-apply] revert FAILED (non-fatal): ${String(err)}`);
    return 'skipped';
  }
}
