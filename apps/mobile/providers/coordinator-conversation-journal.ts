import AsyncStorage from '@react-native-async-storage/async-storage';

import type { MobileCoordinatorBinding } from '@/providers/coordinator-conversation-binding';

const STORAGE_KEY = 'rhythm.coordinator-conversation-journal.v1';

export type MobileCoordinatorJournalCommand = {
  commandKey: string;
  expectedControlRevision: number;
  message: string;
};

/** Immutable proof that this exact command received a server-side 409. */
export type MobileCoordinatorJournalRejection = {
  commandKey: string;
  expectedControlRevision: number;
  kind: 'revision_conflict' | 'command_conflict';
};

/**
 * Operation-local evidence for replacing a retained command. This is never
 * serialized: only the exact controller acknowledgement or reviewed direct
 * rejection may consume it.
 */
export type MobileCoordinatorJournalRetirement = {
  command: MobileCoordinatorJournalCommand;
  kind: 'acknowledged' | 'reviewed_rejection';
  reviewedConflictRevision?: number;
};

/** A tiny local view pointer, never canonical chat history or authority. */
export type MobileCoordinatorJournalSnapshot = {
  viewEnabled: boolean;
  pendingCommand?: MobileCoordinatorJournalCommand;
  /** Missing on older records means uncertain, never rejected. */
  pendingProvenance?: 'uncertain' | 'rejected';
  pendingRejection?: MobileCoordinatorJournalRejection;
  pendingState?: 'retry' | 'review';
  reviewedConflictRevision?: number;
  /** Ephemeral proof consumed by save(), never part of durable journal bytes. */
  retirement?: MobileCoordinatorJournalRetirement;
  /** Local monotonic ordering only; it is not a server revision. */
  writeRevision?: number;
};

type StoredEntry = MobileCoordinatorJournalSnapshot & {
  version: 1;
  actorKey: string;
  projectId: string;
  sessionId: string;
  /** Legacy view-row discriminator; no longer part of the durable wire scope. */
  uiSessionId?: string;
};

type KeyValueStorage = Pick<typeof AsyncStorage, 'getItem' | 'setItem'>;

type SharedStorageJournalState = {
  /** Serializes this physical storage identity and journal namespace. */
  tail: Promise<void>;
  /** A corrupt non-null payload blocks every factory sharing these bytes. */
  corrupt: boolean;
};

// Provider remounts construct a fresh journal wrapper around the same
// AsyncStorage object. A factory-local queue lets an old delayed read write a
// stale whole-map snapshot after a newer factory has admitted an immutable
// command. Queue by actual storage identity and namespace instead.
const sharedStorageJournalStates = new WeakMap<object, Map<string, SharedStorageJournalState>>();

function sharedStorageJournalState(
  storage: KeyValueStorage,
  namespace: string,
): SharedStorageJournalState {
  const identity = storage as object;
  let namespaces = sharedStorageJournalStates.get(identity);
  if (!namespaces) {
    namespaces = new Map();
    sharedStorageJournalStates.set(identity, namespaces);
  }
  let state = namespaces.get(namespace);
  if (!state) {
    state = { tail: Promise.resolve(), corrupt: false };
    namespaces.set(namespace, state);
  }
  return state;
}

export class MobileCoordinatorJournalCorruptError extends Error {
  constructor() {
    super('Coordinator command storage needs review before another message can be sent.');
    this.name = 'MobileCoordinatorJournalCorruptError';
  }
}

export interface MobileCoordinatorJournal {
  clearActor(actorKey: string): Promise<boolean>;
  /** True only after a non-null journal payload failed integrity validation. */
  isCorrupt?(): boolean;
  load(binding: MobileCoordinatorBinding): Promise<MobileCoordinatorJournalSnapshot | undefined>;
  remove(binding: MobileCoordinatorBinding): Promise<boolean>;
  save(binding: MobileCoordinatorBinding, snapshot: MobileCoordinatorJournalSnapshot): Promise<boolean>;
}

