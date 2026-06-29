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

  it('puts qwen3.6-work before the cloud fallback', () => {
    expect(ROUTE_FALLBACKS_BY_AGENT.opencode[0]).toEqual({
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

  it('selects local Qwen when ollama is connected', async () => {
    listAuthedProviders.mockResolvedValue(['ollama', 'openrouter']);
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
