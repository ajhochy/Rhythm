import type { AgentSession } from '../models/agent_session';
import {
  NATIVE_WORKSTREAM_JOB_REASON_CODES,
  type NativeWorkstreamJobReason,
} from './native_workstream_job_contract';

export const NATIVE_WORKSTREAM_WAKE_SCHEMA_VERSION = 1 as const;

export type NativeWorkstreamTerminalStatus = 'succeeded' | 'failed' | 'cancelled';
export type NativeWorkstreamWakeReason = NativeWorkstreamJobReason | null | 'unknown_reason';

export interface NativeWorkstreamWakeItem {
  kind: 'native_workstream';
  schemaVersion: typeof NATIVE_WORKSTREAM_WAKE_SCHEMA_VERSION;
  jobId: string;
  workstreamId: string;
  status: NativeWorkstreamTerminalStatus;
  reasonCode: NativeWorkstreamWakeReason;
}

export interface NativeWorkstreamWakeSource {
  id: unknown;
  workstream_id: unknown;
  state: unknown;
  state_reason: unknown;
}

export type NativeWorkstreamWakeProjection =
  | { ok: true; item: NativeWorkstreamWakeItem }
  | {
    ok: false;
    code: 'invalid_job_id' | 'invalid_workstream_id' | 'invalid_terminal_status';
  };

export interface NativeWorkstreamDeliveryScope {
  localUserId: number;
  projectId: string;
  parentSessionId: string;
  hostEpoch: string;
}

export interface NativeWorkstreamDeliveryPolicy {
  enabled(): boolean;
  currentHostEpoch(): string | null;
  isParentContextEligible(
    parent: AgentSession,
    scope: NativeWorkstreamDeliveryScope,
  ): boolean | Promise<boolean>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TERMINAL = new Set<NativeWorkstreamTerminalStatus>([
  'succeeded',
  'failed',
  'cancelled',
]);
const REASONS = new Set<string>(NATIVE_WORKSTREAM_JOB_REASON_CODES);
const REASON_TEXT: Record<Exclude<NativeWorkstreamWakeReason, null>, string> = {
  native_status_unknown: 'The native runtime status became unknown.',
  native_queue_deadline_exceeded:
    'The native queue deadline expired before execution was confirmed.',
  cancelled_after_unknown:
    'Cancellation was confirmed after the native runtime status became unknown.',
  unknown_reason: 'The stored terminal reason was not recognized.',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeReference(value: unknown): value is string {
  return typeof value === 'string' && SAFE_REFERENCE.test(value);
}

export function isNativeWorkstreamDeliveryScope(
  value: unknown,
): value is NativeWorkstreamDeliveryScope {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  if (keys.join(':') !== 'hostEpoch:localUserId:parentSessionId:projectId') {
    return false;
  }
  return Number.isSafeInteger(value.localUserId)
    && (value.localUserId as number) > 0
    && isSafeReference(value.projectId)
    && isSafeReference(value.parentSessionId)
    && isSafeReference(value.hostEpoch);
}

export function projectNativeWorkstreamWake(
  source: NativeWorkstreamWakeSource,
): NativeWorkstreamWakeProjection {
  if (typeof source.id !== 'string' || !UUID.test(source.id)) {
    return { ok: false, code: 'invalid_job_id' };
  }
  if (typeof source.workstream_id !== 'string' || !UUID.test(source.workstream_id)) {
    return { ok: false, code: 'invalid_workstream_id' };
  }
  if (typeof source.state !== 'string'
      || !TERMINAL.has(source.state as NativeWorkstreamTerminalStatus)) {
    return { ok: false, code: 'invalid_terminal_status' };
  }
  const reasonCode: NativeWorkstreamWakeReason = source.state_reason === null
    ? null
    : typeof source.state_reason === 'string' && REASONS.has(source.state_reason)
      ? source.state_reason as NativeWorkstreamJobReason
      : 'unknown_reason';
  return {
    ok: true,
    item: {
      kind: 'native_workstream',
      schemaVersion: NATIVE_WORKSTREAM_WAKE_SCHEMA_VERSION,
      jobId: source.id,
      workstreamId: source.workstream_id,
      status: source.state as NativeWorkstreamTerminalStatus,
      reasonCode,
    },
  };
}

export function renderNativeWorkstreamWake(item: NativeWorkstreamWakeItem): string {
  const reasonText = item.reasonCode === null
    ? 'No server reason was recorded.'
    : REASON_TEXT[item.reasonCode];
  return (
    `- Native workstream ${item.workstreamId} job ${item.jobId} reached ${item.status}.\n` +
    `  reason_code: ${item.reasonCode ?? 'none'}\n` +
    `  ${reasonText} Inspect the current workstream status and trusted references ` +
    'through the qualified resolver before deciding what to do next.'
  );
}
