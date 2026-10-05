import { createHash, randomUUID } from 'node:crypto';
import { DayflowConfigStore } from './config_store';
import { freshDayflowConfig, validateDayflowConfig } from './config_validation';
import {
  deriveDayflowQualificationBinding,
  revokeDayflowSourceConsent,
} from './qualification_binding';
import { MemoryLedger, type LedgerEntry } from './ledger';
import { DayflowImportConflictError, type DayflowMemoryClient } from './memory_client';
import { normalizeFixtureExportDetailed } from './normalize';
import { verifyPinnedDayflowArtifact, type DayflowArtifactVerifier, type DayflowReadRequest, type QualifiedDayflowSnapshot, type VerifiedDayflowArtifact } from './cli_source';
import type { DayflowJournalVerifier, VerifiedDayflowJournal } from './sqlite_source';
import {
  dayflowCanonicalVersion,
  dayflowReaderBinding,
  parseDayflowQualificationScope,
  parseDayflowQualifiedReceipt,
  receiptMatchesCandidate,
  sameDayflowQualifiedEvidenceCandidate,
  type DayflowQualificationAuthority,
  type DayflowQualificationCandidate,
  type DayflowQualifiedEvidencePage,
  type DayflowQualifiedReferencePage,
} from '../../contracts/dayflow_coordinator_reader_contract';
import type { DayflowWorkstreamReferenceV1 } from '../../contracts/dayflow_workstream_reference_contract';
import type { CommitRequest, CommitResponse, ConfigPatch, DayflowPublicStatus, ForgetRequest, ForgetResponse, OwnedNotesPage, PreviewRequest, PreviewResponse, PublicDayflowConfig, SourceReadiness } from './public_contract';
import { contentFor, previewFor, sourceIdFor, stableMemoryId } from './plan';
import type { DayflowCandidate, DayflowConfig, DayflowPreview, DayflowSource } from './types';

/** This input is constructed only by the authenticated server route. */
export interface AuthenticatedDayflowSourceScope {
  ownerUserId: number;
  projectId: string;
  authorizingSessionId: string;
}

export interface DayflowQualifiedReadRequest {
  ownerUserId: number;
  projectId: string;
  limit?: number;
  cursor?: string;
}

/**
 * Opaque server-only proof captured from the actual qualified producer. It
 * never contains a source path, journal bytes, or receipt data. The reader
 * that issued it must recompute it synchronously before an adapter may expose
 * the associated page.
 */
export interface DayflowQualifiedEvidenceAdmission {
  schemaVersion: 1;
  fingerprint: string;
}

export interface DayflowQualifiedEvidenceAdmissionRead {
  page: DayflowQualifiedEvidencePage;
  admission: DayflowQualifiedEvidenceAdmission | null;
}

/**
 * The persisted authenticated-consent authority supplies this only from its
 * own current config and ledger fence. An async authority response, a caller
 * assertion, or an in-memory fallback is not an admission proof.
 */
interface DayflowSynchronousQualificationAuthority {
  currentSnapshot(input: {
    namespace: string;
    sourceInstance: string;
    configurationGeneration: string;
  }): ReturnType<typeof parseDayflowQualificationScope> | null;
}

type QualifiedEvidenceStateCandidate = {
  reference: DayflowWorkstreamReferenceV1;
  canonicalContentHash: string;
  contentHash: string;
  canonicalSourceKey: string;
  qualifiedAt: string;
};

