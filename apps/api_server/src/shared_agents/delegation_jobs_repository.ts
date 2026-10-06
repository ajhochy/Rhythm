import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import type Database from 'better-sqlite3';

import { getDb } from '../database/db';
import type { AgentWorkstreamCheckpoint, AgentWorkstreamState } from '../models/agent_workstream';
import {
  NATIVE_WORKSTREAM_JOB_DIRECTION,
  nativeWorkstreamIntentSha256,
  type NativeTerminationReceipt,
  type NativeWorkstreamJobCreate,
  validateNativeTerminationReceipt,
  validateNativeWorkstreamJobAdmission,
  validateNativeWorkstreamJobCreate,
} from './native_workstream_job_contract';
import {
  isNativeWorkstreamDeliveryScope,
  type NativeWorkstreamDeliveryScope,
} from './native_workstream_wake_contract';
import type { CodingWorkflowAuthorization, CodingWorkflowEngineIdentity } from '../contracts/coordinator_conversation_contract';
import type { WorkflowBinding } from '../contracts/dayflow_provider_admission_contract';

export type LegacyAgentBridgeJobDirection = 'rhythm_to_hermes' | 'hermes_to_rhythm';
export type AgentBridgeJobDirection = LegacyAgentBridgeJobDirection | 'rhythm_to_native';
export type AgentBridgeJobState =
  | 'queued' | 'claimed' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
export type AgentBridgeJobDeliveryState = 'pending' | 'waking' | 'delivered';

export interface AgentBridgeJobRow {
  id: string;
  direction: AgentBridgeJobDirection;
  idempotency_key: string;
  request_sha256: string;
  local_user_id: number;
  hermes_profile: 'default' | null;
  parent_runtime: 'opencode' | 'hermes';
  parent_runtime_instance: string;
  parent_session_id: string;
  parent_agent_id: string;
  parent_projection_id: string | null;
  target_agent_id: string;
  target_revision: number;
  target_runtime: 'opencode' | 'hermes';
  child_runtime_instance: string | null;
  child_session_id: string | null;
  depth: number;
  chain_id: string;
  prompt: string;
  context: string | null;
  cwd: string | null;
  state: AgentBridgeJobState;
  state_reason: string | null;
  cancel_requested_at: string | null;
  result_text: string | null;
  result_truncated: number;
  progress_json: string | null;
  lease_token_sha256: string | null;
  lease_expires_at: string | null;
  delivery_state: AgentBridgeJobDeliveryState;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
  terminal_at: string | null;
  workstream_id: string | null;
  workstream_project_id: string | null;
  workstream_revision: number | null;
  host_epoch: string | null;
  native_queue_deadline_at: string | null;
  native_execution_kind: 'coordinator' | 'legacy' | null;
  native_metadata_json: string | null;
  native_dispatch_id: string | null;
  native_sdk_user_message_id: string | null;
  native_usage_json: string | null;
  native_result_json: string | null;
  native_application_json: string | null;
  native_started_at: string | null;
  native_progress_at: string | null;
  native_child_session_id: string | null;
  native_child_sdk_session_id: string | null;
}

export interface AgentBridgeJobInsert {
  id?: string;
  direction: LegacyAgentBridgeJobDirection;
  idempotencyKey: string;
  requestSha256: string;
  localUserId: number;
  hermesProfile: 'default';
  parentRuntime: 'opencode' | 'hermes';
  parentRuntimeInstance: string;
  parentSessionId: string;
  parentAgentId: string;
  parentProjectionId: string | null;
  targetAgentId: string;
  targetRevision: number;
  targetRuntime: 'opencode' | 'hermes';
  depth: number;
  chainId: string;
  prompt: string;
  context: string | null;
  cwd: string | null;
  now: string;
}

export type CoordinatorCriterionApplicationOutcome =
  | 'applied'
  | 'stale'
  | 'already_applied'
  | 'criterion_unavailable';

export interface CoordinatorCriterionApplicationResult {
  outcome: CoordinatorCriterionApplicationOutcome;
  job: AgentBridgeJobRow;
}

export interface CoordinatorCriterionInput {
  criterionId: string;
  criterionStatus: 'verified' | 'waived';
  receiptId: string;
}

/** The durable authorization ledger for one workstream, never a live cost cap. */
export interface CoordinatorBudgetState {
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

export interface CoordinatorEpochCursor {
  createdAt: string;
  id: string;
}

/**
 * Read-only evidence for one legacy async-delegation row at an explicit
 * coordinator admission boundary.  It is deliberately a durable fingerprint,
 * not a replacement lifecycle state: every field is re-read in the claiming
 * transaction before a row can be excluded from host-global occupancy.
 */
export interface LegacyCoordinatorCapacityRow {
  delegationId: string;
  delegationStatus: 'dispatched' | 'waking';
  delegationUpdatedAt: string;
  parentSessionId: string;
  parentBoundSessionId: string | null;
  parentStatus: string | null;
  parentUpdatedAt: string | null;
  childSessionId: string;
  childSdkSessionId: string | null;
  childStatus: string | null;
  childUpdatedAt: string | null;
  childCwd: string | null;
  childParentSessionId: string | null;
}

/** A bounded source snapshot; unavailable schema/evidence is never clearance. */
export interface CoordinatorLegacyCapacitySnapshot {
  available: boolean;
  totalActive: number | null;
  rows: LegacyCoordinatorCapacityRow[];
}

/**
 * The coordinator's status-only proof.  The repository treats it as a hint
 * and revalidates its full durable fingerprint inside atomic admission.
 */
export interface CoordinatorLegacyCapacityAssessment {
  hostEpoch: string;
  engineRuntimeInstance: string;
  qualifiedRows: LegacyCoordinatorCapacityRow[];
}

export interface BridgeJobView {
  jobId: string;
  direction: AgentBridgeJobDirection;
  state: AgentBridgeJobState;
  stateReason: string | null;
  targetAgentId: string;
  targetRevision: number;
  targetRuntime: 'opencode' | 'hermes';
  depth: number;
  createdAt: string;
  updatedAt: string;
  terminalAt: string | null;
  progress: { steps: number; latestKind: string } | null;
  resultAvailable: boolean;
  delivered: boolean;
}

export class BridgeJobError extends Error {
  constructor(public readonly code: string, public readonly statusCode = 409) {
    super(code);
    this.name = 'BridgeJobError';
  }
}

const TERMINAL = new Set<AgentBridgeJobState>(['succeeded', 'failed', 'cancelled']);
const LEASE_MS = 60_000;
const QUEUED_TIMEOUT_MS = 10 * 60_000;
const RESULT_CHARS = 16_384;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const COORDINATOR_BACKGROUND_CAPACITY = 2;
const LEGACY_CAPACITY_SNAPSHOT_LIMIT = 100;
const WORKFLOW_MEMBERSHIP_LIMIT = 48;
/**
 * The Coding Workflow manager's async delegation IS its native coordinator job
 * (one capacity unit, counted on the native side). Excludes exactly the
 * delegations bound by a live workflow job; terminal jobs stop excluding.
 */
const NOT_LIVE_WORKFLOW_DELEGATION = `NOT IN (
  SELECT json_extract(j.native_metadata_json,'$.workflow.prepared.delegation.delegationId')
  FROM agent_bridge_jobs j
  WHERE j.direction='rhythm_to_native' AND j.native_execution_kind='coordinator'
    AND j.state IN ('claimed','running','unknown')
    AND json_extract(j.native_metadata_json,'$.workflow.kind')='coding_workflow'
    AND json_extract(j.native_metadata_json,'$.workflow.prepared.delegation.delegationId') IS NOT NULL)`;

/**
 * Server-private, pre-exposure binding for the fixed Coding Workflow manager.
 * It deliberately contains identities only; the delegated prompt/result never
 * enters the coordinator ledger.
 */
export interface CoordinatorWorkflowPreparedBinding {
  authorization: CodingWorkflowAuthorization;
  workflowBinding: WorkflowBinding;
  owner: {
    ownerUserId: number;
    projectId: string;
    rootSessionId: string;
    rootSdkSessionId: string;
  };
  delegation: {
    delegationId: string;
    managerSessionId: string;
    managerSdkSessionId: string;
    nativeParentSdkSessionId: string;
  };
  dispatch: { dispatchId: string; sdkUserMessageId: string };
  engine: CodingWorkflowEngineIdentity;
}

export interface CoordinatorWorkflowMembership {
  nativeSessionId: string;
  parentNativeSessionId: string;
  nativeUserMessageId: string;
  engineGeneration: string;
  runnerGeneration: string;
  purpose: 'answer' | 'compaction' | 'summary';
  attempt: number;
  requestIdentity: string;
  accountingKind: 'persisted_assistant' | 'unmetered_auxiliary';
  assistantMessageId: string | null;
  parentMessageId: string | null;
}

interface LegacyCoordinatorCapacitySqlRow {
  delegation_id: string;
  delegation_status: 'dispatched' | 'waking';
  delegation_updated_at: string;
  parent_session_id: string;
  parent_bound_session_id: string | null;
  parent_status: string | null;
  parent_updated_at: string | null;
  child_session_id: string;
  child_sdk_session_id: string | null;
  child_status: string | null;
  child_updated_at: string | null;
  child_cwd: string | null;
  child_parent_session_id: string | null;
}

function legacyCapacityRow(row: LegacyCoordinatorCapacitySqlRow): LegacyCoordinatorCapacityRow {
  return {
    delegationId: row.delegation_id,
    delegationStatus: row.delegation_status,
    delegationUpdatedAt: row.delegation_updated_at,
    parentSessionId: row.parent_session_id,
    parentBoundSessionId: row.parent_bound_session_id,
    parentStatus: row.parent_status,
    parentUpdatedAt: row.parent_updated_at,
    childSessionId: row.child_session_id,
    childSdkSessionId: row.child_sdk_session_id,
    childStatus: row.child_status,
    childUpdatedAt: row.child_updated_at,
    childCwd: row.child_cwd,
    childParentSessionId: row.child_parent_session_id,
  };
}

function sameLegacyCapacityRow(
  left: LegacyCoordinatorCapacityRow,
  right: LegacyCoordinatorCapacityRow,
): boolean {
  return left.delegationId === right.delegationId &&
    left.delegationStatus === right.delegationStatus &&
    left.delegationUpdatedAt === right.delegationUpdatedAt &&
    left.parentSessionId === right.parentSessionId &&
    left.parentBoundSessionId === right.parentBoundSessionId &&
    left.parentStatus === right.parentStatus &&
    left.parentUpdatedAt === right.parentUpdatedAt &&
    left.childSessionId === right.childSessionId &&
    left.childSdkSessionId === right.childSdkSessionId &&
    left.childStatus === right.childStatus &&
    left.childUpdatedAt === right.childUpdatedAt &&
    left.childCwd === right.childCwd &&
    left.childParentSessionId === right.childParentSessionId;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function tokenMatches(token: string, expected: string | null): boolean {
  if (!expected) return false;
  const actual = Buffer.from(digest(token), 'hex');
  const wanted = Buffer.from(expected, 'hex');
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

function plusMs(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

function truncateResult(value: string | undefined): { text: string | null; truncated: number } {
  if (value === undefined) return { text: null, truncated: 0 };
  return { text: value.slice(0, RESULT_CHARS), truncated: value.length > RESULT_CHARS ? 1 : 0 };
}

function parseRecord(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function workflowId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function serializedMetadata(value: Record<string, unknown>): string {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text, 'utf8') > 65_536) {
    throw new BridgeJobError('native_metadata_too_large', 400);
  }
  return text;
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function coordinatorPolicyTokens(row: AgentBridgeJobRow): number | null {
  const policy = parseRecord(row.native_metadata_json)?.policy;
  const record = policy && typeof policy === 'object' && !Array.isArray(policy)
    ? policy as Record<string, unknown>
    : null;
  const value = finiteNonNegative(record?.maxTokens);
  return value !== null && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function coordinatorAuthorizationTokens(row: AgentBridgeJobRow): number | null {
  const metadata = parseRecord(row.native_metadata_json);
  const budget = metadata?.budget;
  const record = budget && typeof budget === 'object' && !Array.isArray(budget)
    ? budget as Record<string, unknown>
    : null;
  const value = finiteNonNegative(record?.authorizedTokens);
  if (value !== null && Number.isSafeInteger(value) && value > 0) return value;
  // Compatibility for the first packet implementation.  It is a lower
  // authority than the explicit budget block but preserves already-durable
  // rows without silently increasing their cap.
  return coordinatorPolicyTokens(row);
}

function actualUsageTokens(row: AgentBridgeJobRow): number | null {
  const usage = parseRecord(row.native_usage_json);
  if (usage?.status !== 'actual') return null;
  const total = finiteNonNegative(usage.totalTokens);
  if (total === null || !Number.isSafeInteger(total)) return null;
  // A Coding Workflow job spans the manager, native descendants and callback
  // turns: a partial sum would under-charge, so usage must cover the manager
  // plus every persisted-assistant member session or it is unknown.
  const workflow = parseRecord(row.native_metadata_json)?.workflow;
  if (workflow && typeof workflow === 'object' && !Array.isArray(workflow)) {
    const record = workflow as Record<string, unknown>;
    if (record.kind === 'coding_workflow') {
      const sessions = new Set<string>();
      const prepared = record.prepared as { workflowBinding?: { managerSdkSessionId?: unknown } } | null | undefined;
      if (typeof prepared?.workflowBinding?.managerSdkSessionId === 'string') {
        sessions.add(prepared.workflowBinding.managerSdkSessionId);
      }
      for (const item of Array.isArray(record.membership) ? record.membership : []) {
        const m = item as Record<string, unknown> | null;
        if (m?.accountingKind === 'persisted_assistant' && typeof m.nativeSessionId === 'string') {
          sessions.add(m.nativeSessionId);
        }
      }
      const covered = usage.coveredSessionCount;
      if (typeof covered !== 'number' || !Number.isSafeInteger(covered) || covered < sessions.size) return null;
    }
  }
  return total;
}

function acknowledgedEstimateTokens(row: AgentBridgeJobRow): number | null {
  const acknowledgement = parseRecord(row.native_metadata_json)?.estimateAcknowledgement;
  const record = acknowledgement && typeof acknowledgement === 'object' && !Array.isArray(acknowledgement)
    ? acknowledgement as Record<string, unknown>
    : null;
  if (record?.accepted !== true || record.units !== 'tokens' ||
      typeof record.basis !== 'string' || record.basis.length === 0 ||
      typeof record.uncertainty !== 'string' || record.uncertainty.length === 0 ||
      !Number.isSafeInteger(record.actorUserId) ||
      typeof record.acknowledgedAt !== 'string' || Number.isNaN(Date.parse(record.acknowledgedAt))) {
    return null;
  }
  const charged = finiteNonNegative(record.chargedEstimateTokens);
  const authorized = finiteNonNegative(record.authorizedTokens);
  const remaining = finiteNonNegative(record.remainingAuthorizedTokens);
  if (charged === null || authorized === null || remaining === null ||
      !Number.isSafeInteger(charged) || !Number.isSafeInteger(authorized) ||
      !Number.isSafeInteger(remaining) || charged > authorized || remaining > authorized) {
    return null;
  }
  return charged;
}

function jobRequiresActualUsage(row: AgentBridgeJobRow): boolean {
  if (!row.native_dispatch_id) return false;
  const result = parseRecord(row.native_result_json);
  return row.state === 'unknown' || TERMINAL.has(row.state) || result?.usageStatus === 'unknown';
}

function hasValidCoordinatorPolicy(row: AgentBridgeJobRow): boolean {
  const policy = parseRecord(row.native_metadata_json)?.policy;
  const record = policy && typeof policy === 'object' && !Array.isArray(policy)
    ? policy as Record<string, unknown>
    : null;
  return record?.maxTurns === 1 &&
    Number.isSafeInteger(record.maxTokens) && (record.maxTokens as number) > 0 &&
    Number.isSafeInteger(record.maxWallTimeSeconds) && (record.maxWallTimeSeconds as number) >= 30 &&
    coordinatorAuthorizationTokens(row) !== null;
}

function parseCheckpointForApplication(value: string): AgentWorkstreamCheckpoint | null {
  const parsed = parseRecord(value);
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.criteria) ||
      !Array.isArray(parsed.references) || !parsed.nextAction || typeof parsed.nextAction !== 'object') return null;
  const ids = new Set<string>();
  const criteria = parsed.criteria.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const criterion = entry as Record<string, unknown>;
    if (typeof criterion.id !== 'string' || ids.has(criterion.id) ||
        !['pending', 'blocked', 'verified', 'waived'].includes(criterion.status as string) ||
        (criterion.receiptId !== undefined && typeof criterion.receiptId !== 'string')) return null;
    ids.add(criterion.id);
    return {
      id: criterion.id,
      status: criterion.status as AgentWorkstreamCheckpoint['criteria'][number]['status'],
      ...(typeof criterion.receiptId === 'string' ? { receiptId: criterion.receiptId } : {}),
    };
  });
  if (criteria.some((criterion) => criterion === null)) return null;
  return {
    version: 1,
    criteria: criteria as AgentWorkstreamCheckpoint['criteria'],
    references: parsed.references as AgentWorkstreamCheckpoint['references'],
    nextAction: parsed.nextAction as AgentWorkstreamCheckpoint['nextAction'],
  };
}

function assertLegacyRow(row: AgentBridgeJobRow): void {
  if (row.direction === NATIVE_WORKSTREAM_JOB_DIRECTION) {
    throw new BridgeJobError('native_job_unsupported');
  }
}

function assertNativeDeliveryScope(
  scope: NativeWorkstreamDeliveryScope,
): void {
  if (!isNativeWorkstreamDeliveryScope(scope)) {
    throw new BridgeJobError('native_delivery_scope_invalid', 400);
  }
}

function nativeDeliveryIds(ids: string[]): string[] {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !UUID.test(id))) {
    throw new BridgeJobError('native_delivery_ids_invalid', 400);
  }
  return [...new Set(ids)].sort();
}

