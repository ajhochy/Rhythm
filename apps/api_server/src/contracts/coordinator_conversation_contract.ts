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
 * Version 4 adds a durable, one-shot correlation from a captured goal to the
 * existing Coding Workflow async-delegation record. It stores identifiers and
 * state only: never delegated prose, a child transcript, or a synthetic root
 * message. Version 3's transcript-backed user controls remain readable so an
 * accepted C1/C2 root is never treated as blank after upgrade.
 */
export const COORDINATOR_CONVERSATION_SCHEMA_VERSION = 4 as const;
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
  }
  /**
   * Server-only correlation for one existing Coding Workflow async child.
   * The model chooses only a previously captured goal id; target/profile,
   * parent SDK identity, and returned durable delegation ids are all derived
   * and checked by the server. `reserved`/`uncertain` deliberately withhold
   * replay after an interrupted dispatch boundary.
   */
  | {
    key: string;
    intentHash: string;
    kind: 'delegate_goal';
    goalId: string;
    parentSdkSessionId: string;
    targetAgentConfigId: 'workflow-orchestrator';
    state: 'reserved' | 'dispatched' | 'uncertain';
    delegationId: string | null;
    childSessionId: string | null;
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
  purpose: CoordinatorConversationAdmissionPurpose;
  /** Present and true only for the fresh scoped-workspace execution purpose. */
  acknowledgesScopedWorkspaceExecution?: true;
  /**
   * Present and true only for the fixed Coding Workflow adapter purpose. It is
   * the explicit user acknowledgement that the soft total-token authorization
   * is charged for the manager child, EVERY recursive native descendant, and the
   * exact root/review turns later bound by their persisted dispatch anchors.
   * It grants no tool, permission, callback action authority or extra child.
   */
  acknowledgesCodingWorkflowCoverage?: true;
}

/**
 * `workflow` is the fixed Coding Workflow adapter purpose. This checkpoint only
 * defines and validates it: the conversation service has no issuance path for
 * it (its existing purpose gates answer planning_authority_conflict), and the
 * stored authority parser deliberately does not accept it.
 */
export type CoordinatorConversationAdmissionPurpose = 'decompose' | 'continue' | 'execute' | 'workflow';

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
  schemaVersion: 4;
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

/** Optional-source bounds: an optional projection can never grow the status past these. */
export const MAX_COORDINATOR_CALENDAR_OBSERVATIONS = 8;
export const MAX_COORDINATOR_PROJECT_SESSION_ROOTS = 12;
export const MAX_COORDINATOR_PROJECT_SESSION_PAGES = 2;
export const COORDINATOR_CALENDAR_WINDOW_DAYS = 8; // today + the next seven local days

export type CoordinatorCalendarMirrorState =
  | 'observed'
  | 'not_configured'
  | 'account_unavailable'
  | 'never_synced'
  | 'invalid_sync_time'
  | 'preferences_corrupt'
  | 'disabled_by_selection'
  | 'read_failed'
  | 'changed_during_read';

/**
 * Cached owner-local mirror observation. Source data only: never a claim that
 * the calendar is clear/current/complete, never a statement about which Google
 * identity the mirror belongs to.
 */
export interface CoordinatorCalendarEventObservation {
  id: string;
  /** Bounded, sanitized source data — not instructions. */
  title: string;
  calendarLabel: string;
  start: string;
  end: string | null;
  allDay: boolean;
}

export interface CoordinatorCalendarMirrorProjection {
  source: 'owner_local_google_calendar_mirror';
  state: CoordinatorCalendarMirrorState;
  /** The mirror carries no external account binding. */
  accountBinding: 'unproven';
  /** One sync page per calendar, no completeness receipt: even an empty window proves nothing. */
  externalCompleteness: 'unknown';
  window: { startDay: string; endDayExclusive: string; timeZone: typeof COORDINATOR_CONVERSATION_TIME_ZONE } | null;
  /** Observed local sync state. No freshness TTL is invented. */
  lastSuccessfulSyncAt: string | null;
  syncAgeSeconds: number | null;
  selection: 'default_all_at_sync_time' | 'explicit_ids' | 'explicit_none' | 'unknown';
  selectedCount: number;
  hasMore: boolean;
  /** Null: the window was not counted exhaustively. */
  totalCount: null;
  events: CoordinatorCalendarEventObservation[];
}

