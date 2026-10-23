import { describe, expect, it } from 'vitest';
import { deriveSingletonPublicationAction } from '../org_evaluation_singleton_action';

const snapshot = {
  kind: 'publish-skill-to-org', targetRef: 'skill:skill-1',
  skills: [{ id: 'skill-1', title: 'Reviewed Skill' }],
};

describe('code-owned singleton publication action', () => {
  it('derives exactly the one reviewed skill action without inventing alternatives', () => {
    expect(deriveSingletonPublicationAction({ kind: 'publish-skill-to-org',
      targetRef: 'skill:skill-1', snapshot, change: { skillName: 'Reviewed Skill', action: 'publish' } }))
      .toEqual({ skillName: 'Reviewed Skill', action: 'publish' });
  });

  it.each([
    { skillName: 'Different Skill', action: 'publish' },
    { skillName: 'Reviewed Skill', action: 'publish', fakeVariant: true },
    { skillName: 'Reviewed Skill', action: 'archive' },
    { skillName: ' Reviewed Skill', action: 'publish' },
  ])('rejects unreviewed or padded action data: %j', change => {
    expect(() => deriveSingletonPublicationAction({ kind: 'publish-skill-to-org',
      targetRef: 'skill:skill-1', snapshot, change })).toThrow();
  });

  it('does not grant a singleton exception to open-ended proposal kinds', () => {
    expect(deriveSingletonPublicationAction({ kind: 'refine-config', targetRef: 'agent_config:one',
      snapshot, change: { skillName: 'Reviewed Skill', action: 'publish' } })).toBeNull();
  });
});
