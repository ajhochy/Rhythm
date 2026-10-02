import { randomBytes } from 'node:crypto';
import type { DayflowIntegrationService } from './service';
import {
  isDayflowErrorCode,
  type CommitRequest,
  type CommitResponse,
  type DayflowManagementService,
  type DayflowStatus,
  type ForgetRequest,
  type ForgetResponse,
  type OwnedNotesPage,
  type PreviewRequest,
  type PreviewResponse,
  type PublicDayflowConfig,
  type SourceCheckResponse,
  type SourceReadiness,
} from './public_contract';

const MEMORY_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const CANDIDATE_ID = /^[a-f0-9]{64}$/;
const MAX_PREVIEW_BYTES = 256 * 1024;
const SELECTION_TTL_MS = 5 * 60_000;

interface SelectionBinding {
  token: string;
  expiresAt: string;
  fingerprint: string;
  configRevision: number;
}

interface AppliedSelection {
  fingerprint: string;
  configRevision: number;
}

interface DayflowManagementAdapterOptions {
  now?: () => number;
  token?: () => string;
}

interface VerifiedSelectionService {
  selectionFingerprint(): string | undefined;
  applyVerifiedSelection(fingerprint: string): Promise<void>;
  revalidateAppliedSelection(): Promise<void>;
}

function contractFailure(): never {
  throw new Error('INTERNAL_ERROR');
}

function projectReadiness(value: unknown): SourceReadiness {
  if (!value || typeof value !== 'object' || Array.isArray(value)) contractFailure();
  const record = value as Record<string, unknown>;
  if (!['unconfigured', 'missing', 'unsupported', 'unverified', 'changed', 'ready'].includes(String(record.state)) || (record.code !== null && !isDayflowErrorCode(record.code))) contractFailure();
  if (record.source === null) return { state: record.state as SourceReadiness['state'], source: null, code: record.code as SourceReadiness['code'] };
  if (!record.source || typeof record.source !== 'object' || Array.isArray(record.source)) contractFailure();
  const source = record.source as Record<string, unknown>;
  if (typeof source.label !== 'string' || source.label.length === 0 || source.label.length > 160 || /[\\/]/.test(source.label) || source.version !== '2.6.0' || source.build !== '133') contractFailure();
  return { state: record.state as SourceReadiness['state'], source: { label: source.label, version: '2.6.0', build: '133' }, code: record.code as SourceReadiness['code'] };
}

function projectStatus(value: unknown): DayflowStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) contractFailure();
  const record = value as Record<string, unknown>;
  if (typeof record.enabled !== 'boolean' || record.automaticImport !== false || typeof record.canPreview !== 'boolean' || !Number.isInteger(record.importedCount) || !Number.isInteger(record.pendingCreateCount) || !Number.isInteger(record.pendingDeleteCount)) contractFailure();
  return { enabled: record.enabled, automaticImport: false, readiness: projectReadiness(record.readiness), canPreview: record.canPreview, importedCount: record.importedCount as number, pendingCreateCount: record.pendingCreateCount as number, pendingDeleteCount: record.pendingDeleteCount as number };
}

function projectCheck(value: unknown): SourceCheckResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) contractFailure();
  const record = value as Record<string, unknown>;
  const readiness = projectReadiness(record);
  if (record.selectionToken !== undefined && (readiness.state !== 'ready' || typeof record.selectionToken !== 'string' || record.selectionToken.length === 0 || record.selectionToken.length > 512)) contractFailure();
  if (record.expiresAt !== undefined && (readiness.state !== 'ready' || typeof record.expiresAt !== 'string' || !Number.isFinite(Date.parse(record.expiresAt)))) contractFailure();
  return { ...readiness, ...(record.selectionToken === undefined ? {} : { selectionToken: record.selectionToken as string }), ...(record.expiresAt === undefined ? {} : { expiresAt: record.expiresAt as string }) };
}

function projectConfig(value: unknown): PublicDayflowConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) contractFailure();
  const record = value as Record<string, unknown>;
  if (typeof record.enabled !== 'boolean' || record.automaticImport !== false || (record.timezone !== null && typeof record.timezone !== 'string') || record.rolloverHour !== 4 || !Array.isArray(record.exclusions) || record.exclusions.some((item) => typeof item !== 'string' || item.length > 256) || !Number.isInteger(record.maxRecordsPerRun) || Number(record.maxRecordsPerRun) < 1 || Number(record.maxRecordsPerRun) > 1_000) contractFailure();
  return { enabled: record.enabled, automaticImport: false, timezone: record.timezone as string | null, rolloverHour: 4, exclusions: [...record.exclusions] as string[], maxRecordsPerRun: record.maxRecordsPerRun as number, source: projectReadiness({ state: 'ready', source: record.source, code: null }).source };
}

