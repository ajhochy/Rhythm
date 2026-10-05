import { createHash } from 'node:crypto';
import type { DayflowObservation } from './types';

export class DayflowImportConflictError extends Error { constructor() { super('Dayflow canonical import conflict.'); this.name = 'DayflowImportConflictError'; } }

export interface DayflowMemoryClient {
  create(input: { id: string; content: string; sourceId: string; observation: DayflowObservation }): Promise<{ id: string }>;
  remove(id: string): Promise<void>;
  createOnly?(input: { operationId: string; id: string; content: string; sourceId: string; observation: DayflowObservation }): Promise<{ id: string; disposition: 'created' | 'already_present'; canonicalContentHash: string; /** Private canonical vault key from the server receipt. */ canonicalSourceKey?: string }>;
}

/** Local API client; dependency-inject a fake in tests. No hosted Settings URL is accepted. */
export class LocalDayflowMemoryClient implements DayflowMemoryClient {
  constructor(private readonly baseUrl = 'http://127.0.0.1:4001') {}
  async create(input: { id: string; content: string; sourceId: string; observation: DayflowObservation }) {
    const footnoteId = `dayflow_${createHash('sha256').update(input.sourceId).digest('hex').slice(0, 32)}`;
    const response = await fetch(`${this.baseUrl}/agent-memory`, { method: 'POST', signal: AbortSignal.timeout(10_000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: input.id, kind: 'context', content: input.content, source: 'dayflow', sourceId: input.sourceId, sources: [{ id: footnoteId, resource: `dayflow://card/${encodeURIComponent(input.sourceId)}`, revision: input.observation.revisionHash, observedAt: input.observation.observedStart, exportVersion: input.observation.exportVersion }], usageWindow: { from: input.observation.dayKey, to: input.observation.dayKey }, tags: ['dayflow', 'activity-observation'] }) });
    if (!response.ok) throw new Error('Dayflow canonical memory write failed.');
    const body: unknown = await response.json().catch(() => null);
    if (!body || typeof body !== 'object' || typeof (body as { id?: unknown }).id !== 'string') throw new Error('Dayflow canonical memory response is invalid.');
    return { id: (body as { id: string }).id };
  }
  async createOnly(input: { operationId: string; id: string; content: string; sourceId: string; observation: DayflowObservation }) {
    const footnoteId = `dayflow_${createHash('sha256').update(input.sourceId).digest('hex').slice(0, 32)}`;
    const response = await fetch(`${this.baseUrl}/agent-memory/import-observation`, { method: 'POST', signal: AbortSignal.timeout(10_000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ schemaVersion: 1, operationId: input.operationId, id: input.id, content: input.content, source: { id: footnoteId, resource: `dayflow://card/${encodeURIComponent(input.sourceId)}`, revision: input.observation.revisionHash, exportVersion: input.observation.exportVersion, observedAt: input.observation.observedStart, observedEnd: input.observation.observedEnd }, usageWindow: { from: input.observation.dayKey, to: input.observation.dayKey } }) });
    if (response.status === 409) throw new DayflowImportConflictError(); if (!response.ok) throw new Error('Dayflow canonical import uncertain.');
    const body = await response.json().catch(() => null) as { schemaVersion?: unknown; operationId?: unknown; id?: unknown; path?: unknown; disposition?: unknown; canonicalContentHash?: unknown; sourceRevision?: unknown; exportVersion?: unknown } | null;
    if (!body || body.schemaVersion !== 1 || body.operationId !== input.operationId || body.id !== input.id || typeof body.path !== 'string' || !/^(?:memory\/)?[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/.test(body.path) || body.path.includes('..') || body.path.includes('//') || (body.disposition !== 'created' && body.disposition !== 'already_present') || typeof body.canonicalContentHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.canonicalContentHash) || body.sourceRevision !== input.observation.revisionHash || body.exportVersion !== input.observation.exportVersion) throw new Error('Dayflow canonical import receipt is invalid.');
    const disposition: 'created' | 'already_present' = body.disposition === 'created' ? 'created' : 'already_present';
    return { id: input.id, disposition, canonicalContentHash: body.canonicalContentHash, canonicalSourceKey: body.path };
  }
  async remove(id: string) { const response = await fetch(`${this.baseUrl}/agent-memory/${encodeURIComponent(id)}`, { method: 'DELETE', signal: AbortSignal.timeout(10_000) }); if (!response.ok && response.status !== 404) throw new Error('Dayflow canonical memory deletion failed.'); }
}
