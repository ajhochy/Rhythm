import { RhythmGatewayError, type SharedAgent, type SharedAgentCatalog, type SharedAgentChanges, type SharedAgentsPort } from '@ajhochy/rhythm-workspace-ui';
import type { SessionGateway } from './sessions';

type ErrorEnvelope = { error?: { code?: string; message?: string }; currentRevision?: number };

function gatewayKind(status: number): ConstructorParameters<typeof RhythmGatewayError>[0] {
  if (status === 401 || status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 0) return 'unavailable';
  return 'server_error';
}

async function errorFor(response: Response): Promise<RhythmGatewayError> {
  let body: ErrorEnvelope | null = null;
  try { body = await response.json() as ErrorEnvelope; } catch { /* fixed fallback below */ }
  return new RhythmGatewayError(gatewayKind(response.status), body?.error?.message ?? `Shared agents request failed (${response.status})`);
}

async function response<T>(pending: Promise<Response>): Promise<T> {
  let result: Response;
  try { result = await pending; } catch {
    throw new RhythmGatewayError('unavailable', 'Shared agents are unavailable.');
  }
  if (!result.ok) throw await errorFor(result);
  return await result.json() as T;
}

export function createLiveSharedAgentsPort(
  apiBase: string,
  token: string | undefined,
  sessions: SessionGateway,
  fetcher: typeof fetch = fetch,
  launchCwd = '/workspace/rhythm',
): SharedAgentsPort {
  if (!token?.trim()) throw new Error('Live configuration error: an explicit shared-agents token is required');
  const request = (path: string, init: RequestInit = {}) => fetcher(`${apiBase}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  const get = (id: string) => response<SharedAgent>(request(`/shared-agents/v1/catalog/${encodeURIComponent(id)}`));

  return {
    hostRuntime: 'opencode',
    list: () => response<SharedAgentCatalog>(request('/shared-agents/v1/catalog')),
    get,
    save: async (id: string, expectedRevision: number, changes: SharedAgentChanges) => {
      await response<unknown>(request(`/agent-configs/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ expectedRevision, ...changes }),
      }));
      return get(id);
    },
    launch: async (id: string, expectedRevision: number) => {
      try {
        const current = await get(id);
        if (current.revision !== expectedRevision) throw new RhythmGatewayError('conflict', 'Changed elsewhere, reload');
        await sessions.create({
          profileId: id,
          cwd: launchCwd,
          name: typeof current.canonical.label === 'string' ? current.canonical.label : id,
          isolateWorktree: false,
        });
        return { ok: true } as const;
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : 'Agent could not be launched.' } as const;
      }
    },
  };
}
