import { createHash } from 'node:crypto';

export const NATIVE_WORKSTREAM_JOB_SCHEMA_VERSION = 1 as const;
export const NATIVE_WORKSTREAM_JOB_DIRECTION = 'rhythm_to_native' as const;
export const NATIVE_WORKSTREAM_JOB_REASON_CODES = [
  'native_status_unknown',
  'native_queue_deadline_exceeded',
  'cancelled_after_unknown',
] as const;
export type NativeWorkstreamJobReason = typeof NATIVE_WORKSTREAM_JOB_REASON_CODES[number];

export const NATIVE_WORKSTREAM_JOB_COLUMNS = [
  'workstream_id',
  'workstream_project_id',
  'workstream_revision',
  'host_epoch',
  'native_queue_deadline_at',
] as const;

export const NATIVE_WORKSTREAM_JOB_INDEXES = [
  'idx_agent_bridge_jobs_claim',
  'idx_agent_bridge_jobs_parent',
  'ux_agent_bridge_jobs_legacy_command',
  'ux_agent_bridge_jobs_native_command',
] as const;

export const NATIVE_WORKSTREAM_JOB_TRIGGERS = [
  'agent_bridge_jobs_terminal_immutable',
  'agent_bridge_jobs_unknown_exit',
] as const;

export interface NativeWorkstreamParentBinding {
  runtimeInstance: string;
  sessionId: string;
  agentId: string;
  projectionId: string | null;
}

export interface NativeWorkstreamJobCreate {
  id?: string;
  localUserId: number;
  workstreamId: string;
  projectId: string;
  capturedRevision: number;
  hostEpoch: string;
  commandKey: string;
  targetAgentId: string;
  targetRevision: number;
  parent: NativeWorkstreamParentBinding;
  queueDeadlineAt?: string | null;
  now: string;
}

export interface NativeTerminationReceipt {
  schema: 'rhythm.native-termination.v1';
  receiptId: string;
  jobId: string;
  hostEpoch: string;
  outcome: 'uncertain' | 'confirmed_terminated_without_execution';
  observedAt: string;
}

export class NativeWorkstreamJobContractError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'NativeWorkstreamJobContractError';
  }
}

const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function isSafeReference(value: unknown): value is string {
  return typeof value === 'string' && SAFE_REFERENCE.test(value);
}

function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function isIsoInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

export function validateNativeWorkstreamJobCreate(value: unknown): NativeWorkstreamJobCreate {
  if (!isRecord(value) || !hasExactKeys(value, [
    'localUserId',
    'workstreamId',
    'projectId',
    'capturedRevision',
    'hostEpoch',
    'commandKey',
    'targetAgentId',
    'targetRevision',
    'parent',
    'now',
  ], ['id', 'queueDeadlineAt'])) {
    throw new NativeWorkstreamJobContractError('native_job_invalid');
  }
  if (!Number.isSafeInteger(value.localUserId) || (value.localUserId as number) <= 0
      || typeof value.workstreamId !== 'string'
      || !UUID.test(value.workstreamId)
      || !isSafeReference(value.projectId)
      || !isRevision(value.capturedRevision)
      || !isSafeReference(value.hostEpoch)
      || !isSafeReference(value.commandKey)
      || !isSafeReference(value.targetAgentId)
      || !isRevision(value.targetRevision)
      || !isIsoInstant(value.now)
      || (value.id !== undefined && (typeof value.id !== 'string' || !UUID.test(value.id)))) {
    throw new NativeWorkstreamJobContractError('native_job_invalid');
  }
  if (!isRecord(value.parent) || !hasExactKeys(value.parent, [
    'runtimeInstance', 'sessionId', 'agentId', 'projectionId',
  ]) || !isSafeReference(value.parent.runtimeInstance)
      || !isSafeReference(value.parent.sessionId)
      || !isSafeReference(value.parent.agentId)
      || (value.parent.projectionId !== null && !isSafeReference(value.parent.projectionId))) {
    throw new NativeWorkstreamJobContractError('native_job_invalid');
  }
  if (value.queueDeadlineAt !== undefined && value.queueDeadlineAt !== null) {
    if (!isIsoInstant(value.queueDeadlineAt)) {
      throw new NativeWorkstreamJobContractError('native_job_invalid');
    }
  }
  return value as unknown as NativeWorkstreamJobCreate;
}

export function validateNativeWorkstreamJobAdmission(input: NativeWorkstreamJobCreate): void {
  if (input.queueDeadlineAt !== undefined && input.queueDeadlineAt !== null
      && Date.parse(input.queueDeadlineAt) <= Date.parse(input.now)) {
    throw new NativeWorkstreamJobContractError('native_job_invalid');
  }
}

export function validateNativeTerminationReceipt(value: unknown): NativeTerminationReceipt {
  if (!isRecord(value) || !hasExactKeys(value, [
    'schema', 'receiptId', 'jobId', 'hostEpoch', 'outcome', 'observedAt',
  ]) || value.schema !== 'rhythm.native-termination.v1'
      || !isSafeReference(value.receiptId)
      || typeof value.jobId !== 'string'
      || !UUID.test(value.jobId)
      || !isSafeReference(value.hostEpoch)
      || (value.outcome !== 'uncertain' && value.outcome !== 'confirmed_terminated_without_execution')
      || !isIsoInstant(value.observedAt)) {
    throw new NativeWorkstreamJobContractError('native_receipt_invalid');
  }
  return value as unknown as NativeTerminationReceipt;
}

export function nativeWorkstreamIntentSha256(input: NativeWorkstreamJobCreate): string {
  const stableIntent = {
    schema: NATIVE_WORKSTREAM_JOB_SCHEMA_VERSION,
    owner: input.localUserId,
    workstream: input.workstreamId,
    project: input.projectId,
    capturedRevision: input.capturedRevision,
    commandKey: input.commandKey,
    targetAgentId: input.targetAgentId,
    targetRevision: input.targetRevision,
    queueDeadlineAt: input.queueDeadlineAt ?? null,
  };
  return createHash('sha256').update(JSON.stringify(stableIntent)).digest('hex');
}
