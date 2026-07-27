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
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
  it('#1194: generates navigation after rebuild without ever indexing it', async () => {
    note(
      path.join('memory', 'fact', 'remembered.md'),
      ['---', 'kind: fact', '---', 'Remembered content.'].join('\n'),
    );

    const first = await index.rebuildIndexFromVault(vaultDir);
    expect(first).toEqual({ indexed: 1 });
    expect(readFileSync(path.join(vaultDir, 'memory', 'index.md'), 'utf8'))
      .toContain('okf_version: "0.2"');
    expect(readFileSync(path.join(vaultDir, 'memory', 'fact', 'index.md'), 'utf8'))
      .toContain('[Remembered](remembered.md) - Remembered content.');

    const second = await index.rebuildIndexFromVault(vaultDir);
    expect(second).toEqual({ indexed: 1 });
    const rows = await repo.listAsync(undefined, undefined, 100);
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceId).toBe(path.join('memory', 'fact', 'remembered.md'));
  });

  it('#1194: an unwritable navigation file does not fail the rebuild', async () => {
    note(
      path.join('memory', 'fact', 'kept.md'),
      ['---', 'kind: fact', '---', 'Kept content.'].join('\n'),
    );
    mkdirSync(path.join(vaultDir, 'memory', 'index.md'), { recursive: true });

    await expect(index.rebuildIndexFromVault(vaultDir))
      .resolves.toEqual({ indexed: 1 });
    const rows = await repo.listAsync(undefined, undefined, 100);
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe('Kept content.');
  });

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
    expect(existsSync(missing)).toBe(false);
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

describe('rebuildable guard — drop ALL index rows → rebuild → identical top-N (#808)', () => {
  // AC1 (issue #808): the index is rebuildable and DISPOSABLE. Capture a
  // searchAsync top-N, wipe every index row, rebuild from the same vault, and
  // assert the top-N is byte-identical (same order, same ids-by-path, same
  // content). This is the machine-checked promise that the index can be thrown
  // away and reproduced from the vault at any time.
  const TOP_N = 5;

  async function seedVault(): Promise<void> {
    note('budget.md', ['---', 'kind: fact', '---', 'The annual budget review is led by the elder board each spring.'].join('\n'));
    note('budget-followup.md', ['---', 'kind: fact', '---', 'Budget approvals over five thousand need two signatures.'].join('\n'));
    note('worship.md', ['---', 'kind: fact', '---', 'The worship team rehearses on Thursday evenings.'].join('\n'));
    note('facilities.md', ['---', 'kind: fact', '---', 'Facilities reservations are stored in Postgres.'].join('\n'));
    note('coffee.md', ['---', 'kind: fact', '---', 'Coffee is brewed before the early service.'].join('\n'));
  }

  // Stable projection of a search result: vault path (cross-rebuild identity) +
  // content. The SQLite row id is a fresh UUID per (re)index, so it is NOT part
  // of the identity — path+content is.
  const projectTopN = (rows: { sourceId: string | null; content: string }[]) =>
    rows.map((r) => `${r.sourceId}::${r.content}`);

  it('AC1: clearAllAsync + rebuild reproduces the exact searchAsync top-N', async () => {
    await seedVault();
    await index.rebuildIndexFromVault(vaultDir);

    const before = await repo.searchAsync('budget', undefined, TOP_N);
    expect(before.length).toBeGreaterThanOrEqual(2); // both budget notes hit
    const beforeTopN = projectTopN(before);

    // Disposable: drop EVERY index row, then rebuild from the same vault.
    const cleared = await repo.clearAllAsync();
    expect(cleared).toBe(5);
    expect(await repo.listAsync(undefined, undefined, 100)).toHaveLength(0);

    const summary = await index.rebuildIndexFromVault(vaultDir);
    expect(summary).toEqual({ indexed: 5 });

    const after = await repo.searchAsync('budget', undefined, TOP_N);
    expect(projectTopN(after)).toEqual(beforeTopN);
  });

  it('FALSIFY: a partial rebuild (vault note removed) does NOT reproduce the top-N', async () => {
    // Guards the guard: if the rebuild silently dropped a note (or read a
    // different vault), the top-N would differ — so removing a top-ranked note
    // before the rebuild must change the captured projection. This proves the
    // "identical top-N" assertion above is load-bearing, not vacuous.
    await seedVault();
    await index.rebuildIndexFromVault(vaultDir);
    const beforeTopN = projectTopN(await repo.searchAsync('budget', undefined, TOP_N));

    await repo.clearAllAsync();
    rmSync(path.join(vaultDir, 'budget-followup.md')); // remove one of the two hits
    await index.rebuildIndexFromVault(vaultDir);

    const afterTopN = projectTopN(await repo.searchAsync('budget', undefined, TOP_N));
    expect(afterTopN).not.toEqual(beforeTopN);
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
