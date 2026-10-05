import { AppError } from '../errors/app_error';
import type { PermissionMode } from '../models/agent_session';
import type { StructuredAgentSessionMessage } from '../models/agent_session';
import type { NativeWorkstreamJobReason } from '../shared_agents/native_workstream_job_contract';

/**
 * R16 is deliberately a conversation binding, not another workflow engine.
 * The persisted record is a small, owner/project-bound control plane stored on
 * an existing chat session.  It never stores a transcript, model output,
 * Dayflow body/title/URL, task notes, or worker prose.
 */
/**
 * Version 3 adds durable, transcript-backed user-control acknowledgements.
 * They are normal input rows in the existing session transcript, never
 * fabricated SDK or assistant messages. Versions 1 and 2 remain readable
 * below so an accepted C1/C2 root is never treated as blank after upgrade.
 */
export const COORDINATOR_CONVERSATION_SCHEMA_VERSION = 3 as const;
export const COORDINATOR_CONVERSATION_TIME_ZONE = 'America/Los_Angeles' as const;
export const MAX_COORDINATOR_CONVERSATION_GOALS = 100;
export const MAX_COORDINATOR_CONVERSATION_COMMANDS = 100;
export const MAX_COORDINATOR_CONVERSATION_AUTHORIZATIONS = 100;
export const MAX_COORDINATOR_MESSAGE_CHARS = 8_000;
export const MAX_COORDINATOR_GOAL_CHARS = 4_000;
/** A future model adapter may receive no more than this many UTF-8 context bytes. */
export const MAX_COORDINATOR_MODEL_CONTEXT_BYTES = 8_000;
/** Status strings are separately bounded before they can enter any model context. */
export const MAX_COORDINATOR_CONTEXT_TEXT_CHARS = 1_024;

export type CoordinatorConversationGoalState = 'captured' | 'linked' | 'blocked';
export type CoordinatorFiniteTurnCount = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface CoordinatorConversationGoal {
  id: string;
  /** The exact client command key which made this durable user control. */
  commandKey: string;
  /** SHA-256 of the bounded, normalized add-goal intent. */
  intentHash: string;
  /** User-authored goal control text; it is not model output or a transcript. */
  objective: string;
  state: CoordinatorConversationGoalState;
  /** Filled only by a future C2 adapter after an owned workstream binding. */
  linkedWorkstreamId: string | null;
  /**
   * A grant is fenced to this authored goal, not to the collection-wide UI
   * revision. Adding a second independent idea therefore cannot consume or
   * revoke a still-current first goal grant.
   */
  revision: number;
  createdAt: string;
}

export type CoordinatorConversationCommand =
  /** A durable literal goal with one optional normal-transcript input row. */
  {
  key: string;
  intentHash: string;
  kind: 'add_goal';
  goalId: string;
  /** Null only for records normalized from schema 1/2. */
  messageId: number | null;
  }
  /** A deterministic status question has a durable user input acknowledgement. */
  | {
    key: string;
    intentHash: string;
    kind: 'status';
    messageId: number;
  }
  /**
   * An ordinary foreground prompt is retained by the real SDK/event bridge,
   * not copied here. This reservation only gives its transport exactly-once
   * uncertainty semantics and contains no user text.
   */
  | {
    key: string;
    intentHash: string;
    kind: 'foreground';
    state: 'reserved' | 'accepted' | 'uncertain';
  };

export interface CoordinatorConversationModelPreference {
  providerId: string;
  modelId: string;
  /** The existing chat/session policy, never a coordinator fallback. */
  mode: 'auto' | 'fixed';
}

/**
 * An explicit user control authorizes a single managed turn.  A reasoning
 * preference is deliberately absent: it is not consent for total input,
 * output, reasoning, cache, or overrun usage.
 */
export interface CoordinatorConversationAdmissionRequest {
  commandKey: string;
  totalTokenAuthorization: number;
  /** One outer explicit grant funds a finite, independently accounted sequence. */
  maxTurns: CoordinatorFiniteTurnCount;
  /** Every bridge worker remains maxTurns:1; this is the per-worker wall bound. */
  maxWallTimeSeconds: number;
  /** Short-lived outer-control expiry, bounded to one hour server-side. */
  expiresInSeconds: number;
  acknowledgesSoftTotalTokenAuthorization: true;
  /** A new purpose is required before a read-only grant can ever expose edit/write. */
  purpose: 'decompose' | 'continue' | 'execute';
  /** Present and true only for the fresh scoped-workspace execution purpose. */
  acknowledgesScopedWorkspaceExecution?: true;
}

/**
 * A durable, opaque snapshot of one server-derived execution target. It has
 * no filesystem path, tool list, rule body, browser identity, or grant token.
 */
export interface CoordinatorConversationExecutionScope {
  schemaVersion: 1;
  kind: 'scoped_workspace_execution';
  projectId: string;
  workspaceGeneration: number;
  profileId: string;
  profileRevision: number;
  targetFingerprint: string;
  scopeSignature: string;
}

/**
 * A durable finite admission. This is not recurring consent: one explicit
 * authenticated outer control may fund only its stored 1..8 ordinals before
 * expiry, while the bridge ledger retains the workstream-wide total-token cap
 * and actual usage.
 */
export interface CoordinatorConversationContinuationAuthority {
  schemaVersion: 5;
  authorizationId: string;
  authorizationCommandKey: string;
  goalId: string;
  projectId: string;
  workstreamId: string;
  goalRevision: number;
  /** Root-chat/profile/workstream snapshots are rechecked before dispatch. */
  parentSessionId: string;
  profileId: string;
  profileRevision: number;
  workstreamRevision: number;
  issuedFromControlRevision: number;
  issuedAt: string;
  expiresAt: string;
  requestedModel: CoordinatorConversationModelPreference;
  /**
   * Current server-owned permission/approval proof captured with the explicit
   * finite acknowledgement.  Older schema-2/3 controls remain readable for
   * status, but deserialize to null and can never fund another SDK exposure.
   */
  permissionAuthority: CoordinatorConversationPermissionAuthority | null;
  maxTurns: CoordinatorFiniteTurnCount;
  /** Reserved before each asynchronous bridge dispatch; never decremented. */
  consumedTurns: number;
  totalTokenAuthorization: number;
  maxWallTimeSeconds: number;
  acknowledgement: {
    schemaVersion: 1;
    actorUserId: number;
    acknowledgedAt: string;
    kind: 'soft_total_tokens';
    includes: ['input', 'output', 'reasoning', 'cache'];
    outputCapEnforced: false;
  };
  purpose: 'decompose' | 'continue' | 'execute';
  /** Null for every legacy/read-only authority; execute requires this exact snapshot. */
  executionScope: CoordinatorConversationExecutionScope | null;
  /** Reference-only Dayflow state, never observed content or a model grant. */
  dayflowDependency: CoordinatorDayflowDependencyManifest | null;
  status: 'authorized' | 'consumed' | 'blocked';
}

