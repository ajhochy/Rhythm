import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { env } from '../config/env';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { opencodeClient } from '../services/opencode_engine';
import { PROVIDER_TO_AGENT_KIND } from '../services/agent_model_resolver';

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
 *   - Custom agent configs without a known mapping are available when the
 *     engine is ready AND their resolved engine name (ocAgent, falling back
 *     to id) is a live opencode agent (#858) — see the liveAgentNames /
 *     resolvedEngineName logic below.
 */
async function probeConfigs(): Promise<Record<string, boolean>> {
  const repo = new AgentConfigsRepository();
  const configs = repo.listEnabled();
  const providers = await opencodeClient.listAuthedProviders();
  const providerSet = new Set(providers);

  // Map agent config IDs to the direct upstream provider IDs they require.
  // Any AGGREGATOR_PROVIDERS counts toward all three CLI agents.
  const agentToProvider: Record<string, string[]> = {
    'claude-code': ['anthropic', ...AGGREGATOR_PROVIDERS],
    'codex': ['openai', ...AGGREGATOR_PROVIDERS],
    'gemini-cli': ['google', ...AGGREGATOR_PROVIDERS],
  };

  // #858 — fetch the engine's live agent names ONCE so "custom agent config"
  // rows (no known provider mapping — typically UUID-keyed imported/designer
  // profiles) can be checked against what the engine can ACTUALLY prompt,
  // not just "is the engine up". A profile whose resolved engine name
  // (ocAgent, falling back to id) isn't in this set would 400/"Agent not
  // found" the moment a user tried to chat with it — reporting it available
  // is misleading.
  //
  // Fail-open: when listAgents() is unavailable/throws (engine not ready,
  // older engine build, or simply not mocked in a test double), liveAgentNames
  // stays null and every custom config falls back to the pre-#858 behavior
  // (available iff the engine is ready) — a transient/missing engine-agents
  // probe must never mass-report every custom agent as broken.
  let liveAgentNames: Set<string> | null = null;
  if (opencodeClient.isReady) {
    try {
      const agents = await opencodeClient.listAgents();
      liveAgentNames = new Set(agents.map((a) => a.name).filter((n): n is string => Boolean(n)));
    } catch (err) {
      console.warn('[agents/capabilities] #858 listAgents failed (fail-open):', err);
    }
  }

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
      continue;
    }

    // Custom agent config — available if the engine is ready AND (when we
    // have a live agent list to check against) its resolved engine name is
    // actually registered. resolvedEngineName mirrors the same
    // ocAgent-falls-back-to-id resolution used at session-create (#858).
    const resolvedEngineName =
      config.ocAgent && config.ocAgent.trim() !== '' ? config.ocAgent : config.id;
    results[config.id] =
      opencodeClient.isReady && (liveAgentNames === null || liveAgentNames.has(resolvedEngineName));
  }

  return results;
}

agentsCapabilitiesRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const capabilities = await probeConfigs();
    res.json({
      ...capabilities,
      providerToAgentKind: PROVIDER_TO_AGENT_KIND,
    });
  } catch (err) {
    console.error('[agents/capabilities] Unexpected error:', err);
    res.json({});
  }
});

agentsCapabilitiesRouter.post('/refresh', async (_req: Request, res: Response) => {
  try {
    const capabilities = await probeConfigs();
    res.json({
      ...capabilities,
      providerToAgentKind: PROVIDER_TO_AGENT_KIND,
    });
  } catch (err) {
    console.error('[agents/capabilities] Unexpected error during refresh:', err);
    res.json({});
  }
});
