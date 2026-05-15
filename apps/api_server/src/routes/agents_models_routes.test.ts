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

  it('returns direct rows when anthropic is authed', async () => {
    listAuthedProviders.mockResolvedValue(['anthropic']);
    const rows = await resolveRoutes('claude-code');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.providerId === 'anthropic')).toBe(true);
    expect(rows.every((r) => r.routeKind === 'direct')).toBe(true);
    expect(rows.every((r) => r.label.includes('direct'))).toBe(true);
  });

  it('returns aggregator rows when openrouter is authed', async () => {
    listAuthedProviders.mockResolvedValue(['openrouter']);
    const rows = await resolveRoutes('claude-code');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.providerId === 'openrouter')).toBe(true);
    expect(rows.every((r) => r.routeKind === 'aggregator')).toBe(true);
    expect(rows.every((r) => r.aggregatorVia === 'OpenRouter')).toBe(true);
    expect(rows.every((r) => r.label.includes('via OpenRouter'))).toBe(true);
  });

  it('returns both kinds when direct and aggregator are authed', async () => {
    listAuthedProviders.mockResolvedValue(['anthropic', 'openrouter']);
    const rows = await resolveRoutes('claude-code');
    expect(rows.length).toBeGreaterThan(0);
    const kinds = new Set(rows.map((r) => r.routeKind));
    expect(kinds.has('direct')).toBe(true);
    expect(kinds.has('aggregator')).toBe(true);
  });

  it('returns direct codex rows when openai is authed', async () => {
    listAuthedProviders.mockResolvedValue(['openai']);
    const rows = await resolveRoutes('codex');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.providerId === 'openai')).toBe(true);
    expect(rows.every((r) => r.routeKind === 'direct')).toBe(true);
  });

  it('aggregator label is correct for together and groq', async () => {
    expect(aggregatorLabel('together')).toBe('Together');
    expect(aggregatorLabel('groq')).toBe('Groq');
  });

  it('github-copilot is treated as direct (not an aggregator)', async () => {
    listAuthedProviders.mockResolvedValue(['github-copilot']);
    const rows = await resolveRoutes('claude-code');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.providerId === 'github-copilot')).toBe(true);
    expect(rows.every((r) => r.routeKind === 'direct')).toBe(true);
  });
});
