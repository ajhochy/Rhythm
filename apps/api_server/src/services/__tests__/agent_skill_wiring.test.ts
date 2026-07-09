/**
 * Contract test for issue #958 — agent→workflow-skill wiring lint.
 *
 * Reproduces the concrete AI-Trend-Researcher mismatch (body references a skill
 * that is neither in the allowlist nor an enabled skill of that name) and pins
 * the canonical-wiring rule the fix enforces.
 */
import { describe, it, expect } from 'vitest';
import {
  extractReferencedSkillNames,
  detectAgentSkillWiringMismatches,
  type AgentWiringInput,
} from '../agent_skill_wiring';

// The real AI-Trend-Researcher body from ~/.config/opencode/agents/ (abridged
// to the load-bearing sentence).
const AI_TREND_BODY = `You are AJ's AI Trend Researcher.
1. **Daily trend scan** — load and follow the \`AI-Trend-Researcher\` skill for the full sources/output/rules workflow.
Use the \`obsidian-cli\` / \`obsidian-markdown\` skills for vault writes.`;

describe('extractReferencedSkillNames', () => {
  it('pulls the single "`name` skill" reference and the "`a` / `b` skills" chain', () => {
    expect(extractReferencedSkillNames(AI_TREND_BODY)).toEqual([
      'AI-Trend-Researcher',
      'obsidian-cli',
      'obsidian-markdown',
    ]);
  });

  it('matches namespaced skill names and "Load the `x` skill first"', () => {
    const body = 'Load the `coding-agent` skill first, then the `patristic-bible-study:study-passage` skill.';
    expect(extractReferencedSkillNames(body)).toEqual([
      'coding-agent',
      'patristic-bible-study:study-passage',
    ]);
  });

  it('ignores back-tick tokens that are not a skill reference (paths, tool names)', () => {
    const body = 'Write to `Research/AI Trends/YYYY-MM-DD.md` using the `agent-reach` skill.';
    expect(extractReferencedSkillNames(body)).toEqual(['agent-reach']);
  });

  it('returns [] for a null / skill-free body', () => {
    expect(extractReferencedSkillNames(null)).toEqual([]);
    expect(extractReferencedSkillNames('Just do the thing, no skills mentioned by name.')).toEqual(
      // "skills" alone with no preceding back-tick token is not a reference.
      [],
    );
  });
});

describe('detectAgentSkillWiringMismatches — the #958 failure', () => {
  const aiTrend: AgentWiringInput = {
    id: 'AI-Trend-Researcher',
    label: 'AI Trend Researcher',
    systemPrompt: AI_TREND_BODY,
    // The real allowlist: does NOT contain "AI-Trend-Researcher".
    allowedSkills: ['research-synthesis', 'obsidian-markdown', 'obsidian-cli', 'obsidian-bases', 'agent-reach'],
  };

  it('flags the body reference that is neither in the allowlist nor an enabled skill', () => {
    // Live skills: the real workflow is titled differently + disabled, so
    // "AI-Trend-Researcher" is NOT a live name. obsidian-cli/-markdown ARE.
    const live = new Set(['research-synthesis', 'obsidian-cli', 'obsidian-markdown', 'obsidian-bases', 'agent-reach']);
    const mismatches = detectAgentSkillWiringMismatches([aiTrend], live);

    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toMatchObject({
      agentId: 'AI-Trend-Researcher',
      skillName: 'AI-Trend-Researcher',
    });
    // Both failure modes hold: not scoped AND not enabled.
    expect(mismatches[0].reasons.sort()).toEqual(['not-enabled', 'not-in-allowlist']);
  });

  it('a correctly-wired agent (body ⊆ allowlist ⊆ live) produces no mismatch', () => {
    const wired: AgentWiringInput = {
      id: 'good',
      label: 'Good',
      systemPrompt: 'Load the `coding-agent` skill first.',
      allowedSkills: ['coding-agent', 'acceptance-contract'],
    };
    const live = new Set(['coding-agent', 'acceptance-contract']);
    expect(detectAgentSkillWiringMismatches([wired], live)).toEqual([]);
  });

  it('null allowlist (unrestricted) is not a scope mismatch, but not-enabled still fires', () => {
    const openAgent: AgentWiringInput = {
      id: 'open',
      systemPrompt: 'Use the `ghost-skill` skill.',
      allowedSkills: null,
    };
    const live = new Set(['coding-agent']);
    const mismatches = detectAgentSkillWiringMismatches([openAgent], live);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].reasons).toEqual(['not-enabled']);
  });

  it('empty live set (engine down) skips the enabled check but still catches allowlist gaps', () => {
    const mismatches = detectAgentSkillWiringMismatches([aiTrend], new Set());
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].reasons).toEqual(['not-in-allowlist']);
  });
});