/**
 * Permission authority is intentionally separate from model/profile selection:
 * a changed parent mode is a fresh privilege decision even when the profile
 * and model pin have not moved.  The worker fields bind the only supported
 * finite-worker shape; no browser can choose or loosen them.
 */
export interface CoordinatorConversationPermissionAuthority {
  schemaVersion: 1;
  parent: {
    sessionId: string;
    permissionMode: PermissionMode;
    approvalBypassExplicit: boolean;
  };
  worker: {
    parentSessionId: string;
    permissionMode: 'default';
    managedReadOnly: true;
  };
}

export interface CoordinatorConversation {
  schemaVersion: 3;
  id: string;
  /** Existing, root chat session; no engine/SDK id is stored here. */
  sessionId: string;
  ownerUserId: number;
  projectId: string;
  /** User-control CAS generation. Model/receipt observations never increment it. */
  controlRevision: number;
  /** Exactly one root per owner is server-designated for the Rhythm entry. */
  primaryOwnerRoot: boolean;
  goals: CoordinatorConversationGoal[];
  commandDedupe: CoordinatorConversationCommand[];
  /** Default-off finite controls, independently bound to exact authored goals. */
  continuations: CoordinatorConversationContinuationAuthority[];
  createdAt: string;
  updatedAt: string;
}

export type CoordinatorContextAvailability =
  | 'available'
  | 'unavailable'
  | 'not_configured';

export type CoordinatorContextUnavailableReason =
  | 'not_configured'
  | 'authorization_unavailable'
  | 'source_unavailable'
  | 'dependency_unqualified';

/**
 * A current source may have many rows while the conversational projection is
 * intentionally bounded. This records a deterministic complete scan plus a
 * selected relevance window, so an empty selected list is never misread as an
 * assertion that the owner has no other records.
 */
export interface CoordinatorContextCoverage {
  strategy: 'complete' | 'bounded_relevance';
  totalItems: number;
  selectedItems: number;
  maxItems: number;
}

/**
 * A source may call an empty list "available" only when it attests that the
 * owner/project-scoped read completed. A thrown, partial, or malformed adapter
 * result is never silently reshaped into an authoritative empty context.
 */
export type CoordinatorContextRead<T> =
  | {
    availability: 'available';
    reason: null;
    complete: true;
    authoritative: true;
    observedAt: string;
    sourceVersion: string;
    coverage?: CoordinatorContextCoverage;
    /** Present only for strict Dayflow reference reads; never raw evidence. */
    dependencyManifest?: CoordinatorDayflowDependencyManifest;
    items: T[];
  }
  | {
    /**
     * Legacy status-only compatibility. C1 may display nonempty items, but a
     * C2 model adapter must reject it because it carries no complete scoped
     * observation proof. Empty legacy replies are rejected outright.
     */
    availability: 'available';
    reason: null;
    complete: false;
    authoritative: false;
    items: T[];
  }
  | {
    availability: 'unavailable';
    reason: Exclude<CoordinatorContextUnavailableReason, 'not_configured'>;
    complete: false;
    authoritative: false;
    items: [];
  }
  | {
    availability: 'not_configured';
    reason: 'not_configured';
    complete: false;
    authoritative: false;
    items: [];
  };

/** Authorized task projection. `updatedAt` is intentionally absent: it is not completion evidence. */
export interface CoordinatorTaskContextItem {
  id: string;
  title: string;
  status: 'open' | 'in_progress' | 'waiting_for_reply' | 'done' | 'deferred';
  dueDate: string | null;
  scheduledDate: string | null;
  priority: number | null;
}

/** The adapter must exclude null/global/unowned schedule rows before returning them. */
export interface CoordinatorScheduleContextItem {
  id: string;
  name: string;
  enabled: boolean;
  nextRunAt: string | null;
  createdByUserId: number;
}

/** Ordinary Rhythm recurrence metadata, not generated task completion proof. */
export interface CoordinatorRhythmContextItem {
  id: string;
  title: string;
  frequency: 'weekly' | 'monthly' | 'annual';
  enabled: boolean;
  ownerUserId: number | null;
}

/**
 * Only existing server-owned native reason codes may cross into a future
 * model context. All other persisted/free-text values become unknown_reason.
 */
export type CoordinatorWorkstreamStateReason = NativeWorkstreamJobReason | 'unknown_reason' | null;

export interface CoordinatorWorkstreamContextItem {
  id: string;
  state: 'ready' | 'queued' | 'running' | 'blocked' | 'paused' | 'cancelled' | 'completed' | 'unknown';
  stateReason: CoordinatorWorkstreamStateReason;
  revision: number;
  lastJobId: string | null;
}

/**
 * A status-only receipt. It intentionally has no result prose, tool output,
 * provider error, artifact body, or raw source content.
 */
export interface CoordinatorReceiptContextItem {
  id: string;
  workstreamId: string;
  workstreamRevision: number;
  jobId: string;
  executionState: 'succeeded' | 'failed' | 'cancelled' | 'unknown' | 'running' | 'queued';
  criterionState: 'pending' | 'blocked' | 'verified' | 'waived';
  authority: 'server_receipt' | 'human_waiver' | 'unqualified';
  recordedAt: string;
  actualUsage: {
    state: 'actual' | 'unknown' | 'overshoot';
    tokens: number | null;
  };
}

/**
 * Dayflow/manual activity is reference-only. No observation title, URL, body,
 * app title, or inferred task progress may cross this contract.
 */
export interface CoordinatorManualActivityReference {
  sourceId: string;
  expectedVersion: string;
  observedAt: string;
  state: 'active' | 'unavailable' | 'retracted';
  /** Strict V1 envelope metadata; there is intentionally no source body/title/URL. */
  namespace: string;
  sourceInstance: string;
  sourceRevision: string;
  sourceHash: string;
  canonicalId: string;
  canonicalVersion: string;
  consentGeneration: string;
  configurationGeneration: string;
  expiresAt: string;
  eligibility: 'active';
}

/**
 * Server-produced dependency fingerprint for revalidation only.  It is not a
 * raw Dayflow observation and does not grant a model turn by itself.
 */
export interface CoordinatorDayflowDependencyManifest {
  schemaVersion: 1;
  namespace: string;
  sourceInstance: string;
  consentGeneration: string;
  configurationGeneration: string;
  sourceVersion: string;
  /** Current producer scan fingerprint, retained even for an authoritative empty scan. */
  sourceRevision: string;
  sourceHash: string;
  expiresAt: string;
  observedAt: string;
  references: Array<{
    canonicalId: string;
    canonicalVersion: string;
    sourceRevision: string;
    sourceHash: string;
    expiresAt: string;
  }>;
}

export interface CoordinatorConversationContextScope {
  ownerUserId: number;
  projectId: string;
  conversationId: string;
  now: Date;
}