function assertSafeReference(value: string, code: string): void {
  if (typeof value !== 'string' || !SAFE_REFERENCE.test(value)) {
    throw new BridgeJobError(code, 400);
  }
}

export class AgentBridgeJobsRepository {
  constructor(private readonly db: Database.Database = getDb()) {}

  createOrReplay(input: AgentBridgeJobInsert): { row: AgentBridgeJobRow; replay: boolean } {
    const existing = this.db.prepare(`
      SELECT * FROM agent_bridge_jobs
       WHERE local_user_id = ? AND parent_runtime = ?
         AND parent_session_id = ? AND idempotency_key = ?
         AND direction IN ('rhythm_to_hermes','hermes_to_rhythm')
    `).get(
      input.localUserId,
      input.parentRuntime,
      input.parentSessionId,
      input.idempotencyKey,
    ) as AgentBridgeJobRow | undefined;
    if (existing) {
      if (existing.request_sha256 !== input.requestSha256) {
        throw new BridgeJobError('idempotency_conflict');
      }
      return { row: existing, replay: true };
    }

    const id = input.id ?? randomUUID();
    this.db.prepare(`
      INSERT INTO agent_bridge_jobs (
        id, direction, idempotency_key, request_sha256, local_user_id, hermes_profile,
        parent_runtime, parent_runtime_instance, parent_session_id, parent_agent_id,
        parent_projection_id, target_agent_id, target_revision, target_runtime,
        depth, chain_id, prompt, context, cwd, state, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
    `).run(
      id, input.direction, input.idempotencyKey, input.requestSha256,
      input.localUserId, input.hermesProfile, input.parentRuntime,
      input.parentRuntimeInstance, input.parentSessionId, input.parentAgentId,
      input.parentProjectionId, input.targetAgentId, input.targetRevision,
      input.targetRuntime, input.depth, input.chainId, input.prompt, input.context,
      input.cwd, input.now, input.now,
    );
    return { row: this.get(id)!, replay: false };
  }

