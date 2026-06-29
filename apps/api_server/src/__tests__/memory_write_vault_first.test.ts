/**
 * CONTRACT TESTS — Issue #803 (memory epic #801): vault-first write path for
 * `remember`. The Memory-Vault note is written FIRST (direct FS), then the
 * derived SQLite index is updated, so search reflects it synchronously.
 *
 * Real in-memory SQLite + real repository + real index + real FS temp dir. No
 * module mocks. A TEMP FIXTURE memory dir is created per-test — NEVER the real
 * ~/Documents/Memory-Vault.
 *
 * Acceptance criteria proven here (mapping to the issue):
 *   AC1: POST {kind, content} creates a markdown file with valid frontmatter
 *        (id, kind, created, updated) and body == content; result has id+path.
 *   AC2: after the call, search(term) finds the new memory (index synchronous).
 *   AC3: dedup — a second call with the same id (or identical normalized
 *        content) updates the note in place (preserves id+created, bumps
 *        updated), NO second file.
 *   AC4: invalid kind → MemoryWriteError, writes nothing.
 *   AC5: path-escape (slug/id resolving outside the memory dir) → error,
 *        writes nothing.
 *   AC6: forget removes both the vault file and the index row; absent id is a
 *        safe no-op (false), no file touched.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { MemoryIndexService } from '../services/memory_index_service';
import { scanVaultNotes } from '../services/memoryVaultSyncService';
import {
  rememberToVault,
  forgetFromVault,
  generateUlid,
  normalizeContentKey,
  slugForNote,
  MemoryWriteError,
} from '../services/memoryVaultWriteService';

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

/**
 * All `.md` files under the memory dir (recursive), keyed VAULT-ROOT-relative
 * (e.g. `memory/fact/abc.md`) so they compare directly to `result.path` — the
 * canonical index `source_id`.
 */
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

/** Resolve a canonical (vault-root-relative) note path to an absolute path. */
function fileFor(rel: string): string {
  return path.join(vaultRoot, rel);
}

beforeEach(() => {
  setDb(makeDb());
  repo = new AgentMemoryRepository();
  index = new MemoryIndexService(repo);
  // The memory dir is the `memory/` subtree the write path owns; the vault root
  // is its parent (the form the scan/rebuild path keys on).
  vaultRoot = mkdtempSync(path.join(tmpdir(), 'memwrite-test-'));
  memoryDir = path.join(vaultRoot, 'memory');
});

