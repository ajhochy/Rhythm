/**
 * org_proposal_appliers_wiring.ts — Issue #830 (org-optimizer-14, the
 * KEYSTONE wiring round).
 *
 * Each of the six generator issues (#822–#825, #828, #829) built its
 * proposal-generation logic AND, where the generator's kind is human-gated
 * (queue-only), its own `register*Applier(registry, deps?)` function — but
 * deliberately deferred CALLING that registration to this issue, so the
 * generators never need to import or mutate `org_proposal_apply_service.ts`
 * directly (see that module's doc: "Kinds are registered via
 * registerProposalApplier so future generator issues plug in without
 * touching this file's control flow").
 *
 * This module is the ONE place that imports all six generators and calls
 * their registration functions, wiring REAL dependencies (not test fakes):
 *
 *   - scope_hygiene_generator (#822): registers NOTHING here. Per the
 *     2026-07-02 project-state.md run notes, its three kinds
 *     (tighten-scope / prune-scope / consolidate-skill) are `risk='low'`
 *     and flow through the direct `proposed -> applied` auto-apply lane
 *     (`org_proposal_apply.ts`'s `applyAgentConfigScopeChange`, already
 *     wired), NOT the human-gate queue's registered-applier path this
 *     module wires. Listed here only so this file is the single documented
 *     place confirming all six generators were considered.
 *   - recipe_generator (#823, applier added by #851): `generateRecipeProposals`
 *     produces proposal INPUTS for both `create-recipe` and `refine-recipe`.
 *     `refine-recipe` (LOW risk) is handled by `org_proposal_measure.ts`'s
 *     body-refinement path, same as before — nothing to wire for it here.
 *     `create-recipe` (HIGH risk, always human-gated) now has a real apply
 *     step: `registerCreateRecipeApplier(registry)` creates the
 *     `agent_cookbook` row from the proposal's `change_json` on approval —
 *     see recipe_generator.ts's "Apply step for `create-recipe`" section for
 *     the idempotency (guarded by title) and revert (`before_snapshot_json`
 *     carries `createdCookbookId`) design.
 *   - new_agent_generator (#824): `registerNewAgentApplier(registry)` — no
 *     deps param; the generator's own applier reads `AgentConfigsRepository`
 *     and the `.mcp-roles` writer internally.
 *   - delegation_generator (#825): `registerDelegationApplier(registry, deps)`
 *     — wired with a real `AgentConfigsRepository` instance (the default the
 *     generator itself would construct if `deps.configsRepo` is omitted;
 *     passed explicitly here so this module is the single place production
 *     dependencies are assembled).
 *   - external_discovery_generator (#828): `registerExternalAdoptionApplier(
 *     registerFn, deps)` — wired with the REAL curated-MCP install path
 *     (`opencodeClient.ensureCuratedMcps`), the REAL skill-create path
 *     (`AgentSkillsRepository.create` + `writeManagedSkill`, mirroring the
 *     ministry-recipes seed's own skill-materialization sequence), and the
 *     REAL alignment guard (`opencodeClient.listMcp()` + `mcp_name_alignment
 *     .alignMcpName` for MCP candidates; `opencodeClient.listSkills()` name
 *     membership for skill candidates).
 *   - webhook_wiring_generator (#829): `registerWebhookWiringApplier(registry)`
 *     — no deps param; the generator's own applier constructs
 *     `AgentWebhookEndpointsRepository` internally (the existing
 *     HMAC-secret-generating creation path).
 *
 * Called ONCE at server boot, from the same block that runs
 * `agentMemoryService.seedConsolidationTask()` / `seedMinistryRecipes()`
 * (see server.ts). Idempotent by construction: `registerProposalApplier` /
 * `registerProposalValidator` are plain map assignments ("last call wins"),
 * so calling this twice (e.g. in a test) simply re-registers the same
 * appliers — never throws, never duplicates state.
 */

