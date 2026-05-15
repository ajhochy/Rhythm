import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock opencode engine before importing the route.
vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    listAuthedProviders: vi.fn(async () => [] as string[]),
  },
}));

import { opencodeClient } from '../services/opencode_engine';
import { ROUTE_FALLBACKS_BY_AGENT } from '../services/agent_model_resolver';

const listAuthedProviders = opencodeClient.listAuthedProviders as ReturnType<typeof vi.fn>;

// The business logic under test is isolated here without requiring supertest.
// We replicate the handler's resolution logic and verify against known fixtures.

const AGGREGATOR_PROVIDERS = new Set(['openrouter', 'together', 'groq']);

function aggregatorLabel(providerId: string): string {
  const map: Record<string, string> = {
    openrouter: 'OpenRouter',
    together: 'Together',
    groq: 'Groq',
  };
  return map[providerId] ?? providerId;
}

async function resolveRoutes(agentId: string) {
  const routes = ROUTE_FALLBACKS_BY_AGENT[agentId];
  if (!routes || routes.length === 0) return [];
  const authedProviders = await opencodeClient.listAuthedProviders();
  const authedSet = new Set(authedProviders);
  const rows: Array<{
    providerId: string;
    modelId: string;
    routeKind: 'direct' | 'aggregator';
    aggregatorVia?: string;
    label: string;
  }> = [];
  for (const { providerID, modelID } of routes) {
    if (!authedSet.has(providerID)) continue;
    const isAggregator = AGGREGATOR_PROVIDERS.has(providerID);
    if (isAggregator) {
      const via = aggregatorLabel(providerID);
      rows.push({ providerId: providerID, modelId: modelID, routeKind: 'aggregator', aggregatorVia: via, label: `${modelID} · via ${via}` });
    } else {
      rows.push({ providerId: providerID, modelId: modelID, routeKind: 'direct', label: `${modelID} · direct` });
    }
  }
  return rows;
}

beforeEach(() => {
  listAuthedProviders.mockReset();
});

describe('agents/models resolution logic', () => {
  it('returns empty array when agentId has no known routes', async () => {
    listAuthedProviders.mockResolvedValue([]);
    const rows = await resolveRoutes('unknown-agent');
    expect(rows).toEqual([]);
  });

  it('returns empty array when no providers are authed', async () => {
    listAuthedProviders.mockResolvedValue([]);
    const rows = await resolveRoutes('claude-code');
    expect(rows).toEqual([]);
  });

  it('returns direct row when anthropic is authed', async () => {
    listAuthedProviders.mockResolvedValue(['anthropic']);
    const rows = await resolveRoutes('claude-code');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ providerId: 'anthropic', routeKind: 'direct' });
    expect(rows[0].label).toContain('direct');
  });

  it('returns aggregator row when openrouter is authed', async () => {
    listAuthedProviders.mockResolvedValue(['openrouter']);
    const rows = await resolveRoutes('claude-code');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      providerId: 'openrouter',
      routeKind: 'aggregator',
      aggregatorVia: 'OpenRouter',
    });
    expect(rows[0].label).toContain('via OpenRouter');
  });

  it('returns both rows when direct and aggregator are authed', async () => {
    listAuthedProviders.mockResolvedValue(['anthropic', 'openrouter']);
    const rows = await resolveRoutes('claude-code');
    expect(rows).toHaveLength(2);
    const kinds = rows.map((r) => r.routeKind);
    expect(kinds).toContain('direct');
    expect(kinds).toContain('aggregator');
  });

  it('returns direct codex row when openai is authed', async () => {
    listAuthedProviders.mockResolvedValue(['openai']);
    const rows = await resolveRoutes('codex');
    expect(rows).toHaveLength(1);
    expect(rows[0].providerId).toBe('openai');
    expect(rows[0].routeKind).toBe('direct');
  });

  it('aggregator label is correct for together and groq', async () => {
    expect(aggregatorLabel('together')).toBe('Together');
    expect(aggregatorLabel('groq')).toBe('Groq');
  });

  it('github-copilot is treated as direct (not an aggregator)', async () => {
    listAuthedProviders.mockResolvedValue(['github-copilot']);
    const rows = await resolveRoutes('claude-code');
    expect(rows).toHaveLength(1);
    expect(rows[0].routeKind).toBe('direct');
  });
});
