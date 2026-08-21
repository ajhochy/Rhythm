import type { GatewayMode } from '.';

export type RhythmFrequency = 'weekly' | 'monthly' | 'annual';
export interface RhythmStep { id: string; title: string; assigneeId: number | null; assigneeName?: string | null; dayOfWeek?: number | null; dayOfMonth?: number | null; month?: number | null }
export interface RhythmCollaborator { userId: number; name: string; email: string; photoUrl: string | null }
export interface RhythmProgress { totalCount: number; completedCount: number; remainingCount: number; personalRemainingCount: number; waitingOnUserId: number | null; waitingOnUserName: string | null; nextDueDate: string | null; completionRatio: number }
export interface RhythmRule { id: string; title: string; frequency: RhythmFrequency; dayOfWeek: number | null; dayOfMonth: number | null; month: number | null; enabled: boolean; sequential: boolean; ownerId: number | null; goalId?: string | null; steps: RhythmStep[]; collaborators: RhythmCollaborator[]; progress?: RhythmProgress; createdAt: string }
export type CreateRhythmInput = Pick<RhythmRule, 'title' | 'frequency'> & Partial<Pick<RhythmRule, 'dayOfWeek' | 'dayOfMonth' | 'month' | 'enabled' | 'sequential' | 'ownerId' | 'goalId' | 'steps'>>;
export type UpdateRhythmInput = Partial<CreateRhythmInput>;
export type CreateRhythmStepInput = Pick<RhythmStep, 'title'> & Partial<Pick<RhythmStep, 'assigneeId' | 'dayOfWeek' | 'dayOfMonth' | 'month'>> & { sortOrder?: number };

export interface RhythmsGateway {
  readonly mode: GatewayMode;
  list(): Promise<RhythmRule[]>;
  detail(id: string): Promise<RhythmRule>;
  create(input: CreateRhythmInput): Promise<RhythmRule>;
  update(id: string, input: UpdateRhythmInput): Promise<RhythmRule>;
  delete(id: string): Promise<void>;
  addStep(id: string, input: CreateRhythmStepInput): Promise<RhythmStep>;
  collaborators(id: string): Promise<RhythmCollaborator[]>;
  addCollaborator(id: string, userId: number): Promise<RhythmCollaborator[]>;
  removeCollaborator(id: string, userId: number): Promise<void>;
}

export class RhythmsGatewayError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const failureText = (status: number, operation: string) => ({ 0: 'Rhythms service unavailable', 401: 'Authentication required', 403: 'Forbidden', 404: 'Rhythm not found' })[status] ?? `${operation} failed (${status})`;
async function response<T>(operation: string, pending: Promise<Response>): Promise<T> { try { const result = await pending; if (!result.ok) throw new RhythmsGatewayError(result.status, failureText(result.status, operation)); return result.status === 204 ? undefined as T : await result.json() as T; } catch (error) { if (error instanceof RhythmsGatewayError) throw error; throw new RhythmsGatewayError(0, failureText(0, operation)); } }

export function createFixtureRhythmsGateway(_fetcher?: typeof fetch): RhythmsGateway {
  const unsupported = async (..._args: unknown[]): Promise<never> => { throw new RhythmsGatewayError(0, 'Fixture rhythms gateway is unsupported'); };
  return { mode: 'fixture', list: unsupported, detail: unsupported, create: unsupported, update: unsupported, delete: unsupported, addStep: unsupported, collaborators: unsupported, addCollaborator: unsupported, removeCollaborator: unsupported };
}

export function createLiveRhythmsGateway(apiBase: string, token: string | undefined, fetcher: typeof fetch = fetch): RhythmsGateway {
  if (!token?.trim()) throw new Error('Live configuration error: an explicit rhythms token is required');
  const request = (path: string, init: RequestInit = {}) => fetcher(`${apiBase}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  const json = (value: unknown) => JSON.stringify(value);
  return {
    mode: 'live',
    // apps/api_server/src/routes/recurring_rules_routes.ts:9-13
    list: () => response<RhythmRule[]>('Load rhythms', request('/recurring-rules')),
    detail: (id) => response<RhythmRule>('Load rhythm', request(`/recurring-rules/${encodeURIComponent(id)}`)),
    create: (input) => response<RhythmRule>('Create rhythm', request('/recurring-rules', { method: 'POST', body: json(input) })),
    update: (id, input) => response<RhythmRule>('Update rhythm', request(`/recurring-rules/${encodeURIComponent(id)}`, { method: 'PATCH', body: json(input) })),
    delete: (id) => response<void>('Delete rhythm', request(`/recurring-rules/${encodeURIComponent(id)}`, { method: 'DELETE' })),
    // apps/api_server/src/routes/recurring_rules_routes.ts:14
    addStep: (id, input) => response<RhythmStep>('Add rhythm step', request(`/recurring-rules/${encodeURIComponent(id)}/steps`, { method: 'POST', body: json(input) })),
    // apps/api_server/src/routes/recurring_rules_routes.ts:15-17
    collaborators: (id) => response<RhythmCollaborator[]>('Load rhythm collaborators', request(`/recurring-rules/${encodeURIComponent(id)}/collaborators`)),
    addCollaborator: (id, userId) => response<RhythmCollaborator[]>('Add rhythm collaborator', request(`/recurring-rules/${encodeURIComponent(id)}/collaborators`, { method: 'POST', body: json({ userId }) })),
    removeCollaborator: (id, userId) => response<void>('Remove rhythm collaborator', request(`/recurring-rules/${encodeURIComponent(id)}/collaborators/${encodeURIComponent(userId)}`, { method: 'DELETE' })),
  };
}
