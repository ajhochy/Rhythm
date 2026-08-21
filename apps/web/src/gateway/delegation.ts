import type { GatewayMode } from '.';

// apps/api_server/src/controllers/agent_delegation_controller.ts:14-30,55-65
// apps/api_server/src/services/agent_delegation_service.ts:123-193,233-330
// apps/api_server/src/services/async_delegation_status_service.ts:33-55,79-111
export interface DelegationInput {
  callerAgentConfigId?: string | null;
  targetAgentConfigId: string;
  prompt: string;
  callerSessionId: string;
  context?: string | null;
  model?: unknown;
}

export interface DelegationResult { sessionId: string; output: string; targetAgentConfigId: string }
export interface AsyncDelegationResult { sessionId: string; sdkSessionId: string; status: 'dispatched'; message: string; targetAgentConfigId: string }

// Metadata only, deliberately — never child transcript text. See
// async_delegation_status_service.ts's module doc for the security rationale.
export interface DelegationStatus {
  delegationId: string;
  target: string;
  state: string;
  elapsedMs: number;
  durationMs: number | null;
  childState: string | null;
  childSteps: number;
  latestEvent: { tool: string; status: string | null } | null;
  cancellable: boolean;
  error: string | null;
}

export interface DelegationGateway {
  readonly mode: GatewayMode;
  delegate(input: DelegationInput): Promise<DelegationResult>;
  delegateAsync(input: DelegationInput): Promise<AsyncDelegationResult>;
  status(callerSessionId: string): Promise<DelegationStatus[]>;
  cancel(callerSessionId: string, delegationId: string): Promise<DelegationStatus>;
}

export class DelegationGatewayError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const failureText = (status: number): string => {
  const label: Record<number, string> = { 0: 'Delegation service unavailable', 401: 'Authentication required', 403: 'Forbidden', 404: 'Delegation not found' };
  return label[status] ?? `Delegation request failed (${status})`;
};

async function response<T>(pending: Promise<Response>): Promise<T> {
  try {
    const result = await pending;
    if (!result.ok) throw new DelegationGatewayError(result.status, failureText(result.status));
    return result.status === 204 ? undefined as T : await result.json() as T;
  } catch (error) {
    if (error instanceof DelegationGatewayError) throw error;
    throw new DelegationGatewayError(0, failureText(0));
  }
}

export function createFixtureDelegationGateway(): DelegationGateway {
  const unsupported = async (): Promise<never> => { throw new DelegationGatewayError(0, 'Fixture delegation gateway is unsupported'); };
  return { mode: 'fixture', delegate: unsupported, delegateAsync: unsupported, status: unsupported, cancel: unsupported };
}

export function createLiveDelegationGateway(apiBase: string, token: string | undefined, fetcher: typeof fetch = fetch): DelegationGateway {
  if (!token?.trim()) throw new Error('Live configuration error: an explicit live token is required');
  const request = (path: string, init: RequestInit = {}) => fetcher(`${apiBase}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  return {
    mode: 'live',
    delegate: (input) => response<DelegationResult>(request('/agent-delegation/delegate', { method: 'POST', body: JSON.stringify(input) })),
    delegateAsync: (input) => response<AsyncDelegationResult>(request('/agent-delegation/delegate-async', { method: 'POST', body: JSON.stringify(input) })),
    status: (callerSessionId) => response<{ delegations: DelegationStatus[] }>(request(`/agent-delegation/status?callerSessionId=${encodeURIComponent(callerSessionId)}`)).then((body) => body.delegations),
    cancel: (callerSessionId, delegationId) => response<DelegationStatus>(request(`/agent-delegation/${encodeURIComponent(delegationId)}/cancel`, { method: 'POST', body: JSON.stringify({ callerSessionId }) })),
  };
}
