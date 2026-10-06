import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CoordinatorJournalCorruptError,
  createCoordinatorConversationJournal,
  type CoordinatorConversationJournal,
  type CoordinatorJournalRejection,
  type CoordinatorJournalRetirement,
  type CoordinatorJournalSnapshot,
} from '../gateway/coordinator-conversation-journal';
import {
  CoordinatorTransportError,
  type CoordinatorConversation,
  type CoordinatorConversationContext,
  type CoordinatorConversationGateway,
  type CoordinatorHistoryResult,
  type CoordinatorPlanAdmission,
  type CoordinatorPlannedWorkstream,
  type CoordinatorConversationResult,
  type CoordinatorConversationScope,
} from '../gateway/coordinator-conversations';

export type CoordinatorConversationPhase =
  | 'inactive'
  | 'opening'
  | 'refreshing'
  | 'sending'
  | 'ready'
  | 'unavailable'
  | 'review';

export type CoordinatorPendingCommand = {
  commandKey: string;
  expectedControlRevision: number;
  message: string;
};

export type CoordinatorNotice = {
  message: string;
  retryable: boolean;
};

export type CoordinatorConversationViewState = {
  enabled: boolean;
  phase: CoordinatorConversationPhase;
  conversation?: CoordinatorConversation;
  context?: CoordinatorConversationContext;
  notice?: CoordinatorNotice;
  pendingCommand?: CoordinatorPendingCommand;
  /** An unknown acknowledgement may only be retried with this exact command. */
  pendingProvenance?: 'uncertain' | 'rejected';
  /** Only an explicit successful refresh permits a new user-controlled command after a 409. */
  reviewedConflictRevision?: number;
  /** A local exact retry for a finite C2 request; never canonical authority. */
  pendingPlan?: { goalId: string; kind: 'prepare' | 'continue' };
  /** Latest typed server plan/status view; it never proves a criterion. */
  plannedWorkstream?: CoordinatorPlannedWorkstream;
  /** Existing persisted root rows only; acknowledgements never populate this. */
  canonicalHistory?: CoordinatorHistoryResult;
  canonicalHistoryLoading?: boolean;
  /** Current `open` still awaits its scoped status/history reconciliation. */
  openingReconciliation?: boolean;
};

export type CoordinatorPlanConsent = Omit<CoordinatorPlanAdmission, 'commandKey'>;

export type CoordinatorSendResult = {
  accepted: boolean;
};

const inactive: CoordinatorConversationViewState = {
  enabled: false,
  phase: 'inactive',
};

type RequestKind = 'open' | 'refresh' | 'send' | 'prepare-plan' | 'continue-plan';

type CoordinatorPlanAttempt =
  | { kind: 'prepare'; input: CoordinatorPlanAdmission; goalId: string; expectedControlRevision: number }
  | { kind: 'continue'; goalId: string; authorizationId: string; expectedControlRevision: number };

type ScopedRecord = Omit<CoordinatorConversationViewState, 'canonicalHistory' | 'canonicalHistoryLoading'> & {
  /** Present only when the exact pending command received a direct 409. */
  pendingRejection?: CoordinatorJournalRejection;
  /** Operation-local proof consumed when this exact durable command retires. */
  pendingRetirement?: CoordinatorJournalRetirement;
  planAttempt?: CoordinatorPlanAttempt;
  canonicalHistory?: CoordinatorHistoryResult;
  canonicalHistoryLoading?: boolean;
  journalBlocked?: boolean;
  journalRevision: number;
  requestVersion: number;
  request?: Promise<boolean>;
  requestKind?: RequestKind;
  requestToken?: symbol;
  /**
   * The primary-entry open is not complete until its server status and
   * canonical-history reconciliation have both settled. A second current-root
   * entry must join this work instead of treating the status read as a failed
   * open.
   */
  openReconciliation?: Promise<boolean>;
  openReconciliationToken?: symbol;
};

function commandKey(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random
    ? 'coordinator:' + random
    : 'coordinator:' + Date.now() + ':' + Math.random().toString(36).slice(2);
}

export function coordinatorScopeKey(scope: CoordinatorConversationScope | null | undefined): string {
  return scope ? [scope.actorKey, scope.projectId, scope.sessionId].join('\u0000') : '';
}

