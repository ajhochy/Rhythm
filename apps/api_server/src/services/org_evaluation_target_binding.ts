import type { OrgEvaluationProposalKind } from '../models/org_evaluation';
import type { OrgEvaluationTargetSnapshot } from './org_evaluation_fixture';

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
/** A valid apply payload must also touch the target named in human review. */
export function assertOrgEvaluationTargetBinding(input: {
  kind: OrgEvaluationProposalKind; targetRef: string; change: Record<string, unknown>; snapshot: OrgEvaluationTargetSnapshot;
}): void {
  const { kind, change, targetRef, snapshot } = input;
  const requireEqual = (actual: unknown, expected: string) => {
    if (actual !== expected) throw Error('Candidate change targets a different object than the frozen review target');
  };
  if (['refine-config', 'refine-scope', 'broaden-scope', 'tighten-scope', 'prune-scope',
    'grant-delegation', 'expand-delegation', 'tool-install'].includes(kind)) {
    if (!targetRef.startsWith('agent_config:')) throw Error('Profile improvement requires an exact profile target');
    const payload = kind === 'refine-config' ? object(change.configPatch)
      : kind === 'refine-scope' ? object(change.scopePatch) : change;
    requireEqual(payload.agentConfigId, targetRef.slice('agent_config:'.length));
  } else if (kind === 'refine-task') {
    if (!targetRef.startsWith('scheduled_task:')) throw Error('Task improvement requires an exact scheduled task target');
    requireEqual(object(change.taskPatch).scheduledTaskId, targetRef.slice('scheduled_task:'.length));
  } else if (kind === 'refine-recipe') {
    if (!targetRef.startsWith('recipe:')) throw Error('Recipe improvement requires an exact recipe target');
    requireEqual(change.recipeId, targetRef.slice('recipe:'.length));
  } else if (kind === 'consolidate-skill') {
    if (!targetRef.startsWith('skill:')) throw Error('Consolidation requires an exact survivor target');
    const survivor = snapshot.skills.find(skill => skill.id === targetRef.slice(6) || skill.title === targetRef.slice(6));
    if (!survivor) throw Error('Consolidation survivor is absent from the frozen original');
    requireEqual(change.survivorSkillId, survivor.id);
    if (!snapshot.skills.some(skill => skill.id === change.retiredSkillId)) throw Error('Consolidation dependency was not frozen');
  } else if (['refine-skill', 'publish-skill-to-org'].includes(kind) || kind === 'workflow-prompt-fix' && targetRef.startsWith('skill:')) {
    if (!targetRef.startsWith('skill:')) throw Error('Skill improvement requires an exact skill target');
    const skill = snapshot.skills.find(item => item.id === targetRef.slice(6) || item.title === targetRef.slice(6));
    if (!skill) throw Error('Skill target is absent from the frozen original');
    for (const [key, expected] of [['skillId', skill.id], ['skillName', skill.title]] as const)
      if (change[key] !== undefined) requireEqual(change[key], expected);
  } else if (kind === 'create-agent') {
    requireEqual(targetRef, `agent_config:${String(change.agentSlug)}`);
  } else if (kind === 'create-recipe') {
    requireEqual(targetRef, `recipe:${String(change.title)}`);
  } else if (kind === 'external-adoption') {
    if (!targetRef.startsWith('agent_config:')) throw Error('Adoption requires its exact needing profile');
    requireEqual(change.agentConfigId, targetRef.slice('agent_config:'.length));
  }
}
