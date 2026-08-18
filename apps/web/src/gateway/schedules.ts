import type { GatewayMode } from '.';

// Canonical persisted scheduled task — apps/api_server/src/repositories/agent_scheduled_tasks_repository.ts:5-31.
export interface ScheduledTask {
  id: string;
  name: string;
  description: string | null;
  scheduleType: string;
  scheduledTime: string | null;
  scheduledDay: number | null;
  cronExpression: string | null;
  runAt: string | null;
  timezone: string;
  nextRunAt: string | null;
  prompt: string;
  agentKind: string;
  agentConfigId: string | null;
  modelProvider: string | null;
  modelId: string | null;
  allowedMcpsJson: string | null;
  allowedSkillsJson: string | null;
  enabled: boolean;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastError: string | null;
  createdByUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

// apps/api_server/src/repositories/agent_scheduled_tasks_repository.ts:33-51.
export interface ScheduledTaskInput {
  name: string;
  description?: string;
  scheduleType: string;
  scheduledTime?: string;
  scheduledDay?: number;
  cronExpression?: string;
  runAt?: string;
  timezone?: string;
  prompt: string;
  agentKind?: string;
  agentConfigId?: string | null;
  modelProvider?: string | null;
  modelId?: string | null;
  allowedMcpsJson?: string;
  allowedSkillsJson?: string;
  enabled?: boolean;
}

// Durable per-attempt run row — apps/api_server/src/repositories/agent_scheduled_task_runs_repository.ts:15-33.
export interface ScheduledTaskRun {
  id: string;
  taskId: string;
  startedAt: string;
  endedAt: string | null;
  status: string;
  error: string | null;
  rootSessionId: string | null;
  createdAt: string;
}

// Minimal owned-session shape needed to navigate a run's rootSessionId —
// apps/api_server/src/routes/agent_sessions_routes.ts:66 (GET /:id → controller.getOne).
export interface OwnedSession { id: string; ownerUserId: number | null; status: string }

export interface ScheduleGateway {
  readonly mode: GatewayMode;
  // GET /agent-schedules — apps/api_server/src/routes/agentSchedulesRoutes.ts:11.
  list(): Promise<ScheduledTask[]>;
  // POST /agent-schedules — apps/api_server/src/routes/agentSchedulesRoutes.ts:14.
  create(input: ScheduledTaskInput): Promise<ScheduledTask>;
  // PATCH /agent-schedules/:id — apps/api_server/src/routes/agentSchedulesRoutes.ts:15.
  update(id: string, patch: Partial<ScheduledTaskInput>): Promise<ScheduledTask>;
  // DELETE /agent-schedules/:id — apps/api_server/src/routes/agentSchedulesRoutes.ts:16.
  remove(id: string): Promise<void>;
  // POST /agent-schedules/:id/trigger-now — apps/api_server/src/routes/agentSchedulesRoutes.ts:17.
  triggerNow(id: string): Promise<ScheduledTask>;
  // GET /agent-schedules/:id/runs — apps/api_server/src/routes/agentSchedulesRoutes.ts:13.
  runs(id: string): Promise<ScheduledTaskRun[]>;
  // GET /agent-sessions/:id — the owned root session a durable run row points at.
  rootSession(id: string): Promise<OwnedSession>;
}

export class ScheduleGatewayError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const failureText = (status: number, operation: string) =>
  ({ 0: 'Schedule service unavailable', 401: 'Authentication required', 403: 'Forbidden', 404: 'Scheduled task not found' }[status] ?? `${operation} failed (${status})`);

async function response<T>(operation: string, pending: Promise<Response>): Promise<T> {
  try {
    const result = await pending;
    if (!result.ok) throw new ScheduleGatewayError(result.status, failureText(result.status, operation));
    return result.status === 204 ? undefined as T : await result.json() as T;
  } catch (error) {
    if (error instanceof ScheduleGatewayError) throw error;
    throw new ScheduleGatewayError(0, failureText(0, operation));
  }
}

export function createFixtureScheduleGateway(): ScheduleGateway {
  const unsupported = async (): Promise<never> => { throw new ScheduleGatewayError(0, 'Fixture schedule gateway is unsupported'); };
  return { mode: 'fixture', list: unsupported, create: unsupported, update: unsupported, remove: unsupported, triggerNow: unsupported, runs: unsupported, rootSession: unsupported };
}

export function createLiveScheduleGateway(apiBase: string, token: string | undefined, fetcher: typeof fetch = fetch): ScheduleGateway {
  if (!token?.trim()) throw new Error('Live configuration error: a schedules token is required');
  const request = (path: string, init: RequestInit = {}) =>
    fetcher(`${apiBase}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  return {
    mode: 'live',
    list: () => response<ScheduledTask[]>('Load scheduled tasks', request('/agent-schedules')),
    create: (input) => response<ScheduledTask>('Create scheduled task', request('/agent-schedules', { method: 'POST', body: JSON.stringify(input) })),
    update: (id, patch) => response<ScheduledTask>('Update scheduled task', request(`/agent-schedules/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) })),
    remove: (id) => response<void>('Delete scheduled task', request(`/agent-schedules/${encodeURIComponent(id)}`, { method: 'DELETE' })),
    triggerNow: (id) => response<ScheduledTask>('Trigger scheduled task', request(`/agent-schedules/${encodeURIComponent(id)}/trigger-now`, { method: 'POST' })),
    runs: (id) => response<ScheduledTaskRun[]>('Load scheduled task runs', request(`/agent-schedules/${encodeURIComponent(id)}/runs`)),
    // apps/api_server/src/controllers/agent_sessions_controller.ts:594-623 responds
    // {session, messages}; unwrap defensively so the owned-navigation contract only
    // ever needs the session's own id/ownerUserId/status.
    rootSession: async (id) => {
      const body = await response<{ session?: OwnedSession } & Partial<OwnedSession>>('Load root session', request(`/agent-sessions/${encodeURIComponent(id)}`));
      return (body.session ?? body) as OwnedSession;
    },
  };
}
