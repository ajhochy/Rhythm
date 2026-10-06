import type { MobileCoordinatorBinding } from '@/providers/coordinator-conversation-binding';
import {
  createMemoryMobileCoordinatorJournal,
  MobileCoordinatorJournalCorruptError,
  type MobileCoordinatorJournal,
  type MobileCoordinatorJournalRejection,
  type MobileCoordinatorJournalRetirement,
  type MobileCoordinatorJournalSnapshot,
} from '@/providers/coordinator-conversation-journal';
import {
  MobileCoordinatorTransportError,
  type MobileCoordinatorContext,
  type MobileCoordinatorConversation,
  type MobileCoordinatorGateway,
  type MobileCoordinatorHistoryResult,
  type MobileCoordinatorPlanAdmission,
  type MobileCoordinatorPlannedWorkstream,
  type MobileCoordinatorResult,
} from '@/providers/services/coordinator-conversations-service';

export type MobileCoordinatorPhase =
  | 'inactive'
  | 'opening'
  | 'refreshing'
  | 'sending'
  | 'ready'
  | 'unavailable'
  | 'review';

export type MobileCoordinatorPendingCommand = {
  commandKey: string;
  expectedControlRevision: number;
  message: string;
};

export type MobileCoordinatorNotice = {
  message: string;
  retryable: boolean;
};

export type MobileCoordinatorViewState = {
  enabled: boolean;
  phase: MobileCoordinatorPhase;
  conversation?: MobileCoordinatorConversation;
  context?: MobileCoordinatorContext;
  notice?: MobileCoordinatorNotice;
  pendingCommand?: MobileCoordinatorPendingCommand;
  /** Unknown delivery can only retry the same immutable command. */
  pendingProvenance?: 'uncertain' | 'rejected';
  reviewedConflictRevision?: number;
  /** Mounted-view exact retry for a finite C2 request; never durable authority. */
  pendingPlan?: { goalId: string; kind: 'prepare' | 'continue' };
  /** Latest typed server plan/status view; it never proves a criterion. */
  plannedWorkstream?: MobileCoordinatorPlannedWorkstream;
  /** Existing persisted root rows only; never populated from an ACK. */
  canonicalHistory?: MobileCoordinatorHistoryResult;
  canonicalHistoryLoading?: boolean;
};

export type MobileCoordinatorPlanConsent = Omit<MobileCoordinatorPlanAdmission, 'commandKey'>;

type RecordState = Omit<MobileCoordinatorViewState, 'canonicalHistory' | 'canonicalHistoryLoading'> & {
  /** Present only after this exact pending command received a direct 409. */
  pendingRejection?: MobileCoordinatorJournalRejection;
  /** Operation-local proof consumed only by exact durable command retirement. */
  pendingRetirement?: MobileCoordinatorJournalRetirement;
  planAttempt?: MobileCoordinatorPlanAttempt;
  canonicalHistory?: MobileCoordinatorHistoryResult;
  canonicalHistoryLoading?: boolean;
  journalBlocked?: boolean;
  journalRevision: number;
  /** Invalidates pre-wire persistence without cancelling an active send. */
  admissionGeneration: number;
  requestVersion: number;
  request?: Promise<boolean>;
  requestToken?: symbol;
  requestKind?: 'open' | 'refresh' | 'send' | 'prepare-plan' | 'continue-plan';
  /** A qualified event arrived during a scoped operation: one read-only re-read after it settles. */
  trailingEpoch?: number;
};

type MobileCoordinatorPlanAttempt =
  | { kind: 'prepare'; input: MobileCoordinatorPlanAdmission; goalId: string; expectedControlRevision: number }
  | { kind: 'continue'; goalId: string; authorizationId: string; expectedControlRevision: number };

const inactive: MobileCoordinatorViewState = {
  enabled: false,
  phase: 'inactive',
};

export function mobileCoordinatorScopeKey(binding: MobileCoordinatorBinding | null | undefined): string {
  return binding
    ? [binding.actorKey, binding.projectId, binding.sessionId, binding.uiSessionId].join('\u0000')
    : '';
}

function commandKey(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random
    ? 'coordinator:' + random
    : 'coordinator:' + Date.now() + ':' + Math.random().toString(36).slice(2);
}

function noticeFor(result: MobileCoordinatorResult): MobileCoordinatorNotice {
  switch (result.kind) {
    case 'revision_conflict':
      return { message: 'This coordination view changed elsewhere. Refresh and review it before writing a new message.', retryable: false };
    case 'command_conflict':
      return { message: 'This coordinator command conflicts with an existing control. Refresh and review it before writing a new message.', retryable: false };
    case 'integrity_hold':
      return { message: 'Rhythm placed this coordination request on hold. No work was started.', retryable: false };
    case 'goal_limit':
      return { message: 'This chat has reached its current coordinator goal limit. No new goal was created.', retryable: false };
    case 'model_integration_unavailable':
      return { message: 'Rhythm can retain explicit goals and status here, but ordinary chat is not available through this coordinator connection yet.', retryable: false };
    case 'foreground_uncertain':
      return { message: 'Rhythm could not confirm that this chat message reached the canonical transcript. It was not resent automatically.', retryable: true };
    case 'planner_unavailable':
      return { message: 'Planning is not available for this chat yet. No work was started.', retryable: false };
    case 'setup_unavailable':
      return { message: 'Rhythm is not set up for a managed planning turn in this chat yet. No work was started.', retryable: false };
    case 'planning_goal_not_found':
      return { message: 'That authored goal is no longer available. Refresh before planning.', retryable: false };
    case 'planning_authority_required':
      return { message: 'Review and explicitly authorize a finite managed planning turn before work can start.', retryable: false };
    case 'planning_already_linked':
      return { message: 'This exact planning authorization was already recorded. Refresh to inspect its current status.', retryable: false };
    case 'planning_authority_unavailable':
      return { message: 'Rhythm cannot currently qualify this managed planning authorization. No work was started.', retryable: false };
    case 'planning_authority_conflict':
    case 'planning_link_conflict':
      return { message: 'This goal changed elsewhere. Refresh and review it before another managed planning request.', retryable: false };
    case 'planning_dependency_hold':
      return { message: 'Rhythm placed planning on hold because required current context is unavailable. No work was started.', retryable: false };
    case 'planning_terminal_hold':
      return { message: 'Rhythm is waiting for a qualified terminal receipt before continuing. No work was started.', retryable: false };
    case 'planning_dispatch_hold':
      return { message: 'Rhythm could not safely dispatch managed work. No work was started.', retryable: false };
    case 'context_unavailable':
      return { message: 'Rhythm could not load current coordination context. Your draft is still here.', retryable: true };
    case 'schema_unavailable':
      return { message: 'This coordinator record is unavailable. Your draft is still here.', retryable: true };
    case 'not_found':
      return { message: 'Coordinator capability is unavailable for this chat. Normal chat remains available.', retryable: false };
    default:
      return { message: 'Coordinator response needs review. Your draft is still here.', retryable: false };
  }
}

