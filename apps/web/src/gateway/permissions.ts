import type { GatewayMode } from '.';

// Canonical translated shapes only — never a raw engine literal.
// apps/api_server/src/services/opencode_stream_bridge.ts:359-391 (permission.asked)
// apps/api_server/src/controllers/agent_sessions_controller.ts:1369-1417 (pending-permissions + reply)
// apps/api_server/src/services/opencode_stream_bridge.ts:535-556 (question.asked)
// apps/api_server/src/controllers/agent_sessions_controller.ts:1423-1502 (question reply/reject)
export interface PendingPermission {
  sessionId: string;
  permissionID: string;
  directory: string;
  tool: string;
  patterns: string[];
  title: string;
  createdAt: string;
}

export interface PermissionGateway {
  readonly mode: GatewayMode;
  pending(sessionId: string): Promise<PendingPermission[]>;
  reply(sessionId: string, permissionID: string, reply: 'once' | 'always' | 'reject', message?: string): Promise<void>;
  replyQuestion(sessionId: string, callId: string, answers: string[][]): Promise<void>;
  rejectQuestion(sessionId: string, callId: string): Promise<void>;
}

export class PermissionGatewayError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const failureText = (status: number): string => {
  const label: Record<number, string> = { 0: 'Permission service unavailable', 401: 'Authentication required', 403: 'Forbidden', 404: 'Request not found' };
  return label[status] ?? `Request failed (${status})`;
};

async function response<T>(pending: Promise<Response>): Promise<T> {
  try {
    const result = await pending;
    if (!result.ok) throw new PermissionGatewayError(result.status, failureText(result.status));
    return result.status === 204 ? undefined as T : await result.json() as T;
  } catch (error) {
    if (error instanceof PermissionGatewayError) throw error;
    throw new PermissionGatewayError(0, failureText(0));
  }
}

export function createFixturePermissionGateway(): PermissionGateway {
  const unsupported = async (): Promise<never> => { throw new PermissionGatewayError(0, 'Fixture permission gateway is unsupported'); };
  return { mode: 'fixture', pending: unsupported, reply: unsupported, replyQuestion: unsupported, rejectQuestion: unsupported };
}

export function createLivePermissionGateway(apiBase: string, token: string | undefined, fetcher: typeof fetch = fetch): PermissionGateway {
  if (!token?.trim()) throw new Error('Live configuration error: an explicit live token is required');
  const request = (path: string, init: RequestInit = {}) => fetcher(`${apiBase}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  return {
    mode: 'live',
    pending: (sessionId) => response<PendingPermission[]>(request(`/agent-sessions/${encodeURIComponent(sessionId)}/pending-permissions`)),
    reply: async (sessionId, permissionID, reply, message) => {
      await response<void>(request(`/agent-sessions/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(permissionID)}/reply`, {
        method: 'POST',
        body: JSON.stringify(message ? { reply, message } : { reply }),
      }));
    },
    replyQuestion: async (sessionId, callId, answers) => {
      await response<void>(request(`/agent-sessions/${encodeURIComponent(sessionId)}/question/${encodeURIComponent(callId)}/reply`, {
        method: 'POST',
        body: JSON.stringify({ answers }),
      }));
    },
    rejectQuestion: async (sessionId, callId) => {
      await response<void>(request(`/agent-sessions/${encodeURIComponent(sessionId)}/question/${encodeURIComponent(callId)}/reject`, { method: 'POST' }));
    },
  };
}
