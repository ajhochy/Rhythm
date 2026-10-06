import { Buffer } from 'node:buffer';

import { AppError } from '../errors/app_error';
import type { AgentWorkstreamCheckpoint } from '../models/agent_workstream';

const MAX_CONTROL = 16_000;
const MAX_REFS = 50;
const exactText = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_CONTROL) throw AppError.badRequest(`${name} must be a non-empty bounded string`);
  return value;
};
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function parseCheckpoint(value: unknown, scope: string): AgentWorkstreamCheckpoint {
  if (!plain(value) || Object.keys(value).some((key) => !['version','criteria','references','nextAction'].includes(key)) || value.version !== 1 || !Array.isArray(value.criteria) || !Array.isArray(value.references) || !plain(value.nextAction)) throw AppError.badRequest('checkpoint is invalid');
  if (value.criteria.length > 100 || value.references.length > MAX_REFS) throw AppError.badRequest('checkpoint exceeds bounds');
  const ids = new Set<string>();
  const criteria = value.criteria.map((entry) => {
    if (!plain(entry) || Object.keys(entry).some((key) => key !== 'id' && key !== 'status') || typeof entry.id !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(entry.id) || (entry.status !== 'pending' && entry.status !== 'blocked') || ids.has(entry.id)) throw AppError.badRequest('checkpoint criteria are invalid');
    ids.add(entry.id); return { id: entry.id, status: entry.status as 'pending' | 'blocked' };
  });
  const references = value.references.map((entry) => {
    if (!plain(entry) || Object.keys(entry).some((key) => !['sourceId','expectedVersion','scope','provenance'].includes(key)) || typeof entry.sourceId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(entry.sourceId) || typeof entry.expectedVersion !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(entry.expectedVersion) || entry.scope !== scope || (entry.provenance !== 'trusted_reference' && entry.provenance !== 'user_reference')) throw AppError.badRequest('checkpoint references must be typed and scoped');
    return { sourceId: entry.sourceId, expectedVersion: entry.expectedVersion, scope: entry.scope, provenance: entry.provenance as 'trusted_reference' | 'user_reference' };
  });
  const next = value.nextAction;
  if (Object.keys(next).some((key) => key !== 'kind' && key !== 'scope') || (next.kind !== 'review' && next.kind !== 'clarify') || next.scope !== scope) throw AppError.badRequest('checkpoint nextAction is invalid');
  return { version: 1, criteria, references, nextAction: { kind: next.kind, scope: next.scope } };
}

export function parseCreate(value: unknown) {
  if (!plain(value) || Object.keys(value).some((key) => !['projectId','goal','constraints','criteria','checkpoint','createKey'].includes(key))) throw AppError.badRequest('invalid workstream create payload');
  if (typeof value.projectId !== 'string' || !value.projectId || typeof value.createKey !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value.createKey)) throw AppError.badRequest('projectId and createKey are required');
  return { projectId: value.projectId, goal: exactText(value.goal, 'goal'), constraints: exactText(value.constraints, 'constraints'), criteria: exactText(value.criteria, 'criteria'), checkpoint: parseCheckpoint(value.checkpoint, value.projectId), createKey: value.createKey };
}

export function parseRevision(value: unknown) {
  if (!plain(value) || !Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 1) throw AppError.badRequest('expectedRevision must be a safe integer');
  return value.expectedRevision as number;
}

export function parsePatch(value: unknown) {
  if (!plain(value) || Object.keys(value).some((key) => !['expectedRevision','goal','constraints','criteria','checkpoint'].includes(key))) throw AppError.badRequest('invalid workstream patch payload');
  const expectedRevision = parseRevision(value); const output: Record<string, unknown> = { expectedRevision };
  for (const name of ['goal','constraints','criteria'] as const) if (value[name] !== undefined) output[name] = exactText(value[name], name);
  if (value.checkpoint !== undefined) output.checkpoint = value.checkpoint;
  if (Object.keys(output).length === 1) throw AppError.badRequest('at least one mutable control is required');
  return output as { expectedRevision: number; goal?: string; constraints?: string; criteria?: string; checkpoint?: AgentWorkstreamCheckpoint };
}
export function parsePause(value: unknown): number { if (!plain(value) || Object.keys(value).length !== 1 || !('expectedRevision' in value)) throw AppError.badRequest('invalid pause payload'); return parseRevision(value); }