function validPlanConsent(consent: MobileCoordinatorPlanConsent): boolean {
  const executesScopedWorkspace = consent.purpose === 'execute';
  return Number.isSafeInteger(consent.totalTokenAuthorization) && consent.totalTokenAuthorization >= 1 && consent.totalTokenAuthorization <= 2_000_000 &&
    Number.isSafeInteger(consent.maxTurns) && consent.maxTurns >= 1 && consent.maxTurns <= 8 &&
    Number.isSafeInteger(consent.maxWallTimeSeconds) && consent.maxWallTimeSeconds >= 30 && consent.maxWallTimeSeconds <= 300 &&
    Number.isSafeInteger(consent.expiresInSeconds) && consent.expiresInSeconds >= 30 && consent.expiresInSeconds <= 3_600 &&
    consent.acknowledgesSoftTotalTokenAuthorization === true &&
    (consent.purpose === 'decompose' || consent.purpose === 'continue' || executesScopedWorkspace) &&
    (!executesScopedWorkspace || consent.acknowledgesScopedWorkspaceExecution === true);
}

function errorNotice(error: unknown): MobileCoordinatorNotice {
  if (error instanceof MobileCoordinatorTransportError) {
    return { message: error.message, retryable: error.retryable };
  }
  return { message: 'Coordinator request could not be completed. Your draft is still here.', retryable: true };
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function isConflict(result: MobileCoordinatorResult): boolean {
  return result.kind === 'revision_conflict' || result.kind === 'command_conflict';
}

function isDefinitiveRejection(
  result: MobileCoordinatorResult,
): result is MobileCoordinatorResult & { kind: 'revision_conflict' | 'command_conflict' } {
  // Only a typed server control conflict proves the prior command was not
  // admitted. Local UI review, refresh, timeout, and malformed success do not.
  return isConflict(result);
}

function rejectionFor(
  pending: MobileCoordinatorPendingCommand,
  result: MobileCoordinatorResult,
): MobileCoordinatorJournalRejection | undefined {
  if (!isDefinitiveRejection(result)) return undefined;
  return {
    commandKey: pending.commandKey,
    expectedControlRevision: pending.expectedControlRevision,
    kind: result.kind,
  };
}

function matchesPendingRejection(
  pending: MobileCoordinatorPendingCommand | undefined,
  rejection: MobileCoordinatorJournalRejection | undefined,
): boolean {
  return Boolean(
    pending && rejection &&
    pending.commandKey === rejection.commandKey &&
    pending.expectedControlRevision === rejection.expectedControlRevision,
  );
}

function matchesRetirement(
  left: MobileCoordinatorJournalRetirement | undefined,
  right: MobileCoordinatorJournalRetirement | undefined,
): boolean {
  return Boolean(
    left && right &&
    left.kind === right.kind &&
    left.command.commandKey === right.command.commandKey &&
    left.command.expectedControlRevision === right.command.expectedControlRevision &&
    left.command.message === right.command.message &&
    left.reviewedConflictRevision === right.reviewedConflictRevision,
  );
}

/** Preserve loaded server pages while deduplicating only their persisted row id. */
export function mergeMobileCoordinatorHistory(
  previous: MobileCoordinatorHistoryResult | undefined,
  incoming: MobileCoordinatorHistoryResult,
): MobileCoordinatorHistoryResult {
  const rows = new Map<number, MobileCoordinatorHistoryResult['messages'][number]>();
  previous?.messages.forEach((message) => rows.set(message.id, message));
  incoming.messages.forEach((message) => rows.set(message.id, message));
  return {
    ...incoming,
    messages: [...rows.values()].sort((left, right) => left.id - right.id),
    hasMore: previous?.hasMore === false ? false : incoming.hasMore,
    nextCursor: previous?.hasMore === false ? null : incoming.nextCursor,
  };
}

function installConversation(record: RecordState, result: MobileCoordinatorResult): void {
  if (result.kind === 'created' || result.kind === 'replay' || result.kind === 'status') {
    record.conversation = result.conversation;
  } else if (result.conversation) {
    record.conversation = result.conversation;
  }
  if (result.kind === 'status') record.context = result.context;
}

/**
 * Scoped controller backed by a tiny view-pointer/command journal. It is not
 * transcript storage and cannot provide coordinator authority; it retains an
 * uncertain command only until the server resolves the exact same key.
 */
export class MobileCoordinatorConversationController {
  private readonly records = new Map<string, RecordState>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly historyControllers = new Map<string, AbortController>();
  private readonly revalidations = new Map<string, { epoch: number; again: boolean; promise: Promise<boolean> }>();
  private readonly listeners = new Set<() => void>();
  private readonly hydrated = new Set<string>();
  private readonly hydrating = new Map<string, Promise<boolean>>();
  private activeKey = '';
  private activeClient: object | undefined;
  private activeEpoch = 0;

  constructor(
    private readonly gatewayFor: (binding: MobileCoordinatorBinding) => MobileCoordinatorGateway | undefined,
    private readonly journal: MobileCoordinatorJournal = createMemoryMobileCoordinatorJournal(),
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }

  private record(key: string): RecordState {
    const current = this.records.get(key);
    if (current) return current;
    const next: RecordState = {
      enabled: false,
      phase: 'inactive',
      journalRevision: 0,
      admissionGeneration: 0,
      requestVersion: 0,
    };
    this.records.set(key, next);
    return next;
  }

  private snapshot(record: RecordState): MobileCoordinatorJournalSnapshot {
    return {
      viewEnabled: record.enabled,
      ...(record.pendingCommand ? { pendingCommand: { ...record.pendingCommand } } : {}),
      ...(record.pendingCommand
        ? { pendingState: record.pendingProvenance === 'rejected' && record.pendingRejection && record.phase === 'review' ? 'review' as const : 'retry' as const }
        : {}),
      ...(record.pendingCommand ? { pendingProvenance: record.pendingProvenance ?? 'uncertain' as const } : {}),
      ...(record.pendingRejection ? { pendingRejection: { ...record.pendingRejection } } : {}),
      ...(record.pendingProvenance === 'rejected' && record.pendingRejection && record.reviewedConflictRevision
        ? { reviewedConflictRevision: record.reviewedConflictRevision }
        : {}),
      ...(record.pendingRetirement
        ? { retirement: { ...record.pendingRetirement, command: { ...record.pendingRetirement.command } } }
        : {}),
      writeRevision: record.journalRevision,
    };
  }

  private installSnapshot(record: RecordState, snapshot: MobileCoordinatorJournalSnapshot): void {
    record.enabled = snapshot.viewEnabled;
    record.pendingRetirement = undefined;
    record.pendingCommand = snapshot.pendingCommand ? { ...snapshot.pendingCommand } : undefined;
    record.pendingRejection = matchesPendingRejection(record.pendingCommand, snapshot.pendingRejection)
      ? { ...snapshot.pendingRejection! }
      : undefined;
    record.pendingProvenance = record.pendingCommand && record.pendingRejection && snapshot.pendingProvenance === 'rejected'
      ? 'rejected'
      : record.pendingCommand
        ? 'uncertain'
        : undefined;
    record.reviewedConflictRevision = record.pendingProvenance === 'rejected' && record.pendingRejection
      ? snapshot.reviewedConflictRevision
      : undefined;
    record.journalRevision = Math.max(record.journalRevision, snapshot.writeRevision ?? 0);
    record.journalBlocked = false;
    if (!snapshot.pendingCommand) {
      record.phase = snapshot.viewEnabled ? 'opening' : 'inactive';
      record.notice = undefined;
      return;
    }
    if (record.pendingProvenance === 'rejected' && record.pendingRejection && snapshot.pendingState === 'review') {
      record.phase = 'review';
      record.notice = {
        message: 'An earlier coordinator command needs a fresh server review before you write a new message.',
        retryable: false,
      };
      return;
    }
    record.phase = 'unavailable';
    record.notice = {
      message: 'The earlier coordinator message still has no confirmed result. Retry that same message when ready.',
      retryable: true,
    };
  }

  private async persist(binding: MobileCoordinatorBinding, record: RecordState): Promise<boolean> {
    const snapshot = this.snapshot(record);
    try {
      // A disabled pointer is retained so a stale async write cannot delete a
      // newer uncertain command admitted in this scope.
      const saved = await this.journal.save(binding, snapshot);
      if (saved && matchesRetirement(record.pendingRetirement, snapshot.retirement)) {
        record.pendingRetirement = undefined;
      }
      if (this.journal.isCorrupt?.()) record.journalBlocked = true;
      return saved;
    } catch (error) {
      if (error instanceof MobileCoordinatorJournalCorruptError) record.journalBlocked = true;
      return false;
    }
  }

  /**
   * A false save can mean storage failed, but it can also mean a newer scoped
   * journal entry deliberately won a serialized write. In the latter case the
   * retained immutable command is the only safe UI state; never send the body
   * that lost that admission race.
   */
  private async reconcileFailedAdmission(
    binding: MobileCoordinatorBinding,
    key: string,
    epoch: number,
    generation: number,
  ): Promise<boolean> {
    let snapshot: MobileCoordinatorJournalSnapshot | undefined;
    try {
      snapshot = await this.journal.load(binding);
    } catch {
      snapshot = undefined;
    }
    if (!this.isAdmissionCurrent(key, epoch, generation)) return true;
    if (this.journal.isCorrupt?.()) {
      this.update(key, (next) => {
        next.journalBlocked = true;
        next.enabled = true;
        next.phase = 'unavailable';
        next.notice = {
          message: 'Coordinator command storage needs review before another message can be sent. Normal chat remains available.',
          retryable: false,
        };
      });
      return true;
    }
    const retained = snapshot;
    if (!retained?.pendingCommand) return false;
    this.update(key, (next) => {
      const viewEnabled = next.enabled;
      const conversation = next.conversation;
      const context = next.context;
      this.installSnapshot(next, retained);
      // This call started from an already-open coordinator view. Retaining a
      // previous normal-view pointer must not turn that view into a different
      // scope or discard fresh qualified status already on screen.
      next.enabled = viewEnabled;
      next.conversation = conversation;
      next.context = context;
    });
    return true;
  }

  private persistLater(binding: MobileCoordinatorBinding, key: string): void {
    const record = this.records.get(key);
    if (!record) return;
    const epoch = this.activeEpoch;
    const generation = record.admissionGeneration;
    void this.persist(binding, record).then((saved) => {
      if (!saved) void this.reconcileFailedAdmission(binding, key, epoch, generation);
    });
  }

  async hydrate(binding: MobileCoordinatorBinding): Promise<boolean> {
    this.activate(binding);
    const key = mobileCoordinatorScopeKey(binding);
    if (this.hydrated.has(key)) return true;
    const existing = this.hydrating.get(key);
    if (existing) return existing;
    const epoch = this.activeEpoch;
    let request!: Promise<boolean>;
    request = (async () => {
      try {
        const snapshot = await this.journal.load(binding);
        if (this.activeKey !== key || this.activeEpoch !== epoch) return false;
        const record = this.record(key);
        if (this.journal.isCorrupt?.()) {
          record.journalBlocked = true;
          record.notice = {
            message: 'Coordinator command storage needs review before another message can be sent.',
            retryable: false,
          };
          this.emit();
          return false;
        }
        if (snapshot && !record.request && !record.conversation && !record.pendingCommand) {
          this.installSnapshot(record, snapshot);
        }
        this.hydrated.add(key);
        this.emit();
        return true;
      } catch (error) {
        if (this.activeKey !== key || this.activeEpoch !== epoch) return false;
        const record = this.record(key);
        record.journalBlocked = true;
        // Avoid forcing the coordinator card into an ordinary chat merely by
        // discovering corrupt/unavailable local storage. Opening it surfaces
        // the honest hold and never reaches the wire.
        if (error instanceof MobileCoordinatorJournalCorruptError) {
          record.notice = {
            message: 'Coordinator command storage needs review before another message can be sent.',
            retryable: false,
          };
        }
        this.emit();
        return false;
      } finally {
        if (this.hydrating.get(key) === request) this.hydrating.delete(key);
      }
    })();
    this.hydrating.set(key, request);
    return request;
  }

  /**
   * `client` is the current paired-client object. Replacing it for the same
   * scope fences old reads like a scope change; it is never a storage key,
   * and the durable journal, pending command and drafts are untouched.
   */
  activate(binding: MobileCoordinatorBinding | null | undefined, client?: object | null): void {
    const nextKey = mobileCoordinatorScopeKey(binding);
    const clientChanged = nextKey === this.activeKey && Boolean(nextKey) &&
      Boolean(client) && Boolean(this.activeClient) && client !== this.activeClient;
    if (client !== undefined) this.activeClient = client ?? undefined;
    if (nextKey === this.activeKey && !clientChanged) return;
    if (this.activeKey) {
      this.controllers.get(this.activeKey)?.abort();
      this.controllers.delete(this.activeKey);
      this.historyControllers.get(this.activeKey)?.abort();
      this.historyControllers.delete(this.activeKey);
      const previous = this.records.get(this.activeKey);
      if (previous) {
        previous.request = undefined;
        previous.requestToken = undefined;
        previous.requestKind = undefined;
        previous.trailingEpoch = undefined;
      }
    }
    this.activeKey = nextKey;
    this.activeEpoch += 1;
    this.emit();
  }

  get(binding: MobileCoordinatorBinding | null | undefined): MobileCoordinatorViewState {
    const key = mobileCoordinatorScopeKey(binding);
    if (!key || key !== this.activeKey) return inactive;
    const record = this.records.get(key);
    if (!record?.enabled) return inactive;
    return {
      enabled: true,
      phase: record.phase,
      conversation: record.conversation,
      context: record.context,
      notice: record.notice,
      pendingCommand: record.pendingCommand,
      pendingProvenance: record.pendingProvenance,
      reviewedConflictRevision: record.reviewedConflictRevision,
      pendingPlan: record.planAttempt ? { goalId: record.planAttempt.goalId, kind: record.planAttempt.kind } : undefined,
      plannedWorkstream: record.plannedWorkstream,
      canonicalHistory: record.canonicalHistory,
      canonicalHistoryLoading: record.canonicalHistoryLoading,
    };
  }

  clear(): void {
    this.controllers.forEach((controller) => controller.abort());
    this.controllers.clear();
    this.historyControllers.forEach((controller) => controller.abort());
    this.historyControllers.clear();
    this.records.clear();
    this.revalidations.clear();
    this.hydrated.clear();
    this.hydrating.clear();
    this.activeKey = '';
    this.activeEpoch += 1;
    this.emit();
  }

  async clearActor(actorKey: string): Promise<void> {
    this.clear();
    await this.journal.clearActor(actorKey);
  }

  dispose(): void {
    this.controllers.forEach((controller) => controller.abort());
    this.controllers.clear();
    this.historyControllers.forEach((controller) => controller.abort());
    this.historyControllers.clear();
    this.activeKey = '';
    this.activeEpoch += 1;
    this.emit();
  }

  private isCurrent(key: string, epoch: number, version: number): boolean {
    return this.activeKey === key &&
      this.activeEpoch === epoch &&
      this.records.get(key)?.requestVersion === version;
  }

  private isAdmissionCurrent(key: string, epoch: number, generation: number): boolean {
    return this.activeKey === key &&
      this.activeEpoch === epoch &&
      this.records.get(key)?.admissionGeneration === generation;
  }

  private update(key: string, update: (record: RecordState) => void): void {
    const record = this.record(key);
    update(record);
    record.journalRevision += 1;
    this.emit();
  }

  /** Read only actual persisted root rows; control replies never make bubbles. */
  private loadCanonicalHistory(binding: MobileCoordinatorBinding, beforeId?: number): Promise<boolean> {
    const key = mobileCoordinatorScopeKey(binding);
    const epoch = this.activeEpoch;
    const gateway = this.gatewayFor(binding);
    if (!key || !gateway?.history) return Promise.resolve(false);
    this.historyControllers.get(key)?.abort();
    const controller = new AbortController();
    this.historyControllers.set(key, controller);
    this.update(key, (record) => { record.canonicalHistoryLoading = true; });
    return gateway.history({
      sessionId: binding.sessionId,
      projectId: binding.projectId,
      limit: 50,
      ...(beforeId === undefined ? {} : { beforeId }),
    }, controller.signal).then((history) => {
      if (this.activeKey !== key || this.activeEpoch !== epoch || this.historyControllers.get(key) !== controller) return false;
      this.update(key, (record) => {
        record.canonicalHistory = mergeMobileCoordinatorHistory(record.canonicalHistory, history);
        record.canonicalHistoryLoading = false;
      });
      return true;
    }).catch(() => {
      if (this.activeKey === key && this.activeEpoch === epoch && this.historyControllers.get(key) === controller) {
        this.update(key, (record) => { record.canonicalHistoryLoading = false; });
      }
      return false;
    }).finally(() => {
      if (this.historyControllers.get(key) === controller) this.historyControllers.delete(key);
    });
  }

  loadOlderHistory(binding: MobileCoordinatorBinding): Promise<boolean> {
    const record = this.records.get(mobileCoordinatorScopeKey(binding));
    const earliestId = record?.canonicalHistory?.messages.reduce<number | undefined>((earliest, message) => (
      earliest === undefined || message.id < earliest ? message.id : earliest
    ), undefined);
    if (!record?.canonicalHistory?.hasMore || earliestId === undefined || earliestId < 1) return Promise.resolve(false);
    return this.loadCanonicalHistory(binding, earliestId);
  }

  private run(
    binding: MobileCoordinatorBinding,
    phase: Extract<MobileCoordinatorPhase, 'opening' | 'refreshing' | 'sending'>,
    kind: 'open' | 'refresh' | 'send' | 'prepare-plan' | 'continue-plan',
    request: (gateway: MobileCoordinatorGateway, signal: AbortSignal) => Promise<MobileCoordinatorResult>,
    accept: (record: RecordState, result: MobileCoordinatorResult) => boolean,
  ): Promise<boolean> {
    const key = mobileCoordinatorScopeKey(binding);
    const record = this.record(key);
    if (record.request) {
      return record.requestKind === kind ? record.request : Promise.resolve(false);
    }
    if (record.journalBlocked) {
      this.update(key, (next) => {
        next.enabled = true;
        next.phase = 'unavailable';
        next.notice = {
          message: 'Coordinator command storage needs review before another message can be sent. Normal chat remains available.',
          retryable: false,
        };
      });
      return Promise.resolve(false);
    }
    // Resolve capability before acquiring the synchronous operation slot. A
    // missing gateway may resolve immediately, so leaving it in request would
    // poison a later reconnect/open attempt.
    const gateway = this.gatewayFor(binding);
    if (!gateway) {
      this.update(key, (next) => {
        next.enabled = true;
        next.phase = 'unavailable';
        next.notice = {
          message: 'Coordinator capability is unavailable for this chat. Normal chat remains available.',
          retryable: Boolean(next.pendingCommand),
        };
      });
      this.persistLater(binding, key);
      return Promise.resolve(false);
    }
    const version = record.requestVersion + 1;
    const epoch = this.activeEpoch;
    const token = Symbol('coordinator-request');
    record.requestVersion = version;
    record.requestToken = token;
    record.requestKind = kind;
    record.enabled = true;
    record.phase = phase;
    record.notice = undefined;
    record.journalRevision += 1;
    const controller = new AbortController();
    this.controllers.get(key)?.abort();
    this.controllers.set(key, controller);
    this.emit();

    const promise = (async () => {
      try {
        if (kind === 'prepare-plan' || kind === 'continue-plan') {
          // Let a synchronous normal-mode/navigation change revoke a queued
          // finite control before any paired-gateway request is exposed. The
          // request token is already registered, preserving same-operation
          // coalescing while this microtask yields.
          await Promise.resolve();
          if (!this.isCurrent(key, epoch, version)) return false;
        }
        const result = await request(gateway, controller.signal);
        if (!this.isCurrent(key, epoch, version)) return false;
        const accepted = accept(this.record(key), result);
        this.persistLater(binding, key);
        return accepted;
      } catch (error) {
        if (!this.isCurrent(key, epoch, version) || isAbort(error)) return false;
        this.update(key, (next) => {
          next.enabled = true;
          next.phase = 'unavailable';
          next.notice = errorNotice(error);
        });
        this.persistLater(binding, key);
        return false;
      } finally {
        const latest = this.records.get(key);
        if (latest?.requestToken === token) {
          latest.request = undefined;
          latest.requestToken = undefined;
          latest.requestKind = undefined;
          const trailing = latest.trailingEpoch === epoch;
          latest.trailingEpoch = undefined;
          if (trailing && this.activeKey === key && this.activeEpoch === epoch && latest.enabled) {
            queueMicrotask(() => { void this.revalidate(binding); });
          }
        }
        if (this.controllers.get(key) === controller) this.controllers.delete(key);
      }
    })();
    record.request = promise;
    return promise;
  }

  async open(binding: MobileCoordinatorBinding): Promise<boolean> {
    this.activate(binding);
    const key = mobileCoordinatorScopeKey(binding);
    const operationEpoch = this.activeEpoch;
    const admissionGeneration = this.record(key).admissionGeneration;
    const hydrated = await this.hydrate(binding);
    if (!this.isAdmissionCurrent(key, operationEpoch, admissionGeneration)) return false;
    if (!hydrated) {
      if (this.record(key).journalBlocked) {
        this.update(key, (record) => {
          record.enabled = true;
          record.phase = 'unavailable';
          record.notice = {
            message: 'Coordinator command storage needs review before another message can be sent. Normal chat remains available.',
            retryable: false,
          };
        });
      }
      return false;
    }
    const reviewAfterOpen = Boolean(this.records.get(key)?.pendingCommand && this.records.get(key)?.phase === 'review');
    const retryAfterOpen = Boolean(this.records.get(key)?.pendingCommand && this.records.get(key)?.notice?.retryable);
    this.update(key, (record) => { record.enabled = true; });
    this.persistLater(binding, key);
    const opened = await this.run(
      binding,
      'opening',
      'open',
      (gateway, signal) => gateway.open({ sessionId: binding.sessionId, projectId: binding.projectId }, signal),
      (record, result) => {
        if (result.kind !== 'created' && result.kind !== 'replay') {
          installConversation(record, result);
          record.enabled = true;
          if (record.pendingProvenance === 'rejected') record.reviewedConflictRevision = undefined;
          record.phase = isConflict(result) ? 'review' : 'unavailable';
          record.notice = noticeFor(result);
          record.journalRevision += 1;
          this.emit();
          return false;
        }
        installConversation(record, result);
        record.enabled = true;
        record.phase = 'ready';
        record.notice = undefined;
        record.journalRevision += 1;
        this.emit();
        return true;
      },
    );
    // The single-flight marker has cleared, so this is an actual scoped
    // status read rather than the already-completed open promise.
    if (opened) {
      void this.refresh(binding, reviewAfterOpen, retryAfterOpen, false);
      void this.loadCanonicalHistory(binding);
    }
    return opened;
  }

  async refresh(binding: MobileCoordinatorBinding, review = false, _preservePendingRetry = false, readCanonicalHistory = true): Promise<boolean> {
    this.activate(binding);
    const key = mobileCoordinatorScopeKey(binding);
    const operationEpoch = this.activeEpoch;
    const admissionGeneration = this.record(key).admissionGeneration;
    if (!await this.hydrate(binding) || !this.isAdmissionCurrent(key, operationEpoch, admissionGeneration)) return false;
    const refreshed = await this.run(
      binding,
      'refreshing',
      'refresh',
      (gateway, signal) => gateway.status({ sessionId: binding.sessionId, projectId: binding.projectId }, signal),
      (record, result) => {
        if (result.kind === 'status') {
          installConversation(record, result);
          record.enabled = true;
          if (record.pendingCommand && record.pendingProvenance === 'rejected' && record.pendingRejection && review) {
            record.phase = 'review';
            record.reviewedConflictRevision = result.conversation.controlRevision;
            record.notice = { message: 'Review the current coordinator state, then explicitly start a new message if you want to try again.', retryable: false };
          } else if (record.pendingCommand) {
            record.phase = 'unavailable';
            record.notice = { message: 'The earlier coordinator message still has no confirmed result. Retry that same message when ready.', retryable: true };
          } else {
            record.phase = 'ready';
            record.notice = undefined;
          }
          record.journalRevision += 1;
          this.emit();
          return true;
        }
        installConversation(record, result);
        record.enabled = true;
        if (record.pendingProvenance === 'rejected') record.reviewedConflictRevision = undefined;
        record.phase = isConflict(result) ? 'review' : 'unavailable';
        record.notice = noticeFor(result);
        record.journalRevision += 1;
        this.emit();
        return false;
      },
    );
    if (refreshed && readCanonicalHistory) void this.loadCanonicalHistory(binding);
    return refreshed;
  }

  /**
   * Quiet read-only reconcile after a qualified root event or foreground
   * return. Never sends, grants, or touches phase/notice/pending command; an
   * in-flight read gets one trailing re-read, and normal-mode exit, scope
   * change, disposal or any scoped operation discards its response.
   */
  revalidate(binding: MobileCoordinatorBinding): Promise<boolean> {
    const key = mobileCoordinatorScopeKey(binding);
    const record = this.records.get(key);
    const gateway = this.gatewayFor(binding);
    if (!record?.enabled || !record.conversation || key !== this.activeKey || !gateway) return Promise.resolve(false);
    const epoch = this.activeEpoch;
    const running = this.revalidations.get(key);
    if (running?.epoch === epoch) {
      running.again = true;
      return running.promise;
    }
    if (record.request) {
      record.trailingEpoch = epoch;
      return Promise.resolve(false);
    }
    const controller = new AbortController();
    this.controllers.set(key, controller);
    const current =() => this.activeKey === key && this.activeEpoch === epoch &&
      this.controllers.get(key) === controller && this.records.get(key)?.enabled === true;
    const entry = { epoch, again: false, promise: Promise.resolve(false) };
    entry.promise = gateway.status({ sessionId: binding.sessionId, projectId: binding.projectId }, controller.signal)
      .then((result) => {
        if (!current() || result.kind !== 'status') return false;
        this.update(key, (next) => installConversation(next, result));
        return true;
      })
      .catch(() => false)
      .then((refreshed) => {
        const stillCurrent = current();
        if (this.controllers.get(key) === controller) this.controllers.delete(key);
        if (this.revalidations.get(key) === entry) this.revalidations.delete(key);
        if (stillCurrent) {
          if (entry.again) void this.revalidate(binding);
          else void this.loadCanonicalHistory(binding);
        }
        return refreshed;
      });
    this.revalidations.set(key, entry);
    return entry.promise;
  }

  async send(binding: MobileCoordinatorBinding, message: string): Promise<{ accepted: boolean }> {
    this.activate(binding);
    const key = mobileCoordinatorScopeKey(binding);
    const operationEpoch = this.activeEpoch;
    const operationAdmissionGeneration = this.record(key).admissionGeneration;
    if (!await this.hydrate(binding) || !this.isAdmissionCurrent(key, operationEpoch, operationAdmissionGeneration)) return { accepted: false };
    const record = this.record(key);
    if (record.journalBlocked) {
      this.update(key, (next) => {
        next.enabled = true;
        next.phase = 'unavailable';
        next.notice = {
          message: 'Coordinator command storage needs review before another message can be sent. Normal chat remains available.',
          retryable: false,
        };
      });
      return { accepted: false };
    }
    if (!message.trim()) return { accepted: false };
    if (message.length > 8_000) {
      this.update(key, (next) => {
        next.enabled = true;
        next.phase = 'review';
        next.notice = { message: 'Coordinator messages are limited to 8,000 characters. Your draft was not sent.', retryable: false };
      });
      return { accepted: false };
    }
    if (record.request) {
      if (record.requestKind === 'send' && record.pendingCommand?.message === message) {
        return { accepted: await record.request };
      }
      return { accepted: false };
    }
    if (!record.conversation) {
      this.update(key, (next) => {
        next.enabled = true;
        next.phase = 'review';
        next.notice = { message: 'Open coordination first, then review the current server state before sending.', retryable: false };
      });
      return { accepted: false };
    }
    if (record.pendingCommand && record.pendingCommand.message !== message) {
      this.update(key, (next) => {
        next.enabled = true;
        next.phase = 'review';
        next.notice = {
          message: 'A prior coordinator message is unresolved. Retry that same message before changing it.',
          retryable: next.pendingProvenance !== 'rejected',
        };
      });
      return { accepted: false };
    }
    if (record.phase === 'review' && record.pendingCommand && record.pendingProvenance === 'rejected') {
      this.update(key, (next) => {
        next.notice = { message: 'Refresh and review this conflict before writing a new coordinator message.', retryable: false };
      });
      return { accepted: false };
    }
    const pending = record.pendingCommand ?? {
      commandKey: commandKey(),
      expectedControlRevision: record.conversation.controlRevision,
      message,
    };
    const admissionEpoch = operationEpoch;
    this.update(key, (next) => {
      next.enabled = true;
      next.pendingCommand = pending;
      next.pendingRetirement = undefined;
      next.pendingProvenance = next.pendingProvenance ?? 'uncertain';
      if (!next.pendingRejection || !matchesPendingRejection(pending, next.pendingRejection)) {
        next.pendingRejection = undefined;
      }
      next.reviewedConflictRevision = undefined;
    });
    // This generation fences only pre-wire AsyncStorage admission. A running
    // send uses requestVersion, and a second identical tap must still coalesce
    // with it rather than being mistaken for a cancelled admission.
    const admissionGeneration = operationAdmissionGeneration;
    const persisted = await this.persist(binding, this.record(key));
    if (!this.isAdmissionCurrent(key, admissionEpoch, admissionGeneration)) return { accepted: false };
    if (!persisted) {
      if (await this.reconcileFailedAdmission(binding, key, admissionEpoch, admissionGeneration)) {
        return { accepted: false };
      }
      if (!this.isAdmissionCurrent(key, admissionEpoch, admissionGeneration)) return { accepted: false };
      this.update(key, (next) => {
        next.enabled = true;
        next.phase = 'unavailable';
        next.notice = {
          message: 'Coordinator command storage is unavailable. Your draft was not sent.',
          retryable: true,
        };
      });
      return { accepted: false };
    }
    // A navigation or normal-mode exit while the local write was settling is
    // not permission to expose the command on the wire. The journal retains
    // the immutable command for a later qualified retry.
    if (!this.isAdmissionCurrent(key, admissionEpoch, admissionGeneration)) return { accepted: false };
    const accepted = await this.run(
      binding,
      'sending',
      'send',
      (gateway, signal) => gateway.message({
        sessionId: binding.sessionId,
        projectId: binding.projectId,
        expectedControlRevision: pending.expectedControlRevision,
        commandKey: pending.commandKey,
        message: pending.message,
      }, signal),
      (next, result) => {
        if (
          result.kind === 'created' || result.kind === 'replay' || result.kind === 'status' ||
          result.kind === 'foreground_accepted'
        ) {
          installConversation(next, result);
          next.enabled = true;
          next.pendingRetirement = {
            kind: 'acknowledged',
            command: { ...pending },
          };
          next.phase = 'ready';
          next.pendingCommand = undefined;
          next.pendingProvenance = undefined;
          next.pendingRejection = undefined;
          next.reviewedConflictRevision = undefined;
          next.notice = result.kind === 'foreground_accepted'
            ? { message: 'Message accepted. Canonical chat events will appear in this conversation.', retryable: false }
            : undefined;
          next.journalRevision += 1;
          this.emit();
          return true;
        }
        installConversation(next, result);
        next.enabled = true;
        next.pendingRetirement = undefined;
        next.pendingCommand = pending;
        next.reviewedConflictRevision = undefined;
        const rejection = rejectionFor(pending, result);
        if (rejection) {
          next.pendingProvenance = 'rejected';
          next.pendingRejection = rejection;
        } else {
          next.pendingProvenance = next.pendingProvenance ?? 'uncertain';
        }
        next.phase = isConflict(result) ? 'review' : 'unavailable';
        next.notice = noticeFor(result);
        next.journalRevision += 1;
        this.emit();
        return false;
      },
    );
    if (accepted) this.loadCanonicalHistory(binding);
    return { accepted };
  }

  async retry(binding: MobileCoordinatorBinding): Promise<boolean> {
    const record = this.records.get(mobileCoordinatorScopeKey(binding));
    if (!record?.pendingCommand || record.pendingProvenance === 'rejected') return false;
    return (await this.send(binding, record.pendingCommand.message)).accepted;
  }

  private acceptPlanResult(record: RecordState, result: MobileCoordinatorResult): boolean {
    installConversation(record, result);
    record.enabled = true;
    // Only a typed server response resolves this local request. A transport or
    // malformed acknowledgement retains its exact input for an explicit retry
    // while this mounted view remains current; it never creates new consent.
    record.planAttempt = undefined;
    if (result.kind === 'planned') {
      record.plannedWorkstream = result.workstream;
      record.phase = 'ready';
      record.notice = {
        message: 'Rhythm accepted one bounded managed planning turn. Execution is not verification.',
        retryable: false,
      };
      record.journalRevision += 1;
      this.emit();
      return true;
    }
    if (result.kind === 'continuation_available') {
      record.plannedWorkstream = undefined;
      record.phase = 'ready';
      record.notice = {
        message: `A server-authorized continuation is available for up to ${result.remainingTurns} remaining turn${result.remainingTurns === 1 ? '' : 's'}.`,
        retryable: false,
      };
      record.journalRevision += 1;
      this.emit();
      return true;
    }
    record.plannedWorkstream = undefined;
    record.phase = isConflict(result) ? 'review' : 'unavailable';
    record.notice = noticeFor(result);
    record.journalRevision += 1;
    this.emit();
    return false;
  }

  async preparePlan(
    binding: MobileCoordinatorBinding,
    goalId: string,
    consent: MobileCoordinatorPlanConsent,
  ): Promise<boolean> {
    this.activate(binding);
    const key = mobileCoordinatorScopeKey(binding);
    const operationEpoch = this.activeEpoch;
    const admissionGeneration = this.record(key).admissionGeneration;
    if (!await this.hydrate(binding) || !this.isAdmissionCurrent(key, operationEpoch, admissionGeneration)) return false;
    const record = this.record(key);
    // A late card callback cannot turn a Return to normal chat into new
    // finite planning authority. Reopening coordination is explicit.
    if (!record.enabled) return false;
    if (!record.conversation || record.pendingCommand || record.planAttempt || !validPlanConsent(consent)) {
      this.update(key, (next) => {
        next.enabled = true;
        next.phase = 'review';
        next.notice = {
          message: record.planAttempt
            ? 'A prior managed planning request has no confirmed result. Retry that same request or refresh first.'
            : 'Review the current coordinator state and finite consent before planning.',
          retryable: Boolean(record.planAttempt),
        };
      });
      return false;
    }
    if (record.conversation.schemaVersion !== 3 || record.conversation.primaryOwnerRoot !== true) {
      this.update(key, (next) => {
        next.enabled = true;
        next.phase = 'unavailable';
        next.notice = { message: 'Managed planning is not available for this server conversation. No work was started.', retryable: false };
      });
      return false;
    }
    if (!record.conversation.goals.some((goal) => goal.id === goalId)) {
      this.update(key, (next) => {
        next.enabled = true;
        next.phase = 'review';
        next.notice = { message: 'That goal is no longer present. Refresh before planning.', retryable: false };
      });
      return false;
    }
    const gateway = this.gatewayFor(binding);
    if (!gateway?.preparePlan) {
      this.update(key, (next) => {
        next.enabled = true;
        next.phase = 'unavailable';
        next.notice = { message: 'Managed planning is unavailable for this connection. No work was started.', retryable: false };
      });
      return false;
    }
    const admission: MobileCoordinatorPlanAdmission = { ...consent, commandKey: commandKey() };
    const attempt: Extract<MobileCoordinatorPlanAttempt, { kind: 'prepare' }> = {
      kind: 'prepare',
      goalId,
      expectedControlRevision: record.conversation.controlRevision,
      input: admission,
    };
    record.planAttempt = attempt;
    return this.run(
      binding,
      'sending',
      'prepare-plan',
      (_currentGateway, signal) => gateway.preparePlan!({
        sessionId: binding.sessionId,
        projectId: binding.projectId,
        expectedControlRevision: attempt.expectedControlRevision,
        goalId: attempt.goalId,
        admission: attempt.input,
      }, signal),
      (next, result) => this.acceptPlanResult(next, result),
    );
  }

  async continuePlan(
    binding: MobileCoordinatorBinding,
    goalId: string,
    authorizationId: string,
  ): Promise<boolean> {
    this.activate(binding);
    const key = mobileCoordinatorScopeKey(binding);
    const operationEpoch = this.activeEpoch;
    const admissionGeneration = this.record(key).admissionGeneration;
    if (!await this.hydrate(binding) || !this.isAdmissionCurrent(key, operationEpoch, admissionGeneration)) return false;
    const record = this.record(key);
    if (!record.enabled) return false;
    const continuation = record.conversation?.continuations?.find((candidate) =>
      candidate.goalId === goalId && candidate.authorizationId === authorizationId,
    );
    if (!record.conversation || record.pendingCommand || record.planAttempt || !continuation) {
      this.update(key, (next) => {
        next.enabled = true;
        next.phase = 'review';
        next.notice = { message: 'Refresh and review the current server-authorized continuation before continuing.', retryable: false };
      });
      return false;
    }
    if (record.conversation.schemaVersion !== 3 || record.conversation.primaryOwnerRoot !== true) {
      this.update(key, (next) => {
        next.enabled = true;
        next.phase = 'unavailable';
        next.notice = { message: 'Managed continuation is not available for this server conversation. No work was started.', retryable: false };
      });
      return false;
    }
    const gateway = this.gatewayFor(binding);
    if (!gateway?.continuePlan) {
      this.update(key, (next) => {
        next.enabled = true;
        next.phase = 'unavailable';
        next.notice = { message: 'Managed continuation is unavailable for this connection. No work was started.', retryable: false };
      });
      return false;
    }
    const attempt: Extract<MobileCoordinatorPlanAttempt, { kind: 'continue' }> = {
      kind: 'continue',
      goalId,
      authorizationId,
      expectedControlRevision: record.conversation.controlRevision,
    };
    record.planAttempt = attempt;
    return this.run(
      binding,
      'sending',
      'continue-plan',
      (_currentGateway, signal) => gateway.continuePlan!({
        sessionId: binding.sessionId,
        projectId: binding.projectId,
        expectedControlRevision: attempt.expectedControlRevision,
        goalId: attempt.goalId,
        authorizationId: attempt.authorizationId,
      }, signal),
      (next, result) => this.acceptPlanResult(next, result),
    );
  }

  async retryPlan(binding: MobileCoordinatorBinding): Promise<boolean> {
    const key = mobileCoordinatorScopeKey(binding);
    const record = this.records.get(key);
    const attempt = record?.planAttempt;
    if (!record?.enabled || !record.conversation || !attempt) return false;
    const gateway = this.gatewayFor(binding);
    if (!gateway) return false;
    if (attempt.kind === 'prepare' && gateway.preparePlan) {
      return this.run(
        binding,
        'sending',
        'prepare-plan',
        (_currentGateway, signal) => gateway.preparePlan!({
          sessionId: binding.sessionId,
          projectId: binding.projectId,
          expectedControlRevision: attempt.expectedControlRevision,
          goalId: attempt.goalId,
          admission: attempt.input,
        }, signal),
        (next, result) => this.acceptPlanResult(next, result),
      );
    }
    if (attempt.kind === 'continue' && gateway.continuePlan) {
      return this.run(
        binding,
        'sending',
        'continue-plan',
        (_currentGateway, signal) => gateway.continuePlan!({
          sessionId: binding.sessionId,
          projectId: binding.projectId,
          expectedControlRevision: attempt.expectedControlRevision,
          goalId: attempt.goalId,
          authorizationId: attempt.authorizationId,
        }, signal),
        (next, result) => this.acceptPlanResult(next, result),
      );
    }
    return false;
  }

  async reviewConflict(binding: MobileCoordinatorBinding): Promise<boolean> {
    return this.refresh(binding, true);
  }

  async beginNewMessageAfterReview(binding: MobileCoordinatorBinding): Promise<boolean> {
    const key = mobileCoordinatorScopeKey(binding);
    const record = this.records.get(key);
    if (!record?.pendingCommand || record.pendingProvenance !== 'rejected' || !matchesPendingRejection(record.pendingCommand, record.pendingRejection) || record.phase !== 'review' || !record.conversation ||
      record.reviewedConflictRevision !== record.conversation.controlRevision) return false;
    const epoch = this.activeEpoch;
    const pendingCommandKey = record.pendingCommand.commandKey;
    const reviewedConflictRevision = record.reviewedConflictRevision;
    const recordRevision = record.journalRevision;
    const nextRevision = record.journalRevision + 1;
    // Retire only a command whose direct 409 was reviewed, and durably record
    // that retirement before the UI allows another user-controlled command.
    let saved = false;
    try {
      saved = await this.journal.save(binding, {
        viewEnabled: true,
        retirement: {
          kind: 'reviewed_rejection',
          command: { ...record.pendingCommand },
          reviewedConflictRevision,
        },
        writeRevision: nextRevision,
      });
    } catch {
      saved = false;
    }
    if (!saved || this.journal.isCorrupt?.()) {
      this.update(key, (next) => {
        next.journalBlocked = Boolean(this.journal.isCorrupt?.());
        next.notice = {
          message: 'Coordinator command storage is unavailable. The earlier command was not re-sent.',
          retryable: false,
        };
      });
      return false;
    }
    // A late card tap must not clear the record after navigation or a newer
    // scoped update. The durable journal can be reconciled on a qualified
    // reopen; it never grants a fresh command by itself.
    if (this.activeKey !== key || this.activeEpoch !== epoch ||
      this.records.get(key)?.pendingCommand?.commandKey !== pendingCommandKey ||
      this.records.get(key)?.reviewedConflictRevision !== reviewedConflictRevision ||
      this.records.get(key)?.journalRevision !== recordRevision) {
      return false;
    }
    this.update(key, (next) => {
      next.pendingCommand = undefined;
      next.pendingProvenance = undefined;
      next.pendingRejection = undefined;
      next.reviewedConflictRevision = undefined;
      next.phase = 'ready';
      next.notice = { message: 'The earlier command was not re-sent. Edit or send a new coordinator message when ready.', retryable: false };
    });
    return true;
  }

  returnToNormal(binding: MobileCoordinatorBinding): void {
    const key = mobileCoordinatorScopeKey(binding);
    this.controllers.get(key)?.abort();
    this.controllers.delete(key);
    this.historyControllers.get(key)?.abort();
    this.historyControllers.delete(key);
    // Invalidate a call paused in hydration before it can re-enable the card
    // or expose a finite control after the user explicitly returned to normal.
    this.activeEpoch += 1;
    this.hydrating.delete(key);
    this.update(key, (record) => {
      record.admissionGeneration += 1;
      record.requestVersion += 1;
      record.request = undefined;
      record.requestToken = undefined;
      record.requestKind = undefined;
      record.enabled = false;
    });
    this.persistLater(binding, key);
  }
}