export class DayflowIntegrationService {
  private config: DayflowConfig;
  private previews = new Map<string, DayflowPreview>();
  private readonly completedCommits = new Map<string, { selection: string; expiresAt: string; result: CommitResponse }>();
  private previewTimer?: ReturnType<typeof setTimeout>;
  private automaticImportTimer?: ReturnType<typeof setTimeout>;
  private commitQueue = Promise.resolve();
  /** Every active source read is owned so disable/config/shutdown can abort it. */
  private readonly readerControllers = new Set<AbortController>();
  /** Server-lifetime opaque pagination cursors, bound to a ledger revision. */
  private readonly ownedCursors = new Map<string, { offset: number; revision: string }>();
  /** Separate, scope-bound cursors for the server-only qualified reader. */
  private readonly qualifiedCursors = new Map<string, { offset: number; revision: string; validUntil: number }>();
  /** Private attestation state; it is never projected into public DTOs. */
  private checkedArtifact?: VerifiedDayflowArtifact;
  private appliedArtifact?: VerifiedDayflowArtifact;
  /** First-party journal bindings are private; public DTOs expose a label only. */
  private checkedJournal?: VerifiedDayflowJournal;
  private appliedJournal?: VerifiedDayflowJournal;
  /** A failed native revalidation is sticky until a newly verified selection
   * is explicitly applied.  The old in-memory source must never reauthorize
   * existing receipts after its backing journal has changed. */
  private readerSourceInvalidated = false;
  private source: DayflowSource;
  private generation = 0;
  /** Terminal shutdown is stricter than Disable: no follow-on work may persist. */
  private disposed = false;
  /** A consent change whose durable config mutation is in progress or failed.
   * The ledger fence makes this survive restart; this field closes in-flight
   * readers immediately in the current process. */
  private sourceConsentFenceUnsafe = false;
  constructor(private readonly deps: { source: DayflowSource; memoryClient: DayflowMemoryClient; ledger?: MemoryLedger; configStore?: DayflowConfigStore; now?: () => number; artifactVerifier?: DayflowArtifactVerifier; sourceForArtifact?: (artifact: VerifiedDayflowArtifact) => DayflowSource; journalVerifier?: DayflowJournalVerifier; sourceForJournal?: (journal: VerifiedDayflowJournal) => DayflowSource; qualificationAuthority?: DayflowQualificationAuthority }) {
    this.source = deps.source;
    const persisted = deps.configStore?.readWithState();
    this.config = persisted?.config ?? freshDayflowConfig();
    // Namespace generation is durable state.  A newly generated namespace must
    // be stored before the ledger claims it; an orphaned ledger refuses a new
    // config rather than silently rebinding existing ownership.
    if (persisted && !persisted.persisted) {
      if (deps.ledger?.hasOwnershipState()) {
        throw new Error('Dayflow configuration is missing while its ownership ledger exists; import is blocked.');
      }
      deps.configStore?.write(this.config);
    }
    deps.ledger?.bindNamespace(this.config.sourceNamespace);
    // Revalidate a persisted selection before exposing it after restart. This
    // inspects only SQLite metadata/schema; it never reads activity rows.
    if (this.config.journalPath && this.config.journalBinding && deps.journalVerifier && deps.sourceForJournal) {
      try {
        const revalidated = deps.journalVerifier.verify(this.config.journalPath);
        if (this.matchesPersistedJournalBinding(revalidated)) {
          this.appliedJournal = revalidated;
          this.source = deps.sourceForJournal(revalidated);
        }
      } catch {
        this.appliedJournal = undefined;
      }
    }
    this.scheduleAutomaticImport();
  }
  private internalStatus() { this.purgeExpiredPreviews(); const entries = this.deps.ledger?.entries() ?? []; return { enabled: this.config.enabled, automaticImport: this.config.automaticImport, sourceVersion: this.config.sourceVersion, timezone: this.config.timezone, importedCount: entries.filter((e) => !e.tombstonedAt && !e.pendingCreateAt && !e.pendingDeleteAt).length, pendingCreateCount: entries.filter((e) => e.pendingCreateAt).length, pendingDeleteCount: entries.filter((e) => e.pendingDeleteAt).length }; }
  status(): DayflowPublicStatus { const status = this.internalStatus(); const readiness = this.readiness(); return { enabled: status.enabled, automaticImport: status.automaticImport, readiness, canPreview: status.enabled && readiness.state === 'ready' && !!this.config.timezone, importedCount: status.importedCount, pendingCreateCount: status.pendingCreateCount, pendingDeleteCount: status.pendingDeleteCount }; }
  publicStatus(): DayflowPublicStatus { return this.status(); }
  readiness(): SourceReadiness {
    const source = this.source as DayflowSource & { hasVerifiedBinding?: () => boolean };
    if (this.checkedJournal || this.appliedJournal) {
      return { state: 'ready', source: { label: 'Dayflow journal', version: '2.6.0', build: '133' }, code: null };
    }
    if (this.checkedArtifact || this.appliedArtifact || source.hasVerifiedBinding?.() === true) {
      return { state: 'ready', source: { label: 'Dayflow', version: '2.6.0', build: '133' }, code: null };
    }
    return this.config.journalPath
      ? { state: 'missing', source: null, code: 'SOURCE_MISSING' }
      : { state: 'unconfigured', source: null, code: 'SOURCE_UNVERIFIED' };
  }
  /** Metadata/schema verification only: it neither reads activity nor runs a helper. */
  async checkReadiness(input: { bundlePath: string }): Promise<SourceReadiness> {
    this.assertOperational();
    if (this.deps.journalVerifier) {
      try {
        this.checkedJournal = this.deps.journalVerifier.verify(input.bundlePath);
        this.checkedArtifact = undefined;
        return this.readiness();
      } catch {
        this.checkedJournal = undefined;
        return { state: 'unverified', source: null, code: 'SOURCE_UNVERIFIED' };
      }
    }
    if (!this.deps.artifactVerifier) return { state: 'unconfigured', source: null, code: 'SOURCE_UNVERIFIED' };
    try { this.checkedArtifact = await verifyPinnedDayflowArtifact(input.bundlePath, this.deps.artifactVerifier); return this.readiness(); }
    catch { this.checkedArtifact = undefined; return { state: 'unverified', source: null, code: 'SOURCE_UNVERIFIED' }; }
  }
  /** Opaque-to-client digest used only by the management adapter's token map. */
  selectionFingerprint(): string | undefined {
    const journal = this.checkedJournal ?? this.appliedJournal;
    if (journal) return this.journalFingerprint(journal);
    const artifact = this.checkedArtifact ?? this.appliedArtifact;
    return artifact ? this.fingerprint(artifact) : undefined;
  }
  hasPersistedSelection(): boolean { return Boolean(this.appliedArtifact || this.appliedJournal); }
  /** Reject a different journal before the adapter mutates its saved config. */
  assertSelectionMayBeApplied(fingerprint: string): void {
    this.assertOperational();
    if (!this.checkedJournal) return;
    if (!this.deps.journalVerifier || this.selectionFingerprint() !== fingerprint) throw new Error('SOURCE_CHANGED');
    const revalidated = this.deps.journalVerifier.verify(this.checkedJournal.canonicalPath);
    if (this.journalFingerprint(revalidated) !== fingerprint) throw new Error('SOURCE_CHANGED');
    if (!this.matchesPersistedJournalBinding(revalidated) && this.deps.ledger?.hasOwnedRecords()) {
      throw new Error('SOURCE_CHANGED');
    }
  }
  async applyVerifiedSelection(fingerprint: string): Promise<void> {
    if (this.checkedJournal) {
      this.assertSelectionMayBeApplied(fingerprint);
      if (!this.deps.journalVerifier || !this.deps.sourceForJournal || this.selectionFingerprint() !== fingerprint) throw new Error('SOURCE_CHANGED');
      const revalidated = this.deps.journalVerifier.verify(this.checkedJournal.canonicalPath);
      if (this.journalFingerprint(revalidated) !== fingerprint) throw new Error('SOURCE_CHANGED');
      // A selected path is consent for this exact SQLite identity and schema.
      // New selection always requires a separate, explicit enable and auto opt-in.
      const next = validateDayflowConfig({
        ...this.config,
        enabled: false,
        automaticImport: false,
        qualificationGeneration: randomUUID(),
        sourceConsent: revokeDayflowSourceConsent(this.config.sourceConsent, new Date((this.deps.now ?? Date.now)()).toISOString()),
        journalPath: revalidated.canonicalPath,
        journalBinding: {
          fileIdentity: revalidated.fileIdentity,
          schemaFingerprint: revalidated.schemaFingerprint,
        },
      });
      const fenced = this.fenceActiveSourceConsent(new Date((this.deps.now ?? Date.now)()).toISOString());
      try { this.deps.configStore?.write(next); }
      catch { this.sourceConsentFenceUnsafe = true; throw new Error('SOURCE_CONSENT_PERSISTENCE_FAILED'); }
      if (!fenced) { this.generation++; this.abortActiveReaders(); this.stopAutomaticImport(); }
      this.config = next;
      this.appliedJournal = revalidated;
      this.checkedJournal = undefined;
      this.source = this.deps.sourceForJournal(revalidated);
      this.readerSourceInvalidated = false;
      this.qualifiedCursors.clear();
      return;
    }
    if (!this.checkedArtifact || this.selectionFingerprint() !== fingerprint || !this.deps.artifactVerifier || !this.deps.sourceForArtifact) throw new Error('SOURCE_CHANGED');
    const revalidated = await verifyPinnedDayflowArtifact(this.checkedArtifact.canonicalPath, this.deps.artifactVerifier);
    if (this.fingerprint(revalidated) !== fingerprint) throw new Error('SOURCE_CHANGED');
    this.appliedArtifact = revalidated; this.checkedArtifact = undefined;
    this.source = this.deps.sourceForArtifact(revalidated);
    this.readerSourceInvalidated = false;
    this.qualifiedCursors.clear();
  }
  async revalidateAppliedSelection(): Promise<void> {
    if (this.appliedJournal) {
      this.revalidateAppliedJournalSelectionNow();
      return;
    }
    if (!this.appliedArtifact || !this.deps.artifactVerifier) throw new Error('SOURCE_UNVERIFIED');
    const revalidated = await verifyPinnedDayflowArtifact(this.appliedArtifact.canonicalPath, this.deps.artifactVerifier);
    if (this.fingerprint(revalidated) !== this.fingerprint(this.appliedArtifact)) {
      this.appliedArtifact = undefined;
      this.readerSourceInvalidated = true;
      throw new Error('SOURCE_CHANGED');
    }
  }
  /** The qualified reader is journal-only. Its last post-authority check must
   * be synchronous: a journal identity change while `authority.current()` was
   * awaited cannot be closed by another asynchronous revalidation. */
  private revalidateAppliedJournalSelectionNow(): void {
    if (!this.appliedJournal || !this.deps.journalVerifier) throw new Error('SOURCE_UNVERIFIED');
    try {
      const applied = this.appliedJournal;
      const revalidated = this.deps.journalVerifier.verify(applied.canonicalPath);
      if (this.journalFingerprint(revalidated) !== this.journalFingerprint(applied) || !this.matchesPersistedJournalBinding(revalidated)) throw new Error('SOURCE_CHANGED');
      this.appliedJournal = revalidated;
    } catch {
      this.appliedJournal = undefined;
      this.readerSourceInvalidated = true;
      throw new Error('SOURCE_CHANGED');
    }
  }
  /** A create-only receipt or qualification response is not durable evidence
   * until the live native selection and (when present) consent scope survive
   * its await boundary. Leaving the journaled create pending is safer than
   * claiming a completed import for a source that changed underneath it. */
  private async producerStillCurrent(
    generation: number,
    qualification?: ReturnType<typeof parseDayflowQualifiedReceipt>,
  ): Promise<boolean> {
    if (!this.isCurrentGeneration(generation) || this.readerSourceInvalidated) return false;
    if (this.appliedJournal || this.appliedArtifact) {
      try { await this.revalidateAppliedSelection(); }
      catch { return false; }
    }
    if (!this.isCurrentGeneration(generation) || this.readerSourceInvalidated) return false;
    if (!qualification) return true;
    const preparation = this.qualifiedReaderPreparation();
    if (!preparation) return false;
    try {
      const current = await this.deps.qualificationAuthority!.current({
        namespace: preparation.namespace,
        sourceInstance: preparation.sourceInstance,
        configurationGeneration: preparation.configurationGeneration,
      });
      if (!current || !this.qualifiedReaderStillCurrent(preparation, generation)) return false;
      const scope = parseDayflowQualificationScope(current);
      // The authority await is followed by a final native revalidation. A
      // source identity can change without changing config generation.
      try { await this.revalidateAppliedSelection(); }
      catch { return false; }
      if (!this.qualifiedReaderStillCurrent(preparation, generation)) return false;
      // Nothing may await after this final authority response. Otherwise a
      // revoke/scope rotation during a later revalidation could persist an
      // already-invalid receipt.
      const finalCurrent = await this.deps.qualificationAuthority!.current({
        namespace: preparation.namespace,
        sourceInstance: preparation.sourceInstance,
        configurationGeneration: preparation.configurationGeneration,
      });
      if (!finalCurrent || !this.qualifiedReaderStillCurrent(preparation, generation)) return false;
      const finalScope = parseDayflowQualificationScope(finalCurrent);
      if (!sameQualificationScope(scope, finalScope)) return false;
      try { this.revalidateAppliedJournalSelectionNow(); }
      catch { return false; }
      if (!this.qualifiedReaderStillCurrent(preparation, generation)) return false;
      const reference = qualification.reference;
      return reference.ownerUserId === finalScope.ownerUserId &&
        reference.projectId === finalScope.projectId &&
        reference.namespace === finalScope.namespace &&
        reference.sourceInstance === finalScope.sourceInstance &&
        reference.consentGeneration === finalScope.consentGeneration &&
        reference.configurationGeneration === finalScope.configurationGeneration;
    } catch { return false; }
  }
  async previewDate(date: string) { this.assertOperational(); if (!isCalendarDay(date)) throw new Error('INVALID_REQUEST'); return this.createPreview(date); }
  listOwned(limit = 25, cursor?: string) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (cursor !== undefined && (cursor.length === 0 || cursor.length > 256))) throw new Error('CURSOR_INVALID');
    let entries;
    try { entries = (this.deps.ledger?.entries() ?? []).filter((entry) => !entry.tombstonedAt).sort((a,b) => b.importedAt.localeCompare(a.importedAt) || b.memoryId.localeCompare(a.memoryId)); }
    catch { throw new Error('LEDGER_UNAVAILABLE'); }
    const revision = createHash('sha256').update(JSON.stringify(entries.map(({ sourceId, revisionHash, memoryId, importedAt, pendingCreateAt, pendingDeleteAt, tombstonedAt }) => ({ sourceId, revisionHash, memoryId, importedAt, pendingCreateAt, pendingDeleteAt, tombstonedAt })))).digest('hex');
    let start = 0;
    if (cursor) { const binding = this.ownedCursors.get(cursor); if (!binding) throw new Error('CURSOR_INVALID'); if (binding.revision !== revision) throw new Error('CURSOR_STALE'); start = binding.offset; }
    const items = entries.slice(start, start + limit).map((entry) => ({ memoryId: entry.memoryId, importedAt: entry.importedAt, state: entry.pendingDeleteAt ? 'pending_delete' as const : entry.pendingCreateAt ? 'pending_create' as const : 'imported' as const }));
    const offset = start + items.length; const nextCursor = offset < entries.length ? randomUUID() : null;
    if (nextCursor) this.ownedCursors.set(nextCursor, { offset, revision });
    return { items, nextCursor, total: entries.length };
  }
  /**
   * Server-only metadata reader.  It never reads a Dayflow export, a journal,
   * or generic memory search; it admits only receipts created by the
   * authenticated qualification boundary.
   */
  async readQualifiedReferences(input: DayflowQualifiedReadRequest): Promise<DayflowQualifiedReferencePage> {
    const page = await this.readQualifiedEvidence(input);
    return {
      schemaVersion: 1,
      status: page.status,
      references: page.references,
      nextCursor: page.nextCursor,
    };
  }
  /** Internal companion used only by the Dayflow evidence adapter. */
  async readQualifiedEvidence(input: DayflowQualifiedReadRequest): Promise<DayflowQualifiedEvidencePage> {
    if (!Number.isSafeInteger(input.ownerUserId) || input.ownerUserId <= 0 || !isReaderId(input.projectId) ||
        (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 3000)) ||
        (input.cursor !== undefined && (input.cursor.length === 0 || input.cursor.length > 256))) {
      return unavailableQualifiedPage();
    }
    if (this.disposed || this.readerSourceInvalidated) return unavailableQualifiedPage();
    if (!this.config.enabled || !this.config.automaticImport) return notConfiguredQualifiedPage();
    const preparation = this.qualifiedReaderPreparation();
    // Once an operator has opted in, missing native revalidation, consent
    // wiring, ledger, or source metadata is an incomplete read -- never an
    // authoritative claim that there is simply no eligible activity.
    if (!preparation) return unavailableQualifiedPage();
    const readerGeneration = this.generation;
    let scope: ReturnType<typeof parseDayflowQualificationScope> | null = null;
    try {
      const current = await this.deps.qualificationAuthority!.current({
        namespace: preparation.namespace,
        sourceInstance: preparation.sourceInstance,
        configurationGeneration: preparation.configurationGeneration,
      });
      // A revocation/no-scope result is only not-configured if the exact read
      // scope is still current.  A mutation while this await was pending is
      // incomplete, not an authoritative empty scope.
      if (!this.qualifiedReaderStillCurrent(preparation, readerGeneration)) return unavailableQualifiedPage();
      if (!current) return notConfiguredQualifiedPage();
      scope = parseDayflowQualificationScope(current);
    } catch {
      return unavailableQualifiedPage();
    }
    if (!scope) return unavailableQualifiedPage();
    // An authority response cannot authorize a state that changed while it
    // was awaited. Revalidate the selected native source metadata as well:
    // a journal replacement can retain the config shape while changing the
    // actual source identity.
    if (!this.qualifiedReaderStillCurrent(preparation, readerGeneration)) return unavailableQualifiedPage();
    if (this.appliedJournal || this.appliedArtifact) {
      try { await this.revalidateAppliedSelection(); }
      catch { return unavailableQualifiedPage(); }
      if (!this.qualifiedReaderStillCurrent(preparation, readerGeneration)) return unavailableQualifiedPage();
      try {
        const refreshed = await this.deps.qualificationAuthority!.current({
          namespace: preparation.namespace,
          sourceInstance: preparation.sourceInstance,
          configurationGeneration: preparation.configurationGeneration,
        });
        // A read that began configured but loses or changes its authenticated
        // scope during source revalidation is unavailable, never a newly
        // authoritative not-configured/empty result.
        if (!refreshed) return unavailableQualifiedPage();
        const currentScope = parseDayflowQualificationScope(refreshed);
        if (!sameQualificationScope(currentScope, scope)) return unavailableQualifiedPage();
      } catch {
        return unavailableQualifiedPage();
      }
      if (!this.qualifiedReaderStillCurrent(preparation, readerGeneration)) return unavailableQualifiedPage();
      // The second authority await is a distinct race boundary. Recheck the
      // native journal once more before allowing the receipt scan to expose
      // data; a path can retain its saved config shape while its identity
      // changes between the two authority calls.
      try { await this.revalidateAppliedSelection(); }
      catch { return unavailableQualifiedPage(); }
      if (!this.qualifiedReaderStillCurrent(preparation, readerGeneration)) return unavailableQualifiedPage();
      // Keep the authority read last: a revoke that happens while this final
      // native revalidation awaits must not authorize the already-fetched
      // ledger scan. There is no further await after this response.
      try {
        const finalCurrent = await this.deps.qualificationAuthority!.current({
          namespace: preparation.namespace,
          sourceInstance: preparation.sourceInstance,
          configurationGeneration: preparation.configurationGeneration,
        });
        if (!finalCurrent || !this.qualifiedReaderStillCurrent(preparation, readerGeneration)) return unavailableQualifiedPage();
        const finalScope = parseDayflowQualificationScope(finalCurrent);
        if (!sameQualificationScope(finalScope, scope)) return unavailableQualifiedPage();
        scope = finalScope;
      } catch {
        return unavailableQualifiedPage();
      }
      try { this.revalidateAppliedJournalSelectionNow(); }
      catch { return unavailableQualifiedPage(); }
      if (!this.qualifiedReaderStillCurrent(preparation, readerGeneration)) return unavailableQualifiedPage();
    }
    if (
      scope.namespace !== preparation.namespace ||
      scope.sourceInstance !== preparation.sourceInstance ||
      scope.configurationGeneration !== preparation.configurationGeneration ||
      scope.ownerUserId !== input.ownerUserId ||
      scope.projectId !== input.projectId
    ) return unavailableQualifiedPage();

    return this.qualifiedEvidenceStateNow(input, scope, preparation)?.page ?? unavailableQualifiedPage();
  }
  /**
   * The evidence adapter uses this stricter internal read. It issues an
   * opaque admission only after the normal asynchronous producer read has
   * completed and the same source state can be recomputed synchronously.
   * Public Dayflow reference reads deliberately do not receive this token.
   */
  async readQualifiedEvidenceWithAdmission(
    input: DayflowQualifiedReadRequest,
  ): Promise<DayflowQualifiedEvidenceAdmissionRead> {
    const page = await this.readQualifiedEvidence(input);
    return { page, admission: this.captureQualifiedEvidenceAdmission(input, page) };
  }

  /**
   * A final adapter fence must call this after its last receiver await. This
   * re-reads the real service generation, journal identity, persisted consent
   * scope, and complete qualified ledger selection synchronously. It neither
   * trusts a caller-supplied page nor falls back to an earlier async scope.
   */
  isQualifiedEvidenceAdmissionCurrent(
    input: DayflowQualifiedReadRequest,
    page: DayflowQualifiedEvidencePage,
    admission: DayflowQualifiedEvidenceAdmission,
  ): boolean {
    if (!admission || admission.schemaVersion !== 1 ||
        typeof admission.fingerprint !== 'string' || admission.fingerprint.length === 0) return false;
    const current = this.captureQualifiedEvidenceAdmission(input, page);
    return current?.fingerprint === admission.fingerprint;
  }

  private captureQualifiedEvidenceAdmission(
    input: DayflowQualifiedReadRequest,
    page: DayflowQualifiedEvidencePage,
  ): DayflowQualifiedEvidenceAdmission | null {
    // The evidence adapter intentionally asks for the full bounded qualified
    // set. A cursor or a smaller page would not prove that the final selected
    // candidates remain the complete current ledger selection.
    if (input.limit !== 3000 || input.cursor !== undefined ||
        page.schemaVersion !== 1 || page.status === 'unavailable' ||
        this.disposed || this.readerSourceInvalidated || this.sourceConsentFenceUnsafe) return null;
    const generation = this.generation;
    if (page.status === 'not_configured') {
      // Disabled automatic import is a source-owned not-configured state. Its
      // complete config is committed only into an opaque server-side hash.
      if (!this.config.enabled || !this.config.automaticImport) {
        return this.admissionFor({ input, page, generation, configured: false });
      }
      const preparation = this.qualifiedReaderPreparation();
      if (!preparation || !this.qualifiedReaderStillCurrent(preparation, generation)) return null;
      const snapshot = this.currentQualificationScopeSnapshot(preparation);
      // A live scope means the page cannot honestly remain not-configured;
      // lack of the concrete synchronous authority is likewise unavailable.
      if (!snapshot.supported || snapshot.scope) return null;
      try { this.revalidateAppliedJournalSelectionNow(); }
      catch { return null; }
      if (!this.qualifiedReaderStillCurrent(preparation, generation)) return null;
      return this.admissionFor({ input, page, generation, preparation, configured: true });
    }

    if (page.status !== 'available') return null;
    const preparation = this.qualifiedReaderPreparation();
    if (!preparation || !this.qualifiedReaderStillCurrent(preparation, generation)) return null;
    const snapshot = this.currentQualificationScopeSnapshot(preparation);
    if (!snapshot.supported || !snapshot.scope ||
        snapshot.scope.ownerUserId !== input.ownerUserId || snapshot.scope.projectId !== input.projectId) return null;
    try { this.revalidateAppliedJournalSelectionNow(); }
    catch { return null; }
    if (!this.qualifiedReaderStillCurrent(preparation, generation)) return null;
    const state = this.qualifiedEvidenceStateNow(input, snapshot.scope, preparation);
    if (!state || !sameQualifiedEvidencePage(state.page, page)) return null;
    return this.admissionFor({
      input,
      page,
      generation,
      preparation,
      scope: snapshot.scope,
      revision: state.revision,
      configured: true,
    });
  }

  private currentQualificationScopeSnapshot(
    preparation: { namespace: string; sourceInstance: string; configurationGeneration: string },
  ): { supported: boolean; scope: ReturnType<typeof parseDayflowQualificationScope> | null } {
    const authority = this.deps.qualificationAuthority as (DayflowQualificationAuthority &
      Partial<DayflowSynchronousQualificationAuthority>) | undefined;
    if (!authority || typeof authority.currentSnapshot !== 'function') return { supported: false, scope: null };
    try {
      const scope = authority.currentSnapshot(preparation);
      return { supported: true, scope: scope ? parseDayflowQualificationScope(scope) : null };
    } catch {
      return { supported: true, scope: null };
    }
  }

  private admissionFor(value: {
    input: DayflowQualifiedReadRequest;
    page: DayflowQualifiedEvidencePage;
    generation: number;
    preparation?: { namespace: string; sourceInstance: string; configurationGeneration: string };
    scope?: ReturnType<typeof parseDayflowQualificationScope>;
    revision?: string;
    configured: boolean;
  }): DayflowQualifiedEvidenceAdmission {
    return {
      schemaVersion: 1,
      // Hashing the complete local configuration is intentional: it detects
      // any config edit without exposing a source path or consent record.
      fingerprint: dayflowReaderBinding({
        schemaVersion: 1,
        input: { ownerUserId: value.input.ownerUserId, projectId: value.input.projectId, limit: value.input.limit },
        page: qualifiedEvidencePageBinding(value.page),
        generation: value.generation,
        configured: value.configured,
        configuration: this.config,
        preparation: value.preparation,
        scope: value.scope,
        revision: value.revision,
      }),
    };
  }

  /** Synchronous counterpart to the final section of readQualifiedEvidence. */
  private qualifiedEvidenceStateNow(
    input: DayflowQualifiedReadRequest,
    scope: ReturnType<typeof parseDayflowQualificationScope>,
    preparation: { namespace: string; sourceInstance: string; configurationGeneration: string },
  ): { page: DayflowQualifiedEvidencePage; revision: string } | null {
    let entries: LedgerEntry[];
    try { entries = this.deps.ledger!.entries(); }
    catch { return null; }
    const now = (this.deps.now ?? Date.now)();
    const candidates = new Map<string, QualifiedEvidenceStateCandidate>();
    for (const entry of entries) {
      // A completed retraction is safe historical state. A pending write or
      // delete is not: it may be the current scope changing underneath this
      // read, so it cannot be silently converted into an empty result.
      if (entry.tombstonedAt) continue;
      if (!entry.qualification) return null;
      let receipt;
      try { receipt = parseDayflowQualifiedReceipt(entry.qualification); }
      catch { return null; }
      if (entry.pendingCreateAt || entry.pendingDeleteAt) {
        if (this.receiptCouldBelongToCurrentScope(receipt.reference, scope, preparation)) return null;
        continue;
      }
      if (!this.receiptMatchesLedgerEntry(receipt, entry, preparation)) return null;
      const reference = receipt.reference;
      // A foreign receipt is never a reason to expose or reject the current
      // actor's complete scope; it is simply not part of this scope.
      if (reference.ownerUserId !== scope.ownerUserId || reference.projectId !== scope.projectId) continue;
      if (
        reference.namespace !== scope.namespace ||
        reference.sourceInstance !== scope.sourceInstance ||
        reference.consentGeneration !== scope.consentGeneration ||
        reference.configurationGeneration !== scope.configurationGeneration ||
        reference.eligibility !== 'active' ||
        Date.parse(reference.expiresAt) <= now
      ) continue;
      const existing = candidates.get(reference.canonicalId);
      const candidate: QualifiedEvidenceStateCandidate = {
        reference,
        canonicalContentHash: receipt.canonicalContentHash,
        contentHash: entry.contentHash,
        canonicalSourceKey: entry.canonicalSourceKey!,
        qualifiedAt: receipt.qualifiedAt,
      };
      if (
        existing &&
        existing.reference.observedEnd === candidate.reference.observedEnd &&
        existing.qualifiedAt === candidate.qualifiedAt &&
        (existing.reference.canonicalVersion !== candidate.reference.canonicalVersion ||
          existing.canonicalContentHash !== candidate.canonicalContentHash)
      ) return null;
      if (!existing || isNewerQualifiedCandidate(candidate, existing)) candidates.set(reference.canonicalId, candidate);
    }
    const ordered = [...candidates.values()].sort((left, right) =>
      right.reference.observedEnd.localeCompare(left.reference.observedEnd) ||
      right.qualifiedAt.localeCompare(left.qualifiedAt) ||
      right.reference.canonicalId.localeCompare(left.reference.canonicalId),
    );
    const revision = dayflowReaderBinding({
      scope,
      configurationGeneration: preparation.configurationGeneration,
      candidates: ordered.map(({ reference, canonicalContentHash, contentHash, canonicalSourceKey, qualifiedAt }) => ({
        reference, canonicalContentHash, contentHash, canonicalSourceKey, qualifiedAt,
      })),
    });
    let start = 0;
    if (input.cursor) {
      const cursor = this.qualifiedCursors.get(input.cursor);
      if (!cursor || cursor.revision !== revision || cursor.validUntil <= now) return null;
      start = cursor.offset;
    }
    const limit = input.limit ?? 100;
    const selected = ordered.slice(start, start + limit);
    const offset = start + selected.length;
    const nextCursor = offset < ordered.length ? randomUUID() : null;
    if (nextCursor) {
      const validUntil = Math.min(...ordered.map(({ reference }) => Date.parse(reference.expiresAt)));
      this.qualifiedCursors.set(nextCursor, { offset, revision, validUntil });
    }
    return {
      revision,
      page: {
        schemaVersion: 1,
        status: 'available',
        references: selected.map(({ reference }) => reference),
        candidates: selected.map(({ reference, canonicalContentHash, contentHash, canonicalSourceKey }) => ({ reference, canonicalContentHash, contentHash, canonicalSourceKey })),
        nextCursor,
      },
    };
  }
  /** The existing importer owns this bounded current-plus-two-prior-day window. */
  isReferenceWithinAutomaticWindow(reference: { observedStart: string; namespace: string; sourceInstance: string; configurationGeneration: string }): boolean {
    if (this.readerSourceInvalidated) return false;
    const preparation = this.qualifiedReaderPreparation();
    if (!preparation || !this.config.timezone ||
        reference.namespace !== preparation.namespace ||
        reference.sourceInstance !== preparation.sourceInstance ||
        reference.configurationGeneration !== preparation.configurationGeneration) return false;
    const activityDay = this.activityDayForTimestamp(reference.observedStart, this.config.timezone);
    return activityDay !== null && this.automaticScanDays(this.config.timezone).includes(activityDay);
  }
  privateConfig() { return structuredClone(this.config); }
  /**
   * Explicit authenticated consent is separate from local source selection.
   * This method deliberately accepts no source, namespace, generation, or
   * canonical fields: all bindings are derived from current persisted config.
   */
  grantAuthenticatedSourceConsent(scope: AuthenticatedDayflowSourceScope): void {
    this.assertOperational();
    if (!Number.isSafeInteger(scope.ownerUserId) || scope.ownerUserId <= 0 ||
        !isReaderId(scope.projectId) || !isReaderId(scope.authorizingSessionId)) {
      throw new Error('INVALID_REQUEST');
    }
    const binding = deriveDayflowQualificationBinding(this.config);
    if (!binding || this.readiness().state !== 'ready' || this.readerSourceInvalidated) {
      throw new Error('SOURCE_UNVERIFIED');
    }
    if (!this.deps.ledger) throw new Error('SOURCE_UNVERIFIED');
    const prior = this.config.sourceConsent;
    const priorIsLive = !!prior && prior.revokedAt === undefined && !this.sourceConsentFenceUnsafe &&
      !this.deps.ledger.isSourceConsentGenerationRevoked(prior.consentGeneration);
    if (priorIsLive && prior &&
        (prior.ownerUserId !== scope.ownerUserId || prior.projectId !== scope.projectId)) {
      throw new Error('INVALID_REQUEST');
    }
    if (priorIsLive) return;
    const now = new Date((this.deps.now ?? Date.now)()).toISOString();
    const next = validateDayflowConfig({
      ...this.config,
      sourceConsent: {
        schemaVersion: 1,
        ownerUserId: scope.ownerUserId,
        projectId: scope.projectId,
        authorizingSessionId: scope.authorizingSessionId,
        namespace: binding.namespace,
        sourceInstance: binding.sourceInstance,
        configurationGeneration: binding.configurationGeneration,
        consentGeneration: randomUUID(),
        grantedAt: now,
      },
    });
    try { this.deps.configStore?.write(next); }
    catch { this.sourceConsentFenceUnsafe = true; throw new Error('SOURCE_CONSENT_PERSISTENCE_FAILED'); }
    this.abortActiveReaders();
    this.generation++;
    this.qualifiedCursors.clear();
    this.config = next;
    this.sourceConsentFenceUnsafe = false;
    this.scheduleAutomaticImport();
  }
  revokeAuthenticatedSourceConsent(scope: AuthenticatedDayflowSourceScope): void {
    this.assertOperational();
    const current = this.config.sourceConsent;
    if (!current || current.ownerUserId !== scope.ownerUserId ||
        current.projectId !== scope.projectId) {
      throw new Error('INVALID_REQUEST');
    }
    this.fenceActiveSourceConsent(new Date((this.deps.now ?? Date.now)()).toISOString());
    const next = validateDayflowConfig({
      ...this.config,
      sourceConsent: revokeDayflowSourceConsent(
        current,
        new Date((this.deps.now ?? Date.now)()).toISOString(),
      ),
    });
    try { this.deps.configStore?.write(next); }
    catch { this.sourceConsentFenceUnsafe = true; throw new Error('SOURCE_CONSENT_PERSISTENCE_FAILED'); }
    this.config = next;
  }
  getConfig(): PublicDayflowConfig { const readiness = this.readiness(); return { enabled: this.config.enabled, automaticImport: this.config.automaticImport, timezone: this.config.timezone, rolloverHour: 4, exclusions: [...this.config.exclusions], maxRecordsPerRun: this.config.maxRecordsPerRun, source: readiness.source }; }
  async updateConfig(patch: ConfigPatch | Partial<DayflowConfig>): Promise<PublicDayflowConfig> {
    this.assertOperational();
    const allowed = new Set(['enabled', 'automaticImport', 'executablePath', 'sourceVersion', 'timezone', 'exclusions', 'retentionDays', 'maxRecordsPerRun']);
    if (Object.keys(patch).some((key) => !allowed.has(key))) throw new Error('Dayflow configuration contains an unsupported field.');
    const boundSource = this.source as DayflowSource & { hasVerifiedBinding?: () => boolean };
    const next = validateDayflowConfig({
      ...this.config,
      ...patch,
      schemaVersion: 1,
      rolloverHour: 4,
      qualificationGeneration: randomUUID(),
      sourceConsent: revokeDayflowSourceConsent(this.config.sourceConsent, new Date((this.deps.now ?? Date.now)()).toISOString()),
    });
    const sourceReady = Boolean(this.appliedArtifact || this.appliedJournal || typeof boundSource.hasVerifiedBinding !== 'function' || boundSource.hasVerifiedBinding());
    if (next.enabled && !sourceReady) throw new Error('SOURCE_UNVERIFIED');
    if (next.automaticImport && (!next.enabled || !next.timezone || !sourceReady)) throw new Error('SOURCE_UNVERIFIED');
    // A result obtained under the old configuration must never become a
    // preview after a successfully validated privacy/source settings change.
    // Invalid config attempts intentionally leave the valid preview intact.
    const fenced = this.fenceActiveSourceConsent(new Date((this.deps.now ?? Date.now)()).toISOString());
    try { this.deps.configStore?.write(next); }
    catch { this.sourceConsentFenceUnsafe = true; throw new Error('SOURCE_CONSENT_PERSISTENCE_FAILED'); }
    if (!fenced) { this.abortActiveReaders(); this.generation++; this.stopAutomaticImport(); }
    this.previews.clear(); this.completedCommits.clear(); this.qualifiedCursors.clear();
    this.config = next;
    this.scheduleAutomaticImport();
    return this.getConfig();
  }
  async preview(): Promise<DayflowPreview>;
  async preview(request: PreviewRequest): Promise<PreviewResponse>;
  async preview(request?: PreviewRequest): Promise<PreviewResponse | DayflowPreview> {
    if (request) return this.previewPublic(request);
    if (!this.config.enabled) throw new Error('Dayflow integration is disabled.');
    if (!this.config.timezone) throw new Error('Select an IANA timezone before previewing Dayflow activity.');
    this.assertOperational();
    return this.createPreview(this.currentActivityDay(this.config.timezone));
  }
  async commit(token: string, candidateIds: string[]): Promise<{ imported: string[]; skipped: string[]; conflicts: string[]; failed: string[] }>;
  async commit(token: CommitRequest): Promise<CommitResponse>;
  async commit(token: string | CommitRequest, candidateIds?: string[]): Promise<CommitResponse | { imported: string[]; skipped: string[]; conflicts: string[]; failed: string[] }> {
    if (typeof token !== 'string') return this.commitPublic(token);
    return this.commitInternal(token, candidateIds ?? []);
  }
  private async commitInternal(token: string, candidateIds: string[]) { return this.exclusive(async () => {
    this.assertOperational();
    if (!this.config.enabled) throw new Error('Dayflow integration is disabled.');
    const preview = this.previews.get(token); if (!preview || Date.parse(preview.expiresAt) <= (this.deps.now ?? Date.now)()) { this.previews.delete(token); throw new Error('Dayflow preview expired or is invalid.'); }
    const generation = this.generation;
    const selected = new Set(candidateIds); if (selected.size === 0) return { imported: [], skipped: [], conflicts: [], failed: [] };
    if ([...selected].some((id) => !preview.candidates.some((candidate) => candidate.candidateId === id))) throw new Error('Dayflow preview selection is invalid.');
    const imported: string[] = []; const skipped: string[] = []; const conflicts: string[] = []; const failed: string[] = [];
    for (const candidate of preview.candidates.filter((item) => selected.has(item.candidateId))) {
      const sourceId = sourceIdFor(candidate); const ledger = this.deps.ledger; const prior = ledger?.get(sourceId);
      if (!this.isCurrentGeneration(generation)) break;
      if (prior?.pendingCreateAt) {
        if (!this.deps.memoryClient.createOnly || prior.revisionHash !== candidate.revisionHash || prior.contentHash !== createHash('sha256').update(contentFor(candidate)).digest('hex') || !prior.operationId) { conflicts.push(sourceId); continue; }
        try {
          const receipt = await this.deps.memoryClient.createOnly({ operationId: prior.operationId, id: prior.memoryId, content: contentFor(candidate), sourceId, observation: candidate });
          if (receipt.id !== prior.memoryId) throw new Error('Dayflow canonical import receipt has an unexpected id.');
          if (!(await this.producerStillCurrent(generation))) break;
          const completed = await this.attachQualification(
            { ...prior, memoryId: receipt.id, pendingCreateAt: undefined, canonicalSourceKey: receipt.canonicalSourceKey },
            candidate,
            receipt.canonicalContentHash,
          );
          if (!(await this.producerStillCurrent(generation, completed.qualification)) || !this.isCurrentGeneration(generation)) break;
          ledger?.save(completed);
          imported.push(receipt.id);
        } catch (error) { if (error instanceof DayflowImportConflictError) conflicts.push(sourceId); else failed.push(sourceId); }
        continue;
      }
      if (prior?.pendingDeleteAt) { skipped.push(sourceId); continue; }
      // A qualified receipt is deliberately short-lived.  An unchanged
      // observation may be re-attested only by replaying the existing
      // create-only operation: that path revalidates the immutable canonical
      // note and authenticated owner before a new authority receipt is
      // persisted. Never turn a prior ledger receipt alone into fresh
      // authority.
      if (prior && this.reattestableQualification(prior, candidate)) {
        if (!this.deps.memoryClient.createOnly ||
            prior.contentHash !== createHash('sha256').update(contentFor(candidate)).digest('hex') ||
            !prior.operationId) {
          skipped.push(sourceId);
          continue;
        }
        try {
          const receipt = await this.deps.memoryClient.createOnly({
            operationId: prior.operationId,
            id: prior.memoryId,
            content: contentFor(candidate),
            sourceId,
            observation: candidate,
          });
          // Renewal may only adopt the immutable note already represented by
          // this completed ledger row. A newly-created response is not proof
          // that a missing canonical note may be silently recreated here.
          const priorQualification = parseDayflowQualifiedReceipt(prior.qualification);
          if (receipt.id !== prior.memoryId || receipt.disposition !== 'already_present' ||
              receipt.canonicalSourceKey !== prior.canonicalSourceKey ||
              receipt.canonicalSourceKey !== priorQualification.canonicalSourceKey ||
              receipt.canonicalContentHash !== priorQualification.canonicalContentHash) {
            throw new Error('Dayflow canonical renewal receipt is unexpected.');
          }
          if (!(await this.producerStillCurrent(generation))) break;
          const completed = await this.attachQualification(
            { ...prior, memoryId: receipt.id, canonicalSourceKey: priorQualification.canonicalSourceKey },
            candidate,
            priorQualification.canonicalContentHash,
          );
          // `attachQualification` intentionally returns the original entry
          // when current authority cannot mint a receipt.  Keep that expired
          // entry unchanged rather than accidentally treating it as renewed.
          if (!this.hasFreshQualification(completed.qualification)) {
            skipped.push(sourceId);
            continue;
          }
          if (!(await this.producerStillCurrent(generation, completed.qualification)) || !this.isCurrentGeneration(generation)) break;
          ledger?.save(completed);
          // Canonical content already existed; renewal is not a new imported
          // observation and must not be reported as a task/completion import.
          skipped.push(sourceId);
        } catch (error) { if (error instanceof DayflowImportConflictError) conflicts.push(sourceId); else failed.push(sourceId); }
        continue;
      }
      if (prior?.tombstonedAt || (prior && prior.revisionHash === candidate.revisionHash && !prior.pendingCreateAt)) { skipped.push(sourceId); continue; }
      // The historical non-create-only writer cannot attest an immutable
      // replacement's canonical hash/source key. Preserve its established
      // conflict behavior; revision successors are admitted only through the
      // real create-only canonical receipt path below.
      if (prior && prior.revisionHash !== candidate.revisionHash && !this.deps.memoryClient.createOnly) {
        conflicts.push(sourceId);
        continue;
      }
      const content = contentFor(candidate); const contentHash = createHash('sha256').update(content).digest('hex');
      try {
        // A revised Dayflow card is a new immutable canonical observation.
        // Never ask the create-only writer to overwrite the prior revision;
        // the ledger retains that old receipt as retracted history.
        const memoryId = prior && prior.revisionHash !== candidate.revisionHash
          ? stableRevisionMemoryId(sourceId, candidate.revisionHash)
          : stableMemoryId(sourceId);
        const entry = { sourceId, revisionHash: candidate.revisionHash, memoryId, contentHash, exportVersion: candidate.exportVersion, operationId: randomUUID(), importedAt: new Date((this.deps.now ?? Date.now)()).toISOString() };
        ledger?.journalCreate(entry);
        const pending = ledger?.get(sourceId) ?? entry;
        const memoryClient = this.deps.memoryClient;
        let completed: LedgerEntry;
        let createdId: string;
        if (memoryClient.createOnly) {
          const created = await memoryClient.createOnly({ operationId: pending.operationId!, id: pending.memoryId, content, sourceId, observation: candidate });
          if (created.id !== pending.memoryId) throw new Error('Dayflow canonical import receipt has an unexpected id.');
          createdId = created.id;
          if (!(await this.producerStillCurrent(generation))) break;
          completed = await this.attachQualification({ ...pending, memoryId: created.id, pendingCreateAt: undefined, canonicalSourceKey: created.canonicalSourceKey }, candidate, created.canonicalContentHash);
        } else {
          const created = await this.deps.memoryClient.create({ id: pending.memoryId, content, sourceId, observation: candidate });
          createdId = created.id;
          if (!(await this.producerStillCurrent(generation))) break;
          // The legacy create API returns no canonical hash receipt. It may
          // retain the import, but it can never qualify it for an agent read.
          completed = { ...pending, memoryId: created.id, pendingCreateAt: undefined };
        }
        // Shutdown/disable after a remote create leaves the durable pending
        // record for recovery; it must not write a completed receipt late.
        if (!(await this.producerStillCurrent(generation, completed.qualification)) || !this.isCurrentGeneration(generation)) break;
        ledger?.save(completed);
        imported.push(createdId);
      }
      catch (error) { if (error instanceof DayflowImportConflictError) conflicts.push(sourceId); else failed.push(sourceId); }
    }
    if (!this.disposed) { this.previews.delete(token); this.schedulePreviewPurge(); }
    return { imported, skipped, conflicts, failed };
  }); }
  async listOwnedNotes(input: { limit: number; cursor?: string }): Promise<OwnedNotesPage> { return this.listOwned(input.limit, input.cursor); }
  async forget(memoryId: string | ForgetRequest): Promise<ForgetResponse | { forgotten: string }> {
    const owned = typeof memoryId === 'string' ? memoryId : memoryId.memoryId;
    await this.exclusive(async () => {
      this.assertOperational();
      const entry = this.deps.ledger?.currentEntries().find((candidate) => candidate.memoryId === owned);
      if (!entry) throw new Error('OWNED_NOTE_NOT_FOUND');
      if (entry.pendingCreateAt) throw new Error('PENDING_OPERATION');
      if (entry.tombstonedAt) return;
      this.deps.ledger?.markPendingDelete(entry.sourceId, new Date((this.deps.now ?? Date.now)()).toISOString());
      await this.deps.memoryClient.remove(owned);
      // A user-initiated forget may finish after Disable, but never after the
      // terminal dispose boundary. Keeping that completion avoids inventing a
      // retry/delete from card absence later.
      if (!this.disposed) this.deps.ledger?.completeDelete(entry.sourceId);
    });
    return typeof memoryId === 'string' ? { forgotten: owned } : { memoryId: owned, state: 'forgotten' };
  }
  async disable(): Promise<DayflowPublicStatus> {
    if (this.disposed) return this.status();
    const next = {
      ...this.config,
      enabled: false,
      automaticImport: false,
      qualificationGeneration: randomUUID(),
      sourceConsent: revokeDayflowSourceConsent(this.config.sourceConsent, new Date((this.deps.now ?? Date.now)()).toISOString()),
    };
    const fenced = this.fenceActiveSourceConsent(new Date((this.deps.now ?? Date.now)()).toISOString());
    try { this.deps.configStore?.write(next); }
    catch { this.sourceConsentFenceUnsafe = true; throw new Error('SOURCE_CONSENT_PERSISTENCE_FAILED'); }
    if (!fenced) { this.generation++; this.abortActiveReaders(); this.stopAutomaticImport(); }
    this.config = next;
    this.previews.clear(); this.completedCommits.clear(); this.qualifiedCursors.clear();
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = undefined;
    return this.status();
  }
  private exclusive<T>(operation: () => Promise<T>): Promise<T> { const next = this.commitQueue.then(operation, operation); this.commitQueue = next.then(() => undefined, () => undefined); return next; }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.abortActiveReaders();
    this.stopAutomaticImport();
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = undefined;
    this.previews.clear(); this.completedCommits.clear();
    this.qualifiedCursors.clear();
  }
  private purgeExpiredPreviews() { const now = (this.deps.now ?? Date.now)(); for (const [key, value] of this.previews) if (Date.parse(value.expiresAt) <= now) this.previews.delete(key); for (const [key, value] of this.completedCommits) if (Date.parse(value.expiresAt) <= now) this.completedCommits.delete(key); }
  private schedulePreviewPurge() { if (this.disposed) return; if (this.previewTimer) clearTimeout(this.previewTimer); this.purgeExpiredPreviews(); const next = Math.min(...[...this.previews.values()].map((item) => Math.max(0, Date.parse(item.expiresAt) - (this.deps.now ?? Date.now)()))); if (!Number.isFinite(next)) return; this.previewTimer = setTimeout(() => { this.previewTimer = undefined; if (this.disposed) return; this.purgeExpiredPreviews(); this.schedulePreviewPurge(); }, next); this.previewTimer.unref?.(); }
  private qualifiedReaderPreparation(): { namespace: string; sourceInstance: string; configurationGeneration: string } | null {
    if (
      this.disposed || this.sourceConsentFenceUnsafe || !this.config.enabled || !this.config.automaticImport || !this.config.timezone ||
      !this.config.journalPath || !this.config.journalBinding || !this.deps.ledger || !this.deps.qualificationAuthority ||
      !this.appliedJournal || !this.deps.journalVerifier || this.readiness().state !== 'ready'
    ) return null;
    return deriveDayflowQualificationBinding(this.config);
  }
  /**
   * Persist the one-way ledger fence before an old config can remain visible.
   * When the ledger itself cannot record it, close the current process too;
   * callers receive an unavailable response rather than a claimed revocation.
   */
  private fenceActiveSourceConsent(at: string): boolean {
    const consent = this.config.sourceConsent;
    if (!consent || consent.revokedAt !== undefined) return false;
    try {
      if (!this.deps.ledger) throw new Error('missing ledger');
      this.deps.ledger.revokeSourceConsentGeneration(consent.consentGeneration, at);
    } catch {
      this.sourceConsentFenceUnsafe = true;
      this.generation++;
      this.abortActiveReaders();
      this.stopAutomaticImport();
      this.qualifiedCursors.clear();
      throw new Error('SOURCE_CONSENT_PERSISTENCE_FAILED');
    }
    this.sourceConsentFenceUnsafe = true;
    this.generation++;
    this.abortActiveReaders();
    this.stopAutomaticImport();
    this.qualifiedCursors.clear();
    return true;
  }
  private qualifiedReaderStillCurrent(
    expected: { namespace: string; sourceInstance: string; configurationGeneration: string },
    generation: number,
  ): boolean {
    const current = this.qualifiedReaderPreparation();
    return generation === this.generation && !!current &&
      current.namespace === expected.namespace &&
      current.sourceInstance === expected.sourceInstance &&
      current.configurationGeneration === expected.configurationGeneration;
  }
  private qualificationCandidate(
    observation: DayflowCandidate,
    memoryId: string,
    canonicalContentHash: string,
    canonicalSourceKey: string | undefined,
  ): DayflowQualificationCandidate | null {
    const preparation = this.qualifiedReaderPreparation();
    if (!preparation || !/^[a-f0-9]{64}$/.test(canonicalContentHash) || !canonicalSourceKey) return null;
    const observedStart = canonicalIso(observation.observedStart);
    const observedEnd = canonicalIso(observation.observedEnd ?? observation.observedStart);
    if (!observedStart || !observedEnd || Date.parse(observedEnd) < Date.parse(observedStart)) return null;
    return {
      namespace: preparation.namespace,
      sourceInstance: preparation.sourceInstance,
      sourceId: opaqueReaderId('card', sourceIdFor(observation)),
      exporterVersion: observation.exportVersion,
      // The canonical importer persists this exact value in its immutable
      // source/frontmatter provenance field. Do not attest a synthetic
      // normalizer label that the resolver cannot re-read from the vault.
      normalizerVersion: observation.exportVersion,
      sourceRevision: opaqueReaderId('revision', observation.revisionHash),
      sourceHash: observation.revisionHash,
      canonicalId: memoryId,
      canonicalVersion: dayflowCanonicalVersion(canonicalContentHash),
      configurationGeneration: preparation.configurationGeneration,
      observedStart,
      observedEnd,
      canonicalContentHash,
      canonicalSourceKey,
    };
  }
  /** A missing/broken authority receipt leaves the import usable for its owner but held for agent reads. */
  private async attachQualification(
    entry: LedgerEntry,
    observation: DayflowCandidate,
    canonicalContentHash: string,
  ): Promise<LedgerEntry> {
    const candidate = this.qualificationCandidate(
      observation,
      entry.memoryId,
      canonicalContentHash,
      entry.canonicalSourceKey,
    );
    if (!candidate || !this.deps.qualificationAuthority) return entry;
    try {
      const raw = await this.deps.qualificationAuthority.qualify(candidate);
      if (!raw) return entry;
      const qualification = parseDayflowQualifiedReceipt(raw);
      return receiptMatchesCandidate(qualification, candidate) ? { ...entry, qualification } : entry;
    } catch {
      return entry;
    }
  }
  /**
   * A prior receipt identifies only immutable canonical provenance, never
   * current authority. It may be re-attested under a new explicit current
   * consent only when that current persisted scope belongs to the same owner,
   * project, namespace, and native source. The later create-only replay then
   * proves the exact canonical note still exists before a new receipt is
   * requested.
   */
  private reattestableQualification(entry: LedgerEntry, observation: DayflowCandidate): boolean {
    if (!entry.qualification || entry.pendingCreateAt || entry.pendingDeleteAt || entry.tombstonedAt ||
        entry.revisionHash !== observation.revisionHash || entry.exportVersion !== observation.exportVersion ||
        entry.contentHash !== createHash('sha256').update(contentFor(observation)).digest('hex')) return false;
    const preparation = this.qualifiedReaderPreparation();
    if (!preparation) return false;
    const snapshot = this.currentQualificationScopeSnapshot(preparation);
    if (!snapshot.supported || !snapshot.scope) return false;
    try {
      const receipt = parseDayflowQualifiedReceipt(entry.qualification);
      const reference = receipt.reference;
      if (reference.eligibility !== 'active' ||
          !this.receiptMatchesStoredQualificationProvenance(receipt, entry) ||
          reference.namespace !== preparation.namespace ||
          reference.sourceInstance !== preparation.sourceInstance ||
          snapshot.scope.namespace !== preparation.namespace ||
          snapshot.scope.sourceInstance !== preparation.sourceInstance ||
          snapshot.scope.configurationGeneration !== preparation.configurationGeneration ||
          reference.ownerUserId !== snapshot.scope.ownerUserId ||
          reference.projectId !== snapshot.scope.projectId) return false;
      if (this.receiptCouldBelongToCurrentScope(reference, snapshot.scope, preparation)) {
        return Date.parse(reference.expiresAt) <= (this.deps.now ?? Date.now)();
      }
      // A scope mismatch may only be the new consent/configuration
      // generations. All owner/project/native bindings above remain exact.
      return reference.consentGeneration !== snapshot.scope.consentGeneration ||
        reference.configurationGeneration !== preparation.configurationGeneration;
    } catch {
      return false;
    }
  }
  private hasFreshQualification(qualification: LedgerEntry['qualification']): boolean {
    if (!qualification) return false;
    try {
      return Date.parse(parseDayflowQualifiedReceipt(qualification).reference.expiresAt) > (this.deps.now ?? Date.now)();
    } catch {
      return false;
    }
  }
  private receiptMatchesLedgerEntry(
    receipt: ReturnType<typeof parseDayflowQualifiedReceipt>,
    entry: LedgerEntry,
    preparation: { namespace: string; sourceInstance: string; configurationGeneration: string },
  ): boolean {
    const reference = receipt.reference;
    return typeof entry.canonicalSourceKey === 'string' &&
      reference.namespace === preparation.namespace &&
      reference.sourceInstance === preparation.sourceInstance &&
      reference.sourceId === opaqueReaderId('card', entry.sourceId) &&
      reference.sourceRevision === opaqueReaderId('revision', entry.revisionHash) &&
      reference.sourceHash === entry.revisionHash &&
      reference.exporterVersion === entry.exportVersion &&
      reference.normalizerVersion === entry.exportVersion &&
      reference.canonicalId === entry.memoryId &&
      reference.canonicalVersion === dayflowCanonicalVersion(receipt.canonicalContentHash) &&
      receipt.canonicalSourceKey === entry.canonicalSourceKey &&
      reference.configurationGeneration === preparation.configurationGeneration;
  }
  /** Same immutable provenance check used only before a canonical re-play.
   * The reader keeps its stricter current-generation receipt check above. */
  private receiptMatchesStoredQualificationProvenance(
    receipt: ReturnType<typeof parseDayflowQualifiedReceipt>,
    entry: LedgerEntry,
  ): boolean {
    const reference = receipt.reference;
    return typeof entry.canonicalSourceKey === 'string' &&
      reference.sourceId === opaqueReaderId('card', entry.sourceId) &&
      reference.sourceRevision === opaqueReaderId('revision', entry.revisionHash) &&
      reference.sourceHash === entry.revisionHash &&
      reference.exporterVersion === entry.exportVersion &&
      reference.normalizerVersion === entry.exportVersion &&
      reference.canonicalId === entry.memoryId &&
      reference.canonicalVersion === dayflowCanonicalVersion(receipt.canonicalContentHash) &&
      receipt.canonicalSourceKey === entry.canonicalSourceKey;
  }
  private receiptCouldBelongToCurrentScope(
    reference: DayflowWorkstreamReferenceV1,
    scope: { ownerUserId: number; projectId: string; namespace: string; sourceInstance: string; consentGeneration: string; configurationGeneration: string },
    preparation: { namespace: string; sourceInstance: string; configurationGeneration: string },
  ): boolean {
    return reference.ownerUserId === scope.ownerUserId &&
      reference.projectId === scope.projectId &&
      reference.namespace === preparation.namespace &&
      reference.sourceInstance === preparation.sourceInstance &&
      reference.consentGeneration === scope.consentGeneration &&
      reference.configurationGeneration === preparation.configurationGeneration;
  }
  private currentActivityDay(timeZone: string): string {
    return this.activityDayForTimestamp(new Date((this.deps.now ?? Date.now)()).toISOString(), timeZone)!;
  }
  private activityDayForTimestamp(timestamp: string, timeZone: string): string | null {
    const instant = new Date(timestamp);
    if (Number.isNaN(instant.valueOf())) return null;
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
    const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    const calendarDay = `${values.year}-${values.month}-${values.day}`;
    return Number(values.hour) < 4 ? shiftCalendarDay(calendarDay, -1) : calendarDay;
  }
  private async previewPublic(request: PreviewRequest): Promise<PreviewResponse> { if (this.readiness().state !== 'ready') throw new Error('SOURCE_UNVERIFIED'); const preview = await this.previewDate(request.date); const config = this.getConfig(); if (!config.timezone) throw new Error('TIMEZONE_REQUIRED'); return this.publicPreview(preview, request.date, config.timezone); }
  async commitPublic(request: CommitRequest): Promise<CommitResponse> {
    this.purgeExpiredPreviews(); const selection = JSON.stringify(request.candidateIds); const replay = this.completedCommits.get(request.token);
    if (replay) { if (replay.selection !== selection) throw new Error('SELECTION_CONFLICT'); return structuredClone(replay.result); }
    const preview = this.previews.get(request.token); if (!preview) throw new Error('PREVIEW_EXPIRED');
    const result = await this.commitInternal(request.token, request.candidateIds); const imported = new Set(result.imported); const skipped = new Set(result.skipped); const conflicts = new Set(result.conflicts); const failed = new Set(result.failed);
    const publicResult: CommitResponse = { items: request.candidateIds.map((candidateId) => { const candidate = preview.candidates.find((item) => item.candidateId === candidateId); const sourceId = candidate ? sourceIdFor(candidate) : ''; const receipt = sourceId ? this.deps.ledger?.get(sourceId)?.memoryId : undefined; if (receipt && imported.has(receipt)) return { candidateId, state: 'imported' as const, memoryId: receipt }; if (skipped.has(sourceId)) return { candidateId, state: 'skipped' as const }; if (conflicts.has(sourceId)) return { candidateId, state: 'conflict' as const, code: 'SELECTION_CONFLICT' as const }; return { candidateId, state: 'pending' as const, code: failed.has(sourceId) ? 'IMPORT_UNCERTAIN' as const : 'SELECTION_CONFLICT' as const }; }) };
    this.completedCommits.set(request.token, { selection, expiresAt: preview.expiresAt, result: structuredClone(publicResult) }); return publicResult;
  }
  private async createPreview(date: string): Promise<DayflowPreview> {
    this.assertOperational();
    if (!this.config.enabled) throw new Error('DISABLED'); if (!this.config.timezone) throw new Error('TIMEZONE_REQUIRED');
    const generation = this.generation; const reader = this.source as DayflowSource & { readDay?: (request: DayflowReadRequest, signal?: AbortSignal) => Promise<QualifiedDayflowSnapshot> };
    const normalized = reader.readDay ? (await this.readQualified({ date, timeZone: this.config.timezone, sourceNamespace: this.config.sourceNamespace })).observations : normalizeFixtureExportDetailed(await this.source.read(), this.config.timezone);
    const observations = normalized.observations.map((item) => ({ ...item, sourceInstanceId: this.config.sourceNamespace }));
    if (!this.isCurrentGeneration(generation)) throw new Error('PREVIEW_INVALIDATED');
    if (observations.length > this.config.maxRecordsPerRun) throw new Error('EXPORT_LIMIT');
    const excluded = new Set(this.config.exclusions.map((item) => item.slice('category:'.length))); const remaining = observations.filter((item) => !excluded.has(item.category ?? '') && !this.deps.ledger?.get(sourceIdFor(item))?.tombstonedAt);
    this.purgeExpiredPreviews(); if (this.previews.size >= 8) throw new Error('EXPORT_LIMIT');
    const preview = previewFor(remaining, (this.deps.now ?? Date.now)(), normalized.rejected); this.previews.set(preview.token, preview); this.schedulePreviewPurge(); return preview;
  }
  private publicPreview(preview: DayflowPreview, date: string, timeZone: string): PreviewResponse { return { token: preview.token, expiresAt: preview.expiresAt, date, timeZone, coverage: 'existing_cards', analysisCompleteness: 'unknown', candidates: preview.candidates.map(({ candidateId, summary, observedStart, observedEnd, category }) => ({ candidateId, summary, observedStart, ...(observedEnd === undefined ? {} : { observedEnd }), ...(category === undefined ? {} : { category }), trust: 'unverified' as const })), withheld: preview.rejected.map(({ recordIndex, reason }) => ({ recordIndex, code: reason === 'secret_like_content' ? 'SENSITIVE_CONTENT' as const : reason === 'empty_after_redaction' ? 'EMPTY_CONTENT' as const : 'SUMMARY_LIMIT' as const })) }; }
  private async readQualified(request: DayflowReadRequest): Promise<QualifiedDayflowSnapshot> {
    this.assertOperational();
    const reader = this.source as DayflowSource & { readDay?: (request: DayflowReadRequest, signal?: AbortSignal) => Promise<QualifiedDayflowSnapshot> };
    if (!reader.readDay) throw new Error('SOURCE_UNVERIFIED');
    const controller = new AbortController(); this.readerControllers.add(controller);
    try {
      return await reader.readDay(request, controller.signal);
    } catch {
      // Never put database paths, SQL errors, or card text into the public
      // management envelope. A disabled/config-invalidated read is distinct
      // from an ordinary bounded reader failure.
      throw new Error(controller.signal.aborted ? 'READER_CANCELLED' : 'READER_FAILED');
    }
    finally { this.readerControllers.delete(controller); }
  }
  private abortActiveReaders() { for (const controller of this.readerControllers) controller.abort(); }
  private assertOperational() { if (this.disposed) throw new Error('DISABLED'); }
  private isCurrentGeneration(generation: number): boolean { return !this.disposed && this.config.enabled && generation === this.generation; }
  private fingerprint(artifact: VerifiedDayflowArtifact): string { return createHash('sha256').update(`${artifact.canonicalPath}\u0000${artifact.executable}\u0000${artifact.fileIdentity}\u0000${artifact.digest}\u0000${artifact.signingFingerprint}`).digest('base64url'); }
  private journalFingerprint(journal: VerifiedDayflowJournal): string { return createHash('sha256').update(`${journal.canonicalPath}\u0000${journal.fileIdentity}\u0000${journal.schemaFingerprint}`).digest('base64url'); }
  private matchesPersistedJournalBinding(journal: VerifiedDayflowJournal): boolean {
    return this.config.journalPath === journal.canonicalPath
      && this.config.journalBinding?.fileIdentity === journal.fileIdentity
      && this.config.journalBinding.schemaFingerprint === journal.schemaFingerprint;
  }
  private stopAutomaticImport() {
    if (this.automaticImportTimer) clearTimeout(this.automaticImportTimer);
    this.automaticImportTimer = undefined;
  }
  /**
   * Automatic import is a durable, explicit opt-in. It never runs immediately
   * on startup/configuration, emits no coordinator wake, and uses the same
   * bounded reader, exclusions, redaction, create-only client, ledger and
   * tombstone behavior as a manually selected import.
   */
  private scheduleAutomaticImport() {
    this.stopAutomaticImport();
    if (this.disposed || !this.config.enabled || !this.config.automaticImport || !this.config.timezone) return;
    const source = this.source as DayflowSource & { hasVerifiedBinding?: () => boolean };
    if (this.config.journalPath && !this.appliedJournal) return;
    if (typeof source.hasVerifiedBinding === 'function' && !source.hasVerifiedBinding()) return;
    const generation = this.generation;
    this.automaticImportTimer = setTimeout(() => {
      this.automaticImportTimer = undefined;
      void this.runAutomaticImport(generation);
    }, 15 * 60_000);
    this.automaticImportTimer.unref?.();
  }
  private async runAutomaticImport(generation: number) {
    try {
      if (!this.isCurrentGeneration(generation) || !this.config.automaticImport || !this.config.timezone) return;
      if (this.appliedJournal || this.appliedArtifact) await this.revalidateAppliedSelection();
      // The current activity day starts at 04:00 local time. Two prior day
      // windows make late-written cards discoverable without unbounded scans.
      for (const date of this.automaticScanDays(this.config.timezone)) {
        if (!this.isCurrentGeneration(generation) || !this.config.automaticImport) break;
        const preview = await this.createPreview(date);
        if (!this.isCurrentGeneration(generation)) break;
        if (preview.candidates.length > 0) {
          await this.commitInternal(preview.token, preview.candidates.map((candidate) => candidate.candidateId));
        } else if (!this.disposed) {
          this.previews.delete(preview.token);
        }
      }
    } catch {
      // A scheduled scan is best-effort and deliberately has no retry loop;
      // the next bounded cadence is the only future attempt.
    } finally {
      if (!this.disposed && generation === this.generation) this.scheduleAutomaticImport();
    }
  }
  private automaticScanDays(timeZone: string): string[] {
    const current = this.currentActivityDay(timeZone);
    return [current, shiftCalendarDay(current, -1), shiftCalendarDay(current, -2)];
  }
}
function isCalendarDay(value: string): boolean { const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value); if (!match) return false; const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))); return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]); }
function shiftCalendarDay(date: string, days: number): string { const [year, month, day] = date.split('-').map(Number); const shifted = new Date(Date.UTC(year, month - 1, day + days)); return shifted.toISOString().slice(0, 10); }
function opaqueReaderId(prefix: string, value: unknown): string { return `${prefix}:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`; }
/** Revision identity is private to the producer stage, so the shared plan
 * module remains unchanged. A corrected card never overwrites its prior
 * canonical observation. */
