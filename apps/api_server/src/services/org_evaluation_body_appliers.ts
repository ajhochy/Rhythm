import { getDb, getPostgresPool } from '../database/db';
import { env } from '../config/env';
import type { AgentOrgProposal } from '../models/agent_org_proposal';
import { AgentCookbookRepository } from '../repositories/agent_cookbook_repository';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import { scanContextContent } from '../security/context_scanner';
import { parseStrictJson } from './strict_json';
import { readManagedSkillBytes, writeManagedSkill, deleteManagedSkill, restoreManagedSkillBytes } from './rhythm_managed_skills';
import type { ProposalApplier, ProposalValidator, ProposalValidationResult } from './org_proposal_apply_service';

interface Registry {
  registerProposalApplier(kind: string, applier: ProposalApplier): void;
  registerProposalValidator(kind: string, validator: ProposalValidator): void;
}
interface RecipeChange { recipeId: string; priorStepsJson: string; revisedStepsJson: string }
interface ConsolidationChange {
  survivorSkillId: string; retiredSkillId: string; priorSurvivorBody: string | null;
  priorRetiredBody: string | null; revisedBody: string;
}
function object(proposal: AgentOrgProposal, keys: string[]): Record<string, unknown> {
  const value: unknown = parseStrictJson(proposal.changeJson ?? '', `${proposal.kind} change`);
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw Error('Exact frozen body-change fields are required');
  return value as Record<string, unknown>;
}
function safeBody(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 128000
    && !scanContextContent(value, 'evaluated body change').blocked;
}
function recipeChange(proposal: AgentOrgProposal): RecipeChange {
  const value = object(proposal, ['recipeId', 'priorStepsJson', 'revisedStepsJson']);
  if (typeof value.recipeId !== 'string' || proposal.targetRef !== `recipe:${value.recipeId}`
    || typeof value.priorStepsJson !== 'string' || !safeBody(value.revisedStepsJson)) throw Error('Recipe target or frozen steps are invalid');
  for (const source of [value.priorStepsJson, value.revisedStepsJson]) {
    const steps: unknown = parseStrictJson(source as string, 'recipe steps');
    if (!Array.isArray(steps) || steps.length > 64) throw Error('Recipe steps must be a bounded array');
  }
  if (value.priorStepsJson === value.revisedStepsJson) throw Error('Recipe revision makes no change');
  return value as unknown as RecipeChange;
}
function consolidationChange(proposal: AgentOrgProposal): ConsolidationChange {
  const value = object(proposal, ['survivorSkillId', 'retiredSkillId', 'priorSurvivorBody', 'priorRetiredBody', 'revisedBody']);
  if (typeof value.survivorSkillId !== 'string' || typeof value.retiredSkillId !== 'string'
    || value.survivorSkillId === value.retiredSkillId || proposal.targetRef !== `skill:${value.survivorSkillId}`
    || value.priorSurvivorBody !== null && typeof value.priorSurvivorBody !== 'string'
    || value.priorRetiredBody !== null && typeof value.priorRetiredBody !== 'string'
    || !safeBody(value.revisedBody)) throw Error('Consolidation needs two distinct frozen source skills and an exact revised body');
  return value as unknown as ConsolidationChange;
}
async function validateRecipe(proposal: AgentOrgProposal): Promise<ProposalValidationResult> {
  try {
    const change = recipeChange(proposal);
    const current = await new AgentCookbookRepository().findByIdAsync(change.recipeId);
    if (!current || current.stepsJson !== change.priorStepsJson || current.definitionJson !== null)
      throw Error('Recipe changed or requires a workflow-aware revision');
    return { valid: true };
  } catch (error) { return { valid: false, reason: String(error instanceof Error ? error.message : error) }; }
}
async function applyRecipe(proposal: AgentOrgProposal) {
  const change = recipeChange(proposal);
  const stamp = new Date().toISOString();
  const updated = env.dbClient === 'postgres'
    ? (await getPostgresPool().query(`UPDATE agent_cookbook SET steps_json=$1,updated_at=$2
      WHERE id=$3 AND steps_json=$4 AND definition_json IS NULL RETURNING id`,
    [change.revisedStepsJson, stamp, change.recipeId, change.priorStepsJson])).rowCount
    : getDb().prepare(`UPDATE agent_cookbook SET steps_json=?,updated_at=?
      WHERE id=? AND steps_json=? AND definition_json IS NULL`).run(change.revisedStepsJson, stamp, change.recipeId, change.priorStepsJson).changes;
  if (updated !== 1) throw Error('Recipe changed before applying the exact tested steps');
  return { measurable: false, beforeSnapshotJson: JSON.stringify({
    recipeId: change.recipeId, priorStepsJson: change.priorStepsJson, expectedAppliedStepsJson: change.revisedStepsJson,
  }) };
}
function validateConsolidation(proposal: AgentOrgProposal): ProposalValidationResult {
  try {
    if (env.dbClient === 'postgres') throw Error('Managed skill consolidation is local-only');
    const change = consolidationChange(proposal);
    const skills = new AgentSkillsRepository();
    const survivor = skills.getById(change.survivorSkillId);
    const retired = skills.getById(change.retiredSkillId);
    if (!survivor || !retired || survivor.body !== change.priorSurvivorBody || retired.body !== change.priorRetiredBody
      || survivor.status === 'retired' || retired.status === 'retired') throw Error('Consolidation source changed');
    return { valid: true };
  } catch (error) { return { valid: false, reason: String(error instanceof Error ? error.message : error) }; }
}
function applyConsolidation(proposal: AgentOrgProposal) {
  const validation = validateConsolidation(proposal);
  if (!validation.valid) throw Error(validation.reason);
  const change = consolidationChange(proposal);
  const skills = new AgentSkillsRepository();
  const survivor = skills.getById(change.survivorSkillId)!;
  const retired = skills.getById(change.retiredSkillId)!;
  const survivorBytes = readManagedSkillBytes(survivor.title);
  const retiredBytes = readManagedSkillBytes(retired.title);
  try {
    writeManagedSkill({ name: survivor.title, description: survivor.description ?? undefined, body: change.revisedBody });
    deleteManagedSkill(retired.title);
    getDb().transaction(() => {
      // The two source rows commit together; a new user edit cannot be silently
      // overwritten by a revision that was tested against different bodies.
      const stamp = new Date().toISOString();
      const a = getDb().prepare(`UPDATE agent_skills SET body=?,updated_at=?
        WHERE id=? AND body IS ? AND status=?`).run(change.revisedBody, stamp, survivor.id, survivor.body, survivor.status);
      const b = getDb().prepare(`UPDATE agent_skills SET status='retired',updated_at=?
        WHERE id=? AND body IS ? AND status=?`).run(stamp, retired.id, retired.body, retired.status);
      if (a.changes !== 1 || b.changes !== 1) throw Error('Consolidation source changed during apply');
    })();
  } catch (error) {
    if (survivorBytes) restoreManagedSkillBytes(survivor.title, survivorBytes); else deleteManagedSkill(survivor.title);
    if (retiredBytes) restoreManagedSkillBytes(retired.title, retiredBytes); else deleteManagedSkill(retired.title);
    throw error;
  }
  return { measurable: false, beforeSnapshotJson: JSON.stringify({
    survivorSkillId: survivor.id, survivorPriorBody: survivor.body, survivorPriorStatus: survivor.status,
    retiredSkillId: retired.id, retiredPriorBody: retired.body, retiredPriorStatus: retired.status,
    survivorManagedBytesBase64: survivorBytes?.toString('base64') ?? null,
    retiredManagedBytesBase64: retiredBytes?.toString('base64') ?? null,
    appliedSurvivorManagedBytesBase64: readManagedSkillBytes(survivor.title)!.toString('base64'),
    expectedAppliedBody: change.revisedBody,
  }) };
}

