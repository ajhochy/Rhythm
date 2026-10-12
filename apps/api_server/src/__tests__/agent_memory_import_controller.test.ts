import { describe, expect, it } from 'vitest';
import { createObservationImportController, validateObservationImport } from '../controllers/agent_memory_import_controller';
import { MemoryCreateOnlyError, type CreateOnlyObservationInput } from '../services/memoryVaultWriteService';

const request = { schemaVersion: 1 as const, operationId: 'operation_0123456789', id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', content: 'Unverified synthetic observation', source: { id: 'dayflow_abc', resource: 'dayflow://card/abc', revision: 'a'.repeat(64), exportVersion: 'fixture-v1' as const, observedAt: '2026-10-01T08:00:00Z' }, usageWindow: { from: '2026-10-01', to: '2026-10-01' } };
describe('create-only observation import controller', () => {
  it('rejects unsafe controls and validates bounded observations before core invocation', () => {
    expect(() => validateObservationImport({ ...request, actor: 'admin' })).toThrow('INVALID_OBSERVATION_IMPORT');
    expect(() => validateObservationImport({ ...request, usageWindow: { from: '2026-02-30', to: '2026-02-30' } })).toThrow('INVALID_OBSERVATION_IMPORT');
  });
  it('maps only a typed create-only receipt and preserves operation correlation', async () => {
    const importObservation = async (input: CreateOnlyObservationInput) => {
      expect(input.sources).toEqual([expect.objectContaining({
        origin: 'dayflow',
        observationId: request.source.id,
        observedAt: request.source.observedAt,
        observed_at: request.source.observedAt,
      })]);
      return { id: request.id, path: 'memory/context/import-01arz3ndektsv4rrffq69g5fav.md', kind: 'context' as const, disposition: 'created' as const, canonicalContentHash: 'b'.repeat(64), sourceRevision: request.source.revision, normalizerVersion: 'fixture-v1' };
    };
    const controller = createObservationImportController(importObservation);
    await expect(controller(request)).resolves.toMatchObject({ schemaVersion: 1, operationId: request.operationId, disposition: 'created' });
  });
  it('does not turn canonical conflict into success', async () => {
    const controller = createObservationImportController(async () => { throw new MemoryCreateOnlyError('MEMORY_CREATE_CONFLICT'); });
    await expect(controller(request)).rejects.toMatchObject({ code: 'MEMORY_CREATE_CONFLICT' });
  });
});
