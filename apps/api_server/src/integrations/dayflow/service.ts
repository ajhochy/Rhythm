import { createHash, randomUUID } from 'node:crypto';
import { DayflowConfigStore } from './config_store';
import { freshDayflowConfig, validateDayflowConfig } from './config_validation';
import { MemoryLedger } from './ledger';
import { DayflowImportConflictError, type DayflowMemoryClient } from './memory_client';
import { normalizeFixtureExportDetailed } from './normalize';
import { verifyPinnedDayflowArtifact, type DayflowArtifactVerifier, type DayflowReadRequest, type QualifiedDayflowSnapshot, type VerifiedDayflowArtifact } from './cli_source';
import type { CommitRequest, CommitResponse, ConfigPatch, DayflowPublicStatus, ForgetRequest, ForgetResponse, OwnedNotesPage, PreviewRequest, PreviewResponse, PublicDayflowConfig, SourceReadiness } from './public_contract';
import { contentFor, previewFor, sourceIdFor, stableMemoryId } from './plan';
import type { DayflowConfig, DayflowPreview, DayflowSource } from './types';

export class DayflowIntegrationService {
  private config: DayflowConfig;
  private previews = new Map<string, DayflowPreview>();
  private readonly completedCommits = new Map<string, { selection: string; expiresAt: string; result: CommitResponse }>();
  private previewTimer?: ReturnType<typeof setTimeout>;
  private commitQueue = Promise.resolve();
  /** Every active source read is owned so disable/config/shutdown can abort it. */
  private readonly readerControllers = new Set<AbortController>();
  /** Server-lifetime opaque pagination cursors, bound to a ledger revision. */
  private readonly ownedCursors = new Map<string, { offset: number; revision: string }>();
  /** Private attestation state; it is never projected into public DTOs. */
  private checkedArtifact?: VerifiedDayflowArtifact;
  private appliedArtifact?: VerifiedDayflowArtifact;
  private source: DayflowSource;
  private generation = 0;
  constructor(private readonly deps: { source: DayflowSource; memoryClient: DayflowMemoryClient; ledger?: MemoryLedger; configStore?: DayflowConfigStore; now?: () => number; artifactVerifier?: DayflowArtifactVerifier; sourceForArtifact?: (artifact: VerifiedDayflowArtifact) => DayflowSource }) {
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
  }
  private internalStatus() { this.purgeExpiredPreviews(); const entries = this.deps.ledger?.entries() ?? []; return { enabled: this.config.enabled, automaticImport: false as const, adapterStatus: 'adapter_not_ready' as const, sourceVersion: this.config.sourceVersion, timezone: this.config.timezone, importedCount: entries.filter((e) => !e.tombstonedAt && !e.pendingCreateAt && !e.pendingDeleteAt).length, pendingCreateCount: entries.filter((e) => e.pendingCreateAt).length, pendingDeleteCount: entries.filter((e) => e.pendingDeleteAt).length }; }
  status(): DayflowPublicStatus { const status = this.internalStatus(); const readiness = this.readiness(); return { enabled: status.enabled, automaticImport: false, readiness, canPreview: status.enabled && readiness.state === 'ready' && !!this.config.timezone, importedCount: status.importedCount, pendingCreateCount: status.pendingCreateCount, pendingDeleteCount: status.pendingDeleteCount }; }
  publicStatus(): DayflowPublicStatus { return this.status(); }
  readiness(): SourceReadiness { const source = this.source as DayflowSource & { hasVerifiedBinding?: () => boolean }; return this.checkedArtifact || this.appliedArtifact || source.hasVerifiedBinding?.() === true ? { state: 'ready', source: { label: 'Dayflow', version: '2.6.0', build: '133' }, code: null } : { state: 'unconfigured', source: null, code: 'SOURCE_UNVERIFIED' }; }
  /** Metadata/signature/identity check only: it neither runs the reader nor touches a journal. */
  async checkReadiness(input: { bundlePath: string }): Promise<SourceReadiness> {
    if (!this.deps.artifactVerifier) return { state: 'unconfigured', source: null, code: 'SOURCE_UNVERIFIED' };
    try { this.checkedArtifact = await verifyPinnedDayflowArtifact(input.bundlePath, this.deps.artifactVerifier); return this.readiness(); }
    catch { this.checkedArtifact = undefined; return { state: 'unverified', source: null, code: 'SOURCE_UNVERIFIED' }; }
  }
  /** Opaque-to-client digest used only by the management adapter's token map. */
  selectionFingerprint(): string | undefined { const artifact = this.checkedArtifact ?? this.appliedArtifact; return artifact ? this.fingerprint(artifact) : undefined; }
  async applyVerifiedSelection(fingerprint: string): Promise<void> {
    if (!this.checkedArtifact || this.selectionFingerprint() !== fingerprint || !this.deps.artifactVerifier || !this.deps.sourceForArtifact) throw new Error('SOURCE_CHANGED');
    const revalidated = await verifyPinnedDayflowArtifact(this.checkedArtifact.canonicalPath, this.deps.artifactVerifier);
    if (this.fingerprint(revalidated) !== fingerprint) throw new Error('SOURCE_CHANGED');
    this.appliedArtifact = revalidated; this.checkedArtifact = undefined;
    this.source = this.deps.sourceForArtifact(revalidated);
  }
  async revalidateAppliedSelection(): Promise<void> {
    if (!this.appliedArtifact || !this.deps.artifactVerifier) throw new Error('SOURCE_UNVERIFIED');
    const revalidated = await verifyPinnedDayflowArtifact(this.appliedArtifact.canonicalPath, this.deps.artifactVerifier);
    if (this.fingerprint(revalidated) !== this.fingerprint(this.appliedArtifact)) { this.appliedArtifact = undefined; throw new Error('SOURCE_CHANGED'); }
  }
  async previewDate(date: string) { if (!isCalendarDay(date)) throw new Error('INVALID_REQUEST'); return this.createPreview(date); }
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
  privateConfig() { return structuredClone(this.config); }
  getConfig(): PublicDayflowConfig { const readiness = this.readiness(); return { enabled: this.config.enabled, automaticImport: false, timezone: this.config.timezone, rolloverHour: 4, exclusions: [...this.config.exclusions], maxRecordsPerRun: this.config.maxRecordsPerRun, source: readiness.source }; }
  async updateConfig(patch: ConfigPatch | Partial<DayflowConfig>): Promise<PublicDayflowConfig> {
    const allowed = new Set(['enabled', 'automaticImport', 'executablePath', 'sourceVersion', 'timezone', 'exclusions', 'retentionDays', 'maxRecordsPerRun']);
    if (Object.keys(patch).some((key) => !allowed.has(key))) throw new Error('Dayflow configuration contains an unsupported field.');
    if ('automaticImport' in patch && patch.automaticImport === true) throw new Error('Automatic Dayflow import is unavailable until source qualification.');
    const boundSource = this.source as DayflowSource & { hasVerifiedBinding?: () => boolean };
    if (patch.enabled === true && !this.appliedArtifact && typeof boundSource.hasVerifiedBinding === 'function' && !boundSource.hasVerifiedBinding()) throw new Error('SOURCE_UNVERIFIED');
    // A result obtained under the old configuration must never become a
    // preview after its privacy/source settings have changed.
    this.abortActiveReaders();
    const next = validateDayflowConfig({ ...this.config, ...patch, schemaVersion: 1, automaticImport: false, rolloverHour: 4 });
    this.deps.configStore?.write(next);
    this.generation++; this.previews.clear(); this.completedCommits.clear();
    this.config = next; return this.getConfig();
  }
  async preview(): Promise<DayflowPreview>;
  async preview(request: PreviewRequest): Promise<PreviewResponse>;
  async preview(request?: PreviewRequest): Promise<PreviewResponse | DayflowPreview> {
    if (request) return this.previewPublic(request);
    if (!this.config.enabled) throw new Error('Dayflow integration is disabled.');
    if (!this.config.timezone) throw new Error('Select an IANA timezone before previewing Dayflow activity.');
    return this.createPreview(this.currentDay(this.config.timezone));
  }
  async commit(token: string, candidateIds: string[]): Promise<{ imported: string[]; skipped: string[]; conflicts: string[]; failed: string[] }>;
  async commit(token: CommitRequest): Promise<CommitResponse>;
  async commit(token: string | CommitRequest, candidateIds?: string[]): Promise<CommitResponse | { imported: string[]; skipped: string[]; conflicts: string[]; failed: string[] }> {
    if (typeof token !== 'string') return this.commitPublic(token);
    return this.commitInternal(token, candidateIds ?? []);
  }
  private async commitInternal(token: string, candidateIds: string[]) { return this.exclusive(async () => {
    if (!this.config.enabled) throw new Error('Dayflow integration is disabled.');
    const preview = this.previews.get(token); if (!preview || Date.parse(preview.expiresAt) <= (this.deps.now ?? Date.now)()) { this.previews.delete(token); throw new Error('Dayflow preview expired or is invalid.'); }
    const generation = this.generation;
    const selected = new Set(candidateIds); if (selected.size === 0) return { imported: [], skipped: [], conflicts: [], failed: [] };
    if ([...selected].some((id) => !preview.candidates.some((candidate) => candidate.candidateId === id))) throw new Error('Dayflow preview selection is invalid.');
    const imported: string[] = []; const skipped: string[] = []; const conflicts: string[] = []; const failed: string[] = [];
    for (const candidate of preview.candidates.filter((item) => selected.has(item.candidateId))) {
      const sourceId = sourceIdFor(candidate); const ledger = this.deps.ledger; const prior = ledger?.get(sourceId);
      if (!this.config.enabled || generation !== this.generation) break;
      if (prior?.pendingCreateAt) {
        if (!this.deps.memoryClient.createOnly || prior.revisionHash !== candidate.revisionHash || prior.contentHash !== createHash('sha256').update(contentFor(candidate)).digest('hex') || !prior.operationId) { conflicts.push(sourceId); continue; }
        try { const receipt = await this.deps.memoryClient.createOnly({ operationId: prior.operationId, id: prior.memoryId, content: contentFor(candidate), sourceId, observation: candidate }); ledger?.save({ ...prior, memoryId: receipt.id, pendingCreateAt: undefined }); imported.push(receipt.id); } catch (error) { if (error instanceof DayflowImportConflictError) conflicts.push(sourceId); else failed.push(sourceId); } continue;
      }
      if (prior?.pendingDeleteAt) { skipped.push(sourceId); continue; }
      if (prior?.tombstonedAt || (prior && prior.revisionHash === candidate.revisionHash && !prior.pendingCreateAt)) { skipped.push(sourceId); continue; }
      if (prior && prior.revisionHash !== candidate.revisionHash) { conflicts.push(sourceId); continue; }
      const content = contentFor(candidate); const contentHash = createHash('sha256').update(content).digest('hex');
      try { const memoryId = stableMemoryId(sourceId); const entry = { sourceId, revisionHash: candidate.revisionHash, memoryId, contentHash, operationId: randomUUID(), importedAt: new Date((this.deps.now ?? Date.now)()).toISOString() }; ledger?.journalCreate(entry); const created = this.deps.memoryClient.createOnly ? await this.deps.memoryClient.createOnly({ operationId: entry.operationId, id: memoryId, content, sourceId, observation: candidate }) : await this.deps.memoryClient.create({ id: memoryId, content, sourceId, observation: candidate }); ledger?.save({ ...entry, memoryId: created.id }); imported.push(created.id); if (!this.config.enabled || generation !== this.generation) break; }
      catch (error) { if (error instanceof DayflowImportConflictError) conflicts.push(sourceId); else failed.push(sourceId); }
    }
    this.previews.delete(token); this.schedulePreviewPurge(); return { imported, skipped, conflicts, failed };
  }); }
  async listOwnedNotes(input: { limit: number; cursor?: string }): Promise<OwnedNotesPage> { return this.listOwned(input.limit, input.cursor); }
  async forget(memoryId: string | ForgetRequest): Promise<ForgetResponse | { forgotten: string }> { const owned = typeof memoryId === 'string' ? memoryId : memoryId.memoryId; const result = await this.exclusive(async () => { const entry = this.deps.ledger?.entries().find((candidate) => candidate.memoryId === owned); if (!entry) throw new Error('OWNED_NOTE_NOT_FOUND'); if (entry.pendingCreateAt) throw new Error('PENDING_OPERATION'); if (entry.tombstonedAt) return; this.deps.ledger?.markPendingDelete(entry.sourceId, new Date((this.deps.now ?? Date.now)()).toISOString()); await this.deps.memoryClient.remove(owned); this.deps.ledger?.completeDelete(entry.sourceId); }); return typeof memoryId === 'string' ? { forgotten: owned } : { memoryId: owned, state: 'forgotten' }; }
  async disable(): Promise<DayflowPublicStatus> { this.generation++; this.abortActiveReaders(); this.config = { ...this.config, enabled: false, automaticImport: false }; this.deps.configStore?.write(this.config); this.previews.clear(); this.completedCommits.clear(); if (this.previewTimer) clearTimeout(this.previewTimer); this.previewTimer = undefined; return this.status(); }
  private exclusive<T>(operation: () => Promise<T>): Promise<T> { const next = this.commitQueue.then(operation, operation); this.commitQueue = next.then(() => undefined, () => undefined); return next; }
  dispose() { this.abortActiveReaders(); if (this.previewTimer) clearTimeout(this.previewTimer); this.previewTimer = undefined; this.previews.clear(); this.completedCommits.clear(); }
  private purgeExpiredPreviews() { const now = (this.deps.now ?? Date.now)(); for (const [key, value] of this.previews) if (Date.parse(value.expiresAt) <= now) this.previews.delete(key); for (const [key, value] of this.completedCommits) if (Date.parse(value.expiresAt) <= now) this.completedCommits.delete(key); }
  private schedulePreviewPurge() { if (this.previewTimer) clearTimeout(this.previewTimer); this.purgeExpiredPreviews(); const next = Math.min(...[...this.previews.values()].map((item) => Math.max(0, Date.parse(item.expiresAt) - (this.deps.now ?? Date.now)()))); if (!Number.isFinite(next)) return; this.previewTimer = setTimeout(() => { this.previewTimer = undefined; this.purgeExpiredPreviews(); this.schedulePreviewPurge(); }, next); this.previewTimer.unref?.(); }
  private currentDay(timeZone: string) { const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])); return `${values.year}-${values.month}-${values.day}`; }
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
    if (!this.config.enabled) throw new Error('DISABLED'); if (!this.config.timezone) throw new Error('TIMEZONE_REQUIRED');
    const generation = this.generation; const reader = this.source as DayflowSource & { readDay?: (request: DayflowReadRequest, signal?: AbortSignal) => Promise<QualifiedDayflowSnapshot> };
    const normalized = reader.readDay ? (await this.readQualified({ date, timeZone: this.config.timezone, sourceNamespace: this.config.sourceNamespace })).observations : normalizeFixtureExportDetailed(await this.source.read(), this.config.timezone);
    const observations = normalized.observations.map((item) => ({ ...item, sourceInstanceId: this.config.sourceNamespace }));
    if (!this.config.enabled || generation !== this.generation) throw new Error('PREVIEW_INVALIDATED');
    if (observations.length > this.config.maxRecordsPerRun) throw new Error('EXPORT_LIMIT');
    const excluded = new Set(this.config.exclusions.map((item) => item.slice('category:'.length))); const remaining = observations.filter((item) => !excluded.has(item.category ?? '') && !this.deps.ledger?.get(sourceIdFor(item))?.tombstonedAt);
    this.purgeExpiredPreviews(); if (this.previews.size >= 8) throw new Error('EXPORT_LIMIT');
    const preview = previewFor(remaining, (this.deps.now ?? Date.now)(), normalized.rejected); this.previews.set(preview.token, preview); this.schedulePreviewPurge(); return preview;
  }
  private publicPreview(preview: DayflowPreview, date: string, timeZone: string): PreviewResponse { return { token: preview.token, expiresAt: preview.expiresAt, date, timeZone, coverage: 'existing_cards', analysisCompleteness: 'unknown', candidates: preview.candidates.map(({ candidateId, summary, observedStart, observedEnd, category }) => ({ candidateId, summary, observedStart, ...(observedEnd === undefined ? {} : { observedEnd }), ...(category === undefined ? {} : { category }), trust: 'unverified' as const })), withheld: preview.rejected.map(({ recordIndex, reason }) => ({ recordIndex, code: reason === 'secret_like_content' ? 'SENSITIVE_CONTENT' as const : reason === 'empty_after_redaction' ? 'EMPTY_CONTENT' as const : 'SUMMARY_LIMIT' as const })) }; }
  private async readQualified(request: DayflowReadRequest): Promise<QualifiedDayflowSnapshot> {
    const reader = this.source as DayflowSource & { readDay?: (request: DayflowReadRequest, signal?: AbortSignal) => Promise<QualifiedDayflowSnapshot> };
    if (!reader.readDay) throw new Error('SOURCE_UNVERIFIED');
    const controller = new AbortController(); this.readerControllers.add(controller);
    try { return await reader.readDay(request, controller.signal); }
    finally { this.readerControllers.delete(controller); }
  }
  private abortActiveReaders() { for (const controller of this.readerControllers) controller.abort(); }
  private fingerprint(artifact: VerifiedDayflowArtifact): string { return createHash('sha256').update(`${artifact.canonicalPath}\u0000${artifact.executable}\u0000${artifact.fileIdentity}\u0000${artifact.digest}\u0000${artifact.signingFingerprint}`).digest('base64url'); }
}
function isCalendarDay(value: string): boolean { const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value); if (!match) return false; const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))); return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]); }
