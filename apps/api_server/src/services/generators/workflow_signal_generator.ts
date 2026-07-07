/**
 * workflow_signal_generator.ts — issue #935 (org-optimizer-workflow-signals).
 *
 * Feeds `OrgAuditSnapshot.workflowFailureSignals` (#934,
 * workflow_failure_signal_extractor.ts) into the EXISTING optimizer proposal
 * kinds — this is explicitly NOT a separate "workflow optimizer" pipeline
 * (out of scope per #935). It only ever produces `refine-recipe` (low-risk,
 * auto-apply path, reusing recipe_generator.ts's own scorer/dedup/apply/
 * measure machinery unmodified) or hands a repeated `delegated-failure`
 * pattern to the existing `delegation_generator.generateDelegationProposals`
 * (high-risk, always queued for human review).
 *
 * Mapping (per the issue's suggested table):
 *   - `session-errored` on a session bound to a cookbook recipe (via
 *     `agent_sessions.mcpRole` -> `agent_cookbook.boundConfigId`) is treated
 *     as evidence that recipe needs refining — routed through the SAME
 *     `refine-recipe` candidate `recipe_generator.proposeRefineRecipeFromSignal`
 *     scores/dedupes on, so it inherits every existing safety property
 *     (purpose-anchored scorer gate, dedup_key idempotency, low-risk
 *     auto-apply + measure/revert).
 *   - `delegated-failure` is LOW-CONFIDENCE on a single occurrence (a lone
 *     child-session failure says nothing about whether delegation itself is
 *     the gap — could be a one-off transient error). Only when the SAME
 *     manager session has >= MIN_DELEGATED_FAILURE_OCCURRENCES delegated
 *     child failures do we treat it as "real evidence of a delegation gap"
 *     and hand it to `generateDelegationProposals` — which itself stays
 *     high-risk/queued (grant-delegation/expand-delegation are in
 *     `HIGH_RISK_KINDS`; this module never bypasses that).
 *   - `tool-error` is not handled here: the extractor's tool-error detection
 *     loop is a documented no-op stub (see workflow_failure_signal_extractor.ts)
 *     and does not currently emit any signals of that kind — there is
 *     nothing to wire yet, and per the issue this module must not redesign
 *     the extractor.
 *
 * NEVER throws — mirrors every other generator (fire-and-forget optimizer
 * loop caller).
 */

import { logger } from '../../utils/logger';
import { scoreSkillBody, type ScoreCall, type SkillPurpose } from '../skill_refiner';
import { classifyProposalRisk } from '../org_risk_classifier';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
import { AgentConfigsRepository, type AgentConfig } from '../../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../../repositories/agent_sessions_repository';
import {
  generateDelegationProposals,
  type DelegationRedoSignal,
} from './delegation_generator';
import type { AgentCookbook } from '../../repositories/agent_cookbook_repository';
import type { AgentOrgProposal } from '../../models/agent_org_proposal';
import type { OrgAuditSnapshot } from '../org_audit_service';
import type { WorkflowFailureSignal } from '../workflow_failure_signal_extractor';

/** Below this score, an existing recipe's body is a refine candidate — mirrors recipe_generator.ts's own threshold. */
const RECIPE_ADEQUACY_THRESHOLD = 70;

/**
 * A single delegated-failure signal is low-confidence (one bad run tells you
 * nothing about a systemic delegation gap). Require a repeated pattern for
 * the SAME manager session before treating it as real evidence.
 */
const MIN_DELEGATED_FAILURE_OCCURRENCES = 2;

/**
 * Pull the specialist (delegate target) id out of a generated delegation
 * proposal's `change_json` (`{agentConfigId, allowed_delegates_json: {add:
 * [targetId]}}` — see delegation_generator.ts). Used only to build a
 * kind-independent dedup key here; returns null on any unexpected shape
 * rather than throwing (this module never throws).
 */