export interface WorkstreamRunPolicy {
  /** This slice intentionally admits one engine turn per explicit request. */
  maxTurns: 1;
  maxWallTimeSeconds: number;
  /**
   * A soft total-token authorization reconciled to actual input, output,
   * reasoning, and cache usage afterward. It is not an output-token cap.
   */
  maxTokens: number;
  /** Optional queue deadline; absent means no implicit timeout/retry. */
  queueDeadlineAt: string | null;
  /**
   * Internal-only bounded response contract. Public Run-next parsing never
   * accepts this field: C2 adds it only after an authenticated finite outer
   * authority has been durably consumed. Undefined preserves ordinary
   * managed-worker behavior byte-for-byte.
   */
  outputContract?: 'structured_read_only_proposal_v1' | 'coding_workflow_durable_consumer_v1';
}

/**
 * A deliberately small, non-authoritative proposal from a finite read-only
 * worker. It is not worker prose, a completion receipt, a tool grant, or an
 * artifact assertion. The coordinator may only add its pending/blocked
 * criteria to the existing checkpoint after strict terminal accounting.
 */
export interface ManagedWorkstreamStructuredProposal {
  schemaVersion: 1;
  kind: 'workstream_proposal';
  criteria: Array<{ id: string; status: 'pending' | 'blocked' }>;
  nextAction: { kind: 'review' | 'clarify'; scope: string };
}

const MAX_MANAGED_WORKSTREAM_PROPOSAL_BYTES = 12_000;

/**
 * The engine records its own terminal delimiters around assistant text.  They
 * are transport markers, not model-authored content, so accept only the one
 * documented `step-start`, text, `step-finish` envelope (or the legacy exact
 * single-text test shape).  Any other part type, additional text, tool call,
 * reasoning, or prose wrapper remains non-authoritative.
 */
function exactManagedWorkstreamProposalText(parts: unknown): string | null {
  if (!Array.isArray(parts)) return null;
  if (
    parts.length === 1 &&
    plain(parts[0]) && parts[0].type === 'text' && typeof parts[0].text === 'string'
  ) return parts[0].text;
  if (
    parts.length === 3 &&
    plain(parts[0]) && parts[0].type === 'step-start' &&
    plain(parts[1]) && parts[1].type === 'text' && typeof parts[1].text === 'string' &&
    plain(parts[2]) && parts[2].type === 'step-finish'
  ) return parts[1].text;
  return null;
}

/**
 * Parses the one exact JSON response shape requested from a finite C2 worker.
 * This accepts no prose wrapper, references, verified/waived criterion, or
 * caller-selected scope. It returns null rather than throwing because a bad
 * model response is a truthful terminal hold, never a malformed-plan retry.
 */
export function parseManagedWorkstreamStructuredProposal(
  parts: unknown,
  scope: string,
): ManagedWorkstreamStructuredProposal | null {
  const text = exactManagedWorkstreamProposalText(parts);
  if (text === null) return null;
  if (Buffer.byteLength(text, 'utf8') === 0 || Buffer.byteLength(text, 'utf8') > MAX_MANAGED_WORKSTREAM_PROPOSAL_BYTES) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!plain(value) || Object.keys(value).some((key) => !['schemaVersion', 'kind', 'criteria', 'nextAction'].includes(key)) ||
      value.schemaVersion !== 1 || value.kind !== 'workstream_proposal' || !Array.isArray(value.criteria) || !plain(value.nextAction) ||
      value.criteria.length < 1 || value.criteria.length > 20) {
    return null;
  }
  const ids = new Set<string>();
  const criteria: ManagedWorkstreamStructuredProposal['criteria'] = [];
  for (const entry of value.criteria) {
    if (!plain(entry) || Object.keys(entry).some((key) => key !== 'id' && key !== 'status') ||
        typeof entry.id !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(entry.id) ||
        (entry.status !== 'pending' && entry.status !== 'blocked') || ids.has(entry.id)) {
      return null;
    }
    ids.add(entry.id);
    criteria.push({ id: entry.id, status: entry.status });
  }
  const next = value.nextAction;
  if (Object.keys(next).some((key) => key !== 'kind' && key !== 'scope') ||
      (next.kind !== 'review' && next.kind !== 'clarify') || next.scope !== scope) {
    return null;
  }
  return {
    schemaVersion: 1,
    kind: 'workstream_proposal',
    criteria,
    nextAction: { kind: next.kind, scope: next.scope },
  };
}