function projectPreview(value: unknown): PreviewResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) contractFailure();
  const record = value as Record<string, unknown>;
  if (typeof record.token !== 'string' || record.token.length === 0 || record.token.length > 512 || typeof record.expiresAt !== 'string' || !Number.isFinite(Date.parse(record.expiresAt)) || typeof record.date !== 'string' || typeof record.timeZone !== 'string' || record.coverage !== 'existing_cards' || record.analysisCompleteness !== 'unknown' || !Array.isArray(record.candidates) || !Array.isArray(record.withheld) || record.candidates.length > 1_000 || record.withheld.length > 1_000) contractFailure();
  const candidates = record.candidates.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) contractFailure();
    const item = value as Record<string, unknown>;
    if (typeof item.candidateId !== 'string' || !CANDIDATE_ID.test(item.candidateId) || typeof item.summary !== 'string' || item.summary.length > 4_000 || typeof item.observedStart !== 'string' || (item.observedEnd !== undefined && typeof item.observedEnd !== 'string') || (item.category !== undefined && (typeof item.category !== 'string' || item.category.length > 256)) || item.trust !== 'unverified') contractFailure();
    return { candidateId: item.candidateId, summary: item.summary, observedStart: item.observedStart, ...(item.observedEnd === undefined ? {} : { observedEnd: item.observedEnd as string }), ...(item.category === undefined ? {} : { category: item.category as string }), trust: 'unverified' as const };
  });
  const withheld = record.withheld.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) contractFailure();
    const item = value as Record<string, unknown>;
    if (!Number.isInteger(item.recordIndex) || !['SENSITIVE_CONTENT', 'EMPTY_CONTENT', 'SUMMARY_LIMIT'].includes(String(item.code))) contractFailure();
    return { recordIndex: item.recordIndex as number, code: item.code as 'SENSITIVE_CONTENT' | 'EMPTY_CONTENT' | 'SUMMARY_LIMIT' };
  });
  const output: PreviewResponse = { token: record.token, expiresAt: record.expiresAt, date: record.date, timeZone: record.timeZone, coverage: 'existing_cards', analysisCompleteness: 'unknown', candidates, withheld };
  if (Buffer.byteLength(JSON.stringify(output), 'utf8') > MAX_PREVIEW_BYTES) throw new Error('EXPORT_LIMIT');
  return output;
}

function projectCommit(value: unknown): CommitResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray((value as Record<string, unknown>).items)) contractFailure();
  return { items: (value as { items: unknown[] }).items.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) contractFailure();
    const item = value as Record<string, unknown>;
    if (typeof item.candidateId !== 'string' || !CANDIDATE_ID.test(item.candidateId) || !['imported', 'skipped', 'conflict', 'pending'].includes(String(item.state)) || (item.memoryId !== undefined && (typeof item.memoryId !== 'string' || !MEMORY_ID.test(item.memoryId))) || (item.code !== undefined && !isDayflowErrorCode(item.code))) contractFailure();
    return { candidateId: item.candidateId, state: item.state as 'imported' | 'skipped' | 'conflict' | 'pending', ...(item.memoryId === undefined ? {} : { memoryId: item.memoryId as string }), ...(item.code === undefined ? {} : { code: item.code as CommitResponse['items'][number]['code'] }) };
  }) };
}

function projectPage(value: unknown): OwnedNotesPage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) contractFailure();
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.items) || record.items.length > 100 || (record.nextCursor !== null && (typeof record.nextCursor !== 'string' || record.nextCursor.length === 0 || record.nextCursor.length > 256)) || !Number.isInteger(record.total) || Number(record.total) < 0) contractFailure();
  return { items: record.items.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) contractFailure();
    const item = value as Record<string, unknown>;
    if (typeof item.memoryId !== 'string' || !MEMORY_ID.test(item.memoryId) || typeof item.importedAt !== 'string' || !Number.isFinite(Date.parse(item.importedAt)) || !['imported', 'pending_create', 'pending_delete'].includes(String(item.state))) contractFailure();
    return { memoryId: item.memoryId, importedAt: item.importedAt, state: item.state as 'imported' | 'pending_create' | 'pending_delete' };
  }), nextCursor: record.nextCursor as string | null, total: record.total as number };
}

function projectForget(value: unknown): ForgetResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) contractFailure();
  const record = value as Record<string, unknown>;
  if (typeof record.memoryId !== 'string' || !MEMORY_ID.test(record.memoryId) || record.state !== 'forgotten') contractFailure();
  return { memoryId: record.memoryId, state: 'forgotten' };
}

