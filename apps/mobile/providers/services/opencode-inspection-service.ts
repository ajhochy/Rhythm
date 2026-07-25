import type { OpencodeClient } from '@opencode-ai/sdk/v2/client';

import type {
  McpResource,
  Skills,
  ToolIds,
  ToolList,
} from '@/lib/opencode/types';
import {
  requestOpenCodeRoute,
  type OpencodeConnectionSettings,
} from '@/lib/opencode/client';

function requireData<T>(data: T | undefined, operation: string): T {
  if (data === undefined) {
    throw new Error(`OpenCode ${operation} returned no data.`);
  }
  return data;
}

const SENSITIVE_CONFIG_KEY = /(?:^key$|api[-_]?key|authorization|credential|password|private[-_]?key|secret|token)/i;

export type SafeConfigValue =
  | null
  | boolean
  | number
  | string
  | SafeConfigValue[]
  | { [key: string]: SafeConfigValue };

export type OpenCodeInspection = {
  skills: Skills;
  globalConfig: SafeConfigValue;
  resources: Record<string, McpResource>;
  toolIds: ToolIds;
  toolSchemas: ToolList;
};

export function redactConfigForInspection(value: unknown, key = ''): SafeConfigValue {
  if (SENSITIVE_CONFIG_KEY.test(key)) {
    return '[redacted]';
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactConfigForInspection(entry));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactConfigForInspection(entryValue, entryKey),
      ]),
    );
  }
  return String(value);
}

export async function listOpenCodeSkills(client: OpencodeClient) {
  return requireData((await client.app.skills()).data, 'skill list request');
}

export async function reloadOpenCodeSkills(settings: OpencodeConnectionSettings) {
  return requireData(
    await requestOpenCodeRoute<Skills | undefined>(settings, '/skill/reload', { method: 'POST' }),
    'skill reload request',
  );
}

export async function reloadOpenCodeConfig(settings: OpencodeConnectionSettings) {
  return requireData(
    await requestOpenCodeRoute<boolean | undefined>(settings, '/config/reload', { method: 'POST' }),
    'config reload request',
  );
}

export async function getSafeGlobalConfig(client: OpencodeClient) {
  const config = requireData((await client.global.config.get()).data, 'global config request');
  return redactConfigForInspection(config);
}

export async function listOpenCodeResources(client: OpencodeClient) {
  return requireData((await client.experimental.resource.list()).data, 'MCP resource list request');
}

export async function listOpenCodeToolIds(client: OpencodeClient) {
  return requireData((await client.tool.ids()).data, 'tool ID list request');
}

export async function listOpenCodeToolSchemas(
  client: OpencodeClient,
  provider: string,
  model: string,
) {
  return requireData(
    (await client.tool.list({ provider, model })).data,
    'tool schema list request',
  );
}

export async function loadOpenCodeInspection(
  client: OpencodeClient,
  provider?: string,
  model?: string,
): Promise<OpenCodeInspection> {
  const [skills, globalConfig, resources, toolIds, toolSchemas] = await Promise.all([
    listOpenCodeSkills(client),
    getSafeGlobalConfig(client),
    listOpenCodeResources(client),
    listOpenCodeToolIds(client),
    provider && model ? listOpenCodeToolSchemas(client, provider, model) : Promise.resolve([]),
  ]);
  return { skills, globalConfig, resources, toolIds, toolSchemas };
}
