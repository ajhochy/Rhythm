import type { CoordinatorConversationScope } from './coordinator-conversations';

const STORAGE_KEY = 'rhythm.coordinator-conversation-journal.v1';

export type CoordinatorJournalCommand = {
  commandKey: string;
  expectedControlRevision: number;
  message: string;
};

/**
 * A new message is permitted only after this locally retained marker proves
 * that the exact immutable command received a definitive server-side 409.
 */
export type CoordinatorJournalRejection = {
  commandKey: string;
  expectedControlRevision: number;
  kind: 'revision_conflict' | 'command_conflict';
};

/**
 * Ephemeral evidence consumed only while replacing a retained command. It is
 * deliberately excluded from stored entries: a view refresh cannot mint
 * acknowledgement/rejection proof by carrying it across a restart.
 */
export type CoordinatorJournalRetirement = {
  command: CoordinatorJournalCommand;
  kind: 'acknowledged' | 'reviewed_rejection';
  reviewedConflictRevision?: number;
};

/**
 * This is intentionally control-plane-only. It can retain an uncertain wire
 * command, but never transcript/context/model/owner authority.
 */
export type CoordinatorJournalSnapshot = {
  viewEnabled: boolean;
  pendingCommand?: CoordinatorJournalCommand;
  /** Older entries have no provenance; those are deliberately treated as uncertain. */
  pendingProvenance?: 'uncertain' | 'rejected';
  pendingRejection?: CoordinatorJournalRejection;
  pendingState?: 'retry' | 'review';
  reviewedConflictRevision?: number;
  /** Never persisted; only the matching controller operation may consume it. */
  retirement?: CoordinatorJournalRetirement;
  /** Monotonic per-scope local write ordering, not a server control revision. */
  writeRevision?: number;
};

type StoredEntry = CoordinatorJournalSnapshot & {
  version: 1;
  actorKey: string;
  projectId: string;
  sessionId: string;
};

export class CoordinatorJournalCorruptError extends Error {
  constructor() {
    super('Coordinator command storage needs review before another message can be sent.');
    this.name = 'CoordinatorJournalCorruptError';
  }
}

