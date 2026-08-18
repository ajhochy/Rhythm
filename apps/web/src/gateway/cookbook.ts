import type { GatewayMode } from '.';

// Canonical persisted recipe — apps/api_server/src/repositories/agent_cookbook_repository.ts,
// as returned by apps/api_server/src/controllers/agentCookbookController.ts (list/get/create/update).
export interface CookbookRecipe {
  id: string;
  title: string;
  description: string | null;
  stepsJson: string;
  boundConfigId: string | null;
  ownerUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CookbookRecipeInput {
  title: string;
  description?: string | null;
  stepsJson?: string;
  steps?: unknown[];
  boundConfigId?: string | null;
}

// POST /agent-cookbook/:id/run response — agentCookbookController.ts:162 (runRecipe).
export interface CookbookRunResult {
  sessionId: string;
  status: string;
}

// Minimal owned-session shape needed to confirm the run's session before navigating —
// apps/api_server/src/routes/agent_sessions_routes.ts:66 (GET /:id -> controller.getOne).
export interface OwnedCookbookSession { id: string; ownerUserId: number | null; status: string }

export interface CookbookGateway {
  readonly mode: GatewayMode;
  // GET /agent-cookbook — agentCookbookRoutes.ts:11.
  list(): Promise<CookbookRecipe[]>;
  // POST /agent-cookbook — agentCookbookRoutes.ts:13.
  create(input: CookbookRecipeInput): Promise<CookbookRecipe>;
  // PATCH /agent-cookbook/:id — agentCookbookRoutes.ts:15.
  update(id: string, patch: Partial<CookbookRecipeInput>): Promise<CookbookRecipe>;
  // DELETE /agent-cookbook/:id — agentCookbookRoutes.ts:16.
  remove(id: string): Promise<void>;
  // POST /agent-cookbook/:id/run — agentCookbookRoutes.ts:14.
  run(id: string): Promise<CookbookRunResult>;
  // GET /agent-sessions/:id — confirms the run's session is real and owned before navigating.
  session(id: string): Promise<OwnedCookbookSession>;
}

export class CookbookGatewayError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const failureText = (status: number, operation: string) =>
  ({ 0: 'Cookbook service unavailable', 401: 'Authentication required', 403: 'Forbidden', 404: 'Recipe not found' }[status] ?? `${operation} failed (${status})`);

async function response<T>(operation: string, pending: Promise<Response>): Promise<T> {
  try {
    const result = await pending;
    if (!result.ok) throw new CookbookGatewayError(result.status, failureText(result.status, operation));
    return result.status === 204 ? undefined as T : await result.json() as T;
  } catch (error) {
    if (error instanceof CookbookGatewayError) throw error;
    throw new CookbookGatewayError(0, failureText(0, operation));
  }
}

export function createFixtureCookbookGateway(): CookbookGateway {
  const unsupported = async (): Promise<never> => { throw new CookbookGatewayError(0, 'Fixture cookbook gateway is unsupported'); };
  return { mode: 'fixture', list: unsupported, create: unsupported, update: unsupported, remove: unsupported, run: unsupported, session: unsupported };
}

export function createLiveCookbookGateway(apiBase: string, token: string | undefined, fetcher: typeof fetch = fetch): CookbookGateway {
  if (!token?.trim()) throw new Error('Live configuration error: a cookbook token is required');
  const request = (path: string, init: RequestInit = {}) =>
    fetcher(`${apiBase}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  return {
    mode: 'live',
    list: () => response<CookbookRecipe[]>('Load cookbook', request('/agent-cookbook')),
    create: (input) => response<CookbookRecipe>('Create recipe', request('/agent-cookbook', { method: 'POST', body: JSON.stringify(input) })),
    update: (id, patch) => response<CookbookRecipe>('Update recipe', request(`/agent-cookbook/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) })),
    remove: (id) => response<void>('Delete recipe', request(`/agent-cookbook/${encodeURIComponent(id)}`, { method: 'DELETE' })),
    run: (id) => response<CookbookRunResult>('Run recipe', request(`/agent-cookbook/${encodeURIComponent(id)}/run`, { method: 'POST' })),
    session: async (id) => {
      const body = await response<{ session?: OwnedCookbookSession } & Partial<OwnedCookbookSession>>('Load recipe session', request(`/agent-sessions/${encodeURIComponent(id)}`));
      return (body.session ?? body) as OwnedCookbookSession;
    },
  };
}
