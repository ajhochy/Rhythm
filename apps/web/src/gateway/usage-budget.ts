import type { GatewayMode } from '.';

export type UsageBudgetKind = 'window' | 'credits' | 'unavailable';

export interface UsageBudgetItem {
  label: string;
  remainingFraction: number | null;
  resetAt?: string;
  detail?: string;
}

export interface UsageBudgetProvider {
  provider: string;
  label: string;
  kind: UsageBudgetKind;
  accountId?: string;
  items: UsageBudgetItem[];
  reason?: string;
}

export interface UsageBudgetSnapshot {
  providers: UsageBudgetProvider[];
  fetchedAt?: string;
}

export interface UsageBudgetGateway {
  readonly mode: GatewayMode;
  get(options?: { force?: boolean }): Promise<UsageBudgetSnapshot>;
}

export class UsageBudgetGatewayError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && !Array.isArray(value) && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function parseItem(value: unknown): UsageBudgetItem {
  const item = record(value);
  if (!item || typeof item.label !== 'string') throw new UsageBudgetGatewayError(0, 'Malformed usage budget response: provider item is invalid');
  return {
    label: item.label,
    remainingFraction: typeof item.remainingFraction === 'number' && Number.isFinite(item.remainingFraction) ? item.remainingFraction : null,
    resetAt: typeof item.resetAt === 'string' ? item.resetAt : undefined,
    detail: typeof item.detail === 'string' ? item.detail : undefined,
  };
}

function parseProvider(value: unknown): UsageBudgetProvider {
  const provider = record(value);
  if (!provider || typeof provider.provider !== 'string' || typeof provider.label !== 'string' || !['window', 'credits', 'unavailable'].includes(String(provider.kind)) || !Array.isArray(provider.items)) {
    throw new UsageBudgetGatewayError(0, 'Malformed usage budget response: provider is invalid');
  }
  return {
    provider: provider.provider,
    label: provider.label,
    kind: provider.kind as UsageBudgetKind,
    accountId: typeof provider.accountId === 'string' ? provider.accountId : undefined,
    items: provider.items.map(parseItem),
    reason: typeof provider.reason === 'string' ? provider.reason : undefined,
  };
}

function parseSnapshot(value: unknown): UsageBudgetSnapshot {
  const body = record(value);
  if (!body || !Array.isArray(body.providers)) throw new UsageBudgetGatewayError(0, 'Malformed usage budget response: providers must be an array');
  return { providers: body.providers.map(parseProvider), fetchedAt: typeof body.fetchedAt === 'string' ? body.fetchedAt : undefined };
}

export function createLiveUsageBudgetGateway(apiBase: string, token: string | undefined, fetcher: typeof fetch = fetch): UsageBudgetGateway {
  if (!token?.trim()) throw new Error('Live configuration error: a usage-budget token is required');
  return {
    mode: 'live',
    get: async (options) => {
      let response: Response;
      try {
        response = await fetcher(`${apiBase}/agents/usage-budget${options?.force ? '?force=true' : ''}`, { headers: { Authorization: `Bearer ${token}` } });
      } catch {
        throw new UsageBudgetGatewayError(0, 'Usage budget service unavailable');
      }
      if (!response.ok) throw new UsageBudgetGatewayError(response.status, `Usage budget request failed (${response.status})`);
      return parseSnapshot(await response.json());
    },
  };
}
