/**
 * recipe_generator.ts — #823 (org-optimizer-07)
 *
 * Generates two proposal kinds from the read-only `OrgAuditSnapshot` (#819)
 * plus the existing `agent_cookbook` table (recipes):
 *
 *   - `create-recipe` (HIGH, gated): a repeated multi-step prompt pattern
 *     across sessions with NO matching cookbook entry. `change_json` carries
 *     the proposed `title` / `description` / `steps_json` — this is a NEW
 *     prompt the org would run unattended, so per the issue it stays gated
 *     even under the 2026-07-02 full-autonomy-with-rollback policy (see
 *     docs/ai/decisions/2026-07-02-autonomy-and-vault-intent.md — the policy
 *     explicitly calls out create-recipe as staying gated while refine-recipe
 *     rides the auto path; `classifyProposalRisk` already hard-codes this
 *     split in LOW_RISK_KINDS/HIGH_RISK_KINDS, so this generator only needs
 *     to emit the correct `kind` and never invents its own risk value).
 *
 *   - `refine-recipe` (LOW, auto): an existing cookbook recipe whose body
 *     (compiled from its `stepsJson`, mirroring
 *     agentCookbookController._compileStepsToPrompt) scores below the
 *     "adequate" bar against its own stated purpose (title + description),
 *     via the SAME purpose-anchored scorer #821 reuses
 *     (`skill_refiner.scoreSkillBody`). `change_json` is a `BodyRefinementChange`
 *     (`recipeName`/`priorBody`/`revisedBody`/`description`/`whenToUse`) — the
 *     EXACT shape `org_proposal_measure.measureBodyRefinement` already knows
 *     how to consume, so #821's measure/keep/revert loop works unmodified.
 *
 * Signal source (per this issue's ownership note — org_audit_service.ts is
 * NOT edited here): `OrgAuditSnapshot.gaps` already surfaces repeated
 * task-title clusters as `kind: 'webhook-wiring'` gaps (see
 * org_audit_service.ts's `detectWebhookGaps` — evidence format
 * `pattern="<title>" count=<n> sessionIds=<ids>`). That gap only checks
 * `agent_webhook_endpoints` wiring, not cookbook coverage, so this generator
 * re-reads the SAME evidence and additionally checks it against
 * `snapshot.recipes` (the cookbook) for a title/description match before
 * deciding a `create-recipe` proposal is warranted. This keeps the repeated-
 * pattern DETECTION logic centralized in org_audit_service (single source of
 * truth for "what counts as a repeated pattern") while this generator owns
 * only the recipe-specific decision (is there already an adequate recipe?).
 *
 * Operational envelope (mirrors skill_refiner.ts / org_proposal_apply.ts):
 *   • NEVER throws — the caller (the optimizer loop) is fire-and-forget.
 *   • Idempotent via `dedup_key` — `agent_org_proposals_repository.createAsync`
 *     is itself idempotent on dedupKey, so a duplicate call here is a safe
 *     no-op (existing row returned, no double-insert).
 */

import { logger } from '../../utils/logger';
import { classifyProposalRisk } from '../org_risk_classifier';
import { scoreSkillBody, type ScoreCall, type SkillPurpose } from '../skill_refiner';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
import { AgentCookbookRepository } from '../../repositories/agent_cookbook_repository';
import type { AgentOrgProposal } from '../../models/agent_org_proposal';
import type { AgentCookbook } from '../../repositories/agent_cookbook_repository';
import type { OrgAuditGap, OrgAuditSnapshot } from '../org_audit_service';
import type { ProposalApplier, ProposalApplyResult } from '../org_proposal_apply_service';

/** Below this score, an existing recipe's body is considered improvable (refine candidate). */
const RECIPE_ADEQUACY_THRESHOLD = 70;

export interface RecipeGeneratorDeps {
  /** Injectable proposals repo (defaults to a fresh AgentOrgProposalsRepository). */
  proposalsRepo?: AgentOrgProposalsRepository;
  /** Injectable purpose-anchored scorer (defaults to skill_refiner.scoreSkillBody's real impl). */
  scorer?: ScoreCall;
}

export interface RecipeGeneratorResult {
  created: AgentOrgProposal[];
}

