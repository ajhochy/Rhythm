import type { GatewayMode } from '.';

// Canonical persisted memory row + derived wire fields —
// apps/api_server/src/repositories/agent_memory_repository.ts:9-30.
export interface AgentMemory {
  id: string;
  kind: string;
  content: string;
  source: string | null;
  sourceId: string | null;
  tagsJson: string;
  status: 'draft' | 'stable' | 'deprecated';
  staleAfter: string | null;
  verifiedJson: string;
  sourcesJson: string;
  generatedBy: string | null;
  generatedAt: string | null;
  trustTier: 'unverified' | 'machine' | 'human';
  autoInjectable?: boolean;
  ownerUserId: number | null;
  createdAt: string;
  updatedAt: string;
  lifecycleState?: 'active' | 'stale' | 'deprecated';
  unverifiable?: boolean;
}

export interface MemoryUpdateInput { content?: string; kind?: string; tags?: string[] }

export interface MemoryGateway {
  readonly mode: GatewayMode;
  // GET /agent-memory — apps/api_server/src/routes/agentMemoryRoutes.ts:18; owner-scoped
  // list per apps/api_server/src/repositories/agent_memory_repository.ts:301-315.
  list(): Promise<AgentMemory[]>;
  // GET /agent-memory/search?q= — apps/api_server/src/routes/agentMemoryRoutes.ts:19.
  search(query: string): Promise<AgentMemory[]>;
  // PATCH /agent-memory/:id — apps/api_server/src/controllers/agentMemoryController.ts:152-184.
  update(id: string, patch: MemoryUpdateInput): Promise<AgentMemory>;
  // DELETE /agent-memory/:id — apps/api_server/src/controllers/agentMemoryController.ts:136-142.
  remove(id: string): Promise<void>;
}

export class MemoryGatewayError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const failureText = (status: number, operation: string) =>
  ({ 0: 'Memory service unavailable', 401: 'Authentication required', 403: 'Forbidden', 404: 'Memory not found' }[status] ?? `${operation} failed (${status})`);

async function response<T>(operation: string, pending: Promise<Response>): Promise<T> {
  try {
    const result = await pending;
    if (!result.ok) throw new MemoryGatewayError(result.status, failureText(result.status, operation));
    return result.status === 204 ? undefined as T : await result.json() as T;
  } catch (error) {
    if (error instanceof MemoryGatewayError) throw error;
    throw new MemoryGatewayError(0, failureText(0, operation));
  }
}

export function createFixtureMemoryGateway(): MemoryGateway {
  const unsupported = async (): Promise<never> => { throw new MemoryGatewayError(0, 'Fixture memory gateway is unsupported'); };
  return { mode: 'fixture', list: unsupported, search: unsupported, update: unsupported, remove: unsupported };
}

export function createLiveMemoryGateway(apiBase: string, token: string | undefined, fetcher: typeof fetch = fetch): MemoryGateway {
  if (!token?.trim()) throw new Error('Live configuration error: a memory token is required');
  const request = (path: string, init: RequestInit = {}) =>
    fetcher(`${apiBase}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  return {
    mode: 'live',
    list: () => response<AgentMemory[]>('Load memories', request('/agent-memory')),
    search: (query) => response<AgentMemory[]>('Search memories', request(`/agent-memory/search?q=${encodeURIComponent(query)}`)),
    update: (id, patch) => response<AgentMemory>('Update memory', request(`/agent-memory/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) })),
    remove: (id) => response<void>('Delete memory', request(`/agent-memory/${encodeURIComponent(id)}`, { method: 'DELETE' })),
  };
}