export interface CoordinatorConversationContextAdapters {
  tasks: {
    read(scope: CoordinatorConversationContextScope): Promise<CoordinatorContextRead<CoordinatorTaskContextItem>>;
  };
  schedules: {
    read(scope: CoordinatorConversationContextScope): Promise<CoordinatorContextRead<CoordinatorScheduleContextItem>>;
  };
  rhythms?: {
    read(scope: CoordinatorConversationContextScope): Promise<CoordinatorContextRead<CoordinatorRhythmContextItem>>;
  };
  workstreams: {
    read(scope: CoordinatorConversationContextScope): Promise<CoordinatorContextRead<CoordinatorWorkstreamContextItem>>;
  };
  receipts: {
    read(scope: CoordinatorConversationContextScope): Promise<CoordinatorContextRead<CoordinatorReceiptContextItem>>;
  };
  /** Optional by design: inactive/unavailable Dayflow never blocks chat status. */
  manualActivity?: {
    read(scope: CoordinatorConversationContextScope): Promise<CoordinatorContextRead<CoordinatorManualActivityReference>>;
  };
}

export interface CoordinatorConversationContextProjection {
  timeZone: typeof COORDINATOR_CONVERSATION_TIME_ZONE;
  asOf: string;
  today: string;
  yesterday: string;
  availability: Record<'tasks' | 'schedules' | 'rhythms' | 'workstreams' | 'receipts' | 'manualActivity', {
    state: CoordinatorContextAvailability;
    reason: CoordinatorContextUnavailableReason | null;
  }>;
  /** Explicit selected-window coverage for ordinary sources; null when the adapter supplied no such proof. */
  coverage: Record<'tasks' | 'schedules' | 'rhythms' | 'workstreams' | 'receipts' | 'manualActivity', CoordinatorContextCoverage | null>;
  todayTasks: CoordinatorTaskContextItem[];
  waitingForReply: CoordinatorTaskContextItem[];
  /** Done is current state only unless a qualifying receipt supplies a date. */
  doneWithUnknownCompletionDate: CoordinatorTaskContextItem[];
  scheduledPriorities: CoordinatorScheduleContextItem[];
  activeRhythms: CoordinatorRhythmContextItem[];
  activeWorkstreams: CoordinatorWorkstreamContextItem[];
  executionSucceededGoalUnverified: Array<Pick<CoordinatorReceiptContextItem,
    'id' | 'workstreamId' | 'jobId' | 'recordedAt' | 'actualUsage'>>;
  /** Receipts for an earlier workstream revision remain inspectable, never current verification. */
  staleExecutions: Array<Pick<CoordinatorReceiptContextItem,
    'id' | 'workstreamId' | 'workstreamRevision' | 'jobId' | 'executionState' | 'criterionState' | 'recordedAt' | 'actualUsage'>>;
  verifiedYesterday: Array<Pick<CoordinatorReceiptContextItem,
    'id' | 'workstreamId' | 'jobId' | 'criterionState' | 'recordedAt'>>;
  usageHolds: Array<Pick<CoordinatorReceiptContextItem,
    'id' | 'workstreamId' | 'jobId' | 'actualUsage'>>;
  /** Bounded status-only receipts; never worker prose or source bodies. */
  receipts: CoordinatorReceiptContextItem[];
  /** Opaque references only; the C2 adapter must capture dependencies before model exposure. */
  manualActivity: CoordinatorManualActivityReference[];
  /** Complete Dayflow envelope retained for revalidation, including an authoritative empty scan. */
  manualActivityDependency: CoordinatorDayflowDependencyManifest | null;
  /**
   * C1 never invokes a model port. C2 must still refuse an oversized context
   * before dependency capture or any SDK-facing adapter is called.
   */
  modelContext:
    | { kind: 'ready'; bytes: number }
    | { kind: 'blocked'; reason: 'context_too_large' | 'context_unqualified'; bytes: number };
}

export interface CoordinatorConversationIntentStatus {
  kind: 'status';
}

export interface CoordinatorConversationIntentAddGoal {
  kind: 'add_goal';
  objective: string;
}

export interface CoordinatorConversationIntentPreparePlan {
  kind: 'prepare_plan';
  goalId: string;
}

export type CoordinatorConversationIntent =
  | CoordinatorConversationIntentStatus
  | CoordinatorConversationIntentAddGoal
  | CoordinatorConversationIntentPreparePlan;

/**
 * C2/C3 may eventually bind this to an existing, qualified normal-chat turn.
 * C1 deliberately refuses it even when injected: no durable admission, actual
 * usage hold, fresh-session proof, or append-before-exposure SDK guard exists
 * in this owned slice.
 */
export interface CoordinatorConversationIntentPort {
  interpret(input: {
    message: string;
    conversation: CoordinatorConversation;
    context: CoordinatorConversationContextProjection;
    requestedModel: CoordinatorConversationModelPreference;
  }): Promise<CoordinatorConversationIntent>;
}

/** Existing session policy provider; no implicit model/provider selection is allowed. */
export interface CoordinatorConversationModelPreferencesPort {
  resolve(input: {
    ownerUserId: number;
    projectId: string;
    sessionId: string;
  }): Promise<CoordinatorConversationModelPreference | null>;
}

export type CoordinatorPlanningPreparation =
  | { kind: 'prepared'; planReference: string }
  | { kind: 'blocked'; reason: 'budget_unknown' | 'budget_overshoot' | 'authority_revoked' | 'context_unavailable' };

/**
 * C2's future model-facing entrypoint. C1 deliberately refuses it even when
 * injected; a typed port alone is not durable admission or usage proof.
 */
export interface CoordinatorConversationPlannerPort {
  prepare(input: {
    conversation: CoordinatorConversation;
    goal: CoordinatorConversationGoal;
    authority: CoordinatorConversationContinuationAuthority;
    requestedModel: CoordinatorConversationModelPreference;
    context: CoordinatorConversationContextProjection;
    /** Durable append-before-exposure proof supplied by C2, never browser data. */
    referenceManifestId: string;
    /** The conservative default until retained-history exclusion is qualified. */
    sessionPolicy: 'fresh_managed_session_required';
  }): Promise<CoordinatorPlanningPreparation>;
}

/**
 * C2 must capture the actual current source references before it lets a
 * planning/model adapter inspect context. The source-only C1 service never
 * calls this port: a fake manifest cannot qualify model exposure.
 */
export interface CoordinatorConversationContextExposurePort {
  captureForPlanning(input: {
    conversation: CoordinatorConversation;
    context: CoordinatorConversationContextProjection;
  }): Promise<
    | { kind: 'ready'; referenceManifestId: string; sessionPolicy: 'fresh_managed_session_required' }
    | { kind: 'blocked'; reason: 'dependency_unqualified' | 'persistence_unavailable' | 'history_nonreusable' }
  >;
}

/**
 * Status-only port for C2 terminal receipts. It cannot request another turn,
 * wake a parent, change a budget hold, or convert worker success into goal
 * completion. The C2 owner may call it after authoritative reconciliation.
 */
export interface CoordinatorConversationContinuationPort {
  inspectTerminal(input: {
    conversation: CoordinatorConversation;
    receipt: CoordinatorReceiptContextItem;
  }): Promise<{
    state: 'status_only' | 'unknown_hold' | 'budget_hold' | 'stale';
  }>;
}

