import type {
  McpResource,
  Skills,
  ToolIds,
  ToolList,
} from '@/lib/opencode/types';
import type { ScopedOpencodeClient } from '@/lib/opencode/client';

function requireData<T>(data: T | undefined, operation: string): T {
  if (data === undefined) {
    throw new Error(`OpenCode ${operation} returned no data.`);
  }
  return data;
}

const SENSITIVE_CONFIG_KEY = /(?:^key$|api[-_]?key|authorization|credential|password|private[-_]?key|secret|token)/i;
const OPENCODE_INSPECTION_TIMEOUT_MS = 12_000;

type InspectionRequestOptions = {
  signal?: AbortSignal;
};

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

export async function listOpenCodeSkills(
  client: ScopedOpencodeClient,
  options: InspectionRequestOptions = {},
) {
  return requireData(
    (await client.app.skills(undefined, { signal: options.signal })).data,
    'skill list request',
  );
}

export async function reloadOpenCodeSkills(client: ScopedOpencodeClient) {
  return requireData(
    (await client.app.skills.reload()).data,
    'skill reload request',
  );
}

export async function reloadOpenCodeConfig(client: ScopedOpencodeClient) {
  return requireData(
    (await client.app.config.reload()).data,
    'config reload request',
  );
}

export async function getSafeGlobalConfig(
  client: ScopedOpencodeClient,
  options: InspectionRequestOptions = {},
) {
  const config = requireData(
    (await client.global.config.get({ signal: options.signal })).data,
    'global config request',
  );
  return redactConfigForInspection(config);
}

export async function listOpenCodeResources(
  client: ScopedOpencodeClient,
  options: InspectionRequestOptions = {},
) {
  return requireData(
    (await client.experimental.resource.list(undefined, { signal: options.signal })).data,
    'MCP resource list request',
  );
}

export async function listOpenCodeToolIds(
  client: ScopedOpencodeClient,
  options: InspectionRequestOptions = {},
) {
  return requireData(
    (await client.tool.ids(undefined, { signal: options.signal })).data,
    'tool ID list request',
  );
}

export async function listOpenCodeToolSchemas(
  client: ScopedOpencodeClient,
  provider: string,
  model: string,
  options: InspectionRequestOptions = {},
) {
  return requireData(
    (await client.tool.list({ provider, model }, { signal: options.signal })).data,
    'tool schema list request',
  );
}

export async function loadOpenCodeInspection(
  client: ScopedOpencodeClient,
  provider?: string,
  model?: string,
  options: { timeoutMs?: number } = {},
): Promise<OpenCodeInspection> {
  const abortController = new AbortController();
  const timeout = setTimeout(
    () => abortController.abort(),
    options.timeoutMs ?? OPENCODE_INSPECTION_TIMEOUT_MS,
  );
  const requestOptions = { signal: abortController.signal };

  try {
    const [skills, globalConfig, resources, toolIds, toolSchemas] = await Promise.all([
      listOpenCodeSkills(client, requestOptions),
      getSafeGlobalConfig(client, requestOptions),
      listOpenCodeResources(client, requestOptions),
      listOpenCodeToolIds(client, requestOptions),
      provider && model
        ? listOpenCodeToolSchemas(client, provider, model, requestOptions)
        : Promise.resolve([]),
    ]);
    return { skills, globalConfig, resources, toolIds, toolSchemas };
  } catch {
    const timedOut = abortController.signal.aborted;
    abortController.abort();
    throw new Error(
      timedOut
        ? 'OpenCode runtime inspection timed out. Try again.'
        : 'OpenCode runtime inspection is temporarily unavailable. Try again.',
    );
  } finally {
    clearTimeout(timeout);
  }
}
