import type { GatewayMode } from '.';
import type { Message, MessageThread } from './messages';
import type { ProjectInstance, ProjectInstanceStep, UpdateProjectInstanceStepInput } from './projects';
import type { CreateTaskInput, Task, TaskCollaborator, UpdateTaskInput } from './planner';

export interface DashboardTaskSummary { openCount: number; pastDueCount: number; pastDeadlineCount: number; pastDeadlineTasks: Array<{ id: string; title: string; dueDate: string | null; scheduledDate: string | null; sourceType: string | null }>; todayRemainingCount: number; todayTotalCount: number; thisWeekRemainingCount: number; thisWeekTotalCount: number; unscheduledCount: number; recent: Task[]; pastDue: Task[]; today: Task[]; thisWeek: Task[]; unscheduled: Task[] }
export interface DashboardRhythmSummary { activeCount: number; items: Array<{ id: string; title: string; subtitle: string; completedCount: number; totalCount: number }> }
export interface DashboardProjectSummary { activeCount: number; items: Array<{ id: string; title: string; subtitle: string; completedCount: number; totalCount: number; nextDueDate: string | null; onDeckSteps: Array<{ id: string; title: string; status: string; dueDate: string | null; notes: string | null; assigneeId: number | null; assigneeName: string | null }>; ownerId: number | null; collaboratorNames: string[] }> }
export interface DashboardGoalSummary { activeCount: number; items: Array<{ id: string; title: string; metricType: string; currentValue: number; endValue: number; health: string; startDate: string; endDate: string; progress: number }> }
export interface DashboardMessageSummary { threadCount: number; unreadPreviews: Array<{ threadId: number; threadTitle: string; senderName: string; preview: string; updatedAt: string; unreadCount: number }> }
export interface DashboardSummary { tasks: DashboardTaskSummary; rhythms: DashboardRhythmSummary; projects: DashboardProjectSummary; goals: DashboardGoalSummary; messages: DashboardMessageSummary }

export interface DashboardGateway {
  readonly mode: GatewayMode;
  summary(): Promise<DashboardSummary>;
  projectInstances(): Promise<ProjectInstance[]>;
  createTask(input: CreateTaskInput): Promise<Task>;
  updateTask(id: string, input: UpdateTaskInput): Promise<Task>;
  updateProjectStep(stepId: string, input: UpdateProjectInstanceStepInput): Promise<ProjectInstanceStep>;
  taskCollaborators(taskId: string): Promise<TaskCollaborator[]>;
  addTaskCollaborator(taskId: string, userId: number): Promise<TaskCollaborator[]>;
  removeTaskCollaborator(taskId: string, userId: number): Promise<void>;
  messageThreads(taskId?: string): Promise<MessageThread[]>;
  messages(threadId: number): Promise<Message[]>;
}

export class DashboardGatewayError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const failureText = (status: number, operation: string) => ({ 0: 'Dashboard service unavailable', 401: 'Authentication required', 403: 'Forbidden', 404: 'Dashboard record not found' })[status] ?? `${operation} failed (${status})`;
async function response<T>(operation: string, pending: Promise<Response>): Promise<T> { try { const result = await pending; if (!result.ok) throw new DashboardGatewayError(result.status, failureText(result.status, operation)); return result.status === 204 ? undefined as T : await result.json() as T; } catch (error) { if (error instanceof DashboardGatewayError) throw error; throw new DashboardGatewayError(0, failureText(0, operation)); } }

export function createFixtureDashboardGateway(_fetcher?: typeof fetch): DashboardGateway {
  const unsupported = async (..._args: unknown[]): Promise<never> => { throw new DashboardGatewayError(0, 'Fixture dashboard gateway is unsupported'); };
  return { mode: 'fixture', summary: unsupported, projectInstances: unsupported, createTask: unsupported, updateTask: unsupported, updateProjectStep: unsupported, taskCollaborators: unsupported, addTaskCollaborator: unsupported, removeTaskCollaborator: unsupported, messageThreads: unsupported, messages: unsupported };
}

export function createLiveDashboardGateway(apiBase: string, token: string | undefined, fetcher: typeof fetch = fetch): DashboardGateway {
  if (!token?.trim()) throw new Error('Live configuration error: an explicit dashboard token is required');
  const request = (path: string, init: RequestInit = {}) => fetcher(`${apiBase}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  const json = (value: unknown) => JSON.stringify(value);
  return {
    mode: 'live',
    // apps/api_server/src/routes/dashboard_routes.ts:9
    summary: () => response<DashboardSummary>('Load dashboard', request('/dashboard/summary')),
    // apps/api_server/src/routes/project_instances_routes.ts:10
    projectInstances: () => response<ProjectInstance[]>('Load project instances', request('/project-instances')),
    // apps/api_server/src/routes/tasks_routes.ts:11-12
    createTask: (input) => response<Task>('Create task', request('/tasks', { method: 'POST', body: json(input) })),
    updateTask: (id, input) => response<Task>('Update task', request(`/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: json(input) })),
    // apps/api_server/src/routes/project_instances_routes.ts:13
    updateProjectStep: (stepId, input) => response<ProjectInstanceStep>('Update project step', request(`/project-instances/steps/${encodeURIComponent(stepId)}`, { method: 'PATCH', body: json(input) })),
    // apps/api_server/src/routes/tasks_routes.ts:14-16
    taskCollaborators: (taskId) => response<TaskCollaborator[]>('Load task collaborators', request(`/tasks/${encodeURIComponent(taskId)}/collaborators`)),
    addTaskCollaborator: (taskId, userId) => response<TaskCollaborator[]>('Add task collaborator', request(`/tasks/${encodeURIComponent(taskId)}/collaborators`, { method: 'POST', body: json({ userId }) })),
    removeTaskCollaborator: (taskId, userId) => response<void>('Remove task collaborator', request(`/tasks/${encodeURIComponent(taskId)}/collaborators/${encodeURIComponent(userId)}`, { method: 'DELETE' })),
    // Mounted at /message-threads in apps/api_server/src/app.ts:145; declared in apps/api_server/src/routes/messages_routes.ts:9,11.
    messageThreads: (taskId) => response<MessageThread[]>('Load message threads', request(`/message-threads${taskId ? `?task_id=${encodeURIComponent(taskId)}` : ''}`)),
    messages: (threadId) => response<Message[]>('Load messages', request(`/message-threads/${encodeURIComponent(threadId)}/messages`)),
  };
}