function unavailableNotice(result: CoordinatorConversationResult): CoordinatorNotice {
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

function validPlanConsent(consent: CoordinatorPlanConsent): boolean {
  const executesScopedWorkspace = consent.purpose === 'execute';
  return Number.isSafeInteger(consent.totalTokenAuthorization) && consent.totalTokenAuthorization >= 1 && consent.totalTokenAuthorization <= 2_000_000 &&
    Number.isSafeInteger(consent.maxTurns) && consent.maxTurns >= 1 && consent.maxTurns <= 8 &&
    Number.isSafeInteger(consent.maxWallTimeSeconds) && consent.maxWallTimeSeconds >= 30 && consent.maxWallTimeSeconds <= 300 &&
    Number.isSafeInteger(consent.expiresInSeconds) && consent.expiresInSeconds >= 30 && consent.expiresInSeconds <= 3_600 &&
    consent.acknowledgesSoftTotalTokenAuthorization === true &&
    (consent.purpose === 'decompose' || consent.purpose === 'continue' || executesScopedWorkspace || consent.purpose === 'workflow') &&
    (!executesScopedWorkspace || consent.acknowledgesScopedWorkspaceExecution === true) &&
    (consent.purpose !== 'workflow' || (
      consent.acknowledgesCodingWorkflowCoverage === true &&
      consent.workflowCheck?.kind === 'selected_reference_summary_v1' &&
      Boolean(consent.workflowCheck.sourceId.trim()) && Boolean(consent.workflowCheck.expectedVersion.trim())
    ));
}

function errorNotice(error: unknown): CoordinatorNotice {
  if (error instanceof CoordinatorTransportError) {
    return { message: error.message, retryable: error.retryable };
  }
  return { message: 'Coordinator request could not be completed. Your draft is still here.', retryable: true };
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function isConflict(result: CoordinatorConversationResult): boolean {
  return result.kind === 'revision_conflict' || result.kind === 'command_conflict';
}

function isDefinitiveRejection(
  result: CoordinatorConversationResult,
): result is CoordinatorConversationResult & { kind: 'revision_conflict' | 'command_conflict' } {
  // These are the C1 CAS/control conflicts. A transport failure, malformed
  // success, local edited draft, or status read is never rejection proof.
  return isConflict(result);
}

function rejectionFor(
  pending: CoordinatorPendingCommand,
  result: CoordinatorConversationResult,
): CoordinatorJournalRejection | undefined {
  if (!isDefinitiveRejection(result)) return undefined;
  return {
    commandKey: pending.commandKey,
    expectedControlRevision: pending.expectedControlRevision,
    kind: result.kind,
  };
}

function matchesPendingRejection(
  pending: CoordinatorPendingCommand | undefined,
  rejection: CoordinatorJournalRejection | undefined,
): boolean {
  return Boolean(
    pending && rejection &&
    pending.commandKey === rejection.commandKey &&
    pending.expectedControlRevision === rejection.expectedControlRevision,
  );
}

function matchesRetirement(
  left: CoordinatorJournalRetirement | undefined,
  right: CoordinatorJournalRetirement | undefined,
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

/** Merge only server-returned persisted rows, retaining already loaded older pages. */
export function mergeCoordinatorHistory(
  previous: CoordinatorHistoryResult | undefined,
  incoming: CoordinatorHistoryResult,
): CoordinatorHistoryResult {
  const rows = new Map<number, CoordinatorHistoryResult['messages'][number]>();
  previous?.messages.forEach((message) => rows.set(message.id, message));
  incoming.messages.forEach((message) => rows.set(message.id, message));
  return {
    ...incoming,
    messages: [...rows.values()].sort((left, right) => left.id - right.id),
    // Once the oldest page has conclusively reported no more history, a later
    // top-page refresh cannot make that closed cursor appear open again.
    hasMore: previous?.hasMore === false ? false : incoming.hasMore,
    nextCursor: previous?.hasMore === false ? null : incoming.nextCursor,
  };
}

function installConversation(record: ScopedRecord, result: CoordinatorConversationResult): void {
  if (result.kind === 'created' || result.kind === 'replay' || result.kind === 'status') {
    record.conversation = result.conversation;
  } else if (result.conversation) {
    record.conversation = result.conversation;
  }
  if (result.kind === 'status') record.context = result.context;
}

/**
 * Small client-side view-pointer/uncertain-command controller. The journal is
 * intentionally limited to the exact immutable command and mode pointer; it
 * never becomes transcript, context, dispatch, or permission authority.
 */
export class CoordinatorConversationController {
  private readonly records = new Map<string, ScopedRecord>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly historyControllers = new Map<string, AbortController>();
  private readonly listeners = new Set<() => void>();
  private activeKey = '';
  private activeEpoch = 0;

  constructor(
    private readonly gatewayFor: () => CoordinatorConversationGateway | undefined,
    private readonly journal: CoordinatorConversationJournal = createCoordinatorConversationJournal(),
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }

  private record(key: string): ScopedRecord {
    const existing = this.records.get(key);
    if (existing) return existing;
    const next: ScopedRecord = {
      enabled: false,
      phase: 'inactive',
      journalRevision: 0,
      requestVersion: 0,
    };
    this.records.set(key, next);
    return next;
  }

  private snapshot(record: ScopedRecord): CoordinatorJournalSnapshot {
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

  private installSnapshot(record: ScopedRecord, snapshot: CoordinatorJournalSnapshot): void {
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

  private persist(scope: CoordinatorConversationScope, record: ScopedRecord): boolean {
    const snapshot = this.snapshot(record);
    try {
      // Keep a disabled view pointer instead of deleting it so a stale
      // asynchronous write cannot erase a newer immutable command.
      const saved = this.journal.save(scope, snapshot);
      if (saved && matchesRetirement(record.pendingRetirement, snapshot.retirement)) {
        record.pendingRetirement = undefined;
      }
      if (this.journal.isCorrupt?.()) record.journalBlocked = true;
      return saved;
    } catch (error) {
      if (error instanceof CoordinatorJournalCorruptError) record.journalBlocked = true;
      return false;
    }
  }

  /**
   * A journal refusal can be a storage failure or a newer durable pointer.
   * When it is the latter, install that retained command before returning to
   * the composer so this controller cannot expose a different body on wire.
   */
  private reconcileFailedAdmission(scope: CoordinatorConversationScope, key: string): boolean {
    let snapshot: CoordinatorJournalSnapshot | undefined;
    try {
      snapshot = this.journal.load(scope);
    } catch {
      snapshot = undefined;
    }
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
      next.enabled = viewEnabled;
      next.conversation = conversation;
      next.context = context;
    });
    return true;
  }

  private persistLater(scope: CoordinatorConversationScope, key: string): void {
    const record = this.records.get(key);
    if (record && !this.persist(scope, record)) this.reconcileFailedAdmission(scope, key);
  }

  activate(scope: CoordinatorConversationScope | null | undefined): void {
    const nextKey = coordinatorScopeKey(scope);
    if (nextKey === this.activeKey) return;
    if (this.activeKey) {
      this.controllers.get(this.activeKey)?.abort();
      this.controllers.delete(this.activeKey);
      this.historyControllers.get(this.activeKey)?.abort();
      this.historyControllers.delete(this.activeKey);
      const previous = this.records.get(this.activeKey);
      if (previous) {
        previous.requestVersion += 1;
        previous.request = undefined;
        previous.requestToken = undefined;
        previous.requestKind = undefined;
        previous.openReconciliation = undefined;
        previous.openReconciliationToken = undefined;
      }
    }
    this.activeKey = nextKey;
    this.activeEpoch += 1;
    if (scope) {
      const record = this.record(nextKey);
      if (!record.conversation && !record.pendingCommand && !record.request) {
        try {
          const snapshot = this.journal.load(scope);
          if (this.journal.isCorrupt?.()) record.journalBlocked = true;
          else if (snapshot) this.installSnapshot(record, snapshot);
        } catch (error) {
          if (error instanceof CoordinatorJournalCorruptError) record.journalBlocked = true;
        }
      }
    }
    this.emit();
  }

  deactivate(scope: CoordinatorConversationScope | null | undefined): void {
    if (scope && coordinatorScopeKey(scope) !== this.activeKey) return;
    this.activate(null);
  }

  clearActor(actorKey: string): void {
    this.controllers.forEach((controller) => controller.abort());
    this.controllers.clear();
    this.historyControllers.forEach((controller) => controller.abort());
    this.historyControllers.clear();
    this.records.clear();
    this.activeKey = '';
    this.activeEpoch += 1;
    this.journal.clearActor(actorKey);
    this.emit();
  }

  dispose(): void {
    this.controllers.forEach((controller) => controller.abort());
    this.controllers.clear();
    this.historyControllers.forEach((controller) => controller.abort());
    this.historyControllers.clear();
    // `open` continues with status/history after its acknowledgement. Invalidate
    // that local continuation too, so an unmounted controller cannot reactivate
    // a scope after its network aborts have been issued.
    this.records.forEach((record) => {
      record.requestVersion += 1;
      record.request = undefined;
      record.requestToken = undefined;
      record.requestKind = undefined;
      record.openReconciliation = undefined;
      record.openReconciliationToken = undefined;
    });
    this.activeKey = '';
    this.activeEpoch += 1;
    this.emit();
  }

  private isCurrent(key: string, epoch: number, version: number): boolean {
    return this.activeKey === key &&
      this.activeEpoch === epoch &&
      this.records.get(key)?.requestVersion === version;
  }

  private update(key: string, change: (record: ScopedRecord) => void): void {
    const record = this.record(key);
    change(record);
    record.journalRevision += 1;
    this.emit();
  }

  get(scope: CoordinatorConversationScope | null | undefined): CoordinatorConversationViewState {
    const key = coordinatorScopeKey(scope);
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
      openingReconciliation: Boolean(record.openReconciliation),
    };
  }

  /**
   * Read only actual server-owned canonical rows. This never turns a status,
   * setup response, or foreground acknowledgement into a transcript bubble.
   */
  private loadCanonicalHistory(scope: CoordinatorConversationScope, beforeId?: number): Promise<boolean> {
    const key = coordinatorScopeKey(scope);
    const epoch = this.activeEpoch;
    const gateway = this.gatewayFor();
    if (!key || !gateway?.history) return Promise.resolve(false);
    this.historyControllers.get(key)?.abort();
    const controller = new AbortController();
    this.historyControllers.set(key, controller);
    this.update(key, (record) => { record.canonicalHistoryLoading = true; });
    return gateway.history({
      sessionId: scope.sessionId,
      projectId: scope.projectId,
      limit: 50,
      ...(beforeId === undefined ? {} : { beforeId }),
    }, controller.signal).then((history) => {
      if (this.activeKey !== key || this.activeEpoch !== epoch || this.historyControllers.get(key) !== controller) return false;
      this.update(key, (record) => {
        record.canonicalHistory = mergeCoordinatorHistory(record.canonicalHistory, history);
        record.canonicalHistoryLoading = false;
      });
      return true;
    }).catch(() => {
      // A history read is not an authority or transcript fallback.
      if (this.activeKey === key && this.activeEpoch === epoch && this.historyControllers.get(key) === controller) {
        this.update(key, (record) => { record.canonicalHistoryLoading = false; });
      }
      return false;
    }).finally(() => {
      if (this.historyControllers.get(key) === controller) this.historyControllers.delete(key);
    });
  }

  /** Request the next older bounded page from the actual returned row identity. */
  loadOlderHistory(scope: CoordinatorConversationScope): Promise<boolean> {
    const record = this.records.get(coordinatorScopeKey(scope));
    const earliestId = record?.canonicalHistory?.messages.reduce<number | undefined>((earliest, message) => (
      earliest === undefined || message.id < earliest ? message.id : earliest
    ), undefined);
    if (!record?.canonicalHistory?.hasMore || earliestId === undefined || earliestId < 1) return Promise.resolve(false);
    return this.loadCanonicalHistory(scope, earliestId);
  }

  private run(
    scope: CoordinatorConversationScope,
    phase: Extract<CoordinatorConversationPhase, 'opening' | 'refreshing' | 'sending'>,
    kind: RequestKind,
    work: (gateway: CoordinatorConversationGateway, signal: AbortSignal) => Promise<CoordinatorConversationResult>,
    accept: (record: ScopedRecord, result: CoordinatorConversationResult) => boolean,
  ): Promise<boolean> {
    this.activate(scope);
    const key = coordinatorScopeKey(scope);
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
    // Resolve the capability before taking the synchronous single-flight slot.
    // Otherwise an immediately-resolved missing-gateway branch can leave a
    // completed promise in record.request and block a later reconnection.
    const gateway = this.gatewayFor();
    if (!gateway) {
      this.update(key, (next) => {
        next.enabled = true;
        next.phase = 'unavailable';
        next.notice = {
          message: 'Coordinator capability is unavailable for this chat. Normal chat remains available.',
          retryable: Boolean(next.pendingCommand),
        };
      });
      this.persistLater(scope, key);
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

    const request = (async () => {
      try {
        if (kind === 'prepare-plan' || kind === 'continue-plan') {
          // Give a synchronous Return to normal chat/session switch one turn
          // to revoke a finite control before it reaches its wire. The
          // single-flight token is already installed, so duplicate taps still
          // coalesce during this microtask.
          await Promise.resolve();
          if (!this.isCurrent(key, epoch, version)) return false;
        }
        const result = await work(gateway, controller.signal);
        if (!this.isCurrent(key, epoch, version)) return false;
        const accepted = accept(this.record(key), result);
        this.persistLater(scope, key);
        return accepted;
      } catch (error) {
        if (!this.isCurrent(key, epoch, version) || isAbort(error)) return false;
        this.update(key, (next) => {
          next.enabled = true;
          next.phase = 'unavailable';
          next.notice = errorNotice(error);
        });
        this.persistLater(scope, key);
        return false;
      } finally {
        const latest = this.records.get(key);
        if (latest?.requestToken === token) {
          latest.request = undefined;
          latest.requestToken = undefined;
          latest.requestKind = undefined;
        }
        if (this.controllers.get(key) === controller) this.controllers.delete(key);
      }
    })();
    record.request = request;
    return request;
  }

  async open(scope: CoordinatorConversationScope): Promise<boolean> {
    this.activate(scope);
    const key = coordinatorScopeKey(scope);
    const existing = this.record(key);
    // An open acknowledgement only establishes the server root. Keep its
    // follow-up status/history work as one scoped operation so an entry click
    // during that reconciliation never sees `refresh` as an unrelated failed
    // open and overwrites a ready primary view.
    if (existing.openReconciliation) return existing.openReconciliation;
    if (existing.journalBlocked) {
      this.update(key, (record) => {
        record.enabled = true;
        record.phase = 'unavailable';
        record.notice = {
          message: 'Coordinator command storage needs review before another message can be sent. Normal chat remains available.',
          retryable: false,
        };
      });
      return false;
    }
    const reviewAfterOpen = Boolean(existing.pendingCommand && existing.phase === 'review');
    const retryAfterOpen = Boolean(existing.pendingCommand && existing.notice?.retryable);
    this.update(key, (record) => { record.enabled = true; });
    this.persistLater(scope, key);
    const reconciliationToken = Symbol('coordinator-open-reconciliation');
    const reconciliation = (async () => {
      const opened = await this.run(
        scope,
        'opening',
        'open',
        (gateway, signal) => gateway.open({ sessionId: scope.sessionId, projectId: scope.projectId }, signal),
        (record, result) => {
          if (result.kind !== 'created' && result.kind !== 'replay') {
            installConversation(record, result);
            record.enabled = true;
            if (record.pendingProvenance === 'rejected') record.reviewedConflictRevision = undefined;
            record.phase = isConflict(result) ? 'review' : 'unavailable';
            record.notice = unavailableNotice(result);
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
      if (!opened || this.records.get(key)?.openReconciliationToken !== reconciliationToken) return false;
      // These are independent server reads after the actual open response.
      // Wait for both to settle before the entry reports ready; a history read
      // failure itself does not demote an otherwise authoritative status root.
      const [refreshed] = await Promise.all([
        this.refresh(scope, reviewAfterOpen, retryAfterOpen, false),
        this.loadCanonicalHistory(scope),
      ]);
      if (!refreshed || this.records.get(key)?.openReconciliationToken !== reconciliationToken) return false;
      const current = this.get(scope);
      return current.enabled &&
        current.phase === 'ready' &&
        current.conversation?.sessionId === scope.sessionId &&
        current.conversation.projectId === scope.projectId;
    })();
    existing.openReconciliation = reconciliation;
    existing.openReconciliationToken = reconciliationToken;
    const clearReconciliation = () => {
      const latest = this.records.get(key);
      if (latest?.openReconciliation === reconciliation && latest.openReconciliationToken === reconciliationToken) {
        latest.openReconciliation = undefined;
        latest.openReconciliationToken = undefined;
        this.emit();
      }
    };
    void reconciliation.then(clearReconciliation, clearReconciliation);
    return reconciliation;
  }

  async refresh(
    scope: CoordinatorConversationScope,
    review = false,
    _preservePendingRetry = false,
    readCanonicalHistory = true,
  ): Promise<boolean> {
    this.activate(scope);
    const key = coordinatorScopeKey(scope);
    if (this.record(key).journalBlocked) return false;
    const refreshed = await this.run(
      scope,
      'refreshing',
      'refresh',
      (gateway, signal) => gateway.status({ sessionId: scope.sessionId, projectId: scope.projectId }, signal),
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
        record.notice = unavailableNotice(result);
        record.journalRevision += 1;
        this.emit();
        return false;
      },
    );
    if (refreshed && readCanonicalHistory) void this.loadCanonicalHistory(scope);
    return refreshed;
  }

  async send(scope: CoordinatorConversationScope, message: string): Promise<CoordinatorSendResult> {
    this.activate(scope);
    const key = coordinatorScopeKey(scope);
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
    // A status/open acknowledgement belongs only to that operation. It may
    // never clear this composer or imply that a message entered the wire.
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
    // The immutable command must be retained before its first wire exposure.
    if (!this.persist(scope, this.record(key))) {
      if (this.reconcileFailedAdmission(scope, key)) return { accepted: false };
      this.update(key, (next) => {
        next.enabled = true;
        next.phase = 'unavailable';
        next.notice = { message: 'Coordinator command storage is unavailable. Your draft was not sent.', retryable: true };
      });
      return { accepted: false };
    }
    const accepted = await this.run(
      scope,
      'sending',
      'send',
      (gateway, signal) => gateway.message({
        sessionId: scope.sessionId,
        projectId: scope.projectId,
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
        next.notice = unavailableNotice(result);
        next.journalRevision += 1;
        this.emit();
        return false;
      },
    );
    if (accepted) this.loadCanonicalHistory(scope);
    return { accepted };
  }

  async retry(scope: CoordinatorConversationScope): Promise<boolean> {
    const record = this.records.get(coordinatorScopeKey(scope));
    if (!record?.pendingCommand || record.pendingProvenance === 'rejected') return false;
    return (await this.send(scope, record.pendingCommand.message)).accepted;
  }

  private acceptPlanResult(record: ScopedRecord, result: CoordinatorConversationResult): boolean {
    installConversation(record, result);
    record.enabled = true;
    // A typed response (including a truthful hold) is definitive for the
    // exact local request. Transport/malformed outcomes intentionally leave
    // planAttempt intact for an explicit same-command retry while mounted.
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
    record.notice = unavailableNotice(result);
    record.journalRevision += 1;
    this.emit();
    return false;
  }

  async preparePlan(
    scope: CoordinatorConversationScope,
    goalId: string,
    consent: CoordinatorPlanConsent,
  ): Promise<boolean> {
    this.activate(scope);
    const key = coordinatorScopeKey(scope);
    const record = this.record(key);
    // A stale finite-consent callback must not silently opt a user back in
    // after Return to normal chat. Only an explicit open can enable it again.
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
    if ((record.conversation.schemaVersion !== 3 && record.conversation.schemaVersion !== 4) || record.conversation.primaryOwnerRoot !== true) {
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
    const gateway = this.gatewayFor();
    if (!gateway?.preparePlan) {
      this.update(key, (next) => {
        next.enabled = true;
        next.phase = 'unavailable';
        next.notice = { message: 'Managed planning is unavailable for this connection. No work was started.', retryable: false };
      });
      return false;
    }
    const admission: CoordinatorPlanAdmission = { ...consent, commandKey: commandKey() };
    const attempt: Extract<CoordinatorPlanAttempt, { kind: 'prepare' }> = {
      kind: 'prepare',
      goalId,
      expectedControlRevision: record.conversation.controlRevision,
      input: admission,
    };
    record.planAttempt = attempt;
    return this.run(
      scope,
      'sending',
      'prepare-plan',
      (_currentGateway, signal) => gateway.preparePlan!({
        sessionId: scope.sessionId,
        projectId: scope.projectId,
        expectedControlRevision: attempt.expectedControlRevision,
        goalId: attempt.goalId,
        admission: attempt.input,
      }, signal),
      (next, result) => this.acceptPlanResult(next, result),
    );
  }

  async continuePlan(
    scope: CoordinatorConversationScope,
    goalId: string,
    authorizationId: string,
  ): Promise<boolean> {
    this.activate(scope);
    const key = coordinatorScopeKey(scope);
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
    if ((record.conversation.schemaVersion !== 3 && record.conversation.schemaVersion !== 4) || record.conversation.primaryOwnerRoot !== true) {
      this.update(key, (next) => {
        next.enabled = true;
        next.phase = 'unavailable';
        next.notice = { message: 'Managed continuation is not available for this server conversation. No work was started.', retryable: false };
      });
      return false;
    }
    const gateway = this.gatewayFor();
    if (!gateway?.continuePlan) {
      this.update(key, (next) => {
        next.enabled = true;
        next.phase = 'unavailable';
        next.notice = { message: 'Managed continuation is unavailable for this connection. No work was started.', retryable: false };
      });
      return false;
    }
    const attempt: Extract<CoordinatorPlanAttempt, { kind: 'continue' }> = {
      kind: 'continue',
      goalId,
      authorizationId,
      expectedControlRevision: record.conversation.controlRevision,
    };
    record.planAttempt = attempt;
    return this.run(
      scope,
      'sending',
      'continue-plan',
      (_currentGateway, signal) => gateway.continuePlan!({
        sessionId: scope.sessionId,
        projectId: scope.projectId,
        expectedControlRevision: attempt.expectedControlRevision,
        goalId: attempt.goalId,
        authorizationId: attempt.authorizationId,
      }, signal),
      (next, result) => this.acceptPlanResult(next, result),
    );
  }

  async retryPlan(scope: CoordinatorConversationScope): Promise<boolean> {
    const key = coordinatorScopeKey(scope);
    const record = this.records.get(key);
    const attempt = record?.planAttempt;
    if (!record?.enabled || !record.conversation || !attempt) return false;
    const gateway = this.gatewayFor();
    if (!gateway) return false;
    if (attempt.kind === 'prepare' && gateway.preparePlan) {
      return this.run(
        scope,
        'sending',
        'prepare-plan',
        (_currentGateway, signal) => gateway.preparePlan!({
          sessionId: scope.sessionId,
          projectId: scope.projectId,
          expectedControlRevision: attempt.expectedControlRevision,
          goalId: attempt.goalId,
          admission: attempt.input,
        }, signal),
        (next, result) => this.acceptPlanResult(next, result),
      );
    }
    if (attempt.kind === 'continue' && gateway.continuePlan) {
      return this.run(
        scope,
        'sending',
        'continue-plan',
        (_currentGateway, signal) => gateway.continuePlan!({
          sessionId: scope.sessionId,
          projectId: scope.projectId,
          expectedControlRevision: attempt.expectedControlRevision,
          goalId: attempt.goalId,
          authorizationId: attempt.authorizationId,
        }, signal),
        (next, result) => this.acceptPlanResult(next, result),
      );
    }
    return false;
  }

  async reviewConflict(scope: CoordinatorConversationScope): Promise<boolean> {
    return this.refresh(scope, true);
  }

  beginNewMessageAfterReview(scope: CoordinatorConversationScope): boolean {
    const key = coordinatorScopeKey(scope);
    const record = this.records.get(key);
    if (!record?.pendingCommand || record.pendingProvenance !== 'rejected' || !matchesPendingRejection(record.pendingCommand, record.pendingRejection) || record.phase !== 'review' || !record.conversation ||
      record.reviewedConflictRevision !== record.conversation.controlRevision) return false;
    const nextRevision = record.journalRevision + 1;
    if (!this.journal.save(scope, {
      viewEnabled: true,
      retirement: {
        kind: 'reviewed_rejection',
        command: { ...record.pendingCommand },
        reviewedConflictRevision: record.reviewedConflictRevision,
      },
      writeRevision: nextRevision,
    })) {
      this.update(key, (next) => {
        next.notice = { message: 'Coordinator command storage is unavailable. The earlier command was not re-sent.', retryable: true };
      });
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

  returnToNormal(scope: CoordinatorConversationScope): void {
    const key = coordinatorScopeKey(scope);
    this.controllers.get(key)?.abort();
    this.controllers.delete(key);
    this.historyControllers.get(key)?.abort();
    this.historyControllers.delete(key);
    this.update(key, (record) => {
      record.requestVersion += 1;
      record.request = undefined;
      record.requestToken = undefined;
      record.requestKind = undefined;
      record.openReconciliation = undefined;
      record.openReconciliationToken = undefined;
      record.enabled = false;
    });
    this.persistLater(scope, key);
  }
}

export function submitCoordinatorComposerInput(input: {
  active: boolean;
  attachmentCount: number;
  message: string;
  send: (message: string) => Promise<CoordinatorSendResult | boolean>;
}): Promise<{ handled: boolean; accepted: boolean; reason?: string }> {
  if (!input.active) return Promise.resolve({ handled: false, accepted: false });
  if (input.attachmentCount > 0) {
    return Promise.resolve({
      handled: true,
      accepted: false,
      reason: 'Coordinator messages are plaintext. Remove attachments before sending.',
    });
  }
  if (!input.message.trim()) return Promise.resolve({ handled: true, accepted: false });
  return input.send(input.message).then((result) => ({
    handled: true,
    accepted: typeof result === 'boolean' ? result : result.accepted,
  }));
}

/** React adapter for the durable scoped controller. */
export function useCoordinatorConversation(
  scope: CoordinatorConversationScope | null,
  gateway: CoordinatorConversationGateway | undefined,
  _actorIdentity?: string | null,
) {
  const scopeRef = useRef(scope);
  const gatewayRef = useRef(gateway);
  const controllerRef = useRef<CoordinatorConversationController | null>(null);
  const [, publish] = useState(0);
  scopeRef.current = scope;
  gatewayRef.current = gateway;
  if (!controllerRef.current) {
    controllerRef.current = new CoordinatorConversationController(() => gatewayRef.current);
  }
  const controller = controllerRef.current;
  const key = coordinatorScopeKey(scope);

  useEffect(() => controller.subscribe(() => publish((revision) => revision + 1)), [controller]);

  useEffect(() => {
    controller.activate(scope);
    if (scope && controller.get(scope).enabled) void controller.open(scope);
    return () => controller.deactivate(scope);
  }, [controller, key, scope]);

  useEffect(() => () => controller.dispose(), [controller]);

  const open = useCallback(() => {
    const requestedScope = scopeRef.current;
    return requestedScope ? controller.open(requestedScope) : Promise.resolve(false);
  }, [controller]);
  const refresh = useCallback(() => {
    const requestedScope = scopeRef.current;
    return requestedScope ? controller.refresh(requestedScope) : Promise.resolve(false);
  }, [controller]);
  const send = useCallback((message: string) => {
    const requestedScope = scopeRef.current;
    return requestedScope ? controller.send(requestedScope, message) : Promise.resolve({ accepted: false });
  }, [controller]);
  const retry = useCallback(() => {
    const requestedScope = scopeRef.current;
    return requestedScope ? controller.retry(requestedScope) : Promise.resolve(false);
  }, [controller]);
  const loadOlderHistory = useCallback(() => {
    const requestedScope = scopeRef.current;
    return requestedScope ? controller.loadOlderHistory(requestedScope) : Promise.resolve(false);
  }, [controller]);
  const preparePlan = useCallback((goalId: string, consent: CoordinatorPlanConsent) => {
    const requestedScope = scopeRef.current;
    return requestedScope ? controller.preparePlan(requestedScope, goalId, consent) : Promise.resolve(false);
  }, [controller]);
  const continuePlan = useCallback((goalId: string, authorizationId: string) => {
    const requestedScope = scopeRef.current;
    return requestedScope ? controller.continuePlan(requestedScope, goalId, authorizationId) : Promise.resolve(false);
  }, [controller]);
  const retryPlan = useCallback(() => {
    const requestedScope = scopeRef.current;
    return requestedScope ? controller.retryPlan(requestedScope) : Promise.resolve(false);
  }, [controller]);
  const reviewConflict = useCallback(() => {
    const requestedScope = scopeRef.current;
    return requestedScope ? controller.reviewConflict(requestedScope) : Promise.resolve(false);
  }, [controller]);
  const beginNewMessageAfterReview = useCallback(() => {
    const requestedScope = scopeRef.current;
    return requestedScope ? controller.beginNewMessageAfterReview(requestedScope) : false;
  }, [controller]);
  const returnToNormal = useCallback(() => {
    const requestedScope = scopeRef.current;
    if (requestedScope) controller.returnToNormal(requestedScope);
  }, [controller]);

  const state = scope ? controller.get(scope) : inactive;
  return useMemo(() => ({
    state,
    open,
    refresh,
    send,
    retry,
    loadOlderHistory,
    preparePlan,
    continuePlan,
    retryPlan,
    reviewConflict,
    beginNewMessageAfterReview,
    returnToNormal,
  }), [beginNewMessageAfterReview, continuePlan, loadOlderHistory, open, preparePlan, refresh, retry, retryPlan, reviewConflict, returnToNormal, send, state]);
}
