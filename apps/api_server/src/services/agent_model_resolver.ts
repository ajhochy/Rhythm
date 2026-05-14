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
    { providerID: 'anthropic', modelID: 'claude-sonnet-4-6' },
    { providerID: 'github-copilot', modelID: 'claude-haiku-4.5' },
    { providerID: 'openrouter', modelID: 'anthropic/claude-sonnet-4.6' },
  ],
  codex: [
    { providerID: 'openai', modelID: 'gpt-5.3-codex' },
    { providerID: 'github-copilot', modelID: 'gpt-5-mini' },
    { providerID: 'openrouter', modelID: 'openai/gpt-5.3-codex' },
  ],
  'gemini-cli': [
    { providerID: 'google', modelID: 'gemini-3-pro-preview' },
    {
      providerID: 'openrouter',
      modelID: 'google/gemini-3.1-pro-preview-customtools',
    },
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