function sourceFingerprint(readiness: SourceReadiness): string | undefined {
  if (readiness.state !== 'ready' || !readiness.source) return undefined;
  return `${readiness.source.label}\u0000${readiness.source.version}\u0000${readiness.source.build}`;
}

/** Explicit composition seam from Terra's service to the router's public API. */
export function createDayflowManagementAdapter(
  service: DayflowIntegrationService,
  options: DayflowManagementAdapterOptions = {},
): DayflowManagementService {
  const now = options.now ?? Date.now;
  const nextToken = options.token ?? (() => randomBytes(32).toString('base64url'));
  let pendingSelection: SelectionBinding | undefined;
  let appliedSelection: AppliedSelection | undefined;
  // This is deliberately adapter-lifetime state: source selection tokens are
  // transient and must not outlive a configuration mutation or restart.
  let configRevision = 0;

  const verifiedService = service as unknown as Partial<VerifiedSelectionService>;
  const currentVerifiedFingerprint = () => verifiedService.selectionFingerprint?.();
  const requireAppliedSelection = async () => {
    const fingerprint = currentVerifiedFingerprint();
    if (!appliedSelection || appliedSelection.configRevision !== configRevision || !fingerprint || fingerprint !== appliedSelection.fingerprint || !verifiedService.revalidateAppliedSelection) throw new Error('SOURCE_UNVERIFIED');
    await verifiedService.revalidateAppliedSelection();
    if (currentVerifiedFingerprint() !== appliedSelection.fingerprint) throw new Error('SOURCE_CHANGED');
  };
  const advanceConfigRevision = (preserveAppliedSelection: boolean) => {
    configRevision++;
    pendingSelection = undefined;
    if (!preserveAppliedSelection || !appliedSelection || currentVerifiedFingerprint() !== appliedSelection.fingerprint) {
      appliedSelection = undefined;
      return;
    }
    appliedSelection = { ...appliedSelection, configRevision };
  };

  return {
    status: () => projectStatus(service.status()),
    readiness: () => projectReadiness(service.readiness()),
    checkReadiness: async (input) => {
      const checked = projectCheck(await service.checkReadiness(input));
      const fingerprint = currentVerifiedFingerprint();
      if (checked.state !== 'ready' || !fingerprint) {
        pendingSelection = undefined;
        return checked;
      }
      const token = nextToken();
      if (!/^[A-Za-z0-9_-]{32,512}$/.test(token)) contractFailure();
      const expiresAt = new Date(now() + SELECTION_TTL_MS).toISOString();
      pendingSelection = { token, expiresAt, fingerprint, configRevision };
      return { ...checked, selectionToken: token, expiresAt };
    },
    getConfig: () => projectConfig(service.getConfig()),
    updateConfig: async (patch) => {
      const selectionToken = patch.sourceSelectionToken;
      if (selectionToken !== undefined) {
        const pending = pendingSelection;
        const fingerprint = currentVerifiedFingerprint();
        if (!pending || pending.token !== selectionToken || pending.configRevision !== configRevision || Date.parse(pending.expiresAt) <= now() || !fingerprint || fingerprint !== pending.fingerprint) throw new Error('SOURCE_CHANGED');
        const { sourceSelectionToken: _ignored, ...withoutSelection } = patch;
        const result = await service.updateConfig({ ...withoutSelection, enabled: false });
        // Persisted configuration is deliberately disabled before a source is
        // bound. Once it succeeds, every other transient token is stale.
        advanceConfigRevision(false);
        if (!verifiedService.applyVerifiedSelection) throw new Error('SOURCE_UNVERIFIED');
        await verifiedService.applyVerifiedSelection(pending.fingerprint);
        if (currentVerifiedFingerprint() !== pending.fingerprint) throw new Error('SOURCE_CHANGED');
        appliedSelection = { fingerprint: pending.fingerprint, configRevision };
        // Re-read after binding so the public source projection reflects the
        // verified current source, never the pre-binding config snapshot.
        return projectConfig(service.getConfig() ?? result);
      }
      if (patch.enabled === true) await requireAppliedSelection();
      const result = await service.updateConfig(patch);
      advanceConfigRevision(true);
      return projectConfig(result);
    },
    preview: async (request: PreviewRequest) => {
      await requireAppliedSelection();
      return projectPreview(await service.preview(request));
    },
    commit: async (request: CommitRequest) => {
      await requireAppliedSelection();
      return projectCommit(await service.commit(request));
    },
    listOwnedNotes: async (input) => projectPage(await service.listOwnedNotes(input)),
    forget: async (input: ForgetRequest) => projectForget(await service.forget(input)),
    disable: async () => {
      const result = projectStatus(await service.disable());
      advanceConfigRevision(true);
      return result;
    },
  };
}
