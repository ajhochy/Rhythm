import type { PairedMacClient } from '@/lib/transport/paired-mac-client';

export type MobileWorkstreamState =
  | 'ready' | 'queued' | 'running' | 'blocked' | 'paused' | 'cancelled' | 'completed' | 'unknown';

export type MobileWorkstreamReference = {
  sourceId: string;
  expectedVersion: string;
  scope: string;
  provenance: 'trusted_reference' | 'user_reference';
};

export type MobileWorkstreamCheckpoint = {
  version: 1;
  criteria: Array<{
    id: string;
    status: 'pending' | 'blocked' | 'verified' | 'waived';
    receiptId?: string;
  }>;
  references: MobileWorkstreamReference[];
  nextAction: { kind: 'review' | 'clarify'; scope: string };
};

export type MobileWorkstream = {
  id: string;
  ownerUserId: number;
  projectId: string;
  goal: string;
  constraints: string;
  criteria: string;
  checkpoint: MobileWorkstreamCheckpoint;
  state: MobileWorkstreamState;
  stateReason: string | null;
  closedReason: 'user_paused' | 'user_cancelled' | null;
  executorEpoch: string | null;
  lastJobId: string | null;
  revision: number;
  createKey: string;
  createdAt: string;
  updatedAt: string;
};

export type MobileWorkstreamReadiness = {
  available: boolean;
  reason: string | null;
  hostEpoch: string | null;
  engine: { version: string; pid: number; bootId: string } | null;
};

export type MobileWorkstreamJob = {
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
  policy: MobileWorkstreamRunPolicy | null;
  estimate: Record<string, unknown> | null;
  usage: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  application: Record<string, unknown> | null;
};

export type MobileWorkstreamStatus = {
  workstream: MobileWorkstream;
  readiness: MobileWorkstreamReadiness;
  jobs: MobileWorkstreamJob[];
  budget: MobileWorkstreamBudget;
};

export type MobileWorkstreamBudget = {
  authorizedTokens: number | null;
  actualTokens: number;
  acknowledgedEstimateTokens: number;
  reservedTokens: number;
  committedTokens: number;
  remainingTokens: number | null;
  overshoot: boolean;
  unknownJobIds: string[];
  holdReason: 'budget_overshoot' | 'budget_usage_unknown' | 'budget_exhausted' | null;
};

export type MobileWorkstreamEvidence = {
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
};

export type MobileWorkstreamRunPolicy = {
  maxTurns: 1;
  maxWallTimeSeconds: number;
  maxTokens: number;
  queueDeadlineAt: string | null;
};

export type MobileWorkstreamCreate = {
  projectId: string;
  goal: string;
  constraints: string;
  criteria: string;
  checkpoint: MobileWorkstreamCheckpoint;
  createKey: string;
};

export type MobileWorkstreamPatch = {
  expectedRevision: number;
  goal?: string;
  constraints?: string;
  criteria?: string;
  checkpoint?: MobileWorkstreamCheckpoint;
};

export type MobileWorkstreamRun = {
  expectedRevision: number;
  commandKey: string;
  targetProfileId: string;
  parentSessionId: string;
  policy: MobileWorkstreamRunPolicy;
  references: MobileWorkstreamReference[];
};

