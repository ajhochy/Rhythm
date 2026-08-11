/**
 * Regression: an expired free Zen bootstrap model must use the live keyless
 * catalog, without silently rerouting a credentialed Zen account.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { opencodeClient } from '../services/opencode_engine';
import {
  resolveModelForSessionTurn,
  setAgentConfigsRepositoryForTest,
} from '../services/agent_model_resolver';

const config = (modelId: string | null) => ({
  getById: () => ({ modelProvider: 'opencode', modelId }),
});

const keylessZen = () =>
  vi.spyOn(opencodeClient, 'isProviderInAuthStore').mockReturnValue(false);

afterEach(() => {
  setAgentConfigsRepositoryForTest(undefined);
  vi.restoreAllMocks();
});

describe('Zen keyless stale-model fallback acceptance contract', () => {
  it('uses the first available pinned model for a stale keyless Zen config', async () => {
    setAgentConfigsRepositoryForTest(config('expired-free-model') as never);
    vi.spyOn(opencodeClient, 'listAuthedProviders').mockResolvedValue(['opencode']);
    keylessZen();
    vi.spyOn(opencodeClient, 'listModels').mockResolvedValue([
      { id: 'big-pickle' }, { id: 'deepseek-v4-flash-free' },
    ]);

    await expect(resolveModelForSessionTurn({ agentId: 'rhythm-setup', sessionProviderId: null, sessionModelId: null }))
      .resolves.toEqual({ providerID: 'opencode', modelID: 'deepseek-v4-flash-free' });
  });

  it('uses the first catalog entry when no pinned keyless Zen model remains', async () => {
    setAgentConfigsRepositoryForTest(config('expired-free-model') as never);
    vi.spyOn(opencodeClient, 'listAuthedProviders').mockResolvedValue(['opencode']);
    keylessZen();
    vi.spyOn(opencodeClient, 'listModels').mockResolvedValue([{ id: 'new-free-model' }]);

    await expect(resolveModelForSessionTurn({ agentId: 'rhythm-setup', sessionProviderId: null, sessionModelId: null }))
      .resolves.toEqual({ providerID: 'opencode', modelID: 'new-free-model' });
  });

  it('preserves a valid keyless Zen config model', async () => {
    setAgentConfigsRepositoryForTest(config('big-pickle') as never);
    vi.spyOn(opencodeClient, 'listAuthedProviders').mockResolvedValue(['opencode']);
    keylessZen();
    vi.spyOn(opencodeClient, 'listModels').mockResolvedValue([{ id: 'big-pickle' }]);

    await expect(resolveModelForSessionTurn({ agentId: 'rhythm-setup', sessionProviderId: null, sessionModelId: null }))
      .resolves.toEqual({ providerID: 'opencode', modelID: 'big-pickle' });
  });

  it('does not reroute a stale credentialed Zen config', async () => {
    setAgentConfigsRepositoryForTest(config('paid-model-that-is-gone') as never);
    vi.spyOn(opencodeClient, 'listAuthedProviders').mockResolvedValue(['opencode']);
    vi.spyOn(opencodeClient, 'isProviderInAuthStore').mockReturnValue(true);
    vi.spyOn(opencodeClient, 'listModels').mockResolvedValue([{ id: 'deepseek-v4-flash-free' }]);

    await expect(resolveModelForSessionTurn({ agentId: 'rhythm-setup', sessionProviderId: null, sessionModelId: null }))
      .resolves.toEqual({ providerID: 'opencode', modelID: 'paid-model-that-is-gone' });
  });

  it('returns undefined when the keyless Zen catalog is empty', async () => {
    setAgentConfigsRepositoryForTest(config('expired-free-model') as never);
    vi.spyOn(opencodeClient, 'listAuthedProviders').mockResolvedValue(['opencode']);
    keylessZen();
    vi.spyOn(opencodeClient, 'listModels').mockResolvedValue([]);

    await expect(resolveModelForSessionTurn({ agentId: 'rhythm-setup', sessionProviderId: null, sessionModelId: null }))
      .resolves.toBeUndefined();
  });
});