function parseSpecialistIdFromChange(changeJson: string): string | null {
  try {
    const parsed = JSON.parse(changeJson) as { allowed_delegates_json?: { add?: unknown[] } };
    const add = parsed.allowed_delegates_json?.add;
    return Array.isArray(add) && typeof add[0] === 'string' ? add[0] : null;
  } catch {
    return null;
  }
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

/** Compile a recipe's stepsJson into plain text — mirrors recipe_generator.ts's compileStepsToBody. */
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

export interface WorkflowSignalGeneratorDeps {
  proposalsRepo?: AgentOrgProposalsRepository;
  configsRepo?: AgentConfigsRepository;
  sessionsRepo?: AgentSessionsRepository;
  scorer?: ScoreCall;
}

export interface WorkflowSignalGeneratorResult {
  refineRecipeCreated: AgentOrgProposal[];
  delegationCreated: AgentOrgProposal[];
}

/**
 * `session-errored` -> `refine-recipe`: only fires when the errored session
 * is bound to an existing cookbook recipe (via `mcpRole` ->
 * `agent_cookbook.boundConfigId`) AND that recipe's compiled body scores
 * below the adequacy threshold — i.e. the SAME test recipe_generator.ts
 * already applies to every other refine-recipe candidate. A session with no
 * bound recipe, or a recipe that already scores adequately, produces nothing
 * (concise evidence citing the actual session error, not a fabricated one).
 */
async function proposeRefineRecipeFromSignals(
  signals: WorkflowFailureSignal[],
  recipes: AgentCookbook[],
  sessionsRepo: AgentSessionsRepository,
  scorer: ScoreCall,
  proposalsRepo: AgentOrgProposalsRepository,
): Promise<AgentOrgProposal[]> {
  const created: AgentOrgProposal[] = [];
  const recipesByConfigId = new Map<string, AgentCookbook>();
  for (const recipe of recipes) {
    if (recipe.boundConfigId) recipesByConfigId.set(recipe.boundConfigId, recipe);
  }
  if (recipesByConfigId.size === 0) return created;

  for (const signal of signals) {
    if (signal.kind !== 'session-errored') continue;
    try {
      const session = sessionsRepo.findById(signal.sessionId);
      if (!session?.mcpRole) continue;
      const recipe = recipesByConfigId.get(session.mcpRole);
      if (!recipe) continue;

      const priorBody = compileStepsToBody(recipe.stepsJson);
      const purpose: SkillPurpose = { name: recipe.title, description: recipe.description ?? null };
      const { score } = await scoreSkillBody(purpose, priorBody, scorer);
      if (score >= RECIPE_ADEQUACY_THRESHOLD) continue;

      const dedupKey = `refine-recipe:${recipe.id}:workflow-signal:${stableHash(priorBody)}`;
      if (await proposalsRepo.existsByDedupKeyAsync(dedupKey)) continue;

      const revisedBody = [
        priorBody,
        '',
        `Observed failure: ${signal.evidence}`,
        'Add an explicit guard/step to prevent this failure mode from recurring.',
      ].join('\n');

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
        rationale: `Workflow failure signal (session=${signal.sessionId}): ${signal.evidence} (score=${score}/100, below adequacy threshold ${RECIPE_ADEQUACY_THRESHOLD}).`,
        signalRef: `workflow-failure:${signal.sessionId}`,
        targetRef: `recipe:${recipe.id}`,
        changeJson,
        dedupKey,
      });
      logger.info(
        `[workflow-signal-generator] proposed refine-recipe '${proposal.id}' from session-errored signal (session=${signal.sessionId})`,
      );
      created.push(proposal);
    } catch (err) {
      logger.warn(`[workflow-signal-generator] refine-recipe candidate failed (non-fatal): ${String(err)}`);
    }
  }
  return created;
}

/**
 * `delegated-failure` -> `grant-delegation` / `expand-delegation` candidate
 * signals, ONLY for a manager session with a REPEATED pattern of delegated
 * child failures (>= MIN_DELEGATED_FAILURE_OCCURRENCES) — a single failure is
 * low-confidence and must never manufacture a high-confidence delegation
 * proposal. Grouping key is (manager session's mcpRole, child session's
 * mcpRole) so the same manager/specialist PAIR repeating is what counts as
 * evidence, not merely the same manager failing at different, unrelated
 * specialists.
 */
