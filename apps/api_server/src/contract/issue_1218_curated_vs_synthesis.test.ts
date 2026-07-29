import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import {
  AgentMemoryRepository,
  type AgentMemory,
} from '../repositories/agent_memory_repository';
import { MemoryIndexService } from '../services/memory_index_service';
import { getRelevantMemories } from '../services/memory_retrieval';
import { syncMemoryVault } from '../services/memoryVaultSyncService';

let vaultPath: string;

function memory(overrides: Partial<AgentMemory>): AgentMemory {
  return {
    id: 'memory-id',
    kind: 'fact',
    content: 'The launch checklist requires a rollback rehearsal.',
    source: 'obsidian-memory',
    sourceId: 'fact/launch-checklist.md',
    tagsJson: '[]',
    status: 'stable',
    staleAfter: null,
    verifiedJson: '[]',
    sourcesJson: '[]',
    generatedBy: null,
    generatedAt: null,
    trustTier: 'human',
    ownerUserId: 42,
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
    ...overrides,
  };
}

function writeNote(relativePath: string, body: string, kind = 'fact'): void {
  const fullPath = path.join(vaultPath, relativePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `---\nkind: ${kind}\ntags: [launch]\n---\n${body}\n`);
}

beforeEach(() => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  vaultPath = mkdtempSync(path.join(tmpdir(), 'issue-1218-vault-'));
});

afterEach(() => {
  rmSync(vaultPath, { recursive: true, force: true });
});

describe('issue #1218 curated-vs-synthesis retrieval contract', () => {
  it('issue-1218-c1: synthesis documents remain explicitly searchable', async () => {
    writeNote(
      'synthesis/2026-07-28.md',
      'Launch checklist rollback rehearsal findings and supporting session detail. '.repeat(80),
    );
    await syncMemoryVault({ vaultPath });

    const results = await new AgentMemoryRepository().searchAsync('rollback', undefined, 20);
    expect(results.some((row) => row.sourceId === 'synthesis/2026-07-28.md')).toBe(true);
  });

  it('issue-1218-c2: synthesis paths are classified separately during vault sync', async () => {
    writeNote('synthesis/2026-07-28.md', 'Daily launch synthesis.', 'fact');
    writeNote('fact/launch-checklist.md', 'Rollback rehearsal is required.', 'fact');
    await syncMemoryVault({ vaultPath });

    const rows = await new AgentMemoryRepository().listAsync(undefined, undefined, 20);
    expect(rows.find((row) => row.sourceId === 'synthesis/2026-07-28.md')?.kind).toBe('synthesis');
    expect(rows.find((row) => row.sourceId === 'fact/launch-checklist.md')?.kind).toBe('fact');
  });

  it('issue-1218-c3: prompt retrieval prioritizes concise curated memories', async () => {
    const synthesis = memory({
      id: 'synthesis',
      kind: 'synthesis',
      content: 'Launch checklist rollback rehearsal supporting detail. '.repeat(100),
      sourceId: 'synthesis/2026-07-28.md',
      trustTier: 'human',
    });
    const curated = memory({ id: 'curated' });
    const repo = {
      searchAsync: async () => [synthesis, curated],
      findBySourceIdsAsync: async () => [],
    };

    const results = await getRelevantMemories('launch rollback', 42, 5, repo);
    expect(results.map((row) => row.id)).toEqual(['curated', 'synthesis']);
  });

  it('issue-1218-c4: atomic memory outranks a large synthesis document', async () => {
    const synthesis = memory({
      id: 'large-synthesis',
      kind: 'synthesis',
      content: 'rollback launch '.repeat(1000),
      sourceId: 'synthesis/2026-07-28.md',
    });
    const atomic = memory({
      id: 'atomic',
      content: 'The launch checklist requires a rollback rehearsal.',
    });
    const repo = {
      searchAsync: async () => [synthesis, atomic],
      findBySourceIdsAsync: async () => [],
    };

    const [first] = await getRelevantMemories('launch rollback', 42, 2, repo);
    expect(first.id).toBe('atomic');
  });

  it('issue-1218-c5: ranked results preserve the vault-relative source path', async () => {
    const curated = memory({ id: 'curated', sourceId: 'preference/release-process.md' });
    const repo = {
      searchAsync: async () => [curated],
      findBySourceIdsAsync: async () => [],
    };

    const [result] = await getRelevantMemories('release process', 42, 1, repo);
    expect(result.source).toBe('obsidian-memory');
    expect(result.sourceId).toBe('preference/release-process.md');
  });

  it('issue-1218-c6: repeated reindexing is deterministic and leaves vault files unchanged', async () => {
    writeNote('synthesis/2026-07-28.md', 'Daily launch synthesis.', 'fact');
    const notePath = path.join(vaultPath, 'synthesis/2026-07-28.md');
    const original = readFileSync(notePath, 'utf8');
    const index = new MemoryIndexService(new AgentMemoryRepository());

    await index.rebuildIndexFromVault(vaultPath);
    const first = await new AgentMemoryRepository().listAsync(undefined, undefined, 20);
    await index.rebuildIndexFromVault(vaultPath);
    const second = await new AgentMemoryRepository().listAsync(undefined, undefined, 20);

    expect(second.map(({ kind, content, sourceId, ownerUserId }) => ({
      kind, content, sourceId, ownerUserId,
    }))).toEqual(first.map(({ kind, content, sourceId, ownerUserId }) => ({
      kind, content, sourceId, ownerUserId,
    })));
    expect(readFileSync(notePath, 'utf8')).toBe(original);
  });

  it('issue-1218-c7: ranking never crosses owner scope', async () => {
    const own = memory({ id: 'own', ownerUserId: 42 });
    const other = memory({ id: 'other', ownerUserId: 7 });
    const repo = {
      searchAsync: async () => [other, own],
      findBySourceIdsAsync: async () => [],
    };

    const results = await getRelevantMemories('launch rollback', 42, 5, repo);
    expect(results.map((row) => row.id)).toEqual(['own']);
  });
});
