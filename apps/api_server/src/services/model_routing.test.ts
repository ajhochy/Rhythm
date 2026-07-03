/**
 * Integration-flavored tests for the #844 tiered routing policy
 * (resolveTieredModel) — the end-to-end pick across ROUTE_FALLBACKS_BY_AGENT
 * with a mocked auth set and a mocked usage-budget snapshot. Complements
 * src/__tests__/issue_844_contract.test.ts (the AC-mapped contract suite) and
 * agent_model_resolver.test.ts (pure classify/tier-policy unit tests) with
 * routing-selection scenarios across multiple agents/providers.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

const { listAuthedProviders, getUsageBudget } = vi.hoisted(() => ({
  listAuthedProviders: vi.fn(),
  getUsageBudget: vi.fn(),
}));

vi.mock('./opencode_engine', () => ({
  opencodeClient: { listAuthedProviders },
}));

vi.mock('./usage_budget_service', () => ({
  getUsageBudget,
}));

import { resolveTieredModel } from './agent_model_resolver';

function healthySnapshot() {
  return {
    fetchedAt: new Date().toISOString(),
    providers: [
      { provider: 'anthropic', label: 'Anthropic', kind: 'window' as const, items: [{ label: '5h', remainingFraction: 0.8 }] },
      { provider: 'openai', label: 'OpenAI', kind: 'unavailable' as const, items: [] },
    ],
  };
}

describe('resolveTieredModel — cross-agent routing selection', () => {
  beforeEach(() => {
    listAuthedProviders.mockReset();
    getUsageBudget.mockReset();
    getUsageBudget.mockResolvedValue(healthySnapshot());
  });

  it('picks a cheap-tier authed route for the codex agent on a triage task', async () => {
    listAuthedProviders.mockResolvedValue(['openai']);
    const decision = await resolveTieredModel({ agentId: 'codex', taskKind: 'triage' });
    expect(decision.route.providerID).toBe('openai');
    expect(decision.tier).toBe('cheap');
    expect(decision.route.modelID).toMatch(/mini/);
  });

  it('picks a frontier-tier authed route for claude-code on a planning task', async () => {
    listAuthedProviders.mockResolvedValue(['anthropic']);
    const decision = await resolveTieredModel({ agentId: 'claude-code', taskKind: 'planning' });
    expect(decision.route.providerID).toBe('anthropic');
    expect(decision.tier).toBe('frontier');
    expect(decision.route.modelID).toMatch(/opus/);
  });

  it('falls back to the first route at the target tier when no route is authed', async () => {
    listAuthedProviders.mockResolvedValue([]); // nothing authed
    const decision = await resolveTieredModel({ agentId: 'claude-code', taskKind: 'triage' });
    expect(decision.tier).toBe('cheap');
    // Still returns SOME concrete route rather than throwing/hanging.
    expect(decision.route.providerID).toEqual(expect.any(String));
    expect(decision.route.modelID).toEqual(expect.any(String));
  });

  it('an unrecognized agentId with no configured routes throws rather than silently hanging', async () => {
    listAuthedProviders.mockResolvedValue([]);
    await expect(
      resolveTieredModel({ agentId: 'not-a-real-agent', taskKind: 'triage' }),
    ).rejects.toThrow(/no routes configured/);
  });
});
