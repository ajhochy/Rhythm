import type { GatewayMode } from '.';

// Canonical persisted notification row — apps/api_server/src/models/notification.ts:1-10.
export interface DomainNotification {
  id: number;
  recipientUserId: number;
  type: 'task_assigned' | 'collaborator_added' | 'step_completed' | 'step_due' | 'rhythm_step_unlocked';
  entityType: 'task' | 'rhythm' | 'project';
  entityId: string;
  message: string;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationsGateway {
  readonly mode: GatewayMode;
  // GET /notifications requires auth and always binds recipient_user_id to the caller
  // (apps/api_server/src/routes/notifications_routes.ts:11; apps/api_server/src/controllers/notifications_controller.ts:8-14;
  // apps/api_server/src/repositories/notifications_repository.ts:56-67 — unread rows only).
  list(): Promise<DomainNotification[]>;
  markRead(id: number): Promise<void>;
  markAllRead(): Promise<void>;
}

export class NotificationsGatewayError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const failureText = (status: number, operation: string) =>
  ({ 0: 'Notifications service unavailable', 401: 'Authentication required', 403: 'Forbidden' }[status] ?? `${operation} failed (${status})`);

async function response<T>(operation: string, pending: Promise<Response>): Promise<T> {
  try {
    const result = await pending;
    if (!result.ok) throw new NotificationsGatewayError(result.status, failureText(result.status, operation));
    return result.status === 204 ? undefined as T : await result.json() as T;
  } catch (error) {
    if (error instanceof NotificationsGatewayError) throw error;
    throw new NotificationsGatewayError(0, failureText(0, operation));
  }
}

export function createFixtureNotificationsGateway(): NotificationsGateway {
  const unsupported = async (): Promise<never> => { throw new NotificationsGatewayError(0, 'Fixture notifications gateway is unsupported'); };
  return { mode: 'fixture', list: unsupported, markRead: unsupported, markAllRead: unsupported };
}

export function createLiveNotificationsGateway(apiBase: string, token: string | undefined, fetcher: typeof fetch = fetch): NotificationsGateway {
  if (!token?.trim()) throw new Error('Live configuration error: a notifications token is required');
  const request = (path: string, init: RequestInit = {}) =>
    fetcher(`${apiBase}${path}`, { ...init, headers: { Authorization: `Bearer ${token}` } });
  return {
    mode: 'live',
    // Mounted at /notifications in apps/api_server/src/app.ts:157.
    list: () => response<DomainNotification[]>('Load notifications', request('/notifications')),
    markRead: (id) => response<void>('Mark notification read', request(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' })),
    markAllRead: () => response<void>('Mark all notifications read', request('/notifications/read-all', { method: 'POST' })),
  };
}