/** Deterministic FNV-1a hash — mirrors org_audit_service.stableGapId's approach. */
function stableHash(...parts: string[]): string {
  const input = parts.join('::');
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/** Parse a `webhook-wiring` gap's evidence string into its pattern/count/sessionIds parts. */
function parseRepeatedPatternEvidence(
  evidence: string,
): { pattern: string; count: number; sessionIds: string[] } | null {
  const patternMatch = evidence.match(/pattern="([^"]*)"/);
  const countMatch = evidence.match(/count=(\d+)/);
  const sessionIdsMatch = evidence.match(/sessionIds=([^\s]*)/);
  if (!patternMatch || !countMatch) return null;
  const sessionIds = sessionIdsMatch && sessionIdsMatch[1] ? sessionIdsMatch[1].split(',') : [];
  return { pattern: patternMatch[1], count: parseInt(countMatch[1], 10), sessionIds };
}

/** Extract the repeated multi-step prompt patterns surfaced by org_audit_service's gaps. */
function extractRepeatedPatterns(
  gaps: OrgAuditGap[],
): { gapId: string; pattern: string; count: number; sessionIds: string[] }[] {
  const out: { gapId: string; pattern: string; count: number; sessionIds: string[] }[] = [];
  for (const gap of gaps) {
    if (gap.kind !== 'webhook-wiring') continue;
    const parsed = parseRepeatedPatternEvidence(gap.evidence);
    if (!parsed) continue;
    out.push({ gapId: gap.gapId, ...parsed });
  }
  return out;
}