export interface WorkstreamReferenceInput {
  sourceId: string;
  expectedVersion: string;
  scope: string;
  provenance: 'trusted_reference' | 'user_reference';
}

function parseReferences(value: unknown, scope: string): WorkstreamReferenceInput[] {
  if (!Array.isArray(value) || value.length > MAX_REFS) throw AppError.badRequest('references are invalid');
  return value.map((entry) => {
    if (!plain(entry) || Object.keys(entry).some((key) => !['sourceId', 'expectedVersion', 'scope', 'provenance'].includes(key)) ||
      typeof entry.sourceId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(entry.sourceId) ||
      typeof entry.expectedVersion !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(entry.expectedVersion) ||
      entry.scope !== scope ||
      (entry.provenance !== 'trusted_reference' && entry.provenance !== 'user_reference')) {
      throw AppError.badRequest('references must be typed and scoped');
    }
    return {
      sourceId: entry.sourceId,
      expectedVersion: entry.expectedVersion,
      scope: entry.scope,
      provenance: entry.provenance,
    } as WorkstreamReferenceInput;
  });
}

function parseIsoOrNull(value: unknown, name: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw AppError.badRequest(`${name} must be an ISO instant or null`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw AppError.badRequest(`${name} must be an ISO instant or null`);
  }
  return value;
}

/** Exact, body-free explicit Run next request. */
export function parseRunNext(value: unknown) {
  if (!plain(value) || Object.keys(value).some((key) => ![
    'expectedRevision', 'commandKey', 'targetProfileId', 'parentSessionId', 'policy', 'references',
    'softTokenBudgetAcknowledged',
  ].includes(key))) throw AppError.badRequest('invalid workstream run payload');
  const expectedRevision = parseRevision(value);
  if (typeof value.commandKey !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value.commandKey) ||
      typeof value.targetProfileId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value.targetProfileId) ||
      // Desktop sends the durable local UUID; the paired mobile client has the
      // selected SDK id.  Both are only opaque lookup handles: the server
      // resolves either one back to the authenticated root session before it
      // can create a worker.
      typeof value.parentSessionId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value.parentSessionId) ||
      value.softTokenBudgetAcknowledged !== true ||
      !plain(value.policy) || Object.keys(value.policy).some((key) => !['maxTurns', 'maxWallTimeSeconds', 'maxTokens', 'queueDeadlineAt'].includes(key))) {
    throw AppError.badRequest('invalid workstream run payload');
  }
  const policy = value.policy as Record<string, unknown>;
  if (policy.maxTurns !== 1 || !Number.isSafeInteger(policy.maxWallTimeSeconds) ||
      (policy.maxWallTimeSeconds as number) < 30 || (policy.maxWallTimeSeconds as number) > 3_600 ||
      !Number.isSafeInteger(policy.maxTokens) || (policy.maxTokens as number) < 1 || (policy.maxTokens as number) > 2_000_000) {
    throw AppError.badRequest('run policy is outside the bounded read-only limits');
  }
  return {
    expectedRevision,
    commandKey: value.commandKey,
    targetProfileId: value.targetProfileId,
    parentSessionId: value.parentSessionId,
    // The authenticated route owns the actor and timestamp recorded with this
    // explicit acknowledgement. Callers cannot substitute a receipt later.
    softTokenBudgetAcknowledged: true as const,
    policy: {
      maxTurns: 1 as const,
      maxWallTimeSeconds: policy.maxWallTimeSeconds as number,
      maxTokens: policy.maxTokens as number,
      queueDeadlineAt: parseIsoOrNull(policy.queueDeadlineAt, 'queueDeadlineAt'),
    } satisfies WorkstreamRunPolicy,
    // Scope is resolved from the authenticated route, never from the caller.
    references: value.references,
  };
}

