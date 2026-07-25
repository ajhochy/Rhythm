/**
 * Contract test for issue #854 part 2 — the eval driver pins each agent's
 * configured model from agent_configs at session-create time, independent
 * of the agent_model_resolver fix.
 *
 * See docs/ai/contracts/issue-854.json (issue-854-c7).
 *
 * NOT part of apps/api_server's vitest `include` glob (this file lives
 * outside that package) — run explicitly:
 *   cd apps/api_server && npx vitest run ../../tools/dev/__tests__/agent_eval_driver.test.ts
 */

import { describe, it, expect } from 'vitest';
import { resolveConfiguredModelPin, type ModelPin } from '../agent_eval_driver';
import type { AgentConfig } from '../../../apps/api_server/src/repositories/agent_configs_repository';

function fakeConfig(overrides: Partial<AgentConfig>): AgentConfig {
  return {
    id: 'x',
    label: 'x',
    icon: 'x',
    enabled: true,
    isAgent: true,
    isManager: false,
    systemPrompt: null,
    allowedMcpsJson: null,
    allowedSkillsJson: null,
    allowedDelegatesJson: null,
    presetId: null,
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
    modelProvider: null,
    modelId: null,
    ocAgent: null,
    sessionSelectable: true,
    modelTierHint: null,
    ...overrides,
  };
}

describe('issue-854-c7 — resolveConfiguredModelPin (eval driver session-create pin)', () => {
  it('returns the agent_configs model when both provider and model id are set', () => {
    // Regression this catches: if the driver stops reading agent_configs and
    // instead hardcodes/omits the pin, the eval would silently drift to
    // testing agents on whatever the resolver's static fallback picks,
    // rather than the agent's actually-configured model.
    const repo = {
      getById: () => fakeConfig({ id: 'secretary', modelProvider: 'anthropic', modelId: 'claude-sonnet-4-6' }),
    };

    const pin: ModelPin | null = resolveConfiguredModelPin('secretary', repo);

    expect(pin).toEqual({ providerId: 'anthropic', modelId: 'claude-sonnet-4-6' });
  });

  it('returns null when agentIdHint is null (agent-less eval cases like research/email-assistant)', () => {
    const repo = { getById: () => fakeConfig({ modelProvider: 'anthropic', modelId: 'claude-sonnet-4-6' }) };
    expect(resolveConfiguredModelPin(null, repo)).toBeNull();
  });

  it('returns null when the agent_configs row has no model preference set', () => {
    const repo = { getById: () => fakeConfig({ modelProvider: null, modelId: null }) };
    expect(resolveConfiguredModelPin('claude-code', repo)).toBeNull();
  });

  it('returns null when only one of modelProvider/modelId is set (partial config)', () => {
    const repo = { getById: () => fakeConfig({ modelProvider: 'anthropic', modelId: null }) };
    expect(resolveConfiguredModelPin('secretary', repo)).toBeNull();
  });

  it('returns null (never throws) when the repo lookup throws', () => {
    // Regression this catches: a DB error in the pin lookup must never crash
    // the eval driver run.
    const repo = {
      getById: () => {
        throw new Error('db unavailable');
      },
    };
    expect(() => resolveConfiguredModelPin('secretary', repo)).not.toThrow();
    expect(resolveConfiguredModelPin('secretary', repo)).toBeNull();
  });

  it('returns null when no agent_configs row exists for the id', () => {
    const repo = { getById: () => null };
    expect(resolveConfiguredModelPin('unknown-agent', repo)).toBeNull();
  });
});

describe('loadAllowedToolsForSlug — server-qualified names (#854 scope false-positive fix)', () => {
  it('qualifies Rhythm ingress tools and excludes the retired direct Gmail bypass', async () => {
    const { loadAllowedToolsForSlug } = await import('../agent_eval_driver');
    const allowed = loadAllowedToolsForSlug('secretary');
    expect(allowed).not.toBeNull();
    const set = new Set(allowed as string[]);
    // runtime emits these fully-qualified names; the scope gate must accept them
    expect(set.has('rhythm_rhythm_list_tasks')).toBe(true);
    expect(set.has('rhythm_rhythm_search_gmail')).toBe(true);
    expect(set.has('rhythm_rhythm_read_email')).toBe(true);
    // Secretary email reads must stay behind Rhythm's scan → taint → fence boundary.
    expect(set.has('gmail-work_search_emails')).toBe(false);
    expect(set.has('gmail-personal_search_emails')).toBe(false);
  });

  it('preserves hyphenated server names when qualifying role-file tools', async () => {
    const { loadAllowedToolsForSlug } = await import('../agent_eval_driver');
    const allowed = loadAllowedToolsForSlug('research');
    expect(allowed).not.toBeNull();
    expect(new Set(allowed as string[]).has('pdf-tools_read_pdf_content')).toBe(true);
  });
});