export type CoordinatorProjectSessionStatus = 'starting' | 'working' | 'idle' | 'error' | 'closed' | 'resumable' | 'unknown';

/** Persisted session state only: not a live heartbeat, completion proof or goal verification. */
export interface CoordinatorProjectSessionObservation {
  sessionId: string;
  label: string;
  status: CoordinatorProjectSessionStatus;
  lastActivityAt: string | null;
  profile: {
    profileId: string | null;
    label: string | null;
    /** exact workflow-orchestrator identity only; never inferred from title/kind/path. */
    codingWorkflow: boolean;
    /** False for a missing/disabled/locked profile: historical status, no execution assertion. */
    executionAvailable: boolean;
  };
}

export interface CoordinatorProjectSessionGroup {
  projectId: string;
  projectLabel: string;
  sessions: CoordinatorProjectSessionObservation[];
}

/**
 * Internal, NON-serialized proof that a prepared optional projection still
 * matches its local sources. It lives in a WeakMap keyed by the projection
 * object, so it can never reach a response, fingerprint or persisted value.
 * The check is synchronous: it is run after the LAST await before exposure.
 */
const optionalSourceProofs = new WeakMap<object, () => boolean>();

export function attachOptionalSourceProof<T extends object>(projection: T, check: () => boolean): T {
  optionalSourceProofs.set(projection, check);
  return projection;
}

export function optionalSourceProofOf(projection: object): (() => boolean) | undefined {
  return optionalSourceProofs.get(projection);
}

/** False when the projection has no proof or its proof fails/throws (unknown ⇒ withheld). */
export function optionalSourceProofCurrent(projection: object): boolean {
  const check = optionalSourceProofs.get(projection);
  if (!check) return false;
  try {
    return check() === true;
  } catch {
    return false;
  }
}

export interface CoordinatorProjectSessionsProjection {
  source: 'owner_project_session_roots';
  state: 'observed' | 'not_configured' | 'read_failed' | 'changed_during_read';
  /** Recent-window scan through the existing pager: never an exact total or all-projects claim. */
  coverage: 'recent_window_truncated' | 'recent_window_exhausted' | 'unknown';
  selectedCount: number;
  groups: CoordinatorProjectSessionGroup[];
}

