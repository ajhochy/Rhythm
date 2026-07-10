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
import { AppError } from '../errors/app_error';
import {
  registerProposalApplier,
  registerProposalValidator,
  type ProposalApplier,
  type ProposalApplyResult,
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
import { writeAgentProfileFile } from './opencode_agent_writer';
import {
  readAgentConfigField,
  agentConfigFieldPatch,
  computeScopeList,
} from './org_proposal_apply';
import {
  CONFIG_PATCH_FIELDS,
  SCOPE_PATCH_FIELDS,
  type ConfigPatch,
  type ScopePatch,
} from './org_diagnosis_types';
import { alignMcpName } from './mcp_name_alignment';
import { opencodeClient } from './opencode_engine';
import type { AgentOrgProposal } from '../models/agent_org_proposal';
import type { AgentSkill } from '../models/agent_skill';
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
      // #1003 — a diagnosis-envelope payload ({ fixType, diagnosis, affectedSkill,
      // … }) has no top-level agentConfigId or delegate target. These were produced
      // when delegation-change diagnoses were wrongly routed to grant-delegation
      // (fixed at the generator). Give the reviewer an actionable reason instead of
      // the cryptic "agentConfigId is required".
      if ('fixType' in obj || 'diagnosis' in obj) {
        return {
          valid: false,
          reason:
            'This grant-delegation item came from an LLM diagnosis and carries no concrete ' +
            'delegate target, so it cannot be applied. Real delegation gaps are handled by the ' +
            'delegation generator — dismiss this item.',
        };
      }
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

// ── #971 / #976 — LLM-diagnosis apply lane ──────────────────────────────────
//
// `refine-config`, `refine-scope`, `workflow-prompt-fix` and `refine-skill`
// are the kinds the org-optimizer's LLM diagnosis lane emits. All four are
// HIGH-risk (never auto-applied) so they land in the human review queue and
// are applied HERE on approve. Before this, `POST /agent-org-proposals/:id/
// approve` 400'd for every one of them ("No re-validation is registered for
// proposal kind '…'") because `org_proposal_apply_service.ts` fails closed on
// any kind with no validator, and their applier no-op'd. Each now registers:
//
//   • a fail-closed VALIDATOR — refuses a prose-only proposal (no
//     machine-applyable patch) or an unresolvable target with an actionable
//     reason surfaced in the approve 400 body; and
//   • an APPLIER that snapshots-before-mutate, writes the real
//     agent_config / skill (via the repositories + the SAME opencode-file
//     resync the REST config path uses — never raw SQL, never a forked writer),
//     and returns {measurable:true, beforeSnapshotJson} so the row advances to
//     `measuring` for the separately-owned behavioural/body measure step.
//
// The snapshot shapes are defined in org_proposal_apply.ts (the shared apply
// mechanics module) so revertProposal restores them byte-for-byte:
//   - refine-config / refine-scope → {agentConfigId, field, priorValue}
//   - workflow-prompt-fix / refine-skill → {skillId, priorBody, priorStatus}

/** Parse a proposal's change_json into a plain object, or null. */
function parseChange(changeJson: string | null): Record<string, unknown> | null {
  if (!changeJson) return null;
  try {
    const parsed: unknown = JSON.parse(changeJson);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Extract a well-formed ConfigPatch (nested under `configPatch`), or null. */
function extractConfigPatch(change: Record<string, unknown> | null): ConfigPatch | null {
  const p = change?.configPatch;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const o = p as Record<string, unknown>;
  if (typeof o.agentConfigId !== 'string' || !o.agentConfigId.trim()) return null;
  if (typeof o.field !== 'string' || !(CONFIG_PATCH_FIELDS as readonly string[]).includes(o.field)) {
    return null;
  }
  if (typeof o.value !== 'string') return null;
  return { agentConfigId: o.agentConfigId, field: o.field as ConfigPatch['field'], value: o.value };
}

/** Extract a well-formed ScopePatch (nested under `scopePatch`), or null. A patch with no add/remove is a no-op and refused. */
function extractScopePatch(change: Record<string, unknown> | null): ScopePatch | null {
  const p = change?.scopePatch;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const o = p as Record<string, unknown>;
  if (typeof o.agentConfigId !== 'string' || !o.agentConfigId.trim()) return null;
  if (typeof o.field !== 'string' || !(SCOPE_PATCH_FIELDS as readonly string[]).includes(o.field)) {
    return null;
  }
  const add = Array.isArray(o.add) ? o.add.filter((v): v is string => typeof v === 'string') : undefined;
  const remove = Array.isArray(o.remove)
    ? o.remove.filter((v): v is string => typeof v === 'string')
    : undefined;
  if ((add?.length ?? 0) === 0 && (remove?.length ?? 0) === 0) return null;
  return { agentConfigId: o.agentConfigId, field: o.field as ScopePatch['field'], add, remove };
}

/**
 * Resolve the live skill a workflow-prompt-fix / refine-skill proposal targets:
 * first from `targetRef` ("skill:<id>"), then from a `skillId` / `affectedSkill`
 * / `skillName` field in change_json (by id, then by title). Missing → null
 * (stale signal). A fresh repo is constructed per call because
 * AgentSkillsRepository pins its DB connection at construction time.
 */
function resolveSkillForProposal(proposal: AgentOrgProposal): AgentSkill | null {
  const skillsRepo = new AgentSkillsRepository();
  const ref = proposal.targetRef;
  if (ref && ref.startsWith('skill:')) {
    const byId = skillsRepo.getById(ref.slice('skill:'.length));
    if (byId) return byId;
  }
  const change = parseChange(proposal.changeJson);
  const cand = change?.skillId ?? change?.affectedSkill ?? change?.skillName;
  if (typeof cand === 'string' && cand.trim()) {
    return skillsRepo.getById(cand) ?? skillsRepo.findByTitle(cand);
  }
  return null;
}

/**
 * Deterministically fold a workflow-prompt-fix's `concreteFix` into the skill
 * body. v1: if the fix text isn't already present verbatim, append it as a
 * trailing block; otherwise leave the body unchanged (the measure step then
 * scores no improvement and reverts). ponytail: append-only — swap for an LLM
 * drafter (skill_consolidation_drafter precedent) if real diagnoses emit diffs
 * or full rewrites rather than paste-in paragraphs.
 */
function draftPromptFixBody(priorBody: string, concreteFix: string): string {
  const fix = concreteFix.trim();
  if (!fix || priorBody.includes(fix)) return priorBody;
  const base = priorBody.trimEnd();
  return base ? `${base}\n\n${fix}\n` : `${fix}\n`;
}

/**
 * Shared body-write for workflow-prompt-fix + refine-skill: snapshot
 * {skillId, priorBody, priorStatus}, write the revised body to the DB row, and
 * re-project the managed SKILL.md (non-fatal — the DB is the source of truth
 * the measure step scores from). Returns {measurable:true, beforeSnapshotJson}.
 */
function applySkillBodyRevision(skill: AgentSkill, revisedBody: string): ProposalApplyResult {
  const skillsRepo = new AgentSkillsRepository();
  const beforeSnapshotJson = JSON.stringify({
    skillId: skill.id,
    priorBody: skill.body ?? null,
    priorStatus: skill.status,
  });
  skillsRepo.update(skill.id, { body: revisedBody });
  try {
    writeManagedSkill({
      name: skill.title,
      description: skill.description ?? undefined,
      body: revisedBody,
    });
  } catch (err) {
    logger.warn(
      `[org-proposal-appliers-wiring] managed-skill write failed for '${skill.title}' (non-fatal): ${String(err)}`,
    );
  }
  return { measurable: true, beforeSnapshotJson };
}

// ── refine-config ──
function validateRefineConfig(proposal: AgentOrgProposal): ProposalValidationResult {
  const patch = extractConfigPatch(parseChange(proposal.changeJson));
  if (!patch) {
    return {
      valid: false,
      reason:
        'refine-config requires a machine-applyable configPatch {agentConfigId, field, value}; a prose-only diagnosis cannot be auto-applied',
    };
  }
  if (!new AgentConfigsRepository().getById(patch.agentConfigId)) {
    return { valid: false, reason: `refine-config target agent_config '${patch.agentConfigId}' no longer exists` };
  }
  return { valid: true };
}

const refineConfigApplier: ProposalApplier = (proposal): ProposalApplyResult => {
  const patch = extractConfigPatch(parseChange(proposal.changeJson));
  if (!patch) throw AppError.badRequest('refine-config change_json is missing its configPatch at apply time');
  const configsRepo = new AgentConfigsRepository();
  const config = configsRepo.getById(patch.agentConfigId);
  if (!config) throw AppError.badRequest(`refine-config target '${patch.agentConfigId}' no longer exists`);

  const priorValue = readAgentConfigField(config, patch.field);
  const beforeSnapshotJson = JSON.stringify({
    agentConfigId: patch.agentConfigId,
    field: patch.field,
    priorValue,
  });

  configsRepo.update(patch.agentConfigId, agentConfigFieldPatch(patch.field, patch.value));
  const updated = configsRepo.getById(patch.agentConfigId);
  if (updated) writeAgentProfileFile(updated);

  return { measurable: true, beforeSnapshotJson };
};

// ── refine-scope ──
function validateRefineScope(proposal: AgentOrgProposal): ProposalValidationResult {
  const patch = extractScopePatch(parseChange(proposal.changeJson));
  if (!patch) {
    return {
      valid: false,
      reason:
        'refine-scope requires a machine-applyable scopePatch {agentConfigId, field, add?/remove?} with at least one change; a prose-only diagnosis cannot be auto-applied',
    };
  }
  if (!new AgentConfigsRepository().getById(patch.agentConfigId)) {
    return { valid: false, reason: `refine-scope target agent_config '${patch.agentConfigId}' no longer exists` };
  }
  return { valid: true };
}

const refineScopeApplier: ProposalApplier = (proposal): ProposalApplyResult => {
  const patch = extractScopePatch(parseChange(proposal.changeJson));
  if (!patch) throw AppError.badRequest('refine-scope change_json is missing its scopePatch at apply time');
  const configsRepo = new AgentConfigsRepository();
  const config = configsRepo.getById(patch.agentConfigId);
  if (!config) throw AppError.badRequest(`refine-scope target '${patch.agentConfigId}' no longer exists`);

  const priorValue = readAgentConfigField(config, patch.field);
  const beforeSnapshotJson = JSON.stringify({
    agentConfigId: patch.agentConfigId,
    field: patch.field,
    priorValue,
  });

  const nextJson = computeScopeList(priorValue, { add: patch.add, remove: patch.remove });
  configsRepo.update(patch.agentConfigId, agentConfigFieldPatch(patch.field, nextJson));
  const updated = configsRepo.getById(patch.agentConfigId);
  if (updated) writeAgentProfileFile(updated);

  return { measurable: true, beforeSnapshotJson };
};

// ── workflow-prompt-fix ──
function validateWorkflowPromptFix(proposal: AgentOrgProposal): ProposalValidationResult {
  const change = parseChange(proposal.changeJson);
  const concreteFix = change?.concreteFix;
  if (typeof concreteFix !== 'string' || !concreteFix.trim()) {
    return {
      valid: false,
      reason: 'workflow-prompt-fix requires a non-empty concreteFix describing the skill-body edit',
    };
  }
  if (!resolveSkillForProposal(proposal)) {
    return {
      valid: false,
      reason: 'workflow-prompt-fix could not resolve a live skill from targetRef/affectedSkill (stale signal)',
    };
  }
  return { valid: true };
}

const workflowPromptFixApplier: ProposalApplier = (proposal): ProposalApplyResult => {
  const change = parseChange(proposal.changeJson);
  const concreteFix = typeof change?.concreteFix === 'string' ? change.concreteFix : '';
  if (!concreteFix.trim()) {
    throw AppError.badRequest('workflow-prompt-fix change_json is missing its concreteFix at apply time');
  }
  const skill = resolveSkillForProposal(proposal);
  if (!skill) throw AppError.badRequest('workflow-prompt-fix could not resolve a live skill at apply time (stale signal)');

  const priorBody = skill.body ?? '';
  const revisedBody = draftPromptFixBody(priorBody, concreteFix);
  const result = applySkillBodyRevision(skill, revisedBody);

  // Reshape change_json into the BodyRefinementChange the measure step reads
  // (persisted by the approve controller alongside the `applied` transition).
  result.changeJson = JSON.stringify({
    skillName: skill.title,
    priorBody,
    revisedBody,
    description: skill.description ?? null,
    whenToUse: skill.whenToUse ?? null,
  });
  return result;
};

// ── refine-skill (#976 approve half — change_json is already a BodyRefinementChange) ──
function validateRefineSkill(proposal: AgentOrgProposal): ProposalValidationResult {
  const change = parseChange(proposal.changeJson);
  if (typeof change?.priorBody !== 'string' || typeof change?.revisedBody !== 'string') {
    return {
      valid: false,
      reason: 'refine-skill requires a BodyRefinementChange {priorBody, revisedBody} in change_json',
    };
  }
  if (!resolveSkillForProposal(proposal)) {
    return {
      valid: false,
      reason: 'refine-skill could not resolve a live skill from targetRef/skillName (stale signal)',
    };
  }
  return { valid: true };
}

const refineSkillApplier: ProposalApplier = (proposal): ProposalApplyResult => {
  const change = parseChange(proposal.changeJson);
  const revisedBody = typeof change?.revisedBody === 'string' ? change.revisedBody : null;
  if (revisedBody == null) {
    throw AppError.badRequest('refine-skill change_json is missing its revisedBody at apply time');
  }
  const skill = resolveSkillForProposal(proposal);
  if (!skill) throw AppError.badRequest('refine-skill could not resolve a live skill at apply time (stale signal)');
  return applySkillBodyRevision(skill, revisedBody);
};

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

  // #971 / #976 — LLM-diagnosis apply lane. Fail-closed validators + real
  // appliers so approve no longer 400s and the change is actually made.
  try {
    registry.registerProposalValidator('refine-config', validateRefineConfig);
    registry.registerProposalApplier('refine-config', refineConfigApplier);
    registry.registerProposalValidator('refine-scope', validateRefineScope);
    registry.registerProposalApplier('refine-scope', refineScopeApplier);
    registry.registerProposalValidator('workflow-prompt-fix', validateWorkflowPromptFix);
    registry.registerProposalApplier('workflow-prompt-fix', workflowPromptFixApplier);
    registry.registerProposalValidator('refine-skill', validateRefineSkill);
    registry.registerProposalApplier('refine-skill', refineSkillApplier);
  } catch (err) {
    logger.warn(`[org-proposal-appliers-wiring] failed to register diagnosis-lane appliers (non-fatal): ${String(err)}`);
  }

  logger.info(
    '[org-proposal-appliers-wiring] registered appliers for: create-agent, grant-delegation, expand-delegation, external-adoption, webhook-wiring, create-recipe, refine-config, refine-scope, workflow-prompt-fix, refine-skill',
  );
}