function scopeKey(binding: MobileCoordinatorBinding): string {
  // The durable pointer follows the actual coordinator wire scope. A paired
  // SDK row can be absent (server primary) or change after catalog refresh;
  // it must never make an uncertain command unreachable.
  return JSON.stringify([
    binding.actorKey,
    binding.projectId,
    binding.sessionId,
  ]);
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

function isCommand(value: unknown): value is MobileCoordinatorJournalCommand {
  return !!value && typeof value === 'object' &&
    hasOnlyKeys(value, ['commandKey', 'expectedControlRevision', 'message']) &&
    isText((value as { commandKey?: unknown }).commandKey) &&
    isPositiveSafeInteger((value as { expectedControlRevision?: unknown }).expectedControlRevision) &&
    isText((value as { message?: unknown }).message);
}

function isRejection(value: unknown): value is MobileCoordinatorJournalRejection {
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
    'version', 'actorKey', 'projectId', 'sessionId', 'uiSessionId', 'viewEnabled',
    'pendingCommand', 'pendingProvenance', 'pendingRejection', 'pendingState',
    'reviewedConflictRevision', 'writeRevision',
  ]) && entry.version === 1 &&
    isText(entry.actorKey) &&
    isText(entry.projectId) &&
    isText(entry.sessionId) &&
    (entry.uiSessionId === undefined || isText(entry.uiSessionId)) &&
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

function matches(binding: MobileCoordinatorBinding, entry: StoredEntry): boolean {
  return entry.actorKey === binding.actorKey &&
    entry.projectId === binding.projectId &&
    entry.sessionId === binding.sessionId;
}

function cloneSnapshot(snapshot: MobileCoordinatorJournalSnapshot): MobileCoordinatorJournalSnapshot {
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

function entryFor(binding: MobileCoordinatorBinding, snapshot: MobileCoordinatorJournalSnapshot): StoredEntry {
  return {
    version: 1,
    actorKey: binding.actorKey,
    projectId: binding.projectId,
    sessionId: binding.sessionId,
    ...cloneSnapshot(snapshot),
  };
}

function parseEntries(raw: string | null): Record<string, StoredEntry> {
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new MobileCoordinatorJournalCorruptError();
    }
    for (const value of Object.values(parsed)) {
      if (!isEntry(value)) throw new MobileCoordinatorJournalCorruptError();
    }
    return parsed as Record<string, StoredEntry>;
  } catch (error) {
    if (error instanceof MobileCoordinatorJournalCorruptError) throw error;
    throw new MobileCoordinatorJournalCorruptError();
  }
}

function storedRevision(entry: StoredEntry | undefined): number {
  return entry?.writeRevision ?? 0;
}

type ScopedEntry = { key: string; entry: StoredEntry };

/**
 * Older v1 bytes used a UI-session suffix in their map key. Read one matching
 * legacy entry so a catalog refresh cannot strand an uncertain command. More
 * than one matching entry is intentionally a hold: choosing between distinct
 * retained commands would invent retirement/rejection proof.
 */
function scopedEntry(
  entries: Record<string, StoredEntry>,
  binding: MobileCoordinatorBinding,
): ScopedEntry | undefined {
  const key = scopeKey(binding);
  const direct = entries[key];
  if (direct && !matches(binding, direct)) throw new MobileCoordinatorJournalCorruptError();
  const candidates = Object.entries(entries)
    .filter(([, entry]) => matches(binding, entry))
    .map(([candidateKey, entry]) => ({ key: candidateKey, entry }));
  if (candidates.length > 1) throw new MobileCoordinatorJournalCorruptError();
  return candidates[0];
}

function sameCommand(
  left: MobileCoordinatorJournalCommand | undefined,
  right: MobileCoordinatorJournalCommand | undefined,
): boolean {
  return Boolean(
    left && right &&
    left.commandKey === right.commandKey &&
    left.expectedControlRevision === right.expectedControlRevision &&
    left.message === right.message,
  );
}

