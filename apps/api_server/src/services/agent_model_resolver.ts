import { opencodeClient } from './opencode_engine';

/**
 * Ordered fallback list of {providerID, modelID} routes per agentId.
 *
 * The SDK only successfully routes to providers with a built-in loader
 * (openrouter, openai, github-copilot, opencode) plus any community plugin
 * loaders the user has installed (anthropic via opencode-claude-auth,
 * google via opencode-gemini-auth, openai-codex via
 * opencode-openai-codex-auth).
 *
 * Routes are tried in order: first entry whose providerID is in the user's
 * `listAuthedProviders()` set wins. If nothing matches, the first entry is
 * returned and the SDK will surface the error (ProviderModelNotFoundError)
 * to the UI via the stream bridge — better than silent failure.
 */
export const ROUTE_FALLBACKS_BY_AGENT: Record<
  string,
  Array<{ providerID: string; modelID: string }>
> = {
  'claude-code': [
    { providerID: 'anthropic', modelID: 'claude-opus-4-7' },
    { providerID: 'anthropic', modelID: 'claude-opus-4-5' },
    { providerID: 'anthropic', modelID: 'claude-sonnet-4-6' },
    { providerID: 'anthropic', modelID: 'claude-haiku-4-5' },
    { providerID: 'github-copilot', modelID: 'claude-opus-4-7' },
    { providerID: 'github-copilot', modelID: 'claude-sonnet-4-6' },
    { providerID: 'github-copilot', modelID: 'claude-haiku-4.5' },
    { providerID: 'openrouter', modelID: 'anthropic/claude-opus-4.7' },
    { providerID: 'openrouter', modelID: 'anthropic/claude-opus-4.5' },
    { providerID: 'openrouter', modelID: 'anthropic/claude-sonnet-4.6' },
    { providerID: 'openrouter', modelID: 'anthropic/claude-haiku-4.5' },
  ],
  codex: [
    { providerID: 'openai', modelID: 'gpt-5.3-codex' },
    { providerID: 'openai', modelID: 'gpt-5.3' },
    { providerID: 'openai', modelID: 'gpt-5-mini' },
    { providerID: 'github-copilot', modelID: 'gpt-5-mini' },
    { providerID: 'openrouter', modelID: 'openai/gpt-5.3-codex' },
    { providerID: 'openrouter', modelID: 'openai/gpt-5.3' },
  ],
  'gemini-cli': [
    { providerID: 'google', modelID: 'gemini-3-pro-preview' },
    { providerID: 'google', modelID: 'gemini-3-flash' },
    {
      providerID: 'openrouter',
      modelID: 'google/gemini-3.1-pro-preview-customtools',
    },
    { providerID: 'openrouter', modelID: 'google/gemini-3-flash' },
  ],
  // The bare "opencode" agent kind: prefer the user's opencode config
  // (left unmapped so the SDK uses its own defaults), but fall back to
  // OpenRouter so a user with only an OpenRouter key still gets a
  // working chat instead of a silently dropped prompt.
  opencode: [
    { providerID: 'openrouter', modelID: 'anthropic/claude-sonnet-4.6' },
  ],
};

/** Pick the first authed route for the given agent, or null if none authed. */
export async function resolveModelForAgent(
  agentId: string,
): Promise<{ providerID: string; modelID: string } | undefined> {
  const routes = ROUTE_FALLBACKS_BY_AGENT[agentId];
  if (!routes || routes.length === 0) return undefined;
  const authed = new Set(await opencodeClient.listAuthedProviders());
  for (const route of routes) {
    if (authed.has(route.providerID)) return route;
  }
  return routes[0];
}

/**
 * M2-2 precedence helper. Resolve the model for one turn of a session.
 *
 * Order:
 *   1. Per-turn `modelOverride` field on the WS `session.input` payload (not
 *      persisted; applies to this prompt only).
 *   2. Session row's persisted `providerId` + `modelId` from M2-1.
 *   3. `resolveModelForAgent(agentId)` fallback list.
 */
export async function resolveModelForSessionTurn(opts: {
  agentId: string;
  sessionProviderId: string | null;
  sessionModelId: string | null;
  perTurnOverride?: { providerId?: string; modelId?: string } | null;
}): Promise<{ providerID: string; modelID: string } | undefined> {
  const override = opts.perTurnOverride;
  if (override?.providerId && override.modelId) {
    return { providerID: override.providerId, modelID: override.modelId };
  }
  if (opts.sessionProviderId && opts.sessionModelId) {
    return { providerID: opts.sessionProviderId, modelID: opts.sessionModelId };
  }
  return resolveModelForAgent(opts.agentId);
}