import { logger } from '../utils/logger';
import {
  registerProposalApplier,
  registerProposalValidator,
  type ProposalApplier,
  type ProposalValidator,
} from './org_proposal_apply_service';
import { registerNewAgentApplier } from './generators/new_agent_generator';
import { registerDelegationApplier } from './generators/delegation_generator';
import { registerWebhookWiringApplier } from './generators/webhook_wiring_generator';
import { registerCreateRecipeApplier } from './generators/recipe_generator';
import {
  registerExternalAdoptionApplier,
  type ExternalAdoptionApplyDeps,
} from './generators/external_discovery_generator';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import { writeManagedSkill } from './rhythm_managed_skills';
import { alignMcpName } from './mcp_name_alignment';
import { opencodeClient } from './opencode_engine';
import type { AgentOrgProposal } from '../models/agent_org_proposal';
import type { ProposalValidationResult } from './org_proposal_apply_service';

/** Minimal registry shape every generator's `register*Applier` needs. */
export interface AppliersRegistry {
  registerProposalApplier: (kind: string, applier: ProposalApplier) => void;
  registerProposalValidator: (kind: string, validator: ProposalValidator) => void;
}

/**
 * Real production implementation of {@link ExternalAdoptionApplyDeps}.
 * Exported separately (not just inlined into {@link registerAllProposalAppliers})
 * so a unit test can exercise the install/alignment sequence in isolation
 * without spinning up the whole wiring round.
 */
export function buildRealExternalAdoptionDeps(): ExternalAdoptionApplyDeps {
  return {
    async installCuratedMcp({ serverName }) {
      const result = await opencodeClient.ensureCuratedMcps({ register: true });
      const installed = result.servers.some((s) => s.id === serverName);
      return { changed: result.changed, registered: installed && result.registered };
    },
    async installSkill({ skillName }) {
      const skillsRepo = new AgentSkillsRepository();
      const existing = skillsRepo.findByTitle(skillName);
      if (existing) {
        return { created: false };
      }
      const skill = skillsRepo.create({
        title: skillName,
        description: `Externally adopted skill: ${skillName}`,
        whenToUse: null,
        steps: null,
        tags: ['external-adoption'],
        body: `# ${skillName}\n\nAdopted via the org self-optimizer's external-discovery review queue. See the proposal's provenance note for source/license/install details.`,
        status: 'published',
        source: 'external-adoption',
      });
      writeManagedSkill({
        name: skill.title,
        description: skill.description ?? undefined,
        body: skill.body ?? '',
      });
      return { created: true };
    },
    async checkAlignment({ candidateKind, name }) {
      if (candidateKind === 'mcp') {
        if (!opencodeClient.isReady) {
          return { aligned: false, reason: 'engine not ready — cannot verify live MCP alignment' };
        }
        try {
          const mcpStatus = await opencodeClient.listMcp();
          const liveNames = new Set(Object.keys(mcpStatus));
          const { matched } = alignMcpName(name, liveNames);
          return matched
            ? { aligned: true }
            : { aligned: false, reason: `"${name}" did not resolve to a live MCP server id` };
        } catch (err) {
          return { aligned: false, reason: `listMcp failed: ${String(err)}` };
        }
      }
      // candidateKind === 'skill'
      if (!opencodeClient.isReady) {
        return { aligned: false, reason: 'engine not ready — cannot verify live skill alignment' };
      }
      try {
        const skills = await opencodeClient.listSkills();
        const aligned = Array.isArray(skills) && skills.some((s) => s.name === name);
        return aligned
          ? { aligned: true }
          : { aligned: false, reason: `"${name}" did not resolve to a live skill name` };
      } catch (err) {
        return { aligned: false, reason: `listSkills failed: ${String(err)}` };
      }
    },
  };
}

/**
 * Structural (shape-only) re-validation for `grant-delegation` /
 * `expand-delegation`, registered here because `delegation_generator.ts`
 * (#825) intentionally re-validates FULL eligibility (target exists,
 * enabled, `isAgent`, not the manager itself, depth cap) INSIDE its own
 * registered applier rather than exporting a separate validator function —
 * see that module's doc comment. `org_proposal_apply_service.applyProposal`
 * fails closed on any kind with NO registered validator at all, so without
 * this shape check `grant-delegation`/`expand-delegation` proposals could
 * never reach the applier through the shared `applyProposal` entry point.
 * This validator only confirms the payload has the shape
 * `{ agentConfigId: string, allowed_delegates_json: { add: string[] } }` the
 * generator's own `parseChangePayload` expects — the FULL eligibility
 * re-check still happens inside the applier itself immediately afterward
 * (defense-in-depth, not a duplicate source of truth for the eligibility
 * rule).
 */