/** The worker and human queue share these exact frozen-payload appliers. */
export function registerOrgEvaluationBodyAppliers(registry: Registry): void {
  registry.registerProposalValidator('refine-recipe', validateRecipe);
  registry.registerProposalApplier('refine-recipe', applyRecipe);
  registry.registerProposalValidator('consolidate-skill', validateConsolidation);
  registry.registerProposalApplier('consolidate-skill', applyConsolidation);
}

/** Restore only the tested deployment; preserve any later operator edit. */
export async function revertOrgEvaluationBodyAsync(proposal: AgentOrgProposal): Promise<'not-applicable' | 'reverted' | 'conflict'> {
  if (!proposal.beforeSnapshotJson) return 'not-applicable';
  const snapshot = JSON.parse(proposal.beforeSnapshotJson) as Record<string, unknown>;
  if (proposal.kind === 'refine-recipe' && typeof snapshot.recipeId === 'string'
    && typeof snapshot.priorStepsJson === 'string' && typeof snapshot.expectedAppliedStepsJson === 'string') {
    const stamp = new Date().toISOString();
    const changed = env.dbClient === 'postgres'
      ? (await getPostgresPool().query(`UPDATE agent_cookbook SET steps_json=$1,updated_at=$2
        WHERE id=$3 AND steps_json=$4 AND definition_json IS NULL RETURNING id`,
      [snapshot.priorStepsJson, stamp, snapshot.recipeId, snapshot.expectedAppliedStepsJson])).rowCount
      : getDb().prepare(`UPDATE agent_cookbook SET steps_json=?,updated_at=?
        WHERE id=? AND steps_json=? AND definition_json IS NULL`).run(snapshot.priorStepsJson, stamp,
      snapshot.recipeId, snapshot.expectedAppliedStepsJson).changes;
    return changed === 1 ? 'reverted' : 'conflict';
  }
  if (proposal.kind !== 'consolidate-skill' || typeof snapshot.expectedAppliedBody !== 'string'
    || typeof snapshot.appliedSurvivorManagedBytesBase64 !== 'string') return 'not-applicable';
  const skills = new AgentSkillsRepository();
  const survivor = typeof snapshot.survivorSkillId === 'string' ? skills.getById(snapshot.survivorSkillId) : null;
  const retired = typeof snapshot.retiredSkillId === 'string' ? skills.getById(snapshot.retiredSkillId) : null;
  if (!survivor || !retired || survivor.body !== snapshot.expectedAppliedBody || retired.status !== 'retired'
    || retired.body !== snapshot.retiredPriorBody
    || readManagedSkillBytes(survivor.title)?.toString('base64') !== snapshot.appliedSurvivorManagedBytesBase64
    || readManagedSkillBytes(retired.title) !== null) return 'conflict';
  const restore = (name: string, bytes: unknown) => {
    if (typeof bytes === 'string') restoreManagedSkillBytes(name, Buffer.from(bytes, 'base64'));
    else deleteManagedSkill(name);
  };
  try {
    restore(survivor.title, snapshot.survivorManagedBytesBase64);
    restore(retired.title, snapshot.retiredManagedBytesBase64);
    getDb().transaction(() => {
      const a = getDb().prepare('UPDATE agent_skills SET body=?,status=? WHERE id=? AND body IS ? AND status=?')
        .run(snapshot.survivorPriorBody, snapshot.survivorPriorStatus, survivor.id, survivor.body, survivor.status);
      const b = getDb().prepare('UPDATE agent_skills SET body=?,status=? WHERE id=? AND body IS ? AND status=?')
        .run(snapshot.retiredPriorBody, snapshot.retiredPriorStatus, retired.id, retired.body, retired.status);
      if (a.changes !== 1 || b.changes !== 1) throw Error('Consolidation changed during rollback');
    })();
  } catch (error) {
    restore(survivor.title, snapshot.appliedSurvivorManagedBytesBase64);
    deleteManagedSkill(retired.title);
    throw error;
  }
  return 'reverted';
}
