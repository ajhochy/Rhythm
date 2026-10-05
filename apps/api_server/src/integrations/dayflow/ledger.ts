import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  parseDayflowQualifiedReceipt,
  type DayflowQualifiedReceipt,
} from '../../contracts/dayflow_coordinator_reader_contract';

export interface LedgerEntry {
  sourceId: string;
  revisionHash: string;
  memoryId: string;
  contentHash: string;
  /** Exact canonical-import provenance version; legacy rows lacking it hold. */
  exportVersion?: 'fixture-v1' | 'v2.6.0';
  importedAt: string;
  operationId?: string;
  pendingCreateAt?: string;
  tombstonedAt?: string;
  pendingDeleteAt?: string;
  /** Private canonical vault key from a validated create-only receipt. */
  canonicalSourceKey?: string;
  qualification?: DayflowQualifiedReceipt;
  /** Retired immutable revisions for this stable Dayflow card identity. They
   * remain retracted metadata so old dependent references cannot reappear. */
  superseded?: LedgerEntry[];
}
interface LedgerFile {
  version: 1;
  namespace?: string;
  /**
   * A durable one-way fence for an explicit source-consent generation. It is
   * separate from card entries so a failed config rename cannot make an old
   * on-disk consent re-authorize canonical import after restart.
   */
  revokedSourceConsentGenerations?: Record<string, string>;
  entries: Record<string, LedgerEntry>;
}
const empty = (): LedgerFile => ({ version: 1, entries: {} });
const MAX_SUPERSEDED_REVISIONS = 64;
const MAX_REVOKED_SOURCE_CONSENTS = 256;

