/**
 * CONTRACT TESTS — Issue #802 (memory epic #801): MemoryIndexService treats the
 * SQLite agent_memory store as a DERIVED, DISPOSABLE index rebuildable from a
 * full vault scan.
 *
 * Real in-memory SQLite + real repository + real index service. No module mocks.
 * A TEMP FIXTURE vault directory is created per-test — NEVER the real
 * ~/Documents/Memory-Vault.
 *
 * Acceptance criteria proven here:
 *   1. rebuildIndexFromVault(tmpVault) over N notes → exactly N rows, each
 *      matching the note's parsed kind/content/tags.
 *   2. Idempotent — running it twice yields identical rows (count + content),
 *      no dupes.
 *   3. Rebuildable — after a rebuild, clearing all rows and rebuilding
 *      reproduces the same searchAsync(query) top-N results.
 *   4. Boundary — missing / empty vault path is a no-op (zero rows), not an
 *      error.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { MemoryIndexService } from '../services/memory_index_service';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

let vaultDir: string;
let repo: AgentMemoryRepository;
let index: MemoryIndexService;

function note(name: string, body: string): void {
  const full = path.join(vaultDir, name);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body, 'utf8');
}

beforeEach(() => {
  setDb(makeDb());
  repo = new AgentMemoryRepository();
  index = new MemoryIndexService(repo);
  vaultDir = mkdtempSync(path.join(tmpdir(), 'memindex-test-'));
});

afterEach(() => {
  try {
    rmSync(vaultDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('MemoryIndexService.rebuildIndexFromVault (#802)', () => {
  it('AC1: rebuild over N notes leaves exactly N rows matching parsed fields', async () => {
    note(
      'aj.md',
      ['---', 'kind: person', 'tags: [staff, leadership]', '---', 'AJ leads the team.'].join('\n'),
    );
    note('rhythm.md', ['---', 'kind: project', '---', 'Rhythm is the church app.'].join('\n'));
    note('plain.md', 'A bare fact with no frontmatter.');

    const summary = await index.rebuildIndexFromVault(vaultDir);
    expect(summary).toEqual({ indexed: 3 });

    const rows = await repo.listAsync(undefined, undefined, 100);
    expect(rows).toHaveLength(3);

    const bySourceId = new Map(rows.map((r) => [r.sourceId, r]));
    const aj = bySourceId.get('aj.md')!;
    expect(aj.kind).toBe('person');
    expect(aj.content).toBe('AJ leads the team.');
    expect(JSON.parse(aj.tagsJson)).toEqual(['staff', 'leadership']);
    expect(aj.source).toBe('obsidian-memory');

    const rhythm = bySourceId.get('rhythm.md')!;
    expect(rhythm.kind).toBe('project');
    expect(rhythm.content).toBe('Rhythm is the church app.');

    const plain = bySourceId.get('plain.md')!;
    expect(plain.kind).toBe('fact');
    expect(plain.content).toBe('A bare fact with no frontmatter.');
  });

  it('AC2: idempotent — running twice yields identical rows, no dupes', async () => {
    note('a.md', ['---', 'kind: fact', '---', 'Alpha.'].join('\n'));
    note('b.md', ['---', 'kind: fact', '---', 'Bravo.'].join('\n'));

    const first = await index.rebuildIndexFromVault(vaultDir);
    expect(first.indexed).toBe(2);
    const after1 = await repo.listAsync(undefined, undefined, 100);
    expect(after1).toHaveLength(2);

    const second = await index.rebuildIndexFromVault(vaultDir);
    expect(second.indexed).toBe(2);
    const after2 = await repo.listAsync(undefined, undefined, 100);

    expect(after2).toHaveLength(2);
    // Same set of (sourceId, content) — no duplicate rows after a re-run.
    const norm = (rs: { sourceId: string | null; content: string }[]) =>
      rs.map((r) => `${r.sourceId}::${r.content}`).sort();
    expect(norm(after2)).toEqual(norm(after1));
  });

  it('AC3: rebuildable — clear + rebuild reproduces the same searchAsync top-N', async () => {
    note('facilities.md', ['---', 'kind: fact', '---', 'The facilities reservation system uses Postgres.'].join('\n'));
    note('tasks.md', ['---', 'kind: fact', '---', 'Tasks have a due date and a facilities link.'].join('\n'));
    note('unrelated.md', ['---', 'kind: fact', '---', 'Coffee is brewed each morning.'].join('\n'));

    await index.rebuildIndexFromVault(vaultDir);
    const before = await repo.searchAsync('facilities', undefined, 20);
    expect(before.length).toBeGreaterThanOrEqual(1);
    const beforeKeys = before.map((r) => r.sourceId);

    // Disposable: wipe every row, then rebuild from the same vault.
    const cleared = await repo.clearAllAsync();
    expect(cleared).toBe(3);
    expect(await repo.listAsync(undefined, undefined, 100)).toHaveLength(0);

    await index.rebuildIndexFromVault(vaultDir);
    const after = await repo.searchAsync('facilities', undefined, 20);
    const afterKeys = after.map((r) => r.sourceId);

    expect(afterKeys).toEqual(beforeKeys);
    expect(after.map((r) => r.content)).toEqual(before.map((r) => r.content));
  });

  it('AC4: missing vault path is a no-op (zero rows), not an error', async () => {
    const missing = path.join(vaultDir, 'does-not-exist');
    const summary = await index.rebuildIndexFromVault(missing);
    expect(summary).toEqual({ indexed: 0 });
    expect(await repo.listAsync(undefined, undefined, 100)).toHaveLength(0);
  });

  it('AC4: empty vault directory is a no-op (zero rows)', async () => {
    const summary = await index.rebuildIndexFromVault(vaultDir);
    expect(summary).toEqual({ indexed: 0 });
    expect(await repo.listAsync(undefined, undefined, 100)).toHaveLength(0);
  });

  it('rebuild drops rows for notes that no longer exist in the vault', async () => {
    note('keep.md', ['---', 'kind: fact', '---', 'Keep me.'].join('\n'));
    note('drop.md', ['---', 'kind: fact', '---', 'Drop me.'].join('\n'));
    await index.rebuildIndexFromVault(vaultDir);
    expect(await repo.listAsync(undefined, undefined, 100)).toHaveLength(2);

    rmSync(path.join(vaultDir, 'drop.md'));
    const summary = await index.rebuildIndexFromVault(vaultDir);
    expect(summary.indexed).toBe(1);
    const rows = await repo.listAsync(undefined, undefined, 100);
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceId).toBe('keep.md');
  });
});

describe('MemoryIndexService incremental ops (#802, foundation for #803)', () => {
  it('upsertNote inserts then updates in place (no dupe)', async () => {
    await index.upsertNote({ sourceId: 'x.md', parsed: { kind: 'fact', tags: ['t'], content: 'v1' } });
    let rows = await repo.listAsync(undefined, undefined, 100);
    expect(rows).toHaveLength(1);
    const id = rows[0].id;

    await index.upsertNote({ sourceId: 'x.md', parsed: { kind: 'fact', tags: ['t'], content: 'v2' } });
    rows = await repo.listAsync(undefined, undefined, 100);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(id);
    expect(rows[0].content).toBe('v2');
  });

  it('removeNote deletes the indexed row and is a no-op when absent', async () => {
    await index.upsertNote({ sourceId: 'y.md', parsed: { kind: 'fact', tags: [], content: 'bye' } });
    expect(await repo.listAsync(undefined, undefined, 100)).toHaveLength(1);

    const removed = await index.removeNote('y.md');
    expect(removed).toBe(1);
    expect(await repo.listAsync(undefined, undefined, 100)).toHaveLength(0);

    expect(await index.removeNote('y.md')).toBe(0);
  });
});