function buildDelegationRedoSignals(
  signals: WorkflowFailureSignal[],
  sessionsRepo: AgentSessionsRepository,
): DelegationRedoSignal[] {
  const groups = new Map<string, { managerConfigId: string; specialistConfigId: string; count: number; evidence: string[] }>();

  for (const signal of signals) {
    if (signal.kind !== 'delegated-failure') continue;
    const managerSession = sessionsRepo.findById(signal.sessionId);
    if (!managerSession?.mcpRole) continue;

    const childIdMatch = signal.evidence.match(/^Child session (\S+) failed/);
    const childId = childIdMatch?.[1];
    if (!childId) continue;
    const childSession = sessionsRepo.findById(childId);
    if (!childSession?.mcpRole) continue;
    if (childSession.mcpRole === managerSession.mcpRole) continue; // not a delegation gap — self

    const key = `${managerSession.mcpRole}::${childSession.mcpRole}`;
    const entry = groups.get(key) ?? {
      managerConfigId: managerSession.mcpRole,
      specialistConfigId: childSession.mcpRole,
      count: 0,
      evidence: [],
    };
    entry.count += 1;
    entry.evidence.push(signal.evidence);
    groups.set(key, entry);
  }

  const out: DelegationRedoSignal[] = [];
  for (const entry of groups.values()) {
    if (entry.count < MIN_DELEGATED_FAILURE_OCCURRENCES) continue; // low-confidence single occurrence — skip
    out.push({
      managerConfigId: entry.managerConfigId,
      specialistConfigId: entry.specialistConfigId,
      occurrences: entry.count,
      evidence: `${entry.count} delegated-failure signal(s): ${entry.evidence.slice(0, 3).join('; ')}`,
    });
  }
  return out;
}

/**
 * Generate proposals from `snapshot.workflowFailureSignals`, reusing the
 * existing `refine-recipe` low-risk auto-apply lane and the existing
 * high-risk `generateDelegationProposals` queue. NEVER throws.
 */
export async function generateWorkflowSignalProposals(
  snapshot: OrgAuditSnapshot,
  deps: WorkflowSignalGeneratorDeps = {},
): Promise<WorkflowSignalGeneratorResult> {
  const proposalsRepo = deps.proposalsRepo ?? new AgentOrgProposalsRepository();
  const configsRepo = deps.configsRepo ?? new AgentConfigsRepository();
  const sessionsRepo = deps.sessionsRepo ?? new AgentSessionsRepository();
  const scorer: ScoreCall = deps.scorer ?? ((purpose, body) => scoreSkillBody(purpose, body));

  let refineRecipeCreated: AgentOrgProposal[] = [];
  const delegationCreated: AgentOrgProposal[] = [];

  try {
    refineRecipeCreated = await proposeRefineRecipeFromSignals(
      snapshot.workflowFailureSignals,
      snapshot.recipes,
      sessionsRepo,
      scorer,
      proposalsRepo,
    );
  } catch (err) {
    logger.warn(`[workflow-signal-generator] refine-recipe pass FAILED (non-fatal): ${String(err)}`);
  }

  try {
    const redoSignals = buildDelegationRedoSignals(snapshot.workflowFailureSignals, sessionsRepo);
    if (redoSignals.length > 0) {
      const configs: AgentConfig[] = configsRepo.list();
      const generated = generateDelegationProposals(redoSignals, configs);
      for (const g of generated) {
        try {
          // delegation_generator.ts's own dedupKey is `${kind}:manager:target`.
          // `kind` flips grant-delegation -> expand-delegation the instant the
          // edge is granted, which would defeat dedup and re-propose forever
          // off the SAME stale signals (the manager/specialist pair never
          // expires from the 1000-session lookback window the extractor
          // reads every run). Re-key on the manager+specialist pair alone
          // (kind-independent) so the same underlying evidence only ever
          // produces one proposal, regardless of kind drift across runs.
          const specialistId = parseSpecialistIdFromChange(g.changeJson);
          const workflowDedupKey = `workflow-signal:delegation:${g.targetRef}:${specialistId ?? 'unknown'}`;
          if (await proposalsRepo.existsByDedupKeyAsync(workflowDedupKey)) continue;
          const proposal = await proposalsRepo.createAsync({
            auditRunId: snapshot.auditRunId,
            kind: g.kind,
            risk: g.risk,
            title: g.title,
            rationale: g.rationale,
            signalRef: g.signalRef,
            targetRef: g.targetRef,
            changeJson: g.changeJson,
            dedupKey: workflowDedupKey,
          });
          logger.info(
            `[workflow-signal-generator] proposed ${g.kind} '${proposal.id}' from repeated delegated-failure pattern`,
          );
          delegationCreated.push(proposal);
        } catch (err) {
          logger.warn(`[workflow-signal-generator] delegation candidate persist failed (non-fatal): ${String(err)}`);
        }
      }
    }
  } catch (err) {
    logger.warn(`[workflow-signal-generator] delegation pass FAILED (non-fatal): ${String(err)}`);
  }

  return { refineRecipeCreated, delegationCreated };
}
