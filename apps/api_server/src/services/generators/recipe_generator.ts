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
import type { AgentOrgProposal } from '../../models/agent_org_proposal';
import type { AgentCookbook } from '../../repositories/agent_cookbook_repository';
import type { OrgAuditGap, OrgAuditSnapshot } from '../org_audit_service';

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
