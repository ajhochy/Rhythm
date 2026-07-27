/**
 * CONTRACT TESTS — Issue #770 Work Item 6: Memory-Vault → agent_memory mirror-sync.
 *
 * Real in-memory SQLite + real repository + real sync service. No module mocks.
 * A TEMP FIXTURE vault directory is created per-test and pointed at via the
 * MEMORY_VAULT_PATH override — NEVER the real ~/Documents/Memory-Vault.
 *
 * These prove the WI6 acceptance subset:
 *   - frontmatter parsing (kind/tags/source/source_id/created/updated + body)
 *   - upsert keyed on source='obsidian-memory' + source_id=<vault-relative path>
 *   - idempotency (re-run with unchanged vault = no net change)
 *   - tombstone cleanup (note deleted from vault → row deleted)
 *   - missing vault path → no-op (not an error)
 *   - existing agent_memory rows from OTHER sources are untouched
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import {
  RESERVED_VAULT_FILENAMES,
  scanVaultNotes,
  syncMemoryVault,
} from '../services/memoryVaultSyncService';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

let vaultDir: string;
let repo: AgentMemoryRepository;

function note(name: string, body: string): void {
  const full = path.join(vaultDir, name);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body, 'utf8');
}

beforeEach(() => {
  setDb(makeDb());
  repo = new AgentMemoryRepository();
  vaultDir = mkdtempSync(path.join(tmpdir(), 'memvault-test-'));
});

afterEach(() => {
  try {
    rmSync(vaultDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('Memory-Vault mirror-sync (WI6)', () => {
  it('parses frontmatter and upserts a note into agent_memory', async () => {
    note(
      'aj-hochhalter.md',
      [
        '---',
        'kind: person',
        'tags: [staff, leadership]',
        'source: claude-memory-import',
        'source_id: AJ Hochhalter',
        'created: 2026-06-01',
        'updated: 2026-06-27',
        '---',
        'AJ Hochhalter leads the church staff team.',
      ].join('\n'),
    );

    const summary = await syncMemoryVault({ vaultPath: vaultDir });
    expect(summary).toEqual({ scanned: 1, upserted: 1, deleted: 0 });

    const rows = await repo.listAsync(undefined, undefined, 50);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.kind).toBe('person');
    expect(row.content).toBe('AJ Hochhalter leads the church staff team.');
    expect(row.source).toBe('obsidian-memory');
    // source_id is the vault-relative note PATH (idempotency key), not the
    // frontmatter source_id field.
    expect(row.sourceId).toBe('aj-hochhalter.md');
    expect(JSON.parse(row.tagsJson)).toEqual(['staff', 'leadership']);
  });

  it('#1188: carries normalized lifecycle metadata through the scan result', async () => {
    note(
      'seasonal.md',
      [
        '---',
        'kind: context',
        'status: draft',
        'stale_after: 2026-09-01',
        'generated: { by: "agent:rhythm/1", at: 2026-07-26T10:00:00Z }',
        'verified:',
        '  - { by: "human:ajh", at: 2026-07-26T11:00:00Z }',
        '---',
        'Seasonal schedule.',
      ].join('\n'),
    );

    const [scanned] = await scanVaultNotes(vaultDir);
    expect(scanned.parsed).toMatchObject({
      status: 'draft',
      staleAfter: '2026-09-01',
      generated: {
        by: 'agent:rhythm/1',
        at: '2026-07-26T10:00:00.000Z',
      },
      verified: [
        {
          by: 'human:ajh',
          at: '2026-07-26T11:00:00.000Z',
        },
      ],
    });
  });

  it('defaults kind to "fact" when frontmatter omits it', async () => {
    note('untyped.md', ['---', 'tags: []', '---', 'A bare fact.'].join('\n'));
    await syncMemoryVault({ vaultPath: vaultDir });
    const rows = await repo.listAsync(undefined, undefined, 50);
    expect(rows[0].kind).toBe('fact');
    expect(rows[0].content).toBe('A bare fact.');
  });

  it('handles notes with no frontmatter — whole file is the body', async () => {
    note('plain.md', 'Just prose, no frontmatter at all.');
    await syncMemoryVault({ vaultPath: vaultDir });
    const rows = await repo.listAsync(undefined, undefined, 50);
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe('Just prose, no frontmatter at all.');
    expect(rows[0].kind).toBe('fact');
  });

  it('is idempotent: re-running with an unchanged vault changes nothing', async () => {
    note(
      'rhythm.md',
      ['---', 'kind: project', '---', 'Rhythm is the church productivity app.'].join('\n'),
    );

    const first = await syncMemoryVault({ vaultPath: vaultDir });
    expect(first).toEqual({ scanned: 1, upserted: 1, deleted: 0 });
    const idAfterFirst = (await repo.listAsync(undefined, undefined, 50))[0].id;

    const second = await syncMemoryVault({ vaultPath: vaultDir });
    expect(second.scanned).toBe(1);
    expect(second.deleted).toBe(0);

    const rows = await repo.listAsync(undefined, undefined, 50);
    expect(rows).toHaveLength(1);
    // Stable id across runs proves upsert (not insert-new) on the same source_id.
    expect(rows[0].id).toBe(idAfterFirst);
    expect(rows[0].content).toBe('Rhythm is the church productivity app.');
  });

  it('updates content when a note body changes (upsert, not duplicate)', async () => {
    note('changing.md', ['---', 'kind: fact', '---', 'Old content.'].join('\n'));
    await syncMemoryVault({ vaultPath: vaultDir });
    const idV1 = (await repo.listAsync(undefined, undefined, 50))[0].id;

    note('changing.md', ['---', 'kind: fact', '---', 'New content.'].join('\n'));
    const summary = await syncMemoryVault({ vaultPath: vaultDir });

    const rows = await repo.listAsync(undefined, undefined, 50);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(idV1);
    expect(rows[0].content).toBe('New content.');
    expect(summary.scanned).toBe(1);
  });

  it('tombstone: deletes rows whose note no longer exists in the vault', async () => {
    note('keep.md', ['---', 'kind: fact', '---', 'Keep me.'].join('\n'));
    note('drop.md', ['---', 'kind: fact', '---', 'Delete me.'].join('\n'));
    await syncMemoryVault({ vaultPath: vaultDir });
    expect(await repo.listAsync(undefined, undefined, 50)).toHaveLength(2);

    unlinkSync(path.join(vaultDir, 'drop.md'));
    const summary = await syncMemoryVault({ vaultPath: vaultDir });
    expect(summary.scanned).toBe(1);
    expect(summary.deleted).toBe(1);

    const rows = await repo.listAsync(undefined, undefined, 50);
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe('Keep me.');
  });

  it('recursively scans nested folders and uses the relative path as source_id', async () => {
    note(path.join('people', 'jane.md'), ['---', 'kind: person', '---', 'Jane.'].join('\n'));
    const summary = await syncMemoryVault({ vaultPath: vaultDir });
    expect(summary.upserted).toBe(1);
    const rows = await repo.listAsync(undefined, undefined, 50);
    expect(rows[0].sourceId).toBe(path.join('people', 'jane.md'));
  });

  it('missing vault path is a no-op (not an error)', async () => {
    const missing = path.join(vaultDir, 'does-not-exist');
    await repo.upsertBySourceAsync({
      kind: 'fact',
      content: 'Cached while the vault is temporarily unavailable.',
      source: 'obsidian-memory',
      sourceId: 'cached.md',
      tagsJson: '[]',
    });
    const summary = await syncMemoryVault({ vaultPath: missing });
    expect(summary).toEqual({ scanned: 0, upserted: 0, deleted: 0 });
    const rows = await repo.listAsync(undefined, undefined, 50);
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceId).toBe('cached.md');
    expect(existsSync(missing)).toBe(false);
  });

  it('ignores non-markdown files in the vault', async () => {
    note('real.md', ['---', 'kind: fact', '---', 'Real note.'].join('\n'));
    writeFileSync(path.join(vaultDir, 'image.png'), 'not markdown', 'utf8');
    writeFileSync(path.join(vaultDir, 'notes.txt'), 'also not markdown', 'utf8');
    const summary = await syncMemoryVault({ vaultPath: vaultDir });
    expect(summary.scanned).toBe(1);
    expect(await repo.listAsync(undefined, undefined, 50)).toHaveLength(1);
  });

  it('#1194: excludes reserved filenames everywhere and tombstones old reserved rows', async () => {
    note('kept.md', ['---', 'kind: fact', '---', 'Keep this memory.'].join('\n'));
    note('index.md', 'Reserved root navigation.');
    note('LOG.md', 'Reserved root audit history.');
    note(path.join('fact', 'Index.md'), 'Reserved nested navigation.');
    note(path.join('fact', 'log.md'), 'Reserved nested audit history.');

    await repo.upsertBySourceAsync({
      kind: 'fact',
      content: 'Previously indexed navigation.',
      source: 'obsidian-memory',
      sourceId: 'index.md',
      tagsJson: '[]',
    });
    await repo.upsertBySourceAsync({
      kind: 'fact',
      content: 'Previously indexed nested history.',
      source: 'obsidian-memory',
      sourceId: path.join('fact', 'log.md'),
      tagsJson: '[]',
    });

    const summary = await syncMemoryVault({ vaultPath: vaultDir });

    expect(RESERVED_VAULT_FILENAMES).toEqual(['index.md', 'log.md']);
    expect(summary).toEqual({ scanned: 1, upserted: 1, deleted: 2 });
    const rows = await repo.listAsync(undefined, undefined, 50);
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceId).toBe('kept.md');
    expect(rows[0].content).toBe('Keep this memory.');
  });

  it('does NOT touch agent_memory rows from other sources', async () => {
    // A non-vault memory (e.g. from the consolidation loop).
    await repo.createAsync({
      kind: 'fact',
      content: 'Consolidated fact from a session.',
      source: 'session',
      sourceId: 'session-123',
    });
    note('vault-note.md', ['---', 'kind: fact', '---', 'Vault fact.'].join('\n'));

    await syncMemoryVault({ vaultPath: vaultDir });

    const all = await repo.listAsync(undefined, undefined, 50);
    expect(all).toHaveLength(2);
    const sources = all.map((r) => r.source).sort();
    expect(sources).toEqual(['obsidian-memory', 'session']);

    // Tombstone must not delete the foreign-source row even though its
    // source_id is absent from the vault.
    unlinkSync(path.join(vaultDir, 'vault-note.md'));
    const summary = await syncMemoryVault({ vaultPath: vaultDir });
    expect(summary.deleted).toBe(1); // only the vault note
    const remaining = await repo.listAsync(undefined, undefined, 50);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].source).toBe('session');
  });

  it('synced rows are findable via FTS search', async () => {
    note(
      'searchable.md',
      ['---', 'kind: fact', '---', 'The facilities reservation system uses Postgres.'].join('\n'),
    );
    await syncMemoryVault({ vaultPath: vaultDir });
    const results = await repo.searchAsync('facilities', undefined, 20);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].source).toBe('obsidian-memory');
  });
});