/** Ledger contains opaque IDs and hashes only — never summaries or raw exports. */
export class MemoryLedger {
  /** In-memory ledgers are instance-local; pending state must never leak into
   * another sanitized ledger/configuration that happens to reuse a source id. */
  private readonly volatilePendingCreates = new Map<string, LedgerEntry>();
  private file: LedgerFile;
  constructor(private readonly path?: string) { this.file = this.load(); }
  private load(): LedgerFile {
    if (!this.path || !existsSync(this.path)) return empty();
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as LedgerFile;
      if (parsed?.version !== 1 || !parsed.entries || typeof parsed.entries !== 'object' || Array.isArray(parsed.entries) ||
          !validRevokedSourceConsents(parsed.revokedSourceConsentGenerations)) throw new Error('invalid schema');
      for (const [key, entry] of Object.entries(parsed.entries)) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('invalid entry');
        const e = entry as LedgerEntry;
        if (key !== e.sourceId || !validEntry(e)) throw new Error('invalid entry');
      }
      return parsed;
    }
    catch { throw new Error('Dayflow ledger is unreadable; import is blocked to preserve tombstones.'); }
  }
  get(sourceId: string) { this.reload(); return this.file.entries[sourceId] ?? this.volatilePendingCreates.get(sourceId); }
  entries() {
    this.reload();
    return Object.values(this.file.entries).flatMap((entry) => [entry, ...(entry.superseded ?? [])]);
  }
  /** Current card rows only. Retired revisions are immutable history and may
   * never be targeted by a user forget operation. */
  currentEntries() {
    this.reload();
    return Object.values(this.file.entries);
  }
  hasOwnershipState() {
    this.reload();
    return Boolean(this.file.namespace) || Object.keys(this.file.entries).length > 0;
  }
  /** A source switch is unsafe only once cards, not merely a namespace, exist. */
  hasOwnedRecords() {
    this.reload();
    return Object.keys(this.file.entries).length > 0;
  }
  /**
   * Persist this before a config mutation that revokes consent. A later failed
   * config write therefore stays closed: authority reads this fence beside the
   * old config rather than trusting its stale active consent.
   */
  revokeSourceConsentGeneration(consentGeneration: string, at = new Date().toISOString()) {
    if (!validConsentGeneration(consentGeneration) || !validTime(at)) {
      throw new Error('invalid Dayflow source-consent revocation');
    }
    this.withWriteLock(() => {
      if (this.path) this.file = this.load();
      const revoked = { ...(this.file.revokedSourceConsentGenerations ?? {}) };
      if (revoked[consentGeneration]) return;
      if (Object.keys(revoked).length >= MAX_REVOKED_SOURCE_CONSENTS) {
        throw new Error('Dayflow source-consent revocation capacity reached.');
      }
      revoked[consentGeneration] = at;
      this.file.revokedSourceConsentGenerations = revoked;
      this.persist();
    });
  }
  isSourceConsentGenerationRevoked(consentGeneration: string): boolean {
    if (!validConsentGeneration(consentGeneration)) return true;
    this.reload();
    return this.file.revokedSourceConsentGenerations?.[consentGeneration] !== undefined;
  }
  bindNamespace(namespace: string) { this.withWriteLock(() => { if (this.path) this.file = this.load(); if (this.file.namespace && this.file.namespace !== namespace) throw new Error('Dayflow source namespace does not match its ledger; import is blocked.'); if (!this.file.namespace && Object.keys(this.file.entries).length) throw new Error('Dayflow ledger lacks its required source namespace; import is blocked.'); if (!this.file.namespace) { this.file.namespace = namespace; this.persist(); } }); }
  save(entry: LedgerEntry) { assertEntry(entry); this.withWriteLock(() => { if (this.path) this.file = this.load(); this.file.entries[entry.sourceId] = entry; this.persist(); }); }
  journalCreate(entry: LedgerEntry) {
    assertEntry(entry);
    this.withWriteLock(() => {
      if (this.path) this.file = this.load();
      const prior = this.file.entries[entry.sourceId];
      const history = prior && prior.revisionHash !== entry.revisionHash
        ? [...(prior.superseded ?? []), retiredRevision(prior)].slice(-MAX_SUPERSEDED_REVISIONS)
        : entry.superseded;
      const pending = {
        ...entry,
        ...(history && history.length > 0 ? { superseded: history } : {}),
        pendingCreateAt: new Date().toISOString(),
      };
      this.volatilePendingCreates.set(entry.sourceId, pending);
      this.file.entries[entry.sourceId] = pending;
      this.persist();
    });
  }
  tombstone(sourceId: string, at = new Date().toISOString()) { let changed = false; this.withWriteLock(() => { if (this.path) this.file = this.load(); const prior = this.get(sourceId); if (!prior) return; this.file.entries[sourceId] = withEligibility({ ...prior, tombstonedAt: at }, 'retracted'); this.persist(); changed = true; }); return changed; }
  markPendingDelete(sourceId: string, at = new Date().toISOString()) { this.withWriteLock(() => { if (this.path) this.file = this.load(); const prior = this.file.entries[sourceId]; if (!prior) return; this.file.entries[sourceId] = withEligibility({ ...prior, pendingDeleteAt: at }, 'pending_delete'); this.persist(); }); }
  completeDelete(sourceId: string) { this.withWriteLock(() => { if (this.path) this.file = this.load(); const prior = this.file.entries[sourceId]; if (!prior) return; this.file.entries[sourceId] = withEligibility({ ...prior, tombstonedAt: prior.tombstonedAt ?? new Date().toISOString(), pendingDeleteAt: undefined }, 'retracted'); this.persist(); }); }
  private reload() { if (this.path) this.file = this.load(); }
  private withWriteLock(write: () => void) {
    if (!this.path) return write();
    const lock = `${this.path}.lock`; mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    let fd: number;
    try { fd = this.acquireLock(lock); } catch { throw new Error('Dayflow ledger is busy; retry the operation.'); }
    try { write(); } finally { closeSync(fd!); try { unlinkSync(lock); } catch { /* recovery holds fail closed */ } }
  }
  private acquireLock(lock: string) {
    try { const fd = openSync(lock, 'wx', 0o600); writeFileSync(fd, `${process.pid}\n`, 'utf8'); return fd; }
    catch {
      // A dead owner or a lock older than 30 seconds cannot protect an active
      // transaction. The next acquisition is still exclusive (`wx`).
      try {
        const pid = Number.parseInt(readFileSync(lock, 'utf8').trim(), 10);
        let alive = Number.isInteger(pid) && pid > 0;
        if (alive) { try { process.kill(pid, 0); } catch (error) { alive = (error as NodeJS.ErrnoException).code !== 'ESRCH'; } }
        if (!alive) unlinkSync(lock);
      } catch { /* an active/unknown lock remains fail-closed */ }
      const fd = openSync(lock, 'wx', 0o600); writeFileSync(fd, `${process.pid}\n`, 'utf8'); return fd;
    }
  }
  private persist() {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, JSON.stringify(this.file, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, this.path);
    try { chmodSync(this.path, 0o600); } catch { /* non-posix */ }
  }
}
function validTime(value: unknown) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }

