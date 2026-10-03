import type { GatewayMode } from '.';

export type WorkstreamState =
  | 'ready' | 'queued' | 'running' | 'blocked' | 'paused' | 'cancelled' | 'completed' | 'unknown';

export interface WorkstreamReference {
  sourceId: string;
  expectedVersion: string;
  scope: string;
  provenance: 'trusted_reference' | 'user_reference';
}

export interface WorkstreamCheckpoint {
  version: 1;
  criteria: Array<{ id: string; status: 'pending' | 'blocked' | 'verified' | 'waived'; receiptId?: string }>;
  references: WorkstreamReference[];
  nextAction: { kind: 'review' | 'clarify'; scope: string };
}

export interface Workstream {
  id: string;
  ownerUserId: number;
  projectId: string;
  goal: string;
  constraints: string;
  criteria: string;
  checkpoint: WorkstreamCheckpoint;
  state: WorkstreamState;
  stateReason: string | null;
  closedReason: 'user_paused' | 'user_cancelled' | null;
  executorEpoch: string | null;
  lastJobId: string | null;
  revision: number;
  createKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkstreamReadiness {
  available: boolean;
  reason: string | null;
  hostEpoch: string | null;
  engine: { version: string; pid: number; bootId: string } | null;
}

export interface WorkstreamJob {
  id: string;
  commandKey: string;
  state: 'queued' | 'claimed' | 'running' | 'unknown' | 'succeeded' | 'failed' | 'cancelled';
  stateReason: string | null;
  createdAt: string;
  startedAt: string | null;
  lastProgressAt: string | null;
  terminalAt: string | null;
  cancellationRequestedAt: string | null;
  workerSessionId: string | null;
  targetProfileId: string | null;
  requestedProviderId: string | null;
  requestedModelId: string | null;
  policy: WorkstreamRunPolicy | null;
  estimate: Record<string, unknown> | null;
  usage: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  application: Record<string, unknown> | null;
}

export interface WorkstreamStatus {
  workstream: Workstream;
  readiness: WorkstreamReadiness;
  jobs: WorkstreamJob[];
  budget: WorkstreamBudget;
}

export interface WorkstreamBudget {
  authorizedTokens: number | null;
  actualTokens: number;
  acknowledgedEstimateTokens: number;
  reservedTokens: number;
  committedTokens: number;
  remainingTokens: number | null;
  overshoot: boolean;
  unknownJobIds: string[];
  holdReason: 'budget_overshoot' | 'budget_usage_unknown' | 'budget_exhausted' | null;
}

export interface WorkstreamEvidence {
  selector: string;
  available: boolean;
  eligible: boolean;
  reason: string | null;
  canonicalId: string | null;
  observedVersion: string | null;
  observedHash: string | null;
  sourceNamespace: string | null;
  sourceInstance: string | null;
  evidenceState: 'preexisting' | null;
}

export interface WorkstreamRunPolicy {
  maxTurns: 1;
  maxWallTimeSeconds: number;
  maxTokens: number;
  queueDeadlineAt: string | null;
}

export interface WorkstreamRunInput {
  expectedRevision: number;
  commandKey: string;
  targetProfileId: string;
  parentSessionId: string;
  policy: WorkstreamRunPolicy;
  references: WorkstreamReference[];
}

export interface WorkstreamCreateInput {
  projectId: string;
  goal: string;
  constraints: string;
  criteria: string;
  checkpoint: WorkstreamCheckpoint;
  createKey: string;
}

export interface WorkstreamPatchInput {
  expectedRevision: number;
  goal?: string;
  constraints?: string;
  criteria?: string;
  checkpoint?: WorkstreamCheckpoint;
}

export interface WorkstreamGateway {
  readonly mode: GatewayMode;
  list(projectId: string, cursor?: string): Promise<{ items: WorkstreamStatus[]; nextCursor: string | null }>;
  get(projectId: string, workstreamId: string): Promise<WorkstreamStatus>;
  create(projectId: string, input: WorkstreamCreateInput): Promise<Workstream>;
  revise(projectId: string, workstreamId: string, input: WorkstreamPatchInput): Promise<Workstream>;
  runNext(projectId: string, workstreamId: string, input: WorkstreamRunInput): Promise<WorkstreamStatus>;
  pause(projectId: string, workstreamId: string, expectedRevision: number): Promise<WorkstreamStatus>;
  resume(projectId: string, workstreamId: string, expectedRevision: number): Promise<WorkstreamStatus>;
  cancel(projectId: string, workstreamId: string, input: { expectedRevision: number; jobId: string }): Promise<WorkstreamStatus>;
  acknowledgeUsage(projectId: string, workstreamId: string, input: { expectedRevision: number; jobId: string; accept: boolean }): Promise<WorkstreamStatus>;
  reconcileUnknown(projectId: string, workstreamId: string, input: { expectedRevision: number; jobId: string }): Promise<WorkstreamStatus>;
  waiveCriterion(projectId: string, workstreamId: string, input: { expectedRevision: number; jobId: string; criterionId: string }): Promise<WorkstreamStatus>;
  waiveCriteria(projectId: string, workstreamId: string, input: { expectedRevision: number; jobId: string; criterionIds: string[] }): Promise<WorkstreamStatus>;
  inspectEvidence(projectId: string, workstreamId: string, sourceId: string): Promise<WorkstreamEvidence>;
  verifyCriteria(projectId: string, workstreamId: string, input: { expectedRevision: number; jobId: string; sourceId: string; criterionIds: string[] }): Promise<WorkstreamStatus>;
}

export class WorkstreamsGatewayError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const failureText = (status: number, operation: string): string => {
  const known: Record<number, string> = {
    0: 'Workstream service is unavailable. Check the local Rhythm connection and retry.',
    401: 'Workstream authentication is required. Sign in again and retry.',
    403: 'This workstream belongs to a different project or account.',
    404: 'Workstream coordination is unavailable or the selected workstream no longer exists.',
    409: 'The workstream changed. Refresh it before taking another action.',
  };
  return known[status] ?? `${operation} failed (${status})`;
};

async function response<T>(operation: string, pending: Promise<Response>): Promise<T> {
  try {
    const result = await pending;
    if (!result.ok) throw new WorkstreamsGatewayError(result.status, failureText(result.status, operation));
    return await result.json() as T;
  } catch (error) {
    if (error instanceof WorkstreamsGatewayError) throw error;
    throw new WorkstreamsGatewayError(0, failureText(0, operation));
  }
}

/**
 * Workstreams deliberately use the authenticated API rather than the local
 * session bypass.  The server derives owner/project authority from that token.
 */
export function createLiveWorkstreamsGateway(
  apiBase: string,
  token: string | undefined,
  fetcher: typeof fetch = fetch,
): WorkstreamGateway {
  if (!token?.trim()) throw new Error('Live configuration error: a workstream token is required');
  const request = (projectId: string, path = '', init: RequestInit = {}) => {
    const query = new URLSearchParams({ projectId });
    return fetcher(`${apiBase}/agent-workstreams${path}?${query}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  };
  return {
    mode: 'live',
    list: (projectId, cursor) => {
      const query = new URLSearchParams({ projectId, limit: '50' });
      if (cursor) query.set('cursor', cursor);
      return response<{ items: WorkstreamStatus[]; nextCursor: string | null }>(
        'Load workstreams',
        fetcher(`${apiBase}/agent-workstreams?${query}`, { headers: { Authorization: `Bearer ${token}` } }),
      );
    },
    get: (projectId, workstreamId) => response<WorkstreamStatus>(
      'Load workstream', request(projectId, `/${encodeURIComponent(workstreamId)}`),
    ),
    create: (projectId, input) => response<Workstream>(
      'Create workstream', request(projectId, '', { method: 'POST', body: JSON.stringify(input) }),
    ),
    revise: (projectId, workstreamId, input) => response<Workstream>(
      'Save workstream', request(projectId, `/${encodeURIComponent(workstreamId)}`, { method: 'PATCH', body: JSON.stringify(input) }),
    ),
    runNext: (projectId, workstreamId, input) => response<WorkstreamStatus>(
      'Run next', request(projectId, `/${encodeURIComponent(workstreamId)}/run-next`, { method: 'POST', body: JSON.stringify(input) }),
    ),
    pause: (projectId, workstreamId, expectedRevision) => response<WorkstreamStatus>(
      'Pause workstream', request(projectId, `/${encodeURIComponent(workstreamId)}/pause`, { method: 'POST', body: JSON.stringify({ expectedRevision }) }),
    ),
    resume: (projectId, workstreamId, expectedRevision) => response<WorkstreamStatus>(
      'Resume workstream', request(projectId, `/${encodeURIComponent(workstreamId)}/resume`, { method: 'POST', body: JSON.stringify({ expectedRevision }) }),
    ),
    cancel: (projectId, workstreamId, input) => response<WorkstreamStatus>(
      'Cancel worker', request(projectId, `/${encodeURIComponent(workstreamId)}/cancel`, { method: 'POST', body: JSON.stringify(input) }),
    ),
    acknowledgeUsage: (projectId, workstreamId, input) => response<WorkstreamStatus>(
      'Acknowledge usage estimate', request(projectId, `/${encodeURIComponent(workstreamId)}/usage-acknowledgement`, { method: 'POST', body: JSON.stringify(input) }),
    ),
    reconcileUnknown: (projectId, workstreamId, input) => response<WorkstreamStatus>(
      'Check authoritative worker status', request(projectId, `/${encodeURIComponent(workstreamId)}/reconcile-unknown`, { method: 'POST', body: JSON.stringify(input) }),
    ),
    waiveCriterion: (projectId, workstreamId, input) => response<WorkstreamStatus>(
      'Waive criterion', request(projectId, `/${encodeURIComponent(workstreamId)}/criteria/waive`, { method: 'POST', body: JSON.stringify(input) }),
    ),
    waiveCriteria: (projectId, workstreamId, input) => response<WorkstreamStatus>(
      'Waive unresolved criteria', request(projectId, `/${encodeURIComponent(workstreamId)}/criteria/waive-batch`, { method: 'POST', body: JSON.stringify(input) }),
    ),
    inspectEvidence: (projectId, workstreamId, sourceId) => {
      const query = new URLSearchParams({ projectId, sourceId });
      return response<WorkstreamEvidence>(
        'Inspect evidence',
        fetcher(`${apiBase}/agent-workstreams/${encodeURIComponent(workstreamId)}/evidence?${query}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      );
    },
    verifyCriteria: (projectId, workstreamId, input) => response<WorkstreamStatus>(
      'Verify criteria from evidence', request(projectId, `/${encodeURIComponent(workstreamId)}/criteria/verify`, { method: 'POST', body: JSON.stringify(input) }),
    ),
  };
}
