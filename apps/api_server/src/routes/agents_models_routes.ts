import { Router, Request, Response } from 'express';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { requireAuth } from '../middleware/auth_middleware';
import { env } from '../config/env';
import { opencodeClient } from '../services/opencode_engine';
import {
  PROVIDER_TO_AGENT_KIND,
  PROVIDER_CONNECT_URL,
  ROUTE_FALLBACKS_BY_AGENT,
} from '../services/agent_model_resolver';
import { getDb } from '../database/db';
import {
  eligibleModel,
  probeDeclaredModelInventory,
  providerEndpointDisposition,
  type ProbeInventory,
  visibleDirectModelIds,
} from '../services/provider_catalog_policy';
import { getUsageBudget } from '../services/usage_budget_service';

export const agentsModelsRouter = Router();

if (!env.agentLocal) agentsModelsRouter.use(requireAuth);

const AGGREGATOR_PROVIDERS = new Set(['openrouter', 'together', 'groq']);
const LOCAL_CATALOG_PROVIDERS = new Set(['ollama', 'omlx']);

type ConfiguredProvider = {
  models?: Record<string, unknown>;
  options?: {
    baseURL?: string;
    baseUrl?: string;
    apiKey?: unknown;
    [key: string]: unknown;
  };
  npm?: unknown;
};

type CatalogRow = {
  agent: string;
  provider: string;
  modelId: string;
  displayName: string;
  variantLabel?: string;
  route: 'direct' | 'aggregator';
  authorized: boolean;
  available: boolean | 'unknown';
  visible: boolean;
  availabilityReason: string;
  authProvider: string;
  connectUrl?: string;
  contextLimit?: number;
  apiId?: string;
};

function aggregatorLabel(providerId: string): string {
  return ({ openrouter: 'OpenRouter', together: 'Together', groq: 'Groq' } as Record<string, string>)[providerId] ?? providerId;
}

function loadConfiguredProviders(): Record<string, ConfiguredProvider> {
  try {
    const file = JSON.parse(
      readFileSync(join(homedir(), '.config/opencode/opencode.json'), 'utf8'),
    ) as { provider?: unknown };
    if (file.provider && typeof file.provider === 'object') {
      return file.provider as Record<string, ConfiguredProvider>;
    }
  } catch {
    // Configuration is optional while the engine starts.
  }
  return {};
}

function loadVisibilityMap(): Map<string, boolean> {
  const visibility = new Map<string, boolean>();
  try {
    const rows = getDb().prepare(
      'SELECT provider, model_id, visible FROM agent_model_visibility',
    ).all() as { provider: string; model_id: string; visible: number }[];
    for (const row of rows) {
      visibility.set(`${row.provider}\0${row.model_id}`, row.visible === 1);
    }
  } catch {
    // Table may not exist on first run.
  }
  return visibility;
}

type FallbackMetadata = {
  agents: string[];
  variantLabel?: string;
};

function fallbackMetadata(): Map<string, FallbackMetadata> {
  const metadata = new Map<string, FallbackMetadata>();
  for (const [agent, routes] of Object.entries(ROUTE_FALLBACKS_BY_AGENT ?? {})) {
    for (const route of routes) {
      const key = `${route.providerID}\0${route.modelID}`;
      const existing = metadata.get(key);
      if (existing) {
        if (!existing.agents.includes(agent)) existing.agents.push(agent);
        existing.variantLabel ??= route.variantLabel;
      } else {
        metadata.set(key, {
          agents: [agent],
          ...(route.variantLabel ? { variantLabel: route.variantLabel } : {}),
        });
      }
    }
  }
  return metadata;
}

function familyAgent(modelId: string): string {
  const family = modelId.includes('/') ? modelId.split('/')[0] : modelId;
  if (family === 'anthropic' || family.startsWith('claude-')) return 'claude-code';
  if (family === 'openai' || family.startsWith('gpt-')) return 'codex';
  if (family === 'google' || family.startsWith('gemini-')) return 'gemini-cli';
  if (family === 'ollama' || family === 'omlx') return 'opencode';
  return modelId.includes('/') ? 'claude-code' : 'opencode';
}