  createNativeOrReplay(inputValue: NativeWorkstreamJobCreate): {
    row: AgentBridgeJobRow;
    replay: boolean;
  } {
    const input = validateNativeWorkstreamJobCreate(inputValue);
    const requestSha256 = nativeWorkstreamIntentSha256(input);
    return this.db.transaction(() => {
      const workstream = this.db.prepare(`
        SELECT owner_user_id, project_id, revision, state FROM agent_workstreams WHERE id=?
      `).get(input.workstreamId) as {
        owner_user_id: number;
        project_id: string;
        revision: number;
        state: AgentWorkstreamState;
      } | undefined;
      if (!workstream || workstream.owner_user_id !== input.localUserId
          || workstream.project_id !== input.projectId) {
        throw new BridgeJobError('workstream_scope_mismatch');
      }
      const existing = this.db.prepare(`
        SELECT * FROM agent_bridge_jobs
         WHERE direction='rhythm_to_native' AND local_user_id=?
           AND workstream_id=? AND idempotency_key=?
      `).get(input.localUserId, input.workstreamId, input.commandKey) as AgentBridgeJobRow | undefined;
      if (existing) {
        if (existing.request_sha256 !== requestSha256) {
          throw new BridgeJobError('idempotency_conflict');
        }
        return { row: existing, replay: true };
      }

      if (workstream.revision !== input.capturedRevision) {
        throw new BridgeJobError('workstream_revision_mismatch');
      }
      if (workstream.state !== 'ready') {
        throw new BridgeJobError('workstream_not_admissible');
      }
      validateNativeWorkstreamJobAdmission(input);

      const id = input.id ?? randomUUID();
      this.db.prepare(`
        INSERT INTO agent_bridge_jobs (
          id, direction, idempotency_key, request_sha256, local_user_id, hermes_profile,
          parent_runtime, parent_runtime_instance, parent_session_id, parent_agent_id,
          parent_projection_id, target_agent_id, target_revision, target_runtime,
          depth, chain_id, prompt, context, cwd, state, created_at, updated_at,
          workstream_id, workstream_project_id, workstream_revision, host_epoch,
          native_queue_deadline_at
        ) VALUES (?, 'rhythm_to_native', ?, ?, ?, NULL,
          'opencode', ?, ?, ?, ?, ?, ?, 'opencode',
          1, ?, '', NULL, NULL, 'queued', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.commandKey,
        requestSha256,
        input.localUserId,
        input.parent.runtimeInstance,
        input.parent.sessionId,
        input.parent.agentId,
        input.parent.projectionId,
        input.targetAgentId,
        input.targetRevision,
        input.workstreamId,
        input.now,
        input.now,
        input.workstreamId,
        input.projectId,
        input.capturedRevision,
        input.hostEpoch,
        input.queueDeadlineAt ?? null,
      );
      return {
        row: this.getNativeForWorkstream({
          localUserId: input.localUserId,
          workstreamId: input.workstreamId,
          jobId: id,
        })!,
        replay: false,
      };
    }).immediate();
  }

  getNativeForWorkstream(input: {
    localUserId: number;
    workstreamId: string;
    jobId: string;
  }): AgentBridgeJobRow | null {
    return this.db.prepare(`
      SELECT * FROM agent_bridge_jobs
       WHERE id=? AND direction='rhythm_to_native' AND local_user_id=? AND workstream_id=?
    `).get(input.jobId, input.localUserId, input.workstreamId) as AgentBridgeJobRow | undefined ?? null;
  }

  /**
   * Server-private G2 lookup used only by the strict native provider gate.
   * The job id comes from the owned engine's schema-2 frame and is still
   * rejoined to owner/project/root metadata before it can admit anything.
   */
  findCoordinatorWorkflowJob(jobId: string): AgentBridgeJobRow | null {
    if (!workflowId(jobId)) return null;
    return this.db.prepare(`
      SELECT * FROM agent_bridge_jobs
       WHERE id=? AND direction='rhythm_to_native' AND native_execution_kind='coordinator'
    `).get(jobId) as AgentBridgeJobRow | undefined ?? null;
  }

  /** Exact durable member proof for the provider finalizer (membership precedes the request). */
  hasCoordinatorWorkflowMember(jobId: string, nativeSessionId: string, nativeUserMessageId: string): boolean {
    const workflow = parseRecord(this.findCoordinatorWorkflowJob(jobId)?.native_metadata_json ?? null)?.workflow as
      { membership?: unknown } | undefined;
    return Array.isArray(workflow?.membership) && workflow.membership.some((item) => {
      const member = item as Record<string, unknown> | null;
      return member?.nativeSessionId === nativeSessionId && member.nativeUserMessageId === nativeUserMessageId;
    });
  }

  listNativeForWorkstream(input: {
    localUserId: number;
    workstreamId: string;
  }): AgentBridgeJobRow[] {
    return this.db.prepare(`
      SELECT * FROM agent_bridge_jobs
       WHERE direction='rhythm_to_native' AND local_user_id=? AND workstream_id=?
       ORDER BY created_at, id
    `).all(input.localUserId, input.workstreamId) as AgentBridgeJobRow[];
  }

  /**
   * Marks a native intent as the coordinator's one real execution path.  The
   * metadata is identifier/policy-only and is written before any SDK session
   * exists.  `delivery_state=delivered` makes this status-only coordinator
   * permanently ineligible for the legacy model-wake path.
   */
  configureCoordinatorNativeJob(input: {
    localUserId: number;
    workstreamId: string;
    jobId: string;
    metadata: Record<string, unknown>;
    now: string;
  }): AgentBridgeJobRow {
    const current = this.getNativeForWorkstream(input);
    if (!current) throw new BridgeJobError('native_job_not_found', 404);
    const metadata = JSON.stringify(input.metadata);
    if (Buffer.byteLength(metadata, 'utf8') > 65_536) throw new BridgeJobError('native_metadata_too_large', 400);
    if (current.native_execution_kind === 'coordinator') {
      if (current.native_metadata_json !== metadata) throw new BridgeJobError('idempotency_conflict');
      return current;
    }
    if (current.native_execution_kind !== null && current.native_execution_kind !== 'legacy') {
      throw new BridgeJobError('native_job_kind_conflict');
    }
    const row = this.db.prepare(`UPDATE agent_bridge_jobs
      SET native_execution_kind='coordinator', native_metadata_json=?, delivery_state='delivered', updated_at=?
      WHERE id=? AND direction='rhythm_to_native' AND local_user_id=? AND workstream_id=?
        AND state='queued' AND native_dispatch_id IS NULL
      RETURNING *`).get(
      metadata, input.now, input.jobId, input.localUserId, input.workstreamId,
    ) as AgentBridgeJobRow | undefined;
    if (!row) throw new BridgeJobError('native_job_not_configurable');
    return row;
  }

  /**
   * Returns a bounded, read-only snapshot of legacy asynchronous delegation
   * state.  It does not infer completion, mutate a delivery, or wake a parent.
   * A missing/old/unreadable local lifecycle schema is explicitly unavailable
   * so the caller can retain every legacy row as host-global occupancy.
   */
  readCoordinatorLegacyCapacitySnapshot(): CoordinatorLegacyCapacitySnapshot {
    try {
      const asyncTable = this.db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_async_delegations'",
      ).get();
      if (!asyncTable) return { available: true, totalActive: 0, rows: [] };
      const total = this.db.prepare(`SELECT COUNT(*) AS count
        FROM agent_async_delegations
        WHERE status IN ('dispatched','waking') AND id ${NOT_LIVE_WORKFLOW_DELEGATION}`).get() as { count: number };
      const rows = this.db.prepare(`SELECT
          d.id AS delegation_id,
          d.status AS delegation_status,
          d.updated_at AS delegation_updated_at,
          d.parent_session_id,
          p.id AS parent_bound_session_id,
          p.status AS parent_status,
          p.updated_at AS parent_updated_at,
          d.child_session_id,
          c.sdk_session_id AS child_sdk_session_id,
          c.status AS child_status,
          c.updated_at AS child_updated_at,
          c.cwd AS child_cwd,
          c.parent_session_id AS child_parent_session_id
        FROM agent_async_delegations d
        LEFT JOIN agent_sessions p ON p.id=d.parent_session_id
        LEFT JOIN agent_sessions c ON c.id=d.child_session_id
        WHERE d.status IN ('dispatched','waking') AND d.id ${NOT_LIVE_WORKFLOW_DELEGATION}
        ORDER BY d.created_at ASC, d.id ASC
        LIMIT ?`).all(LEGACY_CAPACITY_SNAPSHOT_LIMIT) as LegacyCoordinatorCapacitySqlRow[];
      return {
        available: true,
        totalActive: total.count,
        rows: rows.map(legacyCapacityRow),
      };
    } catch {
      return { available: false, totalActive: null, rows: [] };
    }
  }

  private readActiveLegacyCapacityRow(id: string): LegacyCoordinatorCapacityRow | null {
    const row = this.db.prepare(`SELECT
        d.id AS delegation_id,
        d.status AS delegation_status,
        d.updated_at AS delegation_updated_at,
        d.parent_session_id,
        p.id AS parent_bound_session_id,
        p.status AS parent_status,
        p.updated_at AS parent_updated_at,
        d.child_session_id,
        c.sdk_session_id AS child_sdk_session_id,
        c.status AS child_status,
        c.updated_at AS child_updated_at,
        c.cwd AS child_cwd,
        c.parent_session_id AS child_parent_session_id
      FROM agent_async_delegations d
      LEFT JOIN agent_sessions p ON p.id=d.parent_session_id
      LEFT JOIN agent_sessions c ON c.id=d.child_session_id
      WHERE d.id=? AND d.status IN ('dispatched','waking') AND d.id ${NOT_LIVE_WORKFLOW_DELEGATION}`).get(id) as LegacyCoordinatorCapacitySqlRow | undefined;
    return row ? legacyCapacityRow(row) : null;
  }

  /**
   * Count current legacy occupancy without changing legacy delivery state.
   * Only a matching, bounded status-only assessment may subtract a row; a new,
   * changed, malformed, waking, or unreadable row remains an occupancy hold.
   */
  private coordinatorLegacyOccupancy(input: {
    hostEpoch: string;
    engineRuntimeInstance: string;
    assessment?: CoordinatorLegacyCapacityAssessment;
  }): number {
    try {
      const asyncTable = this.db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_async_delegations'",
      ).get();
      if (!asyncTable) return 0;
      const total = (this.db.prepare(`SELECT COUNT(*) AS count
        FROM agent_async_delegations
        WHERE status IN ('dispatched','waking') AND id ${NOT_LIVE_WORKFLOW_DELEGATION}`).get() as { count: number }).count;
      const assessment = input.assessment;
      if (
        !assessment ||
        assessment.hostEpoch !== input.hostEpoch ||
        assessment.engineRuntimeInstance !== input.engineRuntimeInstance ||
        assessment.qualifiedRows.length > LEGACY_CAPACITY_SNAPSHOT_LIMIT
      ) {
        return total;
      }
      const ids = new Set<string>();
      for (const row of assessment.qualifiedRows) {
        if (
          !row || typeof row.delegationId !== 'string' || !row.delegationId ||
          row.delegationStatus !== 'dispatched' || ids.has(row.delegationId)
        ) {
          return total;
        }
        ids.add(row.delegationId);
      }
      let qualified = 0;
      for (const observed of assessment.qualifiedRows) {
        const current = this.readActiveLegacyCapacityRow(observed.delegationId);
        if (current && sameLegacyCapacityRow(current, observed)) qualified += 1;
      }
      return Math.max(0, total - qualified);
    } catch {
      // A local lifecycle read that cannot prove its own completeness is an
      // occupancy hold, not evidence that legacy work is absent.
      return COORDINATOR_BACKGROUND_CAPACITY;
    }
  }

  /** No scheduler consumes queued coordinator jobs; this is called only by an explicit Run next. */
  claimCoordinatorForExplicitDispatch(input: {
    localUserId: number;
    workstreamId: string;
    jobId: string;
    hostEpoch: string;
    /** Required by the coordinator; retained optional for older read-only callers. */
    expectedRevision?: number;
    /** Status-only legacy proof gathered by the coordinator immediately before this claim. */
    legacyCapacityAssessment?: CoordinatorLegacyCapacityAssessment;
    now: string;
  }): { row: AgentBridgeJobRow; admitted: boolean } {
    return this.db.transaction(() => {
      const current = this.getNativeForWorkstream(input);
      if (!current) throw new BridgeJobError('native_job_not_found', 404);
      if (current.native_execution_kind !== 'coordinator' || current.host_epoch !== input.hostEpoch) {
        throw new BridgeJobError('native_job_not_admissible');
      }
      const workstream = this.db.prepare(`SELECT revision,state,executor_epoch,last_job_id
        FROM agent_workstreams WHERE id=? AND owner_user_id=? AND project_id=?`).get(
        input.workstreamId,
        input.localUserId,
        current.workstream_project_id,
      ) as {
        revision: number;
        state: AgentWorkstreamState;
        executor_epoch: string | null;
        last_job_id: string | null;
      } | undefined;
      if (
        !workstream || (input.expectedRevision !== undefined && workstream.revision !== input.expectedRevision) ||
        workstream.state !== 'queued' || workstream.executor_epoch !== input.hostEpoch ||
        workstream.last_job_id !== input.jobId
      ) {
        throw new BridgeJobError('workstream_controls_changed');
      }
      if (current.state !== 'queued') return { row: current, admitted: current.state === 'claimed' || current.state === 'running' };
      const activeNative = this.db.prepare(`SELECT COUNT(*) AS count FROM agent_bridge_jobs
        WHERE direction='rhythm_to_native' AND native_execution_kind='coordinator'
          AND state IN ('claimed','running','unknown')`).get() as { count: number };
      const activeLegacy = this.coordinatorLegacyOccupancy({
        hostEpoch: input.hostEpoch,
        engineRuntimeInstance: current.parent_runtime_instance,
        assessment: input.legacyCapacityAssessment,
      });
      if (activeNative.count + activeLegacy >= COORDINATOR_BACKGROUND_CAPACITY) {
        return { row: current, admitted: false };
      }
      const row = this.db.prepare(`UPDATE agent_bridge_jobs
        SET state='claimed', updated_at=?
        WHERE id=? AND direction='rhythm_to_native' AND native_execution_kind='coordinator'
          AND host_epoch=? AND state='queued'
        RETURNING *`).get(input.now, input.jobId, input.hostEpoch) as AgentBridgeJobRow | undefined;
      return { row: row ?? this.getNativeForWorkstream(input)!, admitted: !!row };
    }).immediate();
  }

  bindCoordinatorChild(input: {
    localUserId: number;
    workstreamId: string;
    jobId: string;
    localSessionId: string;
    sdkSessionId: string;
    now: string;
  }): AgentBridgeJobRow {
    const row = this.db.prepare(`UPDATE agent_bridge_jobs
      SET native_child_session_id=?, native_child_sdk_session_id=?, updated_at=?
      WHERE id=? AND direction='rhythm_to_native' AND native_execution_kind='coordinator'
        AND local_user_id=? AND workstream_id=? AND state='claimed'
        AND native_child_session_id IS NULL
      RETURNING *`).get(
      input.localSessionId, input.sdkSessionId, input.now, input.jobId,
      input.localUserId, input.workstreamId,
    ) as AgentBridgeJobRow | undefined;
    if (!row) throw new BridgeJobError('native_child_already_bound');
    return row;
  }

  bindCoordinatorDispatch(input: {
    localUserId: number;
    workstreamId: string;
    jobId: string;
    dispatchId: string;
    sdkUserMessageId: string;
    now: string;
  }): AgentBridgeJobRow {
    const row = this.db.prepare(`UPDATE agent_bridge_jobs
      SET native_dispatch_id=?, native_sdk_user_message_id=?, state='running',
          native_started_at=COALESCE(native_started_at,?), native_progress_at=?, updated_at=?
      WHERE id=? AND direction='rhythm_to_native' AND native_execution_kind='coordinator'
        AND local_user_id=? AND workstream_id=? AND state='claimed'
        AND native_dispatch_id IS NULL
      RETURNING *`).get(
      input.dispatchId, input.sdkUserMessageId, input.now, input.now, input.now,
      input.jobId, input.localUserId, input.workstreamId,
    ) as AgentBridgeJobRow | undefined;
    if (!row) throw new BridgeJobError('native_dispatch_already_bound');
    return row;
  }

  /**
   * The G2 manager's local child, durable delegation, engine identity and
   * minted native anchor are one atomic coordinator-job receipt.  This runs
   * from the private synchronous prompt hook; if it cannot commit, the SDK
   * call is refused.  It is not a delivery claim.
   */
  bindCoordinatorWorkflowPrepared(input: {
    localUserId: number;
    workstreamId: string;
    jobId: string;
    binding: CoordinatorWorkflowPreparedBinding;
    now: string;
  }): AgentBridgeJobRow {
    const { binding } = input;
    if (
      !workflowId(input.workstreamId) || !workflowId(input.jobId) ||
      !Number.isSafeInteger(input.localUserId) || input.localUserId < 1 ||
      !workflowId(binding.authorization.authorizationId) || !workflowId(binding.authorization.goalId) ||
      !workflowId(binding.authorization.workstreamId) || !workflowId(binding.owner.projectId) ||
      binding.workflowBinding.schemaVersion !== 1 || !workflowId(binding.workflowBinding.jobId) ||
      !workflowId(binding.workflowBinding.rootSdkSessionId) || !workflowId(binding.workflowBinding.managerSdkSessionId) ||
      typeof binding.workflowBinding.expiresAt !== 'string' || Number.isNaN(new Date(binding.workflowBinding.expiresAt).valueOf()) ||
      !workflowId(binding.owner.rootSessionId) || !workflowId(binding.owner.rootSdkSessionId) ||
      !workflowId(binding.delegation.delegationId) || !workflowId(binding.delegation.managerSessionId) ||
      !workflowId(binding.delegation.managerSdkSessionId) || !workflowId(binding.delegation.nativeParentSdkSessionId) ||
      !workflowId(binding.dispatch.dispatchId) || !workflowId(binding.dispatch.sdkUserMessageId) ||
      !workflowId(binding.engine.bootId) || !Number.isSafeInteger(binding.engine.pid)
    ) throw new BridgeJobError('workflow_prepared_binding_invalid', 400);
    if (
      binding.authorization.workstreamId !== input.workstreamId ||
      binding.workflowBinding.jobId !== input.jobId ||
      binding.workflowBinding.rootSdkSessionId !== binding.owner.rootSdkSessionId ||
      binding.workflowBinding.managerSdkSessionId !== binding.delegation.managerSdkSessionId ||
      binding.owner.ownerUserId !== input.localUserId ||
      binding.delegation.nativeParentSdkSessionId !== binding.owner.rootSdkSessionId ||
      binding.delegation.managerSdkSessionId === binding.owner.rootSdkSessionId
    ) throw new BridgeJobError('workflow_prepared_binding_mismatch');
    return this.db.transaction(() => {
      const current = this.getNativeForWorkstream(input);
      if (!current || current.native_execution_kind !== 'coordinator' || current.host_epoch === null) {
        throw new BridgeJobError('native_job_not_admissible');
      }
      if (current.parent_runtime_instance !== binding.engine.bootId ||
          current.parent_session_id !== binding.owner.rootSessionId ||
          current.workstream_project_id !== binding.owner.projectId) {
        throw new BridgeJobError('workflow_prepared_binding_mismatch');
      }
      const metadata = parseRecord(current.native_metadata_json);
      const workflow = metadata?.workflow;
      const workflowRecord = workflow && typeof workflow === 'object' && !Array.isArray(workflow)
        ? workflow as Record<string, unknown>
        : null;
      if (
        !metadata || !workflowRecord || workflowRecord.schemaVersion !== 1 ||
        workflowRecord.kind !== 'coding_workflow' || !sameJson(workflowRecord.authorization, binding.authorization) ||
        !Array.isArray(workflowRecord.membership)
      ) throw new BridgeJobError('workflow_metadata_unavailable');
      const prepared = {
        workflowBinding: binding.workflowBinding,
        owner: binding.owner,
        delegation: binding.delegation,
        dispatch: binding.dispatch,
        engine: binding.engine,
      };
      if (workflowRecord.prepared !== null && workflowRecord.prepared !== undefined) {
        if (
          !sameJson(workflowRecord.prepared, prepared) ||
          current.native_child_session_id !== binding.delegation.managerSessionId ||
          current.native_child_sdk_session_id !== binding.delegation.managerSdkSessionId ||
          current.native_dispatch_id !== binding.dispatch.dispatchId ||
          current.native_sdk_user_message_id !== binding.dispatch.sdkUserMessageId
        ) throw new BridgeJobError('workflow_prepared_binding_conflict');
        return current;
      }
      if (
        current.state !== 'claimed' || current.native_child_session_id !== null ||
        current.native_child_sdk_session_id !== null || current.native_dispatch_id !== null ||
        current.native_sdk_user_message_id !== null
      ) throw new BridgeJobError('workflow_prepared_binding_conflict');
      const nextWorkflow = {
        ...workflowRecord,
        prepared,
        delivery: 'prepared',
        membership: workflowRecord.membership,
      };
      const next = { ...metadata, workflow: nextWorkflow };
      const row = this.db.prepare(`UPDATE agent_bridge_jobs
        SET native_child_session_id=?, native_child_sdk_session_id=?, native_dispatch_id=?, native_sdk_user_message_id=?,
            state='running', native_started_at=COALESCE(native_started_at,?), native_progress_at=?,
            native_metadata_json=?, updated_at=?
        WHERE id=? AND direction='rhythm_to_native' AND native_execution_kind='coordinator'
          AND local_user_id=? AND workstream_id=? AND state='claimed'
          AND native_child_session_id IS NULL AND native_dispatch_id IS NULL
        RETURNING *`).get(
        binding.delegation.managerSessionId,
        binding.delegation.managerSdkSessionId,
        binding.dispatch.dispatchId,
        binding.dispatch.sdkUserMessageId,
        input.now,
        input.now,
        serializedMetadata(next),
        input.now,
        input.jobId,
        input.localUserId,
        input.workstreamId,
      ) as AgentBridgeJobRow | undefined;
      if (!row) throw new BridgeJobError('workflow_prepared_binding_conflict');
      return row;
    }).immediate();
  }

  /** Record the SDK delivery boundary without treating a prepared anchor as success. */
  recordCoordinatorWorkflowDelivery(input: {
    localUserId: number;
    workstreamId: string;
    jobId: string;
    dispatchId: string;
    sdkUserMessageId: string;
    delivery: 'accepted' | 'unknown' | 'rejected';
    now: string;
  }): AgentBridgeJobRow {
    return this.db.transaction(() => {
      const current = this.getNativeForWorkstream(input);
      if (!current || current.native_execution_kind !== 'coordinator') throw new BridgeJobError('native_job_not_found', 404);
      const metadata = parseRecord(current.native_metadata_json);
      const workflow = metadata?.workflow;
      const record = workflow && typeof workflow === 'object' && !Array.isArray(workflow)
        ? workflow as Record<string, unknown>
        : null;
      const prepared = record?.prepared;
      if (!record || record.schemaVersion !== 1 || record.kind !== 'coding_workflow' ||
          !prepared || typeof prepared !== 'object' || Array.isArray(prepared) ||
          !(prepared as Record<string, unknown>).workflowBinding ||
          !sameJson((prepared as Record<string, unknown>).dispatch, {
            dispatchId: input.dispatchId, sdkUserMessageId: input.sdkUserMessageId,
          }) || current.native_dispatch_id !== input.dispatchId ||
          current.native_sdk_user_message_id !== input.sdkUserMessageId) {
        throw new BridgeJobError('workflow_delivery_binding_mismatch');
      }
      const existing = record.delivery;
      if (existing === input.delivery) return current;
      if (existing !== 'prepared') throw new BridgeJobError('workflow_delivery_conflict');
      const next = { ...metadata!, workflow: { ...record, delivery: input.delivery } };
      const terminal = input.delivery === 'rejected';
      const uncertain = input.delivery === 'unknown';
      const row = this.db.prepare(`UPDATE agent_bridge_jobs
        SET native_metadata_json=?, state=?, state_reason=?,
            native_result_json=CASE WHEN ? THEN ? ELSE native_result_json END,
            terminal_at=CASE WHEN ? THEN ? ELSE terminal_at END,
            native_progress_at=?, updated_at=?
        WHERE id=? AND direction='rhythm_to_native' AND native_execution_kind='coordinator'
          AND local_user_id=? AND workstream_id=? AND state IN ('running','unknown','failed')
        RETURNING *`).get(
        serializedMetadata(next),
        terminal ? 'failed' : uncertain ? 'unknown' : 'running',
        terminal ? 'workflow_delivery_rejected' : uncertain ? 'native_status_unknown' : null,
        uncertain,
        uncertain ? JSON.stringify({ schemaVersion: 1, status: 'unknown', reason: 'workflow_delivery_unknown' }) : null,
        terminal,
        terminal ? input.now : null,
        input.now,
        input.now,
        input.jobId,
        input.localUserId,
        input.workstreamId,
      ) as AgentBridgeJobRow | undefined;
      if (!row) throw new BridgeJobError('workflow_delivery_conflict');
      return row;
    }).immediate();
  }

  /**
   * Append an exact native provider/accounting member. Duplicate retry is a
   * replay; a conflicting attempt for the same native user anchor holds. No
   * member is evicted when the bounded job metadata would overflow.
   */
  appendCoordinatorWorkflowMembership(input: {
    localUserId: number;
    workstreamId: string;
    jobId: string;
    member: CoordinatorWorkflowMembership;
    now: string;
  }): AgentBridgeJobRow {
    const member = input.member;
    if (
      !workflowId(member.nativeSessionId) || !workflowId(member.parentNativeSessionId) ||
      !workflowId(member.nativeUserMessageId) || !workflowId(member.engineGeneration) ||
      !workflowId(member.runnerGeneration) || !workflowId(member.requestIdentity) ||
      !Number.isSafeInteger(member.attempt) || member.attempt < 0 || member.attempt > 100 ||
      !['answer', 'compaction', 'summary'].includes(member.purpose) ||
      !['persisted_assistant', 'unmetered_auxiliary'].includes(member.accountingKind) ||
      (member.accountingKind === 'persisted_assistant' &&
        (!workflowId(member.assistantMessageId) || !workflowId(member.parentMessageId))) ||
      (member.accountingKind === 'unmetered_auxiliary' &&
        (member.assistantMessageId !== null || member.parentMessageId !== null))
    ) throw new BridgeJobError('workflow_membership_invalid', 400);
    return this.db.transaction(() => {
      const current = this.getNativeForWorkstream(input);
      if (!current || current.native_execution_kind !== 'coordinator') throw new BridgeJobError('native_job_not_found', 404);
      const metadata = parseRecord(current.native_metadata_json);
      const workflow = metadata?.workflow;
      const record = workflow && typeof workflow === 'object' && !Array.isArray(workflow)
        ? workflow as Record<string, unknown>
        : null;
      if (!record || record.schemaVersion !== 1 || record.kind !== 'coding_workflow' ||
          record.delivery !== 'accepted' || !Array.isArray(record.membership)) {
        throw new BridgeJobError('workflow_membership_unavailable');
      }
      const membership = record.membership as unknown[];
      const existing = membership.find((item) => {
        const value = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : null;
        return value?.nativeUserMessageId === member.nativeUserMessageId;
      });
      if (existing) {
        if (!sameJson(existing, member)) throw new BridgeJobError('workflow_membership_conflict');
        return current;
      }
      if (membership.length >= WORKFLOW_MEMBERSHIP_LIMIT) throw new BridgeJobError('workflow_membership_bounds');
      const next = { ...metadata!, workflow: { ...record, membership: [...membership, member] } };
      const row = this.db.prepare(`UPDATE agent_bridge_jobs
        SET native_metadata_json=?, native_progress_at=?, updated_at=?
        WHERE id=? AND direction='rhythm_to_native' AND native_execution_kind='coordinator'
          AND local_user_id=? AND workstream_id=? AND state='running'
        RETURNING *`).get(
        serializedMetadata(next), input.now, input.now,
        input.jobId, input.localUserId, input.workstreamId,
      ) as AgentBridgeJobRow | undefined;
      if (!row) throw new BridgeJobError('workflow_membership_conflict');
      return row;
    }).immediate();
  }

  /**
   * The live workflow job whose manager is exactly this async delegation. A
   * delegation not bound by a live (claimed/running/unknown) workflow job is
   * unrelated and must never be attributed to one.
   */
  findLiveCoordinatorWorkflowJobByDelegation(delegationId: string): AgentBridgeJobRow | null {
    if (!workflowId(delegationId)) return null;
    return this.db.prepare(`
      SELECT * FROM agent_bridge_jobs
       WHERE direction='rhythm_to_native' AND native_execution_kind='coordinator'
         AND state IN ('claimed','running','unknown')
         AND json_extract(native_metadata_json,'$.workflow.kind')='coding_workflow'
         AND json_extract(native_metadata_json,'$.workflow.delivery')='accepted'
         AND json_extract(native_metadata_json,'$.workflow.prepared.delegation.delegationId')=?
       LIMIT 1`).get(delegationId) as AgentBridgeJobRow | undefined ?? null;
  }

  /**
   * Durable pre-exposure receipt for the bound manager's completion callback:
   * the minted native user anchor, CAS'd onto the job JSON. A replay of the
   * same anchor is idempotent; a different anchor for the same delegation
   * holds.
   */
  recordCoordinatorWorkflowCallbackAnchor(input: {
    delegationId: string;
    dispatchId: string;
    sdkUserMessageId: string;
    now: string;
  }): AgentBridgeJobRow {
    if (!workflowId(input.delegationId) || !workflowId(input.dispatchId) || !workflowId(input.sdkUserMessageId)) {
      throw new BridgeJobError('workflow_callback_anchor_invalid', 400);
    }
    return this.db.transaction(() => {
      const current = this.findLiveCoordinatorWorkflowJobByDelegation(input.delegationId);
      if (!current) throw new BridgeJobError('workflow_callback_unbound');
      const metadata = parseRecord(current.native_metadata_json)!;
      const record = metadata.workflow as Record<string, unknown>;
      const anchors = Array.isArray(record.callbackAnchors) ? record.callbackAnchors as Array<Record<string, unknown>> : [];
      const anchor = { delegationId: input.delegationId, dispatchId: input.dispatchId, sdkUserMessageId: input.sdkUserMessageId };
      const existing = anchors.find((item) => item?.delegationId === input.delegationId);
      if (existing) {
        if (!sameJson(existing, anchor)) throw new BridgeJobError('workflow_callback_anchor_conflict');
        return current;
      }
      if (anchors.length >= WORKFLOW_MEMBERSHIP_LIMIT) throw new BridgeJobError('workflow_membership_bounds');
      const next = { ...metadata, workflow: { ...record, callbackAnchors: [...anchors, anchor] } };
      const row = this.db.prepare(`UPDATE agent_bridge_jobs
        SET native_metadata_json=?, native_progress_at=?, updated_at=?
        WHERE id=? AND native_metadata_json=? AND state IN ('claimed','running','unknown')
        RETURNING *`).get(serializedMetadata(next), input.now, input.now, current.id, current.native_metadata_json) as AgentBridgeJobRow | undefined;
      if (!row) throw new BridgeJobError('workflow_callback_anchor_conflict');
      return row;
    }).immediate();
  }

  markCoordinatorUnknown(input: {
    localUserId: number; workstreamId: string; jobId: string; reason: string; now: string;
  }): AgentBridgeJobRow {
    const row = this.db.prepare(`UPDATE agent_bridge_jobs
      SET state='unknown', state_reason='native_status_unknown',
          native_result_json=?, native_progress_at=?, updated_at=?
      WHERE id=? AND direction='rhythm_to_native' AND native_execution_kind='coordinator'
        AND local_user_id=? AND workstream_id=? AND state IN ('queued','claimed','running','unknown')
      RETURNING *`).get(
      JSON.stringify({ schemaVersion: 1, status: 'unknown', reason: input.reason }), input.now, input.now,
      input.jobId, input.localUserId, input.workstreamId,
    ) as AgentBridgeJobRow | undefined;
    return row ?? this.getNativeForWorkstream(input)!;
  }

  /**
   * Keeps an exact terminal observation durable but unadmitted when its usage
   * page is incomplete or ambiguous.  It is intentionally unknown, never a
   * retry candidate and never a synthetic succeeded result.
   */
  holdCoordinatorUsageUnknown(input: {
    localUserId: number;
    workstreamId: string;
    jobId: string;
    result: Record<string, unknown>;
    reason: string;
    now: string;
  }): AgentBridgeJobRow {
    const row = this.db.prepare(`UPDATE agent_bridge_jobs
      SET state='unknown', state_reason='native_status_unknown', native_result_json=?, native_usage_json=NULL,
          native_progress_at=?, updated_at=?
      WHERE id=? AND direction='rhythm_to_native' AND native_execution_kind='coordinator'
        AND local_user_id=? AND workstream_id=? AND state IN ('claimed','running','unknown')
      RETURNING *`).get(
      JSON.stringify({ ...input.result, status: 'unknown', usageStatus: 'unknown', reason: input.reason }),
      input.now,
      input.now,
      input.jobId,
      input.localUserId,
      input.workstreamId,
    ) as AgentBridgeJobRow | undefined;
    return row ?? this.getNativeForWorkstream(input)!;
  }

  /**
   * Reads every durable coordinator row for a workstream. Actual engine usage
   * wins over an earlier acknowledged estimate; an unacknowledged dispatched
   * row is a hard admission hold rather than an invitation to guess.
   */
  coordinatorBudgetState(input: {
    localUserId: number;
    workstreamId: string;
  }): CoordinatorBudgetState {
    const rows = this.listNativeForWorkstream(input).filter(
      (row) => row.native_execution_kind === 'coordinator',
    );
    // A workstream cap is never allowed to rise because a later legacy row
    // carried a different policy. Normal coordinator rows repeat the same
    // explicit budget; for inconsistent history use the smallest durable cap.
    const authorizations = rows.map(coordinatorAuthorizationTokens).filter(
      (value): value is number => value !== null,
    );
    const authorizedTokens = authorizations.length > 0 ? Math.min(...authorizations) : null;
    let actualTokens = 0;
    let acknowledgedTokens = 0;
    let reservedTokens = 0;
    const unknownJobIds: string[] = [];
    let overshoot = false;
    for (const row of rows) {
      const actual = actualUsageTokens(row);
      if (actual !== null) {
        actualTokens += actual;
        const usage = parseRecord(row.native_usage_json);
        overshoot ||= usage?.overshoot === true;
        continue;
      }
      const acknowledged = acknowledgedEstimateTokens(row);
      if (acknowledged !== null) {
        acknowledgedTokens += acknowledged;
        continue;
      }
      if (row.state === 'queued' || row.state === 'claimed' || row.state === 'running') {
        const reserved = coordinatorPolicyTokens(row);
        if (reserved === null) unknownJobIds.push(row.id);
        else reservedTokens += reserved;
        continue;
      }
      if (jobRequiresActualUsage(row)) unknownJobIds.push(row.id);
    }
    const committedTokens = actualTokens + acknowledgedTokens + reservedTokens;
    if (authorizedTokens !== null && committedTokens > authorizedTokens) overshoot = true;
    const remainingTokens = authorizedTokens === null
      ? null
      : Math.max(0, authorizedTokens - committedTokens);
    const holdReason = overshoot
      ? 'budget_overshoot'
      : unknownJobIds.length > 0
        ? 'budget_usage_unknown'
        : remainingTokens === 0 && authorizedTokens !== null
          ? 'budget_exhausted'
          : null;
    return {
      authorizedTokens,
      actualTokens,
      acknowledgedEstimateTokens: acknowledgedTokens,
      reservedTokens,
      committedTokens,
      remainingTokens,
      overshoot,
      unknownJobIds: unknownJobIds.sort(),
      holdReason,
    };
  }

  completeCoordinator(input: {
    localUserId: number; workstreamId: string; jobId: string;
    state: Extract<AgentBridgeJobState, 'succeeded' | 'failed' | 'cancelled'>;
    result: Record<string, unknown>; usage: Record<string, unknown> | null; now: string;
  }): AgentBridgeJobRow {
    const current = this.getNativeForWorkstream(input);
    if (!current) throw new BridgeJobError('native_job_not_found', 404);
    if (TERMINAL.has(current.state)) return current;
    const row = this.db.prepare(`UPDATE agent_bridge_jobs
      SET state=?, state_reason=NULL, native_result_json=?, native_usage_json=?,
          native_progress_at=?, updated_at=?, terminal_at=?
      WHERE id=? AND direction='rhythm_to_native' AND native_execution_kind='coordinator'
        AND local_user_id=? AND workstream_id=? AND state IN ('claimed','running','unknown')
      RETURNING *`).get(
      input.state, JSON.stringify(input.result), input.usage ? JSON.stringify(input.usage) : null,
      input.now, input.now, input.now, input.jobId, input.localUserId, input.workstreamId,
    ) as AgentBridgeJobRow | undefined;
    return row ?? this.getNativeForWorkstream(input)!;
  }

  recordCoordinatorApplication(input: {
    localUserId: number; workstreamId: string; jobId: string; application: Record<string, unknown>; now: string;
  }): AgentBridgeJobRow {
    const row = this.db.prepare(`UPDATE agent_bridge_jobs
      SET native_application_json=?, updated_at=?
      WHERE id=? AND direction='rhythm_to_native' AND native_execution_kind='coordinator'
        AND local_user_id=? AND workstream_id=? AND native_application_json IS NULL
      RETURNING *`).get(
      JSON.stringify(input.application), input.now, input.jobId, input.localUserId, input.workstreamId,
    ) as AgentBridgeJobRow | undefined;
    return row ?? this.getNativeForWorkstream(input)!;
  }

  /**
   * The one transaction that turns a qualified receipt (or an authenticated
   * waiver) into a typed criterion state.  It never accepts worker prose and
   * can only replace the terminal worker's initial quarantined application.
   */
  applyCoordinatorCriterion(input: {
    localUserId: number;
    projectId: string;
    workstreamId: string;
    jobId: string;
    expectedRevision: number;
    expectedEpoch: string;
    criterionId: string;
    criterionStatus: 'verified' | 'waived';
    receiptId: string;
    application: Record<string, unknown>;
    now: string;
  }): CoordinatorCriterionApplicationResult {
    return this.applyCoordinatorCriteria({
      localUserId: input.localUserId,
      projectId: input.projectId,
      workstreamId: input.workstreamId,
      jobId: input.jobId,
      expectedRevision: input.expectedRevision,
      currentEpoch: input.expectedEpoch,
      criteria: [{
        criterionId: input.criterionId,
        criterionStatus: input.criterionStatus,
        receiptId: input.receiptId,
      }],
      application: input.application,
      now: input.now,
    });
  }

  /**
   * Applies one bounded, reviewed set of all unresolved criteria atomically.
   * A terminal job gets exactly one immutable application receipt: callers may
   * not consume a result one criterion at a time and strand the remainder.
   */
  applyCoordinatorCriteria(input: {
    localUserId: number;
    projectId: string;
    workstreamId: string;
    jobId: string;
    expectedRevision: number;
    /** The live coordinator epoch, never copied from an old job as proof. */
    currentEpoch: string;
    /**
     * Computed by the coordinator immediately before application from its
     * current flag/capture/profile authority.  A persisted old job is never
     * proof that those controls are still live.
     */
    authorityCurrent?: boolean;
    criteria: CoordinatorCriterionInput[];
    application: Record<string, unknown>;
    now: string;
  }): CoordinatorCriterionApplicationResult {
    return this.db.transaction<() => CoordinatorCriterionApplicationResult>(() => {
      const job = this.getNativeForWorkstream({
        localUserId: input.localUserId,
        workstreamId: input.workstreamId,
        jobId: input.jobId,
      });
      if (!job || job.native_execution_kind !== 'coordinator') {
        throw new BridgeJobError('native_job_not_found', 404);
      }
      const workstream = this.db.prepare(`SELECT checkpoint_json,state,executor_epoch,last_job_id,revision
        FROM agent_workstreams WHERE id=? AND owner_user_id=? AND project_id=?`).get(
        input.workstreamId, input.localUserId, input.projectId,
      ) as {
        checkpoint_json: string;
        state: AgentWorkstreamState;
        executor_epoch: string | null;
        last_job_id: string | null;
        revision: number;
      } | undefined;
      const stale = !workstream ||
        workstream.revision !== input.expectedRevision ||
        workstream.executor_epoch !== input.currentEpoch ||
        workstream.last_job_id !== input.jobId ||
        workstream.state === 'paused' || workstream.state === 'cancelled' || workstream.state === 'completed' ||
        job.state !== 'succeeded' ||
        job.workstream_revision !== input.expectedRevision ||
        job.host_epoch !== input.currentEpoch ||
        input.authorityCurrent === false ||
        !hasValidCoordinatorPolicy(job);
      if (stale) {
        const row = this.replaceQuarantinedCoordinatorApplication(job, {
          schemaVersion: 1,
          status: 'stale',
          reason: input.authorityCurrent === false
            ? 'criterion_application_runtime_authority_changed'
            : 'criterion_application_fenced',
          criteria: input.criteria.map(({ criterionId }) => criterionId),
          workstreamRevision: input.expectedRevision,
        }, input.now);
        return { outcome: 'stale', job: row };
      }

      const existingApplication = parseRecord(job.native_application_json);
      if (existingApplication && existingApplication.status !== 'quarantined') {
        return { outcome: 'already_applied', job };
      }
      const checkpoint = parseCheckpointForApplication(workstream.checkpoint_json);
      if (!checkpoint) throw new BridgeJobError('workstream_checkpoint_invalid');
      if (input.criteria.length === 0 || input.criteria.length > 100) {
        return { outcome: 'criterion_unavailable', job };
      }
      const requested = new Map<string, CoordinatorCriterionInput>();
      for (const criterion of input.criteria) {
        if (!criterion || !/^[A-Za-z0-9._:-]{1,128}$/.test(criterion.criterionId) ||
            (criterion.criterionStatus !== 'verified' && criterion.criterionStatus !== 'waived') ||
            typeof criterion.receiptId !== 'string' || criterion.receiptId.length === 0 ||
            requested.has(criterion.criterionId)) {
          return { outcome: 'criterion_unavailable', job };
        }
        requested.set(criterion.criterionId, criterion);
      }
      const unresolved = checkpoint.criteria.filter(
        (candidate) => candidate.status === 'pending' || candidate.status === 'blocked',
      );
      if (unresolved.length === 0 || unresolved.length !== requested.size ||
          unresolved.some((candidate) => !requested.has(candidate.id))) {
        return { outcome: 'criterion_unavailable', job };
      }
      const nextCheckpoint: AgentWorkstreamCheckpoint = {
        ...checkpoint,
        criteria: checkpoint.criteria.map((candidate) => {
          const requestedCriterion = requested.get(candidate.id);
          return requestedCriterion
            ? {
              ...candidate,
              status: requestedCriterion.criterionStatus,
              receiptId: requestedCriterion.receiptId,
            }
            : candidate;
        }),
      };
      const allResolved = nextCheckpoint.criteria.length > 0 && nextCheckpoint.criteria.every(
        (candidate) => candidate.status === 'verified' || candidate.status === 'waived',
      );
      const nextState: AgentWorkstreamState = allResolved ? 'completed' : 'ready';
      const application = JSON.stringify({
        ...input.application,
        schemaVersion: 1,
        status: 'applied',
        criteria: input.criteria.map((criterion) => ({ ...criterion })),
        workstreamRevision: input.expectedRevision,
        hostEpoch: input.currentEpoch,
      });
      const changedWorkstream = this.db.prepare(`UPDATE agent_workstreams
        SET checkpoint_json=?,state=?,state_reason=?,closed_reason=NULL,revision=revision+1,updated_at=?
        WHERE id=? AND owner_user_id=? AND project_id=? AND revision=? AND executor_epoch=?
          AND last_job_id=? AND state NOT IN ('paused','cancelled','completed')`).run(
        JSON.stringify(nextCheckpoint), nextState,
        allResolved ? 'criteria_authoritatively_resolved' : 'criteria_partially_resolved',
        input.now, input.workstreamId, input.localUserId, input.projectId,
        input.expectedRevision, input.currentEpoch, input.jobId,
      ).changes;
      if (changedWorkstream !== 1) {
        const row = this.replaceQuarantinedCoordinatorApplication(job, {
          schemaVersion: 1,
          status: 'stale',
          reason: 'criterion_application_fenced',
          criteria: input.criteria.map(({ criterionId }) => criterionId),
          workstreamRevision: input.expectedRevision,
        }, input.now);
        return { outcome: 'stale', job: row };
      }
      const updated = this.db.prepare(`UPDATE agent_bridge_jobs
        SET native_application_json=?, updated_at=?
        WHERE id=? AND direction='rhythm_to_native' AND native_execution_kind='coordinator'
          AND local_user_id=? AND workstream_id=? AND state='succeeded'
          AND (native_application_json IS NULL OR json_extract(native_application_json, '$.status')='quarantined')
        RETURNING *`).get(
        application, input.now, input.jobId, input.localUserId, input.workstreamId,
      ) as AgentBridgeJobRow | undefined;
      if (!updated) throw new BridgeJobError('criterion_application_conflict');
      return { outcome: 'applied', job: updated };
    }).immediate();
  }

  private replaceQuarantinedCoordinatorApplication(
    job: AgentBridgeJobRow,
    application: Record<string, unknown>,
    now: string,
  ): AgentBridgeJobRow {
    const row = this.db.prepare(`UPDATE agent_bridge_jobs
      SET native_application_json=?, updated_at=?
      WHERE id=? AND direction='rhythm_to_native' AND native_execution_kind='coordinator'
        AND local_user_id=? AND workstream_id=?
        AND (native_application_json IS NULL OR json_extract(native_application_json, '$.status')='quarantined')
      RETURNING *`).get(
      JSON.stringify(application), now, job.id, job.local_user_id, job.workstream_id,
    ) as AgentBridgeJobRow | undefined;
    return row ?? this.getNativeForWorkstream({
      localUserId: job.local_user_id,
      workstreamId: job.workstream_id!,
      jobId: job.id,
    })!;
  }

  acknowledgeCoordinatorEstimate(input: {
    localUserId: number;
    workstreamId: string;
    jobId: string;
    actorUserId: number;
    accepted: boolean;
    chargedEstimateTokens: number;
    authorizedTokens: number;
    remainingAuthorizedTokens: number;
    basis: string;
    uncertainty: string;
    now: string;
  }): AgentBridgeJobRow {
    const current = this.getNativeForWorkstream(input);
    if (!current || current.native_execution_kind !== 'coordinator') throw new BridgeJobError('native_job_not_found', 404);
    let metadata: Record<string, unknown>;
    try { metadata = JSON.parse(current.native_metadata_json ?? '') as Record<string, unknown>; } catch { throw new BridgeJobError('native_metadata_invalid'); }
    const estimate = metadata.estimate;
    if (!estimate || typeof estimate !== 'object') throw new BridgeJobError('native_estimate_unavailable');
    if (!Number.isSafeInteger(input.chargedEstimateTokens) || input.chargedEstimateTokens < 0 ||
        !Number.isSafeInteger(input.authorizedTokens) || input.authorizedTokens < 1 ||
        !Number.isSafeInteger(input.remainingAuthorizedTokens) || input.remainingAuthorizedTokens < 0 ||
        typeof input.basis !== 'string' || typeof input.uncertainty !== 'string') {
      throw new BridgeJobError('native_estimate_acknowledgement_invalid', 400);
    }
    const next = { ...metadata, estimateAcknowledgement: {
      schemaVersion: 1,
      accepted: input.accepted,
      chargedEstimateTokens: input.chargedEstimateTokens,
      units: 'tokens',
      authorizedTokens: input.authorizedTokens,
      remainingAuthorizedTokens: input.remainingAuthorizedTokens,
      basis: input.basis,
      uncertainty: input.uncertainty,
      actorUserId: input.actorUserId,
      acknowledgedAt: input.now,
    } };
    return this.db.prepare(`UPDATE agent_bridge_jobs SET native_metadata_json=?, updated_at=?
      WHERE id=? AND direction='rhythm_to_native' AND native_execution_kind='coordinator'
        AND local_user_id=? AND workstream_id=?
      RETURNING *`).get(JSON.stringify(next), input.now, input.jobId, input.localUserId, input.workstreamId) as AgentBridgeJobRow;
  }

  listCoordinatorByEpoch(hostEpoch: string): AgentBridgeJobRow[] {
    return this.db.prepare(`SELECT * FROM agent_bridge_jobs
      WHERE direction='rhythm_to_native' AND native_execution_kind='coordinator' AND host_epoch=?
      ORDER BY created_at,id`).all(hostEpoch) as AgentBridgeJobRow[];
  }

  reconcileCoordinatorOldEpoch(currentEpoch: string, now: string): AgentBridgeJobRow[] {
    return this.db.prepare(`UPDATE agent_bridge_jobs
      SET state='unknown',state_reason='native_status_unknown',
          native_result_json=COALESCE(native_result_json,?),updated_at=?
      WHERE direction='rhythm_to_native' AND native_execution_kind='coordinator'
        AND host_epoch<>? AND state IN ('queued','claimed','running')
      RETURNING *`).all(
      JSON.stringify({ schemaVersion: 1, status: 'unknown', reason: 'executor_epoch_changed' }), now, currentEpoch,
    ) as AgentBridgeJobRow[];
  }

  /**
   * One boot-reconciliation page. Callers must continue until nextCursor is
   * null; a fixed first page is never evidence that restart reconciliation is
   * complete. This is status-only and cannot claim or wake anything.
   */
  listCoordinatorOutsideEpochPage(input: {
    currentEpoch: string;
    cursor?: CoordinatorEpochCursor;
    limit: number;
  }): { items: AgentBridgeJobRow[]; nextCursor: CoordinatorEpochCursor | null } {
    const limit = Math.max(1, Math.min(100, Math.floor(input.limit)));
    const rows = (input.cursor
      ? this.db.prepare(`SELECT * FROM agent_bridge_jobs
          WHERE direction='rhythm_to_native' AND native_execution_kind='coordinator'
            AND (host_epoch IS NULL OR host_epoch<>?)
            AND state IN ('queued','claimed','running','unknown')
            AND (created_at>? OR (created_at=? AND id>?))
          ORDER BY created_at,id LIMIT ?`).all(
          input.currentEpoch,
          input.cursor.createdAt,
          input.cursor.createdAt,
          input.cursor.id,
          limit + 1,
        )
      : this.db.prepare(`SELECT * FROM agent_bridge_jobs
          WHERE direction='rhythm_to_native' AND native_execution_kind='coordinator'
            AND (host_epoch IS NULL OR host_epoch<>?)
            AND state IN ('queued','claimed','running','unknown')
          ORDER BY created_at,id LIMIT ?`).all(input.currentEpoch, limit + 1)) as AgentBridgeJobRow[];
    const items = rows.slice(0, limit);
    const tail = rows.length > limit ? items.at(-1) : undefined;
    return {
      items,
      nextCursor: tail ? { createdAt: tail.created_at, id: tail.id } : null,
    };
  }

  /** Compatibility read used by older non-admission diagnostics. */
  listCoordinatorOutsideEpoch(currentEpoch: string, limit = 20): AgentBridgeJobRow[] {
    return this.listCoordinatorOutsideEpochPage({ currentEpoch, limit }).items;
  }

  /**
   * A running child may be reattached after a local coordinator restart only
   * after a status-only engine probe proved that exact persisted child live.
   * No prompt is emitted here and the original dispatch/anchor remain intact.
   */
  reattachCoordinatorEpoch(input: {
    localUserId: number; projectId: string; workstreamId: string; jobId: string;
    priorEpoch: string; currentEpoch: string; now: string;
    expectedRevision: number;
    expectedExecutorEpoch: string | null;
    expectedLastJobId: string | null;
    expectedStates: AgentWorkstreamState[];
  }): AgentBridgeJobRow {
    if (input.expectedStates.length === 0) {
      throw new BridgeJobError('workstream_controls_changed');
    }
    const statePlaceholders = input.expectedStates.map(() => '?').join(',');
    const row = this.db.prepare(`UPDATE agent_bridge_jobs
      SET host_epoch=?, native_progress_at=?, updated_at=?
      WHERE id=? AND direction='rhythm_to_native' AND native_execution_kind='coordinator'
        AND local_user_id=? AND workstream_id=? AND host_epoch=? AND state='running'
        AND native_child_session_id IS NOT NULL AND native_child_sdk_session_id IS NOT NULL
        AND native_dispatch_id IS NOT NULL AND native_sdk_user_message_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM agent_workstreams
           WHERE id=? AND owner_user_id=? AND project_id=? AND revision=?
             AND executor_epoch IS ? AND last_job_id IS ?
             AND state IN (${statePlaceholders})
        )
      RETURNING *`).get(
        input.currentEpoch, input.now, input.now, input.jobId, input.localUserId,
        input.workstreamId, input.priorEpoch,
        input.workstreamId, input.localUserId, input.projectId,
        input.expectedRevision, input.expectedExecutorEpoch, input.expectedLastJobId,
        ...input.expectedStates,
      ) as AgentBridgeJobRow | undefined;
    if (!row) throw new BridgeJobError('native_job_not_reattachable');
    return row;
  }

  touchCoordinatorProgress(input: {
    localUserId: number; workstreamId: string; jobId: string; now: string;
  }): AgentBridgeJobRow {
    const row = this.db.prepare(`UPDATE agent_bridge_jobs
      SET native_progress_at=?, updated_at=?
      WHERE id=? AND direction='rhythm_to_native' AND native_execution_kind='coordinator'
        AND local_user_id=? AND workstream_id=? AND state='running'
      RETURNING *`).get(
      input.now, input.now, input.jobId, input.localUserId, input.workstreamId,
    ) as AgentBridgeJobRow | undefined;
    return row ?? this.getNativeForWorkstream(input)!;
  }

  /** Explicit cancellation never asserts a live engine call did not execute. */
  requestCoordinatorCancellation(input: {
    localUserId: number; workstreamId: string; jobId: string; reason?: string; now: string;
  }): AgentBridgeJobRow {
    const current = this.getNativeForWorkstream(input);
    if (!current || current.native_execution_kind !== 'coordinator') {
      throw new BridgeJobError('native_job_not_found', 404);
    }
    if (TERMINAL.has(current.state)) return current;
    if (current.state === 'queued') {
      const cancelled = this.db.prepare(`UPDATE agent_bridge_jobs
        SET state='cancelled', state_reason=NULL, cancel_requested_at=COALESCE(cancel_requested_at, ?),
            native_result_json=?, updated_at=?, terminal_at=?
        WHERE id=? AND direction='rhythm_to_native' AND native_execution_kind='coordinator'
          AND local_user_id=? AND workstream_id=? AND state='queued'
        RETURNING *`).get(
        input.now,
        JSON.stringify({ schemaVersion: 1, status: 'cancelled_before_dispatch' }),
        input.now, input.now, input.jobId, input.localUserId, input.workstreamId,
      ) as AgentBridgeJobRow | undefined;
      return cancelled ?? this.getNativeForWorkstream(input)!;
    }
    const unknown = this.db.prepare(`UPDATE agent_bridge_jobs
      SET state='unknown', state_reason='native_status_unknown',
          cancel_requested_at=COALESCE(cancel_requested_at, ?),
          native_result_json=?, native_progress_at=?, updated_at=?
      WHERE id=? AND direction='rhythm_to_native' AND native_execution_kind='coordinator'
        AND local_user_id=? AND workstream_id=? AND state IN ('claimed','running','unknown')
      RETURNING *`).get(
      input.now,
      JSON.stringify({
        schemaVersion: 1,
        status: 'cancelling',
        reason: input.reason ?? 'termination_unconfirmed',
      }),
      input.now, input.now, input.jobId, input.localUserId, input.workstreamId,
    ) as AgentBridgeJobRow | undefined;
    return unknown ?? this.getNativeForWorkstream(input)!;
  }

  expireCoordinatorQueueDeadline(input: {
    localUserId: number; workstreamId: string; jobId: string; now: string;
  }): AgentBridgeJobRow {
    const current = this.getNativeForWorkstream(input);
    if (!current || current.native_execution_kind !== 'coordinator') {
      throw new BridgeJobError('native_job_not_found', 404);
    }
    if (
      current.state !== 'queued' || !current.native_queue_deadline_at ||
      current.native_queue_deadline_at > input.now
    ) return current;
    const row = this.db.prepare(`UPDATE agent_bridge_jobs
      SET state='failed', state_reason='native_queue_deadline_exceeded',
          native_result_json=?, native_progress_at=?, updated_at=?, terminal_at=?
      WHERE id=? AND direction='rhythm_to_native' AND native_execution_kind='coordinator'
        AND local_user_id=? AND workstream_id=? AND state='queued'
        AND native_queue_deadline_at IS NOT NULL AND native_queue_deadline_at<=?
      RETURNING *`).get(
      JSON.stringify({ schemaVersion: 1, status: 'failed', reason: 'queue_deadline_exceeded' }),
      input.now, input.now, input.now, input.jobId, input.localUserId,
      input.workstreamId, input.now,
    ) as AgentBridgeJobRow | undefined;
    return row ?? this.getNativeForWorkstream(input)!;
  }

  requestNativeCancellation(input: {
    localUserId: number;
    workstreamId: string;
    jobId: string;
    now: string;
  }): AgentBridgeJobRow {
    const current = this.getNativeForWorkstream(input);
    if (!current) throw new BridgeJobError('native_job_not_found', 404);
    if (current.state !== 'unknown') throw new BridgeJobError('native_job_not_unknown');
    return this.db.prepare(`
      UPDATE agent_bridge_jobs
         SET cancel_requested_at=COALESCE(cancel_requested_at, ?), updated_at=?
       WHERE id=? AND direction='rhythm_to_native' AND local_user_id=?
         AND workstream_id=? AND state='unknown'
       RETURNING *
    `).get(
      input.now,
      input.now,
      input.jobId,
      input.localUserId,
      input.workstreamId,
    ) as AgentBridgeJobRow;
  }

  reconcileNativeUnknown(input: {
    localUserId: number;
    workstreamId: string;
    jobId: string;
    receipt: NativeTerminationReceipt;
  }): AgentBridgeJobRow {
    const receipt = validateNativeTerminationReceipt(input.receipt);
    const current = this.getNativeForWorkstream(input);
    if (!current) throw new BridgeJobError('native_job_not_found', 404);
    if (receipt.jobId !== current.id || receipt.hostEpoch !== current.host_epoch) {
      throw new BridgeJobError('native_receipt_mismatch');
    }
    if (current.state !== 'unknown') throw new BridgeJobError('native_job_not_unknown');
    if (receipt.outcome === 'uncertain') return current;
    if (!current.cancel_requested_at) throw new BridgeJobError('native_cancellation_not_requested');
    return this.db.prepare(`
      UPDATE agent_bridge_jobs
         SET state='failed', state_reason='cancelled_after_unknown',
             updated_at=?, terminal_at=?
       WHERE id=? AND direction='rhythm_to_native' AND local_user_id=?
         AND workstream_id=? AND state='unknown' AND cancel_requested_at IS NOT NULL
       RETURNING *
    `).get(
      receipt.observedAt,
      receipt.observedAt,
      input.jobId,
      input.localUserId,
      input.workstreamId,
    ) as AgentBridgeJobRow;
  }

  expireNativeQueueDeadlines(now: string): string[] {
    return (this.db.prepare(`
      UPDATE agent_bridge_jobs
         SET state='failed', state_reason='native_queue_deadline_exceeded',
             updated_at=?, terminal_at=?
       WHERE direction='rhythm_to_native' AND state='queued'
         AND native_queue_deadline_at IS NOT NULL AND native_queue_deadline_at <= ?
       RETURNING id
    `).all(now, now, now) as Array<{ id: string }>).map((row) => row.id).sort();
  }

  get(id: string): AgentBridgeJobRow | null {
    return this.db.prepare(`SELECT * FROM agent_bridge_jobs WHERE id = ?
      AND direction IN ('rhythm_to_hermes','hermes_to_rhythm')`)
      .get(id) as AgentBridgeJobRow | undefined ?? null;
  }

  private getAny(id: string): AgentBridgeJobRow | null {
    return this.db.prepare('SELECT * FROM agent_bridge_jobs WHERE id = ?')
      .get(id) as AgentBridgeJobRow | undefined ?? null;
  }

  view(row: AgentBridgeJobRow): BridgeJobView {
    let progress: BridgeJobView['progress'] = null;
    if (row.progress_json) {
      try {
        const parsed = JSON.parse(row.progress_json) as { steps?: unknown; latestKind?: unknown };
        if (Number.isInteger(parsed.steps) && typeof parsed.latestKind === 'string') {
          progress = { steps: parsed.steps as number, latestKind: parsed.latestKind };
        }
      } catch {
        progress = null;
      }
    }
    return {
      jobId: row.id,
      direction: row.direction,
      state: row.state,
      stateReason: row.state_reason,
      targetAgentId: row.target_agent_id,
      targetRevision: row.target_revision,
      targetRuntime: row.target_runtime,
      depth: row.depth,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      terminalAt: row.terminal_at,
      progress,
      resultAvailable: TERMINAL.has(row.state),
      delivered: row.delivery_state === 'delivered',
    };
  }

  listForParent(input: {
    localUserId: number;
    parentRuntime: 'opencode' | 'hermes';
    parentSessionId: string;
    jobId?: string;
  }): AgentBridgeJobRow[] {
    const suffix = input.jobId ? ' AND id = ?' : '';
    const args = [input.localUserId, input.parentRuntime, input.parentSessionId];
    if (input.jobId) args.push(input.jobId);
    return this.db.prepare(`
      SELECT * FROM agent_bridge_jobs
       WHERE local_user_id = ? AND parent_runtime = ? AND parent_session_id = ?
         AND direction IN ('rhythm_to_hermes','hermes_to_rhythm')${suffix}
       ORDER BY created_at DESC, id DESC
    `).all(...args) as AgentBridgeJobRow[];
  }

  claimNext(input: {
    localUserId: number;
    hermesProfile: 'default';
    runtimeGeneration: string;
    now: string;
  }): { row: AgentBridgeJobRow; leaseToken: string } | null {
    const leaseToken = randomBytes(32).toString('base64url');
    const row = this.db.prepare(`
      UPDATE agent_bridge_jobs
         SET state = 'claimed', child_runtime_instance = ?, lease_token_sha256 = ?,
             lease_expires_at = ?, updated_at = ?
       WHERE id = (
         SELECT id FROM agent_bridge_jobs
          WHERE local_user_id = ? AND hermes_profile = ?
            AND direction = 'rhythm_to_hermes' AND state = 'queued'
          ORDER BY created_at, id LIMIT 1
       )
       RETURNING *
    `).get(
      input.runtimeGeneration,
      digest(leaseToken),
      plusMs(input.now, LEASE_MS),
      input.now,
      input.localUserId,
      input.hermesProfile,
    ) as AgentBridgeJobRow | undefined;
    return row ? { row, leaseToken } : null;
  }

  hasQueued(localUserId: number, hermesProfile: 'default'): boolean {
    return Boolean(this.db.prepare(`
      SELECT 1 FROM agent_bridge_jobs
       WHERE local_user_id=? AND hermes_profile=?
         AND direction='rhythm_to_hermes' AND state='queued'
       LIMIT 1
    `).get(localUserId, hermesProfile));
  }

  report(input: {
    jobId: string;
    leaseToken: string;
    phase: 'running' | 'progress' | 'succeeded' | 'failed' | 'cancelled';
    childSessionKey?: string;
    progress?: { steps: number; latestKind: string };
    resultText?: string;
    errorCode?: string;
    now: string;
  }): AgentBridgeJobRow {
    const current = this.getAny(input.jobId);
    if (!current) throw new BridgeJobError('job_not_found', 404);
    assertLegacyRow(current);
    if (!tokenMatches(input.leaseToken, current.lease_token_sha256)) {
      throw new BridgeJobError('lease_invalid', 403);
    }
    if (TERMINAL.has(current.state)) throw new BridgeJobError('job_terminal');
    if (current.state === 'unknown') {
      if (!input.childSessionKey || input.childSessionKey !== current.child_session_id) {
        throw new BridgeJobError('lease_invalid', 403);
      }
      if (input.phase !== 'succeeded' && input.phase !== 'failed') {
        throw new BridgeJobError('job_unknown');
      }
    }

    const terminal = input.phase === 'succeeded' || input.phase === 'failed' || input.phase === 'cancelled';
    const nextState: AgentBridgeJobState = input.phase === 'progress'
      ? current.state
      : input.phase;
    const result = truncateResult(input.resultText);
    const updated = this.db.prepare(`
      UPDATE agent_bridge_jobs
         SET state = ?, state_reason = ?, child_session_id = COALESCE(?, child_session_id),
             result_text = COALESCE(?, result_text),
             result_truncated = CASE WHEN ? IS NULL THEN result_truncated ELSE ? END,
             progress_json = COALESCE(?, progress_json), lease_expires_at = ?,
             updated_at = ?, terminal_at = CASE WHEN ? THEN ? ELSE terminal_at END
       WHERE id = ? AND state = ?
       RETURNING *
    `).get(
      nextState,
      input.phase === 'failed' ? input.errorCode ?? 'engine_error' : null,
      input.childSessionKey ?? null,
      result.text,
      input.resultText ?? null,
      result.truncated,
      input.progress ? JSON.stringify(input.progress) : null,
      terminal ? current.lease_expires_at : plusMs(input.now, LEASE_MS),
      input.now,
      terminal ? 1 : 0,
      input.now,
      input.jobId,
      current.state,
    ) as AgentBridgeJobRow | undefined;
    if (!updated) return this.get(input.jobId)!;
    return updated;
  }

  assertClaimProjection(input: {
    jobId: string;
    leaseToken: string;
    targetRevision: number;
    runtimeGeneration: string;
    cwd: string | null;
    now: string;
  }): AgentBridgeJobRow {
    const row = this.getAny(input.jobId);
    if (!row) throw new BridgeJobError('job_not_claimed');
    assertLegacyRow(row);
    if (row.state !== 'claimed' && row.state !== 'running') {
      throw new BridgeJobError('job_not_claimed');
    }
    if (!tokenMatches(input.leaseToken, row.lease_token_sha256) ||
        row.child_runtime_instance !== input.runtimeGeneration) {
      throw new BridgeJobError('lease_invalid', 403);
    }
    if (row.cwd !== input.cwd) throw new BridgeJobError('cwd_mismatch');
    if (row.target_revision !== input.targetRevision) {
      this.db.prepare(`
        UPDATE agent_bridge_jobs
           SET state='failed', state_reason='target_revision_changed',
               updated_at=?, terminal_at=?
         WHERE id=? AND state IN ('claimed','running')
      `).run(input.now, input.now, input.jobId);
      throw new BridgeJobError('target_revision_changed');
    }
    return row;
  }

  setChild(jobId: string, childSessionId: string, runtimeInstance = 'local', now = new Date().toISOString()): AgentBridgeJobRow {
    const row = this.db.prepare(`
      UPDATE agent_bridge_jobs
         SET child_session_id=?, child_runtime_instance=?, state='running', updated_at=?
       WHERE id=? AND direction IN ('rhythm_to_hermes','hermes_to_rhythm')
         AND state='queued' AND child_session_id IS NULL
       RETURNING *
    `).get(childSessionId, runtimeInstance, now, jobId) as AgentBridgeJobRow | undefined;
    if (!row) {
      const current = this.getAny(jobId);
      if (current) assertLegacyRow(current);
      throw new BridgeJobError('child_already_set');
    }
    return row;
  }

  completeFromRunner(
    jobId: string,
    result: { status: 'done' | 'error'; result: string; error?: string; errorCode?: string },
    now = new Date().toISOString(),
  ): AgentBridgeJobRow {
    const current = this.getAny(jobId);
    if (!current) throw new BridgeJobError('job_not_found', 404);
    assertLegacyRow(current);
    if (TERMINAL.has(current.state)) return current;
    const stored = truncateResult(result.status === 'done' ? result.result : result.error);
    const row = this.db.prepare(`
      UPDATE agent_bridge_jobs
         SET state=?, state_reason=?, result_text=?, result_truncated=?, updated_at=?, terminal_at=?
       WHERE id=? AND state IN ('queued','running')
       RETURNING *
    `).get(
      result.status === 'done' ? 'succeeded' : 'failed',
      result.status === 'done' ? null : result.errorCode ?? 'engine_error',
      stored.text, stored.truncated, now, now, jobId,
    ) as AgentBridgeJobRow | undefined;
    return row ?? this.get(jobId)!;
  }

  cancel(jobId: string, now = new Date().toISOString()): AgentBridgeJobRow {
    const current = this.getAny(jobId);
    if (!current) throw new BridgeJobError('job_not_found', 404);
    assertLegacyRow(current);
    if (TERMINAL.has(current.state) || current.state === 'unknown') {
      throw new BridgeJobError('job_terminal');
    }
    return this.db.prepare(`
      UPDATE agent_bridge_jobs
         SET state='cancelled', cancel_requested_at=?, updated_at=?, terminal_at=?
       WHERE id=? AND state NOT IN ('succeeded','failed','cancelled')
       RETURNING *
    `).get(now, now, now, jobId) as AgentBridgeJobRow;
  }

  readResult(jobId: string, now = new Date().toISOString()): AgentBridgeJobRow {
    const current = this.getAny(jobId);
    if (!current) throw new BridgeJobError('job_not_found', 404);
    assertLegacyRow(current);
    if (!TERMINAL.has(current.state)) throw new BridgeJobError('job_not_terminal');
    this.db.prepare(`
      UPDATE agent_bridge_jobs
         SET delivery_state='delivered', delivered_at=COALESCE(delivered_at, ?), updated_at=updated_at
       WHERE id=? AND delivery_state <> 'delivered'
    `).run(now, jobId);
    return this.get(jobId)!;
  }

  recoverAfterRestart(now = new Date().toISOString()): void {
    this.db.prepare(`
      UPDATE agent_bridge_jobs
         SET state='unknown', state_reason='api_restarted', updated_at=?
       WHERE direction='hermes_to_rhythm' AND state IN ('queued','running')
    `).run(now);
    this.sweep(now);
  }

  markRuntimeRetired(runtimeGeneration: string, now = new Date().toISOString()): void {
    this.db.prepare(`
      UPDATE agent_bridge_jobs
         SET state='unknown', state_reason='runtime_retired', updated_at=?
       WHERE direction='rhythm_to_hermes' AND child_runtime_instance=?
         AND state IN ('claimed','running')
    `).run(now, runtimeGeneration);
  }

  sweep(now = new Date().toISOString()): string[] {
    const queuedCutoff = new Date(Date.parse(now) - QUEUED_TIMEOUT_MS).toISOString();
    const terminalParents = (this.db.prepare(`
      UPDATE agent_bridge_jobs
         SET state='failed', state_reason='hermes_runtime_timeout', updated_at=?, terminal_at=?
       WHERE direction='rhythm_to_hermes' AND state='queued' AND created_at < ?
       RETURNING parent_session_id
    `).all(now, now, queuedCutoff) as Array<{ parent_session_id: string }>)
      .map((row) => row.parent_session_id);
    this.db.prepare(`
      UPDATE agent_bridge_jobs
         SET state='unknown', state_reason='lease_expired', updated_at=?
       WHERE direction='rhythm_to_hermes' AND state IN ('claimed','running')
         AND lease_expires_at IS NOT NULL AND lease_expires_at < ?
    `).run(now, now);
    return [...new Set(terminalParents)];
  }

  claimNativeCompletedForParent(
    scope: NativeWorkstreamDeliveryScope,
    _now = new Date().toISOString(),
  ): AgentBridgeJobRow[] {
    assertNativeDeliveryScope(scope);
    return this.db.transaction(() => {
      const ids = (this.db.prepare(`
        SELECT j.id
          FROM agent_bridge_jobs j
          JOIN agent_workstreams w ON w.id=j.workstream_id
          JOIN agent_sessions p ON p.id=j.parent_session_id
         WHERE j.direction='rhythm_to_native'
           AND COALESCE(j.native_execution_kind, 'legacy') <> 'coordinator'
           AND j.parent_runtime='opencode'
           AND j.delivery_state='pending'
           AND j.state IN ('succeeded','failed','cancelled')
           AND j.local_user_id=?
           AND j.workstream_project_id=?
           AND j.parent_session_id=?
           AND j.host_epoch=?
           AND w.owner_user_id=j.local_user_id
           AND w.project_id=j.workstream_project_id
           AND w.state='ready'
           AND w.revision=j.workstream_revision
           AND p.owner_user_id=j.local_user_id
           AND p.project_id=j.workstream_project_id
         ORDER BY j.created_at, j.id
      `).all(
        scope.localUserId,
        scope.projectId,
        scope.parentSessionId,
        scope.hostEpoch,
      ) as Array<{ id: string }>).map((candidate) => candidate.id);
      if (ids.length === 0) return [];
      const placeholders = ids.map(() => '?').join(',');
      this.db.prepare(`
        UPDATE agent_bridge_jobs AS j
           SET delivery_state='waking'
         WHERE j.id IN (${placeholders})
           AND j.direction='rhythm_to_native'
           AND COALESCE(j.native_execution_kind, 'legacy') <> 'coordinator'
           AND j.delivery_state='pending'
           AND j.state IN ('succeeded','failed','cancelled')
           AND j.local_user_id=?
           AND j.workstream_project_id=?
           AND j.parent_session_id=?
           AND j.host_epoch=?
           AND EXISTS (
             SELECT 1
               FROM agent_workstreams w
               JOIN agent_sessions p ON p.id=j.parent_session_id
              WHERE w.id=j.workstream_id
                AND w.owner_user_id=j.local_user_id
                AND w.project_id=j.workstream_project_id
                AND w.state='ready'
                AND w.revision=j.workstream_revision
                AND p.owner_user_id=j.local_user_id
                AND p.project_id=j.workstream_project_id
           )
      `).run(
        ...ids,
        scope.localUserId,
        scope.projectId,
        scope.parentSessionId,
        scope.hostEpoch,
      );
      return this.db.prepare(`
        SELECT j.*
          FROM agent_bridge_jobs j
          JOIN agent_workstreams w ON w.id=j.workstream_id
          JOIN agent_sessions p ON p.id=j.parent_session_id
         WHERE j.id IN (${placeholders})
           AND j.direction='rhythm_to_native'
           AND COALESCE(j.native_execution_kind, 'legacy') <> 'coordinator'
           AND j.delivery_state='waking'
           AND j.state IN ('succeeded','failed','cancelled')
           AND j.local_user_id=?
           AND j.workstream_project_id=?
           AND j.parent_session_id=?
           AND j.host_epoch=?
           AND w.owner_user_id=j.local_user_id
           AND w.project_id=j.workstream_project_id
           AND w.state='ready'
           AND w.revision=j.workstream_revision
           AND p.owner_user_id=j.local_user_id
           AND p.project_id=j.workstream_project_id
         ORDER BY j.created_at, j.id
      `).all(
        ...ids,
        scope.localUserId,
        scope.projectId,
        scope.parentSessionId,
        scope.hostEpoch,
      ) as AgentBridgeJobRow[];
    }).immediate();
  }

  listNativeWakingForParent(
    scope: NativeWorkstreamDeliveryScope,
  ): AgentBridgeJobRow[] {
    assertNativeDeliveryScope(scope);
    return this.db.prepare(`
      SELECT j.*
        FROM agent_bridge_jobs j
        JOIN agent_workstreams w ON w.id=j.workstream_id
        JOIN agent_sessions p ON p.id=j.parent_session_id
       WHERE j.direction='rhythm_to_native'
         AND COALESCE(j.native_execution_kind, 'legacy') <> 'coordinator'
         AND j.parent_runtime='opencode'
         AND j.delivery_state='waking'
         AND j.state IN ('succeeded','failed','cancelled')
         AND j.local_user_id=?
         AND j.workstream_project_id=?
         AND j.parent_session_id=?
         AND j.host_epoch=?
         AND w.owner_user_id=j.local_user_id
         AND w.project_id=j.workstream_project_id
         AND w.state='ready'
         AND w.revision=j.workstream_revision
         AND p.owner_user_id=j.local_user_id
         AND p.project_id=j.workstream_project_id
       ORDER BY j.created_at, j.id
    `).all(
      scope.localUserId,
      scope.projectId,
      scope.parentSessionId,
      scope.hostEpoch,
    ) as AgentBridgeJobRow[];
  }

  markNativeDelivered(
    scope: NativeWorkstreamDeliveryScope,
    idsValue: string[],
    now = new Date().toISOString(),
  ): void {
    assertNativeDeliveryScope(scope);
    const ids = nativeDeliveryIds(idsValue);
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(`
      UPDATE agent_bridge_jobs AS j
         SET delivery_state='delivered', delivered_at=COALESCE(delivered_at, ?)
       WHERE j.id IN (${placeholders})
         AND j.direction='rhythm_to_native'
         AND COALESCE(j.native_execution_kind, 'legacy') <> 'coordinator'
         AND j.delivery_state='waking'
         AND j.state IN ('succeeded','failed','cancelled')
         AND j.local_user_id=?
         AND j.workstream_project_id=?
         AND j.parent_session_id=?
         AND j.host_epoch=?
         AND EXISTS (
           SELECT 1
             FROM agent_workstreams w
             JOIN agent_sessions p ON p.id=j.parent_session_id
            WHERE w.id=j.workstream_id
              AND w.owner_user_id=j.local_user_id
              AND w.project_id=j.workstream_project_id
              AND w.state='ready'
              AND w.revision=j.workstream_revision
              AND p.owner_user_id=j.local_user_id
              AND p.project_id=j.workstream_project_id
         )
    `).run(
      now,
      ...ids,
      scope.localUserId,
      scope.projectId,
      scope.parentSessionId,
      scope.hostEpoch,
    );
  }

  releaseNativeDeliveryClaims(
    scope: NativeWorkstreamDeliveryScope,
    idsValue: string[],
  ): void {
    assertNativeDeliveryScope(scope);
    const ids = nativeDeliveryIds(idsValue);
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(`
      UPDATE agent_bridge_jobs AS j
         SET delivery_state='pending'
       WHERE j.id IN (${placeholders})
         AND j.direction='rhythm_to_native'
         AND COALESCE(j.native_execution_kind, 'legacy') <> 'coordinator'
         AND j.delivery_state='waking'
         AND j.state IN ('succeeded','failed','cancelled')
         AND j.local_user_id=?
         AND j.workstream_project_id=?
         AND j.parent_session_id=?
         AND j.host_epoch=?
         AND EXISTS (
           SELECT 1
             FROM agent_workstreams w
             JOIN agent_sessions p ON p.id=j.parent_session_id
            WHERE w.id=j.workstream_id
              AND w.owner_user_id=j.local_user_id
              AND w.project_id=j.workstream_project_id
              AND w.state='ready'
              AND w.revision=j.workstream_revision
              AND p.owner_user_id=j.local_user_id
              AND p.project_id=j.workstream_project_id
         )
    `).run(
      ...ids,
      scope.localUserId,
      scope.projectId,
      scope.parentSessionId,
      scope.hostEpoch,
    );
  }

  listNativeWakingParentIds(
    hostEpoch: string,
    limit = 100,
    afterParentSessionId?: string,
  ): NativeWorkstreamDeliveryScope[] {
    assertSafeReference(hostEpoch, 'native_delivery_epoch_invalid');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new BridgeJobError('native_delivery_limit_invalid', 400);
    }
    if (afterParentSessionId !== undefined) {
      assertSafeReference(afterParentSessionId, 'native_delivery_cursor_invalid');
    }
    const cursorClause = afterParentSessionId === undefined
      ? ''
      : ' AND j.parent_session_id > ?';
    const params: Array<string | number> = [hostEpoch];
    if (afterParentSessionId !== undefined) params.push(afterParentSessionId);
    params.push(limit);
    return (this.db.prepare(`
      SELECT DISTINCT
        j.local_user_id AS localUserId,
        j.workstream_project_id AS projectId,
        j.parent_session_id AS parentSessionId,
        j.host_epoch AS hostEpoch
        FROM agent_bridge_jobs j
        JOIN agent_workstreams w ON w.id=j.workstream_id
        JOIN agent_sessions p ON p.id=j.parent_session_id
       WHERE j.direction='rhythm_to_native'
         AND COALESCE(j.native_execution_kind, 'legacy') <> 'coordinator'
         AND j.parent_runtime='opencode'
         AND j.delivery_state='waking'
         AND j.state IN ('succeeded','failed','cancelled')
         AND j.host_epoch=?${cursorClause}
         AND w.owner_user_id=j.local_user_id
         AND w.project_id=j.workstream_project_id
         AND w.state='ready'
         AND w.revision=j.workstream_revision
         AND p.owner_user_id=j.local_user_id
         AND p.project_id=j.workstream_project_id
       ORDER BY j.parent_session_id
       LIMIT ?
    `).all(...params) as NativeWorkstreamDeliveryScope[]);
  }

  listWakingParentIds(limit = 100): string[] {
    return (this.db.prepare(`
      SELECT DISTINCT parent_session_id
        FROM agent_bridge_jobs
       WHERE parent_runtime='opencode' AND delivery_state='waking'
         AND direction IN ('rhythm_to_hermes','hermes_to_rhythm')
       ORDER BY parent_session_id LIMIT ?
    `).all(limit) as Array<{ parent_session_id: string }>).map((row) => row.parent_session_id);
  }

  claimCompletedForParent(
    parentSessionId: string,
    now = new Date().toISOString(),
  ): AgentBridgeJobRow[] {
    const unknownCutoff = new Date(Date.parse(now) - 15 * 60_000).toISOString();
    const ids = (this.db.prepare(`
      SELECT id FROM agent_bridge_jobs
       WHERE parent_runtime='opencode' AND parent_session_id=? AND delivery_state='pending'
         AND direction IN ('rhythm_to_hermes','hermes_to_rhythm')
         AND (state IN ('succeeded','failed','cancelled')
           OR (state='unknown' AND updated_at < ?))
       ORDER BY created_at, id
    `).all(parentSessionId, unknownCutoff) as Array<{ id: string }>).map((row) => row.id);
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(`UPDATE agent_bridge_jobs SET delivery_state='waking'
      WHERE id IN (${placeholders}) AND delivery_state='pending'
        AND direction IN ('rhythm_to_hermes','hermes_to_rhythm')`).run(...ids);
    return this.db.prepare(`SELECT * FROM agent_bridge_jobs
      WHERE id IN (${placeholders}) AND delivery_state='waking'
        AND direction IN ('rhythm_to_hermes','hermes_to_rhythm')
      ORDER BY created_at, id`).all(...ids) as AgentBridgeJobRow[];
  }

  listWakingForParent(parentSessionId: string): AgentBridgeJobRow[] {
    return this.db.prepare(`SELECT * FROM agent_bridge_jobs
      WHERE parent_runtime='opencode' AND parent_session_id=? AND delivery_state='waking'
        AND direction IN ('rhythm_to_hermes','hermes_to_rhythm')
      ORDER BY created_at, id`)
      .all(parentSessionId) as AgentBridgeJobRow[];
  }

  markDelivered(ids: string[], now = new Date().toISOString()): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(`UPDATE agent_bridge_jobs
      SET delivery_state='delivered', delivered_at=COALESCE(delivered_at, ?)
      WHERE id IN (${placeholders}) AND delivery_state='waking'
        AND direction IN ('rhythm_to_hermes','hermes_to_rhythm')`)
      .run(now, ...ids);
  }

  releaseDeliveryClaims(ids: string[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(`UPDATE agent_bridge_jobs SET delivery_state='pending'
      WHERE id IN (${placeholders}) AND delivery_state='waking'
        AND direction IN ('rhythm_to_hermes','hermes_to_rhythm')`)
      .run(...ids);
  }
}
