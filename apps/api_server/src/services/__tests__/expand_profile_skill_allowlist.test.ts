import { describe, it, expect } from 'vitest';
import { expandProfileSkillAllowlist } from '../agent_profile_scope';

// Mirrors expand_profile_mcp_allowlist.test.ts (#1012) for the skill side of
// the projection: a profile's allowed_skills_json → the fork's
// options.skillAllowlist shape ({skills:[...]}) baked into the agent .md.
describe('expandProfileSkillAllowlist', () => {
  it('returns undefined for an unscoped profile (allowedSkillsJson === null)', () => {
    expect(expandProfileSkillAllowlist(null)).toBeUndefined();
  });

  it('array of skill names → {skills:[...]}', () => {
    expect(expandProfileSkillAllowlist('["a","b"]')).toEqual({ skills: ['a', 'b'] });
  });

  it('empty array (deny-all) → {skills:[]}', () => {
    expect(expandProfileSkillAllowlist('[]')).toEqual({ skills: [] });
  });

  it('malformed JSON → fail-closed {skills:[]} (never throws, never broadens)', () => {
    expect(expandProfileSkillAllowlist('{')).toEqual({ skills: [] });
  });

  it('non-array JSON → fail-closed {skills:[]}', () => {
    expect(expandProfileSkillAllowlist('"x"')).toEqual({ skills: [] });
  });
});