/** Case-insensitive, trimmed equality — the "same recipe" title check. */
function titleMatches(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Find a cookbook recipe whose title matches a repeated-pattern name, if any. */
function findMatchingRecipe(pattern: string, recipes: AgentCookbook[]): AgentCookbook | null {
  return recipes.find((r) => titleMatches(r.title, pattern)) ?? null;
}

/** Compile a recipe's stepsJson into plain text — mirrors agentCookbookController._compileStepsToPrompt. */
function compileStepsToBody(stepsJson: string): string {
  try {
    const steps = JSON.parse(stepsJson) as unknown[];
    if (!Array.isArray(steps) || steps.length === 0) return '';
    return steps
      .map((step, i) => {
        if (typeof step === 'string') return `${i + 1}. ${step}`;
        if (typeof step === 'object' && step !== null) {
          const s = step as Record<string, unknown>;
          const label =
            typeof s.text === 'string'
              ? s.text
              : typeof s.description === 'string'
                ? s.description
                : typeof s.action === 'string'
                  ? s.action
                  : JSON.stringify(s);
          return `${i + 1}. ${label}`;
        }
        return `${i + 1}. ${String(step)}`;
      })
      .join('\n');
  } catch {
    return stepsJson;
  }
}

/** Build a minimal `steps_json` proposal from a repeated pattern's title (the pattern IS the prompt to templatize). */
function proposeStepsForPattern(pattern: string): string {
  return JSON.stringify([{ action: 'prompt', text: pattern }]);
}

async function proposeCreateRecipe(
  entry: { gapId: string; pattern: string; count: number; sessionIds: string[] },
  proposalsRepo: AgentOrgProposalsRepository,
): Promise<AgentOrgProposal | null> {
  const dedupKey = `create-recipe:${stableHash(entry.pattern)}`;
  if (await proposalsRepo.existsByDedupKeyAsync(dedupKey)) {
    return null;
  }

  const title = entry.pattern;
  const description = `Repeated prompt pattern observed ${entry.count} times across sessions with no matching recipe.`;
  const stepsJson = proposeStepsForPattern(entry.pattern);

  const changeJson = JSON.stringify({ title, description, steps_json: stepsJson });
  const risk = classifyProposalRisk({ kind: 'create-recipe', changeJson });

  const proposal = await proposalsRepo.createAsync({
    kind: 'create-recipe',
    risk,
    title: `Create recipe: ${title}`,
    rationale: description,
    signalRef: `gap:${entry.gapId}`,
    targetRef: null,
    changeJson,
    dedupKey,
  });
  logger.info(
    `[recipe-generator] proposed create-recipe '${proposal.id}' for pattern="${entry.pattern}" (risk=${risk})`,
  );
  return proposal;
}

async function proposeRefineRecipe(
  recipe: AgentCookbook,
  scorer: ScoreCall,
  proposalsRepo: AgentOrgProposalsRepository,
): Promise<AgentOrgProposal | null> {
  const priorBody = compileStepsToBody(recipe.stepsJson);
  const purpose: SkillPurpose = {
    name: recipe.title,
    description: recipe.description ?? null,
  };

  const { score } = await scoreSkillBody(purpose, priorBody, scorer);
  if (score >= RECIPE_ADEQUACY_THRESHOLD) {
    // Already adequate — no refinement candidate.
    return null;
  }

  const dedupKey = `refine-recipe:${recipe.id}:${stableHash(priorBody)}`;
  if (await proposalsRepo.existsByDedupKeyAsync(dedupKey)) {
    return null;
  }

  // The revised body is a candidate for a human/optimizer-authored rewrite;
  // v1 proposes a structured-steps expansion of the recipe's own description
  // as the revision seed — the #821 measure step is what decides keep/revert
  // by re-scoring priorBody vs revisedBody, so this generator only needs to
  // supply a plausible candidate, not a perfect one.
  const revisedBody = [
    priorBody,
    '',
    recipe.description ? `Goal: ${recipe.description}` : null,
    'Clarify each step with a concrete input, action, and expected output.',
  ]
    .filter((l): l is string => Boolean(l))
    .join('\n');

  const changeJson = JSON.stringify({
    recipeName: recipe.title,
    priorBody,
    revisedBody,
    description: recipe.description ?? null,
  });
  const risk = classifyProposalRisk({ kind: 'refine-recipe', changeJson });

  const proposal = await proposalsRepo.createAsync({
    kind: 'refine-recipe',
    risk,
    title: `Refine recipe: ${recipe.title}`,
    rationale: `Recipe body scored ${score}/100 against its stated purpose (below adequacy threshold ${RECIPE_ADEQUACY_THRESHOLD}).`,
    signalRef: `recipe:${recipe.id}`,
    targetRef: `recipe:${recipe.id}`,
    changeJson,
    dedupKey,
  });
  logger.info(
    `[recipe-generator] proposed refine-recipe '${proposal.id}' for recipe '${recipe.title}' (score=${score}, risk=${risk})`,
  );
  return proposal;
}

/**
 * Generate `create-recipe` and `refine-recipe` proposals from the org audit
 * snapshot. NEVER throws — an unexpected error anywhere in the scan resolves
 * to whatever proposals were successfully created before the failure (an
 * empty list in the worst case), never a crash of the fire-and-forget
 * optimizer loop.
 */
export async function generateRecipeProposals(
  snapshot: OrgAuditSnapshot,
  deps: RecipeGeneratorDeps = {},
): Promise<RecipeGeneratorResult> {
  const proposalsRepo = deps.proposalsRepo ?? new AgentOrgProposalsRepository();
  const created: AgentOrgProposal[] = [];

  try {
    const patterns = extractRepeatedPatterns(snapshot.gaps);
    for (const entry of patterns) {
      try {
        const existing = findMatchingRecipe(entry.pattern, snapshot.recipes);
        if (existing) {
          // An adequate recipe already exists for this pattern by name —
          // no create-recipe proposal. (It may still be a refine-recipe
          // candidate, handled in the loop below over ALL recipes.)
          continue;
        }
        const proposal = await proposeCreateRecipe(entry, proposalsRepo);
        if (proposal) created.push(proposal);
      } catch (err) {
        logger.warn(`[recipe-generator] create-recipe candidate failed (non-fatal): ${String(err)}`);
      }
    }

    const scorer: ScoreCall = deps.scorer ?? ((purpose, body) => scoreSkillBody(purpose, body));
    for (const recipe of snapshot.recipes) {
      try {
        const proposal = await proposeRefineRecipe(recipe, scorer, proposalsRepo);
        if (proposal) created.push(proposal);
      } catch (err) {
        logger.warn(`[recipe-generator] refine-recipe candidate failed (non-fatal): ${String(err)}`);
      }
    }
  } catch (err) {
    logger.warn(`[recipe-generator] FAILED (non-fatal): ${String(err)}`);
  }

  return { created };
}

// ── Apply step for `create-recipe` (#851 / org-optimizer-17) ───────────────
//
// `create-recipe` is HIGH risk (org_risk_classifier.ts's HIGH_RISK_KINDS) and
// therefore is NEVER reachable from the low-risk auto-apply lane
// (org_proposal_apply.ts's `applyProposal` re-derives risk via
// `classifyProposalRisk` and refuses anything not 'low' before it would ever
// look at a registered applier). This applier only ever runs through
// org_proposal_apply_service.ts's `applyProposal`, and only after a human
// approves the proposal on the review queue (status: 'approved' ->
// applyProposal -> 'applied').
//
// Idempotency: guarded by title. `AgentCookbookRepository` has no dedicated
// "applied" marker column, so — mirroring `agent_org_proposals_repository
// .createAsync`'s own dedup-by-key precedent — this applier checks for an
// existing cookbook row with the same (case-insensitive, trimmed) title
// before inserting. A second approval of the same proposal (e.g. a retried
// request) returns the existing row's id in beforeSnapshotJson rather than
// creating a duplicate recipe.
//
// Revert: `beforeSnapshotJson` carries `{ createdCookbookId }` — the id of
// the row this apply step created (or, on the idempotent replay path, the
// pre-existing row it matched). A future revert consumer removes the recipe
// via `AgentCookbookRepository.deleteAsync(createdCookbookId)`. This mirrors
// webhook_wiring_generator.ts's `applyWebhookWiring`, which stores
// `{ createdEndpointId }` for the same reason: org_proposal_apply.ts's
// generic `revertProposal` only has a bespoke branch for
// `agent_configs` scope changes, so a gated kind's own before-snapshot shape
// is the durable, self-describing record of what to undo.

/** Structural subset of `create-recipe`'s change_json this applier reads. */
interface CreateRecipeChange {
  title?: string;
  description?: string | null;
  steps_json?: string;
  boundConfigId?: string | null;
}

function parseCreateRecipeChange(proposal: AgentOrgProposal): CreateRecipeChange | null {
  if (!proposal.changeJson) return null;
  try {
    const parsed: unknown = JSON.parse(proposal.changeJson);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as CreateRecipeChange;
    }
    return null;
  } catch {
    return null;
  }
}