function sameRejection(
  left: MobileCoordinatorJournalRejection | undefined,
  right: MobileCoordinatorJournalRejection | undefined,
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
  next: MobileCoordinatorJournalSnapshot,
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

function shouldKeepExisting(existing: StoredEntry | undefined, next: MobileCoordinatorJournalSnapshot): boolean {
  if (!existing) return false;
  // Local write revisions order view snapshots only. They can never replace an
  // already durable immutable command; exact operation evidence is required.
  if (existing.pendingCommand) {
    if (!next.pendingCommand) return !hasMatchingRetirement(existing, next);
    if (!sameCommand(existing.pendingCommand, next.pendingCommand)) return true;
    return existing.pendingProvenance === 'rejected' &&
      (next.pendingProvenance !== 'rejected' || !sameRejection(existing.pendingRejection, next.pendingRejection));
  }
  const nextRevision = next.writeRevision ?? 0;
  return storedRevision(existing) > nextRevision;
}

function isExactRetryableAdmission(
  existing: StoredEntry | undefined,
  next: MobileCoordinatorJournalSnapshot,
): boolean {
  const stored = existing?.pendingCommand;
  const attempted = next.pendingCommand;
  // A retained write is not an admission merely because it shares a scope.
  // It can authorize the wire only when this exact immutable command is still
  // retryable. A directly rejected command must be reconciled into review
  // state instead of being sent again by a stale controller.
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
 * AsyncStorage writes are whole-map read/modify/write operations. Serialize
 * every operation so a delayed scope-A write cannot overwrite a newer scope-B
 * admission. Corrupt non-null bytes are never replaced.
 */
export function createMobileCoordinatorJournal(
  storage: KeyValueStorage = AsyncStorage,
): MobileCoordinatorJournal {
  const shared = sharedStorageJournalState(storage, STORAGE_KEY);
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = shared.tail.then(operation, operation);
    shared.tail = result.then(() => undefined, () => undefined);
    return result;
  };
  const read = async (): Promise<Record<string, StoredEntry>> => {
    try {
      const entries = parseEntries(await storage.getItem(STORAGE_KEY));
      shared.corrupt = false;
      return entries;
    } catch (error) {
      shared.corrupt = error instanceof MobileCoordinatorJournalCorruptError;
      throw error;
    }
  };
  const write = async (entries: Record<string, StoredEntry>): Promise<boolean> => {
    try {
      await storage.setItem(STORAGE_KEY, JSON.stringify(entries));
      return true;
    } catch {
      return false;
    }
  };
  return {
    load(binding) {
      return serial(async () => {
        try {
          const entry = scopedEntry(await read(), binding)?.entry;
          return entry ? cloneSnapshot(entry) : undefined;
        } catch (error) {
          if (error instanceof MobileCoordinatorJournalCorruptError) return undefined;
          throw error;
        }
      });
    },
    save(binding, snapshot) {
      return serial(async () => {
        try {
          const entries = await read();
          const key = scopeKey(binding);
          const existing = scopedEntry(entries, binding);
          if (shouldKeepExisting(existing?.entry, snapshot)) {
            return isExactRetryableAdmission(existing?.entry, snapshot);
          }
          if (existing && existing.key !== key) delete entries[existing.key];
          entries[key] = entryFor(binding, snapshot);
          return write(entries);
        } catch (error) {
          // Preserve malformed non-null bytes and let the controller show its
          // fail-closed hold. A boolean failure cannot be mistaken for a
          // fresh, empty journal by callers that gate wire admission.
          if (error instanceof MobileCoordinatorJournalCorruptError) shared.corrupt = true;
          return false;
        }
      });
    },
    remove(binding) {
      return serial(async () => {
        try {
          const entries = await read();
          const existing = scopedEntry(entries, binding);
          if (existing) delete entries[existing.key];
          return write(entries);
        } catch (error) {
          if (error instanceof MobileCoordinatorJournalCorruptError) shared.corrupt = true;
          return false;
        }
      });
    },
    clearActor(actorKey) {
      return serial(async () => {
        try {
          const entries = await read();
          for (const [key, entry] of Object.entries(entries)) {
            if (entry.actorKey === actorKey) delete entries[key];
          }
          return write(entries);
        } catch {
          return false;
        }
      });
    },
    isCorrupt() {
      return shared.corrupt;
    },
  };
}

/** In-memory adapter for deterministic controller tests. */
export function createMemoryMobileCoordinatorJournal(): MobileCoordinatorJournal {
  const entries = new Map<string, StoredEntry>();
  return {
    isCorrupt() {
      return false;
    },
    async load(binding) {
      const entry = entries.get(scopeKey(binding));
      return entry && matches(binding, entry) ? cloneSnapshot(entry) : undefined;
    },
    async save(binding, snapshot) {
      const key = scopeKey(binding);
      const existing = entries.get(key);
      if (shouldKeepExisting(existing, snapshot)) {
        return isExactRetryableAdmission(existing, snapshot);
      }
      entries.set(key, entryFor(binding, snapshot));
      return true;
    },
    async remove(binding) {
      entries.delete(scopeKey(binding));
      return true;
    },
    async clearActor(actorKey) {
      for (const [key, entry] of entries) {
        if (entry.actorKey === actorKey) entries.delete(key);
      }
      return true;
    },
  };
}
