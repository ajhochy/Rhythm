import type { OrgEvaluationProposalKind } from '../models/org_evaluation';

type Snapshot = { kind?: unknown; targetRef?: unknown; skills?: unknown };

/** Publication has one executable action for one frozen skill and direction. */
export function deriveSingletonPublicationAction(input: {
  kind: OrgEvaluationProposalKind;
  targetRef: string;
  snapshot: Snapshot;
  change: unknown;
}): { skillName: string; action: 'publish' | 'unpublish' } | null {
  if (input.kind !== 'publish-skill-to-org') return null;
  const { snapshot, targetRef, change } = input;
  if (snapshot.kind !== input.kind || snapshot.targetRef !== targetRef || !targetRef.startsWith('skill:')
    || !Array.isArray(snapshot.skills) || !change || typeof change !== 'object' || Array.isArray(change))
    throw Error('Singleton publication requires one frozen skill and exact action');
  const action = change as Record<string, unknown>;
  if (Object.keys(action).sort().join(',') !== 'action,skillName'
    || (action.action !== 'publish' && action.action !== 'unpublish')
    || typeof action.skillName !== 'string' || !action.skillName.trim())
    throw Error('Singleton publication contains an invalid or invented action field');
  const matches = snapshot.skills.filter((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const skill = item as Record<string, unknown>;
    return (targetRef === `skill:${skill.id}` || targetRef === `skill:${skill.title}`)
      && skill.title === action.skillName;
  });
  if (matches.length !== 1) throw Error('Singleton publication differs from the frozen skill target');
  return { skillName: action.skillName, action: action.action };
}
