import type { OpencodeClient, ProviderListResponse } from '@opencode-ai/sdk/v2/client';

import { getConfiguredProviderIds, toAgentOption, type ModelOption } from '@/providers/opencode-provider-utils';

type DiscoveredModel = ProviderListResponse['all'][number]['models'][string];
const INPUT_MODALITIES: ModelOption['inputModalities'] = ['text', 'audio', 'image', 'video', 'pdf'];

function uniqueById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>();

  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }

    seen.add(item.id);
    return true;
  });
}

function requireData<T>(data: T | undefined, operation: string): T {
  if (data === undefined) {
    throw new Error(`OpenCode ${operation} returned no data.`);
  }
  return data;
}

export async function discoverChatCapabilities(
  client: OpencodeClient,
  activeProjectPath?: string,
  options: {
    includeEngineAgents?: boolean;
    includeProviderAuth?: boolean;
  } = {},
) {
  if (!activeProjectPath) {
    return {
      config: undefined,
      providers: [],
      providerAuthMethodsById: {},
      models: [],
      agents: [],
      connected: [],
      configuredModels: [],
    };
  }

  const [configResponse, providersResponse, providerAuthResponse] =
    await Promise.all([
      client.config.get(),
      client.provider.list(),
      options.includeProviderAuth === false
        ? Promise.resolve({ data: {} })
        : client.provider.auth(),
    ]);

  const nextConfig = requireData(configResponse.data, 'config request');
  const providerData = requireData(providersResponse.data, 'provider request');
  const authData = requireData(providerAuthResponse.data, 'provider auth request');
  const agentData = options.includeEngineAgents === false
    ? []
    : requireData(
        (await client.app.agents()).data,
        'agent request',
      );
  const nextModels = uniqueById(providerData.all
    .flatMap((provider) =>
      Object.values(provider.models).map((model: DiscoveredModel): ModelOption => ({
        id: `${provider.id}/${model.id}`,
        label: model.name,
        providerID: provider.id,
        providerLabel: provider.name,
        modelID: model.id,
        recommended: providerData.default[provider.id] === model.id,
        supportsReasoning: model.capabilities.reasoning,
        supportsAttachments: model.capabilities.attachment,
        inputModalities: INPUT_MODALITIES.filter((modality) => model.capabilities.input[modality]),
        supportsToolCalls: model.capabilities.toolcall,
        contextLimit: model.limit.context,
        outputLimit: model.limit.output,
        pricing: model.cost,
        status: model.status,
      })),
    )
    .sort((left, right) => {
      const leftDefault = providerData.default[left.providerID] === left.modelID;
      const rightDefault = providerData.default[right.providerID] === right.modelID;
      return Number(rightDefault) - Number(leftDefault) || left.label.localeCompare(right.label);
    }));

  const configuredProviderIds = getConfiguredProviderIds(nextConfig, providerData.connected, nextModels);
  const configuredModels = nextModels.filter((model) => configuredProviderIds.has(model.providerID));
  const nextProviders = uniqueById(providerData.all
    .map((provider) => ({
      id: provider.id,
      label: provider.name,
      accountLabel: provider.name,
      modelCount: Object.keys(provider.models).length,
      configured: configuredProviderIds.has(provider.id),
      connected: providerData.connected.includes(provider.id),
    }))
    .sort((left, right) => left.label.localeCompare(right.label)));
  const nextAgents = uniqueById(agentData.map(toAgentOption));

  return {
    config: nextConfig,
    providers: nextProviders,
    connected: providerData.connected,
    providerAuthMethodsById: authData,
    models: nextModels,
    agents: nextAgents,
    configuredModels,
  };
}
