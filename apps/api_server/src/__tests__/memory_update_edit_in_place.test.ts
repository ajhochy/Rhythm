/**
 * CONTRACT TESTS — Issue #862 (memory trust, part 1): edit-in-place.
 *
 * `agentMemoryService.update(id, { content, kind, tags })` must edit an
 * existing memory THROUGH to both the Obsidian vault note file AND the
 * derived SQLite index — no divergence between the two. Mirrors the
 * `forget`/`remember` vault-first discipline: the note file is the source of
 * truth, so it is written first; the index is updated only after that
 * succeeds.
 *
 * Like `forget` (#859d), `update` must resolve `id` through BOTH id spaces:
 * the derived index row's own id AND the frontmatter ULID `remember()`
 * returns to its caller — since a caller naturally has only the latter.
 *
 * Real in-memory SQLite + real FS temp dir. No module mocks.
 *
 * Acceptance criteria proven here:
 *   AC1: update(id, {content}) changes the vault note's body AND the row's
 *        content returned by search/list — no divergence.
 *   AC2: update resolves by EITHER the DB row id OR the remember()-returned
 *        ULID (mirrors the #859d forget fix).
 *   AC3: update(id, {kind}) moves the note to the new kind's directory (the
 *        note's home in the vault reflects its kind) and the index row's
 *        kind changes to match.
 *   AC4: updating a non-existent id returns null/false (no file/row created
 *        or touched) — a safe no-op, not a silent success.
 *   AC5: the edit survives a rebuild-from-vault (the persisted file is the
 *        actual source of truth, not just an in-memory patch).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { MemoryIndexService } from '../services/memory_index_service';
import { rememberToVault } from '../services/memoryVaultWriteService';
import { agentMemoryService } from '../services/agentMemoryService';

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

function fileFor(rel: string): string {
  return path.join(vaultRoot, rel);
}

beforeEach(() => {
  setDb(makeDb());
  repo = new AgentMemoryRepository();
  index = new MemoryIndexService(repo);
  vaultRoot = mkdtempSync(path.join(tmpdir(), 'memupdate-test-'));
  memoryDir = path.join(vaultRoot, 'memory');
});

afterEach(() => {
  try {
    rmSync(vaultRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('memory update / edit-in-place (#862)', () => {
  it('AC1: update changes both the vault file AND the index row content', async () => {
    const created = await rememberToVault(
      { kind: 'fact', content: 'Original content.' },
      { memoryDir, index },
    );

    const updated = await agentMemoryService.update(
      created.id,
      { content: 'Edited content.' },
      { memoryDir, index },
    );
    expect(updated).not.toBeNull();

    const raw = readFileSync(fileFor(created.path), 'utf8');
    expect(raw).toContain('Edited content.');
    expect(raw).not.toContain('Original content.');

    const rows = await repo.listAsync(undefined, undefined, 100);
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe('Edited content.');
  });

  it('AC2: update resolves by the DB row id (back-compat)', async () => {
    const created = await rememberToVault(
      { kind: 'fact', content: 'Row-id update marker.' },
      { memoryDir, index },
    );
    const rows = await repo.listAsync(undefined, undefined, 100);
    const dbId = rows[0].id;

    const updated = await agentMemoryService.update(
      dbId,
      { content: 'Row-id update marker, edited.' },
      { memoryDir, index },
    );
    expect(updated).not.toBeNull();
    const raw = readFileSync(fileFor(created.path), 'utf8');
    expect(raw).toContain('Row-id update marker, edited.');
  });

  it('AC3: update(kind) moves the note to the new kind dir and updates the index row kind', async () => {
    const created = await rememberToVault(
      { kind: 'fact', content: 'Recategorize me.' },
      { memoryDir, index },
    );
    expect(created.path).toContain(`fact${path.sep}`);

    const updated = await agentMemoryService.update(
      created.id,
      { kind: 'preference' },
      { memoryDir, index },
    );
    expect(updated).not.toBeNull();
    expect(updated!.kind).toBe('preference');
    expect(updated!.path).toContain(`preference${path.sep}`);

    // Old file is gone, new file exists.
    expect(existsSync(fileFor(created.path))).toBe(false);
    expect(existsSync(fileFor(updated!.path))).toBe(true);

    const rows = await repo.listAsync(undefined, undefined, 100);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('preference');
  });

  it('AC4: updating a non-existent id is a safe no-op (null), nothing created', async () => {
    const result = await agentMemoryService.update(
      'does-not-exist',
      { content: 'should not be written anywhere' },
      { memoryDir, index },
    );
    expect(result).toBeNull();
    expect(await repo.listAsync(undefined, undefined, 100)).toHaveLength(0);
  });

  it('AC5: the edit survives a full rebuild-from-vault (persisted, not just in-memory)', async () => {
    const created = await rememberToVault(
      { kind: 'fact', content: 'Pre-rebuild content.' },
      { memoryDir, index },
    );
    await agentMemoryService.update(
      created.id,
      { content: 'Post-edit content that must survive rebuild.' },
      { memoryDir, index },
    );

    await index.rebuildIndexFromVault(vaultRoot);

    const rows = await repo.listAsync(undefined, undefined, 100);
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe('Post-edit content that must survive rebuild.');
  });
});