export interface CoordinatorConversationOpenRequest {
  sessionId: string;
  projectId: string;
}

/** Browser may suggest only an already-authorized project for first root selection. */
export interface CoordinatorConversationResolveRequest {
  projectId?: string;
}

/**
 * Closed bootstrap command. `profileId` is an opaque selection among the
 * server-returned current eligible choices; it carries no model, path, scope,
 * grant, or other execution authority.
 */
export interface CoordinatorConversationSetupRequest {
  commandKey: string;
  profileId?: string;
}

/** Public bootstrap selection metadata; profile capability details stay server-only. */
export interface CoordinatorConversationSetupProfileChoice {
  id: string;
  label: string;
}

export interface CoordinatorConversationMessageRequest {
  sessionId: string;
  projectId: string;
  expectedControlRevision: number;
  commandKey: string;
  message: string;
}

/**
 * Bounded local transcript page for the designated Rhythm root. The browser
 * gets only existing persisted events; it must never manufacture an assistant
 * bubble from a status card, command acknowledgement, or a planned worker.
 */
export interface CoordinatorConversationHistoryRequest {
  sessionId: string;
  projectId: string;
  limit: number;
  beforeId: number | undefined;
}

export interface CoordinatorConversationHistoryPage {
  kind: 'history';
  conversation: CoordinatorConversation;
  /** Existing agent_session_messages rows, chronological within this page. */
  messages: StructuredAgentSessionMessage[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CoordinatorConversationAddGoalRequest {
  sessionId: string;
  projectId: string;
  expectedControlRevision: number;
  commandKey: string;
  objective: string;
}

export interface CoordinatorConversationPreparePlanRequest {
  sessionId: string;
  projectId: string;
  expectedControlRevision: number;
  goalId: string;
  /** Missing means an honest authority-required hold, never inferred consent. */
  admission: CoordinatorConversationAdmissionRequest | null;
}

/**
 * A follow-up dispatch uses the already durable finite authority. It accepts
 * no model, budget, source, or grant fields, so it cannot raise or rewrite the
 * initial total-token acknowledgement.
 */
export interface CoordinatorConversationContinuePlanRequest {
  sessionId: string;
  projectId: string;
  expectedControlRevision: number;
  goalId: string;
  authorizationId: string;
}

function plain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function nonEmptyString(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw AppError.badRequest(`${name} must be a non-empty bounded string`);
  }
  return value;
}

function opaqueId(value: unknown, name: string): string {
  const parsed = nonEmptyString(value, name, 256);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(parsed)) {
    throw AppError.badRequest(`${name} is invalid`);
  }
  return parsed;
}

function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw AppError.badRequest('expectedControlRevision must be a safe integer');
  }
  return value as number;
}

export function parseCoordinatorConversationOpen(value: unknown): CoordinatorConversationOpenRequest {
  if (!plain(value) || !exactKeys(value, ['sessionId', 'projectId'])) {
    throw AppError.badRequest('invalid coordinator conversation open payload');
  }
  return {
    sessionId: opaqueId(value.sessionId, 'sessionId'),
    projectId: opaqueId(value.projectId, 'projectId'),
  };
}

export function parseCoordinatorConversationResolve(value: unknown): CoordinatorConversationResolveRequest {
  if (!plain(value) || !exactKeys(value, ['projectId'])) {
    throw AppError.badRequest('invalid coordinator conversation resolve payload');
  }
  if (value.projectId === undefined) return {};
  return { projectId: opaqueId(value.projectId, 'projectId') };
}

export function parseCoordinatorConversationSetup(value: unknown): CoordinatorConversationSetupRequest {
  if (!plain(value) || !exactKeys(value, ['commandKey', 'profileId'])) {
    throw AppError.badRequest('invalid coordinator conversation setup payload');
  }
  return {
    commandKey: opaqueId(value.commandKey, 'commandKey'),
    profileId: value.profileId === undefined ? undefined : opaqueId(value.profileId, 'profileId'),
  };
}

export function parseCoordinatorConversationMessage(value: unknown): CoordinatorConversationMessageRequest {
  if (!plain(value) || !exactKeys(value, ['sessionId', 'projectId', 'expectedControlRevision', 'commandKey', 'message'])) {
    throw AppError.badRequest('invalid coordinator conversation message payload');
  }
  return {
    sessionId: opaqueId(value.sessionId, 'sessionId'),
    projectId: opaqueId(value.projectId, 'projectId'),
    expectedControlRevision: revision(value.expectedControlRevision),
    commandKey: opaqueId(value.commandKey, 'commandKey'),
    message: nonEmptyString(value.message, 'message', MAX_COORDINATOR_MESSAGE_CHARS),
  };
}

/** Parse a bounded local transcript page; this never asks the engine for history. */
export function parseCoordinatorConversationHistory(value: unknown): CoordinatorConversationHistoryRequest {
  if (!plain(value) ||
      !Object.keys(value).every((key) => ['sessionId', 'projectId', 'limit', 'beforeId'].includes(key)) ||
      !Object.prototype.hasOwnProperty.call(value, 'sessionId') ||
      !Object.prototype.hasOwnProperty.call(value, 'projectId') ||
      !Object.prototype.hasOwnProperty.call(value, 'limit')) {
    throw AppError.badRequest('invalid coordinator conversation history payload');
  }
  if (!Number.isSafeInteger(value.limit) || (value.limit as number) < 1 || (value.limit as number) > 100) {
    throw AppError.badRequest('history limit must be a safe bounded integer');
  }
  const beforeId = value.beforeId;
  if (beforeId !== undefined &&
      (!Number.isSafeInteger(beforeId) || (beforeId as number) < 1)) {
    throw AppError.badRequest('history beforeId must be a safe positive integer');
  }
  return {
    sessionId: opaqueId(value.sessionId, 'sessionId'),
    projectId: opaqueId(value.projectId, 'projectId'),
    limit: value.limit as number,
    beforeId: beforeId === undefined ? undefined : beforeId as number,
  };
}

export function parseCoordinatorConversationAddGoal(value: unknown): CoordinatorConversationAddGoalRequest {
  if (!plain(value) || !exactKeys(value, ['sessionId', 'projectId', 'expectedControlRevision', 'commandKey', 'objective'])) {
    throw AppError.badRequest('invalid coordinator conversation goal payload');
  }
  return {
    sessionId: opaqueId(value.sessionId, 'sessionId'),
    projectId: opaqueId(value.projectId, 'projectId'),
    expectedControlRevision: revision(value.expectedControlRevision),
    commandKey: opaqueId(value.commandKey, 'commandKey'),
    objective: nonEmptyString(value.objective, 'objective', MAX_COORDINATOR_GOAL_CHARS),
  };
}

