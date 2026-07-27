/**
 * CONTRACT TESTS — Issue #859a: merge-on-capture for `rememberToVault`.
 *
 * Framing (per the issue): the problem is REDUNDANCY, not volume. When a new
 * memory restates/extends an existing theme (same kind, high textual
 * similarity), the write path should MERGE/EXTEND the canonical note instead
 * of creating a near-duplicate file. Distinct memories (different themes) must
 * NOT be merged, even within the same kind.
 *
 * Real in-memory SQLite + real repository + real index + real FS temp dir. No
 * module mocks — mirrors memory_write_vault_first.test.ts's harness.
 *
 * Acceptance criteria proven here:
 *   AC1: two near-identical remembers (same kind, high lexical overlap) result
 *        in exactly ONE note file, and the note's body reflects the union of
 *        both (nothing silently dropped).
 *   AC2: two DISTINCT memories in the same kind (e.g. a dev-quality
 *        preference vs. an operating-mode preference) are NOT merged — two
 *        separate note files remain.
 *   AC3: merging is scoped to the same `kind` — a highly similar-looking
 *        string under a DIFFERENT kind is never merged into another kind's note.
 *   AC4: the merged note keeps a single stable `id` (the survivor's), and the
 *        index has exactly one row after the merge.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { MemoryIndexService } from '../services/memory_index_service';
import { rememberToVault } from '../services/memoryVaultWriteService';
import {
  parseMemoryNote,
  validateNoteSources,
} from '../services/memory_note_format';

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
  vaultRoot = mkdtempSync(path.join(tmpdir(), 'memmerge-test-'));
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

describe('merge-on-capture (#859a)', () => {
  it('AC1: two near-identical remembers merge into ONE note, preserving both nuances', async () => {
    const first = await rememberToVault(
      { kind: 'preference', content: 'AJ prefers the Sonnet model for coding agents to save tokens.' },
      { memoryDir, index },
    );
    const second = await rememberToVault(
      {
        kind: 'preference',
        content: 'AJ prefers using the Sonnet model for code agents, especially for cost-sensitive tasks.',
      },
      { memoryDir, index },
    );

    // Merged onto the same canonical note — one file, one id.
    expect(second.id).toBe(first.id);
    expect(allNoteFiles()).toHaveLength(1);

    const raw = readFileSync(fileFor(second.path), 'utf8');
    const body = raw.split(/\n---\s*\n/)[1].trim();
    // Union of nuance: the distinguishing detail from the second remember
    // ("cost-sensitive tasks") survives in the merged body.
    expect(body.toLowerCase()).toContain('sonnet');
    expect(body.toLowerCase()).toContain('cost-sensitive');

    expect(await repo.listAsync(undefined, undefined, 100)).toHaveLength(1);
  });

  it('AC2: distinct memories in the same kind are NOT over-merged', async () => {
    const devQuality = await rememberToVault(
      { kind: 'preference', content: 'AJ prefers the Sonnet model for coding agents to save tokens.' },
      { memoryDir, index },
    );
    const operatingMode = await rememberToVault(
      { kind: 'preference', content: 'AJ wants agents to run fully autonomously with rollback, never asking for confirmation on routine tasks.' },
      { memoryDir, index },
    );

    expect(operatingMode.id).not.toBe(devQuality.id);
    expect(allNoteFiles()).toHaveLength(2);
    expect(await repo.listAsync(undefined, undefined, 100)).toHaveLength(2);
  });

  it('AC3: merge scope is confined to the same kind — similar text under a different kind stays separate', async () => {
    const fact = await rememberToVault(
      { kind: 'fact', content: 'The facilities system uses Postgres for storage.' },
      { memoryDir, index },
    );
    const preference = await rememberToVault(
      { kind: 'preference', content: 'The facilities system uses Postgres for storage, and AJ prefers keeping it that way.' },
      { memoryDir, index },
    );

    expect(preference.id).not.toBe(fact.id);
    expect(allNoteFiles()).toHaveLength(2);
    expect(await repo.listAsync(undefined, undefined, 100)).toHaveLength(2);
  });

  it('AC4: a three-way near-duplicate cluster still converges on ONE note with ONE index row', async () => {
    const a = await rememberToVault(
      { kind: 'fact', content: 'The reservation calendar lives in the facilities module.' },
      { memoryDir, index },
    );
    const b = await rememberToVault(
      { kind: 'fact', content: 'The reservation calendar is part of the facilities module in the app.' },
      { memoryDir, index },
    );
    const c = await rememberToVault(
      { kind: 'fact', content: 'Facilities module contains the reservation calendar feature.' },
      { memoryDir, index },
    );

    expect(b.id).toBe(a.id);
    expect(c.id).toBe(a.id);
    expect(allNoteFiles()).toHaveLength(1);
    expect(await repo.listAsync(undefined, undefined, 100)).toHaveLength(1);
  });

  it('#1187: merge-on-capture preserves arbitrary nested frontmatter', async () => {
    const first = await rememberToVault(
      { kind: 'fact', content: 'The reservation calendar lives in the facilities module.' },
      { memoryDir, index },
    );
    const firstPath = fileFor(first.path);
    const withUnknown = readFileSync(firstPath, 'utf8').replace(
      /^source: agent$/m,
      ['source: agent', 'future_extension:', '  nested:', '    enabled: true'].join('\n'),
    );
    writeFileSync(firstPath, withUnknown, 'utf8');

    await rememberToVault(
      {
        kind: 'fact',
        content: 'Facilities module contains the reservation calendar feature for booking rooms.',
      },
      { memoryDir, index },
    );

    const rewritten = readFileSync(firstPath, 'utf8');
    expect(rewritten).toContain('future_extension:');
    expect(rewritten).toContain('enabled: true');
  });

  it('#1188: merge-on-capture folds lifecycle metadata conservatively', async () => {
    const first = await rememberToVault(
      {
        kind: 'fact',
        content: 'The reservation calendar lives in the facilities module.',
        status: 'deprecated',
        staleAfter: '2026-10-01',
        verified: [
          {
            by: 'agent:reviewer/2',
            at: '2026-07-26T10:00:00Z',
            evidence: { source: 'merge-review' },
          },
        ],
      },
      { memoryDir, index },
    );
    await rememberToVault(
      {
        kind: 'fact',
        content: 'Facilities module contains the reservation calendar feature for booking rooms.',
        status: 'draft',
        staleAfter: '2026-09-01',
        verified: [
          { by: 'agent:reviewer/2', at: '2026-07-26T10:00:00Z' },
          { by: 'human:ajh', at: '2026-07-26T11:00:00Z' },
        ],
      },
      { memoryDir, index },
    );

    const merged = parseMemoryNote(readFileSync(fileFor(first.path), 'utf8'));
    expect(merged.status).toBe('draft');
    expect(merged.staleAfter).toBe('2026-09-01');
    expect(merged.verified).toEqual([
      {
        by: 'agent:reviewer/2',
        at: '2026-07-26T10:00:00.000Z',
        evidence: { source: 'merge-review' },
      },
      {
        by: 'human:ajh',
        at: '2026-07-26T11:00:00.000Z',
      },
    ]);
  });

  it('#1193: unions attribution, rekeys collisions, and widens usage windows', async () => {
    const first = await rememberToVault(
      {
        kind: 'fact',
        content: 'Facilities reservation calendar in the facilities module supports room booking.[^X]',
        status: 'deprecated',
        staleAfter: '2026-10-01',
        verified: [
          { by: 'agent:reviewer/2', at: '2026-07-26T10:00:00Z' },
        ],
        sources: [
          { id: 'X', resource: 'https://example.test/survivor' },
        ],
        usageWindow: { from: '2026-03-01', to: '2026-04-01' },
      },
      { memoryDir, index },
    );
    const survivorPath = fileFor(first.path);
    writeFileSync(
      survivorPath,
      readFileSync(survivorPath, 'utf8').replace(
        /^source: agent$/m,
        ['source: agent', 'future_extension:', '  retained: true'].join('\n'),
      ),
      'utf8',
    );
    const before = parseMemoryNote(readFileSync(survivorPath, 'utf8'));
    const second = await rememberToVault(
      {
        kind: 'fact',
        content: [
          'The reservation calendar in the facilities module supports room booking approvals.[^X]',
          '',
          'Room setup details remain unattributed.',
        ].join('\n'),
        status: 'draft',
        staleAfter: '2026-09-01',
        verified: [
          { by: 'human:ajh', at: '2026-07-26T11:00:00Z' },
        ],
        sources: [
          { id: 'X', resource: 'https://example.test/incoming' },
        ],
        usageWindow: { from: '2026-02-01', to: '2026-05-01' },
      },
      { memoryDir, index },
    );

    expect(second.id).toBe(first.id);
    const merged = parseMemoryNote(
      readFileSync(survivorPath, 'utf8'),
    );
    expect(merged.sources).toEqual([
      { id: 'X', resource: 'https://example.test/survivor' },
      { id: 'X-2', resource: 'https://example.test/incoming' },
    ]);
    expect(merged.body).toContain('room booking.[^X]');
    expect(merged.body).toContain('booking approvals.[^X-2]');
    expect(merged.body).toContain('Room setup details remain unattributed.');
    expect(merged.usageWindow).toEqual({
      from: '2026-02-01',
      to: '2026-05-01',
    });
    expect(merged.status).toBe('draft');
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
    expect(merged.frontmatter.created).toBe(before.frontmatter.created);
    expect(merged.generated).toEqual(before.generated);
    expect(merged.frontmatter.future_extension).toEqual({ retained: true });
    expect(validateNoteSources(merged).danglingFootnoteReferences).toEqual([]);
  });

  it('#1193: exact implicit replay merges attribution instead of replacing it', async () => {
    const content = 'Exact replay keeps every originating session.';
    const first = await rememberToVault(
      {
        kind: 'fact',
        content,
        sessionId: 'source-session-a',
        usageWindow: { from: '2026-03-01', to: '2026-04-01' },
      },
      { memoryDir, index },
    );
    const second = await rememberToVault(
      {
        kind: 'fact',
        content,
        sessionId: 'source-session-b',
        usageWindow: { from: '2026-02-01', to: '2026-05-01' },
      },
      { memoryDir, index },
    );

    expect(second.id).toBe(first.id);
    expect(allNoteFiles()).toHaveLength(1);
    const replayed = parseMemoryNote(
      readFileSync(fileFor(first.path), 'utf8'),
    );
    expect(replayed.sources).toEqual([
      {
        id: 'sess-source-session-a',
        resource: 'rhythm://agent-session/source-session-a',
      },
      {
        id: 'sess-source-session-b',
        resource: 'rhythm://agent-session/source-session-b',
      },
    ]);
    expect(replayed.usageWindow).toEqual({
      from: '2026-02-01',
      to: '2026-05-01',
    });
  });

  it('#1193: unsafe exact replay errors without mutating vault bytes or index', async () => {
    const first = await rememberToVault(
      {
        kind: 'fact',
        content: 'Exact claim.[^X]',
        sources: [{ id: 'X', resource: 'https://example.test/original' }],
      },
      { memoryDir, index },
    );
    const originalBytes = readFileSync(fileFor(first.path), 'utf8');
    const [originalRow] = await repo.listAsync(undefined, undefined, 10);

    await expect(rememberToVault(
      {
        kind: 'fact',
        content: ' exact CLAIM.[^x] ',
      },
      { memoryDir, index },
    )).rejects.toThrow(/Exact replay/);

    expect(readFileSync(fileFor(first.path), 'utf8')).toBe(originalBytes);
    const rows = await repo.listAsync(undefined, undefined, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(originalRow);
  });

  it('#1193: unsafe semantic candidates stay separate and cannot cross-bind', async () => {
    const first = await rememberToVault(
      {
        kind: 'fact',
        content: 'Facilities reservation calendar supports room booking.[^X]',
      },
      { memoryDir, index },
    );
    const second = await rememberToVault(
      {
        kind: 'fact',
        content: 'The facilities reservation calendar supports room booking approvals.',
        sources: [{ id: 'X', resource: 'https://example.test/incoming' }],
      },
      { memoryDir, index },
    );

    expect(second.id).not.toBe(first.id);
    expect(allNoteFiles()).toHaveLength(2);
    const survivor = parseMemoryNote(
      readFileSync(fileFor(first.path), 'utf8'),
    );
    expect(survivor.sources).toEqual([]);
    expect(validateNoteSources(survivor).danglingFootnoteReferences).toEqual([
      'X',
    ]);
  });

  it('#1193: rejects invalid source ids and reversed caller windows', async () => {
    await expect(rememberToVault(
      {
        kind: 'fact',
        content: 'Invalid id.',
        sources: [{ id: 'bad.id', resource: 'https://example.test' }],
      },
      { memoryDir, index },
    )).rejects.toThrow(/source id/);
    await expect(rememberToVault(
      {
        kind: 'fact',
        content: 'Reversed window.',
        usageWindow: { from: '2026-07-26', to: '2026-07-01' },
      },
      { memoryDir, index },
    )).rejects.toThrow(/usageWindow\.from/);
    expect(allNoteFiles()).toHaveLength(0);
  });
});