function validateDelegationChangeShape(proposal: AgentOrgProposal): ProposalValidationResult {
  if (!proposal.changeJson) {
    return { valid: false, reason: 'delegation proposal change_json is missing' };
  }
  try {
    const parsed: unknown = JSON.parse(proposal.changeJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { valid: false, reason: 'delegation proposal change_json must be an object' };
    }
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.agentConfigId !== 'string' || !obj.agentConfigId.trim()) {
      return { valid: false, reason: 'delegation proposal change_json.agentConfigId is required' };
    }
    const addBlock = obj.allowed_delegates_json;
    if (!addBlock || typeof addBlock !== 'object' || Array.isArray(addBlock)) {
      return {
        valid: false,
        reason: 'delegation proposal change_json.allowed_delegates_json must be an object',
      };
    }
    const add = (addBlock as Record<string, unknown>).add;
    if (!Array.isArray(add) || add.length === 0 || add.some((v) => typeof v !== 'string')) {
      return {
        valid: false,
        reason: 'delegation proposal change_json.allowed_delegates_json.add must be a non-empty string[]',
      };
    }
    return { valid: true };
  } catch {
    return { valid: false, reason: 'delegation proposal change_json is not valid JSON' };
  }
}

/**
 * Structural re-validation for `webhook-wiring`, registered here for the
 * same reason as {@link validateDelegationChangeShape}: `org_proposal_apply_service
 * .ts` already defines an equivalent `validateWebhookWiring` at module load
 * (so production boot always has it), but that function is NOT exported —
 * only the module's OWN internal `validators` map carries it. This wiring
 * module must be self-sufficient (its job is "wire all six generators... at
 * startup", including a registry that starts empty), so it registers an
 * equivalent check: `change_json` must specify `targetScheduledTaskId` or
 * `targetRecipeId`, matching `webhook_wiring_generator.ts`'s own applier
 * requirement — approval must never fire a webhook into nothing.
 */
function validateWebhookWiringShape(proposal: AgentOrgProposal): ProposalValidationResult {
  if (!proposal.changeJson) {
    return { valid: false, reason: 'webhook-wiring proposal change_json is missing' };
  }
  let change: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(proposal.changeJson);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      change = parsed as Record<string, unknown>;
    }
  } catch {
    return { valid: false, reason: 'webhook-wiring proposal change_json is not valid JSON' };
  }
  const hasTarget =
    typeof change?.targetScheduledTaskId === 'string' ||
    typeof change?.targetRecipeId === 'string';
  if (!hasTarget) {
    return {
      valid: false,
      reason: 'change_json must specify targetScheduledTaskId or targetRecipeId',
    };
  }
  return { valid: true };
}

/**
 * Structural re-validation for `external-adoption`, registered here for the
 * same self-sufficiency reason as {@link validateDelegationChangeShape} /
 * {@link validateWebhookWiringShape}: `org_proposal_apply_service.ts`'s own
 * `validateExternalAdoption` is not exported. Mirrors
 * `external_discovery_generator.ts`'s own `isExternalAdoptionChange` shape
 * check (candidateKind + a named server/skill) so a proposal missing its
 * adoption target is refused before ever reaching the install step.
 */
function validateExternalAdoptionShape(proposal: AgentOrgProposal): ProposalValidationResult {
  if (!proposal.changeJson) {
    return { valid: false, reason: 'external-adoption proposal change_json is missing' };
  }
  let change: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(proposal.changeJson);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      change = parsed as Record<string, unknown>;
    }
  } catch {
    return { valid: false, reason: 'external-adoption proposal change_json is not valid JSON' };
  }
  const candidateKind = change?.candidateKind;
  if (candidateKind !== 'mcp' && candidateKind !== 'skill') {
    return { valid: false, reason: "change_json.candidateKind must be 'mcp' or 'skill'" };
  }
  const name = change?.serverName ?? change?.skillName;
  if (typeof name !== 'string' || !name.trim()) {
    return {
      valid: false,
      reason: 'change_json must name the server/skill being adopted (serverName/skillName)',
    };
  }
  return { valid: true };
}