export interface CreateRecipeApplierDeps {
  /** Injectable cookbook repo (defaults to a fresh AgentCookbookRepository). */
  cookbookRepo?: AgentCookbookRepository;
}

/**
 * The `create-recipe` apply step. Runs ONLY after a human approves — see the
 * module doc above. Creates an `agent_cookbook` row from the proposal's
 * `change_json` (`title`/`description`/`steps_json`, plus `boundConfigId`
 * when the proposal names one), routed exclusively through
 * `AgentCookbookRepository.createAsync` — the same path
 * `agentCookbookController` uses for a manually-created recipe.
 */
export function buildCreateRecipeApplier(deps: CreateRecipeApplierDeps = {}): ProposalApplier {
  const cookbookRepo = deps.cookbookRepo ?? new AgentCookbookRepository();

  return async (proposal: AgentOrgProposal): Promise<ProposalApplyResult> => {
    const change = parseCreateRecipeChange(proposal);
    if (!change || typeof change.title !== 'string' || !change.title.trim()) {
      throw new Error(`create-recipe proposal ${proposal.id} has no valid change_json.title`);
    }

    const title = change.title.trim();

    // Idempotency guard: a matching recipe (by case-insensitive, trimmed
    // title) already exists — either from a prior approval of this exact
    // proposal, or a recipe independently created with the same title.
    // Either way, do not insert a duplicate; report the existing row so
    // revert still has a valid target.
    const existingAll = await cookbookRepo.listAllAsync();
    const existing = existingAll.find((r) => titleMatches(r.title, title));
    if (existing) {
      logger.info(
        `[recipe-generator] create-recipe apply for '${proposal.id}' is a no-op — cookbook '${existing.id}' already has title="${title}"`,
      );
      return {
        measurable: false,
        beforeSnapshotJson: JSON.stringify({ createdCookbookId: existing.id }),
      };
    }

    const created = await cookbookRepo.createAsync({
      title,
      description: change.description ?? undefined,
      stepsJson: change.steps_json ?? undefined,
      boundConfigId: change.boundConfigId ?? undefined,
    });

    logger.info(
      `[recipe-generator] create-recipe apply for '${proposal.id}' created cookbook '${created.id}' (title="${title}")`,
    );

    return {
      // A freshly created recipe has no usage history yet to measure
      // keep/revert against — mirrors webhook_wiring_generator.ts's
      // applyWebhookWiring, which is also measurable: false for the same
      // reason (nothing to compare a brand-new artifact's performance to).
      measurable: false,
      beforeSnapshotJson: JSON.stringify({ createdCookbookId: created.id }),
    };
  };
}

/** Minimal shape of the shared apply-service registry this plugs into. */
export interface CreateRecipeApplierRegistry {
  registerProposalApplier: (kind: string, applier: ProposalApplier) => void;
}

/**
 * Register the `create-recipe` applier on the shared
 * `org_proposal_apply_service` registry. Callers pass the registry (rather
 * than this module importing `org_proposal_apply_service` and mutating it
 * directly at import time) so registration is explicit and test-controlled —
 * mirrors the seam documented in org_proposal_apply_service.ts's module doc
 * ("Kinds are registered via {@link registerProposalApplier} so future
 * generator issues plug in without touching this file's control flow").
 * `org_proposal_appliers_wiring.ts` (#830, amended by #851) calls this once
 * at server startup.
 */
export function registerCreateRecipeApplier(
  registry: CreateRecipeApplierRegistry,
  deps: CreateRecipeApplierDeps = {},
): void {
  registry.registerProposalApplier('create-recipe', buildCreateRecipeApplier(deps));
}