function validConsentGeneration(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value);
}

function validRevokedSourceConsents(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length <= MAX_REVOKED_SOURCE_CONSENTS &&
    entries.every(([generation, at]) => validConsentGeneration(generation) && validTime(at));
}

function validEntry(entry: LedgerEntry, history = false): boolean {
  if (
    typeof entry.sourceId !== 'string' ||
    typeof entry.revisionHash !== 'string' || !/^[a-f0-9]{64}$/.test(entry.revisionHash) ||
    typeof entry.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(entry.contentHash) ||
    (entry.exportVersion !== undefined && entry.exportVersion !== 'fixture-v1' && entry.exportVersion !== 'v2.6.0') ||
    typeof entry.memoryId !== 'string' || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(entry.memoryId) ||
    !validTime(entry.importedAt) ||
    (entry.operationId !== undefined && !/^[A-Za-z0-9_-]{16,128}$/.test(entry.operationId)) ||
    (entry.pendingCreateAt !== undefined && !validTime(entry.pendingCreateAt)) ||
    (entry.tombstonedAt !== undefined && !validTime(entry.tombstonedAt)) ||
    (entry.pendingDeleteAt !== undefined && !validTime(entry.pendingDeleteAt)) ||
    (entry.canonicalSourceKey !== undefined && !validCanonicalSourceKey(entry.canonicalSourceKey)) ||
    (history && (entry.tombstonedAt === undefined || entry.pendingCreateAt !== undefined || entry.pendingDeleteAt !== undefined)) ||
    (entry.superseded !== undefined && (
      !Array.isArray(entry.superseded) || entry.superseded.length > MAX_SUPERSEDED_REVISIONS ||
      entry.superseded.some((prior) => !validEntry(prior, true) || prior.superseded !== undefined)
    ))
  ) return false;
  if (entry.qualification === undefined) return true;
  try {
    parseDayflowQualifiedReceipt(entry.qualification);
    return true;
  } catch {
    return false;
  }
}

function assertEntry(entry: LedgerEntry): void {
  if (!validEntry(entry)) throw new Error('invalid Dayflow ledger entry');
}

function withEligibility(entry: LedgerEntry, eligibility: 'pending_delete' | 'retracted'): LedgerEntry {
  if (!entry.qualification) return entry;
  const qualification = parseDayflowQualifiedReceipt({
    ...entry.qualification,
    reference: { ...entry.qualification.reference, eligibility },
  });
  return { ...entry, qualification };
}

function retiredRevision(entry: LedgerEntry): LedgerEntry {
  const { superseded: _history, ...current } = entry;
  return withEligibility({
    ...current,
    pendingCreateAt: undefined,
    pendingDeleteAt: undefined,
    tombstonedAt: current.tombstonedAt ?? new Date().toISOString(),
  }, 'retracted');
}

function validCanonicalSourceKey(value: string): boolean {
  return /^(?:memory\/)?[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/.test(value) &&
    !value.includes('..') && !value.includes('//');
}