function stableRevisionMemoryId(sourceId: string, revisionHash: string): string {
  return stableMemoryId(JSON.stringify([sourceId, revisionHash]));
}
function canonicalIso(value: string): string | null { const parsed = new Date(value); return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString(); }
function isReaderId(value: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value); }
function sameQualificationScope(
  left: { ownerUserId: number; projectId: string; namespace: string; sourceInstance: string; consentGeneration: string; configurationGeneration: string },
  right: { ownerUserId: number; projectId: string; namespace: string; sourceInstance: string; consentGeneration: string; configurationGeneration: string },
): boolean {
  return left.ownerUserId === right.ownerUserId && left.projectId === right.projectId &&
    left.namespace === right.namespace && left.sourceInstance === right.sourceInstance &&
    left.consentGeneration === right.consentGeneration && left.configurationGeneration === right.configurationGeneration;
}
function qualifiedEvidencePageBinding(page: DayflowQualifiedEvidencePage): {
  schemaVersion: 1;
  status: DayflowQualifiedEvidencePage['status'];
  references: DayflowWorkstreamReferenceV1[];
  candidates: DayflowQualifiedEvidencePage['candidates'];
} {
  // Cursors are intentionally not part of a final admission: generating a
  // fresh opaque cursor for an otherwise unchanged oversized page is not a
  // source/receipt change. The complete ordered ledger revision is bound
  // separately above.
  return {
    schemaVersion: 1,
    status: page.status,
    references: page.references,
    candidates: page.candidates,
  };
}
function sameQualifiedEvidencePage(left: DayflowQualifiedEvidencePage, right: DayflowQualifiedEvidencePage): boolean {
  return left.schemaVersion === right.schemaVersion && left.status === right.status &&
    left.references.length === right.references.length &&
    left.candidates.length === right.candidates.length &&
    left.references.every((reference, index) => JSON.stringify(reference) === JSON.stringify(right.references[index])) &&
    left.candidates.every((candidate, index) =>
      !!right.candidates[index] && sameDayflowQualifiedEvidenceCandidate(candidate, right.candidates[index]));
}
function unavailableQualifiedPage(): DayflowQualifiedEvidencePage { return { schemaVersion: 1, status: 'unavailable', references: [], candidates: [], nextCursor: null }; }
function notConfiguredQualifiedPage(): DayflowQualifiedEvidencePage { return { schemaVersion: 1, status: 'not_configured', references: [], candidates: [], nextCursor: null }; }
function isNewerQualifiedCandidate(
  left: { reference: DayflowWorkstreamReferenceV1; qualifiedAt: string },
  right: { reference: DayflowWorkstreamReferenceV1; qualifiedAt: string },
): boolean {
  return left.reference.observedEnd > right.reference.observedEnd ||
    (left.reference.observedEnd === right.reference.observedEnd && left.qualifiedAt > right.qualifiedAt);
}