export function parseCoordinatorConversationPreparePlan(value: unknown): CoordinatorConversationPreparePlanRequest {
  if (!plain(value) || !exactKeys(value, ['sessionId', 'projectId', 'expectedControlRevision', 'goalId', 'admission'])) {
    throw AppError.badRequest('invalid coordinator conversation plan payload');
  }
  return {
    sessionId: opaqueId(value.sessionId, 'sessionId'),
    projectId: opaqueId(value.projectId, 'projectId'),
    expectedControlRevision: revision(value.expectedControlRevision),
    goalId: opaqueId(value.goalId, 'goalId'),
    admission: value.admission === undefined || value.admission === null
      ? null
      : parseCoordinatorConversationAdmission(value.admission),
  };
}

function parseCoordinatorConversationAdmission(value: unknown): CoordinatorConversationAdmissionRequest {
  if (!plain(value)) {
    throw AppError.badRequest('invalid coordinator conversation admission payload');
  }
  const execute = value.purpose === 'execute';
  if (!exactKeys(value, execute
    ? [
      'commandKey', 'totalTokenAuthorization', 'maxTurns', 'maxWallTimeSeconds', 'expiresInSeconds',
      'acknowledgesSoftTotalTokenAuthorization', 'purpose', 'acknowledgesScopedWorkspaceExecution',
    ]
    : [
      'commandKey', 'totalTokenAuthorization', 'maxTurns', 'maxWallTimeSeconds', 'expiresInSeconds',
      'acknowledgesSoftTotalTokenAuthorization', 'purpose',
    ])) {
    throw AppError.badRequest('invalid coordinator conversation admission payload');
  }
  if (
    value.acknowledgesSoftTotalTokenAuthorization !== true ||
    !Number.isSafeInteger(value.totalTokenAuthorization) || (value.totalTokenAuthorization as number) < 1 ||
    (value.totalTokenAuthorization as number) > 2_000_000 ||
    !isFiniteTurnCount(value.maxTurns) ||
    !Number.isSafeInteger(value.maxWallTimeSeconds) || (value.maxWallTimeSeconds as number) < 30 ||
    (value.maxWallTimeSeconds as number) > 300 ||
    !Number.isSafeInteger(value.expiresInSeconds) || (value.expiresInSeconds as number) < 30 ||
    (value.expiresInSeconds as number) > 60 * 60 ||
    (value.purpose !== 'decompose' && value.purpose !== 'continue' && value.purpose !== 'execute') ||
    (execute && value.acknowledgesScopedWorkspaceExecution !== true)
  ) {
    throw AppError.badRequest('invalid coordinator conversation admission payload');
  }
  return {
    commandKey: opaqueId(value.commandKey, 'admission.commandKey'),
    totalTokenAuthorization: value.totalTokenAuthorization as number,
    maxTurns: value.maxTurns as CoordinatorFiniteTurnCount,
    maxWallTimeSeconds: value.maxWallTimeSeconds as number,
    expiresInSeconds: value.expiresInSeconds as number,
    acknowledgesSoftTotalTokenAuthorization: true,
    purpose: value.purpose,
    ...(execute ? { acknowledgesScopedWorkspaceExecution: true as const } : {}),
  };
}

function isFiniteTurnCount(value: unknown): value is CoordinatorFiniteTurnCount {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 8;
}

export function parseCoordinatorConversationContinuePlan(value: unknown): CoordinatorConversationContinuePlanRequest {
  if (!plain(value) || !exactKeys(value, [
    'sessionId', 'projectId', 'expectedControlRevision', 'goalId', 'authorizationId',
  ])) {
    throw AppError.badRequest('invalid coordinator conversation continuation payload');
  }
  return {
    sessionId: opaqueId(value.sessionId, 'sessionId'),
    projectId: opaqueId(value.projectId, 'projectId'),
    expectedControlRevision: revision(value.expectedControlRevision),
    goalId: opaqueId(value.goalId, 'goalId'),
    authorizationId: opaqueId(value.authorizationId, 'authorizationId'),
  };
}

