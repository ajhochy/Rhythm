import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoutableModel } from '../services/decision/model_catalog';

const { listAuthedProviders, getRoutableModels, getUsageBudget } = vi.hoisted(() => ({
  listAuthedProviders: vi.fn(),
  getRoutableModels: vi.fn(),
  getUsageBudget: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({ opencodeClient: { listAuthedProviders } }));
vi.mock('../services/usage_budget_service', () => ({ getUsageBudget }));
vi.mock('../services/decision/model_catalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/decision/model_catalog')>()),
  getRoutableModels,
}));

import { resolveSmallModel, resolveTieredModel } from '../services/agent_model_resolver';

const model = (providerID: string, modelID: string, tier: 'cheap' | 'standard' | 'frontier'): RoutableModel => ({
  providerID, modelID, tier, name: modelID, family: null, tierSource: 'heuristic',
  costInputUsd: null, costOutputUsd: null, releaseDate: null, contextLimit: null,
  reasoning: null, variants: [], keyless: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  listAuthedProviders.mockResolvedValue(['openai']);
  getUsageBudget.mockResolvedValue({ fetchedAt: new Date().toISOString(), providers: [] });
});

describe('live authenticated model eligibility at background routing boundaries', () => {
  it('does not write an authenticated but absent small_model; selects a live curated cheap model', async () => {
    getRoutableModels.mockResolvedValue({
      source: 'live', curatedCount: 2,
      models: [model('openai', 'gpt-6.1-sol', 'frontier'), model('openai', 'gpt-6-luna', 'cheap')],
    });
    expect(await resolveSmallModel()).toEqual({ providerID: 'openai', modelID: 'gpt-6-luna' });
  });

  it('omits managed small_model when the authoritative live catalog has no eligible cheap model', async () => {
    getRoutableModels.mockResolvedValue({
      source: 'live', curatedCount: 1,
      models: [model('openai', 'gpt-6.1-sol', 'frontier')],
    });
    expect(await resolveSmallModel()).toBeUndefined();
  });

  it('routes claude-code summarization to the authenticated cheap model, never unauthenticated Haiku', async () => {
    getRoutableModels.mockResolvedValue({
      source: 'live', curatedCount: 2,
      models: [model('openai', 'gpt-6-luna', 'cheap'), model('openai', 'gpt-6.1-sol', 'frontier')],
    });
    const decision = await resolveTieredModel({
      agentId: 'claude-code', taskKind: 'summarization',
      baseRoute: { providerID: 'openai', modelID: 'gpt-6.1-sol' },
    });
    expect(decision.route).toEqual({ providerID: 'openai', modelID: 'gpt-6-luna' });
    expect(decision.tier).toBe('cheap');
  });

  it('keeps a catalog-valid base route when no cheap model exists; explicit override still wins', async () => {
    getRoutableModels.mockResolvedValue({
      source: 'live', curatedCount: 1,
      models: [model('openai', 'gpt-6.1-sol', 'frontier')],
    });
    const baseRoute = { providerID: 'openai', modelID: 'gpt-6.1-sol' };
    expect((await resolveTieredModel({ agentId: 'claude-code', taskKind: 'summarization', baseRoute })).route)
      .toEqual(baseRoute);
    const forced = { providerID: 'anthropic', modelID: 'claude-opus-4-7' };
    expect((await resolveTieredModel({ agentId: 'claude-code', taskKind: 'summarization', baseRoute, modelOverride: forced })).route)
      .toEqual(forced);
  });

  it('does not fabricate an unauthenticated route when the live catalog is empty', async () => {
    getRoutableModels.mockResolvedValue({ source: 'live', curatedCount: 0, models: [] });
    await expect(resolveTieredModel({ agentId: 'claude-code', taskKind: 'summarization' }))
      .rejects.toThrow(/no eligible|no authenticated/i);
  });

  it('does not fabricate an unauthenticated static route while the engine catalog is unavailable', async () => {
    listAuthedProviders.mockResolvedValue([]);
    getRoutableModels.mockResolvedValue({ source: 'static', curatedCount: 0, models: [] });
    expect(await resolveSmallModel()).toBeUndefined();
    await expect(resolveTieredModel({ agentId: 'claude-code', taskKind: 'summarization' }))
      .rejects.toThrow(/no routes configured|no authenticated/i);
  });
});
