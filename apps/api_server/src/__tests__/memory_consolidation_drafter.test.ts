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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  promises as fsPromises,
  mkdtempSync,
  mkdirSync,
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
import { rememberToVault, generateUlid, renderMemoryNote } from '../services/memoryVaultWriteService';
import {
  runMemoryConsolidation,
  revertMemoryConsolidation,
} from '../services/memory_consolidation_drafter';
import {
  parseMemoryNote,
  validateNoteSources,
  type NoteFrontmatter,
} from '../services/memory_note_format';
import { logger } from '../utils/logger';
import { flushMemoryVaultLog } from '../services/memory_vault_log';

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

afterEach(async () => {
  await flushMemoryVaultLog(memoryDir);
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

async function seedAttributedThreeNoteCluster(): Promise<Map<string, string>> {
  const kindDir = path.join(memoryDir, 'fact');
  mkdirSync(kindDir, { recursive: true });
  const fixtures: Array<{
    name: string;
    body: string;
    frontmatter: NoteFrontmatter;
  }> = [
    {
      name: 'note-a.md',
      body: 'The reservation calendar lives in the facilities module and supports room booking.[^X]',
      frontmatter: {
        id: generateUlid(1000),
        kind: 'fact',
        tags: ['survivor'],
        created: '2026-01-01',
        updated: '2026-01-01',
        source: 'agent',
        status: 'deprecated',
        stale_after: '2026-10-01',
        verified: [
          { by: 'agent:reviewer/2', at: '2026-07-26T10:00:00Z' },
        ],
        sources: [
          { id: 'X', resource: 'https://example.test/survivor' },
        ],
        usage_window: { from: '2026-03-01', to: '2026-04-01' },
      },
    },
    {
      name: 'note-b.md',
      body: 'The reservation calendar in the facilities module supports room booking approvals.[^X]',
      frontmatter: {
        id: generateUlid(2000),
        kind: 'fact',
        tags: ['middle'],
        created: '2026-01-01',
        updated: '2026-01-01',
        source: 'agent',
        status: 'stable',
        stale_after: '2026-09-01',
        verified: [
          { by: 'human:ajh', at: '2026-07-26T11:00:00Z' },
        ],
        sources: [{ id: 'X', resource: 'https://example.test/middle' }],
        usage_window: { from: '2026-02-01', to: '2026-05-01' },
      },
    },
    {
      name: 'note-c.md',
      body: [
        'The facilities module reservation calendar supports room booking and setup.[^X]',
        '',
        'Unattributed setup detail.',
      ].join('\n'),
      frontmatter: {
        id: generateUlid(3000),
        kind: 'fact',
        tags: ['newest'],
        created: '2026-01-01',
        updated: '2026-01-01',
        source: 'agent',
        status: 'draft',
        stale_after: '2026-11-01',
        sources: [
          { id: 'X', resource: 'https://example.test/incoming' },
        ],
        usage_window: { from: '2026-01-01', to: '2026-06-01' },
      },
    },
  ];
  const before = new Map<string, string>();
  for (const fixture of fixtures) {
    const rel = path.join('memory', 'fact', fixture.name);
    const rendered = renderMemoryNote(fixture.frontmatter, fixture.body);
    writeFileSync(path.join(vaultRoot, rel), rendered, 'utf8');
    before.set(rel, rendered);
    await index.upsertNote({
      sourceId: rel,
      parsed: {
        kind: 'fact',
        tags: fixture.frontmatter.tags,
        content: fixture.body,
      },
    });
  }
  return before;
}

describe('memory consolidation pass (#859b)', () => {
  it('AC1+AC3: merges an overlapping cluster into one canonical note, preserving unique nuance', async () => {
    await seedPreExistingOverlappingNotes();
    expect(allNoteFiles()).toHaveLength(2);

    const result = await runMemoryConsolidation({ memoryDir, index, repo });
    await flushMemoryVaultLog(memoryDir);

    expect(result.mergedClusters).toBeGreaterThanOrEqual(1);
    expect(result.retiredCount).toBeGreaterThanOrEqual(1);
    expect(allNoteFiles()).toHaveLength(1);

    const rows = await repo.listAsync(undefined, undefined, 100);
    expect(rows).toHaveLength(1);

    const merged = readFileSync(fileFor(rows[0].sourceId!), 'utf8');
    // Nuance from the second note ("booking rooms") must survive the merge.
    expect(merged.toLowerCase()).toContain('booking');
    const auditLog = readFileSync(path.join(memoryDir, 'log.md'), 'utf8');
    expect(auditLog).toContain(
      '**Update** [Note A](/fact/note-a.md) - merged [Note B](/fact/note-b.md)',
    );
    expect(auditLog).toContain(
      '**Deprecation** [Note B](/fact/note-b.md) - superseded and merged into [Note A](/fact/note-a.md)',
    );
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
    const afterMergeIndex = readFileSync(
      path.join(memoryDir, 'fact', 'index.md'),
      'utf8',
    );
    expect(afterMergeIndex).toContain('[Note A](note-a.md)');
    expect(afterMergeIndex).not.toContain('note-b.md');

    await revertMemoryConsolidation(result.beforeSnapshot, { memoryDir, index, repo });
    await flushMemoryVaultLog(memoryDir);

    const afterRevertFiles = allNoteFiles().slice().sort();
    expect(afterRevertFiles).toEqual(beforeFiles);
    for (const rel of afterRevertFiles) {
      expect(readFileSync(fileFor(rel), 'utf8')).toBe(beforeBytes.get(rel));
    }
    const afterRevertIndex = readFileSync(
      path.join(memoryDir, 'fact', 'index.md'),
      'utf8',
    );
    expect(afterRevertIndex).toContain('[Note A](note-a.md)');
    expect(afterRevertIndex).toContain('[Note B](note-b.md)');
    const afterRevertRows = await repo.listAsync(undefined, undefined, 100);
    expect(afterRevertRows).toHaveLength(beforeRows.length);
    const auditLog = readFileSync(path.join(memoryDir, 'log.md'), 'utf8');
    expect(auditLog).toContain('merged [Note B](/fact/note-b.md)');
    expect(auditLog.match(/reverted to its pre-consolidation state/g)).toHaveLength(2);
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
          '  - by: "agent:reviewer/2"',
          '    at: 2026-07-26T10:00:00Z',
          '    evidence:',
          '      source: consolidation-review',
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
        evidence: { source: 'consolidation-review' },
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

  it('#1193: merges a three-note attribution cluster and reverts byte-for-byte', async () => {
    const before = await seedAttributedThreeNoteCluster();
    const survivorRel = path.join('memory', 'fact', 'note-a.md');
    const crlfSurvivor = before.get(survivorRel)!.replace(/\n/g, '\r\n');
    writeFileSync(fileFor(survivorRel), crlfSurvivor, 'utf8');
    before.set(survivorRel, crlfSurvivor);
    // Reinsert in reverse order. Equal created dates must still resolve by the
    // stable vault path, not repository iteration/insertion order.
    await repo.clearAllAsync();
    for (const [rel, bytes] of Array.from(before.entries()).reverse()) {
      const parsed = parseMemoryNote(bytes);
      await index.upsertNote({
        sourceId: rel,
        parsed: {
          kind: parsed.kind,
          tags: parsed.tags,
          content: parsed.body,
          sources: parsed.sources,
        },
      });
    }

    const result = await runMemoryConsolidation({ memoryDir, index, repo });

    expect(result.mergedClusters).toBe(1);
    expect(result.retiredCount).toBe(2);
    const survivorPath = path.join(vaultRoot, 'memory', 'fact', 'note-a.md');
    const merged = parseMemoryNote(readFileSync(survivorPath, 'utf8'));
    expect(merged.sources).toEqual([
      { id: 'X', resource: 'https://example.test/survivor' },
      { id: 'X-2', resource: 'https://example.test/middle' },
      { id: 'X-3', resource: 'https://example.test/incoming' },
    ]);
    expect(merged.body).toContain('booking.[^X]');
    expect(merged.body).toContain('approvals.[^X-2]');
    expect(merged.body).toContain('setup.[^X-3]');
    expect(merged.body).toContain('Unattributed setup detail.');
    expect(merged.usageWindow).toEqual({
      from: '2026-01-01',
      to: '2026-06-01',
    });
    expect(validateNoteSources(merged).danglingFootnoteReferences).toEqual([]);
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
    const firstMergedBytes = readFileSync(survivorPath, 'utf8');

    await revertMemoryConsolidation(
      result.beforeSnapshot,
      { memoryDir, index, repo },
    );
    expect(allNoteFiles().slice().sort()).toEqual(
      Array.from(before.keys()).sort(),
    );
    for (const [rel, bytes] of before) {
      expect(readFileSync(fileFor(rel), 'utf8')).toBe(bytes);
    }
    const restoredRows = await repo.listAsync(undefined, undefined, 100);
    expect(restoredRows).toHaveLength(3);
    for (const row of restoredRows) {
      const original = parseMemoryNote(before.get(row.sourceId!)!);
      expect(JSON.parse(row.sourcesJson)).toEqual(original.sources);
    }

    const repeated = await runMemoryConsolidation({ memoryDir, index, repo });
    expect(repeated.mergedClusters).toBe(1);
    const firstMerged = parseMemoryNote(firstMergedBytes);
    const secondMerged = parseMemoryNote(readFileSync(survivorPath, 'utf8'));
    expect({
      body: secondMerged.body,
      sources: secondMerged.sources,
      usageWindow: secondMerged.usageWindow,
    }).toEqual({
      body: firstMerged.body,
      sources: firstMerged.sources,
      usageWindow: firstMerged.usageWindow,
    });
  });

  it('#1193: skips and logs a malformed member without aborting the pass', async () => {
    await seedPreExistingOverlappingNotes();
    const badRel = path.join('memory', 'fact', 'bad.md');
    writeFileSync(
      fileFor(badRel),
      ['---', 'id: [unterminated', '---', 'bad note'].join('\n'),
      'utf8',
    );
    await index.upsertNote({
      sourceId: badRel,
      parsed: { kind: 'fact', tags: [], content: 'bad note' },
    });
    const danglingRel = path.join('memory', 'fact', 'dangling.md');
    const danglingBytes = renderMemoryNote(
      {
        id: generateUlid(4000),
        kind: 'fact',
        tags: [],
        created: '2026-01-04',
        updated: '2026-01-04',
        source: 'agent',
      },
      'The reservation calendar in the facilities module has a dangling claim.[^X]',
    );
    writeFileSync(fileFor(danglingRel), danglingBytes, 'utf8');
    await index.upsertNote({
      sourceId: danglingRel,
      parsed: {
        kind: 'fact',
        tags: [],
        content: 'The reservation calendar in the facilities module has a dangling claim.[^X]',
      },
    });
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    const result = await runMemoryConsolidation({ memoryDir, index, repo });

    expect(result.mergedClusters).toBe(1);
    expect(existsSync(fileFor(badRel))).toBe(true);
    expect(readFileSync(fileFor(danglingRel), 'utf8')).toBe(danglingBytes);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('skipped unreadable or malformed note'),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('skipped attribution-unsafe note'),
    );
    expect(
      warn.mock.calls.flat().join('\n'),
    ).not.toContain('dangling claim');
    const survivingRows = await repo.listAsync(undefined, undefined, 100);
    expect(survivingRows.some((row) => row.sourceId === badRel)).toBe(true);
    expect(survivingRows.some((row) => row.sourceId === danglingRel)).toBe(true);
    warn.mockRestore();
  });

  it('#1193: a note whose raw snapshot read fails is never mutated or retired', async () => {
    await seedPreExistingOverlappingNotes();
    const survivorRel = path.join('memory', 'fact', 'note-a.md');
    const retireeRel = path.join('memory', 'fact', 'note-b.md');
    const before = new Map([
      [survivorRel, readFileSync(fileFor(survivorRel), 'utf8')],
      [retireeRel, readFileSync(fileFor(retireeRel), 'utf8')],
    ]);
    const realReadFile = fsPromises.readFile.bind(fsPromises);
    const readSpy = vi.spyOn(fsPromises, 'readFile').mockImplementation(
      async (file, ...args) => {
        if (path.resolve(String(file)) === path.resolve(fileFor(retireeRel))) {
          throw new Error('injected EIO');
        }
        return realReadFile(file, ...args as Parameters<typeof fsPromises.readFile> extends [unknown, ...infer Rest] ? Rest : never);
      },
    );

    const result = await runMemoryConsolidation({ memoryDir, index, repo });
    readSpy.mockRestore();

    expect(result.mergedClusters).toBe(0);
    expect(result.retiredCount).toBe(0);
    expect(result.beforeSnapshot.entries.map((entry) => entry.vaultRelKey)).toEqual([
      survivorRel,
    ]);
    for (const [rel, bytes] of before) {
      expect(readFileSync(fileFor(rel), 'utf8')).toBe(bytes);
    }
    expect(await repo.listAsync(undefined, undefined, 100)).toHaveLength(2);
  });

  it('#1193: capture and consolidation produce the same attribution merge', async () => {
    const survivorBody =
      'The reservation calendar lives in the facilities module and supports room booking.[^X]';
    const incomingBody =
      'The reservation calendar in the facilities module supports room booking approvals.[^X]';
    const survivorSources = [
      { id: 'X', resource: 'https://example.test/survivor' },
    ];
    const incomingSources = [
      { id: 'X', resource: 'https://example.test/incoming' },
    ];
    const kindDir = path.join(memoryDir, 'fact');
    mkdirSync(kindDir, { recursive: true });
    const directNotes = [
      {
        name: 'survivor.md',
        id: generateUlid(1000),
        created: '2026-01-01',
        body: survivorBody,
        sources: survivorSources,
        usageWindow: { from: '2026-03-01', to: '2026-04-01' },
      },
      {
        name: 'incoming.md',
        id: generateUlid(2000),
        created: '2026-01-02',
        body: incomingBody,
        sources: incomingSources,
        usageWindow: { from: '2026-02-01', to: '2026-05-01' },
      },
    ];
    for (const note of directNotes) {
      const rel = path.join('memory', 'fact', note.name);
      writeFileSync(
        fileFor(rel),
        renderMemoryNote(
          {
            id: note.id,
            kind: 'fact',
            tags: [],
            created: note.created,
            updated: note.created,
            source: 'agent',
            sources: note.sources,
            usage_window: note.usageWindow,
          },
          note.body,
        ),
        'utf8',
      );
      await index.upsertNote({
        sourceId: rel,
        parsed: { kind: 'fact', tags: [], content: note.body },
      });
    }
    await runMemoryConsolidation({ memoryDir, index, repo });
    const consolidation = parseMemoryNote(
      readFileSync(fileFor(path.join('memory', 'fact', 'survivor.md')), 'utf8'),
    );

    rmSync(memoryDir, { recursive: true, force: true });
    setDb(makeDb());
    repo = new AgentMemoryRepository();
    index = new MemoryIndexService(repo);
    const first = await rememberToVault(
      {
        kind: 'fact',
        content: survivorBody,
        sources: survivorSources,
        usageWindow: { from: '2026-03-01', to: '2026-04-01' },
      },
      { memoryDir, index },
    );
    await rememberToVault(
      {
        kind: 'fact',
        content: incomingBody,
        sources: incomingSources,
        usageWindow: { from: '2026-02-01', to: '2026-05-01' },
      },
      { memoryDir, index },
    );
    const capture = parseMemoryNote(
      readFileSync(fileFor(first.path), 'utf8'),
    );

    expect({
      body: consolidation.body,
      sources: consolidation.sources,
      usageWindow: consolidation.usageWindow,
    }).toEqual({
      body: capture.body,
      sources: capture.sources,
      usageWindow: capture.usageWindow,
    });
    expect(validateNoteSources(capture).danglingFootnoteReferences).toEqual([]);
  });
});
