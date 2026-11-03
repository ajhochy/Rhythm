import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';

import { DayflowConfigStore } from '../integrations/dayflow/config_store';
import { MemoryLedger } from '../integrations/dayflow/ledger';
import { createDayflowManagementAdapter } from '../integrations/dayflow/management_adapter';
import { DayflowIntegrationService } from '../integrations/dayflow/service';
import { DayflowSqliteSource, DayflowSqliteSourceError, verifyDayflowJournal } from '../integrations/dayflow/sqlite_source';
import type { DayflowSource } from '../integrations/dayflow/types';

const roots: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixtureJournal() {
  const root = mkdtempSync(join(tmpdir(), 'dayflow-sqlite-'));
  roots.push(root);
  const journalPath = join(root, 'chunks.sqlite');
  const db = new Database(journalPath);
  db.exec(`
    CREATE TABLE timeline_cards (
      id INTEGER PRIMARY KEY, start_ts INTEGER, end_ts INTEGER,
      title TEXT, summary TEXT, detailed_summary TEXT,
      category TEXT, subcategory TEXT, metadata TEXT, is_deleted INTEGER
    );
  `);
  return { root, journalPath, db };
}

function insert(db: Database.Database, input: {
  id: number;
  start: string;
  end?: string;
  summary?: string;
  title?: string;
  category?: string;
  deleted?: number;
}) {
  db.prepare(`
    INSERT INTO timeline_cards (
      id, start_ts, end_ts, title, summary, detailed_summary,
      category, subcategory, metadata, is_deleted
    ) VALUES (?, ?, ?, ?, ?, '', ?, '', '{}', ?)
  `).run(
    input.id,
    Math.floor(Date.parse(input.start) / 1_000),
    Math.floor(Date.parse(input.end ?? input.start) / 1_000),
    input.title ?? '', input.summary ?? '', input.category ?? '', input.deleted ?? 0,
  );
}

