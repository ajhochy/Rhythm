import type { GatewayMode } from '.';

export type TaskStatus = 'open' | 'in_progress' | 'waiting_for_reply' | 'done';

export interface TaskCollaborator {
  userId: number;
  name: string;
  photoUrl: string | null;
}

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  dueDate: string | null;
  scheduledDate: string | null;
  scheduledOrder: number | null;
  locked: boolean;
  status: TaskStatus;
  sourceType: string | null;
  sourceId: string | null;
  sourceName: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  isAllDay?: boolean;
  ownerId: number | null;
  goalId?: string | null;
  priority: number | null;
  tags: string[];
  energy: string | null;
  workspaceId?: number | null;
  isShared?: boolean;
  collaborators: TaskCollaborator[];
  createdAt: string;
  updatedAt: string;
  preferredAgent: string | null;
}

export interface WeeklyPlan {
  weekLabel: string;
  weekStart: string;
  days: Array<{ date: string; tasks: Task[] }>;
  backlog: Task[];
}

export type CreateTaskInput = Pick<Task, 'title'> & Partial<Pick<Task, 'notes' | 'dueDate' | 'status' | 'scheduledDate' | 'scheduledOrder' | 'locked' | 'sourceType' | 'sourceId' | 'ownerId' | 'goalId' | 'priority' | 'tags' | 'energy' | 'preferredAgent'>>;
export type UpdateTaskInput = Partial<Pick<Task, 'title' | 'notes' | 'dueDate' | 'status' | 'scheduledDate' | 'scheduledOrder' | 'locked' | 'ownerId' | 'goalId' | 'priority' | 'tags' | 'energy' | 'preferredAgent'>>;
export type UpdateProjectStepInput = Partial<{ title: string; dueDate: string; scheduledDate: string | null; status: 'open' | 'done'; notes: string | null; assigneeId: number | null; milestoneId: string | null }>;

export interface PlannerGateway {
  readonly mode: GatewayMode;
  plan(weekLabel: string): Promise<WeeklyPlan>;
  scheduleTask(id: string, input: { scheduledDate?: string; locked?: boolean }): Promise<Task>;
  createTask(input: CreateTaskInput): Promise<Task>;
  updateTask(id: string, input: UpdateTaskInput): Promise<Task>;
  updateProjectStep(stepId: string, input: UpdateProjectStepInput): Promise<unknown>;
  taskCollaborators(taskId: string): Promise<TaskCollaborator[]>;
  addTaskCollaborator(taskId: string, userId: number): Promise<TaskCollaborator[]>;
  removeTaskCollaborator(taskId: string, userId: number): Promise<void>;
}

export class PlannerGatewayError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const failureText = (status: number, operation: string) => {
  const label: Record<number, string> = { 0: 'Planner service unavailable', 401: 'Authentication required', 403: 'Forbidden', 404: 'Planner record not found' };
  return label[status] ?? `${operation} failed (${status})`;
};

async function response<T>(operation: string, pending: Promise<Response>): Promise<T> {
  try {
    const result = await pending;
    if (!result.ok) throw new PlannerGatewayError(result.status, failureText(result.status, operation));
    return result.status === 204 ? undefined as T : await result.json() as T;
  } catch (error) {
    if (error instanceof PlannerGatewayError) throw error;
    throw new PlannerGatewayError(0, failureText(0, operation));
  }
}

export function createFixturePlannerGateway(_fetcher?: typeof fetch): PlannerGateway {
  const unsupported = async (..._args: unknown[]): Promise<never> => { throw new PlannerGatewayError(0, 'Fixture planner gateway is unsupported'); };
  return { mode: 'fixture', plan: unsupported, scheduleTask: unsupported, createTask: unsupported, updateTask: unsupported, updateProjectStep: unsupported, taskCollaborators: unsupported, addTaskCollaborator: unsupported, removeTaskCollaborator: unsupported };
}

export function createLivePlannerGateway(apiBase: string, token: string | undefined, fetcher: typeof fetch = fetch): PlannerGateway {
  if (!token?.trim()) throw new Error('Live configuration error: an explicit planner token is required');
  const request = (path: string, init: RequestInit = {}) => fetcher(`${apiBase}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  const body = (input: unknown) => JSON.stringify(input);
  return {
    mode: 'live',
    // apps/api_server/src/routes/weekly_plan_routes.ts:9
    plan: (weekLabel) => response<WeeklyPlan>('Load weekly plan', request(`/weekly-plan?week=${encodeURIComponent(weekLabel)}`)),
    // apps/api_server/src/routes/weekly_plan_routes.ts:10
    scheduleTask: (id, input) => response<Task>('Schedule task', request(`/weekly-plan/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: body(input) })),
    // apps/api_server/src/routes/tasks_routes.ts:11-12
    createTask: (input) => response<Task>('Create task', request('/tasks', { method: 'POST', body: body(input) })),
    updateTask: (id, input) => response<Task>('Update task', request(`/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: body(input) })),
    // apps/api_server/src/routes/project_instances_routes.ts:13
    updateProjectStep: (stepId, input) => response<unknown>('Update project step', request(`/project-instances/steps/${encodeURIComponent(stepId)}`, { method: 'PATCH', body: body(input) })),
    // apps/api_server/src/routes/tasks_routes.ts:14-16
    taskCollaborators: (taskId) => response<TaskCollaborator[]>('Load task collaborators', request(`/tasks/${encodeURIComponent(taskId)}/collaborators`)),
    addTaskCollaborator: (taskId, userId) => response<TaskCollaborator[]>('Add task collaborator', request(`/tasks/${encodeURIComponent(taskId)}/collaborators`, { method: 'POST', body: body({ userId }) })),
    removeTaskCollaborator: (taskId, userId) => response<void>('Remove task collaborator', request(`/tasks/${encodeURIComponent(taskId)}/collaborators/${encodeURIComponent(userId)}`, { method: 'DELETE' })),
  };
}
