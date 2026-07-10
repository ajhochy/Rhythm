/**
 * refine_skill_generator.ts — #976 (org-optimizer skill-effectiveness lane)
 *
 * The missing per-skill QUALITY generator. The other generators cover scope
 * hygiene, recipes, webhooks, and workflow signals; nothing ever produced a
 * `refine-skill` proposal from "this ACTIVE skill is underperforming", so a
 * promoted skill was frozen — the harvest loop drops it at promotion
 * (draft→active) and the org-optimizer never picked it back up.
 *
 * This closes that gap: it surveys `snapshot.skills` (from `skillsRepo.list()`),
 * flags active/published skills that show weak effectiveness, pre-drafts an
 * improved body via `skill_refiner.rewriteSkillBody` (so the human reviews the
 * ACTUAL proposed rewrite), and emits a `refine-skill` proposal shaped as the
 * `BodyRefinementChange` the existing `org_proposal_measure` / apply path
 * already consumes — no new apply machinery.
 *
 * PATH B — HUMAN-GATED (AJ, 2026-07-09). Proposals are stored with
 * `risk: 'high'` so the run loop's gate (`org_optimizer_run_service.ts` — the
 * `proposal.risk !== 'low'` check) queues them in `proposed` for human
 * approval instead of auto-applying. `refine-skill` is a LOW_RISK_KIND in
 * `org_risk_classifier.ts`; storing `'high'` overrides that, exactly as
 * `scope_hygiene_generator.ts` escalates a user-authored prune. A weak skill
 * is NEVER auto-mutated by this generator, and #959 (a depended-on skill must
 * not break its dependent agent) is inherently respected — every proposal is
 * human-gated; the rationale additionally NAMES any dependent agents so the
 * reviewer sees the blast radius.
 *
 * Candidate rules:
 *   - status ∈ {active, published} only. `draft` is the harvest loop's
 *     (avoid double-management); `measuring`/`reverted` are in-flight/terminal.
 *   - #857 data-sufficiency guard: all-null scores AND uses:0 = UNOBSERVED,
 *     not weak — skipped. A weakness judgement needs at least one observation.
 *
 * Cost bound: at most `maxDrafts` LLM rewrite calls per run (threaded from the
 * optimizer's `maxLlmCallsPerRun`). Dedup is checked BEFORE drafting so an
 * already-proposed skill never spends an LLM call.
 *
 * Operational envelope (mirrors scope_hygiene_generator.ts):
 *   • NEVER throws — the caller is the fire-and-forget optimizer loop.
 *   • A single malformed/failed skill is logged and skipped, never fatal.
 */

import { logger } from '../../utils/logger';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
import { rewriteSkillBody, type SkillPurpose } from '../skill_refiner';
import type { OrgAuditSnapshot } from '../org_audit_service';
import type { AgentSkill } from '../../models/agent_skill';
import type { AgentOrgProposalInput } from '../../models/agent_org_proposal';

/**
 * `changeJson` shape the `refine-skill` measure/apply path expects
 * (`org_proposal_measure.isBodyRefinementChange`: string `priorBody` +
 * string `revisedBody`, everything else optional). Defined locally to keep
 * this generator a leaf — the measure module owns the authoritative copy.
 */
interface BodyRefinementChange {
  skillName: string;
  priorBody: string;
  revisedBody: string;
  description?: string | null;
  whenToUse?: string | null;
}

/** Only these statuses are org-optimizer candidates (see module doc). */
const CANDIDATE_STATUSES = new Set<string>(['active', 'published']);

/**
 * Below the harvest evaluator's KEEP_SCORE_BAR (61): a measured body that does
 * not clear the "accurate, reasonably complete, actionable" band is weak.
 */
const WEAK_POST_SCORE_BAR = 61;
/** Mirrors skill_retrieval's DRAFT_CONFIDENCE_GATE (0.6): below-gate confidence is weak. */
const WEAK_CONFIDENCE_GATE = 0.6;
/** Conservative default LLM-draft bound for direct callers; the run service overrides with maxLlmCallsPerRun. */
const DEFAULT_MAX_DRAFTS = 5;

export interface RefineSkillGeneratorDeps {
  /** Injectable proposals repo (defaults to a fresh AgentOrgProposalsRepository). */
  proposalsRepo?: Pick<AgentOrgProposalsRepository, 'createAsync' | 'existsByDedupKeyAsync'>;
  /** Max LLM rewrite drafts this run (threaded from the optimizer's maxLlmCallsPerRun). Default 5. */
  maxDrafts?: number;
}

/**
 * Returns a human-readable weakness reason for a candidate skill, or null if
 * the skill is not weak (or is UNOBSERVED per the #857 guard).
 */
