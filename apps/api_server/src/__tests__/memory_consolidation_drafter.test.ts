/**
 * CONTRACT TESTS — Issue #859b: memory consolidation pass.
 *
 * Mirrors `skill_consolidation_drafter.ts` (#852): a new service that scans
 * the current vault-derived memory index, clusters memories that overlap
 * above a similarity threshold WITHIN the same kind, merges each cluster into
 * one canonical note (preserving unique nuance from every member), retires
 * the redundant notes (vault file removed + index row removed), and returns a
 * before-snapshot so the whole pass is reversible.
 *
 * Acceptance criteria proven here:
 *   AC1: a cluster of overlapping memories (same kind, high similarity) is
 *        merged into ONE canonical note; the others are retired (vault file
 *        deleted, index row removed).
 *   AC2: distinct memories (low similarity, or different kind) are left
 *        completely untouched — consolidation must not over-merge.
 *   AC3: the merged note's body contains the distinguishing content from
 *        every member of the cluster (nothing silently lost).
 *   AC4: the pass returns a before-snapshot capturing exactly what existed
 *        pre-merge, and a `revertConsolidation` restores every retired note
 *        and undoes the merge — a full round-trip back to the pre-pass state.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { MemoryIndexService } from '../services/memory_index_service';
import { rememberToVault, generateUlid, renderMemoryNote } from '../services/memoryVaultWriteService';
import {
  runMemoryConsolidation,
  revertMemoryConsolidation,
} from '../services/memory_consolidation_drafter';
import { parseMemoryNote } from '../services/memory_note_format';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

let vaultRoot: string;
let memoryDir: string;
let repo: AgentMemoryRepository;
let index: MemoryIndexService;
let savedMemoryVaultSubdir: string | undefined;

function allNoteFiles(): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, name.name);
      if (name.isDirectory()) walk(full);
      else if (name.name.endsWith('.md')) out.push(path.relative(vaultRoot, full));
    }
  }
  walk(memoryDir);
  return out;
}

function fileFor(rel: string): string {
  return path.join(vaultRoot, rel);
}

beforeEach(() => {
  savedMemoryVaultSubdir = process.env.MEMORY_VAULT_SUBDIR;
  delete process.env.MEMORY_VAULT_SUBDIR;
  setDb(makeDb());
  repo = new AgentMemoryRepository();
  index = new MemoryIndexService(repo);
  vaultRoot = mkdtempSync(path.join(tmpdir(), 'memconsolidate-test-'));
  memoryDir = path.join(vaultRoot, 'memory');
});

afterEach(() => {
  if (savedMemoryVaultSubdir === undefined) delete process.env.MEMORY_VAULT_SUBDIR;
  else process.env.MEMORY_VAULT_SUBDIR = savedMemoryVaultSubdir;
  try {
    rmSync(vaultRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

/**
 * Write two OVERLAPPING notes directly to the vault filesystem + index,
 * bypassing `rememberToVault` (and therefore its #859a merge-on-capture)
 * entirely — simulating notes that already existed side-by-side BEFORE the
 * consolidation pass ever ran (e.g. authored independently, or written
 * before merge-on-capture existed). This isolates "did the CONSOLIDATION
 * PASS do the merging" from "did merge-on-capture do it at write time"
 * (#859a), even though both features share the same underlying similarity
 * signal and the SAME threshold.
 */
async function seedPreExistingOverlappingNotes() {
  const kindDir = path.join(memoryDir, 'fact');
  mkdirSync(kindDir, { recursive: true });

  const idA = generateUlid(1000);
  const relA = path.join('memory', 'fact', 'note-a.md');
  writeFileSync(
    path.join(vaultRoot, relA),
    renderMemoryNote(
      { id: idA, kind: 'fact', tags: [], created: '2026-01-01', updated: '2026-01-01', source: 'agent' },
      'The reservation calendar lives in the facilities module.',
    ),
    'utf8',
  );
  await index.upsertNote({
    sourceId: relA,
    parsed: { kind: 'fact', tags: [], content: 'The reservation calendar lives in the facilities module.' },
  });

  const idB = generateUlid(2000);
  const relB = path.join('memory', 'fact', 'note-b.md');
  writeFileSync(
    path.join(vaultRoot, relB),
    renderMemoryNote(
      { id: idB, kind: 'fact', tags: [], created: '2026-01-02', updated: '2026-01-02', source: 'agent' },
      'Facilities module houses the reservation calendar feature for booking rooms.',
    ),
    'utf8',
  );
  await index.upsertNote({
    sourceId: relB,
    parsed: { kind: 'fact', tags: [], content: 'Facilities module houses the reservation calendar feature for booking rooms.' },
  });
}

