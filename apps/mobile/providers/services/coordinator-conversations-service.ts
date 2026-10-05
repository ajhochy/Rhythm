import type { PairedMacClient } from '@/lib/transport/paired-mac-client';
import { withProjectScope } from '@/lib/transport/project-scoped-request';

export const MOBILE_COORDINATOR_CONVERSATIONS_PATH = '/mobile-gateway/coordinator-conversations';
export const MOBILE_COORDINATOR_REQUEST_TIMEOUT_MS = 10_000;

export type MobileCoordinatorScope = {
  sessionId: string;
  projectId: string;
};

export type MobileCoordinatorGoal = {
  id: string;
  commandKey: string;
  objective: string;
  state: 'captured' | 'linked' | 'blocked';
  linkedWorkstreamId: string | null;
  revision?: number;
};

/** Server-issued finite-authority metadata; opaque IDs remain server-owned. */
export type MobileCoordinatorContinuation = {
  authorizationId: string;
  goalId: string;
  workstreamId: string;
  status: 'authorized' | 'consumed' | 'blocked';
  maxTurns: number;
  consumedTurns: number;
  expiresAt: string;
};

export type MobileCoordinatorConversation = {
  /** Older C1/C2 records remain readable; current published roots are v3. */
  schemaVersion: 1 | 2 | 3;
  id: string;
  sessionId: string;
  projectId: string;
  controlRevision: number;
  primaryOwnerRoot?: boolean;
  goals: MobileCoordinatorGoal[];
  continuations?: MobileCoordinatorContinuation[];
  /** Server-owned C2 metadata, never an input/authority selected by mobile. */
  commandDedupe?: unknown[];
  ownerUserId?: number;
};

export type MobileCoordinatorAvailability = {
  state: 'available' | 'not_configured' | 'unavailable';
  reason?: string | null;
};

export type MobileCoordinatorTask = {
  id: string;
  title: string;
  status: 'open' | 'in_progress' | 'waiting_for_reply' | 'done' | 'deferred';
};

export type MobileCoordinatorSchedule = {
  id: string;
  name: string;
  enabled: boolean;
};

export type MobileCoordinatorWorkstream = {
  id: string;
  state: 'ready' | 'queued' | 'running' | 'blocked' | 'paused' | 'cancelled' | 'completed' | 'unknown';
};

/** C2 returns the full server status view after dispatch, never a flat client workstream. */
export type MobileCoordinatorPlannedWorkstream = {
  workstream: MobileCoordinatorWorkstream;
  readiness: { available: boolean };
  jobs: unknown[];
  budget: Record<string, unknown>;
};

export type MobileCoordinatorReceipt = {
  id: string;
  workstreamId: string;
  jobId: string;
  executionState?: 'succeeded' | 'failed' | 'cancelled' | 'unknown' | 'running' | 'queued';
  criterionState?: 'pending' | 'blocked' | 'verified' | 'waived';
  actualUsage?: { state: 'actual' | 'unknown' | 'overshoot'; tokens?: number | null };
};

export type MobileCoordinatorContext = {
  timeZone: 'America/Los_Angeles';
  asOf: string;
  today: string;
  yesterday: string;
  availability: Record<'tasks' | 'schedules' | 'workstreams' | 'receipts' | 'manualActivity', MobileCoordinatorAvailability> & {
    rhythms?: MobileCoordinatorAvailability;
  };
  todayTasks: MobileCoordinatorTask[];
  waitingForReply: MobileCoordinatorTask[];
  doneWithUnknownCompletionDate: MobileCoordinatorTask[];
  scheduledPriorities: MobileCoordinatorSchedule[];
  activeWorkstreams: MobileCoordinatorWorkstream[];
  executionSucceededGoalUnverified: MobileCoordinatorReceipt[];
  staleExecutions: MobileCoordinatorReceipt[];
  verifiedYesterday: MobileCoordinatorReceipt[];
  usageHolds: MobileCoordinatorReceipt[];
  receipts: MobileCoordinatorReceipt[];
};

export type MobileCoordinatorPlanAdmission = {
  commandKey: string;
  totalTokenAuthorization: number;
  maxTurns: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  maxWallTimeSeconds: number;
  expiresInSeconds: number;
  acknowledgesSoftTotalTokenAuthorization: true;
  purpose: 'decompose' | 'continue' | 'execute';
  /** Required only for a newly acknowledged server-derived execute scope. */
  acknowledgesScopedWorkspaceExecution?: true;
};

