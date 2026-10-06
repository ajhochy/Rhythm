import type { GatewayMode } from '.';

/**
 * Stable C1 transport prefix. It deliberately names the coordinator service,
 * rather than an SDK/engine route, because an ordinary chat must never fall
 * back to the SDK when a coordinator control is unavailable.
 */
export const COORDINATOR_CONVERSATIONS_PATH = '/coordinator-conversations';
export const COORDINATOR_REQUEST_TIMEOUT_MS = 10_000;

export type CoordinatorConversationScope = {
  /** Local view-pointer only. The server derives the actual actor. */
  actorKey: string;
  sessionId: string;
  projectId: string;
};

export type CoordinatorGoal = {
  id: string;
  commandKey: string;
  intentHash?: string;
  objective: string;
  state: 'captured' | 'linked' | 'blocked';
  linkedWorkstreamId: string | null;
  /** C2 goal-local CAS revision; absent on retained C1 records. */
  revision?: number;
  createdAt?: string;
};

/** Server-issued finite authority metadata. Opaque IDs never become UI grants. */
export type CoordinatorContinuation = {
  authorizationId: string;
  goalId: string;
  workstreamId: string;
  status: 'authorized' | 'consumed' | 'blocked';
  maxTurns: number;
  consumedTurns: number;
  expiresAt: string;
};

