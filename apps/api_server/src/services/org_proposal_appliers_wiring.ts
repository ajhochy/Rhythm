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
 *   - scope_hygiene_generator (#822): its `consolidate-skill` kind is
 *     `risk='low'` and still flows through the direct `proposed -> applied`
 *     auto-apply lane (`org_proposal_apply.ts`). Its `tighten-scope` /
 *     `prune-scope` kinds are `risk='high'` as of the W1 self-improvement-
 *     engine-foundation review (2026-08-14): scope REMOVAL is reversible
 *     only while no later config edit has occurred, so it is human-gated
 *     like every other HIGH-risk kind and refused outright by
 *     `org_proposal_apply.applyProposal`. This module registers their ONLY
 *     apply path — `registerProposalValidator`/`registerProposalApplier` for
 *     `tighten-scope`/`prune-scope` below — reachable exclusively through
 *     `OrgProposalsController.approve()`'s explicit human-consent gate.
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
import {
  writeManagedSkill,
  deleteManagedSkill,
  managedSkillExists,
  readManagedSkillBytes,
  slugForSkillName,
  InvalidSkillNameError,
} from './rhythm_managed_skills';
import { downloadSkillBody } from './generators/external_discovery_search';
import { scanContextContent } from '../security/context_scanner';
import { stripFrontmatterBlock } from './skill_frontmatter';
import { AgentScheduledTasksRepository } from '../repositories/agent_scheduled_tasks_repository';
import { projectAgentProfileAfterWrite } from './agent_profile_projection_service';
import {
  readAgentConfigField,
  agentConfigFieldPatch,
  createScopeDeltaV2Snapshot,
  createScopeStateV2Snapshot,
  readScheduledTaskField,
  scheduledTaskFieldPatch,
  type ScopeDeltaV2Snapshot,
  type ScopeStateFieldName,
  type ScopeStateV2Snapshot,
} from './org_proposal_apply';
import {
  CONFIG_PATCH_FIELDS,
  SCOPE_ALLOWLIST_FIELDS,
  TASK_PATCH_FIELDS,
  TASK_PATCH_TEXT_FIELDS,
  type ConfigPatch,
  type TaskPatch,
} from './org_diagnosis_types';
import { alignMcpName } from './mcp_name_alignment';
import { opencodeClient } from './opencode_engine';
import { env } from '../config/env';
import { resolveProdApiBase } from './opencode_plugin_config';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import type { CuratedMcpServer } from '../config/curated_mcp_servers';
import type { AgentOrgProposal } from '../models/agent_org_proposal';
import {
  parseScopeMutation,
  prepareScopeMutation,
  type ScopeProposalKind,
  type ScopeRemovalKind,
} from './scope_mutation_contract';
import type { AgentSkill } from '../models/agent_skill';
import type { ProposalValidationResult } from './org_proposal_apply_service';
import { resolveKnownMcpServerName } from './mcp_scope_name';
import { AgentOrgExperimentsRepository } from '../repositories/agent_org_experiments_repository';
import { validateSystemPromptV1Spec } from '../models/experiment_treatment_adapter';

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
    async installCuratedMcp({ serverName, installCommand, agentConfigId }) {
      // #1114 — a genuinely NEW discovered server is not in the static
      // curated catalog (CURATED_MCP_SERVERS in curated_mcp_servers.ts), so
      // the OLD `ensureCuratedMcps({register:true})` call (no `servers`
      // override -> defaults to that static list) would silently install
      // NOTHING for it. `servers` was previously test-only; it is exactly
      // the sanctioned way to ensure an AD HOC server definition through the
      // same idempotent-merge-into-opencode.json + live-register path
      // without adding it to the permanent catalog. Build a minimal
      // definition from what the registry candidate gave us.
      const argv = (installCommand ?? '').trim().split(/\s+/).filter(Boolean);
      if (argv.length === 0) {
        throw new Error(
          `installCuratedMcp: no installCommand for '${serverName}' — cannot build a server definition`,
        );
      }
      const server: CuratedMcpServer = {
        id: serverName,
        name: serverName,
        type: 'local',
        command: argv,
        requiredEnv: [],
      };
      const result = await opencodeClient.ensureCuratedMcps({ servers: [server], register: true });
      const installed = result.servers.some((s) => s.id === serverName);

      // #1114 (secretary-MCP-scope lesson) — a curated install must never
      // leave a newly-adopted server globally enabled for every agent. Wire
      // it into JUST the needing agent's allowedMcpsJson, reversibly
      // (captures the prior value) — mirrors installSkill's identical
      // allowedSkillsJson wiring below verbatim, just for the MCP scope
      // field instead of the skill one.
      let beforeSnapshotJson: string | undefined;
      if (agentConfigId) {
        const configsRepo = new AgentConfigsRepository();
        const config = configsRepo.getById(agentConfigId);
        if (config) {
          const priorAllowedMcpsJson = config.allowedMcpsJson ?? null;
          const list = parseAllowlist(priorAllowedMcpsJson);
          if (!list.includes(serverName)) {
            const nextJson = JSON.stringify([...list, serverName]);
            configsRepo.update(agentConfigId, { allowedMcpsJson: nextJson });
            const updated = configsRepo.getById(agentConfigId);
            if (updated) projectAgentProfileAfterWrite(updated, 'config-update'); // resync through the boundary
          }
          beforeSnapshotJson = JSON.stringify({
            externalAdoption: true,
            adoptedServerName: serverName,
            agentConfigId,
            priorAllowedMcpsJson,
          });
        }
      }

      return { changed: result.changed, registered: installed && result.registered, beforeSnapshotJson };
    },

    async installSkill({ skillName, downloadUrl, agentConfigId, sampleSessionId, categories }) {
      // 1. DOWNLOAD the real body from the candidate source (no stub).
      if (!downloadUrl) {
        throw new Error(`external-adoption installSkill: no downloadUrl for '${skillName}'`);
      }
      const body = await downloadSkillBody(downloadUrl);
      if (!body) {
        throw new Error(`external-adoption installSkill: body download failed for '${skillName}' (${downloadUrl})`);
      }

      // 2. HARD #873 gate at write time — a high-confidence injection match blocks the write.
      const scan = scanContextContent(body, `adopted skill "${skillName}"`);
      if (scan.blocked) {
        throw new Error(`external-adoption installSkill: body for '${skillName}' blocked by injection scan`);
      }

      // 3. WRITE-IF-ABSENT — never clobber an engine-owned library skill (invariant 2).
      const skillWasAbsent = !managedSkillExists(skillName);
      if (skillWasAbsent) {
        writeManagedSkill({ name: skillName, description: `Adopted from ${downloadUrl}`, body });
      }

      // 4. WIRE the adopted skill to the agent that needed it (reversibly).
      const configsRepo = new AgentConfigsRepository();
      let priorAllowedSkillsJson: string | null = null;
      if (agentConfigId) {
        const config = configsRepo.getById(agentConfigId);
        if (config) {
          priorAllowedSkillsJson = config.allowedSkillsJson ?? null;
          let list: string[] = [];
          try {
            const parsed = priorAllowedSkillsJson ? JSON.parse(priorAllowedSkillsJson) : [];
            if (Array.isArray(parsed)) list = parsed.filter((s): s is string => typeof s === 'string');
          } catch {
            list = [];
          }
          if (!list.includes(skillName)) {
            list.push(skillName);
            const nextJson = JSON.stringify(list);
            configsRepo.update(agentConfigId, { allowedSkillsJson: nextJson });
            const updated = configsRepo.getById(agentConfigId);
            if (updated) projectAgentProfileAfterWrite(updated, 'config-update'); // resync through the boundary
          }
        }
      }

      // 5. before_snapshot_json for the external-adoption revert path + reshaped
      //    change_json (DiagnosisChange-compatible) for the behavioral measure.
      const beforeSnapshotJson = JSON.stringify({
        externalAdoption: true,
        adoptedSkillName: skillName,
        skillWasAbsent,
        agentConfigId: agentConfigId ?? null,
        priorAllowedSkillsJson,
      });
      const changeJson = JSON.stringify({
        candidateKind: 'skill',
        skillName,
        adoptedSkillName: skillName,
        downloadUrl,
        configPatch: { agentConfigId: agentConfigId ?? undefined },
        sessionIds: sampleSessionId ? [sampleSessionId] : [],
        evidence: (categories ?? []).map((c) => ({ category: c })),
      });

      return { created: true, beforeSnapshotJson, changeJson };
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
      // candidateKind === 'skill' — disk truth is the reliable post-write guard.
      // The engine rescans its config skills dir on its own cadence, so a
      // just-written managed skill may not yet appear in listSkills(); the
      // authoritative fact that the adopt succeeded is that the SKILL.md now
      // exists in the owned library.
      return managedSkillExists(name)
        ? { aligned: true }
        : { aligned: false, reason: `managed SKILL.md for "${name}" was not found after write` };
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
export function validateDelegationChangeShape(proposal: AgentOrgProposal): ProposalValidationResult {
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
      // #1003 — a diagnosis-envelope payload ({ fixType, diagnosis, … }) has no
      // top-level agentConfigId or delegate target. These were produced when
      // delegation-change diagnoses were wrongly routed to grant-delegation
      // (now fixed at the generator). Give the reviewer an actionable reason
      // instead of the cryptic "agentConfigId is required".
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
  if (Object.keys(o).sort().join(',') !== 'agentConfigId,field,value') return null;
  if (typeof o.agentConfigId !== 'string' || !o.agentConfigId.trim()) return null;
  if (typeof o.field !== 'string' || !(CONFIG_PATCH_FIELDS as readonly string[]).includes(o.field)) {
    return null;
  }
  if (typeof o.value !== 'string') return null;
  return { agentConfigId: o.agentConfigId, field: o.field as ConfigPatch['field'], value: o.value };
}

const PROTECTED_GENERIC_CONFIG_FIELDS = new Set([
  'allowedMcpsJson',
  'allowedSkillsJson',
  'corePermissionsJson',
]);

function protectedGenericConfigField(change: Record<string, unknown> | null): string | null {
  const patch = change?.configPatch;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return null;
  const field = (patch as Record<string, unknown>).field;
  return PROTECTED_GENERIC_CONFIG_FIELDS.has(String(field)) ? String(field) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

type HumanScopeSnapshot = ScopeDeltaV2Snapshot | ScopeStateV2Snapshot;

/** Prepare one human-gated scope mutation without touching DB or disk. */
function prepareDeferredHumanScopeMutation(input: {
  proposal: AgentOrgProposal;
  agentConfigId: string;
  field: ScopeStateFieldName;
  priorValue: string | null;
  nextValue: string;
  measurable: boolean;
  snapshot: HumanScopeSnapshot;
}): ProposalApplyResult {
  const exactChangeJson = input.proposal.changeJson;
  if (!exactChangeJson || !exactChangeJson.trim()) {
    throw AppError.badRequest(`${input.proposal.kind} requires exact nonempty change_json at apply time`);
  }
  if (input.nextValue === input.priorValue) {
    throw AppError.conflict(`${input.proposal.kind} is stale or would make no exact scope change`);
  }
  if (
    input.snapshot.target.id !== input.agentConfigId ||
    input.snapshot.field !== input.field ||
    input.snapshot.expectedAppliedValue !== input.nextValue
  ) {
    throw AppError.conflict(`${input.proposal.kind} prepared scope snapshot does not match its target bytes`);
  }
  return {
    measurable: input.measurable,
    beforeSnapshotJson: JSON.stringify(input.snapshot),
    changeJson: exactChangeJson,
    scopePair: {
      targetId: input.agentConfigId,
      field: input.field,
      priorValue: input.priorValue,
      nextValue: input.nextValue,
    },
    postApplyTarget: { profileId: input.agentConfigId, changeType: 'scope' },
  };
}

/** Extract a well-formed TaskPatch (nested under `taskPatch`), or null. */
function extractTaskPatch(change: Record<string, unknown> | null): TaskPatch | null {
  const p = change?.taskPatch;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const o = p as Record<string, unknown>;
  if (typeof o.scheduledTaskId !== 'string' || !o.scheduledTaskId.trim()) return null;
  if (typeof o.field !== 'string' || !(TASK_PATCH_FIELDS as readonly string[]).includes(o.field)) {
    return null;
  }
  if (typeof o.value !== 'string') return null;
  return { scheduledTaskId: o.scheduledTaskId, field: o.field as TaskPatch['field'], value: o.value };
}

/** Strip an optional "namespace:" prefix from an allowlist entry (e.g.
 * "anthropic-skills:consolidate-memory" → "consolidate-memory"). */
function bareSkillName(entry: string): string {
  const i = entry.lastIndexOf(':');
  return i >= 0 ? entry.slice(i + 1) : entry;
}

/** Parse an allowedSkillsJson array; invalid/absent → []. */
function parseAllowlist(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string' && s.trim().length > 0) : [];
  } catch {
    return [];
  }
}

/**
 * The profile id a skill-fix proposal is *about* — the LLM diagnosis conflates
 * this with the skill title, so `targetRef`/`affectedSkill` frequently name the
 * PROFILE (e.g. "worship-planning") rather than the actual skill title (e.g.
 * "monday-worship-planning"). Used by the resolver fallback to consult the
 * profile's allowed-skills list.
 */
function proposalProfileId(proposal: AgentOrgProposal): string | null {
  const ref = proposal.targetRef;
  if (ref && ref.startsWith('skill:')) return ref.slice('skill:'.length) || null;
  if (ref && ref.startsWith('profile:')) return ref.slice('profile:'.length) || null;
  const change = parseChange(proposal.changeJson);
  const cand = change?.affectedSkill ?? change?.skillName ?? change?.skillId;
  return typeof cand === 'string' && cand.trim() ? cand : null;
}

/**
 * Fallback resolution when the direct id/title lookups miss (#1041). LLM
 * diagnoses conflate profile names with skill titles in
 * targetRef/affectedSkill, so before failing we try:
 *   (a) skill titles mentioned in the proposal's diagnosis/concreteFix text;
 *   (b) the affected profile's allowed-skills list — only when EXACTLY ONE of
 *       its live skills matches.
 * Returns the resolved skill (logging which fallback hit) or null. Kept
 * fail-closed: ambiguous (>1) or no match → null so the caller can refuse.
 */
function resolveSkillByFallback(proposal: AgentOrgProposal, skillsRepo: AgentSkillsRepository): AgentSkill | null {
  const allSkills = skillsRepo.list();

  // (a) skill titles named in the diagnosis / concreteFix prose.
  const change = parseChange(proposal.changeJson);
  const diagnosisText = [change?.diagnosis, change?.concreteFix, proposal.rationale]
    .filter((s): s is string => typeof s === 'string')
    .join('\n');
  if (diagnosisText.trim()) {
    const mentioned = allSkills.filter((s) => s.title && diagnosisText.includes(s.title));
    if (mentioned.length === 1) {
      logger.info(
        `[org-proposal-appliers-wiring] resolveSkillForProposal fallback (a): resolved '${mentioned[0].title}' from diagnosis/fix text (targetRef='${proposal.targetRef}')`,
      );
      return mentioned[0];
    }
  }

  // (b) the affected profile's allowed-skills list — exactly one live match.
  const profileId = proposalProfileId(proposal);
  if (profileId) {
    const config = new AgentConfigsRepository().getById(profileId);
    if (config) {
      const allowedBare = new Set(parseAllowlist(config.allowedSkillsJson).map(bareSkillName));
      const matches = allSkills.filter((s) => s.title && allowedBare.has(bareSkillName(s.title)));
      if (matches.length === 1) {
        logger.info(
          `[org-proposal-appliers-wiring] resolveSkillForProposal fallback (b): resolved '${matches[0].title}' from profile '${profileId}' allowed-skills (targetRef='${proposal.targetRef}')`,
        );
        return matches[0];
      }
    }
  }

  return null;
}

/**
 * Resolve the live skill a workflow-prompt-fix / refine-skill proposal targets:
 * first from `targetRef` ("skill:<id>"), then from a `skillId` / `affectedSkill`
 * / `skillName` field in change_json (by id, then by title). When those direct
 * lookups miss — the common case where the LLM put the PROFILE id in
 * targetRef/affectedSkill instead of the skill title (#1041) — fall back to
 * {@link resolveSkillByFallback}. Still returns null (stale signal) only when
 * no fallback resolves. A fresh repo is constructed per call because
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
    const direct = skillsRepo.getById(cand) ?? skillsRepo.findByTitle(cand);
    if (direct) return direct;
  }
  return resolveSkillByFallback(proposal, skillsRepo);
}

/**
 * Build an ACTIONABLE refusal (#1041 acceptance): name the ref we looked for
 * AND the closest candidate skill titles, so an un-appliable card tells the
 * user what to point it at instead of a bare "stale signal".
 */
function describeSkillResolutionFailure(proposal: AgentOrgProposal): string {
  const skillsRepo = new AgentSkillsRepository();
  const change = parseChange(proposal.changeJson);
  const lookedFor = [
    proposal.targetRef,
    typeof change?.affectedSkill === 'string' ? `affectedSkill='${change.affectedSkill}'` : null,
    typeof change?.skillName === 'string' ? `skillName='${change.skillName}'` : null,
  ]
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .join(', ') || '(no ref)';

  // Candidate titles: the profile's allowed skills first (most likely intent),
  // then any titles mentioned in the diagnosis text, deduped.
  const candidates = new Set<string>();
  const profileId = proposalProfileId(proposal);
  if (profileId) {
    const config = new AgentConfigsRepository().getById(profileId);
    if (config) {
      const allowedBare = new Set(parseAllowlist(config.allowedSkillsJson).map(bareSkillName));
      for (const s of skillsRepo.list()) {
        if (s.title && allowedBare.has(bareSkillName(s.title))) candidates.add(s.title);
      }
    }
  }
  const diagnosisText = [change?.diagnosis, change?.concreteFix]
    .filter((s): s is string => typeof s === 'string')
    .join('\n');
  if (diagnosisText.trim()) {
    for (const s of skillsRepo.list()) {
      if (s.title && diagnosisText.includes(s.title)) candidates.add(s.title);
    }
  }
  const closest = [...candidates].slice(0, 5);
  const closestText = closest.length ? closest.join(', ') : '(none — no matching skill on this instance)';
  return `could not resolve a live skill (looked for ${lookedFor}). Closest candidate skill titles: ${closestText}. Re-point the proposal's targetRef/affectedSkill at the intended skill title.`;
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
  // Reject unsafe content before mutating the DB, managed file, or proposal.
  // writeManagedSkill scans again at its own boundary; this preflight is what
  // makes the DB + file update atomic with respect to an injection rejection.
  const scan = scanContextContent(revisedBody, `skill "${skill.title}"`);
  if (scan.blocked) {
    throw AppError.badRequest(scan.warning ?? `Unsafe revision blocked for skill '${skill.title}'`);
  }

  // #1082 — the managed SKILL.md FILE is the source of truth, not the DB row.
  // A direct on-disk edit (PUT /opencode/skills/:name → writeManagedSkill) does
  // NOT update agent_skills.body, so snapshotting skill.body here can capture a
  // stale value. Capture both representations separately: exact file bytes for
  // byte-for-byte rollback, and the semantic DB body for DB rollback. Only use
  // the DB as the source-body fallback when SKILL.md is genuinely absent.
  const priorManagedFileBytes = readManagedSkillBytes(skill.title);
  const managedFileWasPresent = priorManagedFileBytes !== null;
  const priorBody = managedFileWasPresent
    ? stripFrontmatterBlock(priorManagedFileBytes.toString('utf8')).trim()
    : (skill.body ?? null);
  const beforeSnapshotJson = JSON.stringify({
    skillId: skill.id,
    priorBody,
    priorDbBody: skill.body ?? null,
    priorStatus: skill.status,
    managedFileWasPresent,
    managedFileBytesBase64: priorManagedFileBytes?.toString('base64') ?? null,
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

/**
 * C4 (docs/ai/contracts/issue-causal-runtime-v2.json, phase C4, requirement
 * 5) — before a human-approved refine-config apply runs, revalidate against
 * ANY experiment that already reached a causal verdict for this EXACT
 * proposal: "durable apply after verified must revalidate evidence,
 * proposal bytes, tested baseline revision/hash, and tested candidate hash.
 * Target drift returns conflict and requires a new experiment; it never
 * applies a stale winner."
 *
 * A refine-config proposal with NO experiment (an untested human edit —
 * this treatment family also supports those) is unaffected: this check is a
 * no-op when nothing has ever been tested. When an experiment DID reach a
 * terminal 'promote' decision, the CURRENT durable value must still equal
 * the exact baseline it was tested against (`candidateSpec.priorValue`),
 * and the proposal's OWN `change_json` candidate value must still equal the
 * exact candidate that was tested (`candidateSpec.candidateValue`) — either
 * drifting since the experiment ran means this would durably apply a
 * different change than the one that was verified.
 */
async function verifyTestedTargetStillMatches(
  proposal: AgentOrgProposal,
  patch: ConfigPatch,
  currentValue: string | null,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  let experiments;
  try {
    experiments = await new AgentOrgExperimentsRepository().listByProposalAsync(proposal.id);
  } catch {
    // A transient read failure never blocks an UNTESTED proposal's own
    // apply — it only means this revalidation could not run this time.
    return { ok: true };
  }
  const verifiedExperiment = experiments.find((e) => e.decision === 'promote');
  if (!verifiedExperiment) return { ok: true };

  let candidateSpec: ReturnType<typeof validateSystemPromptV1Spec>;
  try {
    candidateSpec = validateSystemPromptV1Spec(JSON.parse(verifiedExperiment.candidateSpecJson));
  } catch {
    return {
      ok: false,
      reason:
        `refine-config '${proposal.id}' has a verified experiment whose tested spec can no longer ` +
        'be read — a new experiment is required',
    };
  }
  if (!candidateSpec.valid) {
    return {
      ok: false,
      reason:
        `refine-config '${proposal.id}' has a verified experiment whose tested spec is no longer ` +
        'valid — a new experiment is required',
    };
  }
  if (patch.field !== 'system_prompt' || candidateSpec.spec.field !== 'system_prompt') {
    return {
      ok: false,
      reason:
        `refine-config '${proposal.id}' targets a different field than its verified experiment ` +
        'tested — a new experiment is required',
    };
  }
  if (currentValue !== candidateSpec.spec.priorValue) {
    return {
      ok: false,
      reason:
        `refine-config '${proposal.id}' target has drifted since its experiment was tested — a ` +
        'new experiment is required',
    };
  }
  if (patch.value !== candidateSpec.spec.candidateValue) {
    return {
      ok: false,
      reason:
        `refine-config '${proposal.id}' change_json no longer matches the exact candidate its ` +
        'experiment tested — a new experiment is required',
    };
  }
  return { ok: true };
}

async function validateRefineConfig(proposal: AgentOrgProposal): Promise<ProposalValidationResult> {
  const change = parseChange(proposal.changeJson);
  const protectedField = protectedGenericConfigField(change);
  if (protectedField) {
    return {
      valid: false,
      reason: `refine-config cannot mutate protected scope field '${protectedField}'`,
    };
  }
  const patch = extractConfigPatch(change);
  if (!patch) {
    return {
      valid: false,
      reason:
        'refine-config requires a machine-applyable configPatch {agentConfigId, field, value}; a prose-only diagnosis cannot be auto-applied',
    };
  }
  const config = new AgentConfigsRepository().getById(patch.agentConfigId);
  if (!config) {
    return { valid: false, reason: `refine-config target agent_config '${patch.agentConfigId}' no longer exists` };
  }
  const testedTargetCheck = await verifyTestedTargetStillMatches(
    proposal,
    patch,
    readAgentConfigField(config, patch.field),
  );
  if (!testedTargetCheck.ok) return { valid: false, reason: testedTargetCheck.reason };
  return { valid: true };
}

/**
 * Deliberately kept SYNCHRONOUS, unlike {@link validateRefineConfig}: every
 * real caller (`org_proposal_apply_service.applyProposal`) already runs
 * `validateProposalChange` — which awaits `validateRefineConfig`, including
 * its {@link verifyTestedTargetStillMatches} check — and throws BEFORE ever
 * invoking this applier, in the SAME request with no re-entrant write in
 * between. Re-deriving the same async check here would be a redundant
 * second query for no additional safety, and would turn every direct-applier
 * test in this codebase (which calls appliers synchronously) into a promise
 * — matching this module's existing pattern of appliers trusting the
 * validator that already ran, not re-checking business rules themselves.
 */
const refineConfigApplier: ProposalApplier = (proposal): ProposalApplyResult => {
  const change = parseChange(proposal.changeJson);
  const protectedField = protectedGenericConfigField(change);
  if (protectedField) {
    throw AppError.badRequest(`refine-config cannot mutate protected scope field '${protectedField}'`);
  }
  const patch = extractConfigPatch(change);
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
  if (updated) projectAgentProfileAfterWrite(updated, 'config-update');

  return {
    measurable: true,
    beforeSnapshotJson,
    postApplyTarget: {
      profileId: patch.agentConfigId,
      changeType: patch.field === 'allowedDelegatesJson' ? 'tool' : 'prompt',
    },
  };
};

// ── refine-scope ──
function validateRefineScope(proposal: AgentOrgProposal): ProposalValidationResult {
  try {
    const exactChangeJson = proposal.changeJson ?? '';
    const parsed = parseScopeMutation('refine-scope', exactChangeJson);
    const config = new AgentConfigsRepository().getById(parsed.agentConfigId);
    if (!config) return { valid: false, reason: `refine-scope target agent_config '${parsed.agentConfigId}' no longer exists` };
    prepareScopeMutation('refine-scope', exactChangeJson, readAgentConfigField(config, parsed.field));
    return { valid: true };
  } catch (error) {
    return { valid: false, reason: String(error instanceof Error ? error.message : error) };
  }
}

const refineScopeApplier: ProposalApplier = (proposal): ProposalApplyResult => {
  const exactChangeJson = proposal.changeJson;
  if (!exactChangeJson || !exactChangeJson.trim()) {
    throw AppError.badRequest('refine-scope change_json is missing at apply time');
  }
  let patch;
  try {
    patch = parseScopeMutation('refine-scope', exactChangeJson);
  } catch (error) {
    throw AppError.badRequest(String(error instanceof Error ? error.message : error));
  }
  const configsRepo = new AgentConfigsRepository();
  const config = configsRepo.getById(patch.agentConfigId);
  if (!config) throw AppError.badRequest(`refine-scope target '${patch.agentConfigId}' no longer exists`);

  const priorValue = readAgentConfigField(config, patch.field);
  let prepared;
  try {
    prepared = prepareScopeMutation('refine-scope', exactChangeJson, priorValue);
  } catch (error) {
    throw AppError.conflict(String(error instanceof Error ? error.message : error));
  }
  const snapshot = createScopeStateV2Snapshot(
    patch.agentConfigId,
    patch.field,
    priorValue,
    prepared.expectedAppliedValue,
    exactChangeJson,
    'refine-scope',
  );
  return prepareDeferredHumanScopeMutation({
    proposal,
    agentConfigId: patch.agentConfigId,
    field: patch.field,
    priorValue,
    nextValue: prepared.expectedAppliedValue,
    measurable: true,
    snapshot,
  });
};

// ── broaden-scope (#1139) ──
// The workflow_signal_generator's missing-scope lane emits a HIGH-risk
// broaden-scope proposal with a FLAT change_json ({agentConfigId, field, add})
// — NOT the nested {scopePatch:{...}} shape refine-scope uses — so it cannot be
// aliased to refineScopeApplier verbatim (extractScopePatch reads change.scopePatch
// and would find nothing). This validator/applier reads that flat shape and reuses
// the same deferred claim-first CAS/projection mechanics as every human scope
// mutation, with a scope-state-v2 exact-state snapshot. Fail-closed: refuses a payload missing agentConfigId /
// a valid scope field / a non-empty add, and drift-guards the target at apply time.

async function validateMcpScopeNames(names: string[]): Promise<ProposalValidationResult> {
  for (const name of names) {
    const { serverName, knownServerNames } = await resolveKnownMcpServerName(name);
    // Preserve the existing fail-open behavior while the engine catalog is
    // unavailable; proposal-time generation already refuses to emit without
    // a catalog, and approval will revalidate once the engine is ready.
    if (knownServerNames.length === 0) continue;
    if (!serverName || serverName !== name) {
      const suggestion = serverName ? ` Use server name '${serverName}' instead.` : '';
      const known = knownServerNames.length ? ` Known servers: ${knownServerNames.join(', ')}.` : '';
      return {
        valid: false,
        reason: `MCP allowlist entry '${name}' is not a known server name.${suggestion}${known}`,
      };
    }
  }
  return { valid: true };
}

async function validateBroadenScope(proposal: AgentOrgProposal): Promise<ProposalValidationResult> {
  try {
    const exactChangeJson = proposal.changeJson ?? '';
    const patch = parseScopeMutation('broaden-scope', exactChangeJson);
    const config = new AgentConfigsRepository().getById(patch.agentConfigId);
    if (!config) return { valid: false, reason: `broaden-scope target agent_config '${patch.agentConfigId}' no longer exists` };
    prepareScopeMutation('broaden-scope', exactChangeJson, readAgentConfigField(config, patch.field));
    if (patch.field === 'allowedMcpsJson') return validateMcpScopeNames(patch.add!);
    return { valid: true };
  } catch (error) {
    return { valid: false, reason: String(error instanceof Error ? error.message : error) };
  }
}

const broadenScopeApplier: ProposalApplier = (proposal): ProposalApplyResult => {
  const exactChangeJson = proposal.changeJson;
  if (!exactChangeJson || !exactChangeJson.trim()) {
    throw AppError.badRequest('broaden-scope change_json is missing at apply time');
  }
  let patch;
  try {
    patch = parseScopeMutation('broaden-scope', exactChangeJson);
  } catch (error) {
    throw AppError.badRequest(String(error instanceof Error ? error.message : error));
  }
  const configsRepo = new AgentConfigsRepository();
  const config = configsRepo.getById(patch.agentConfigId);
  if (!config) throw AppError.badRequest(`broaden-scope target '${patch.agentConfigId}' no longer exists`);

  const priorValue = readAgentConfigField(config, patch.field);
  let prepared;
  try {
    prepared = prepareScopeMutation('broaden-scope', exactChangeJson, priorValue);
  } catch (error) {
    throw AppError.conflict(String(error instanceof Error ? error.message : error));
  }
  const snapshot = createScopeStateV2Snapshot(
    patch.agentConfigId,
    patch.field,
    priorValue,
    prepared.expectedAppliedValue,
    exactChangeJson,
    'broaden-scope',
  );

  // The observable grant is the projected allowlist itself. Broadening has no
  // meaningful failure replay in measureProposal, so sending it to measuring
  // strands the row indefinitely as "unsupported kind".
  return prepareDeferredHumanScopeMutation({
    proposal,
    agentConfigId: patch.agentConfigId,
    field: patch.field,
    priorValue,
    nextValue: prepared.expectedAppliedValue,
    measurable: false,
    snapshot,
  });
};

/**
 * The scope-removal shape `tighten-scope`/`prune-scope` proposals carry:
 * {agentConfigId, field: 'allowedMcpsJson'|'allowedSkillsJson', remove: [<name>, ...]}.
 * Deliberately narrower than the refine-scope patch contract — a scope
 * REMOVAL proposal must never smuggle an `add` (broadening content has no
 * business on a human-gated removal kind; see W1 review), so its presence at
 * all (even `add: []`) is refused rather than silently ignored. Duplicate
 * `remove` entries are refused too — a legitimate audit gap never names the
 * same entry twice.
 */
async function validateScopeRemoval(proposal: AgentOrgProposal): Promise<ProposalValidationResult> {
  try {
    const kind = proposal.kind as ScopeProposalKind;
    const exactChangeJson = proposal.changeJson ?? '';
    const patch = parseScopeMutation(kind, exactChangeJson);
    const config = new AgentConfigsRepository().getById(patch.agentConfigId);
    if (!config) return { valid: false, reason: `${proposal.kind} target agent_config '${patch.agentConfigId}' no longer exists` };
    prepareScopeMutation(kind, exactChangeJson, readAgentConfigField(config, patch.field));
    if (patch.field === 'allowedMcpsJson') return validateMcpScopeNames(patch.remove!);
    return { valid: true };
  } catch (error) {
    return { valid: false, reason: String(error instanceof Error ? error.message : error) };
  }
}

/**
 * Human-approved apply for `tighten-scope`/`prune-scope` (W1 review finding
 * #2 — these two kinds are HIGH-risk and refused by the unattended
 * `org_proposal_apply.applyProposal` entry point; this is their ONLY
 * apply path, reachable solely through `OrgProposalsController.approve`'s
 * explicit human-consent gate). Prepares a V2 scope delta without mutating
 * (reused verbatim from org_proposal_apply.ts so this and any future
 * auto-lane snapshot can never drift), removes exactly the validated names,
 * re-projects the opencode agent file, and advances to `measuring` so the
 * same functional-guard measure step scope proposals have always used still
 * governs keep/revert.
 */
const scopeRemovalApplier: ProposalApplier = (proposal): ProposalApplyResult => {
  const exactChangeJson = proposal.changeJson;
  if (!exactChangeJson) {
    throw AppError.badRequest(`${proposal.kind} change_json is missing at apply time`);
  }
  const kind = proposal.kind as ScopeRemovalKind;
  let patch;
  try {
    patch = parseScopeMutation(kind, exactChangeJson);
  } catch (error) {
    throw AppError.badRequest(String(error instanceof Error ? error.message : error));
  }
  const configsRepo = new AgentConfigsRepository();
  const config = configsRepo.getById(patch.agentConfigId);
  if (!config) throw AppError.badRequest(`${proposal.kind} target '${patch.agentConfigId}' no longer exists`);

  const priorValue = readAgentConfigField(config, patch.field);
  let prepared;
  try {
    prepared = prepareScopeMutation(kind, exactChangeJson, priorValue);
  } catch (error) {
    throw AppError.conflict(String(error instanceof Error ? error.message : error));
  }
  const scopeDelta = createScopeDeltaV2Snapshot(
    patch.agentConfigId,
    patch.field as (typeof SCOPE_ALLOWLIST_FIELDS)[number],
    priorValue,
    patch.remove!,
    kind,
    exactChangeJson,
  );

  return prepareDeferredHumanScopeMutation({
    proposal,
    agentConfigId: patch.agentConfigId,
    field: patch.field,
    priorValue,
    nextValue: prepared.expectedAppliedValue,
    measurable: true,
    snapshot: scopeDelta,
  });
};

// ── workflow-prompt-fix: skill-create branch (#1152) ──
//
// A workflow-prompt-fix normally EDITS a live skill's body (below). But the
// org-optimizer's missing-skill diagnosis (workflow_signal_generator.ts sets
// `rootCause: 'skill'` for this case) targets a skill that doesn't exist yet
// — `resolveSkillForProposal` (and its #1041 fallbacks) can never resolve it,
// so before #1152 every such proposal dead-ended on
// `describeSkillResolutionFailure`'s "re-point the proposal" refusal even
// though the diagnosis's actual intent was "create this skill". The
// discriminator is deliberately an EXPLICIT intent field (`rootCause ===
// 'skill'`), not a fuzzy near-miss heuristic — a genuine typo'd/misrouted ref
// with any other rootCause still refuses with the existing guidance.

/**
 * True when a no-match workflow-prompt-fix proposal is an explicit
 * skill-CREATE (not a stale/mis-pointed edit): the diagnosis names
 * `rootCause: 'skill'` AND the intended title (`proposalProfileId`) is a
 * non-empty, path-safe bare name. Never creates a blank/unsafe-titled skill —
 * an invalid title falls through to the existing refusal.
 */
function isSkillCreateProposal(proposal: AgentOrgProposal): boolean {
  if (resolveSkillForProposal(proposal)) return false;
  const change = parseChange(proposal.changeJson);
  if (change?.rootCause !== 'skill') return false;
  const title = proposalProfileId(proposal);
  if (!title) return false;
  try {
    slugForSkillName(title);
  } catch (err) {
    if (err instanceof InvalidSkillNameError) return false;
    throw err;
  }
  return true;
}

/**
 * Scaffold the missing skill named by an {@link isSkillCreateProposal} and
 * grant it to the profile the diagnosis targeted. Reuses the EXACT
 * write-if-absent + allowedSkillsJson-grant mechanics
 * `buildRealExternalAdoptionDeps().installSkill` already uses for adopted
 * skills above, rather than a second implementation. `title` doubles as the
 * agent_config id to grant (the same conflation `proposalProfileId` exists
 * to paper over — see its doc comment).
 *
 * ponytail: revert only restores the snapshot fields (nothing deletes the
 * created skill/grant on revert) — the issue's acceptance criteria don't ask
 * for delete-on-revert; add an `isSkillCreateRevertSnapshot` branch in
 * org_proposal_apply.ts's revertProposal if that's ever needed.
 */
function applySkillCreate(proposal: AgentOrgProposal, title: string, concreteFix: string): ProposalApplyResult {
  const revisedBody = draftPromptFixBody('', concreteFix);

  const scan = scanContextContent(revisedBody, `skill "${title}"`);
  if (scan.blocked) {
    throw AppError.badRequest(scan.warning ?? `Unsafe skill body blocked for '${title}'`);
  }

  const skillWasAbsent = !managedSkillExists(title);
  if (skillWasAbsent) {
    writeManagedSkill({
      name: title,
      description: 'Created by workflow-prompt-fix (missing-skill diagnosis)',
      body: revisedBody,
    });
  }

  const skillsRepo = new AgentSkillsRepository();
  const skill = skillsRepo.findByTitle(title) ?? skillsRepo.create({ title, body: revisedBody, status: 'active' });

  const configsRepo = new AgentConfigsRepository();
  const config = configsRepo.getById(title);
  let priorAllowedSkillsJson: string | null = null;
  if (config) {
    priorAllowedSkillsJson = config.allowedSkillsJson ?? null;
    const list = parseAllowlist(priorAllowedSkillsJson);
    if (!list.includes(title)) {
      configsRepo.update(title, { allowedSkillsJson: JSON.stringify([...list, title]) });
      const updated = configsRepo.getById(title);
      if (updated) projectAgentProfileAfterWrite(updated, 'config-update'); // resync through the boundary
    }
  }

  const beforeSnapshotJson = JSON.stringify({
    skillCreated: true,
    createdSkillId: skill.id,
    skillWasAbsent,
    agentConfigId: config ? title : null,
    priorAllowedSkillsJson,
  });
  const changeJson = JSON.stringify({
    skillName: title,
    priorBody: '',
    revisedBody,
    description: skill.description ?? null,
    whenToUse: skill.whenToUse ?? null,
  });

  return { measurable: true, beforeSnapshotJson, changeJson };
}

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
    if (isSkillCreateProposal(proposal)) return { valid: true };
    return {
      valid: false,
      reason: `workflow-prompt-fix ${describeSkillResolutionFailure(proposal)}`,
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
  if (!skill) {
    if (isSkillCreateProposal(proposal)) {
      return applySkillCreate(proposal, proposalProfileId(proposal)!, concreteFix);
    }
    throw AppError.badRequest(`workflow-prompt-fix ${describeSkillResolutionFailure(proposal)}`);
  }

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
      reason: `refine-skill ${describeSkillResolutionFailure(proposal)}`,
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
  if (!skill) throw AppError.badRequest(`refine-skill ${describeSkillResolutionFailure(proposal)}`);
  return applySkillBodyRevision(skill, revisedBody);
};

// ── refine-task (#981) ──
// Edits a scheduled-task definition (instructions/prompt, schedule, or agent
// binding). HIGH-risk → human-gated → applied HERE on approve. Mirrors
// refine-config exactly: fail-closed validator, snapshot-before-mutate applier
// that mutates via AgentScheduledTasksRepository.updateAsync (never raw SQL),
// returning {measurable:true, beforeSnapshotJson} so the row advances to
// measuring. `scheduledTaskId` was server-resolved by the producer.
function validateRefineTask(proposal: AgentOrgProposal): Promise<ProposalValidationResult> | ProposalValidationResult {
  const patch = extractTaskPatch(parseChange(proposal.changeJson));
  if (!patch) {
    return {
      valid: false,
      reason:
        'refine-task requires a machine-applyable taskPatch {scheduledTaskId, field, value}; a prose-only diagnosis cannot be auto-applied',
    };
  }
  return new AgentScheduledTasksRepository().findByIdAsync(patch.scheduledTaskId).then((task) =>
    task
      ? { valid: true }
      : { valid: false, reason: `refine-task target scheduled task '${patch.scheduledTaskId}' no longer exists` },
  );
}

const refineTaskApplier: ProposalApplier = async (proposal): Promise<ProposalApplyResult> => {
  const patch = extractTaskPatch(parseChange(proposal.changeJson));
  if (!patch) throw AppError.badRequest('refine-task change_json is missing its taskPatch at apply time');
  const tasksRepo = new AgentScheduledTasksRepository();
  const task = await tasksRepo.findByIdAsync(patch.scheduledTaskId);
  if (!task) throw AppError.badRequest(`refine-task target '${patch.scheduledTaskId}' no longer exists`);

  const priorValue = readScheduledTaskField(task, patch.field);
  const beforeSnapshotJson = JSON.stringify({
    scheduledTaskId: patch.scheduledTaskId,
    field: patch.field,
    priorValue,
  });

  await tasksRepo.updateAsync(patch.scheduledTaskId, scheduledTaskFieldPatch(patch.field, patch.value));

  const result: ProposalApplyResult = { measurable: true, beforeSnapshotJson };

  // Text edits (prompt/description) are LLM-judged: reshape change_json into a
  // BodyRefinementChange the measure step reads — ADDITIVELY, keeping taskPatch
  // so measureProposal's router still sees the field. Schedule/binding edits
  // leave change_json intact (behavioral re-run reads affectedSkill+sessionIds).
  if ((TASK_PATCH_TEXT_FIELDS as readonly string[]).includes(patch.field)) {
    result.changeJson = JSON.stringify({
      ...(parseChange(proposal.changeJson) ?? {}),
      priorBody: priorValue ?? '',
      revisedBody: patch.value,
    });
  }
  return result;
};

// ── publish-skill-to-org (#1056 / OCU-15) ──
//
// Promotes an approved LOCAL managed skill to the shared org library (#1053's
// `/org-skills/<name>` endpoint) through the existing human-gated review
// queue, or removes it (`action: 'unpublish'`). NEVER auto-applied —
// org-visible artifacts stay human-gated (see org_risk_classifier.ts).
//
// `content` is the skill's EXACT on-disk SKILL.md bytes (frontmatter
// included, via readManagedSkillBytes) — the fork's discovery downloader
// expects a real SKILL.md, not a frontmatter-stripped body (unlike
// applySkillBodyRevision's DB-facing body above, a different consumer).
//
// Auth: POST/DELETE against `/org-skills/:name` require the same JWT
// session-token auth as every other authenticated route (#1053). This
// instance authenticates using env.prodAuthToken (PROD_AUTH_TOKEN) — the
// SAME credential sync_orchestrator_service.ts already uses to call
// production for task mirroring — against env.prodApiUrl's org-skills
// endpoint (resolveProdApiBase(), shared with #1054's ensureOrgSkillIndex).

interface PublishToOrgChange {
  skillName: string;
  action: 'publish' | 'unpublish';
}

function parsePublishToOrgChange(proposal: AgentOrgProposal): PublishToOrgChange | null {
  const change = parseChange(proposal.changeJson);
  const skillName = change?.skillName;
  const action = change?.action;
  if (typeof skillName !== 'string' || !skillName.trim()) return null;
  if (action !== 'publish' && action !== 'unpublish') return null;
  return { skillName: skillName.trim(), action };
}

function validatePublishToOrg(proposal: AgentOrgProposal): ProposalValidationResult {
  const change = parsePublishToOrgChange(proposal);
  if (!change) {
    return {
      valid: false,
      reason:
        "publish-skill-to-org requires change_json {skillName, action: 'publish'|'unpublish'}",
    };
  }
  if (change.action === 'publish' && !managedSkillExists(change.skillName)) {
    return {
      valid: false,
      reason: `publish-skill-to-org target managed skill '${change.skillName}' no longer exists`,
    };
  }
  return { valid: true };
}

/**
 * POST/DELETE against the org skill library. Throws on any non-OK response
 * or transport failure — the applier below turns that into the 'failed'
 * (retryable) proposal status rather than silently pretending success or
 * leaving the proposal stuck at 'proposed' with no record an attempt ran.
 */
async function callOrgSkillsEndpoint(
  skillName: string,
  init: { method: 'POST' | 'DELETE'; body?: string },
): Promise<void> {
  const token = env.prodAuthToken;
  if (!token) {
    throw new Error(
      'publish-skill-to-org: no production auth token configured (PROD_AUTH_TOKEN) — cannot publish',
    );
  }
  const url = `${resolveProdApiBase()}/org-skills/${encodeURIComponent(skillName)}`;
  const res = await fetch(url, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(init.body !== undefined ? { body: init.body } : {}),
  });
  if (!res.ok) {
    throw new Error(`publish-skill-to-org: ${init.method} ${url} -> HTTP ${res.status}`);
  }
}

const publishToOrgApplier: ProposalApplier = async (proposal): Promise<ProposalApplyResult> => {
  const change = parsePublishToOrgChange(proposal);
  if (!change) {
    throw AppError.badRequest(
      'publish-skill-to-org change_json is missing skillName/action at apply time',
    );
  }

  try {
    if (change.action === 'unpublish') {
      await callOrgSkillsEndpoint(change.skillName, { method: 'DELETE' });
    } else {
      const bytes = readManagedSkillBytes(change.skillName);
      if (bytes === null) {
        throw new Error(
          `publish-skill-to-org: managed SKILL.md for '${change.skillName}' not found on disk`,
        );
      }
      const sidecar = new AgentSkillsRepository().findByName(change.skillName);
      await callOrgSkillsEndpoint(change.skillName, {
        method: 'POST',
        body: JSON.stringify({
          description: sidecar?.description ?? undefined,
          content: bytes.toString('utf8'),
          published: true,
        }),
      });
    }
  } catch (err) {
    // Never silently "succeed" — mark failed (retryable via a re-approve;
    // see org_proposals_controller.ts's approve() guard) and re-throw so the
    // approve request itself still surfaces an error to the caller.
    await new AgentOrgProposalsRepository().updateStatusAsync(proposal.id, 'failed');
    throw err;
  }

  return {
    measurable: false,
    beforeSnapshotJson: JSON.stringify({
      publishToOrg: true,
      skillName: change.skillName,
      action: change.action,
    }),
  };
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
    // #1139 — broaden-scope (missing-scope workflow signal): HIGH-risk, human-
    // gated grant of a denied MCP/skill. Reads the FLAT {agentConfigId, field, add}
    // the workflow_signal_generator emits (distinct from refine-scope's nested
    // scopePatch), so it cannot alias refineScopeApplier — but shares its snapshot
    // shape, so revert/measure are already covered.
    registry.registerProposalValidator('broaden-scope', validateBroadenScope);
    registry.registerProposalApplier('broaden-scope', broadenScopeApplier);
    // W1 (self-improvement-engine-foundation review) — tighten-scope/prune-scope
    // are now HIGH-risk (org_risk_classifier.ts) and refused outright by the
    // unattended org_proposal_apply.applyProposal entry point. This is their
    // ONLY apply path: reachable exclusively through OrgProposalsController
    // .approve()'s explicit human-consent gate, never the auto lane.
    registry.registerProposalValidator('tighten-scope', validateScopeRemoval);
    registry.registerProposalApplier('tighten-scope', scopeRemovalApplier);
    registry.registerProposalValidator('prune-scope', validateScopeRemoval);
    registry.registerProposalApplier('prune-scope', scopeRemovalApplier);
    registry.registerProposalValidator('workflow-prompt-fix', validateWorkflowPromptFix);
    registry.registerProposalApplier('workflow-prompt-fix', workflowPromptFixApplier);
    registry.registerProposalValidator('refine-skill', validateRefineSkill);
    registry.registerProposalApplier('refine-skill', refineSkillApplier);
    registry.registerProposalValidator('refine-task', validateRefineTask);
    registry.registerProposalApplier('refine-task', refineTaskApplier);
  } catch (err) {
    logger.warn(`[org-proposal-appliers-wiring] failed to register diagnosis-lane appliers (non-fatal): ${String(err)}`);
  }

  // #1056 — publish-skill-to-org: promote/unpublish an approved local skill
  // to the shared org library. A distinct kind from #1114's external-adoption
  // (inbound: adopt a discovered skill/MCP) — this is outbound: publish a
  // LOCAL skill org-wide.
  try {
    registry.registerProposalValidator('publish-skill-to-org', validatePublishToOrg);
    registry.registerProposalApplier('publish-skill-to-org', publishToOrgApplier);
  } catch (err) {
    logger.warn(`[org-proposal-appliers-wiring] failed to register publish-skill-to-org applier (non-fatal): ${String(err)}`);
  }

  logger.info(
    '[org-proposal-appliers-wiring] registered appliers for: create-agent, grant-delegation, expand-delegation, external-adoption, webhook-wiring, create-recipe, refine-config, refine-scope, broaden-scope, tighten-scope, prune-scope, workflow-prompt-fix, refine-skill, refine-task, publish-skill-to-org',
  );
}