describe('Dayflow first-party SQLite reader', () => {
  it('uses the upstream 04:00 start window, filters soft deletes, and reads a live WAL without immutable mode', async () => {
    const { journalPath, db } = fixtureJournal();
    db.pragma('journal_mode = WAL');
    // In America/New_York on the fall-back day, 04:00 is 09:00 UTC.
    insert(db, { id: 1, start: '2026-11-01T08:59:59Z', summary: 'before window' });
    insert(db, { id: 2, start: '2026-11-01T09:00:00Z', summary: 'inside WAL', category: 'work' });
    insert(db, { id: 3, start: '2026-11-01T10:00:00Z', summary: 'deleted', deleted: 1 });
    expect(existsSync(`${journalPath}-wal`)).toBe(true);

    const binding = verifyDayflowJournal(journalPath);
    const result = await new DayflowSqliteSource(binding).readDay({
      date: '2026-11-01', timeZone: 'America/New_York', sourceNamespace: 'test-namespace',
    });

    expect(result).toMatchObject({ qualified: true, cardCount: 1, request: { date: '2026-11-01' } });
    expect(result.observations.observations).toMatchObject([
      { recordId: '2', summary: 'inside WAL', dayKey: '2026-11-01', category: 'work' },
    ]);
    db.close();
  });

  it('fails closed for an unsupported schema and never creates a writable journal sidecar', () => {
    const root = mkdtempSync(join(tmpdir(), 'dayflow-schema-'));
    roots.push(root);
    const journalPath = join(root, 'chunks.sqlite');
    new Database(journalPath).close();
    expect(() => verifyDayflowJournal(journalPath)).toThrow(DayflowSqliteSourceError);
    expect(existsSync(`${journalPath}-journal`)).toBe(false);
  });

  it('fails closed on an oversized SQLite field without returning that field to Node', async () => {
    const { journalPath, db } = fixtureJournal();
    insert(db, { id: 1, start: '2026-10-02T04:00:00Z', summary: 'x'.repeat(16 * 1024 + 1) });
    const source = new DayflowSqliteSource(verifyDayflowJournal(journalPath));
    await expect(source.readDay({ date: '2026-10-02', timeZone: 'UTC', sourceNamespace: 'test-namespace' }))
      .rejects.toThrow('oversized or unsupported text');
    db.close();
  });

  it('persists a private journal selection and revalidates it on restart without serializing its path', async () => {
    const { root, journalPath, db } = fixtureJournal();
    insert(db, { id: 1, start: '2026-10-02T04:00:00Z', summary: 'restart-safe' });
    db.close();
    const configPath = join(root, 'state', 'config.json');
    const ledgerPath = join(root, 'state', 'ledger.json');
    const build = () => new DayflowIntegrationService({
      source: new DayflowSqliteSource(),
      memoryClient: { create: async (input) => ({ id: input.id }), remove: async () => {} },
      configStore: new DayflowConfigStore(configPath),
      ledger: new MemoryLedger(ledgerPath),
      journalVerifier: { verify: verifyDayflowJournal },
      sourceForJournal: (journal) => new DayflowSqliteSource(journal),
    });

    const first = createDayflowManagementAdapter(build(), { token: () => 's'.repeat(32) });
    const selected = await first.checkReadiness({ bundlePath: journalPath });
    await first.updateConfig({ sourceSelectionToken: selected.selectionToken!, timezone: 'UTC', exclusions: ['category:private'] });
    await first.updateConfig({ enabled: true });

    const second = createDayflowManagementAdapter(build());
    expect(await second.getConfig()).toEqual(expect.objectContaining({
      enabled: true, timezone: 'UTC', exclusions: ['category:private'],
      source: { label: 'Dayflow journal', version: '2.6.0', build: '133' },
    }));
    expect(await second.preview({ date: '2026-10-02' })).toMatchObject({
      candidates: [expect.objectContaining({ summary: 'restart-safe' })],
    });
    expect(JSON.stringify(await second.getConfig())).not.toContain(journalPath);
    expect(statSync(configPath).mode & 0o077).toBe(0);
    expect(JSON.parse(readFileSync(configPath, 'utf8')).journalBinding).toEqual(expect.objectContaining({
      fileIdentity: expect.stringMatching(/^\d+:\d+$/), schemaFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
  });

  it('requires renewed selection after a compatible replacement at the same path', async () => {
    const { root, journalPath, db } = fixtureJournal();
    insert(db, { id: 1, start: '2026-10-02T04:00:00Z', summary: 'original' });
    db.close();
    const configPath = join(root, 'state', 'config.json');
    const build = () => new DayflowIntegrationService({
      source: new DayflowSqliteSource(),
      memoryClient: { create: async (input) => ({ id: input.id }), remove: async () => {} },
      configStore: new DayflowConfigStore(configPath),
      ledger: new MemoryLedger(join(root, 'state', 'ledger.json')),
      journalVerifier: { verify: verifyDayflowJournal },
      sourceForJournal: (journal) => new DayflowSqliteSource(journal),
    });
    const first = createDayflowManagementAdapter(build(), { token: () => 'r'.repeat(32) });
    const initial = await first.checkReadiness({ bundlePath: journalPath });
    await first.updateConfig({ sourceSelectionToken: initial.selectionToken!, timezone: 'UTC' });
    await first.updateConfig({ enabled: true });

    const replacementPath = join(root, 'replacement.sqlite');
    const replacement = new Database(replacementPath);
    replacement.exec(`CREATE TABLE timeline_cards (
      id INTEGER PRIMARY KEY, start_ts INTEGER, end_ts INTEGER,
      title TEXT, summary TEXT, detailed_summary TEXT,
      category TEXT, subcategory TEXT, metadata TEXT, is_deleted INTEGER
    );`);
    insert(replacement, { id: 2, start: '2026-10-02T04:00:00Z', summary: 'replacement' });
    replacement.close();
    renameSync(replacementPath, journalPath);

    const restarted = createDayflowManagementAdapter(build(), { token: () => 'n'.repeat(32) });
    expect((await restarted.status()).readiness).toMatchObject({ state: 'missing', code: 'SOURCE_MISSING' });
    await expect(restarted.updateConfig({ enabled: true })).rejects.toThrow('SOURCE_UNVERIFIED');
    const renewed = await restarted.checkReadiness({ bundlePath: journalPath });
    await restarted.updateConfig({ sourceSelectionToken: renewed.selectionToken!, timezone: 'UTC' });
    await restarted.updateConfig({ enabled: true });
    expect(await restarted.preview({ date: '2026-10-02' })).toMatchObject({ candidates: [expect.objectContaining({ summary: 'replacement' })] });
  });

  it('rejects a journal switch after an owned record exists', async () => {
    const { root, journalPath, db } = fixtureJournal();
    insert(db, { id: 1, start: '2026-10-02T04:00:00Z', summary: 'owned' });
    db.close();
    const service = new DayflowIntegrationService({
      source: new DayflowSqliteSource(),
      memoryClient: { create: async (input) => ({ id: input.id }), remove: async () => {} },
      configStore: new DayflowConfigStore(join(root, 'state', 'config.json')),
      ledger: new MemoryLedger(join(root, 'state', 'ledger.json')),
      journalVerifier: { verify: verifyDayflowJournal },
      sourceForJournal: (journal) => new DayflowSqliteSource(journal),
    });
    const adapter = createDayflowManagementAdapter(service, { token: () => 'o'.repeat(32) });
    const selected = await adapter.checkReadiness({ bundlePath: journalPath });
    await adapter.updateConfig({ sourceSelectionToken: selected.selectionToken!, timezone: 'UTC' });
    await adapter.updateConfig({ enabled: true });
    const preview = await adapter.preview({ date: '2026-10-02' });
    await adapter.commit({ token: preview.token, candidateIds: preview.candidates.map((candidate) => candidate.candidateId) });

    const other = fixtureJournal();
    other.db.close();
    const switchAttempt = await adapter.checkReadiness({ bundlePath: other.journalPath });
    await expect(adapter.updateConfig({ sourceSelectionToken: switchAttempt.selectionToken!, timezone: 'UTC' })).rejects.toThrow('SOURCE_CHANGED');
    expect((await adapter.getConfig()).enabled).toBe(true);
  });

  it('keeps automatic rescan off by default, then uses the same create-only import path and stops on disable', async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const service = new DayflowIntegrationService({
      source: ({
        read: async () => ({
          contractVersion: 'fixture-v1' as const,
          sourceInstanceId: 'synthetic',
          records: [{ id: 'one', start: '2026-10-02T04:00:00Z', summary: 'scheduled observation' }],
        }),
      } as DayflowSource),
      memoryClient: {
        create: async () => { throw new Error('automatic import must use the create-only seam'); },
        createOnly: async (input) => { writes.push(input.id); return { id: input.id, disposition: 'created' as const, canonicalContentHash: 'a'.repeat(64) }; },
        remove: async () => {},
      },
      ledger: new MemoryLedger(),
    });
    expect(service.status().automaticImport).toBe(false);
    await service.updateConfig({ enabled: true, timezone: 'UTC', automaticImport: true });
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(writes).toHaveLength(1);
    await service.disable();
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(writes).toHaveLength(1);
    service.dispose();
  });

  it('uses the current 04:00 activity day plus two prior days for automatic rescans', async () => {
    vi.useFakeTimers();
    const requested: string[] = [];
    const service = new DayflowIntegrationService({
      source: ({
        read: async () => ({ contractVersion: 'fixture-v1' as const, sourceInstanceId: 'synthetic', records: [] }),
        readDay: async (request: { date: string; timeZone: string; sourceNamespace: string }) => {
          requested.push(request.date);
          return { request, schemaVersion: 1 as const, dayBoundaryHour: 4 as const, cardCount: 0, qualified: true as const, raw: {}, observations: { observations: [], rejected: [] } };
        },
      } as DayflowSource),
      memoryClient: { create: async (input) => ({ id: input.id }), remove: async () => {} },
      ledger: new MemoryLedger(),
      now: () => Date.parse('2026-10-03T02:30:00Z'),
    });
    await service.updateConfig({ enabled: true, timezone: 'UTC', automaticImport: true });
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(requested).toEqual(['2026-10-02', '2026-10-01', '2026-09-30']);
    service.dispose();
  });

  it('does not finalize a ledger write or reschedule work after terminal dispose', async () => {
    vi.useFakeTimers();
    let beginCreate!: () => void;
    let finishCreate!: () => void;
    const begun = new Promise<void>((resolve) => { beginCreate = resolve; });
    const creation = new Promise<{ id: string }>((resolve) => { finishCreate = () => resolve({ id: '01ARZ3NDEKTSV4RRFFQ69G5FAV' }); });
    const ledger = new MemoryLedger();
    const service = new DayflowIntegrationService({
      source: { read: async () => ({ contractVersion: 'fixture-v1' as const, sourceInstanceId: 'synthetic', records: [{ id: 'one', start: '2026-10-02T04:00:00Z', summary: 'dispose race' }] }) },
      memoryClient: { create: async () => { beginCreate(); return creation; }, remove: async () => {} },
      ledger,
    });
    await service.updateConfig({ enabled: true, timezone: 'UTC' });
    const preview = await service.preview();
    const committing = service.commit(preview.token, preview.candidates.map((candidate) => candidate.candidateId));
    await begun;
    service.dispose();
    finishCreate();
    await committing;
    expect(ledger.entries()).toEqual([expect.objectContaining({ pendingCreateAt: expect.any(String) })]);
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(ledger.entries()).toHaveLength(1);
  });
});
