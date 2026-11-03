import { describe, expect, it } from 'vitest';

import { createDayflowManagementAdapter } from '../integrations/dayflow/management_adapter';
import type { DayflowIntegrationService } from '../integrations/dayflow/service';

const candidateId = 'a'.repeat(64);

function fakeService(overrides: Record<string, unknown> = {}) {
  return {
    status: () => ({ enabled: false, automaticImport: false, readiness: { state: 'ready', source: { label: 'Dayflow', version: '2.6.0', build: '133', path: '/private/secret' }, code: null }, canPreview: false, importedCount: 0, pendingCreateCount: 0, pendingDeleteCount: 0, diagnostics: 'SENTINEL' }),
    readiness: () => ({ state: 'ready', source: { label: 'Dayflow', version: '2.6.0', build: '133' }, code: null }),
    checkReadiness: () => ({ state: 'ready', source: { label: 'Dayflow', version: '2.6.0', build: '133' }, code: null, selectionToken: 'token', expiresAt: '2026-10-02T00:00:00.000Z' }),
    selectionFingerprint: () => 'f'.repeat(43),
    applyVerifiedSelection: async () => {},
    revalidateAppliedSelection: async () => {},
    getConfig: () => ({ enabled: false, automaticImport: false, timezone: 'UTC', rolloverHour: 4, exclusions: [], maxRecordsPerRun: 100, source: { label: 'Dayflow', version: '2.6.0', build: '133' }, executablePath: '/private/secret', sourceNamespace: 'SENTINEL' }),
    updateConfig: () => ({ enabled: false, automaticImport: false, timezone: 'UTC', rolloverHour: 4, exclusions: [], maxRecordsPerRun: 100, source: null }),
    preview: () => ({ token: 'preview-token', expiresAt: '2026-10-02T00:00:00.000Z', date: '2026-10-02', timeZone: 'UTC', coverage: 'existing_cards', analysisCompleteness: 'unknown', candidates: [{ candidateId, summary: 'safe', observedStart: '2026-10-02T00:00:00Z', trust: 'unverified' }], withheld: [] }),
    commit: () => ({ items: [] }),
    listOwnedNotes: () => ({ items: [], nextCursor: null, total: 0 }),
    forget: (input: { memoryId: string }) => ({ memoryId: input.memoryId, state: 'forgotten' }),
    disable: () => ({ enabled: false, automaticImport: false, readiness: { state: 'unconfigured', source: null, code: 'SOURCE_UNVERIFIED' }, canPreview: false, importedCount: 0, pendingCreateCount: 0, pendingDeleteCount: 0 }),
    ...overrides,
  } as unknown as DayflowIntegrationService;
}

describe('Dayflow management adapter projection', () => {
  it('drops internal paths, namespaces, diagnostics, and extra source fields', () => {
    const adapter = createDayflowManagementAdapter(fakeService());
    expect(adapter.status()).toEqual({ enabled: false, automaticImport: false, readiness: { state: 'ready', source: { label: 'Dayflow', version: '2.6.0', build: '133' }, code: null }, canPreview: false, importedCount: 0, pendingCreateCount: 0, pendingDeleteCount: 0 });
    expect(adapter.getConfig()).toEqual({ enabled: false, automaticImport: false, timezone: 'UTC', rolloverHour: 4, exclusions: [], maxRecordsPerRun: 100, source: { label: 'Dayflow', version: '2.6.0', build: '133' } });
  });

  it('rejects a public preview beyond 256 KiB before serialization', async () => {
    const adapter = createDayflowManagementAdapter(fakeService({
      preview: () => ({ token: 'preview-token', expiresAt: '2026-10-02T00:00:00.000Z', date: '2026-10-02', timeZone: 'UTC', coverage: 'existing_cards', analysisCompleteness: 'unknown', candidates: Array.from({ length: 70 }, () => ({ candidateId, summary: 'x'.repeat(4_000), observedStart: '2026-10-02T00:00:00Z', trust: 'unverified' })), withheld: [] }),
    }), { token: () => 't'.repeat(32) });
    const selected = await adapter.checkReadiness({ bundlePath: '/fixture/Dayflow.app' });
    await adapter.updateConfig({ sourceSelectionToken: selected.selectionToken! });
    await expect(adapter.preview({ date: '2026-10-02' })).rejects.toThrow('EXPORT_LIMIT');
  });

  it('requires a current opaque selection token before enable or source access', async () => {
    let time = 0;
    const adapter = createDayflowManagementAdapter(fakeService(), { now: () => time, token: () => 's'.repeat(32) });
    await expect(adapter.updateConfig({ enabled: true })).rejects.toThrow('SOURCE_UNVERIFIED');
    const checked = await adapter.checkReadiness({ bundlePath: '/fixture/Dayflow.app' });
    expect(checked).toMatchObject({ selectionToken: 's'.repeat(32), expiresAt: '1970-01-01T00:05:00.000Z' });
    await adapter.updateConfig({ sourceSelectionToken: checked.selectionToken! });
    await expect(adapter.preview({ date: '2026-10-02' })).resolves.toMatchObject({ date: '2026-10-02' });

    const expiring = await adapter.checkReadiness({ bundlePath: '/fixture/Dayflow.app' });
    time = 5 * 60_000;
    await expect(adapter.updateConfig({ sourceSelectionToken: expiring.selectionToken! })).rejects.toThrow('SOURCE_CHANGED');
  });

  it('invalidates a pending token after a configuration revision but retains an applied binding', async () => {
    let sequence = 0;
    const adapter = createDayflowManagementAdapter(fakeService(), { token: () => `${++sequence}`.padStart(32, 's') });
    const stale = await adapter.checkReadiness({ bundlePath: '/fixture/Dayflow.app' });
    await adapter.updateConfig({ exclusions: ['category:private'] });
    await expect(adapter.updateConfig({ sourceSelectionToken: stale.selectionToken! })).rejects.toThrow('SOURCE_CHANGED');

    const current = await adapter.checkReadiness({ bundlePath: '/fixture/Dayflow.app' });
    await adapter.updateConfig({ sourceSelectionToken: current.selectionToken! });
    await adapter.updateConfig({ timezone: 'America/Los_Angeles' });
    await expect(adapter.preview({ date: '2026-10-02' })).resolves.toMatchObject({ date: '2026-10-02' });
  });
});
