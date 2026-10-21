import { AppError } from '../errors/app_error';
import type { AgentOrgProposal } from '../models/agent_org_proposal';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import type { OrgEvaluationTargetSnapshot } from './org_evaluation_fixture';
import { readManagedSkillBytes } from './rhythm_managed_skills';

/** The approval guard arms only its exact proposal object after a fresh recapture. */
const armed = new WeakMap<AgentOrgProposal, OrgEvaluationTargetSnapshot>();

export function armOrgEvaluationApplyFence(proposal: AgentOrgProposal,
  originalSnapshot: OrgEvaluationTargetSnapshot): void {
  if (originalSnapshot.kind !== proposal.kind || originalSnapshot.targetRef !== proposal.targetRef)
    throw AppError.conflict('Evaluated snapshot does not match proposal target');
  armed.set(proposal, originalSnapshot);
}

function isEvaluated(proposal: AgentOrgProposal): boolean {
  if (!proposal.provenanceJson) return false;
  try {
    const value: unknown = JSON.parse(proposal.provenanceJson);
    return !!value && typeof value === 'object' && !Array.isArray(value)
      && (value as Record<string, unknown>).source === 'org-reviewer-evaluated';
  } catch { return false; }
}

/** No promise or I/O await may separate this check from a synchronous mutation. */
export function assertOrgEvaluationApplyFenceSync(proposal: AgentOrgProposal): OrgEvaluationTargetSnapshot | null {
  if (!isEvaluated(proposal)) return null;
  const snapshot = armed.get(proposal);
  if (!snapshot) throw AppError.conflict('Evaluated apply was not armed by approval');
  const configs = new AgentConfigsRepository();
  const skills = new AgentSkillsRepository();
  for (const frozen of snapshot.profiles) {
    const current = configs.getById(frozen.id);
    if (!current || !current.enabled || current.locked || (current.revision ?? 0) !== frozen.revision
      || current.label !== frozen.label || current.systemPrompt !== frozen.systemPrompt
      || current.allowedMcpsJson !== frozen.allowedMcpsJson
      || current.allowedSkillsJson !== frozen.allowedSkillsJson
      || current.corePermissionsJson !== frozen.corePermissionsJson
      || current.allowedDelegatesJson !== frozen.allowedDelegatesJson
      || current.isManager !== frozen.isManager || current.modelProvider !== frozen.modelProvider
      || current.modelId !== frozen.modelId)
      throw AppError.conflict('Evaluated profile changed after approval validation');
  }
  for (const frozen of snapshot.skills) {
    const current = skills.getById(frozen.id);
    if (!current || current.title !== frozen.title || current.body !== frozen.body
      || current.description !== frozen.description || current.whenToUse !== frozen.whenToUse
      || current.version !== frozen.version
      || (frozen.status !== undefined && current.status !== frozen.status)
      || (frozen.confidence !== undefined && current.confidence !== frozen.confidence)
      || (frozen.stepsJson !== undefined && current.stepsJson !== frozen.stepsJson)
      || (frozen.tagsJson !== undefined && current.tagsJson !== frozen.tagsJson))
      throw AppError.conflict('Evaluated skill changed after approval validation');
  }
  for (const frozen of snapshot.managedSkillFiles) {
    if (readManagedSkillBytes(frozen.name)?.toString('base64') !== frozen.bytesBase64)
      throw AppError.conflict('Evaluated managed skill bytes changed after approval validation');
  }
  return snapshot;
}
