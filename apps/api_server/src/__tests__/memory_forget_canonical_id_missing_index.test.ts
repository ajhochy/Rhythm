/** Canonical-ID deletion must not depend on a disposable derived index row. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { MemoryIndexService } from '../services/memory_index_service';
import {
  createObservationIfAbsentInVault,
  MemoryCanonicalDeleteError,
  rememberToVault,
  type CreateOnlyObservationInput,
} from '../services/memoryVaultWriteService';
import { agentMemoryService } from '../services/agentMemoryService';

let database: Database.Database;
let previous: Database.Database | null;
let vaultRoot: string;
let memoryDir: string;
let repo: AgentMemoryRepository;
let index: MemoryIndexService;

function observation(): CreateOnlyObservationInput {
  return {
    id: '01M3XGQPCZMYYNQM9FHJ5P1724',
    kind: 'context',
    content: 'Synthetic deletion marker must not resurface after rebuilding the index.',
    source: 'dayflow',
    tags: ['dayflow', 'activity-observation'],
    sources: [{
      id: 'dayflow_fixture', resource: 'dayflow://card/synthetic-delete',
      revision: 'revision-1', normalizer_version: 'fixture-v1',
    }],
    usageWindow: { from: '2026-10-01', to: '2026-10-01' },
    sourceRevision: 'revision-1', normalizerVersion: 'fixture-v1',
  };
}

beforeEach(() => {
  database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  runMigrations(database);
  previous = setDb(database);
  repo = new AgentMemoryRepository();
  index = new MemoryIndexService(repo);
  vaultRoot = mkdtempSync(path.join(tmpdir(), 'memforget-canonical-'));
  memoryDir = path.join(vaultRoot, 'memory');
});

afterEach(() => {
  setDb(previous);
  database.close();
  rmSync(vaultRoot, { recursive: true, force: true });
});

describe('canonical-id forget with a missing index projection', () => {
  it('deletes canonical truth and stays absent after an actual index rebuild', async () => {
    const receipt = await createObservationIfAbsentInVault(observation(), { memoryDir, index });
    const canonical = path.join(vaultRoot, receipt.path);
    await index.removeNote(receipt.path);
    expect(await repo.searchAsync('synthetic deletion marker', undefined, 10)).toHaveLength(0);

    expect(await agentMemoryService.forget(receipt.id, { memoryDir, index })).toBe(true);
    expect(existsSync(canonical)).toBe(false);

    await index.rebuildIndexFromVault(vaultRoot);
    expect(await repo.searchAsync('synthetic deletion marker', undefined, 10)).toHaveLength(0);
  });

  it('also resolves ordinary remember IDs with non-ID-qualified filenames when the index is missing', async () => {
    const receipt = await rememberToVault({
      kind: 'fact', content: 'Ordinary canonical deletion marker.',
    }, { memoryDir, index });
    await index.removeNote(receipt.path);

    expect(await agentMemoryService.forget(receipt.id, { memoryDir, index })).toBe(true);
    expect(existsSync(path.join(vaultRoot, receipt.path))).toBe(false);
  });

  it('returns false only for a genuinely unknown canonical ID', async () => {
    expect(await agentMemoryService.forget('01M3XGQPCZMYYNQM9FHJ5P1724', { memoryDir, index })).toBe(false);
  });

  it('refuses duplicate canonical IDs without deleting either file', async () => {
    const receipt = await createObservationIfAbsentInVault(observation(), { memoryDir, index });
    const original = path.join(vaultRoot, receipt.path);
    const duplicate = path.join(memoryDir, 'fact', 'nested', 'duplicate.md');
    mkdirSync(path.dirname(duplicate), { recursive: true });
    writeFileSync(duplicate, readFileSync(original, 'utf8'));
    await index.removeNote(receipt.path);

    await expect(agentMemoryService.forget(receipt.id, { memoryDir, index }))
      .rejects.toBeInstanceOf(MemoryCanonicalDeleteError);
    expect(existsSync(original)).toBe(true);
    expect(existsSync(duplicate)).toBe(true);
  });

  it('retries projection cleanup by durable ID/path evidence instead of falsely completing stale recall', async () => {
    const receipt = await createObservationIfAbsentInVault(observation(), { memoryDir, index });
    const failingIndex = {
      removeNote: async () => { throw new Error('synthetic projection outage'); },
    } as unknown as MemoryIndexService;

    await expect(agentMemoryService.forget(receipt.id, { memoryDir, index: failingIndex }))
      .rejects.toMatchObject({ code: 'MEMORY_DELETE_UNAVAILABLE' });
    expect(existsSync(path.join(vaultRoot, receipt.path))).toBe(false);
    expect(await repo.searchAsync('synthetic deletion marker', undefined, 10)).toHaveLength(1);

    expect(await agentMemoryService.forget(receipt.id, { memoryDir, index })).toBe(true);
    expect(await repo.searchAsync('synthetic deletion marker', undefined, 10)).toHaveLength(0);
  });

  it('does not finalize a pre-unlink recovery record while canonical truth still survives', async () => {
    const receipt = await createObservationIfAbsentInVault(observation(), { memoryDir, index });
    await index.removeNote(receipt.path);
    writeFileSync(
      path.join(memoryDir, '.rhythm-canonical-delete-recovery.json'),
      `${JSON.stringify({ version: 1, entries: { [receipt.id]: receipt.path } })}\n`,
    );

    await expect(agentMemoryService.forget(receipt.id, { memoryDir, index }))
      .rejects.toMatchObject({ code: 'MEMORY_DELETE_CONFLICT' });
    expect(existsSync(path.join(vaultRoot, receipt.path))).toBe(true);

    await index.rebuildIndexFromVault(vaultRoot);
    expect(await repo.searchAsync('synthetic deletion marker', undefined, 10)).toHaveLength(1);
  });

  it('applies the same surviving-canonical conflict guard when the derived row still exists', async () => {
    const receipt = await createObservationIfAbsentInVault(observation(), { memoryDir, index });
    const canonical = path.join(vaultRoot, receipt.path);
    const before = readFileSync(canonical, 'utf8').replace(
      'Synthetic deletion marker must not resurface after rebuilding the index.',
      'Human-edited canonical deletion marker must remain.',
    );
    writeFileSync(canonical, before);
    writeFileSync(
      path.join(memoryDir, '.rhythm-canonical-delete-recovery.json'),
      `${JSON.stringify({ version: 1, entries: { [receipt.id]: receipt.path } })}\n`,
    );

    await expect(agentMemoryService.forget(receipt.id, { memoryDir, index }))
      .rejects.toMatchObject({ code: 'MEMORY_DELETE_CONFLICT' });
    expect(readFileSync(canonical, 'utf8')).toBe(before);
    expect(await repo.searchAsync('synthetic deletion marker', undefined, 10)).toHaveLength(1);
  });
});
