import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface LedgerEntry { sourceId: string; revisionHash: string; memoryId: string; contentHash: string; importedAt: string; operationId?: string; pendingCreateAt?: string; tombstonedAt?: string; pendingDeleteAt?: string; }
interface LedgerFile { version: 1; namespace?: string; entries: Record<string, LedgerEntry>; }
const empty = (): LedgerFile => ({ version: 1, entries: {} });

/** Ledger contains opaque IDs and hashes only — never summaries or raw exports. */
export class MemoryLedger {
  private static volatilePendingCreates = new Map<string, LedgerEntry>();
  private file: LedgerFile;
  constructor(private readonly path?: string) { this.file = this.load(); }
  private load(): LedgerFile {
    if (!this.path || !existsSync(this.path)) return empty();
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as LedgerFile;
      if (parsed?.version !== 1 || !parsed.entries || typeof parsed.entries !== 'object' || Array.isArray(parsed.entries)) throw new Error('invalid schema');
      for (const [key, entry] of Object.entries(parsed.entries)) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('invalid entry');
        const e = entry as LedgerEntry;
        if (key !== e.sourceId || typeof e.sourceId !== 'string' || typeof e.revisionHash !== 'string' || !/^[a-f0-9]{64}$/.test(e.revisionHash) || typeof e.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(e.contentHash) || typeof e.memoryId !== 'string' || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(e.memoryId) || !validTime(e.importedAt) || (e.operationId !== undefined && !/^[A-Za-z0-9_-]{16,128}$/.test(e.operationId)) || (e.pendingCreateAt !== undefined && !validTime(e.pendingCreateAt)) || (e.tombstonedAt !== undefined && !validTime(e.tombstonedAt)) || (e.pendingDeleteAt !== undefined && !validTime(e.pendingDeleteAt))) throw new Error('invalid entry');
      }
      return parsed;
    }
    catch { throw new Error('Dayflow ledger is unreadable; import is blocked to preserve tombstones.'); }
  }
  get(sourceId: string) { this.reload(); return this.file.entries[sourceId] ?? MemoryLedger.volatilePendingCreates.get(sourceId); }
  entries() { this.reload(); return Object.values(this.file.entries); }
  hasOwnershipState() {
    this.reload();
    return Boolean(this.file.namespace) || Object.keys(this.file.entries).length > 0;
  }
  /** A source switch is unsafe only once cards, not merely a namespace, exist. */
  hasOwnedRecords() {
    this.reload();
    return Object.keys(this.file.entries).length > 0;
  }
  bindNamespace(namespace: string) { this.withWriteLock(() => { if (this.path) this.file = this.load(); if (this.file.namespace && this.file.namespace !== namespace) throw new Error('Dayflow source namespace does not match its ledger; import is blocked.'); if (!this.file.namespace && Object.keys(this.file.entries).length) throw new Error('Dayflow ledger lacks its required source namespace; import is blocked.'); if (!this.file.namespace) { this.file.namespace = namespace; this.persist(); } }); }
  save(entry: LedgerEntry) { this.withWriteLock(() => { if (this.path) this.file = this.load(); this.file.entries[entry.sourceId] = entry; this.persist(); }); }
  journalCreate(entry: LedgerEntry) { const pending = { ...entry, pendingCreateAt: new Date().toISOString() }; MemoryLedger.volatilePendingCreates.set(entry.sourceId, pending); this.withWriteLock(() => { if (this.path) this.file = this.load(); this.file.entries[entry.sourceId] = pending; this.persist(); }); }
  tombstone(sourceId: string, at = new Date().toISOString()) { let changed = false; this.withWriteLock(() => { if (this.path) this.file = this.load(); const prior = this.get(sourceId); if (!prior) return; this.file.entries[sourceId] = { ...prior, tombstonedAt: at }; this.persist(); changed = true; }); return changed; }
  markPendingDelete(sourceId: string, at = new Date().toISOString()) { this.withWriteLock(() => { if (this.path) this.file = this.load(); const prior = this.file.entries[sourceId]; if (!prior) return; this.file.entries[sourceId] = { ...prior, pendingDeleteAt: at }; this.persist(); }); }
  completeDelete(sourceId: string) { this.withWriteLock(() => { if (this.path) this.file = this.load(); const prior = this.file.entries[sourceId]; if (!prior) return; this.file.entries[sourceId] = { ...prior, tombstonedAt: prior.tombstonedAt ?? new Date().toISOString(), pendingDeleteAt: undefined }; this.persist(); }); }
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