function rowAgents(
  providerId: string,
  modelId: string,
  customEndpoint: boolean,
  metadata: Map<string, FallbackMetadata>,
): FallbackMetadata {
  const fallback = metadata.get(`${providerId}\0${modelId}`);
  if (fallback) return fallback;
  if (providerId === 'openrouter' || providerId === 'github-copilot') {
    return { agents: [familyAgent(modelId)] };
  }
  if (customEndpoint || LOCAL_CATALOG_PROVIDERS.has(providerId) || providerId === 'opencode') {
    return { agents: ['opencode'] };
  }
  return { agents: [PROVIDER_TO_AGENT_KIND[providerId] ?? 'opencode'] };
}

function entitlementMap(value: unknown): Record<string, boolean> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.some(([, available]) => typeof available !== 'boolean')) {
    return undefined;
  }
  return Object.fromEntries(entries) as Record<string, boolean>;
}

function suppressOpenRouterDuplicates(rows: CatalogRow[]): CatalogRow[] {
  return rows.filter((row) => {
    if (row.provider !== 'openrouter' || !row.modelId.includes('/')) return true;
    const [directProvider] = row.modelId.split('/');
    return !rows.some((candidate) =>
      candidate.provider === directProvider &&
      candidate.agent === row.agent &&
      candidate.route === 'direct' &&
      candidate.authorized &&
      candidate.available !== false &&
      candidate.visible);
  });
}

function hasConfiguredApiKey(provider: ConfiguredProvider | undefined): boolean {
  const apiKey = provider?.options?.apiKey;
  return typeof apiKey === 'string' ? apiKey.trim().length > 0 : apiKey != null;
}

function providerAuthorized(
  provider: { id: string; connected: boolean; source?: string },
  configuredProvider: ConfiguredProvider | undefined,
): boolean {
  const builtIn = Object.hasOwn(PROVIDER_TO_AGENT_KIND, provider.id) ||
    AGGREGATOR_PROVIDERS.has(provider.id) ||
    provider.id === 'opencode';
  const sourceAuthorized = ['env', 'api', 'custom'].includes(provider.source ?? '');
  return provider.connected || sourceAuthorized || hasConfiguredApiKey(configuredProvider) ||
    (!builtIn && Boolean(configuredProvider));
}

