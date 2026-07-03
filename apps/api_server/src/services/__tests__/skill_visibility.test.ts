/**
 * skill_visibility.test.ts — #875 (setup-05): conditional skill activation by
 * connected toolsets.
 *
 * `isSkillVisible` is a pure predicate over a skill's parsed frontmatter
 * (`requiresToolsets` / `fallbackForToolsets`, from skill_frontmatter.ts) and
 * a `SessionToolsetConfig` describing what's connected/enabled for the
 * current session. It is an ADDITIONAL gate — composed with (never replacing)
 * the existing `allowed_skills_json` allowlist enforced elsewhere
 * (agent_profile_scope.ts -> ws_gateway/agent_runner -> updateSessionSkillAllowlist).
 */
import { describe, it, expect } from 'vitest';
import { isSkillVisible, type SessionToolsetConfig } from '../skill_visibility';
import type { SkillFrontmatter } from '../skill_frontmatter';

function fm(overrides: Partial<SkillFrontmatter> = {}): SkillFrontmatter {
  return {
    requiredEnv: [],
    requiresToolsets: [],
    fallbackForToolsets: [],
    pythonDependencies: [],
    ...overrides,
  };
}

describe('isSkillVisible (#875)', () => {
  it('a skill with neither field is always visible regardless of toolset config', () => {
    const config: SessionToolsetConfig = { toolsets: new Set() };
    expect(isSkillVisible(fm(), config)).toBe(true);
  });

  // ── requires_toolsets ──────────────────────────────────────────────────────

  it('requires_toolsets: [terminal] is hidden when terminal is disabled', () => {
    const config: SessionToolsetConfig = { toolsets: new Set() };
    expect(isSkillVisible(fm({ requiresToolsets: ['terminal'] }), config)).toBe(false);
  });

  it('requires_toolsets: [terminal] is visible when terminal is enabled', () => {
    const config: SessionToolsetConfig = { toolsets: new Set(['terminal']) };
    expect(isSkillVisible(fm({ requiresToolsets: ['terminal'] }), config)).toBe(true);
  });

  it('requires_toolsets with multiple entries needs ALL of them connected', () => {
    const partial: SessionToolsetConfig = { toolsets: new Set(['terminal']) };
    const full: SessionToolsetConfig = { toolsets: new Set(['terminal', 'browser']) };
    const skill = fm({ requiresToolsets: ['terminal', 'browser'] });
    expect(isSkillVisible(skill, partial)).toBe(false);
    expect(isSkillVisible(skill, full)).toBe(true);
  });

  it('requires_toolsets with a named MCP id checks the connected MCP set', () => {
    const withServer: SessionToolsetConfig = { toolsets: new Set(['ableton-mcp']) };
    const withoutServer: SessionToolsetConfig = { toolsets: new Set() };
    const skill = fm({ requiresToolsets: ['ableton-mcp'] });
    expect(isSkillVisible(skill, withServer)).toBe(true);
    expect(isSkillVisible(skill, withoutServer)).toBe(false);
  });

  // ── fallback_for_toolsets ──────────────────────────────────────────────────

  it('fallback_for_toolsets: [web] is hidden when web IS connected', () => {
    const config: SessionToolsetConfig = { toolsets: new Set(['web']) };
    expect(isSkillVisible(fm({ fallbackForToolsets: ['web'] }), config)).toBe(false);
  });

  it('fallback_for_toolsets: [web] is visible when web is NOT connected', () => {
    const config: SessionToolsetConfig = { toolsets: new Set() };
    expect(isSkillVisible(fm({ fallbackForToolsets: ['web'] }), config)).toBe(true);
  });

  it('fallback_for_toolsets is hidden if ANY listed toolset is connected', () => {
    const oneConnected: SessionToolsetConfig = { toolsets: new Set(['web']) };
    const noneConnected: SessionToolsetConfig = { toolsets: new Set() };
    const skill = fm({ fallbackForToolsets: ['web', 'browser'] });
    expect(isSkillVisible(skill, oneConnected)).toBe(false);
    expect(isSkillVisible(skill, noneConnected)).toBe(true);
  });

  // ── both fields together ───────────────────────────────────────────────────

  it('both fields together: visible only when requires_toolsets passes AND fallback_for_toolsets passes', () => {
    const skill = fm({ requiresToolsets: ['terminal'], fallbackForToolsets: ['web'] });

    // requires passes (terminal on), fallback fails (web on) → hidden
    expect(isSkillVisible(skill, { toolsets: new Set(['terminal', 'web']) })).toBe(false);
    // requires fails (terminal off) → hidden regardless of fallback
    expect(isSkillVisible(skill, { toolsets: new Set() })).toBe(false);
    // requires passes (terminal on), fallback passes (web off) → visible
    expect(isSkillVisible(skill, { toolsets: new Set(['terminal']) })).toBe(true);
  });

  // ── the "any MCP connected" bucket ────────────────────────────────────────

  it('requires_toolsets: [mcp] is visible only when at least one MCP server is connected', () => {
    const skill = fm({ requiresToolsets: ['mcp'] });
    expect(isSkillVisible(skill, { toolsets: new Set() })).toBe(false);
    expect(isSkillVisible(skill, { toolsets: new Set(['mcp']) })).toBe(true);
  });
});