export type MobileCoordinatorPreparePlan = MobileCoordinatorScope & {
  expectedControlRevision: number;
  goalId: string;
  admission: MobileCoordinatorPlanAdmission | null;
};

export type MobileCoordinatorContinuePlan = MobileCoordinatorScope & {
  expectedControlRevision: number;
  goalId: string;
  authorizationId: string;
};

export type MobileCoordinatorResolveResult =
  | { kind: 'resolved'; created: boolean; conversation: MobileCoordinatorConversation; sessionId: string; projectId: string }
  /** Paired routes expose only this opaque switch instruction before a replayed resolve. */
  | { kind: 'canonical_project_switch_required'; projectId: string; sessionId: string; controlRevision: number }
  | { kind: 'not_found' | 'schema_unavailable' | 'integrity_hold' | 'setup_unavailable' };

/** Existing canonical root-session rows only; acknowledgements never become bubbles. */
export type MobileCoordinatorHistoryMessage = {
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

export type MobileCoordinatorHistoryResult = {
  kind: 'history';
  conversation: MobileCoordinatorConversation;
  messages: MobileCoordinatorHistoryMessage[];
  nextCursor: string | null;
  hasMore: boolean;
};

/** Opaque current profile choice; it conveys no model, permission, or grant. */
export type MobileCoordinatorSetupProfileChoice = { id: string; label: string };

export type MobileCoordinatorSetupResult =
  | { kind: 'setup_profile_choice_required'; profileChoices: MobileCoordinatorSetupProfileChoice[] }
  | {
      kind: 'setup_created' | 'setup_replay';
      sessionId: string;
      projectId: string;
      profileId: string;
      workspaceGeneration: number;
      conversation: MobileCoordinatorConversation;
    }
  | { kind: 'setup_unavailable' };

export type MobileCoordinatorResult =
  | { kind: 'created' | 'replay'; conversation: MobileCoordinatorConversation; goal?: MobileCoordinatorGoal }
  | { kind: 'status'; conversation: MobileCoordinatorConversation; context: MobileCoordinatorContext }
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
      conversation?: MobileCoordinatorConversation;
    }
  | { kind: 'planning_terminal_hold' | 'planning_dispatch_hold'; conversation: MobileCoordinatorConversation; workstreamId: string }
  | { kind: 'continuation_available'; conversation: MobileCoordinatorConversation; workstreamId: string; remainingTurns: number }
  | { kind: 'planned'; conversation: MobileCoordinatorConversation; workstream: MobileCoordinatorPlannedWorkstream }
  | { kind: 'foreground_accepted'; conversation: MobileCoordinatorConversation }
  | { kind: 'foreground_uncertain'; conversation: MobileCoordinatorConversation };

export type MobileCoordinatorMessage = MobileCoordinatorScope & {
  expectedControlRevision: number;
  commandKey: string;
  message: string;
};

export type MobileCoordinatorGateway = {
  resolve?(input?: { projectId?: string }, signal?: AbortSignal): Promise<MobileCoordinatorResolveResult>;
  /** Device-authenticated before the selected-project guard; followups stay scoped. */
  setup?(input: { commandKey: string; profileId?: string }, signal?: AbortSignal): Promise<MobileCoordinatorSetupResult>;
  open(scope: MobileCoordinatorScope, signal?: AbortSignal): Promise<MobileCoordinatorResult>;
  status(scope: MobileCoordinatorScope, signal?: AbortSignal): Promise<MobileCoordinatorResult>;
  history?(
    input: MobileCoordinatorScope & { limit: number; beforeId?: number },
    signal?: AbortSignal,
  ): Promise<MobileCoordinatorHistoryResult>;
  message(input: MobileCoordinatorMessage, signal?: AbortSignal): Promise<MobileCoordinatorResult>;
  goals?(input: Omit<MobileCoordinatorMessage, 'message'> & { objective: string }, signal?: AbortSignal): Promise<MobileCoordinatorResult>;
  preparePlan?(input: MobileCoordinatorPreparePlan, signal?: AbortSignal): Promise<MobileCoordinatorResult>;
  continuePlan?(input: MobileCoordinatorContinuePlan, signal?: AbortSignal): Promise<MobileCoordinatorResult>;
};