export type CoordinatorConversation = {
  /** C1/C2 records remain readable; v3 and v4 share one top-level DTO (v4 adds server command metadata only). */
  schemaVersion: 1 | 2 | 3 | 4;
  id: string;
  sessionId: string;
  projectId: string;
  controlRevision: number;
  /** C2 marks the server-designated durable Rhythm root explicitly. */
  primaryOwnerRoot?: boolean;
  goals: CoordinatorGoal[];
  continuations?: CoordinatorContinuation[];
  /** Server-owned C2 control metadata; never an authority input from the UI. */
  commandDedupe?: unknown[];
  ownerUserId?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type CoordinatorAvailability = {
  state: 'available' | 'not_configured' | 'unavailable';
  reason?: string | null;
};

export type CoordinatorTaskContextItem = {
  id: string;
  title: string;
  status: 'open' | 'in_progress' | 'waiting_for_reply' | 'done' | 'deferred';
  dueDate?: string | null;
  scheduledDate?: string | null;
  priority?: number | null;
};

export type CoordinatorScheduleContextItem = {
  id: string;
  name: string;
  enabled: boolean;
  nextRunAt?: string | null;
};

export type CoordinatorWorkstreamContextItem = {
  id: string;
  state: 'ready' | 'queued' | 'running' | 'blocked' | 'paused' | 'cancelled' | 'completed' | 'unknown';
  stateReason?: string | null;
  revision?: number;
  lastJobId?: string | null;
};

/** The C2 planned response returns the coordinator status view, not a flat card model. */
export type CoordinatorPlannedWorkstream = {
  workstream: CoordinatorWorkstreamContextItem;
  readiness: { available: boolean };
  jobs: unknown[];
  budget: Record<string, unknown>;
};

export type CoordinatorReceiptContextItem = {
  id: string;
  workstreamId: string;
  jobId: string;
  workstreamRevision?: number;
  executionState?: 'succeeded' | 'failed' | 'cancelled' | 'unknown' | 'running' | 'queued';
  criterionState?: 'pending' | 'blocked' | 'verified' | 'waived';
  actualUsage?: { state: 'actual' | 'unknown' | 'overshoot'; tokens?: number | null };
};

/**
 * Deliberately narrow display shape. This excludes raw Dayflow activity,
 * model context, URLs, and worker errors; those remain server-owned evidence.
 */
export type CoordinatorConversationContext = {
  timeZone: 'America/Los_Angeles';
  asOf: string;
  today: string;
  yesterday: string;
  availability: Record<'tasks' | 'schedules' | 'workstreams' | 'receipts' | 'manualActivity', CoordinatorAvailability> & {
    rhythms?: CoordinatorAvailability;
  };
  todayTasks: CoordinatorTaskContextItem[];
  waitingForReply: CoordinatorTaskContextItem[];
  doneWithUnknownCompletionDate: CoordinatorTaskContextItem[];
  scheduledPriorities: CoordinatorScheduleContextItem[];
  activeWorkstreams: CoordinatorWorkstreamContextItem[];
  executionSucceededGoalUnverified: CoordinatorReceiptContextItem[];
  staleExecutions: CoordinatorReceiptContextItem[];
  verifiedYesterday: CoordinatorReceiptContextItem[];
  usageHolds: CoordinatorReceiptContextItem[];
  receipts: CoordinatorReceiptContextItem[];
};

/** Explicit finite user control accepted by C2; never a reasoning preference. */
export type CoordinatorPlanAdmission = {
  commandKey: string;
  totalTokenAuthorization: number;
  maxTurns: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  maxWallTimeSeconds: number;
  expiresInSeconds: number;
  acknowledgesSoftTotalTokenAuthorization: true;
  /** `execute` is a separately acknowledged, server-derived workspace scope. */
  purpose: 'decompose' | 'continue' | 'execute';
  /** Required only for the fresh `execute` purpose; never inferred from prose. */
  acknowledgesScopedWorkspaceExecution?: true;
};

export type CoordinatorPreparePlanInput = Pick<CoordinatorConversationScope, 'sessionId' | 'projectId'> & {
  expectedControlRevision: number;
  goalId: string;
  admission: CoordinatorPlanAdmission | null;
};

export type CoordinatorContinuePlanInput = Pick<CoordinatorConversationScope, 'sessionId' | 'projectId'> & {
  expectedControlRevision: number;
  goalId: string;
  authorizationId: string;
};

export type CoordinatorResolveResult =
  | { kind: 'resolved'; created: boolean; conversation: CoordinatorConversation; sessionId: string; projectId: string }
  | { kind: 'not_found' | 'schema_unavailable' | 'integrity_hold' | 'setup_unavailable' };

/** Existing persisted root-session rows only; never a client-created bubble. */
export type CoordinatorHistoryMessage = {
  id: number;
  sessionId: string;
  role: 'output' | 'input' | 'system';
  rawText: string;
  strippedText: string;
  createdAt: string;
  sdkMessageId: string | null;
  parts: unknown[];
  tokens: Record<string, unknown> | null;
  cost: number | null;
};

export type CoordinatorHistoryResult = {
  kind: 'history';
  conversation: CoordinatorConversation;
  messages: CoordinatorHistoryMessage[];
  nextCursor: string | null;
  hasMore: boolean;
};

/** A setup profile is only an opaque server-validated choice, never a grant. */
export type CoordinatorSetupProfileChoice = { id: string; label: string };

export type CoordinatorSetupResult =
  | { kind: 'setup_profile_choice_required'; profileChoices: CoordinatorSetupProfileChoice[] }
  | {
      kind: 'setup_created' | 'setup_replay';
      sessionId: string;
      projectId: string;
      profileId: string;
      workspaceGeneration: number;
      conversation: CoordinatorConversation;
    }
  | { kind: 'setup_unavailable' };

export type CoordinatorConversationResult =
  | { kind: 'created' | 'replay'; conversation: CoordinatorConversation; goal?: CoordinatorGoal }
  | { kind: 'status'; conversation: CoordinatorConversation; context: CoordinatorConversationContext }
  | {
      kind:
        | 'not_found'
        | 'schema_unavailable'
        | 'integrity_hold'
        | 'context_unavailable'
        | 'model_integration_unavailable'
        | 'planner_unavailable'
        | 'revision_conflict'
        | 'command_conflict'
        | 'goal_limit'
        | 'setup_unavailable'
        | 'planning_goal_not_found'
        | 'planning_authority_required'
        | 'planning_already_linked'
        | 'planning_authority_unavailable'
        | 'planning_authority_conflict'
        | 'planning_dependency_hold'
        | 'planning_link_conflict';
      conversation?: CoordinatorConversation;
    }
  | {
      kind: 'planning_terminal_hold' | 'planning_dispatch_hold';
      conversation: CoordinatorConversation;
      workstreamId: string;
    }
  | {
      kind: 'continuation_available';
      conversation: CoordinatorConversation;
      workstreamId: string;
      remainingTurns: number;
    }
  | {
      kind: 'planned';
      conversation: CoordinatorConversation;
      workstream: CoordinatorPlannedWorkstream;
    }
  /** An SDK bridge accepted the foreground turn; transcript events remain canonical. */
  | { kind: 'foreground_accepted'; conversation: CoordinatorConversation }
  /** A foreground turn may have reached the bridge; retrying automatically is unsafe. */
  | { kind: 'foreground_uncertain'; conversation: CoordinatorConversation };

export type CoordinatorMessageInput = Pick<CoordinatorConversationScope, 'sessionId' | 'projectId'> & {
  expectedControlRevision: number;
  commandKey: string;
  message: string;
};

export interface CoordinatorConversationGateway {
  resolve?(input?: { projectId?: string }, signal?: AbortSignal): Promise<CoordinatorResolveResult>;
  setup?(input: { commandKey: string; profileId?: string }, signal?: AbortSignal): Promise<CoordinatorSetupResult>;
  open(
    input: Pick<CoordinatorConversationScope, 'sessionId' | 'projectId'>,
    signal?: AbortSignal,
  ): Promise<CoordinatorConversationResult>;
  status(
    input: Pick<CoordinatorConversationScope, 'sessionId' | 'projectId'>,
    signal?: AbortSignal,
  ): Promise<CoordinatorConversationResult>;
  history?(
    input: Pick<CoordinatorConversationScope, 'sessionId' | 'projectId'> & { limit: number; beforeId?: number },
    signal?: AbortSignal,
  ): Promise<CoordinatorHistoryResult>;
  message(input: CoordinatorMessageInput, signal?: AbortSignal): Promise<CoordinatorConversationResult>;
  goals?(input: Omit<CoordinatorMessageInput, 'message'> & { objective: string }, signal?: AbortSignal): Promise<CoordinatorConversationResult>;
  preparePlan?(input: CoordinatorPreparePlanInput, signal?: AbortSignal): Promise<CoordinatorConversationResult>;
  continuePlan?(input: CoordinatorContinuePlanInput, signal?: AbortSignal): Promise<CoordinatorConversationResult>;
}

export class CoordinatorTransportError extends Error {
  readonly status: number | undefined;
  readonly retryable: boolean;

  constructor(message: string, status?: number, retryable?: boolean) {
    super(message);
    this.name = 'CoordinatorTransportError';
    this.status = status;
    this.retryable = retryable ?? (status === undefined || status >= 500);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function string(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isGoal(value: unknown): value is CoordinatorGoal {
  return isRecord(value) && string(value.id) && string(value.commandKey) && string(value.objective) &&
    (value.state === 'captured' || value.state === 'linked' || value.state === 'blocked') &&
    (value.linkedWorkstreamId === null || string(value.linkedWorkstreamId)) &&
    (value.revision === undefined || (Number.isSafeInteger(value.revision) && (value.revision as number) >= 1));
}

function isContinuation(value: unknown): value is CoordinatorContinuation {
  return isRecord(value) && string(value.authorizationId) && string(value.goalId) && string(value.workstreamId) &&
    (value.status === 'authorized' || value.status === 'consumed' || value.status === 'blocked') &&
    Number.isSafeInteger(value.maxTurns) && (value.maxTurns as number) >= 1 && (value.maxTurns as number) <= 8 &&
    Number.isSafeInteger(value.consumedTurns) && (value.consumedTurns as number) >= 0 &&
    (value.consumedTurns as number) <= (value.maxTurns as number) && string(value.expiresAt);
}

/** Literal known versions for the dedicated root protocol; an unknown, string or nested-authority version never qualifies. */
export function isDedicatedCoordinatorSchema(version: unknown): version is 3 | 4 {
  return version === 3 || version === 4;
}

const SCHEMA4_COLLECTION_LIMIT = 100;
const SCHEMA4_OBJECTIVE_LIMIT = 4000;

function isIsoTimestamp(value: unknown): boolean {
  // Same rule as the published backend: a valid date whose canonical ISO form equals the input exactly.
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

/** Published v4 requires every field the server emits; command/continuation arrays are opaque metadata. */
function isSchema4Record(value: Record<string, unknown>): boolean {
  return typeof value.primaryOwnerRoot === 'boolean' &&
    Number.isSafeInteger(value.ownerUserId) && (value.ownerUserId as number) > 0 &&
    Array.isArray(value.goals) && value.goals.length <= SCHEMA4_COLLECTION_LIMIT &&
    value.goals.every((goal) => isRecord(goal) && (goal.objective as string).length <= SCHEMA4_OBJECTIVE_LIMIT) &&
    Array.isArray(value.commandDedupe) && value.commandDedupe.length <= SCHEMA4_COLLECTION_LIMIT &&
    Array.isArray(value.continuations) && value.continuations.length <= SCHEMA4_COLLECTION_LIMIT &&
    isIsoTimestamp(value.createdAt) && isIsoTimestamp(value.updatedAt);
}

function isConversation(value: unknown, scope: Pick<CoordinatorConversationScope, 'sessionId' | 'projectId'>): value is CoordinatorConversation {
  if (!isRecord(value) || (value.schemaVersion !== 1 && value.schemaVersion !== 2 && value.schemaVersion !== 3 && value.schemaVersion !== 4) || !string(value.id) ||
    value.sessionId !== scope.sessionId || value.projectId !== scope.projectId ||
    !Number.isSafeInteger(value.controlRevision) || (value.controlRevision as number) < 1 ||
    !Array.isArray(value.goals) || !value.goals.every(isGoal) ||
    (value.primaryOwnerRoot !== undefined && typeof value.primaryOwnerRoot !== 'boolean') ||
    (value.continuations !== undefined && (!Array.isArray(value.continuations) || !value.continuations.every(isContinuation)))) return false;
  // Schema v3 is the current dedicated-root protocol. A missing primary bit
  // would make a response indistinguishable from an older generic record.
  if (value.schemaVersion === 4) return isSchema4Record(value);
  return value.schemaVersion !== 3 ||
    (typeof value.primaryOwnerRoot === 'boolean' &&
      (value.ownerUserId === undefined || (Number.isSafeInteger(value.ownerUserId) && (value.ownerUserId as number) > 0)) &&
      (value.commandDedupe === undefined || Array.isArray(value.commandDedupe)));
}

function isAvailability(value: unknown): value is CoordinatorAvailability {
  return isRecord(value) && (value.state === 'available' || value.state === 'not_configured' || value.state === 'unavailable');
}

function isWorkstream(value: unknown): value is CoordinatorWorkstreamContextItem {
  return isRecord(value) && string(value.id) &&
    (value.state === 'ready' || value.state === 'queued' || value.state === 'running' ||
      value.state === 'blocked' || value.state === 'paused' || value.state === 'cancelled' ||
      value.state === 'completed' || value.state === 'unknown');
}

function isPlannedWorkstream(value: unknown): value is CoordinatorPlannedWorkstream {
  return isRecord(value) && isWorkstream(value.workstream) && isRecord(value.readiness) &&
    typeof value.readiness.available === 'boolean' && Array.isArray(value.jobs) && isRecord(value.budget);
}

function nullableText(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

function nullableNumber(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isTask(value: unknown): value is CoordinatorTaskContextItem {
  return isRecord(value) && string(value.id) && string(value.title) &&
    (value.status === 'open' || value.status === 'in_progress' || value.status === 'waiting_for_reply' || value.status === 'done' || value.status === 'deferred') &&
    nullableText(value.dueDate) && nullableText(value.scheduledDate) && nullableNumber(value.priority);
}

function isSchedule(value: unknown): value is CoordinatorScheduleContextItem {
  return isRecord(value) && string(value.id) && string(value.name) && typeof value.enabled === 'boolean' && nullableText(value.nextRunAt);
}

function isReceipt(value: unknown): value is CoordinatorReceiptContextItem {
  if (!isRecord(value) || !string(value.id) || !string(value.workstreamId) || !string(value.jobId)) return false;
  if (value.executionState !== undefined && !['succeeded', 'failed', 'cancelled', 'unknown', 'running', 'queued'].includes(value.executionState as string)) return false;
  if (value.criterionState !== undefined && !['pending', 'blocked', 'verified', 'waived'].includes(value.criterionState as string)) return false;
  return value.actualUsage === undefined || (
    isRecord(value.actualUsage) &&
    (value.actualUsage.state === 'actual' || value.actualUsage.state === 'unknown' || value.actualUsage.state === 'overshoot') &&
    (value.actualUsage.tokens === undefined || value.actualUsage.tokens === null || (typeof value.actualUsage.tokens === 'number' && Number.isFinite(value.actualUsage.tokens)))
  );
}

function isContext(value: unknown, requireCurrentFields = false): value is CoordinatorConversationContext {
  if (!isRecord(value) || value.timeZone !== 'America/Los_Angeles' || !string(value.asOf) || !string(value.today) || !string(value.yesterday) || !isRecord(value.availability)) return false;
  const sourceAvailability = value.availability;
  const availabilityKeys = ['tasks', 'schedules', 'workstreams', 'receipts', 'manualActivity'] as const;
  if (!availabilityKeys.every((key) => isAvailability(sourceAvailability[key]))) return false;
  if (sourceAvailability.rhythms !== undefined && !isAvailability(sourceAvailability.rhythms)) return false;
  const legacyFields = Array.isArray(value.todayTasks) && value.todayTasks.every(isTask) &&
    Array.isArray(value.waitingForReply) && value.waitingForReply.every(isTask) &&
    Array.isArray(value.doneWithUnknownCompletionDate) && value.doneWithUnknownCompletionDate.every(isTask) &&
    Array.isArray(value.scheduledPriorities) && value.scheduledPriorities.every(isSchedule) &&
    Array.isArray(value.activeWorkstreams) && value.activeWorkstreams.every(isWorkstream) &&
    Array.isArray(value.executionSucceededGoalUnverified) && value.executionSucceededGoalUnverified.every(isReceipt) &&
    Array.isArray(value.staleExecutions) && value.staleExecutions.every(isReceipt) &&
    Array.isArray(value.verifiedYesterday) && value.verifiedYesterday.every(isReceipt) &&
    Array.isArray(value.usageHolds) && value.usageHolds.every(isReceipt) &&
    Array.isArray(value.receipts) && value.receipts.every(isReceipt);
  if (!legacyFields || !requireCurrentFields) return legacyFields;
  return isAvailability(sourceAvailability.rhythms) &&
    isRecord(value.coverage) &&
    Array.isArray(value.activeRhythms) &&
    Array.isArray(value.manualActivity) &&
    (value.manualActivityDependency === null || isRecord(value.manualActivityDependency)) &&
    isRecord(value.modelContext);
}

const coordinatorResultKinds = new Set<CoordinatorConversationResult['kind']>([
  'created', 'replay', 'status', 'not_found', 'schema_unavailable', 'integrity_hold', 'context_unavailable',
  'model_integration_unavailable', 'planner_unavailable', 'revision_conflict', 'command_conflict', 'goal_limit',
  'setup_unavailable', 'planning_goal_not_found', 'planning_authority_required', 'planning_already_linked',
  'planning_authority_unavailable', 'planning_authority_conflict', 'planning_dependency_hold',
  'planning_terminal_hold', 'continuation_available', 'planning_link_conflict', 'planning_dispatch_hold', 'planned',
  'foreground_accepted', 'foreground_uncertain',
]);

const coordinatorPlanResultKinds = new Set<CoordinatorConversationResult['kind']>([
  'not_found', 'schema_unavailable', 'integrity_hold', 'setup_unavailable',
  'revision_conflict', 'command_conflict', 'goal_limit',
  'planning_goal_not_found', 'planning_authority_required', 'planning_already_linked',
  'planning_authority_unavailable', 'planning_authority_conflict', 'planning_dependency_hold',
  'planning_terminal_hold', 'continuation_available', 'planning_link_conflict',
  'planning_dispatch_hold', 'planned',
]);

function expectedStatus(kind: CoordinatorConversationResult['kind']): number {
  if (kind === 'created') return 201;
  if (kind === 'replay' || kind === 'status' || kind === 'foreground_accepted') return 200;
  if (kind === 'not_found') return 404;
  if (kind === 'schema_unavailable' || kind === 'context_unavailable' || kind === 'model_integration_unavailable' || kind === 'planner_unavailable' || kind === 'setup_unavailable' || kind === 'planning_authority_unavailable') return 503;
  if (kind === 'planned' || kind === 'continuation_available') return 200;
  return 409;
}

/** Reject malformed and cross-chat records before UI state can observe them. */
export function parseCoordinatorConversationResult(
  value: unknown,
  scope: Pick<CoordinatorConversationScope, 'sessionId' | 'projectId'>,
  status: number,
): CoordinatorConversationResult | undefined {
  if (!isRecord(value) || typeof value.kind !== 'string' || !coordinatorResultKinds.has(value.kind as CoordinatorConversationResult['kind'])) return undefined;
  const kind = value.kind as CoordinatorConversationResult['kind'];
  if (status !== expectedStatus(kind)) return undefined;
  if (value.conversation !== undefined && !isConversation(value.conversation, scope)) return undefined;
  if ((kind === 'created' || kind === 'replay') && !isConversation(value.conversation, scope)) return undefined;
  if (kind === 'status' && (
    !isConversation(value.conversation, scope) ||
    !isContext(value.context, isDedicatedCoordinatorSchema(value.conversation.schemaVersion))
  )) return undefined;
  if ((kind === 'created' || kind === 'replay') && value.goal !== undefined && !isGoal(value.goal)) return undefined;
  if (kind === 'planning_terminal_hold' || kind === 'planning_dispatch_hold') {
    if (!isConversation(value.conversation, scope) || !string(value.workstreamId)) return undefined;
  }
  if (kind === 'continuation_available') {
    if (!isConversation(value.conversation, scope) || !string(value.workstreamId) ||
      !Number.isSafeInteger(value.remainingTurns) || (value.remainingTurns as number) < 1) return undefined;
  }
  if (kind === 'planned') {
    if (!isConversation(value.conversation, scope) || !isPlannedWorkstream(value.workstream)) return undefined;
  }
  if ((kind === 'foreground_accepted' || kind === 'foreground_uncertain') && !isConversation(value.conversation, scope)) return undefined;
  if ([
    'planning_goal_not_found', 'planning_authority_required', 'planning_already_linked',
    'planning_authority_unavailable', 'planning_authority_conflict', 'planning_dependency_hold', 'planning_link_conflict',
  ].includes(kind) && !isConversation(value.conversation, scope)) return undefined;
  return value as CoordinatorConversationResult;
}

/** Planning endpoints never accept C1 transcript/status envelopes as a plan acknowledgement. */
export function parseCoordinatorPlanResult(
  value: unknown,
  scope: Pick<CoordinatorConversationScope, 'sessionId' | 'projectId'>,
  status: number,
): CoordinatorConversationResult | undefined {
  const result = parseCoordinatorConversationResult(value, scope, status);
  return result && coordinatorPlanResultKinds.has(result.kind) ? result : undefined;
}

/** Resolve has no client-chosen session. Only a self-consistent server root is accepted. */
export function parseCoordinatorResolveResult(value: unknown, status: number): CoordinatorResolveResult | undefined {
  if (!isRecord(value) || typeof value.kind !== 'string') return undefined;
  if (value.kind === 'resolved') {
    if (status !== 200 || typeof value.created !== 'boolean' || !string(value.sessionId) || !string(value.projectId)) return undefined;
    const scope = { sessionId: value.sessionId, projectId: value.projectId };
    // Resolve is the permanent C2 entry, not a general C1 lookup. Never let
    // an older/non-primary conversation redirect the client to a session.
    return isConversation(value.conversation, scope) &&
      isDedicatedCoordinatorSchema(value.conversation.schemaVersion) &&
      value.conversation.primaryOwnerRoot === true
      ? value as CoordinatorResolveResult
      : undefined;
  }
  if (value.kind === 'not_found' && status === 404) return { kind: 'not_found' };
  if ((value.kind === 'schema_unavailable' || value.kind === 'setup_unavailable') && status === 503) {
    return { kind: value.kind };
  }
  if (value.kind === 'integrity_hold' && status === 409) return { kind: 'integrity_hold' };
  return undefined;
}

/**
 * Setup is a closed bootstrap exchange.  The response may name only a
 * server-created root and opaque currently-eligible profile choices; neither
 * branch carries a client authority or a transcript turn.
 */
export function parseCoordinatorSetupResult(value: unknown, status: number): CoordinatorSetupResult | undefined {
  if (!isRecord(value) || typeof value.kind !== 'string') return undefined;
  if (value.kind === 'setup_profile_choice_required') {
    if (status !== 200 || !Array.isArray(value.profileChoices) || value.profileChoices.length === 0) return undefined;
    const seen = new Set<string>();
    const profileChoices: CoordinatorSetupProfileChoice[] = [];
    for (const choice of value.profileChoices) {
      if (!isRecord(choice) || !string(choice.id) || !string(choice.label) || seen.has(choice.id)) return undefined;
      seen.add(choice.id);
      profileChoices.push({ id: choice.id, label: choice.label });
    }
    return { kind: 'setup_profile_choice_required', profileChoices };
  }
  if (value.kind === 'setup_created' || value.kind === 'setup_replay') {
    const expected = value.kind === 'setup_created' ? 201 : 200;
    if (status !== expected || !string(value.sessionId) || !string(value.projectId) || !string(value.profileId) ||
      !Number.isSafeInteger(value.workspaceGeneration) || (value.workspaceGeneration as number) < 1) return undefined;
    const scope = { sessionId: value.sessionId, projectId: value.projectId };
    return isConversation(value.conversation, scope) &&
      isDedicatedCoordinatorSchema(value.conversation.schemaVersion) &&
      value.conversation.primaryOwnerRoot === true
      ? value as CoordinatorSetupResult
      : undefined;
  }
  return value.kind === 'setup_unavailable' && status === 503
    ? { kind: 'setup_unavailable' }
    : undefined;
}

function isHistoryMessage(value: unknown, scope: Pick<CoordinatorConversationScope, 'sessionId'>): value is CoordinatorHistoryMessage {
  return isRecord(value) && Number.isSafeInteger(value.id) && (value.id as number) >= 1 &&
    value.sessionId === scope.sessionId &&
    (value.role === 'output' || value.role === 'input' || value.role === 'system') &&
    typeof value.rawText === 'string' && typeof value.strippedText === 'string' && string(value.createdAt) &&
    (value.sdkMessageId === null || string(value.sdkMessageId)) && Array.isArray(value.parts) &&
    (value.tokens === null || isRecord(value.tokens)) &&
    (value.cost === null || (typeof value.cost === 'number' && Number.isFinite(value.cost)));
}

/** Canonical rows are accepted only from the returned root/session scope. */
export function parseCoordinatorHistoryResult(
  value: unknown,
  scope: Pick<CoordinatorConversationScope, 'sessionId' | 'projectId'>,
  status: number,
): CoordinatorHistoryResult | undefined {
  if (!isRecord(value) || value.kind !== 'history' || status !== 200 ||
    !isConversation(value.conversation, scope) || !Array.isArray(value.messages) ||
    !value.messages.every((message) => isHistoryMessage(message, scope)) ||
    (value.nextCursor !== null && !string(value.nextCursor)) || typeof value.hasMore !== 'boolean') return undefined;
  return value as CoordinatorHistoryResult;
}

function transportErrorForStatus(status: number): CoordinatorTransportError {
  if (status === 401) return new CoordinatorTransportError('Coordinator sign-in is required. Your draft is still here.', status, false);
  if (status === 403) return new CoordinatorTransportError('Your current sign-in cannot use coordinator chat. Your draft is still here.', status, false);
  if (status === 404) return new CoordinatorTransportError('Coordinator capability is unavailable for this chat.', status);
  if (status === 409) return new CoordinatorTransportError('Coordinator state needs review before another message can be sent.', status);
  if (status === 503) return new CoordinatorTransportError('Coordinator capability is temporarily unavailable. Your draft is still here.', status);
  return new CoordinatorTransportError('Coordinator request could not be completed. Your draft is still here.', status);
}

function malformedAcknowledgementError(status: number): CoordinatorTransportError {
  if (status === 200 || status === 201) {
    return new CoordinatorTransportError(
      'Coordinator acknowledgement could not be verified. Retry the same message when ready.',
      status,
      true,
    );
  }
  return transportErrorForStatus(status);
}

function endpoint(
  apiBase: string,
  operation: 'resolve' | 'setup' | 'open' | 'status' | 'message' | 'history' | 'goals' | 'prepare-plan' | 'continue-plan',
): string {
  return apiBase.replace(/\/$/, '') + COORDINATOR_CONVERSATIONS_PATH + '/' + operation;
}

function abortError(): DOMException {
  return new DOMException('The coordinator request was cancelled.', 'AbortError');
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Coordinator desktop adapter. This one local API surface is protected by
 * requireLocalOrCloudAuth, so it deliberately receives the signed-in bearer
 * from the live gateway. It never reaches the SDK or journals that credential.
 */
export function createLiveCoordinatorConversationGateway(
  apiBase: string,
  fetcher: typeof fetch,
  timeoutMs = COORDINATOR_REQUEST_TIMEOUT_MS,
  taskToken?: string,
): CoordinatorConversationGateway {
  const authorization = taskToken?.trim();
  // The trailing comma keeps this generic arrow unambiguous when a consumer
  // transpiles the source in TSX mode (as the source-level gateway tests do).
  const request = async <Result,>(
    operation: 'resolve' | 'setup' | 'open' | 'status' | 'message' | 'history' | 'goals' | 'prepare-plan' | 'continue-plan',
    payload: Record<string, unknown>,
    parse: (value: unknown, status: number) => Result | undefined,
    signal?: AbortSignal,
  ): Promise<Result> => {
    if (!authorization) {
      throw new CoordinatorTransportError('Coordinator sign-in is required. Your draft is still here.', 401, false);
    }
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', abortFromCaller, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await fetcher(endpoint(apiBase, operation), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${authorization}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
      const result = parse(body, response.status);
      if (result) return result;
      throw malformedAcknowledgementError(response.status);
    } catch (error) {
      if (timedOut) throw new CoordinatorTransportError('Coordinator request timed out. Your draft is still here.');
      if (signal?.aborted || isAbort(error)) throw abortError();
      if (error instanceof CoordinatorTransportError) throw error;
      throw new CoordinatorTransportError('Coordinator request could not be completed. Your draft is still here.');
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abortFromCaller);
    }
  };

  return {
    resolve: (input = {}, signal) => request('resolve',
      input.projectId ? { projectId: input.projectId } : {},
      parseCoordinatorResolveResult,
      signal,
    ),
    setup: (input, signal) => request('setup', {
      commandKey: input.commandKey,
      ...(input.profileId === undefined ? {} : { profileId: input.profileId }),
    }, parseCoordinatorSetupResult, signal),
    open: (input, signal) => request('open', { sessionId: input.sessionId, projectId: input.projectId },
      (body, status) => parseCoordinatorConversationResult(body, input, status), signal),
    status: (input, signal) => request('status', { sessionId: input.sessionId, projectId: input.projectId },
      (body, status) => parseCoordinatorConversationResult(body, input, status), signal),
    history: (input, signal) => request('history', {
      sessionId: input.sessionId,
      projectId: input.projectId,
      limit: input.limit,
      ...(input.beforeId === undefined ? {} : { beforeId: input.beforeId }),
    }, (body, status) => parseCoordinatorHistoryResult(body, input, status), signal),
    message: (input, signal) => request('message', {
      sessionId: input.sessionId,
      projectId: input.projectId,
      expectedControlRevision: input.expectedControlRevision,
      commandKey: input.commandKey,
      message: input.message,
    }, (body, status) => parseCoordinatorConversationResult(body, input, status), signal),
    goals: (input, signal) => request('goals', {
      sessionId: input.sessionId,
      projectId: input.projectId,
      expectedControlRevision: input.expectedControlRevision,
      commandKey: input.commandKey,
      objective: input.objective,
    }, (body, status) => parseCoordinatorConversationResult(body, input, status), signal),
    preparePlan: (input, signal) => request('prepare-plan', {
      sessionId: input.sessionId,
      projectId: input.projectId,
      expectedControlRevision: input.expectedControlRevision,
      goalId: input.goalId,
      admission: input.admission && {
        commandKey: input.admission.commandKey,
        totalTokenAuthorization: input.admission.totalTokenAuthorization,
        maxTurns: input.admission.maxTurns,
        maxWallTimeSeconds: input.admission.maxWallTimeSeconds,
        expiresInSeconds: input.admission.expiresInSeconds,
        acknowledgesSoftTotalTokenAuthorization: input.admission.acknowledgesSoftTotalTokenAuthorization,
        purpose: input.admission.purpose,
        ...(input.admission.purpose === 'execute'
          ? { acknowledgesScopedWorkspaceExecution: input.admission.acknowledgesScopedWorkspaceExecution }
          : {}),
      },
    }, (body, status) => parseCoordinatorPlanResult(body, input, status), signal),
    continuePlan: (input, signal) => request('continue-plan', {
      sessionId: input.sessionId,
      projectId: input.projectId,
      expectedControlRevision: input.expectedControlRevision,
      goalId: input.goalId,
      authorizationId: input.authorizationId,
    }, (body, status) => parseCoordinatorPlanResult(body, input, status), signal),
  };
}

/** Root and project-bound are UI eligibility only; server binding stays authoritative. */
export function coordinatorScopeForRootChat(input: {
  actorKey: string;
  sessionId?: string | null;
  projectId?: string | null;
  parentSessionId?: string | null;
  writable: boolean;
  mode: GatewayMode;
}): CoordinatorConversationScope | null {
  const sessionId = input.sessionId?.trim();
  const projectId = input.projectId?.trim();
  if (!input.writable || Boolean(input.parentSessionId) || !sessionId || !projectId) return null;
  // Fixture mode has no server record to bind. Leaving this null keeps the
  // usual fixture composer completely ordinary rather than simulating a goal.
  if (input.mode !== 'live') return null;
  return { actorKey: input.actorKey, sessionId, projectId };
}
