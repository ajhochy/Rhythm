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

/**
 * #868 — oMLX must be a fully OPTIONAL, never-default route: it should only
 * ever be picked when it is the ONLY authed provider for the generic
 * 'opencode' agent kind (i.e. cloud is unauthed AND Ollama is unauthed too).
 * These tests mirror the existing local_ollama_provider.test.ts contract.
 */
describe('local oMLX provider route contract (#868)', () => {
  beforeEach(() => listAuthedProviders.mockReset());

  it('maps omlx to the generic opencode agent kind', () => {
    expect(PROVIDER_TO_AGENT_KIND.omlx).toBe('opencode');
  });

  it('is listed LAST, after both the cloud route and the existing Ollama fallback', () => {
    const routes = ROUTE_FALLBACKS_BY_AGENT.opencode;
    const omlxIndex = routes.findIndex((r) => r.providerID === 'omlx');
    const ollamaIndex = routes.findIndex((r) => r.providerID === 'ollama');
    const cloudIndex = routes.findIndex((r) => r.providerID === 'openrouter');
    expect(omlxIndex).toBeGreaterThan(-1);
    expect(omlxIndex).toBeGreaterThan(ollamaIndex);
    expect(omlxIndex).toBeGreaterThan(cloudIndex);
  });

  it('is never picked when the cloud route is authed', async () => {
    listAuthedProviders.mockResolvedValue(['omlx', 'openrouter']);
    await expect(resolveModelForAgent('opencode')).resolves.toMatchObject({
      providerID: 'openrouter',
    });
  });

  it('is never picked when Ollama is authed, even if omlx also is', async () => {
    listAuthedProviders.mockResolvedValue(['omlx', 'ollama']);
    await expect(resolveModelForAgent('opencode')).resolves.toMatchObject({
      providerID: 'ollama',
    });
  });

  it('is selected only when it is the sole authed route for this agent kind', async () => {
    listAuthedProviders.mockResolvedValue(['omlx']);
    await expect(resolveModelForAgent('opencode')).resolves.toMatchObject({
      providerID: 'omlx',
      modelID: 'gpt-oss-20b-MXFP4-Q8',
    });
  });

  it('exposes omlx as a direct (non-aggregator) catalog entry when authed', async () => {
    const entries = await listAllRoutes(new Set(['omlx']));
    expect(entries).toContainEqual(
      expect.objectContaining({
        agent: 'opencode',
        providerID: 'omlx',
        route: 'direct',
        authorized: true,
        authProvider: 'omlx',
      }),
    );
  });

  it('reports unauthorized (never force-authed) when omlx is not in the authed set', async () => {
    const entries = await listAllRoutes(new Set(['openrouter']));
    const omlxEntry = entries.find((e) => e.providerID === 'omlx');
    expect(omlxEntry?.authorized).toBe(false);
  });
});