export interface CoordinatorConversationJournal {
  clearActor(actorKey: string): boolean;
  /** True only after a non-null journal payload failed integrity validation. */
  isCorrupt?(): boolean;
  load(scope: CoordinatorConversationScope): CoordinatorJournalSnapshot | undefined;
  remove(scope: CoordinatorConversationScope): boolean;
  save(scope: CoordinatorConversationScope, snapshot: CoordinatorJournalSnapshot): boolean;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
type ParsedEntries = { entries: Record<string, StoredEntry> } | { corrupt: true };

function scopeKey(scope: CoordinatorConversationScope): string {
  return JSON.stringify([scope.actorKey, scope.projectId, scope.sessionId]);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function hasOnlyKeys(value: object, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isCommand(value: unknown): value is CoordinatorJournalCommand {
  return !!value && typeof value === 'object' &&
    hasOnlyKeys(value, ['commandKey', 'expectedControlRevision', 'message']) &&
    isText((value as { commandKey?: unknown }).commandKey) &&
    isPositiveSafeInteger((value as { expectedControlRevision?: unknown }).expectedControlRevision) &&
    isText((value as { message?: unknown }).message);
}

function isRejection(value: unknown): value is CoordinatorJournalRejection {
  return !!value && typeof value === 'object' &&
    hasOnlyKeys(value, ['commandKey', 'expectedControlRevision', 'kind']) &&
    isText((value as { commandKey?: unknown }).commandKey) &&
    isPositiveSafeInteger((value as { expectedControlRevision?: unknown }).expectedControlRevision) &&
    ((value as { kind?: unknown }).kind === 'revision_conflict' ||
      (value as { kind?: unknown }).kind === 'command_conflict');
}

function isEntry(value: unknown): value is StoredEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<StoredEntry>;
  const shapeIsValid = hasOnlyKeys(value, [
    'version', 'actorKey', 'projectId', 'sessionId', 'viewEnabled',
    'pendingCommand', 'pendingProvenance', 'pendingRejection', 'pendingState',
    'reviewedConflictRevision', 'writeRevision',
  ]) && entry.version === 1 &&
    isText(entry.actorKey) &&
    isText(entry.projectId) &&
    isText(entry.sessionId) &&
    typeof entry.viewEnabled === 'boolean' &&
    (entry.pendingCommand === undefined || isCommand(entry.pendingCommand)) &&
    (entry.pendingState === undefined || entry.pendingState === 'retry' || entry.pendingState === 'review') &&
    (entry.pendingProvenance === undefined || entry.pendingProvenance === 'uncertain' || entry.pendingProvenance === 'rejected') &&
    (entry.pendingRejection === undefined || isRejection(entry.pendingRejection)) &&
    (entry.reviewedConflictRevision === undefined || isPositiveSafeInteger(entry.reviewedConflictRevision)) &&
    (entry.writeRevision === undefined || (Number.isSafeInteger(entry.writeRevision) && entry.writeRevision >= 0));
  if (!shapeIsValid) return false;
  if (!entry.pendingCommand) {
    return entry.pendingProvenance === undefined &&
      entry.pendingRejection === undefined &&
      entry.pendingState === undefined &&
      entry.reviewedConflictRevision === undefined;
  }
  const rejectionMatches = entry.pendingRejection &&
    entry.pendingRejection.commandKey === entry.pendingCommand.commandKey &&
    entry.pendingRejection.expectedControlRevision === entry.pendingCommand.expectedControlRevision;
  if (entry.pendingProvenance === 'rejected' && !rejectionMatches) return false;
  if (entry.pendingState === 'review' && entry.pendingProvenance !== 'rejected') return false;
  return entry.reviewedConflictRevision === undefined || Boolean(rejectionMatches);
}

function matches(scope: CoordinatorConversationScope, entry: StoredEntry): boolean {
  return entry.actorKey === scope.actorKey &&
    entry.projectId === scope.projectId &&
    entry.sessionId === scope.sessionId;
}

function clone(snapshot: CoordinatorJournalSnapshot): CoordinatorJournalSnapshot {
  return {
    viewEnabled: snapshot.viewEnabled,
    ...(snapshot.pendingCommand ? { pendingCommand: { ...snapshot.pendingCommand } } : {}),
    ...(snapshot.pendingProvenance ? { pendingProvenance: snapshot.pendingProvenance } : {}),
    ...(snapshot.pendingRejection ? { pendingRejection: { ...snapshot.pendingRejection } } : {}),
    ...(snapshot.pendingState ? { pendingState: snapshot.pendingState } : {}),
    ...(snapshot.reviewedConflictRevision ? { reviewedConflictRevision: snapshot.reviewedConflictRevision } : {}),
    ...(snapshot.writeRevision !== undefined ? { writeRevision: snapshot.writeRevision } : {}),
  };
}

function entryFor(scope: CoordinatorConversationScope, snapshot: CoordinatorJournalSnapshot): StoredEntry {
  return {
    version: 1,
    actorKey: scope.actorKey,
    projectId: scope.projectId,
    sessionId: scope.sessionId,
    ...clone(snapshot),
  };
}

function parse(raw: string | null): ParsedEntries {
  if (raw === null) return { entries: {} };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { corrupt: true };
    for (const value of Object.values(parsed)) {
      if (!isEntry(value)) return { corrupt: true };
    }
    return { entries: parsed as Record<string, StoredEntry> };
  } catch {
    return { corrupt: true };
  }
}

function browserStorage(): StorageLike | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function storedRevision(entry: StoredEntry | undefined): number {
  return entry?.writeRevision ?? 0;
}

function sameCommand(
  left: CoordinatorJournalCommand | undefined,
  right: CoordinatorJournalCommand | undefined,
): boolean {
  return Boolean(
    left && right &&
    left.commandKey === right.commandKey &&
    left.expectedControlRevision === right.expectedControlRevision &&
    left.message === right.message,
  );
}

function sameRejection(
  left: CoordinatorJournalRejection | undefined,
  right: CoordinatorJournalRejection | undefined,
): boolean {
  return Boolean(
    left && right &&
    left.commandKey === right.commandKey &&
    left.expectedControlRevision === right.expectedControlRevision &&
    left.kind === right.kind,
  );
}

function hasMatchingRetirement(
  existing: StoredEntry,
  next: CoordinatorJournalSnapshot,
): boolean {
  const retirement = next.retirement;
  if (!existing.pendingCommand || !retirement || !sameCommand(existing.pendingCommand, retirement.command)) {
    return false;
  }
  if (retirement.kind === 'acknowledged') return true;
  const rejection = existing.pendingRejection;
  return existing.pendingProvenance === 'rejected' &&
    existing.pendingState === 'review' &&
    Boolean(rejection) &&
    rejection!.commandKey === retirement.command.commandKey &&
    rejection!.expectedControlRevision === retirement.command.expectedControlRevision &&
    retirement.reviewedConflictRevision !== undefined &&
    retirement.reviewedConflictRevision === existing.reviewedConflictRevision;
}

function shouldKeepExisting(existing: StoredEntry | undefined, next: CoordinatorJournalSnapshot): boolean {
  if (!existing) return false;
  // A journal pointer is the only durable evidence of an uncertain command.
  // Once present, no local write ordering can retire or replace it. The sole
  // exceptions are an exact acknowledged response or a directly rejected
  // command after the matching conflict was explicitly reviewed.
  if (existing.pendingCommand) {
    if (!next.pendingCommand) return !hasMatchingRetirement(existing, next);
    if (!sameCommand(existing.pendingCommand, next.pendingCommand)) return true;
    // A stale uncertain controller may retry its exact command, but it must
    // not erase a later direct 409/review state for that same command.
    return existing.pendingProvenance === 'rejected' &&
      (next.pendingProvenance !== 'rejected' || !sameRejection(existing.pendingRejection, next.pendingRejection));
  }
  const nextRevision = next.writeRevision ?? 0;
  return storedRevision(existing) > nextRevision;
}

function isExactRetryableAdmission(
  existing: StoredEntry | undefined,
  next: CoordinatorJournalSnapshot,
): boolean {
  const stored = existing?.pendingCommand;
  const attempted = next.pendingCommand;
  // A retained entry can only admit the same immutable retry. Returning true
  // for a different command would expose a body the durable journal does not
  // contain. Directly rejected commands instead require reviewed recovery.
  return Boolean(
    stored &&
    attempted &&
    existing?.pendingProvenance !== 'rejected' &&
    stored.commandKey === attempted.commandKey &&
    stored.expectedControlRevision === attempted.expectedControlRevision &&
    stored.message === attempted.message,
  );
}

/**
 * Stores only a view pointer and immutable uncertain command. A non-null but
 * malformed value is fail-closed: it might contain the only record of a wire
 * command, so it is never replaced by an empty map.
 */
export function createCoordinatorConversationJournal(
  storage: StorageLike | undefined = browserStorage(),
): CoordinatorConversationJournal {
  let corrupt = false;
  const read = (): ParsedEntries | undefined => {
    if (!storage) return undefined;
    try {
      const parsed = parse(storage.getItem(STORAGE_KEY));
      corrupt = 'corrupt' in parsed;
      return parsed;
    } catch {
      corrupt = false;
      return undefined;
    }
  };
  const write = (entries: Record<string, StoredEntry>): boolean => {
    if (!storage) return false;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(entries));
      return true;
    } catch {
      return false;
    }
  };
  return {
    load(scope) {
      const parsed = read();
      if (parsed && 'corrupt' in parsed) return undefined;
      const entry = parsed?.entries[scopeKey(scope)];
      return entry && matches(scope, entry) ? clone(entry) : undefined;
    },
    save(scope, snapshot) {
      const parsed = read();
      if (!parsed || 'corrupt' in parsed) return false;
      const key = scopeKey(scope);
      if (shouldKeepExisting(parsed.entries[key], snapshot)) {
        return isExactRetryableAdmission(parsed.entries[key], snapshot);
      }
      parsed.entries[key] = entryFor(scope, snapshot);
      return write(parsed.entries);
    },
    remove(scope) {
      const parsed = read();
      if (!parsed || 'corrupt' in parsed) return false;
      delete parsed.entries[scopeKey(scope)];
      return write(parsed.entries);
    },
    clearActor(actorKey) {
      const parsed = read();
      if (!parsed || 'corrupt' in parsed) return false;
      for (const [key, entry] of Object.entries(parsed.entries)) {
        if (entry.actorKey === actorKey) delete parsed.entries[key];
      }
      return write(parsed.entries);
    },
    isCorrupt() {
      return corrupt;
    },
  };
}

/** In-memory journal for focused source tests. */
export function createMemoryCoordinatorConversationJournal(): CoordinatorConversationJournal {
  const entries = new Map<string, StoredEntry>();
  return {
    isCorrupt() {
      return false;
    },
    load(scope) {
      const entry = entries.get(scopeKey(scope));
      return entry && matches(scope, entry) ? clone(entry) : undefined;
    },
    save(scope, snapshot) {
      const key = scopeKey(scope);
      const existing = entries.get(key);
      if (shouldKeepExisting(existing, snapshot)) {
        return isExactRetryableAdmission(existing, snapshot);
      }
      entries.set(key, entryFor(scope, snapshot));
      return true;
    },
    remove(scope) {
      entries.delete(scopeKey(scope));
      return true;
    },
    clearActor(actorKey) {
      for (const [key, entry] of entries) {
        if (entry.actorKey === actorKey) entries.delete(key);
      }
      return true;
    },
  };
}