function projectHeaders(projectId: string, json = false): Record<string, string> {
  const normalized = projectId.trim();
  if (!normalized) throw new Error('Choose a registered Rhythm project before using workstreams.');
  return {
    'X-Rhythm-Project-ID': normalized,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

function path(workstreamId: string, suffix = ''): string {
  return `/mobile-gateway/workstreams/${encodeURIComponent(workstreamId)}${suffix}`;
}

/** The mobile client projects the desktop coordinator; it owns no queue or worker state. */
export async function listMobileGatewayWorkstreams(
  client: PairedMacClient,
  projectId: string,
): Promise<{ items: MobileWorkstreamStatus[]; nextCursor: string | null }> {
  return client.request('/mobile-gateway/workstreams?limit=50', {
    method: 'GET',
    headers: projectHeaders(projectId),
  });
}

export function getMobileGatewayWorkstream(
  client: PairedMacClient,
  projectId: string,
  workstreamId: string,
): Promise<MobileWorkstreamStatus> {
  return client.request(path(workstreamId), {
    method: 'GET',
    headers: projectHeaders(projectId),
  });
}

export function createMobileGatewayWorkstream(
  client: PairedMacClient,
  projectId: string,
  input: MobileWorkstreamCreate,
): Promise<MobileWorkstream> {
  return client.request('/mobile-gateway/workstreams', {
    method: 'POST',
    headers: projectHeaders(projectId, true),
    body: JSON.stringify(input),
  });
}

export function reviseMobileGatewayWorkstream(
  client: PairedMacClient,
  projectId: string,
  workstreamId: string,
  input: MobileWorkstreamPatch,
): Promise<MobileWorkstream> {
  return client.request(path(workstreamId), {
    method: 'PATCH',
    headers: projectHeaders(projectId, true),
    body: JSON.stringify(input),
  });
}

export function runMobileGatewayWorkstream(
  client: PairedMacClient,
  projectId: string,
  workstreamId: string,
  input: MobileWorkstreamRun,
): Promise<MobileWorkstreamStatus> {
  return client.request(path(workstreamId, '/run-next'), {
    method: 'POST',
    headers: projectHeaders(projectId, true),
    body: JSON.stringify(input),
  });
}

export function pauseMobileGatewayWorkstream(
  client: PairedMacClient,
  projectId: string,
  workstreamId: string,
  expectedRevision: number,
): Promise<MobileWorkstreamStatus> {
  return client.request(path(workstreamId, '/pause'), {
    method: 'POST',
    headers: projectHeaders(projectId, true),
    body: JSON.stringify({ expectedRevision }),
  });
}

export function resumeMobileGatewayWorkstream(
  client: PairedMacClient,
  projectId: string,
  workstreamId: string,
  expectedRevision: number,
): Promise<MobileWorkstreamStatus> {
  return client.request(path(workstreamId, '/resume'), {
    method: 'POST',
    headers: projectHeaders(projectId, true),
    body: JSON.stringify({ expectedRevision }),
  });
}

export function cancelMobileGatewayWorkstream(
  client: PairedMacClient,
  projectId: string,
  workstreamId: string,
  input: { expectedRevision: number; jobId: string },
): Promise<MobileWorkstreamStatus> {
  return client.request(path(workstreamId, '/cancel'), {
    method: 'POST',
    headers: projectHeaders(projectId, true),
    body: JSON.stringify(input),
  });
}

export function acknowledgeMobileGatewayWorkstreamUsage(
  client: PairedMacClient,
  projectId: string,
  workstreamId: string,
  input: { expectedRevision: number; jobId: string; accept: boolean },
): Promise<MobileWorkstreamStatus> {
  return client.request(path(workstreamId, '/usage-acknowledgement'), {
    method: 'POST',
    headers: projectHeaders(projectId, true),
    body: JSON.stringify(input),
  });
}

export function reconcileMobileGatewayWorkstreamUnknown(
  client: PairedMacClient,
  projectId: string,
  workstreamId: string,
  input: { expectedRevision: number; jobId: string },
): Promise<MobileWorkstreamStatus> {
  return client.request(path(workstreamId, '/reconcile-unknown'), {
    method: 'POST',
    headers: projectHeaders(projectId, true),
    body: JSON.stringify(input),
  });
}

export function waiveMobileGatewayWorkstreamCriterion(
  client: PairedMacClient,
  projectId: string,
  workstreamId: string,
  input: { expectedRevision: number; jobId: string; criterionId: string },
): Promise<MobileWorkstreamStatus> {
  return client.request(path(workstreamId, '/criteria/waive'), {
    method: 'POST',
    headers: projectHeaders(projectId, true),
    body: JSON.stringify(input),
  });
}

export function waiveMobileGatewayWorkstreamCriteria(
  client: PairedMacClient,
  projectId: string,
  workstreamId: string,
  input: { expectedRevision: number; jobId: string; criterionIds: string[] },
): Promise<MobileWorkstreamStatus> {
  return client.request(path(workstreamId, '/criteria/waive-batch'), {
    method: 'POST',
    headers: projectHeaders(projectId, true),
    body: JSON.stringify(input),
  });
}

export function inspectMobileGatewayWorkstreamEvidence(
  client: PairedMacClient,
  projectId: string,
  workstreamId: string,
  sourceId: string,
): Promise<MobileWorkstreamEvidence> {
  return client.request(`${path(workstreamId, '/evidence')}?sourceId=${encodeURIComponent(sourceId)}`, {
    method: 'GET',
    headers: projectHeaders(projectId),
  });
}

export function verifyMobileGatewayWorkstreamCriteria(
  client: PairedMacClient,
  projectId: string,
  workstreamId: string,
  input: { expectedRevision: number; jobId: string; sourceId: string; criterionIds: string[] },
): Promise<MobileWorkstreamStatus> {
  return client.request(path(workstreamId, '/criteria/verify'), {
    method: 'POST',
    headers: projectHeaders(projectId, true),
    body: JSON.stringify(input),
  });
}
