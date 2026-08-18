import type { TaskFixture, TaskStatus } from '../pages/tasks/fixtures';
import type { GatewayMode } from '.';
// Same shape as apps/api_server/src/models/task.ts:1-5 (TaskCollaborator); already declared
// once for the live gateway layer in gateway/planner.ts:5-9 — reused here instead of a second
// duplicate interface.
import type { TaskCollaborator } from './planner';

export type { TaskCollaborator };

export interface TaskGateway {
  readonly mode: GatewayMode;
  list(): Promise<TaskFixture[]>;
  create(input: Pick<TaskFixture, 'title' | 'notes' | 'scheduledDate' | 'dueDate' | 'preferredAgent'>): Promise<TaskFixture>;
  update(id: string, input: Partial<Pick<TaskFixture, 'title' | 'notes' | 'scheduledDate' | 'dueDate' | 'preferredAgent' | 'energy' | 'status'>>): Promise<TaskFixture>;
  delete(id: string): Promise<void>;
  // apps/api_server/src/routes/tasks_routes.ts:14-16
  collaborators(id: string): Promise<TaskCollaborator[]>;
  addCollaborator(id: string, userId: number): Promise<TaskCollaborator[]>;
  removeCollaborator(id: string, userId: number): Promise<void>;
}

export class TaskGatewayError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

type ApiTask = {
  id: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  dueDate: string | null;
  scheduledDate: string | null;
  sourceType: string | null;
  sourceName: string | null;
  ownerId: number | null;
  isShared: boolean;
  priority: number | null;
  tags: string[];
  createdAt: string;
  preferredAgent: string | null;
  energy: string | null;
};

function bucket(task: ApiTask): TaskFixture['bucket'] {
  if (task.status === 'done') return 'completed';
  if (!task.dueDate && !task.scheduledDate) return 'no-due';
  return 'week';
}

function mapTask(task: ApiTask): TaskFixture {
  return {
    id: task.id,
    title: task.title,
    notes: task.notes ?? '',
    status: task.status,
    bucket: bucket(task),
    priority: Math.min(3, Math.max(0, task.priority ?? 0)) as TaskFixture['priority'],
    tags: task.tags ?? [],
    scheduledDate: task.scheduledDate ?? undefined,
    dueDate: task.dueDate ?? undefined,
    createdAt: task.createdAt,
    sourceName: task.sourceName ?? undefined,
    // Pass the server value through truthfully (apps/api_server/src/models/task.ts:19 declares
    // sourceType as `string | null`, not a closed union) instead of coercing every unrecognized
    // source into 'manual'.
    sourceType: task.sourceType ?? 'manual',
    // The API never returns an owner display name from this endpoint (rowToTask in
    // apps/api_server/src/repositories/tasks_repository.ts:33-63 has no join to the owner's
    // name), so this shows the real ownerId instead of inventing a "Task owner" placeholder.
    createdBy: task.ownerId != null ? `Owner #${task.ownerId}` : 'Unknown owner',
    ownerId: String(task.ownerId ?? ''),
    isShared: task.isShared,
    preferredAgent: task.preferredAgent === 'claude-code' || task.preferredAgent === 'codex' ? task.preferredAgent : '',
    energy: task.energy === '🔥' || task.energy === '⚡' || task.energy === '🌱' ? task.energy : '',
    collaborators: [],
  };
}

async function response<T>(request: Promise<Response>): Promise<T> {
  const result = await request;
  if (!result.ok) {
    const labels: Record<number, string> = { 401: 'Authentication required', 403: 'Forbidden', 404: 'Task not found' };
    throw new TaskGatewayError(result.status, labels[result.status] ?? `Task request failed (${result.status})`);
  }
  return result.status === 204 ? undefined as T : await result.json() as T;
}

function request(apiBase: string, token: string, path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch) {
  return fetcher(`${apiBase}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
  });
}

export function createFixtureTasksGateway(tasks: () => TaskFixture[]): TaskGateway {
  const unsupported = async (): Promise<never> => { throw new Error('Fixture task mutations stay in the deterministic Tasks page state'); };
  return {
    mode: 'fixture',
    list: async () => tasks(),
    create: async (input) => ({ ...input, id: '', status: 'open', bucket: 'no-due', priority: 0, tags: [], createdAt: '', sourceType: 'manual', createdBy: '', ownerId: '', energy: '', collaborators: [] }),
    update: unsupported,
    delete: unsupported,
    collaborators: unsupported,
    addCollaborator: unsupported,
    removeCollaborator: unsupported,
  };
}

export function createLiveTasksGateway(apiBase: string, token: string | undefined, fetcher: typeof fetch = fetch): TaskGateway {
  if (!token?.trim()) throw new Error('Live configuration error: an explicit task token is required');
  const body = (input: Record<string, unknown>) => JSON.stringify({
    ...input,
    ...('preferredAgent' in input && !input.preferredAgent ? { preferredAgent: null } : {}),
    ...('energy' in input && !input.energy ? { energy: null } : {}),
  });
  const req = (path: string, init: RequestInit = {}) => request(apiBase, token, path, init, fetcher);
  return {
    mode: 'live',
    list: async () => (await response<ApiTask[]>(req('/tasks?status=all'))).map(mapTask),
    create: async (input) => mapTask(await response<ApiTask>(req('/tasks', { method: 'POST', body: body(input) }))),
    update: async (id, input) => mapTask(await response<ApiTask>(req(`/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: body(input) }))),
    delete: async (id) => response<void>(req(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' })),
    // apps/api_server/src/routes/tasks_routes.ts:14
    collaborators: async (id) => response<TaskCollaborator[]>(req(`/tasks/${encodeURIComponent(id)}/collaborators`)),
    // apps/api_server/src/routes/tasks_routes.ts:15
    addCollaborator: async (id, userId) => response<TaskCollaborator[]>(req(`/tasks/${encodeURIComponent(id)}/collaborators`, { method: 'POST', body: JSON.stringify({ userId }) })),
    // apps/api_server/src/routes/tasks_routes.ts:16
    removeCollaborator: async (id, userId) => response<void>(req(`/tasks/${encodeURIComponent(id)}/collaborators/${encodeURIComponent(userId)}`, { method: 'DELETE' })),
  };
}
