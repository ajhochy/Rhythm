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
import { parseMemoryNote } from '../services/memory_note_format';
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
let savedMemoryVaultSubdir: string | undefined;

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
      else if (
        name.name.endsWith('.md') &&
        !['index.md', 'log.md'].includes(name.name.toLowerCase())
      ) {
        out.push(path.relative(vaultRoot, full));
      }
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
  savedMemoryVaultSubdir = process.env.MEMORY_VAULT_SUBDIR;
  delete process.env.MEMORY_VAULT_SUBDIR;
  setDb(makeDb());
  repo = new AgentMemoryRepository();
  index = new MemoryIndexService(repo);
  // The memory dir is the `memory/` subtree the write path owns; the vault root
  // is its parent (the form the scan/rebuild path keys on).
  vaultRoot = mkdtempSync(path.join(tmpdir(), 'memwrite-test-'));
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

  it('#1194: an unwritable navigation file never fails canonical capture', async () => {
    mkdirSync(path.join(memoryDir, 'index.md'), { recursive: true });

    const result = await rememberToVault(
      { kind: 'fact', content: 'Capture survives navigation failure.' },
      { memoryDir, index },
    );

    expect(existsSync(fileFor(result.path))).toBe(true);
    const rows = await repo.listAsync(undefined, undefined, 100);
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe('Capture survives navigation failure.');
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

describe('MEM-OKF #1188 write defaults and validation', () => {
  it('stamps new notes stable with the agent generator and omits empty optional keys', async () => {
    const result = await rememberToVault(
      { kind: 'fact', content: 'The welcome desk opens at eight.' },
      { memoryDir, index },
    );
    const raw = readFileSync(fileFor(result.path), 'utf8');
    const parsed = parseMemoryNote(raw);

    expect(parsed.status).toBe('stable');
    expect(parsed.generated).toMatchObject({ by: 'agent:rhythm/1' });
    expect(parsed.generated?.at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    expect(raw).not.toMatch(/^stale_after:/m);
    expect(raw).not.toMatch(/^verified:/m);
  });

  it('accepts valid lifecycle input and rejects malformed caller metadata before writing', async () => {
    const result = await rememberToVault(
      {
        kind: 'context',
        content: 'The youth schedule applies through August.',
        status: 'draft',
        staleAfter: '2026-09-01',
        verified: [
          { by: 'human:ajh@example.com', at: '2026-07-26T10:05:00Z' },
        ],
      },
      { memoryDir, index },
    );
    expect(parseMemoryNote(readFileSync(fileFor(result.path), 'utf8')))
      .toMatchObject({
        status: 'draft',
        staleAfter: '2026-09-01',
        verified: [
          {
            by: 'human:ajh@example.com',
            at: '2026-07-26T10:05:00.000Z',
          },
        ],
      });

    await expect(rememberToVault(
      {
        kind: 'fact',
        content: 'Bad status.',
        status: 'unknown' as 'stable',
      },
      { memoryDir, index },
    )).rejects.toThrow(MemoryWriteError);
    await expect(rememberToVault(
      {
        kind: 'fact',
        content: 'Bad date.',
        staleAfter: '2026-99-99',
      },
      { memoryDir, index },
    )).rejects.toThrow(MemoryWriteError);
    await expect(rememberToVault(
      {
        kind: 'fact',
        content: 'Bad verification.',
        verified: [
          { by: 'anonymous', at: 'yesterday' },
        ],
      },
      { memoryDir, index },
    )).rejects.toThrow(MemoryWriteError);
  });

  it('unions verification history on exact-id dedup instead of replacing it', async () => {
    const id = generateUlid();
    const first = await rememberToVault(
      {
        id,
        kind: 'fact',
        content: 'The chapel projector uses input two.',
        verified: [
          {
            by: 'human:ajh',
            at: '2026-07-26T10:00:00Z',
            evidence: { source: 'walkthrough' },
          },
          {
            by: 'human:ajh',
            at: '2026-07-26T10:00:00Z',
            evidence: { source: 'duplicate-must-not-replace-first' },
          },
        ],
      },
      { memoryDir, index },
    );
    writeFileSync(
      fileFor(first.path),
      readFileSync(fileFor(first.path), 'utf8').replace(
        /^verified:\n/m,
        'verified:\n  - future_actor: retained\n',
      ),
      'utf8',
    );

    await rememberToVault(
      {
        id,
        kind: 'fact',
        content: 'The chapel projector uses input two.',
        verified: [
          { by: 'agent:reviewer/2', at: '2026-07-26T11:00:00Z' },
        ],
      },
      { memoryDir, index },
    );

    const parsed = parseMemoryNote(readFileSync(fileFor(first.path), 'utf8'));
    expect(parsed.verified).toEqual([
      {
        by: 'human:ajh',
        at: '2026-07-26T10:00:00.000Z',
        evidence: { source: 'walkthrough' },
      },
      {
        by: 'agent:reviewer/2',
        at: '2026-07-26T11:00:00.000Z',
      },
    ]);
    expect(parsed.frontmatter.verified).toEqual([
      { future_actor: 'retained' },
      {
        by: 'human:ajh',
        at: '2026-07-26T10:00:00.000Z',
        evidence: { source: 'walkthrough' },
      },
      {
        by: 'agent:reviewer/2',
        at: '2026-07-26T11:00:00.000Z',
      },
    ]);
    expect(await repo.listAsync(undefined, undefined, 100)).toHaveLength(1);
  });
});

describe('MEM-OKF #1192 source attribution writes', () => {
  it('automatically stamps agent-session context and preserves footnotes in the index', async () => {
    const { agentMemoryService } = await import('../services/agentMemoryService');
    const result = await agentMemoryService.remember(
      {
        kind: 'fact',
        content: 'Second service moved to 10:45.[^sess-01J8X]',
        sessionId: '01J8X',
        sources: [
          {
            id: 'email-1',
            resource: 'mailto:staff@example.com',
            title: 'Follow-up email',
          },
        ],
        usageWindow: {
          from: '2026-07-01',
          to: '2026-07-26',
        },
      },
      { memoryDir, index },
    );

    const parsed = parseMemoryNote(readFileSync(fileFor(result.path), 'utf8'));
    expect(parsed.sources).toEqual([
      {
        id: 'email-1',
        resource: 'mailto:staff@example.com',
        title: 'Follow-up email',
      },
      {
        id: 'sess-01J8X',
        resource: 'rhythm://agent-session/01J8X',
      },
    ]);
    expect(parsed.usageWindow).toEqual({
      from: '2026-07-01',
      to: '2026-07-26',
    });

    const [row] = await repo.listAsync(undefined, undefined, 10);
    expect(row.content).toBe(
      'Second service moved to 10:45.[^sess-01J8X]',
    );
    expect(JSON.parse(row.sourcesJson)).toEqual(parsed.sources);
  });

  it('canonical session provenance cannot be suppressed by a colliding source', async () => {
    const result = await rememberToVault(
      {
        kind: 'fact',
        content: 'Canonical source marker.[^sess-source-session-42]',
        sessionId: 'source-session-42',
        sources: [
          {
            id: 'sess-source-session-42',
            resource: 'https://attacker.example/spoofed',
            title: 'Caller-supplied label',
          },
        ],
      },
      { memoryDir, index },
    );

    const parsed = parseMemoryNote(readFileSync(fileFor(result.path), 'utf8'));
    expect(parsed.sources).toEqual([
      {
        id: 'sess-source-session-42',
        resource: 'rhythm://agent-session/source-session-42',
        title: 'Caller-supplied label',
      },
    ]);
  });

  it('stamps ambient context alongside an explicit historical source', async () => {
    const result = await rememberToVault(
      {
        kind: 'fact',
        content: 'Two session contexts.',
        contextSessionId: 'local-session-1',
        sessionId: 'historical-session-2',
      },
      { memoryDir, index },
    );

    const parsed = parseMemoryNote(readFileSync(fileFor(result.path), 'utf8'));
    expect(parsed.sources).toEqual([
      {
        id: 'sess-local-session-1',
        resource: 'rhythm://agent-session/local-session-1',
      },
      {
        id: 'sess-historical-session-2',
        resource: 'rhythm://agent-session/historical-session-2',
      },
    ]);
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