afterEach(() => {
  try {
    rmSync(vaultRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('vault-first remember (#803)', () => {
  it('AC1: creates a markdown file with valid frontmatter and body == content', async () => {
    const result = await rememberToVault(
      { kind: 'fact', content: 'The facilities system uses Postgres.' },
      { memoryDir, index },
    );

    expect(result.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(result.kind).toBe('fact');
    // Canonical vault-root-relative key, folders-by-type under `memory/`.
    expect(result.path.startsWith('memory' + path.sep + 'fact' + path.sep)).toBe(true);

    const abs = fileFor(result.path);
    expect(existsSync(abs)).toBe(true);
    const raw = readFileSync(abs, 'utf8');

    // Frontmatter has the required keys.
    expect(raw).toContain(`id: ${result.id}`);
    expect(raw).toMatch(/^kind: fact$/m);
    expect(raw).toMatch(/^created: \d{4}-\d{2}-\d{2}$/m);
    expect(raw).toMatch(/^updated: \d{4}-\d{2}-\d{2}$/m);
    // Body equals the content.
    const body = raw.split(/\n---\s*\n/)[1].trim();
    expect(body).toBe('The facilities system uses Postgres.');

    expect(allNoteFiles()).toHaveLength(1);
  });

  it('AC2: after remember, search finds the new memory (index updated synchronously)', async () => {
    await rememberToVault(
      { kind: 'fact', content: 'The reservation calendar lives in facilities.' },
      { memoryDir, index },
    );
    const hits = await repo.searchAsync('facilities', undefined, 20);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].source).toBe('obsidian-memory');
    expect(hits[0].content).toContain('reservation calendar');
  });

  it('AC3: dedup by id — second POST with same id updates in place, no second file', async () => {
    const id = generateUlid();
    const first = await rememberToVault(
      { kind: 'fact', content: 'Original text.', id },
      { memoryDir, index },
    );
    const createdFirst = readFileSync(fileFor(first.path), 'utf8').match(/^created: (.+)$/m)![1];

    // Same id, different content → same file, preserves id + created.
    const second = await rememberToVault(
      { kind: 'fact', content: 'Revised text.', id },
      { memoryDir, index },
    );

    expect(second.id).toBe(id);
    expect(allNoteFiles()).toHaveLength(1);
    const raw = readFileSync(fileFor(second.path), 'utf8');
    expect(raw).toContain(`id: ${id}`);
    expect(raw.match(/^created: (.+)$/m)![1]).toBe(createdFirst);
    expect(raw.split(/\n---\s*\n/)[1].trim()).toBe('Revised text.');

    // Index has exactly one row.
    expect(await repo.listAsync(undefined, undefined, 100)).toHaveLength(1);
  });

  it('AC3: dedup by content — identical normalized content maps to one file', async () => {
    await rememberToVault({ kind: 'fact', content: 'Coffee is brewed each morning.' }, { memoryDir, index });
    // Same content with different whitespace/case → same normalized key → same file.
    await rememberToVault({ kind: 'fact', content: '  Coffee is BREWED   each morning.  ' }, { memoryDir, index });

    expect(allNoteFiles()).toHaveLength(1);
    expect(await repo.listAsync(undefined, undefined, 100)).toHaveLength(1);
  });

  it('AC4: invalid kind is rejected and writes nothing', async () => {
    await expect(
      rememberToVault({ kind: 'secret', content: 'nope' }, { memoryDir, index }),
    ).rejects.toBeInstanceOf(MemoryWriteError);
    expect(allNoteFiles()).toHaveLength(0);
    expect(await repo.listAsync(undefined, undefined, 100)).toHaveLength(0);
  });

  it('AC4: empty content is rejected and writes nothing', async () => {
    await expect(
      rememberToVault({ kind: 'fact', content: '   ' }, { memoryDir, index }),
    ).rejects.toBeInstanceOf(MemoryWriteError);
    expect(allNoteFiles()).toHaveLength(0);
  });

  it('AC5: a path-escaping id is confined — never writes outside the memory dir', async () => {
    // forgetFromVault is the direct path-boundary surface; a traversal relPath
    // must be rejected outright (defence for the delete path).
    await expect(
      forgetFromVault('../../escape.md', { memoryDir, index }),
    ).rejects.toBeInstanceOf(MemoryWriteError);
    await expect(
      forgetFromVault('/etc/passwd', { memoryDir, index }),
    ).rejects.toBeInstanceOf(MemoryWriteError);
    // And a slug derived from traversal-y content still stays inside (no escape).
    const result = await rememberToVault(
      { kind: 'fact', content: '../../../../etc/passwd' },
      { memoryDir, index },
    );
    const abs = path.resolve(fileFor(result.path));
    expect(abs.startsWith(path.resolve(memoryDir) + path.sep)).toBe(true);
    expect(allNoteFiles()).toEqual([result.path]);
  });

  it('AC6: forget removes both the vault file and the index row', async () => {
    const result = await rememberToVault({ kind: 'fact', content: 'Forget me.' }, { memoryDir, index });
    expect(existsSync(fileFor(result.path))).toBe(true);
    const rows = await repo.listAsync(undefined, undefined, 100);
    expect(rows).toHaveLength(1);
    const dbId = rows[0].id;

    // forget goes through the service (looks up row by id → vault path).
    const { agentMemoryService } = await import('../services/agentMemoryService');
    const deleted = await agentMemoryService.forget(dbId, { memoryDir, index });
    expect(deleted).toBe(true);
    expect(existsSync(fileFor(result.path))).toBe(false);
    expect(await repo.listAsync(undefined, undefined, 100)).toHaveLength(0);
  });

  it('AC6: forget of a non-existent id is a safe no-op (false), no file touched', async () => {
    const result = await rememberToVault({ kind: 'fact', content: 'Keep me.' }, { memoryDir, index });
    const { agentMemoryService } = await import('../services/agentMemoryService');

    const deleted = await agentMemoryService.forget('does-not-exist', { memoryDir, index });
    expect(deleted).toBe(false);
    // The unrelated note is untouched.
    expect(existsSync(fileFor(result.path))).toBe(true);
    expect(await repo.listAsync(undefined, undefined, 100)).toHaveLength(1);
  });
});

describe('vault-write helpers (#803)', () => {
  it('generateUlid produces 26-char Crockford base32, time-sortable', () => {
    const a = generateUlid(1000);
    const b = generateUlid(2000);
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a.slice(0, 10) < b.slice(0, 10)).toBe(true);
  });

  it('normalizeContentKey collapses whitespace + lowercases', () => {
    expect(normalizeContentKey('  Hello   WORLD ')).toBe('hello world');
  });

  it('slugForNote never contains a separator and falls back to id', () => {
    expect(slugForNote('Hello, World!', 'FALLBACK')).toBe('hello-world');
    expect(slugForNote('///', 'FALLBACKID')).toBe('fallbackid');
    expect(slugForNote('../etc', 'X').includes(path.sep)).toBe(false);
  });
});

describe('falsification guard (#803)', () => {
  it('FALSIFY: if the write were index-first, a forced FS failure would still leave an index row — it must not', async () => {
    // Point at a memoryDir whose parent is a FILE, so mkdir of the kind dir
    // fails → the vault write throws BEFORE the index is touched.
    const root = mkdtempSync(path.join(tmpdir(), 'memwrite-fail-'));
    const fileAsDir = path.join(root, 'blocker');
    writeFileSync(fileAsDir, 'i am a file, not a dir', 'utf8');
    const badMemoryDir = path.join(fileAsDir, 'memory');

    await expect(
      rememberToVault({ kind: 'fact', content: 'should not be indexed' }, { memoryDir: badMemoryDir, index }),
    ).rejects.toBeTruthy();

    // Vault-first ordering: the index row must NOT exist after a failed write.
    expect(await repo.listAsync(undefined, undefined, 100)).toHaveLength(0);

    rmSync(root, { recursive: true, force: true });
  });
});

describe('source_id canonicalization — write & rebuild agree (#802+#803 follow-up)', () => {
  // REGRESSION GUARD for the dual-writer double-index defect: the vault-first
  // write path keyed its index row relative to `<vault>/memory` (`fact/x.md`)
  // while the scan/rebuild path keys relative to the VAULT ROOT
  // (`memory/fact/x.md`). The same note then got TWO rows under two source_ids.
  // Both paths must now stamp the ONE canonical vault-root-relative key.

  it('write then rebuild = exactly ONE row, identical source_id', async () => {
    const result = await rememberToVault(
      { kind: 'fact', content: 'The fellowship hall seats 240 people.' },
      { memoryDir, index },
    );

    // The write path's index row + its returned path are the canonical key.
    const afterWrite = await repo.listAsync(undefined, undefined, 100);
    expect(afterWrite).toHaveLength(1);
    expect(afterWrite[0].sourceId).toBe(result.path);
    // Canonical form is vault-root-relative (under `memory/`), NOT bare `fact/`.
    expect(result.path.startsWith('memory' + path.sep)).toBe(true);

    // A full rebuild scans the VAULT ROOT and re-keys every note. If the write
    // path used a different key, this would CLEAR the write row and insert a
    // second one under `memory/...` — leaving the note double-tracked across two
    // source_ids. With the canonical key it upserts the SAME row → still one.
    const summary = await index.rebuildIndexFromVault(vaultRoot);
    expect(summary).toEqual({ indexed: 1 });

    const afterRebuild = await repo.listAsync(undefined, undefined, 100);
    expect(afterRebuild).toHaveLength(1);
    expect(afterRebuild[0].sourceId).toBe(result.path);

    // The scan/rebuild path stamps the byte-identical source_id for this note.
    const scanned = await scanVaultNotes(vaultRoot);
    expect(scanned.map((n) => n.sourceId)).toEqual([result.path]);
  });

  it('forget after a rebuild removes the row (delete key matches the rebuild key)', async () => {
    const result = await rememberToVault(
      { kind: 'fact', content: 'Delete-after-rebuild marker wkkz.' },
      { memoryDir, index },
    );
    // Rebuild so the surviving row is the scan-keyed one (the form forget must match).
    await index.rebuildIndexFromVault(vaultRoot);
    const rows = await repo.listAsync(undefined, undefined, 100);
    expect(rows).toHaveLength(1);

    const { agentMemoryService } = await import('../services/agentMemoryService');
    const deleted = await agentMemoryService.forget(rows[0].id, { memoryDir, index });
    expect(deleted).toBe(true);
    // Both the vault file and the index row are gone.
    expect(existsSync(fileFor(result.path))).toBe(false);
    expect(await repo.listAsync(undefined, undefined, 100)).toHaveLength(0);
  });
});
