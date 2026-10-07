import { createObservationIfAbsentInVault, MemoryCreateOnlyError, type CreateOnlyObservationResult } from '../services/memoryVaultWriteService';

export interface ImportObservationRequestV1 {
  schemaVersion: 1; operationId: string; id: string; content: string;
  source: { id: string; resource: string; revision: string; exportVersion: 'fixture-v1' | 'v2.6.0'; observedAt: string; observedEnd?: string };
  usageWindow: { from: string; to: string };
}
export interface ImportObservationReceiptV1 { schemaVersion: 1; operationId: string; id: string; path: string; disposition: 'created' | 'already_present'; canonicalContentHash: string; sourceRevision: string; exportVersion: 'fixture-v1' | 'v2.6.0'; }

const isoDay = /^\d{4}-\d{2}-\d{2}$/; const hash = /^[a-f0-9]{64}$/; const ulid = /^[0-9A-HJKMNP-TV-Z]{26}$/; const footnote = /^[A-Za-z0-9_-]{1,128}$/;
function validDay(value: unknown) { if (typeof value !== 'string' || !isoDay.test(value)) return false; const [y, m, d] = value.split('-').map(Number); const date = new Date(Date.UTC(y, m - 1, d)); return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d; }
function validTimestamp(value: unknown) { if (typeof value !== 'string') return false; const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:Z|[+-]\d{2}:\d{2})$/.exec(value); if (!m || +m[4] > 23 || +m[5] > 59 || +m[6] > 59) return false; return validDay(`${m[1]}-${m[2]}-${m[3]}`) && Number.isFinite(Date.parse(value)); }

export function validateObservationImport(body: unknown): ImportObservationRequestV1 {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('INVALID_OBSERVATION_IMPORT');
  const b = body as Record<string, unknown>; if (Object.keys(b).some((key) => !['schemaVersion', 'operationId', 'id', 'content', 'source', 'usageWindow'].includes(key))) throw new Error('INVALID_OBSERVATION_IMPORT');
  const source = b.source as Record<string, unknown>; const window = b.usageWindow as Record<string, unknown>;
  if (b.schemaVersion !== 1 || typeof b.operationId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(b.operationId) || typeof b.id !== 'string' || !ulid.test(b.id) || typeof b.content !== 'string' || b.content.length === 0 || b.content.length > 8000 || !source || typeof source !== 'object' || Array.isArray(source) || Object.keys(source).some((key) => !['id', 'resource', 'revision', 'exportVersion', 'observedAt', 'observedEnd'].includes(key)) || typeof source.id !== 'string' || !footnote.test(source.id) || typeof source.resource !== 'string' || source.resource.length > 2048 || !/^dayflow:\/\/card\/[A-Za-z0-9%._~\-]+$/.test(source.resource) || typeof source.revision !== 'string' || !hash.test(source.revision) || (source.exportVersion !== 'fixture-v1' && source.exportVersion !== 'v2.6.0') || !validTimestamp(source.observedAt) || (source.observedEnd !== undefined && (!validTimestamp(source.observedEnd) || Date.parse(source.observedEnd as string) < Date.parse(source.observedAt as string))) || !window || typeof window !== 'object' || Array.isArray(window) || Object.keys(window).some((key) => key !== 'from' && key !== 'to') || !validDay(window.from) || !validDay(window.to) || String(window.from) > String(window.to)) throw new Error('INVALID_OBSERVATION_IMPORT');
  return b as unknown as ImportObservationRequestV1;
}

export function createObservationImportController(importObservation: (input: Parameters<typeof createObservationIfAbsentInVault>[0]) => Promise<CreateOnlyObservationResult> = createObservationIfAbsentInVault) {
  return async (body: unknown): Promise<ImportObservationReceiptV1> => {
    const request = validateObservationImport(body);
    try {
      const source = {
        id: request.source.id,
        resource: request.source.resource,
        revision: request.source.revision,
        // Structured fields are server-fixed provenance, never caller controls.
        // Preserve the existing snake-case source contract for canonical replay.
        origin: 'dayflow',
        observationId: request.source.id,
        observedAt: request.source.observedAt,
        observed_at: request.source.observedAt,
        normalizer_version: request.source.exportVersion,
        ...(request.source.observedEnd ? { observed_end: request.source.observedEnd } : {}),
      };
      const result = await importObservation({ id: request.id, kind: 'context', content: request.content, source: 'dayflow', tags: ['dayflow', 'activity-observation'], usageWindow: request.usageWindow, sourceRevision: request.source.revision, normalizerVersion: request.source.exportVersion, sources: [source] });
      return { schemaVersion: 1, operationId: request.operationId, id: result.id, path: result.path, disposition: result.disposition, canonicalContentHash: result.canonicalContentHash, sourceRevision: result.sourceRevision, exportVersion: request.source.exportVersion };
    } catch (error) { if (error instanceof MemoryCreateOnlyError) throw error; throw new MemoryCreateOnlyError('MEMORY_CREATE_UNAVAILABLE'); }
  };
}

export function receiptMatchesRequest(receipt: ImportObservationReceiptV1, request: ImportObservationRequestV1) { return receipt.schemaVersion === 1 && receipt.operationId === request.operationId && receipt.id === request.id && (receipt.disposition === 'created' || receipt.disposition === 'already_present') && typeof receipt.path === 'string' && /^(?:memory\/)?[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/.test(receipt.path) && !receipt.path.includes('..') && hash.test(receipt.canonicalContentHash) && receipt.sourceRevision === request.source.revision && receipt.exportVersion === request.source.exportVersion; }
