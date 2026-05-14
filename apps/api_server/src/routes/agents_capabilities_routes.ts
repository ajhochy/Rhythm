import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { env } from '../config/env';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { opencodeClient } from '../services/opencode_engine';

export const agentsCapabilitiesRouter = Router();

if (!env.agentLocal) agentsCapabilitiesRouter.use(requireAuth);

/**
 * Aggregator providers that route to multiple upstream model families.
 * Connecting one of these enables every agent whose upstream they cover.
 * Keep this list narrow — only include aggregators we've verified expose
 * the relevant model family.
 */
const AGGREGATOR_PROVIDERS = ['openrouter', 'together', 'groq'];

/**
 * Build a capabilities map from the Opencode SDK's connected providers.
 *
 * Mapping:
 *   - `claude-code` is available when `anthropic` (direct) OR any aggregator
 *     that fronts Claude (e.g. OpenRouter) is connected.
 *   - `codex` is available when `openai` (direct) OR an aggregator is connected.
 *   - `gemini-cli` is available when `google` (direct) OR an aggregator is connected.
 *   - `opencode` is available when the SDK client is ready
 *   - Custom agent configs without a known mapping fall back to SDK readiness
 */
async function probeConfigs(): Promise<Record<string, boolean>> {
  const repo = new AgentConfigsRepository();
  const configs = repo.listEnabled();
  const providers = await opencodeClient.listProviders();
  const providerSet = new Set(providers);

  // Map agent config IDs to the direct upstream provider IDs they require.
  // Any AGGREGATOR_PROVIDERS counts toward all three CLI agents.
  const agentToProvider: Record<string, string[]> = {
    'claude-code': ['anthropic', ...AGGREGATOR_PROVIDERS],
    'codex': ['openai', ...AGGREGATOR_PROVIDERS],
    'gemini-cli': ['google', ...AGGREGATOR_PROVIDERS],
  };

  const results: Record<string, boolean> = {};

  for (const config of configs) {
    if (config.id === 'opencode') {
      // opencode is always available when the engine is ready
      results[config.id] = opencodeClient.isReady;
      continue;
    }

    const requiredProviders = agentToProvider[config.id];
    if (requiredProviders) {
      // Known agent — available if any of its required providers are connected
      results[config.id] = requiredProviders.some((p) => providerSet.has(p));
    } else {
      // Custom agent config — available if the engine is ready
      results[config.id] = opencodeClient.isReady;
    }
  }

  return results;
}

agentsCapabilitiesRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const capabilities = await probeConfigs();
    res.json(capabilities);
  } catch (err) {
    console.error('[agents/capabilities] Unexpected error:', err);
    res.json({});
  }
});

agentsCapabilitiesRouter.post('/refresh', async (_req: Request, res: Response) => {
  try {
    const capabilities = await probeConfigs();
    res.json(capabilities);
  } catch (err) {
    console.error('[agents/capabilities] Unexpected error during refresh:', err);
    res.json({});
  }
});