/** Resolve the project-scoped reference validation after the controller has the scope. */
export function parseRunNextForProject(value: unknown, projectId: string) {
  const parsed = parseRunNext(value);
  return { ...parsed, references: parseReferences(parsed.references ?? [], projectId) };
}

export function parseResume(value: unknown): number {
  if (!plain(value) || Object.keys(value).length !== 1 || !('expectedRevision' in value)) {
    throw AppError.badRequest('invalid resume payload');
  }
  return parseRevision(value);
}

export function parseCancel(value: unknown): { expectedRevision: number; jobId: string } {
  if (!plain(value) || Object.keys(value).some((key) => key !== 'expectedRevision' && key !== 'jobId') ||
      typeof value.jobId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.jobId)) {
    throw AppError.badRequest('invalid cancel payload');
  }
  return { expectedRevision: parseRevision(value), jobId: value.jobId };
}

export function parseUsageAcknowledgement(value: unknown): { expectedRevision: number; jobId: string; accept: boolean } {
  if (!plain(value) || Object.keys(value).some((key) => !['expectedRevision', 'jobId', 'accept'].includes(key)) || typeof value.accept !== 'boolean') {
    throw AppError.badRequest('invalid usage acknowledgement payload');
  }
  const expectedRevision = parseRevision(value);
  if (typeof value.jobId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.jobId)) {
    throw AppError.badRequest('invalid usage acknowledgement payload');
  }
  return { expectedRevision, jobId: value.jobId, accept: value.accept };
}

/** An authenticated user may waive one unresolved criterion; worker output never can. */
export function parseCriterionWaiver(value: unknown): { expectedRevision: number; jobId: string; criterionId: string } {
  if (!plain(value) || Object.keys(value).some((key) => !['expectedRevision', 'jobId', 'criterionId'].includes(key)) ||
      typeof value.jobId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.jobId) ||
      typeof value.criterionId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value.criterionId)) {
    throw AppError.badRequest('invalid criterion waiver payload');
  }
  return { expectedRevision: parseRevision(value), jobId: value.jobId, criterionId: value.criterionId };
}

function parseCriterionIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw AppError.badRequest('criterionIds must contain 1..100 criteria');
  }
  const ids = value.map((item) => {
    if (typeof item !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(item)) {
      throw AppError.badRequest('criterionIds are invalid');
    }
    return item;
  });
  if (new Set(ids).size !== ids.length) throw AppError.badRequest('criterionIds must be unique');
  return ids;
}

export function parseCriteriaBatch(value: unknown): {
  expectedRevision: number;
  jobId: string;
  criterionIds: string[];
} {
  if (!plain(value) || Object.keys(value).some((key) =>
    !['expectedRevision', 'jobId', 'criterionIds'].includes(key)) ||
      typeof value.jobId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.jobId)) {
    throw AppError.badRequest('invalid criteria batch payload');
  }
  return {
    expectedRevision: parseRevision(value),
    jobId: value.jobId,
    criterionIds: parseCriterionIds(value.criterionIds),
  };
}

export function parseEvidenceVerification(value: unknown): {
  expectedRevision: number;
  jobId: string;
  sourceId: string;
  criterionIds: string[];
} {
  if (!plain(value) || Object.keys(value).some((key) =>
    !['expectedRevision', 'jobId', 'sourceId', 'criterionIds'].includes(key)) ||
      typeof value.sourceId !== 'string' ||
      !/^[A-Za-z0-9._:-]{1,128}$/.test(value.sourceId)) {
    throw AppError.badRequest('invalid evidence verification payload');
  }
  const batch = parseCriteriaBatch({
    expectedRevision: value.expectedRevision,
    jobId: value.jobId,
    criterionIds: value.criterionIds,
  });
  return { ...batch, sourceId: value.sourceId };
}

export function parseEvidenceSelector(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    throw AppError.badRequest('invalid evidence selector');
  }
  return value;
}
