import { describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DayflowIntegrationService } from '../integrations/dayflow/service';
import { MemoryLedger } from '../integrations/dayflow/ledger';
import { DayflowConfigStore } from '../integrations/dayflow/config_store';
import type { DayflowMemoryClient } from '../integrations/dayflow/memory_client';
import type { DayflowSource } from '../integrations/dayflow/types';
import type { QualifiedDayflowSnapshot } from '../integrations/dayflow/cli_source';
import { DayflowCliSource } from '../integrations/dayflow/cli_source';
import type { DayflowArtifactVerifier } from '../integrations/dayflow/cli_source';

const source: DayflowSource = { read: async () => ({ contractVersion: 'fixture-v1', sourceInstanceId: 'synthetic-mac', records: [
  { id: 'first', start: '2026-10-01T08:00:00-04:00', summary: 'Prepare service notes' },
  { id: 'second', start: '2026-10-01T09:00:00-04:00', summary: 'Review reports' },
] }) };

class FakeMemoryClient implements DayflowMemoryClient {
  writes: Array<{ id: string; content: string }> = [];
  deletes: string[] = [];
  async create(input: { id: string; content: string }) { this.writes.push(input); return { id: input.id }; }
  async remove(id: string) { this.deletes.push(id); }
}

describe('Dayflow import lifecycle contracts', () => {
  it('keeps the default source unconfigured and cannot enable or preview it', async () => {
    const service = new DayflowIntegrationService({ source: new DayflowCliSource(), memoryClient: new FakeMemoryClient(), ledger: new MemoryLedger() });
    expect(service.status()).toMatchObject({ enabled: false, readiness: { state: 'unconfigured', code: 'SOURCE_UNVERIFIED' } });
    await expect(service.updateConfig({ enabled: true, timezone: 'UTC' })).rejects.toThrow('SOURCE_UNVERIFIED');
    await expect(service.preview({ date: '2026-10-01' })).rejects.toThrow('SOURCE_UNVERIFIED');
  });

  it('attests the submitted bundle path before issuing a private selection fingerprint', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dayflow-attestation-')); const bundle = join(root, 'Dayflow.app'); const helper = join(bundle, 'Contents', 'Helpers', 'dayflow'); mkdirSync(join(bundle, 'Contents', 'Helpers'), { recursive: true }); writeFileSync(helper, 'synthetic only'); chmodSync(helper, 0o700);
    const canonical = realpathSync(bundle); const executable = realpathSync(helper); const calls: string[] = [];
    const verifier: DayflowArtifactVerifier = { verify: async (path) => { calls.push(path); return { canonicalPath: canonical, executable, fileIdentity: 'synthetic-id', digest: 'a'.repeat(64), signingFingerprint: 'b'.repeat(40), bundleId: 'teleportlabs.com.Dayflow', version: '2.6.0', build: 133 }; } };
    try {
      const service = new DayflowIntegrationService({ source: new DayflowCliSource(), memoryClient: new FakeMemoryClient(), ledger: new MemoryLedger(), artifactVerifier: verifier, sourceForArtifact: () => ({ read: async () => ({ contractVersion: 'fixture-v1', sourceInstanceId: 'synthetic', records: [] }) }) });
      expect(await service.checkReadiness({ bundlePath: bundle })).toMatchObject({ state: 'ready', source: { label: 'Dayflow' } });
      const fingerprint = service.selectionFingerprint(); expect(fingerprint).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(calls).toEqual([canonical]);
      await service.applyVerifiedSelection(fingerprint!); await service.revalidateAppliedSelection();
      expect(calls).toEqual([canonical, canonical, canonical]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('DF-01/04: default-off blocks preview and a selected preview writes only selected candidates', async () => {
    const client = new FakeMemoryClient();
    const service = new DayflowIntegrationService({ source, memoryClient: client, ledger: new MemoryLedger() });
    await expect(service.preview()).rejects.toThrow(/disabled/i);
    await service.updateConfig({ enabled: true, timezone: 'America/New_York' });
    const preview = await service.preview();
    expect(preview.candidates).toHaveLength(2);
    await service.commit(preview.token, [preview.candidates[0].candidateId]);
    expect(client.writes).toHaveLength(1);
    expect(client.writes[0].content).toContain('Prepare service notes');
  });

  it('uses the same bounded lifecycle for dated public previews and commit replay', async () => {
    const client = new FakeMemoryClient(); const qualified: DayflowSource = { ...source, hasVerifiedBinding: () => true } as DayflowSource;
    const service = new DayflowIntegrationService({ source: qualified, memoryClient: client, ledger: new MemoryLedger() });
    await service.updateConfig({ enabled: true, timezone: 'America/New_York', exclusions: ['category:private'] });
    const preview = await service.preview({ date: '2026-10-01' }); expect(preview.candidates).toHaveLength(2);
    const request = { token: preview.token, candidateIds: [preview.candidates[0].candidateId] }; const first = await service.commit(request);
    expect(first.items).toEqual([{ candidateId: preview.candidates[0].candidateId, state: 'imported', memoryId: client.writes[0].id }]); await expect(service.commit(request)).resolves.toEqual(first); expect(client.writes).toHaveLength(1);
    const capped = new DayflowIntegrationService({ source: qualified, memoryClient: new FakeMemoryClient(), ledger: new MemoryLedger() }); await capped.updateConfig({ enabled: true, timezone: 'UTC', maxRecordsPerRun: 1 }); await expect(capped.preview({ date: '2026-10-01' })).rejects.toThrow('EXPORT_LIMIT');
  });

  it('DF-05/06: replay is idempotent; different source cards with equal text remain distinct', async () => {
    const client = new FakeMemoryClient();
    const service = new DayflowIntegrationService({ source: { read: async () => ({ contractVersion: 'fixture-v1', sourceInstanceId: 'synthetic-mac', records: [{ id: 'one', start: '2026-10-01T08:00:00-04:00', summary: 'same' }, { id: 'two', start: '2026-10-01T09:00:00-04:00', summary: 'same' }] }) }, memoryClient: client, ledger: new MemoryLedger() });
    await service.updateConfig({ enabled: true, timezone: 'America/New_York' });
    const first = await service.preview();
    await service.commit(first.token, first.candidates.map((c) => c.candidateId));
    const replay = await service.preview();
    await service.commit(replay.token, replay.candidates.map((c) => c.candidateId));
    expect(client.writes).toHaveLength(2);
    expect(new Set(client.writes.map((w) => w.id)).size).toBe(2);
  });

  it('DF-08/09: explicit forget affects only owned notes, tombstones prevent replay, and disable blocks commits', async () => {
    const client = new FakeMemoryClient();
    const service = new DayflowIntegrationService({ source, memoryClient: client, ledger: new MemoryLedger() });
    await service.updateConfig({ enabled: true, timezone: 'America/New_York' });
    const preview = await service.preview();
    await service.commit(preview.token, [preview.candidates[0].candidateId]);
    const memoryId = client.writes[0].id;
    await expect(service.forget('manual-note')).rejects.toThrow('OWNED_NOTE_NOT_FOUND');
    await service.forget(memoryId);
    expect(client.deletes).toEqual([memoryId]);
    const replay = await service.preview();
    expect(replay.candidates.map((c) => c.recordId)).not.toContain('first');
    await service.disable();
    await expect(service.commit(replay.token, [])).rejects.toThrow(/disabled/i);
  });

  it('persists a disabled namespace before binding and preserves it across restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'dayflow-inactive-config-'));
    try {
      const configPath = join(root, 'config.json');
      const ledgerPath = join(root, 'ledger.json');
      const first = new DayflowIntegrationService({ source, memoryClient: new FakeMemoryClient(), configStore: new DayflowConfigStore(configPath), ledger: new MemoryLedger(ledgerPath) });
      expect(first.status()).toMatchObject({ enabled: false, readiness: { state: 'unconfigured' } });
      expect(existsSync(configPath)).toBe(true);
      const namespace = JSON.parse(readFileSync(configPath, 'utf8')).sourceNamespace;
      const second = new DayflowIntegrationService({ source, memoryClient: new FakeMemoryClient(), configStore: new DayflowConfigStore(configPath), ledger: new MemoryLedger(ledgerPath) });
      expect(second.privateConfig().sourceNamespace).toBe(namespace);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('aborts held qualified reads on config change, disable, and shutdown before they can publish', async () => {
    let started!: () => void; const begun = new Promise<void>((resolve) => { started = resolve; });
    const held = { read: async () => ({ contractVersion: 'fixture-v1' as const, sourceInstanceId: 'legacy', records: [] }), readDay: async (_request: unknown, signal?: AbortSignal) => new Promise<QualifiedDayflowSnapshot>((_resolve, reject) => { started(); signal?.addEventListener('abort', () => reject(new Error('READER_CANCELLED')), { once: true }); }) } as DayflowSource & { readDay: (request: unknown, signal?: AbortSignal) => Promise<QualifiedDayflowSnapshot> };
    const service = new DayflowIntegrationService({ source: held, memoryClient: new FakeMemoryClient(), ledger: new MemoryLedger() });
    await service.updateConfig({ enabled: true, timezone: 'UTC' }); const pending = service.previewDate('2026-10-01'); await begun;
    await service.updateConfig({ exclusions: ['category:private'] }); await expect(pending).rejects.toThrow('READER_CANCELLED');
    const pendingDisable = service.previewDate('2026-10-01'); await service.disable(); await expect(pendingDisable).rejects.toThrow('READER_CANCELLED');
    await service.updateConfig({ enabled: true, timezone: 'UTC' }); const pendingShutdown = service.previewDate('2026-10-01'); service.dispose(); await expect(pendingShutdown).rejects.toThrow('READER_CANCELLED');
  });
});