export interface CoordinatorConversationContextScope {
  ownerUserId: number;
  projectId: string;
  conversationId: string;
  now: Date;
  /** Current coordinator root, so the Secretary never counts itself as project work. */
  sessionId?: string;
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
  /** Optional, status-only, local reads: they never join mandatory model-context qualification. */
  calendarMirror?: {
    read(scope: CoordinatorConversationContextScope): Promise<CoordinatorCalendarMirrorProjection>;
  };
  projectSessions?: {
    read(scope: CoordinatorConversationContextScope): Promise<CoordinatorProjectSessionsProjection>;
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
   * Optional cached/local observations, present only when their adapter is
   * composed. They are excluded from `modelContext` qualification and bytes:
   * their own caps bound them, and they can never make chat unavailable.
   */
  calendarMirror?: CoordinatorCalendarMirrorProjection;
  projectSessions?: CoordinatorProjectSessionsProjection;
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
  const workflow = value.purpose === 'workflow';
  if (!exactKeys(value, execute
    ? [
      'commandKey', 'totalTokenAuthorization', 'maxTurns', 'maxWallTimeSeconds', 'expiresInSeconds',
      'acknowledgesSoftTotalTokenAuthorization', 'purpose', 'acknowledgesScopedWorkspaceExecution',
    ]
    : workflow
    ? [
      'commandKey', 'totalTokenAuthorization', 'maxTurns', 'maxWallTimeSeconds', 'expiresInSeconds',
      'acknowledgesSoftTotalTokenAuthorization', 'purpose', 'acknowledgesCodingWorkflowCoverage',
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
    (value.purpose !== 'decompose' && value.purpose !== 'continue' && value.purpose !== 'execute' && value.purpose !== 'workflow') ||
    (execute && value.acknowledgesScopedWorkspaceExecution !== true) ||
    (workflow && value.acknowledgesCodingWorkflowCoverage !== true)
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
    ...(workflow ? { acknowledgesCodingWorkflowCoverage: true as const } : {}),
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
  const schema3 = value.schemaVersion === 3;
  const current = value.schemaVersion === COORDINATOR_CONVERSATION_SCHEMA_VERSION;
  assertStored(legacy || schema2 || schema3 || current, 'schema version');
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
    if (candidate.kind === 'foreground') {
      assertStored(exactKeys(candidate, ['key', 'intentHash', 'kind', 'state']), 'foreground command keys');
      assertStored(
        candidate.state === 'reserved' || candidate.state === 'accepted' || candidate.state === 'uncertain',
        'foreground command state',
      );
      return {
        key: candidate.key,
        intentHash: candidate.intentHash,
        kind: 'foreground',
        state: candidate.state as 'reserved' | 'accepted' | 'uncertain',
      };
    }
    assertStored(current && candidate.kind === 'delegate_goal', 'goal delegation kind');
    assertStored(exactKeys(candidate, [
      'key', 'intentHash', 'kind', 'goalId', 'parentSdkSessionId', 'targetAgentConfigId',
      'state', 'delegationId', 'childSessionId',
    ]), 'goal delegation keys');
    assertStored(typeof candidate.goalId === 'string' && byGoalId.has(candidate.goalId), 'goal delegation target');
    assertStored(
      typeof candidate.parentSdkSessionId === 'string' && candidate.parentSdkSessionId.length > 0 &&
      candidate.parentSdkSessionId.length <= 256,
      'goal delegation parent sdk session',
    );
    assertStored(candidate.targetAgentConfigId === 'workflow-orchestrator', 'goal delegation target profile');
    assertStored(
      candidate.state === 'reserved' || candidate.state === 'dispatched' || candidate.state === 'uncertain',
      'goal delegation state',
    );
    const dispatched = candidate.state === 'dispatched';
    assertStored(
      (dispatched && typeof candidate.delegationId === 'string' && candidate.delegationId.length > 0 &&
        candidate.delegationId.length <= 256 && typeof candidate.childSessionId === 'string' &&
        candidate.childSessionId.length > 0 && candidate.childSessionId.length <= 256) ||
      (!dispatched && candidate.delegationId === null && candidate.childSessionId === null),
      'goal delegation binding',
    );
    return {
      key: candidate.key,
      intentHash: candidate.intentHash,
      kind: 'delegate_goal',
      goalId: candidate.goalId,
      parentSdkSessionId: candidate.parentSdkSessionId,
      targetAgentConfigId: 'workflow-orchestrator',
      state: candidate.state as 'reserved' | 'dispatched' | 'uncertain',
      delegationId: candidate.delegationId as string | null,
      childSessionId: candidate.childSessionId as string | null,
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

  const delegatedGoals = new Set<string>();
  for (const command of commandDedupe) {
    if (command.kind !== 'delegate_goal') continue;
    assertStored(!delegatedGoals.has(command.goalId), 'duplicate goal delegation');
    delegatedGoals.add(command.goalId);
  }

  return {
    schemaVersion: 4,
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

// ── Fixed Coding Workflow adapter (G2 first source checkpoint) ─────────────────
//
// A server-only, typed receipt for ONE existing Coding Workflow async child and
// the truthful coverage of what it cost. It stores identifiers, never a prompt,
// transcript or model output, and it is neither a grant nor callback authority.

export const CODING_WORKFLOW_ADAPTER = 'coding_workflow_v1' as const;
/** Fixed provenance reason code of the one pre-SDK dispatch row this adapter writes. */
export const CODING_WORKFLOW_DISPATCH_REASON = 'g2_coding_workflow' as const;
export const CODING_WORKFLOW_BOUNDS = {
  /** Recursive native descendants beneath the manager child, excluding the manager. */
  maxDescendants: 32,
  maxDepth: 4,
  /** Exact charged root/review turns (persisted dispatch anchors) per inspection. */
  maxRootTurns: 8,
  maxMessagePagesPerSession: 50,
  maxDirectories: 8,
} as const;

export interface CodingWorkflowAuthorization {
  authorizationId: string;
  /** 1-based ordinal funded by the finite admission. */
  ordinal: CoordinatorFiniteTurnCount;
  workstreamId: string;
  goalId: string;
}

export interface CodingWorkflowEngineIdentity {
  version: string;
  pid: number;
  bootId: string;
}

/**
 * Exported by the actual delegation->prompt boundary. `delivery: 'accepted'`
 * means the engine acknowledged the exact request; `'unknown'` means the SDK
 * call may or may not have been enqueued (never inferred as failed or done).
 */
export interface CodingWorkflowDispatchReceipt {
  schemaVersion: 1;
  adapter: typeof CODING_WORKFLOW_ADAPTER;
  authorization: CodingWorkflowAuthorization;
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
  dispatch: {
    dispatchId: string;
    /** The real native-minted user-message id; never derived from a newest/oldest row. */
    sdkUserMessageId: string;
    delivery: 'accepted' | 'unknown';
  };
  engine: CodingWorkflowEngineIdentity;
}

/** One charged root/review turn, identified by its exact persisted dispatch row. */
export interface CodingWorkflowRootTurn {
  dispatchId: string;
  sdkUserMessageId: string;
}

export type CodingWorkflowHoldReason =
  | 'receipt_invalid' | 'delivery_unknown' | 'local_binding_changed' | 'engine_identity_unavailable'
  | 'engine_identity_changed' | 'native_metadata_unavailable' | 'native_tree_unavailable'
  | 'native_tree_bounds_exceeded' | 'native_tree_cycle' | 'native_tree_changed' | 'descendant_identity_missing'
  | 'lifecycle_unavailable' | 'lifecycle_changed' | 'pending_interaction' | 'session_busy'
  | 'messages_unavailable' | 'message_pages_incomplete' | 'uncovered_assistant_turn'
  | 'turn_not_terminal' | 'turn_incomplete' | 'accounting_missing' | 'usage_incomplete'
  | 'root_turn_unbound' | 'root_turns_missing' | 'scope_unsupported' | 'scope_changed';

export interface CodingWorkflowCoverageIds {
  managerSessionId: string;
  managerSdkSessionId: string;
  /** Native session ids of every recursive descendant actually enumerated. */
  descendantSdkSessionIds: string[];
  /** Exact root/review dispatch anchors that were covered. */
  rootTurns: CodingWorkflowRootTurn[];
}

export interface CodingWorkflowUsage {
  schemaVersion: 1;
  status: 'actual';
  basis: 'engine_assistant_turn_steps';
  assistantStepCount: number;
  coveredSessionCount: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  /** Null when any step omitted its cost; never a fabricated zero. */
  cost: number | null;
}

/**
 * Coverage IDs and completeness are reported separately from the sum. A hold
 * carries whatever IDs were positively established but NEVER a usage figure.
 */
export type CodingWorkflowCoverageResult =
  | { status: 'complete'; coverage: CodingWorkflowCoverageIds; usage: CodingWorkflowUsage; engineBootId: string }
  | { status: 'hold'; reason: CodingWorkflowHoldReason; coverage: CodingWorkflowCoverageIds | null; usage: null };

const WORKFLOW_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

function workflowId(value: unknown): value is string {
  return typeof value === 'string' && WORKFLOW_ID.test(value);
}

/** Strict, closed parse; null on any extra key, wrong type or unbound value. */
export function parseCodingWorkflowDispatchReceipt(value: unknown): CodingWorkflowDispatchReceipt | null {
  const exact = (record: Record<string, unknown>, keys: readonly string[]): boolean =>
    Object.keys(record).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(record, key));
  if (!plain(value) || !exact(value, ['schemaVersion', 'adapter', 'authorization', 'owner', 'delegation', 'dispatch', 'engine'])) return null;
  const { authorization, owner, delegation, dispatch, engine } = value;
  if (
    value.schemaVersion !== 1 || value.adapter !== CODING_WORKFLOW_ADAPTER ||
    !plain(authorization) || !exact(authorization, ['authorizationId', 'ordinal', 'workstreamId', 'goalId']) ||
    !workflowId(authorization.authorizationId) || !isFiniteTurnCount(authorization.ordinal) ||
    !workflowId(authorization.workstreamId) || !workflowId(authorization.goalId) ||
    !plain(owner) || !exact(owner, ['ownerUserId', 'projectId', 'rootSessionId', 'rootSdkSessionId']) ||
    !Number.isSafeInteger(owner.ownerUserId) || (owner.ownerUserId as number) <= 0 ||
    !workflowId(owner.projectId) || !workflowId(owner.rootSessionId) || !workflowId(owner.rootSdkSessionId) ||
    !plain(delegation) || !exact(delegation, ['delegationId', 'managerSessionId', 'managerSdkSessionId', 'nativeParentSdkSessionId']) ||
    !workflowId(delegation.delegationId) || !workflowId(delegation.managerSessionId) ||
    !workflowId(delegation.managerSdkSessionId) || !workflowId(delegation.nativeParentSdkSessionId) ||
    delegation.nativeParentSdkSessionId !== owner.rootSdkSessionId ||
    delegation.managerSdkSessionId === delegation.nativeParentSdkSessionId ||
    !plain(dispatch) || !exact(dispatch, ['dispatchId', 'sdkUserMessageId', 'delivery']) ||
    !workflowId(dispatch.dispatchId) || !workflowId(dispatch.sdkUserMessageId) ||
    (dispatch.delivery !== 'accepted' && dispatch.delivery !== 'unknown') ||
    !plain(engine) || !exact(engine, ['version', 'pid', 'bootId']) ||
    typeof engine.version !== 'string' || engine.version.length === 0 || engine.version.length > 200 ||
    !Number.isSafeInteger(engine.pid) || typeof engine.bootId !== 'string' || engine.bootId.length === 0 || engine.bootId.length > 200
  ) return null;
  return {
    schemaVersion: 1,
    adapter: CODING_WORKFLOW_ADAPTER,
    authorization: {
      authorizationId: authorization.authorizationId as string,
      ordinal: authorization.ordinal as CoordinatorFiniteTurnCount,
      workstreamId: authorization.workstreamId as string,
      goalId: authorization.goalId as string,
    },
    owner: {
      ownerUserId: owner.ownerUserId as number,
      projectId: owner.projectId as string,
      rootSessionId: owner.rootSessionId as string,
      rootSdkSessionId: owner.rootSdkSessionId as string,
    },
    delegation: {
      delegationId: delegation.delegationId as string,
      managerSessionId: delegation.managerSessionId as string,
      managerSdkSessionId: delegation.managerSdkSessionId as string,
      nativeParentSdkSessionId: delegation.nativeParentSdkSessionId as string,
    },
    dispatch: {
      dispatchId: dispatch.dispatchId as string,
      sdkUserMessageId: dispatch.sdkUserMessageId as string,
      delivery: dispatch.delivery as 'accepted' | 'unknown',
    },
    engine: { version: engine.version as string, pid: engine.pid as number, bootId: engine.bootId as string },
  };
}