/**
 * Structural re-validation for `create-recipe`, registered here for the same
 * self-sufficiency reason as {@link validateWebhookWiringShape} /
 * {@link validateExternalAdoptionShape}: this wiring module must not depend
 * on org_proposal_apply_service.ts happening to already have a validator for
 * every kind it wires an applier for — that module fails closed (refuses any
 * kind with no registered validator), so a create-recipe proposal would be
 * permanently stuck at approval without this. Mirrors
 * recipe_generator.ts's own `parseCreateRecipeChange` shape expectation: a
 * non-empty `title` string is required so approval never creates an
 * untitled/blank cookbook entry.
 */
function validateCreateRecipeShape(proposal: AgentOrgProposal): ProposalValidationResult {
  if (!proposal.changeJson) {
    return { valid: false, reason: 'create-recipe proposal change_json is missing' };
  }
  let change: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(proposal.changeJson);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      change = parsed as Record<string, unknown>;
    }
  } catch {
    return { valid: false, reason: 'create-recipe proposal change_json is not valid JSON' };
  }
  const title = change?.title;
  if (typeof title !== 'string' || !title.trim()) {
    return { valid: false, reason: 'change_json.title is required to create a recipe' };
  }
  return { valid: true };
}

/**
 * Wire all six generators' apply steps into the given registry (normally
 * `org_proposal_apply_service.ts`'s module-level `registerProposalApplier`
 * / `registerProposalValidator`, but injectable so a test can pass an
 * isolated fake registry instead of mutating shared module state).
 *
 * Never throws — each generator's registration is wrapped individually so a
 * problem registering one generator (e.g. a future signature change) cannot
 * prevent the other five from wiring correctly.
 */
export function registerAllProposalAppliers(registry: AppliersRegistry = {
  registerProposalApplier,
  registerProposalValidator,
}): void {
  const configsRepo = new AgentConfigsRepository();

  try {
    registerNewAgentApplier(registry);
  } catch (err) {
    logger.warn(`[org-proposal-appliers-wiring] failed to register new-agent applier (non-fatal): ${String(err)}`);
  }

  try {
    registerDelegationApplier(registry, { configsRepo });
    // See validateDelegationChangeShape's doc comment: the generator's own
    // applier does the FULL eligibility re-check; this only satisfies
    // applyProposal's fail-closed "a kind with no registered validator is
    // refused" gate with a structural shape check.
    registry.registerProposalValidator('grant-delegation', validateDelegationChangeShape);
    registry.registerProposalValidator('expand-delegation', validateDelegationChangeShape);
  } catch (err) {
    logger.warn(`[org-proposal-appliers-wiring] failed to register delegation applier (non-fatal): ${String(err)}`);
  }

  try {
    registerExternalAdoptionApplier(
      registry.registerProposalApplier,
      buildRealExternalAdoptionDeps(),
    );
    registry.registerProposalValidator('external-adoption', validateExternalAdoptionShape);
  } catch (err) {
    logger.warn(`[org-proposal-appliers-wiring] failed to register external-adoption applier (non-fatal): ${String(err)}`);
  }

  try {
    registerWebhookWiringApplier(registry);
    registry.registerProposalValidator('webhook-wiring', validateWebhookWiringShape);
  } catch (err) {
    logger.warn(`[org-proposal-appliers-wiring] failed to register webhook-wiring applier (non-fatal): ${String(err)}`);
  }

  try {
    registerCreateRecipeApplier(registry);
    registry.registerProposalValidator('create-recipe', validateCreateRecipeShape);
  } catch (err) {
    logger.warn(`[org-proposal-appliers-wiring] failed to register create-recipe applier (non-fatal): ${String(err)}`);
  }

  // scope_hygiene_generator (#822) intentionally registers nothing here —
  // see the module doc above for why.

  logger.info(
    '[org-proposal-appliers-wiring] registered appliers for: create-agent, grant-delegation, expand-delegation, external-adoption, webhook-wiring, create-recipe',
  );
}