function isIso(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function assertStored(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid coordinator conversation record: ${message}`);
}

function parseStoredModel(value: unknown): CoordinatorConversationModelPreference {
  assertStored(plain(value) && exactKeys(value, ['providerId', 'modelId', 'mode']), 'model');
  assertStored(typeof value.providerId === 'string' && value.providerId.length > 0 && value.providerId.length <= 256, 'model provider');
  assertStored(typeof value.modelId === 'string' && value.modelId.length > 0 && value.modelId.length <= 256, 'model id');
  assertStored(value.mode === 'auto' || value.mode === 'fixed', 'model mode');
  return { providerId: value.providerId, modelId: value.modelId, mode: value.mode };
}

function storedIdentifier(value: unknown, name: string): string {
  assertStored(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value), name);
  return value as string;
}

function parseStoredDayflowDependency(value: unknown): CoordinatorDayflowDependencyManifest | null {
  if (value === null) return null;
  assertStored(plain(value) && exactKeys(value, [
    'schemaVersion', 'namespace', 'sourceInstance', 'consentGeneration', 'configurationGeneration',
    'sourceVersion', 'sourceRevision', 'sourceHash', 'expiresAt', 'observedAt', 'references',
  ]), 'Dayflow dependency keys');
  assertStored(value.schemaVersion === 1, 'Dayflow dependency schema');
  assertStored(Array.isArray(value.references) && value.references.length <= 25, 'Dayflow dependency references');
  const seen = new Set<string>();
  const references = value.references.map((candidate) => {
    assertStored(plain(candidate) && exactKeys(candidate, [
      'canonicalId', 'canonicalVersion', 'sourceRevision', 'sourceHash', 'expiresAt',
    ]), 'Dayflow dependency reference keys');
    const canonicalId = storedIdentifier(candidate.canonicalId, 'Dayflow canonical id');
    assertStored(!seen.has(canonicalId), 'Dayflow duplicate canonical id');
    seen.add(canonicalId);
    assertStored(typeof candidate.sourceHash === 'string' && /^[0-9a-f]{64}$/.test(candidate.sourceHash), 'Dayflow source hash');
    assertStored(isIso(candidate.expiresAt), 'Dayflow reference expiry');
    return {
      canonicalId,
      canonicalVersion: storedIdentifier(candidate.canonicalVersion, 'Dayflow canonical version'),
      sourceRevision: storedIdentifier(candidate.sourceRevision, 'Dayflow source revision'),
      sourceHash: candidate.sourceHash,
      expiresAt: candidate.expiresAt,
    };
  });
  return {
    schemaVersion: 1,
    namespace: storedIdentifier(value.namespace, 'Dayflow namespace'),
    sourceInstance: storedIdentifier(value.sourceInstance, 'Dayflow source instance'),
    consentGeneration: storedIdentifier(value.consentGeneration, 'Dayflow consent generation'),
    configurationGeneration: storedIdentifier(value.configurationGeneration, 'Dayflow configuration generation'),
    sourceVersion: storedIdentifier(value.sourceVersion, 'Dayflow source version'),
    sourceRevision: storedIdentifier(value.sourceRevision, 'Dayflow source revision'),
    sourceHash: (() => { assertStored(typeof value.sourceHash === 'string' && /^[0-9a-f]{64}$/.test(value.sourceHash), 'Dayflow source hash'); return value.sourceHash as string; })(),
    expiresAt: (() => { assertStored(isIso(value.expiresAt), 'Dayflow expiry'); return value.expiresAt as string; })(),
    observedAt: (() => { assertStored(isIso(value.observedAt), 'Dayflow observedAt'); return value.observedAt as string; })(),
    references,
  };
}

function parseStoredPermissionAuthority(
  value: unknown,
  parentSessionId: string,
): CoordinatorConversationPermissionAuthority {
  assertStored(plain(value) && exactKeys(value, ['schemaVersion', 'parent', 'worker']), 'permission authority keys');
  assertStored(value.schemaVersion === 1, 'permission authority schema');
  assertStored(plain(value.parent) && exactKeys(value.parent, [
    'sessionId', 'permissionMode', 'approvalBypassExplicit',
  ]), 'permission authority parent keys');
  assertStored(plain(value.worker) && exactKeys(value.worker, [
    'parentSessionId', 'permissionMode', 'managedReadOnly',
  ]), 'permission authority worker keys');
  const parentMode = value.parent.permissionMode;
  assertStored(
    parentMode === 'default' || parentMode === 'acceptEdits' || parentMode === 'plan' || parentMode === 'bypassPermissions',
    'permission authority parent mode',
  );
  assertStored(value.parent.sessionId === parentSessionId, 'permission authority parent binding');
  assertStored(typeof value.parent.approvalBypassExplicit === 'boolean', 'permission authority parent approval');
  assertStored(
    value.worker.parentSessionId === parentSessionId && value.worker.permissionMode === 'default' &&
    value.worker.managedReadOnly === true,
    'permission authority worker binding',
  );
  return {
    schemaVersion: 1,
    parent: {
      sessionId: parentSessionId,
      permissionMode: parentMode,
      approvalBypassExplicit: value.parent.approvalBypassExplicit,
    },
    worker: {
      parentSessionId,
      permissionMode: 'default',
      managedReadOnly: true,
    },
  };
}

function parseStoredExecutionScope(
  value: unknown,
  projectId: string,
  profileId: string,
  profileRevision: number,
): CoordinatorConversationExecutionScope | null {
  if (value === null) return null;
  assertStored(plain(value) && exactKeys(value, [
    'schemaVersion', 'kind', 'projectId', 'workspaceGeneration', 'profileId', 'profileRevision',
    'targetFingerprint', 'scopeSignature',
  ]), 'execution scope keys');
  assertStored(value.schemaVersion === 1 && value.kind === 'scoped_workspace_execution', 'execution scope schema');
  assertStored(value.projectId === projectId && value.profileId === profileId, 'execution scope binding');
  assertStored(value.profileRevision === profileRevision, 'execution scope profile revision');
  assertStored(Number.isSafeInteger(value.workspaceGeneration) && (value.workspaceGeneration as number) >= 1, 'execution scope workspace generation');
  assertStored(typeof value.targetFingerprint === 'string' && /^[0-9a-f]{64}$/.test(value.targetFingerprint), 'execution scope target fingerprint');
  assertStored(typeof value.scopeSignature === 'string' && /^[0-9a-f]{64}$/.test(value.scopeSignature), 'execution scope signature');
  return {
    schemaVersion: 1,
    kind: 'scoped_workspace_execution',
    projectId,
    workspaceGeneration: value.workspaceGeneration as number,
    profileId,
    profileRevision,
    targetFingerprint: value.targetFingerprint as string,
    scopeSignature: value.scopeSignature as string,
  };
}

function parseStoredAuthority(
  value: unknown,
  projectId: string,
  goals: Map<string, CoordinatorConversationGoal>,
): CoordinatorConversationContinuationAuthority | null {
  if (value === null) return null;
  assertStored(plain(value), 'continuation record');
  const legacy = value.schemaVersion === 2;
  const schema3 = value.schemaVersion === 3;
  const schema4 = value.schemaVersion === 4;
  const current = value.schemaVersion === 5;
  assertStored(legacy || schema3 || schema4 || current, 'continuation schema');
  assertStored(exactKeys(value, legacy
    ? [
      'schemaVersion', 'authorizationId', 'authorizationCommandKey', 'goalId', 'projectId', 'workstreamId',
      'parentSessionId', 'profileId', 'profileRevision', 'workstreamRevision', 'issuedFromControlRevision',
      'issuedAt', 'expiresAt', 'requestedModel', 'maxTurns', 'consumedTurns', 'totalTokenAuthorization',
      'acknowledgement', 'purpose', 'dayflowDependency', 'status',
    ]
    : schema3
      ? [
      'schemaVersion', 'authorizationId', 'authorizationCommandKey', 'goalId', 'projectId', 'workstreamId',
      'goalRevision', 'parentSessionId', 'profileId', 'profileRevision', 'workstreamRevision',
      'issuedFromControlRevision', 'issuedAt', 'expiresAt', 'requestedModel', 'maxTurns', 'consumedTurns',
      'totalTokenAuthorization', 'maxWallTimeSeconds', 'acknowledgement', 'purpose', 'dayflowDependency', 'status',
      ]
      : schema4
        ? [
        'schemaVersion', 'authorizationId', 'authorizationCommandKey', 'goalId', 'projectId', 'workstreamId',
        'goalRevision', 'parentSessionId', 'profileId', 'profileRevision', 'workstreamRevision',
        'issuedFromControlRevision', 'issuedAt', 'expiresAt', 'requestedModel', 'permissionAuthority',
        'maxTurns', 'consumedTurns', 'totalTokenAuthorization', 'maxWallTimeSeconds', 'acknowledgement',
        'purpose', 'dayflowDependency', 'status',
        ]
        : [
          'schemaVersion', 'authorizationId', 'authorizationCommandKey', 'goalId', 'projectId', 'workstreamId',
          'goalRevision', 'parentSessionId', 'profileId', 'profileRevision', 'workstreamRevision',
          'issuedFromControlRevision', 'issuedAt', 'expiresAt', 'requestedModel', 'permissionAuthority',
          'maxTurns', 'consumedTurns', 'totalTokenAuthorization', 'maxWallTimeSeconds', 'acknowledgement',
          'purpose', 'executionScope', 'dayflowDependency', 'status',
        ]), 'continuation keys');
  const authorizationId = storedIdentifier(value.authorizationId, 'authorization id');
  const authorizationCommandKey = storedIdentifier(value.authorizationCommandKey, 'authorization command key');
  const goalId = storedIdentifier(value.goalId, 'authorization goal id');
  const goal = typeof value.goalId === 'string' ? goals.get(value.goalId) : undefined;
  assertStored(goal?.state === 'linked' && goal.linkedWorkstreamId === value.workstreamId, 'authorization goal binding');
  const goalRevision = legacy ? goal!.revision : value.goalRevision;
  assertStored(Number.isSafeInteger(goalRevision) && goalRevision === goal!.revision, 'authorization goal revision');
  assertStored(value.projectId === projectId, 'authorization project');
  const workstreamId = storedIdentifier(value.workstreamId, 'authorization workstream');
  const parentSessionId = storedIdentifier(value.parentSessionId, 'authorization parent session');
  const profileId = storedIdentifier(value.profileId, 'authorization profile');
  assertStored(Number.isSafeInteger(value.profileRevision) && (value.profileRevision as number) >= 1, 'authorization profile revision');
  assertStored(Number.isSafeInteger(value.workstreamRevision) && (value.workstreamRevision as number) >= 1, 'authorization workstream revision');
  assertStored(Number.isSafeInteger(value.issuedFromControlRevision) && (value.issuedFromControlRevision as number) >= 1, 'authorization control revision');
  assertStored(isIso(value.issuedAt) && isIso(value.expiresAt) && new Date(value.expiresAt).valueOf() > new Date(value.issuedAt).valueOf(), 'authorization window');
  if (!legacy) {
    assertStored(
      new Date(value.expiresAt).valueOf() - new Date(value.issuedAt).valueOf() <= 60 * 60 * 1_000,
      'authorization window bound',
    );
  }
  assertStored(
    (legacy ? value.maxTurns === 1 || value.maxTurns === 2 : isFiniteTurnCount(value.maxTurns)) &&
    Number.isSafeInteger(value.consumedTurns) &&
    (value.consumedTurns as number) >= 0 &&
    (value.consumedTurns as number) <= (value.maxTurns as number),
    'authorization turn bound',
  );
  assertStored(Number.isSafeInteger(value.totalTokenAuthorization) && (value.totalTokenAuthorization as number) > 0 && (value.totalTokenAuthorization as number) <= 2_000_000, 'authorization budget');
  assertStored(plain(value.acknowledgement) && exactKeys(value.acknowledgement, [
    'schemaVersion', 'actorUserId', 'acknowledgedAt', 'kind', 'includes', 'outputCapEnforced',
  ]), 'authorization acknowledgement');
  assertStored(value.acknowledgement.schemaVersion === 1, 'authorization acknowledgement schema');
  assertStored(Number.isSafeInteger(value.acknowledgement.actorUserId) && (value.acknowledgement.actorUserId as number) > 0, 'authorization acknowledgement actor');
  assertStored(isIso(value.acknowledgement.acknowledgedAt), 'authorization acknowledgement time');
  assertStored(value.acknowledgement.kind === 'soft_total_tokens', 'authorization acknowledgement kind');
  assertStored(
    Array.isArray(value.acknowledgement.includes) &&
    JSON.stringify(value.acknowledgement.includes) === JSON.stringify(['input', 'output', 'reasoning', 'cache']) &&
    value.acknowledgement.outputCapEnforced === false,
    'authorization acknowledgement coverage',
  );
  assertStored(
    value.purpose === 'decompose' || value.purpose === 'continue' || (current && value.purpose === 'execute'),
    'authorization purpose',
  );
  assertStored(value.status === 'authorized' || value.status === 'consumed' || value.status === 'blocked', 'authorization status');
  if (value.status === 'authorized') assertStored(value.consumedTurns === 0, 'authorized turns');
  if (value.status === 'consumed') assertStored((value.consumedTurns as number) >= 1, 'consumed turns');
  const requestedModel = parseStoredModel(value.requestedModel);
  const maxWallTimeSeconds = legacy ? 300 : value.maxWallTimeSeconds;
  assertStored(Number.isSafeInteger(maxWallTimeSeconds) && (maxWallTimeSeconds as number) >= 30 && (maxWallTimeSeconds as number) <= 300, 'authorization wall time');
  const permissionAuthority = (schema4 || current)
    ? parseStoredPermissionAuthority(value.permissionAuthority, parentSessionId)
    : null;
  const executionScope = current
    ? parseStoredExecutionScope(value.executionScope, projectId, profileId, value.profileRevision as number)
    : null;
  assertStored(value.purpose !== 'execute' || executionScope !== null, 'execution scope required');
  assertStored(value.purpose === 'execute' || executionScope === null, 'execution scope unexpected');
  return {
    schemaVersion: 5,
    authorizationId,
    authorizationCommandKey,
    goalId,
    projectId,
    workstreamId,
    goalRevision: goalRevision as number,
    parentSessionId,
    profileId,
    profileRevision: value.profileRevision as number,
    workstreamRevision: value.workstreamRevision as number,
    issuedFromControlRevision: value.issuedFromControlRevision as number,
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
    requestedModel,
    permissionAuthority,
    maxTurns: value.maxTurns as CoordinatorFiniteTurnCount,
    consumedTurns: value.consumedTurns as number,
    totalTokenAuthorization: value.totalTokenAuthorization as number,
    maxWallTimeSeconds: maxWallTimeSeconds as number,
    acknowledgement: {
      schemaVersion: 1,
      actorUserId: value.acknowledgement.actorUserId as number,
      acknowledgedAt: value.acknowledgement.acknowledgedAt as string,
      kind: 'soft_total_tokens',
      includes: ['input', 'output', 'reasoning', 'cache'],
      outputCapEnforced: false,
    },
    purpose: value.purpose,
    executionScope,
    dayflowDependency: parseStoredDayflowDependency(value.dayflowDependency),
    status: value.status,
  };
}

/** Parse durable bytes defensively. Any malformed/future record is a safety hold. */
export function parseStoredCoordinatorConversation(value: unknown): CoordinatorConversation {
  assertStored(plain(value), 'record');
  const legacy = value.schemaVersion === 1;
  const schema2 = value.schemaVersion === 2;
  const current = value.schemaVersion === COORDINATOR_CONVERSATION_SCHEMA_VERSION;
  assertStored(legacy || schema2 || current, 'schema version');
  assertStored(exactKeys(value, legacy
    ? [
      'schemaVersion', 'id', 'sessionId', 'ownerUserId', 'projectId', 'controlRevision', 'goals',
      'commandDedupe', 'continuation', 'createdAt', 'updatedAt', 'primaryOwnerRoot',
    ]
    : [
      'schemaVersion', 'id', 'sessionId', 'ownerUserId', 'projectId', 'controlRevision', 'goals',
      'commandDedupe', 'continuations', 'createdAt', 'updatedAt', 'primaryOwnerRoot',
    ]), 'record keys');
  assertStored(typeof value.id === 'string' && value.id.length > 0, 'conversation id');
  assertStored(typeof value.sessionId === 'string' && value.sessionId.length > 0, 'session id');
  assertStored(Number.isSafeInteger(value.ownerUserId) && (value.ownerUserId as number) > 0, 'owner');
  assertStored(typeof value.projectId === 'string' && value.projectId.length > 0, 'project');
  assertStored(Number.isSafeInteger(value.controlRevision) && (value.controlRevision as number) >= 1, 'control revision');
  assertStored(value.primaryOwnerRoot === undefined || typeof value.primaryOwnerRoot === 'boolean', 'primary root');
  assertStored(Array.isArray(value.goals) && value.goals.length <= MAX_COORDINATOR_CONVERSATION_GOALS, 'goals');
  assertStored(Array.isArray(value.commandDedupe) && value.commandDedupe.length <= MAX_COORDINATOR_CONVERSATION_COMMANDS, 'commands');
  assertStored(isIso(value.createdAt) && isIso(value.updatedAt), 'timestamps');

  const seenGoals = new Set<string>();
  const seenCommands = new Set<string>();
  const goals = value.goals.map((candidate) => {
    assertStored(plain(candidate) && exactKeys(candidate, legacy
      ? ['id', 'commandKey', 'intentHash', 'objective', 'state', 'linkedWorkstreamId', 'createdAt']
      : ['id', 'commandKey', 'intentHash', 'objective', 'state', 'linkedWorkstreamId', 'revision', 'createdAt'],
    ), 'goal keys');
    assertStored(typeof candidate.id === 'string' && candidate.id.length > 0 && !seenGoals.has(candidate.id), 'goal id');
    assertStored(typeof candidate.commandKey === 'string' && candidate.commandKey.length > 0, 'goal command key');
    assertStored(typeof candidate.intentHash === 'string' && /^[a-f0-9]{64}$/.test(candidate.intentHash), 'goal hash');
    assertStored(typeof candidate.objective === 'string' && candidate.objective.length > 0 && candidate.objective.length <= MAX_COORDINATOR_GOAL_CHARS, 'goal objective');
    assertStored(candidate.state === 'captured' || candidate.state === 'linked' || candidate.state === 'blocked', 'goal state');
    assertStored(
      (candidate.state === 'captured' && candidate.linkedWorkstreamId === null) ||
      (candidate.state === 'linked' && typeof candidate.linkedWorkstreamId === 'string' && candidate.linkedWorkstreamId.length > 0) ||
      (candidate.state === 'blocked' && candidate.linkedWorkstreamId === null),
      'goal workstream binding',
    );
    assertStored(isIso(candidate.createdAt), 'goal time');
    const goalRevision = legacy ? 1 : candidate.revision;
    assertStored(Number.isSafeInteger(goalRevision) && (goalRevision as number) >= 1, 'goal revision');
    seenGoals.add(candidate.id);
    return {
      id: candidate.id,
      commandKey: candidate.commandKey,
      intentHash: candidate.intentHash,
      objective: candidate.objective,
      state: candidate.state,
      linkedWorkstreamId: candidate.linkedWorkstreamId,
      revision: goalRevision as number,
      createdAt: candidate.createdAt,
    } as CoordinatorConversationGoal;
  });
  const byGoalId = new Set(goals.map((goal) => goal.id));
  const commandDedupe = value.commandDedupe.map((candidate): CoordinatorConversationCommand => {
    assertStored(plain(candidate), 'command record');
    assertStored(typeof candidate.key === 'string' && candidate.key.length > 0 && !seenCommands.has(candidate.key), 'command key');
    assertStored(typeof candidate.intentHash === 'string' && /^[a-f0-9]{64}$/.test(candidate.intentHash), 'command hash');
    seenCommands.add(candidate.key);
    if (legacy || schema2) {
      assertStored(exactKeys(candidate, ['key', 'intentHash', 'kind', 'goalId']), 'legacy command keys');
      assertStored(candidate.kind === 'add_goal' && typeof candidate.goalId === 'string' && byGoalId.has(candidate.goalId), 'legacy command target');
      return {
        key: candidate.key,
        intentHash: candidate.intentHash,
        kind: 'add_goal',
        goalId: candidate.goalId,
        messageId: null,
      };
    }
    if (candidate.kind === 'add_goal') {
      assertStored(exactKeys(candidate, ['key', 'intentHash', 'kind', 'goalId', 'messageId']), 'goal command keys');
      assertStored(typeof candidate.goalId === 'string' && byGoalId.has(candidate.goalId), 'goal command target');
      assertStored(candidate.messageId === null ||
        (Number.isSafeInteger(candidate.messageId) && (candidate.messageId as number) > 0), 'goal command message');
      return {
        key: candidate.key,
        intentHash: candidate.intentHash,
        kind: 'add_goal',
        goalId: candidate.goalId,
        messageId: candidate.messageId as number | null,
      };
    }
    if (candidate.kind === 'status') {
      assertStored(exactKeys(candidate, ['key', 'intentHash', 'kind', 'messageId']), 'status command keys');
      assertStored(Number.isSafeInteger(candidate.messageId) && (candidate.messageId as number) > 0, 'status command message');
      return {
        key: candidate.key,
        intentHash: candidate.intentHash,
        kind: 'status',
        messageId: candidate.messageId as number,
      };
    }
    assertStored(exactKeys(candidate, ['key', 'intentHash', 'kind', 'state']), 'foreground command keys');
    assertStored(
      candidate.kind === 'foreground' &&
      (candidate.state === 'reserved' || candidate.state === 'accepted' || candidate.state === 'uncertain'),
      'foreground command state',
    );
    return {
      key: candidate.key,
      intentHash: candidate.intentHash,
      kind: 'foreground',
      state: candidate.state as 'reserved' | 'accepted' | 'uncertain',
    };
  });
  for (const goal of goals) {
    const command = commandDedupe.find((entry) => entry.kind === 'add_goal' && entry.goalId === goal.id);
    assertStored(command?.key === goal.commandKey && command.intentHash === goal.intentHash, 'goal command binding');
  }

  const authoritiesRaw = legacy
    ? (value.continuation === null ? [] : [value.continuation])
    : value.continuations;
  assertStored(Array.isArray(authoritiesRaw) && authoritiesRaw.length <= MAX_COORDINATOR_CONVERSATION_AUTHORIZATIONS, 'continuations');
  const seenAuthorizations = new Set<string>();
  const seenAuthorizationGoals = new Set<string>();
  const continuations = authoritiesRaw.map((candidate) => {
    const authority = parseStoredAuthority(candidate, value.projectId as string, new Map(goals.map((goal) => [goal.id, goal])));
    assertStored(authority !== null && !seenAuthorizations.has(authority.authorizationId), 'duplicate authorization');
    assertStored(!seenAuthorizationGoals.has(authority.goalId), 'duplicate goal authorization');
    seenAuthorizations.add(authority.authorizationId);
    seenAuthorizationGoals.add(authority.goalId);
    return authority;
  });

  return {
    schemaVersion: 3,
    id: value.id,
    sessionId: value.sessionId,
    ownerUserId: value.ownerUserId as number,
    projectId: value.projectId,
    controlRevision: value.controlRevision as number,
    primaryOwnerRoot: value.primaryOwnerRoot === true,
    goals,
    commandDedupe,
    continuations,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export function continuationIsLive(
  authority: CoordinatorConversationContinuationAuthority | null,
  now: Date,
): authority is CoordinatorConversationContinuationAuthority {
  return authority !== null &&
    authority.permissionAuthority !== null &&
    authority.status === 'authorized' &&
    authority.consumedTurns === 0 &&
    new Date(authority.expiresAt).valueOf() > now.valueOf();
}