/** Engine-authoritative picker catalog shared by full, compatibility and per-agent routes. */
export async function listAgentModelCatalog(): Promise<CatalogRow[]> {
  try {
    const snapshot = await opencodeClient.providerSnapshot();
    const usage = await getUsageBudget({ cachedOnly: true }).catch(() => null);
    const openAiUsage = usage?.providers.find((entry) => entry.provider === 'openai');
    const geminiUsage = usage?.providers.find((entry) => entry.provider === 'gemini');
    const visibility = loadVisibilityMap();
    const configured = loadConfiguredProviders();
    const metadata = fallbackMetadata();
    const snapshotProviderIds = new Set(snapshot.providers.map((provider) => provider.id));

    const providerAuthorization = new Map(snapshot.providers.map((provider) => [
      provider.id,
      providerAuthorized(provider, configured[provider.id]),
    ]));
    const providerRows = await Promise.all(snapshot.providers.map(async (provider) => {
      const aggregator = AGGREGATOR_PROVIDERS.has(provider.id);
      const local = LOCAL_CATALOG_PROVIDERS.has(provider.id);
      const builtIn = Object.hasOwn(PROVIDER_TO_AGENT_KIND, provider.id) ||
        aggregator || provider.id === 'opencode';
      const configuredProvider = configured[provider.id];
      const declared = configuredProvider?.models;
      const baseURL = configuredProvider?.options?.baseURL ?? configuredProvider?.options?.baseUrl;
      const customEndpoint = typeof baseURL === 'string' && baseURL.length > 0 && !local && !builtIn;
      const authorized = providerAuthorization.get(provider.id) === true;
      const providerModelIds = new Set(provider.models.map((model) => model.id));
      const rawOpenAiEntitlements = entitlementMap(openAiUsage?.entitledModels);
      const openAiEntitlements = rawOpenAiEntitlements
        ? Object.fromEntries(Object.entries(rawOpenAiEntitlements).filter(([modelId]) =>
            providerModelIds.has(modelId)))
        : undefined;
      const openAiEntitlementsKnown = provider.id === 'openai' &&
        openAiEntitlements !== undefined &&
        Object.keys(openAiEntitlements).length > 0;
      const geminiEntitledIds = new Set(
        geminiUsage?.kind !== 'unavailable'
          ? geminiUsage?.items
              .map((item) => item.label)
              .filter((modelId) => providerModelIds.has(modelId)) ?? []
          : [],
      );
      const geminiEntitlementsKnown = provider.id === 'google' && geminiEntitledIds.size > 0;
      const visibleDirectIds = visibleDirectModelIds(provider.id, provider.models, {
        geminiEntitlementsKnown,
      });

      let endpointDisposition: ReturnType<typeof providerEndpointDisposition> | undefined;
      let inventory: ProbeInventory = { status: 'unverified', models: new Set<string>() };
      if (customEndpoint && declared) {
        const trustedEndpoint = provider.endpoint ?? baseURL;
        endpointDisposition = providerEndpointDisposition(baseURL, trustedEndpoint);
        if (endpointDisposition === 'local') {
          const inventoryIds = new Set(Object.keys(declared));
          for (const model of provider.models) {
            if (Object.hasOwn(declared, model.id) && model.apiId) inventoryIds.add(model.apiId);
          }
          inventory = await probeDeclaredModelInventory(baseURL, trustedEndpoint, inventoryIds);
        }
      }

      const rows: CatalogRow[] = [];
      for (const model of provider.models) {
        const key = `${provider.id}\0${model.id}`;
        const configuredModel = Boolean(declared && Object.hasOwn(declared, model.id));
        if ((customEndpoint || local) && !configuredModel) continue;

        const fallbackVisible = metadata.has(key);
        let policyVisible: boolean;
        if (aggregator) {
          policyVisible = visibility.get(key) ?? fallbackVisible;
        } else if (customEndpoint || local) {
          policyVisible = configuredModel;
        } else if (Object.hasOwn(PROVIDER_TO_AGENT_KIND, provider.id)) {
          policyVisible = visibleDirectIds.has(model.id);
        } else {
          // Zen, env-authenticated providers and models.dev providers remain
          // engine-managed rather than being mistaken for custom endpoints.
          policyVisible = true;
        }
        const visible = policyVisible && visibility.get(key) !== false;
        const eligible = eligibleModel(model);
        const inventoryVerified = inventory.models.has(model.id) ||
          Boolean(model.apiId && inventory.models.has(model.apiId));

        let available: boolean | 'unknown' = false;
        let availabilityReason = !visible
          ? 'hidden'
          : !authorized
            ? 'not_connected'
            : !eligible
              ? 'missing_capability'
              : 'available';
        if (visible && authorized && eligible) {
          if (customEndpoint) {
            if (endpointDisposition === 'invalid') {
              available = false;
              availabilityReason = 'endpoint_invalid';
            } else if (
              endpointDisposition === 'public' ||
              endpointDisposition === 'unprobeable' ||
              inventory.status === 'unverified'
            ) {
              available = 'unknown';
              availabilityReason = 'account_entitlement_unverified';
            } else if (inventory.status === 'verified') {
              available = inventoryVerified;
              availabilityReason = inventoryVerified ? 'available' : 'model_not_listed';
            } else {
              available = false;
              availabilityReason = 'endpoint_unverified';
            }
          } else if (aggregator || local || provider.id === 'opencode') {
            available = true;
          } else if (provider.id === 'openai' && openAiEntitlementsKnown) {
            available = Object.hasOwn(openAiEntitlements, model.id)
              ? openAiEntitlements[model.id]
              : 'unknown';
            availabilityReason = available === true
              ? 'available'
              : available === false
                ? 'account_not_entitled'
                : 'account_entitlement_unverified';
          } else if (provider.id === 'google' && geminiEntitlementsKnown) {
            available = geminiEntitledIds.has(model.id);
            availabilityReason = available ? 'available' : 'account_not_entitled';
          } else {
            available = 'unknown';
            availabilityReason = 'account_entitlement_unverified';
          }
        }

        const rowMetadata = rowAgents(provider.id, model.id, customEndpoint, metadata);
        const variantLabel = rowMetadata.variantLabel ??
          (model.id.endsWith('-1m') ? '1M context' : undefined);
        for (const agent of rowMetadata.agents) {
          rows.push({
            agent,
            provider: provider.id,
            modelId: model.id,
            displayName: model.name ?? model.id,
            ...(variantLabel ? { variantLabel } : {}),
            route: aggregator ? 'aggregator' : 'direct',
            authorized,
            available,
            visible,
            availabilityReason,
            authProvider: provider.id,
            ...(PROVIDER_CONNECT_URL[provider.id]
              ? { connectUrl: PROVIDER_CONNECT_URL[provider.id] }
              : {}),
            ...(model.contextLimit != null ? { contextLimit: model.contextLimit } : {}),
            ...(model.apiId ? { apiId: model.apiId } : {}),
          });
        }
      }
      return rows;
    }));

    const rows = providerRows.flat();
    for (const [providerId, connectUrl] of Object.entries(PROVIDER_CONNECT_URL)) {
      if (snapshotProviderIds.has(providerId) && providerAuthorization.get(providerId) !== false) continue;
      const aggregator = AGGREGATOR_PROVIDERS.has(providerId);
      rows.push({
        agent: PROVIDER_TO_AGENT_KIND[providerId] ?? (aggregator ? 'opencode' : 'opencode'),
        provider: providerId,
        modelId: '',
        displayName: providerId,
        route: aggregator ? 'aggregator' : 'direct',
        authorized: false,
        available: false,
        visible: true,
        availabilityReason: 'not_connected',
        authProvider: providerId,
        connectUrl,
      });
    }

    return suppressOpenRouterDuplicates(rows.filter((row) => row.visible));
  } catch (err) {
    console.error('[agents/models/catalog] Unexpected error:', err);
    return [];
  }
}

