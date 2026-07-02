import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listAuthedProviders } = vi.hoisted(() => ({
  listAuthedProviders: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: { listAuthedProviders },
}));

import {
  PROVIDER_TO_AGENT_KIND,
  ROUTE_FALLBACKS_BY_AGENT,
  listAllRoutes,
  resolveModelForAgent,
} from '../services/agent_model_resolver';

describe('local Ollama provider contract', () => {
  beforeEach(() => listAuthedProviders.mockReset());

  it('maps ollama to the generic opencode agent', () => {
    expect(PROVIDER_TO_AGENT_KIND.ollama).toBe('opencode');
  });

  it('keeps the cloud fallback first and still exposes qwen3.6-work', () => {
    expect(ROUTE_FALLBACKS_BY_AGENT.opencode[0]).toMatchObject({
      providerID: 'openrouter',
    });
    expect(ROUTE_FALLBACKS_BY_AGENT.opencode).toContainEqual({
      providerID: 'ollama',
      modelID: 'qwen3.6-work',
      variantLabel: 'Local',
    });
    expect(
      ROUTE_FALLBACKS_BY_AGENT.opencode.some(
        (route) => route.providerID === 'openrouter',
      ),
    ).toBe(true);
  });

  it('keeps the cloud fallback when both providers are connected', async () => {
    listAuthedProviders.mockResolvedValue(['ollama', 'openrouter']);
    await expect(resolveModelForAgent('opencode')).resolves.toMatchObject({
      providerID: 'openrouter',
    });
  });

  it('selects local Qwen when it is the only connected route', async () => {
    listAuthedProviders.mockResolvedValue(['ollama']);
    await expect(resolveModelForAgent('opencode')).resolves.toMatchObject({
      providerID: 'ollama',
      modelID: 'qwen3.6-work',
    });
  });

  it('exposes local Qwen as an authorized direct catalog entry', async () => {
    const entries = await listAllRoutes(new Set(['ollama']));
    expect(entries).toContainEqual(
      expect.objectContaining({
        agent: 'opencode',
        providerID: 'ollama',
        modelID: 'qwen3.6-work',
        route: 'direct',
        authorized: true,
        authProvider: 'ollama',
      }),
    );
  });
});