describe('memory consolidation pass (#859b)', () => {
  it('AC1+AC3: merges an overlapping cluster into one canonical note, preserving unique nuance', async () => {
    await seedPreExistingOverlappingNotes();
    expect(allNoteFiles()).toHaveLength(2);

    const result = await runMemoryConsolidation({ memoryDir, index, repo });

    expect(result.mergedClusters).toBeGreaterThanOrEqual(1);
    expect(result.retiredCount).toBeGreaterThanOrEqual(1);
    expect(allNoteFiles()).toHaveLength(1);

    const rows = await repo.listAsync(undefined, undefined, 100);
    expect(rows).toHaveLength(1);

    const merged = readFileSync(fileFor(rows[0].sourceId!), 'utf8');
    // Nuance from the second note ("booking rooms") must survive the merge.
    expect(merged.toLowerCase()).toContain('booking');
  });

  it('AC2: distinct memories (different themes) are left completely untouched', async () => {
    await rememberToVault(
      { kind: 'fact', content: 'The reservation calendar lives in the facilities module.' },
      { memoryDir, index },
    );
    await rememberToVault(
      { kind: 'preference', content: 'AJ wants agents to run autonomously with rollback, never asking for routine confirmations.' },
      { memoryDir, index },
    );
    await rememberToVault(
      { kind: 'fact', content: 'The desktop app is built with Flutter and targets macOS.' },
      { memoryDir, index },
    );

    const before = allNoteFiles().slice().sort();
    const result = await runMemoryConsolidation({ memoryDir, index, repo });

    expect(result.mergedClusters).toBe(0);
    expect(result.retiredCount).toBe(0);
    expect(allNoteFiles().slice().sort()).toEqual(before);
    expect(await repo.listAsync(undefined, undefined, 100)).toHaveLength(3);
  });

  it('AC4: the pass is reversible via a before-snapshot', async () => {
    await seedPreExistingOverlappingNotes();
    const beforeFiles = allNoteFiles().slice().sort();
    const beforeBytes = new Map(
      beforeFiles.map((rel) => [rel, readFileSync(fileFor(rel), 'utf8')]),
    );
    const beforeRows = await repo.listAsync(undefined, undefined, 100);

    const result = await runMemoryConsolidation({ memoryDir, index, repo });
    expect(result.beforeSnapshot).toBeDefined();
    expect(allNoteFiles()).toHaveLength(1);

    await revertMemoryConsolidation(result.beforeSnapshot, { memoryDir, index, repo });

    const afterRevertFiles = allNoteFiles().slice().sort();
    expect(afterRevertFiles).toEqual(beforeFiles);
    for (const rel of afterRevertFiles) {
      expect(readFileSync(fileFor(rel), 'utf8')).toBe(beforeBytes.get(rel));
    }
    const afterRevertRows = await repo.listAsync(undefined, undefined, 100);
    expect(afterRevertRows).toHaveLength(beforeRows.length);
  });

  it('#1187: consolidation preserves unknown survivor frontmatter', async () => {
    await seedPreExistingOverlappingNotes();
    const survivorPath = path.join(vaultRoot, 'memory', 'fact', 'note-a.md');
    const withUnknown = readFileSync(survivorPath, 'utf8').replace(
      /^source: agent$/m,
      ['source: agent', 'future_extension:', '  nested: retained'].join('\n'),
    );
    writeFileSync(survivorPath, withUnknown, 'utf8');

    await runMemoryConsolidation({ memoryDir, index, repo });

    const rewritten = readFileSync(survivorPath, 'utf8');
    expect(rewritten).toContain('future_extension:');
    expect(rewritten).toContain('nested: retained');
  });

  it('#1188: consolidation merges lifecycle metadata and stamps its process actor', async () => {
    await seedPreExistingOverlappingNotes();
    const survivorPath = path.join(vaultRoot, 'memory', 'fact', 'note-a.md');
    const retireePath = path.join(vaultRoot, 'memory', 'fact', 'note-b.md');
    writeFileSync(
      survivorPath,
      readFileSync(survivorPath, 'utf8').replace(
        /^source: agent$/m,
        [
          'source: agent',
          'status: deprecated',
          'stale_after: 2026-10-01',
          'verified:',
          '  - { by: "agent:reviewer/2", at: 2026-07-26T10:00:00Z }',
        ].join('\n'),
      ),
      'utf8',
    );
    writeFileSync(
      retireePath,
      readFileSync(retireePath, 'utf8').replace(
        /^source: agent$/m,
        [
          'source: agent',
          'status: stable',
          'stale_after: 2026-09-01',
          'verified:',
          '  - { by: "human:ajh", at: 2026-07-26T11:00:00Z }',
        ].join('\n'),
      ),
      'utf8',
    );

    await runMemoryConsolidation({ memoryDir, index, repo });

    const merged = parseMemoryNote(readFileSync(survivorPath, 'utf8'));
    expect(merged.status).toBe('stable');
    expect(merged.staleAfter).toBe('2026-09-01');
    expect(merged.verified).toEqual([
      {
        by: 'agent:reviewer/2',
        at: '2026-07-26T10:00:00.000Z',
      },
      {
        by: 'human:ajh',
        at: '2026-07-26T11:00:00.000Z',
      },
    ]);
    expect(merged.generated).toMatchObject({
      by: 'process:consolidation',
    });
  });
});