agentsModelsRouter.get('/catalog', async (_req: Request, res: Response) => {
  res.json((await listAgentModelCatalog()).filter((entry) =>
    !entry.authorized || entry.available !== false));
});

agentsModelsRouter.get('/catalog/full', async (_req: Request, res: Response) => {
  res.json(await listAgentModelCatalog());
});

agentsModelsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const agentId = (req.query.agentId as string | undefined)?.trim();
    if (!agentId) {
      res.json([]);
      return;
    }
    const catalog = await listAgentModelCatalog();
    res.json(catalog.filter((entry) =>
      entry.agent === agentId &&
      entry.modelId !== '' &&
      entry.authorized &&
      entry.available !== false).map((entry) => ({
      providerId: entry.provider,
      modelId: entry.modelId,
      routeKind: entry.route,
      ...(entry.route === 'aggregator'
        ? { aggregatorVia: aggregatorLabel(entry.provider) }
        : {}),
      label: `${entry.modelId} · ${entry.route === 'aggregator'
        ? `via ${aggregatorLabel(entry.provider)}`
        : 'direct'}`,
      ...(entry.variantLabel ? { variantLabel: entry.variantLabel } : {}),
    })));
  } catch (err) {
    console.error('[agents/models] Unexpected error:', err);
    res.json([]);
  }
});
