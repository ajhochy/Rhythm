import { describe, expect, it } from 'vitest';
import { DayflowIntegrationService } from '../integrations/dayflow/service';
import { MemoryLedger } from '../integrations/dayflow/ledger';
import { LocalDayflowMemoryClient } from '../integrations/dayflow/memory_client';
import { normalizeFixtureExport } from '../integrations/dayflow/normalize';
import { sourceIdFor } from '../integrations/dayflow/plan';

const record = { id: 'one', start: '2026-10-01T08:00:00Z', summary: 'Review notes', category: 'private' };
const fixture = (records = [record]) => ({ contractVersion: 'fixture-v1' as const, sourceInstanceId: 'synthetic-mac', records });
const memory = () => ({ create: async (input: { id: string }) => ({ id: input.id }), remove: async () => {} });

describe('Independent Dayflow safety regressions (synthetic only)', () => {
  it('writes source labels accepted by the canonical API pattern', async () => {
    const originalFetch = globalThis.fetch; let payload: Record<string, unknown> = {};
    globalThis.fetch = async (_url, options) => { payload = JSON.parse(String(options?.body)); return new Response('{"id":"01ARZ3NDEKTSV4RRFFQ69G5FAV"}', { status: 201 }); };
    try { const observation = normalizeFixtureExport(fixture(), 'UTC')[0]; await new LocalDayflowMemoryClient().create({ id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', content: 'Synthetic observation', sourceId: 'synthetic-mac:one', observation }); expect((payload.sources as Array<{ id: string }>)[0].id).toMatch(/^[A-Za-z0-9_-]+$/); }
    finally { globalThis.fetch = originalFetch; }
  });
  it('rejects a malformed end timestamp', () => expect(() => normalizeFixtureExport(fixture([{ ...record, end: 'not-a-date' } as typeof record & { end: string }]), 'UTC')).toThrow());
  it('honors configured category exclusions before preview', async () => { const service = new DayflowIntegrationService({ source: { read: async () => fixture() }, memoryClient: memory(), ledger: new MemoryLedger() }); await service.updateConfig({ enabled: true, timezone: 'UTC', exclusions: ['category:private'] }); expect((await service.preview()).candidates).toHaveLength(0); });
  it('rejects nonboolean enable configuration from an HTTP-like body', async () => { const service = new DayflowIntegrationService({ source: { read: async () => fixture() }, memoryClient: memory(), ledger: new MemoryLedger() }); await expect(service.updateConfig({ enabled: 'false', timezone: 'UTC' } as never)).rejects.toThrow(); });
  it('blocks changed-card writes until correction is supported', async () => { let current = fixture(); const writes: string[] = []; const service = new DayflowIntegrationService({ source: { read: async () => current }, memoryClient: { create: async (input) => { writes.push(input.content); return { id: input.id }; }, remove: async () => {} }, ledger: new MemoryLedger() }); await service.updateConfig({ enabled: true, timezone: 'UTC' }); const first = await service.preview(); await service.commit(first.token, first.candidates.map((c) => c.candidateId)); current = fixture([{ ...record, summary: 'Changed summary' }]); const second = await service.preview(); const result = await service.commit(second.token, second.candidates.map((c) => c.candidateId)); expect(writes).toHaveLength(1); expect(result.conflicts).toHaveLength(1); });
  it('invalidates preview when its privacy configuration changes', async () => { const service = new DayflowIntegrationService({ source: { read: async () => fixture() }, memoryClient: memory(), ledger: new MemoryLedger() }); await service.updateConfig({ enabled: true, timezone: 'UTC' }); const preview = await service.preview(); await service.updateConfig({ exclusions: ['category:private'] }); await expect(service.commit(preview.token, preview.candidates.map((c) => c.candidateId))).rejects.toThrow(); });
  it('persists the returned ownership receipt before a racing Disable stops later writes', async () => { let release!: () => void; let started!: () => void; const began = new Promise<void>((resolve) => { started = resolve; }); const pending = new Promise<void>((resolve) => { release = resolve; }); const writes: string[] = []; const ledger = new MemoryLedger(); const service = new DayflowIntegrationService({ source: { read: async () => fixture([record, { ...record, id: 'two' }]) }, memoryClient: { create: async (input) => { writes.push(input.id); if (writes.length === 1) { started(); await pending; } return { id: input.id }; }, remove: async () => {} }, ledger }); await service.updateConfig({ enabled: true, timezone: 'UTC' }); const preview = await service.preview(); const commit = service.commit(preview.token, preview.candidates.map((c) => c.candidateId)); await began; await service.disable(); release(); await commit; expect(writes).toHaveLength(1); expect(ledger.get(sourceIdFor(preview.candidates[0]))?.memoryId).toBe(writes[0]); });
});