export class MobileCoordinatorTransportError extends Error {
  readonly status: number | undefined;
  readonly retryable: boolean;

  constructor(message: string, status?: number, retryable?: boolean) {
    super(message);
    this.name = 'MobileCoordinatorTransportError';
    this.status = status;
    this.retryable = retryable ?? (status === undefined || status >= 500);
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function goal(value: unknown): value is MobileCoordinatorGoal {
  return record(value) && text(value.id) && text(value.commandKey) && text(value.objective) &&
    (value.state === 'captured' || value.state === 'linked' || value.state === 'blocked') &&
    (value.linkedWorkstreamId === null || text(value.linkedWorkstreamId)) &&
    (value.revision === undefined || (Number.isSafeInteger(value.revision) && (value.revision as number) >= 1));
}

function continuation(value: unknown): value is MobileCoordinatorContinuation {
  return record(value) && text(value.authorizationId) && text(value.goalId) && text(value.workstreamId) &&
    (value.status === 'authorized' || value.status === 'consumed' || value.status === 'blocked') &&
    Number.isSafeInteger(value.maxTurns) && (value.maxTurns as number) >= 1 && (value.maxTurns as number) <= 8 &&
    Number.isSafeInteger(value.consumedTurns) && (value.consumedTurns as number) >= 0 &&
    (value.consumedTurns as number) <= (value.maxTurns as number) && text(value.expiresAt);
}

function conversation(value: unknown, scope: MobileCoordinatorScope): value is MobileCoordinatorConversation {
  if (!record(value) || (value.schemaVersion !== 1 && value.schemaVersion !== 2 && value.schemaVersion !== 3) || !text(value.id) ||
    value.sessionId !== scope.sessionId || value.projectId !== scope.projectId ||
    !Number.isSafeInteger(value.controlRevision) || (value.controlRevision as number) < 1 ||
    !Array.isArray(value.goals) || !value.goals.every(goal) ||
    (value.primaryOwnerRoot !== undefined && typeof value.primaryOwnerRoot !== 'boolean') ||
    (value.continuations !== undefined && (!Array.isArray(value.continuations) || !value.continuations.every(continuation)))) return false;
  return value.schemaVersion !== 3 ||
    (typeof value.primaryOwnerRoot === 'boolean' &&
      (value.ownerUserId === undefined || (Number.isSafeInteger(value.ownerUserId) && (value.ownerUserId as number) > 0)) &&
      (value.commandDedupe === undefined || Array.isArray(value.commandDedupe)));
}

function availability(value: unknown): value is MobileCoordinatorAvailability {
  return record(value) && (value.state === 'available' || value.state === 'not_configured' || value.state === 'unavailable');
}

function workstream(value: unknown): value is MobileCoordinatorWorkstream {
  return record(value) && text(value.id) &&
    (value.state === 'ready' || value.state === 'queued' || value.state === 'running' ||
      value.state === 'blocked' || value.state === 'paused' || value.state === 'cancelled' ||
      value.state === 'completed' || value.state === 'unknown');
}

function plannedWorkstream(value: unknown): value is MobileCoordinatorPlannedWorkstream {
  return record(value) && workstream(value.workstream) && record(value.readiness) &&
    typeof value.readiness.available === 'boolean' && Array.isArray(value.jobs) && record(value.budget);
}

function nullableText(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

function task(value: unknown): value is MobileCoordinatorTask {
  return record(value) && text(value.id) && text(value.title) &&
    (value.status === 'open' || value.status === 'in_progress' || value.status === 'waiting_for_reply' || value.status === 'done' || value.status === 'deferred');
}

function schedule(value: unknown): value is MobileCoordinatorSchedule {
  return record(value) && text(value.id) && text(value.name) && typeof value.enabled === 'boolean' && nullableText(value.nextRunAt);
}

function receipt(value: unknown): value is MobileCoordinatorReceipt {
  if (!record(value) || !text(value.id) || !text(value.workstreamId) || !text(value.jobId)) return false;
  if (value.executionState !== undefined && !['succeeded', 'failed', 'cancelled', 'unknown', 'running', 'queued'].includes(value.executionState as string)) return false;
  if (value.criterionState !== undefined && !['pending', 'blocked', 'verified', 'waived'].includes(value.criterionState as string)) return false;
  return value.actualUsage === undefined || (
    record(value.actualUsage) &&
    (value.actualUsage.state === 'actual' || value.actualUsage.state === 'unknown' || value.actualUsage.state === 'overshoot') &&
    (value.actualUsage.tokens === undefined || value.actualUsage.tokens === null || (typeof value.actualUsage.tokens === 'number' && Number.isFinite(value.actualUsage.tokens)))
  );
}

function context(value: unknown, requireCurrentFields = false): value is MobileCoordinatorContext {
  if (!record(value) || value.timeZone !== 'America/Los_Angeles' || !text(value.asOf) || !text(value.today) || !text(value.yesterday) || !record(value.availability)) return false;
  const sourceAvailability = value.availability;
  const sourceKeys = ['tasks', 'schedules', 'workstreams', 'receipts', 'manualActivity'] as const;
  if (!sourceKeys.every((key) => availability(sourceAvailability[key]))) return false;
  if (sourceAvailability.rhythms !== undefined && !availability(sourceAvailability.rhythms)) return false;
  const legacyFields = Array.isArray(value.todayTasks) && value.todayTasks.every(task) &&
    Array.isArray(value.waitingForReply) && value.waitingForReply.every(task) &&
    Array.isArray(value.doneWithUnknownCompletionDate) && value.doneWithUnknownCompletionDate.every(task) &&
    Array.isArray(value.scheduledPriorities) && value.scheduledPriorities.every(schedule) &&
    Array.isArray(value.activeWorkstreams) && value.activeWorkstreams.every(workstream) &&
    Array.isArray(value.executionSucceededGoalUnverified) && value.executionSucceededGoalUnverified.every(receipt) &&
    Array.isArray(value.staleExecutions) && value.staleExecutions.every(receipt) &&
    Array.isArray(value.verifiedYesterday) && value.verifiedYesterday.every(receipt) &&
    Array.isArray(value.usageHolds) && value.usageHolds.every(receipt) &&
    Array.isArray(value.receipts) && value.receipts.every(receipt);
  if (!legacyFields || !requireCurrentFields) return legacyFields;
  return availability(sourceAvailability.rhythms) && record(value.coverage) &&
    Array.isArray(value.activeRhythms) && Array.isArray(value.manualActivity) &&
    (value.manualActivityDependency === null || record(value.manualActivityDependency)) &&
    record(value.modelContext);
}

const kinds = new Set<MobileCoordinatorResult['kind']>([
  'created', 'replay', 'status', 'not_found', 'schema_unavailable', 'integrity_hold', 'context_unavailable',
  'model_integration_unavailable', 'planner_unavailable', 'revision_conflict', 'command_conflict', 'goal_limit',
  'setup_unavailable', 'planning_goal_not_found', 'planning_authority_required', 'planning_already_linked',
  'planning_authority_unavailable', 'planning_authority_conflict', 'planning_dependency_hold',
  'planning_terminal_hold', 'continuation_available', 'planning_link_conflict', 'planning_dispatch_hold', 'planned',
  'foreground_accepted', 'foreground_uncertain',
]);

const planKinds = new Set<MobileCoordinatorResult['kind']>([
  'not_found', 'schema_unavailable', 'integrity_hold', 'setup_unavailable',
  'revision_conflict', 'command_conflict', 'goal_limit',
  'planning_goal_not_found', 'planning_authority_required', 'planning_already_linked',
  'planning_authority_unavailable', 'planning_authority_conflict', 'planning_dependency_hold',
  'planning_terminal_hold', 'continuation_available', 'planning_link_conflict',
  'planning_dispatch_hold', 'planned',
]);

function expectedStatus(kind: MobileCoordinatorResult['kind']): number {
  if (kind === 'created') return 201;
  if (kind === 'replay' || kind === 'status' || kind === 'foreground_accepted') return 200;
  if (kind === 'not_found') return 404;
  if (kind === 'schema_unavailable' || kind === 'context_unavailable' || kind === 'model_integration_unavailable' || kind === 'planner_unavailable' || kind === 'setup_unavailable' || kind === 'planning_authority_unavailable') return 503;
  if (kind === 'planned' || kind === 'continuation_available') return 200;
  return 409;
}

/** Defend the mobile view from a malformed or cross-project gateway response. */
export function parseMobileCoordinatorResult(
  value: unknown,
  scope: MobileCoordinatorScope,
  status: number,
): MobileCoordinatorResult | undefined {
  if (!record(value) || typeof value.kind !== 'string' || !kinds.has(value.kind as MobileCoordinatorResult['kind'])) return undefined;
  const kind = value.kind as MobileCoordinatorResult['kind'];
  if (status !== expectedStatus(kind)) return undefined;
  if (value.conversation !== undefined && !conversation(value.conversation, scope)) return undefined;
  if ((kind === 'created' || kind === 'replay') && !conversation(value.conversation, scope)) return undefined;
  if (kind === 'status' && (
    !conversation(value.conversation, scope) ||
    !context(value.context, value.conversation.schemaVersion === 3)
  )) return undefined;
  if ((kind === 'created' || kind === 'replay') && value.goal !== undefined && !goal(value.goal)) return undefined;
  if (kind === 'planning_terminal_hold' || kind === 'planning_dispatch_hold') {
    if (!conversation(value.conversation, scope) || !text(value.workstreamId)) return undefined;
  }
  if (kind === 'continuation_available') {
    if (!conversation(value.conversation, scope) || !text(value.workstreamId) ||
      !Number.isSafeInteger(value.remainingTurns) || (value.remainingTurns as number) < 1) return undefined;
  }
  if (kind === 'planned') {
    if (!conversation(value.conversation, scope) || !plannedWorkstream(value.workstream)) return undefined;
  }
  if ((kind === 'foreground_accepted' || kind === 'foreground_uncertain') && !conversation(value.conversation, scope)) return undefined;
  if ([
    'planning_goal_not_found', 'planning_authority_required', 'planning_already_linked',
    'planning_authority_unavailable', 'planning_authority_conflict', 'planning_dependency_hold', 'planning_link_conflict',
  ].includes(kind) && !conversation(value.conversation, scope)) return undefined;
  return value as MobileCoordinatorResult;
}

/** A C1 status/replay envelope cannot acknowledge managed planning. */
export function parseMobileCoordinatorPlanResult(
  value: unknown,
  scope: MobileCoordinatorScope,
  status: number,
): MobileCoordinatorResult | undefined {
  const result = parseMobileCoordinatorResult(value, scope, status);
  return result && planKinds.has(result.kind) ? result : undefined;
}

/** Resolve admits only a self-consistent server-owned root scope. */
export function parseMobileCoordinatorResolveResult(value: unknown, status: number): MobileCoordinatorResolveResult | undefined {
  if (!record(value) || typeof value.kind !== 'string') return undefined;
  if (value.kind === 'resolved') {
    if (status !== 200 || typeof value.created !== 'boolean' || !text(value.sessionId) || !text(value.projectId)) return undefined;
    const scope = { sessionId: value.sessionId, projectId: value.projectId };
    // The mobile permanent entry may only adopt the server-designated C2
    // primary root; a C1/non-primary response cannot move the selected chat.
    return conversation(value.conversation, scope) &&
      value.conversation.schemaVersion === 3 &&
      value.conversation.primaryOwnerRoot === true
      ? value as MobileCoordinatorResolveResult
      : undefined;
  }
  if (value.kind === 'canonical_project_switch_required') {
    return status === 200 && text(value.projectId) && text(value.sessionId) &&
      Number.isSafeInteger(value.controlRevision) && (value.controlRevision as number) >= 1
      ? value as MobileCoordinatorResolveResult
      : undefined;
  }
  if (value.kind === 'not_found' && status === 404) return { kind: 'not_found' };
  if ((value.kind === 'schema_unavailable' || value.kind === 'setup_unavailable') && status === 503) return { kind: value.kind };
  if (value.kind === 'integrity_hold' && status === 409) return { kind: 'integrity_hold' };
  return undefined;
}

/** Reject setup payloads unless they name only a self-consistent server root. */
export function parseMobileCoordinatorSetupResult(value: unknown, status: number): MobileCoordinatorSetupResult | undefined {
  if (!record(value) || typeof value.kind !== 'string') return undefined;
  if (value.kind === 'setup_profile_choice_required') {
    if (status !== 200 || !Array.isArray(value.profileChoices) || value.profileChoices.length === 0) return undefined;
    const seen = new Set<string>();
    const profileChoices: MobileCoordinatorSetupProfileChoice[] = [];
    for (const choice of value.profileChoices) {
      if (!record(choice) || !text(choice.id) || !text(choice.label) || seen.has(choice.id)) return undefined;
      seen.add(choice.id);
      profileChoices.push({ id: choice.id, label: choice.label });
    }
    return { kind: 'setup_profile_choice_required', profileChoices };
  }
  if (value.kind === 'setup_created' || value.kind === 'setup_replay') {
    const expected = value.kind === 'setup_created' ? 201 : 200;
    if (status !== expected || !text(value.sessionId) || !text(value.projectId) || !text(value.profileId) ||
      !Number.isSafeInteger(value.workspaceGeneration) || (value.workspaceGeneration as number) < 1) return undefined;
    const scope = { sessionId: value.sessionId, projectId: value.projectId };
    return conversation(value.conversation, scope) && value.conversation.schemaVersion === 3 && value.conversation.primaryOwnerRoot === true
      ? value as MobileCoordinatorSetupResult
      : undefined;
  }
  return value.kind === 'setup_unavailable' && status === 503
    ? { kind: 'setup_unavailable' }
    : undefined;
}

function historyMessage(value: unknown, scope: Pick<MobileCoordinatorScope, 'sessionId'>): value is MobileCoordinatorHistoryMessage {
  return record(value) && Number.isSafeInteger(value.id) && (value.id as number) >= 1 &&
    value.sessionId === scope.sessionId &&
    (value.role === 'output' || value.role === 'input' || value.role === 'system') &&
    typeof value.rawText === 'string' && typeof value.strippedText === 'string' && text(value.createdAt) &&
    (value.sdkMessageId === null || text(value.sdkMessageId)) && Array.isArray(value.parts) &&
    (value.tokens === null || record(value.tokens)) &&
    (value.cost === null || (typeof value.cost === 'number' && Number.isFinite(value.cost)));
}

/** Canonical history is accepted only when every row remains in the bound root scope. */
export function parseMobileCoordinatorHistoryResult(
  value: unknown,
  scope: MobileCoordinatorScope,
  status: number,
): MobileCoordinatorHistoryResult | undefined {
  if (!record(value) || value.kind !== 'history' || status !== 200 ||
    !conversation(value.conversation, scope) || !Array.isArray(value.messages) ||
    !value.messages.every((message) => historyMessage(message, scope)) ||
    (value.nextCursor !== null && !text(value.nextCursor)) || typeof value.hasMore !== 'boolean') return undefined;
  return value as MobileCoordinatorHistoryResult;
}

function failure(status: number): MobileCoordinatorTransportError {
  if (status === 404) return new MobileCoordinatorTransportError('Coordinator capability is unavailable for this chat.', status);
  if (status === 409) return new MobileCoordinatorTransportError('Coordinator state needs review before another message can be sent.', status);
  if (status === 503) return new MobileCoordinatorTransportError('Coordinator capability is temporarily unavailable. Your draft is still here.', status);
  return new MobileCoordinatorTransportError('Coordinator request could not be completed. Your draft is still here.', status);
}

function malformedAcknowledgement(status: number): MobileCoordinatorTransportError {
  if (status === 200 || status === 201) {
    return new MobileCoordinatorTransportError(
      'Coordinator acknowledgement could not be verified. Retry the same message when ready.',
      status,
      true,
    );
  }
  return failure(status);
}

function abortError(): Error {
  const error = new Error('The coordinator request was cancelled.');
  error.name = 'AbortError';
  return error;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

type RawPairedClient = Pick<PairedMacClient, 'fetchResponse'>;

/**
 * Uses PairedMacClient.fetchResponse so the established per-request Device
 * credential and raw HTTP semantics stay intact. No cloud bearer is added.
 */
export function createPairedCoordinatorConversationGateway(
  client: RawPairedClient,
  timeoutMs = MOBILE_COORDINATOR_REQUEST_TIMEOUT_MS,
): MobileCoordinatorGateway {
  // Keep the generic arrow parseable by TSX-mode source consumers too.
  const request = async <Result,>(
    operation: 'resolve' | 'open' | 'status' | 'message' | 'history' | 'goals' | 'prepare-plan' | 'continue-plan',
    body: Record<string, unknown>,
    projectId: string,
    parse: (value: unknown, status: number) => Result | undefined,
    signal?: AbortSignal,
  ): Promise<Result> => {
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', abortFromCaller, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await client.fetchResponse(
        MOBILE_COORDINATOR_CONVERSATIONS_PATH + '/' + operation,
        withProjectScope(projectId, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        }),
      );
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        parsed = undefined;
      }
      const result = parse(parsed, response.status);
      if (result) return result;
      throw malformedAcknowledgement(response.status);
    } catch (error) {
      if (timedOut) throw new MobileCoordinatorTransportError('Coordinator request timed out. Your draft is still here.');
      if (signal?.aborted || isAbort(error)) throw abortError();
      if (error instanceof MobileCoordinatorTransportError) throw error;
      throw new MobileCoordinatorTransportError('Coordinator request could not be completed. Your draft is still here.');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortFromCaller);
    }
  };

  // Setup has no caller-selected project. PairedMacClient still attaches its
  // per-request device credential; omitting withProjectScope is deliberate so
  // the server can create or replay the authoritative project/root first.
  const setup = async (
    input: { commandKey: string; profileId?: string },
    signal?: AbortSignal,
  ): Promise<MobileCoordinatorSetupResult> => {
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', abortFromCaller, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const response = await client.fetchResponse(
        MOBILE_COORDINATOR_CONVERSATIONS_PATH + '/setup',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            commandKey: input.commandKey,
            ...(input.profileId === undefined ? {} : { profileId: input.profileId }),
          }),
          signal: controller.signal,
        },
      );
      let parsed: unknown;
      try { parsed = await response.json(); } catch { parsed = undefined; }
      const result = parseMobileCoordinatorSetupResult(parsed, response.status);
      if (result) return result;
      throw malformedAcknowledgement(response.status);
    } catch (error) {
      if (timedOut) throw new MobileCoordinatorTransportError('Coordinator setup timed out. Nothing was retried automatically.');
      if (signal?.aborted || isAbort(error)) throw abortError();
      if (error instanceof MobileCoordinatorTransportError) throw error;
      throw new MobileCoordinatorTransportError('Coordinator setup could not be completed. Nothing was retried automatically.');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortFromCaller);
    }
  };

  return {
    resolve: (input = {}, signal) => {
      const projectId = input.projectId?.trim();
      if (!projectId) {
        return Promise.reject(new MobileCoordinatorTransportError(
          'Choose a current paired project before opening Rhythm.',
          409,
          false,
        ));
      }
      return request('resolve', { projectId }, projectId, parseMobileCoordinatorResolveResult, signal);
    },
    setup,
    open: (scope, signal) => request('open', {
      sessionId: scope.sessionId,
      projectId: scope.projectId,
    }, scope.projectId, (body, status) => parseMobileCoordinatorResult(body, scope, status), signal),
    status: (scope, signal) => request('status', {
      sessionId: scope.sessionId,
      projectId: scope.projectId,
    }, scope.projectId, (body, status) => parseMobileCoordinatorResult(body, scope, status), signal),
    history: (input, signal) => request('history', {
      sessionId: input.sessionId,
      projectId: input.projectId,
      limit: input.limit,
      ...(input.beforeId === undefined ? {} : { beforeId: input.beforeId }),
    }, input.projectId, (body, status) => parseMobileCoordinatorHistoryResult(body, input, status), signal),
    message: (input, signal) => request('message', {
      sessionId: input.sessionId,
      projectId: input.projectId,
      expectedControlRevision: input.expectedControlRevision,
      commandKey: input.commandKey,
      message: input.message,
    }, input.projectId, (body, status) => parseMobileCoordinatorResult(body, input, status), signal),
    goals: (input, signal) => request('goals', {
      sessionId: input.sessionId,
      projectId: input.projectId,
      expectedControlRevision: input.expectedControlRevision,
      commandKey: input.commandKey,
      objective: input.objective,
    }, input.projectId, (body, status) => parseMobileCoordinatorResult(body, input, status), signal),
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
    }, input.projectId, (body, status) => parseMobileCoordinatorPlanResult(body, input, status), signal),
    continuePlan: (input, signal) => request('continue-plan', {
      sessionId: input.sessionId,
      projectId: input.projectId,
      expectedControlRevision: input.expectedControlRevision,
      goalId: input.goalId,
      authorizationId: input.authorizationId,
    }, input.projectId, (body, status) => parseMobileCoordinatorPlanResult(body, input, status), signal),
  };
}
