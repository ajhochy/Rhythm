/**
 * CONTRACT TEST — Issue #886 (edit-in-place 404): `PATCH /agent-memory/:id`
 * (agentMemoryService.update) must succeed with the id the LIST hands the
 * client — the DB row UUID of a vault-SYNCED note — in the CLEAN vault layout
 * (`MEMORY_VAULT_SUBDIR=''`, memoryDir == vault root, e.g.
 * `…/Obsidian Vault/AGENT-MEMORY`).
 *
 * Prior bug: the write path keyed `source_id` via
 * `toVaultRelativeKey(path.dirname(memoryDir), abs)` — correct only in the
 * legacy layout (memoryDir = `<vaultRoot>/memory`). In the clean layout,
 * `dirname()` walks ABOVE the vault root, so the write path minted
 * `AGENT-MEMORY/kind/…` keys while the sync minted `kind/…` keys. The DB-id →
 * frontmatter-id resolution in agentMemoryService.update then computed a
 * wrong relative path, never recovered the note's ULID, and update() returned
 * null → 404 "AgentMemory not found" for EVERY synced row (the exact live
 * failure from the 2026-07-02 manual smoke). A successful edit by ULID also
 * wrote a second, divergent index row (`AGENT-MEMORY/…`-prefixed).
 *
 * Real in-memory SQLite + real FS temp dir. No module mocks.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

let tempRoot: string;
let repo: AgentMemoryRepository;
let index: MemoryIndexService;
let savedSubdir: string | undefined;

beforeEach(() => {
  setDb(makeDb());
  repo = new AgentMemoryRepository();
  index = new MemoryIndexService(repo);
  tempRoot = mkdtempSync(path.join(tmpdir(), 'memupdate-886-'));
  savedSubdir = process.env.MEMORY_VAULT_SUBDIR;
});

afterEach(() => {
  if (savedSubdir === undefined) delete process.env.MEMORY_VAULT_SUBDIR;
  else process.env.MEMORY_VAULT_SUBDIR = savedSubdir;
  try {
    rmSync(tempRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

/** Write a note file + index row exactly the way the SYNC does (dir-relative
 *  source_id, DB row id = its own random UUID). Returns the DB row id. */
async function seedSyncedNote(
  memoryDir: string,
  relPath: string,
  noteMarkdown: string,
  parsed: { kind: string; tags: string[]; content: string },
): Promise<string> {
  const abs = path.join(memoryDir, relPath);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, noteMarkdown, 'utf8');
  await index.upsertNote({ sourceId: relPath, parsed });
  const rows = await repo.listAsync(undefined, undefined, 100);
  const row = rows.find((r) => r.sourceId === relPath);
  expect(row).toBeDefined();
  return row!.id;
}

describe('update resolves by the DB row id the list returns (#886, clean layout)', () => {
  it('edits a synced note (WITH frontmatter id) by its DB row UUID; no divergent index row', async () => {
    process.env.MEMORY_VAULT_SUBDIR = ''; // clean layout: memoryDir == vault root
    const memoryDir = tempRoot;

    const relPath = path.join('preference', 'standing-instruction.md');
    const dbId = await seedSyncedNote(
      memoryDir,
      relPath,
      [
        '---',
        'id: 01KWD8H47DB4GYSZF8BE76M43X',
        'kind: preference',
        'tags: ["workflow"]',
        'created: 2026-06-30',
        'updated: 2026-06-30',
        'source: "conversation"',
        '---',
        '',
        'Original standing instruction.',
        '',
      ].join('\n'),
      { kind: 'preference', tags: ['workflow'], content: 'Original standing instruction.' },
    );

    // The UI sends the DB row UUID — this used to return null → 404.
    const result = await agentMemoryService.update(
      dbId,
      { content: 'Edited standing instruction.' },
      { memoryDir, index },
    );
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('preference');

    // Vault file updated in place.
    const onDisk = readFileSync(path.join(memoryDir, relPath), 'utf8');
    expect(onDisk).toContain('Edited standing instruction.');
    expect(onDisk).toContain('id: 01KWD8H47DB4GYSZF8BE76M43X');

    // Exactly ONE index row for this note, still keyed dir-relative — the
    // prior bug minted a second `AGENT-MEMORY/…`-style row here.
    const rows = await repo.listAsync(undefined, undefined, 100);
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceId).toBe(relPath);
    expect(rows[0].content).toContain('Edited standing instruction.');
  });

  it('edits a synced note WITHOUT a frontmatter id (pre-#803 note) and backfills a ULID', async () => {
    process.env.MEMORY_VAULT_SUBDIR = '';
    const memoryDir = tempRoot;

    const relPath = path.join('person', 'aj-hochhalter.md');
    const dbId = await seedSyncedNote(
      memoryDir,
      relPath,
      'AJ Hochhalter (person)\n',
      { kind: 'person', tags: [], content: 'AJ Hochhalter (person)' },
    );

    const result = await agentMemoryService.update(
      dbId,
      { content: 'AJ Hochhalter — worship director at Visalia CRC.' },
      { memoryDir, index },
    );
    expect(result).not.toBeNull();

    const onDisk = readFileSync(path.join(memoryDir, relPath), 'utf8');
    expect(onDisk).toContain('AJ Hochhalter — worship director at Visalia CRC.');
    // The rewrite must have backfilled a real ULID frontmatter id.
    expect(onDisk).toMatch(/^id: [0-9A-HJKMNP-TV-Z]{26}$/m);

    const rows = await repo.listAsync(undefined, undefined, 100);
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceId).toBe(relPath);
  });

  it('unknown id still returns null (404 path preserved)', async () => {
    process.env.MEMORY_VAULT_SUBDIR = '';
    const result = await agentMemoryService.update(
      'no-such-id',
      { content: 'x' },
      { memoryDir: tempRoot, index },
    );
    expect(result).toBeNull();
  });
});

describe('legacy layout regression (MEMORY_VAULT_SUBDIR default)', () => {
  it('remember → update by DB row id keeps the memory/kind/… key convention', async () => {
    delete process.env.MEMORY_VAULT_SUBDIR; // default 'memory'
    const memoryDir = path.join(tempRoot, 'memory');

    const remembered = await rememberToVault(
      { kind: 'fact', content: 'Legacy-layout update regression marker.' },
      { memoryDir, index },
    );
    // Write-path key stays vault-root-relative (memory/… prefix).
    expect(remembered.path.split(path.sep)[0]).toBe('memory');

    const rows = await repo.listAsync(undefined, undefined, 100);
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceId).toBe(remembered.path);

    const result = await agentMemoryService.update(
      rows[0].id, // the DB row UUID, as the UI sends
      { content: 'Legacy-layout update regression marker (edited).' },
      { memoryDir, index },
    );
    expect(result).not.toBeNull();

    const after = await repo.listAsync(undefined, undefined, 100);
    expect(after).toHaveLength(1);
    expect(after[0].sourceId).toBe(remembered.path);
    expect(after[0].content).toContain('(edited)');
  });
});