function weaknessReason(skill: AgentSkill): string | null {
  // #857 data-sufficiency guard: no scores AND never used = unobserved, not
  // weak. Do not flag a freshly-promoted skill that simply has no history yet.
  if (skill.baselineScore == null && skill.postScore == null && skill.uses === 0) {
    return null;
  }

  const reasons: string[] = [];
  if (skill.postScore != null && skill.postScore < WEAK_POST_SCORE_BAR) {
    reasons.push(`postScore=${skill.postScore} below quality bar ${WEAK_POST_SCORE_BAR}`);
  }
  if (skill.baselineScore != null && skill.postScore != null && skill.postScore <= skill.baselineScore) {
    reasons.push(`postScore=${skill.postScore} did not beat baselineScore=${skill.baselineScore} (last revision gained nothing)`);
  }
  if (skill.confidence < WEAK_CONFIDENCE_GATE) {
    reasons.push(`confidence=${skill.confidence.toFixed(2)} below gate ${WEAK_CONFIDENCE_GATE}`);
  }
  return reasons.length > 0 ? reasons.join('; ') : null;
}

function buildRefineSkillProposalInput(params: {
  auditRunId: string;
  skill: AgentSkill;
  reason: string;
  priorBody: string;
  revisedBody: string;
  dedupKey: string;
  dependentAgents: string[];
}): AgentOrgProposalInput {
  const { auditRunId, skill, reason, priorBody, revisedBody, dedupKey, dependentAgents } = params;

  const change: BodyRefinementChange = {
    skillName: skill.title,
    priorBody,
    revisedBody,
    description: skill.description,
    whenToUse: skill.whenToUse,
  };

  const dependencyNote =
    dependentAgents.length > 0
      ? ` Depended on by agent(s): ${dependentAgents.join(', ')} — human-gated so a refine cannot silently break the dependent agent (#959).`
      : '';

  const rationale =
    `refine-skill: ${skill.status} skill '${skill.title}' (id=${skill.id} v${skill.version}) shows weak effectiveness — ` +
    `${reason} [uses=${skill.uses}]. Pre-drafted an improved body for human review; queued, never auto-applied.${dependencyNote}`;

  return {
    kind: 'refine-skill',
    // Path B: HIGH stored → the run loop queues it in `proposed` for human
    // approval. (refine-skill is a LOW_RISK_KIND; this override mirrors
    // scope_hygiene's user-authored-prune escalation.)
    risk: 'high',
    title: `Refine underperforming skill '${skill.title}'`,
    rationale,
    signalRef: null,
    targetRef: `skill:${skill.id}`,
    changeJson: JSON.stringify(change),
    dedupKey,
    auditRunId,
  };
}

/**
 * Generate human-gated `refine-skill` proposals from an already-built
 * `OrgAuditSnapshot`. NEVER throws. See module doc comment.
 */
export async function generateRefineSkillProposals(
  snapshot: OrgAuditSnapshot,
  deps: RefineSkillGeneratorDeps = {},
): Promise<void> {
  const proposalsRepo = deps.proposalsRepo ?? new AgentOrgProposalsRepository();
  const maxDrafts = deps.maxDrafts ?? DEFAULT_MAX_DRAFTS;
  let draftsUsed = 0;

  for (const skill of snapshot.skills) {
    try {
      if (!CANDIDATE_STATUSES.has(skill.status)) continue;

      const reason = weaknessReason(skill);
      if (!reason) continue;

      // Stable dedup key — bumps to :v2 only when the skill is genuinely
      // re-refined (version bump), so a reverted attempt never flip-flops.
      const dedupKey = `refine-skill:${skill.id}:v${skill.version}`;
      if (await proposalsRepo.existsByDedupKeyAsync(dedupKey)) {
        logger.info(`[refine-skill-generator] skipped duplicate proposal for dedup_key='${dedupKey}'`);
        continue;
      }

      if (draftsUsed >= maxDrafts) {
        logger.info(
          `[refine-skill-generator] LLM draft budget (${maxDrafts}) reached — deferring remaining weak skills to next run`,
        );
        break;
      }

      const priorBody = skill.body ?? '';
      const purpose: SkillPurpose = {
        name: skill.title,
        description: skill.description,
        whenToUse: skill.whenToUse,
      };
      const revisedBody = await rewriteSkillBody(purpose, priorBody, reason);
      draftsUsed += 1;

      // rewriteSkillBody is fail-closed: it returns the body UNCHANGED on any
      // failure. A no-op rewrite would only tie on measure and revert — do not
      // queue a human review for a non-change.
      if (revisedBody.trim().length === 0 || revisedBody.trim() === priorBody.trim()) {
        logger.info(`[refine-skill-generator] rewriter produced no improvement for skill '${skill.id}' — skipping`);
        continue;
      }

      const dependentAgents = snapshot.profiles
        .filter((p) => p.allowedSkills.includes(skill.title))
        .map((p) => p.label);

      const input = buildRefineSkillProposalInput({
        auditRunId: snapshot.auditRunId,
        skill,
        reason,
        priorBody,
        revisedBody,
        dedupKey,
        dependentAgents,
      });

      try {
        await proposalsRepo.createAsync(input);
      } catch (createErr) {
        // The dominant cause is the #830 per-run proposal cap, after which
        // every further create throws too. Stop here to avoid wasted LLM
        // drafts; remaining weak skills are re-evaluated next run.
        logger.info(
          `[refine-skill-generator] stopping run — proposal create failed (likely #830 per-run cap): ${String(createErr)}`,
        );
        break;
      }
    } catch (err) {
      logger.warn(`[refine-skill-generator] FAILED processing skill '${skill.id}' (non-fatal): ${String(err)}`);
    }
  }
}
