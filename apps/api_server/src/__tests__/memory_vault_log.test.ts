import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { MemoryIndexService } from '../services/memory_index_service';
import {
  deprecateMemory,
  forgetFromVault,
  generateUlid,
  rememberToVault,
  renderMemoryNote,
  updateMemoryInVault,
  verifyMemory,
} from '../services/memoryVaultWriteService';
import { runMemoryConsolidation } from '../services/memory_consolidation_drafter';
import {
  enqueueMemoryVaultLog,
  flushMemoryVaultLog,
  type MemoryVaultLogReason,
} from '../services/memory_vault_log';

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
let savedSubdir: string | undefined;

beforeEach(() => {
  savedSubdir = process.env.MEMORY_VAULT_SUBDIR;
  delete process.env.MEMORY_VAULT_SUBDIR;
  setDb(makeDb());
  repo = new AgentMemoryRepository();
  index = new MemoryIndexService(repo);
  vaultRoot = mkdtempSync(path.join(tmpdir(), 'memory-vault-log-test-'));
  memoryDir = path.join(vaultRoot, 'memory');
  mkdirSync(memoryDir, { recursive: true });
});

afterEach(async () => {
  await flushMemoryVaultLog(memoryDir);
  if (savedSubdir === undefined) delete process.env.MEMORY_VAULT_SUBDIR;
  else process.env.MEMORY_VAULT_SUBDIR = savedSubdir;
  rmSync(vaultRoot, { recursive: true, force: true });
});

function readLog(filename = 'log.md'): string {
  return readFileSync(path.join(memoryDir, filename), 'utf8');
}

describe('MEM-OKF #1196 human-readable audit history', () => {
  it('renders every structured event with newest-first dates and no note body', async () => {
    const reasons: MemoryVaultLogReason[] = [
      'captured',
      'updated',
      'merge-on-capture',
      'verified',
      'deprecated',
      'forgotten',
      'consolidation-merge',
      'consolidation-retirement',
      'consolidation-revert',
    ];
    for (const [index, reason] of reasons.entries()) {
      enqueueMemoryVaultLog(memoryDir, {
        reason,
        actor: 'agent:audit-test/1',
        noteSourceId: `memory/fact/note-${index}.md`,
        relatedSourceIds: ['memory/fact/related-note.md'],
        date: index % 2 === 0 ? '2026-07-25' : '2026-07-26',
      }, { maxDays: 10_000 });
    }
    await flushMemoryVaultLog(memoryDir);

    const log = readLog();
    expect(log.indexOf('# 2026-07-26')).toBeLessThan(
      log.indexOf('# 2026-07-25'),
    );
    expect(log).toContain('**Creation**');
    expect(log).toContain('**Update**');
    expect(log).toContain('**Deprecation**');
    expect(log).toContain('agent:audit-test/1');
    expect(log).toContain('[Note 0](/fact/note-0.md)');
    expect(log).toContain('merged [Related Note]');
    expect(log).toContain('reverted to its pre-consolidation state');
    expect(log).not.toContain('frontmatter:');
    expect(log.split('\n').filter((line) => line.startsWith('**'))).toHaveLength(
      reasons.length,
    );
  });

  it('hooks capture, update, verify, deprecate, edit, merge-on-capture, and forget', async () => {
    const secretBody = [
      'Stable public note title.',
      'PRIVATE_BODY_MARKER should stay only in the note.',
    ].join('\n');
    const first = await rememberToVault(
      {
        id: generateUlid(),
        kind: 'fact',
        content: secretBody,
      },
      { memoryDir, index },
    );
    await rememberToVault(
      {
        id: first.id,
        kind: 'fact',
        content: `${secretBody} Updated.`,
      },
      { memoryDir, index },
    );
    await verifyMemory(first.path, 'human:auditor@example.test', {
      memoryDir,
      index,
      at: '2026-07-26T10:00:00Z',
    });
    await deprecateMemory(first.path, 'human:auditor@example.test', {
      memoryDir,
      index,
      at: '2026-07-26T11:00:00Z',
    });
    const edited = await updateMemoryInVault(
      first.id,
      { tags: ['edited'] },
      { memoryDir, index },
    );
    expect(edited).not.toBeNull();
    await forgetFromVault(edited!.path, { memoryDir, index });

    await rememberToVault(
      {
        kind: 'preference',
        content: 'AJ prefers the Sonnet model for coding agents to save tokens.',
      },
      { memoryDir, index },
    );
    await rememberToVault(
      {
        kind: 'preference',
        content: 'AJ prefers using the Sonnet model for code agents, especially for cost-sensitive tasks.',
      },
      { memoryDir, index },
    );
    await flushMemoryVaultLog(memoryDir);

    const log = readLog();
    expect(log).toContain('captured by agent:rhythm/1');
    expect(log).toContain('updated by agent:rhythm/1');
    expect(log).toContain('verified by human:auditor@example.test');
    expect(log).toContain('deprecated by human:auditor@example.test');
    expect(log).toContain('forgotten by agent:rhythm/1');
    expect(log).toContain(
      'merged incoming [Aj Prefers Using The Sonnet Model For Code Agents Especially](/preference/aj-prefers-using-the-sonnet-model-for-code-agents-especially.md)',
    );
    expect(log).not.toContain('PRIVATE_BODY_MARKER');
  });

  it('serializes concurrent appends and rotates by count without losing history', async () => {
    const today = new Date();
    const date = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
    ].join('-');
    for (let i = 0; i < 50; i += 1) {
      enqueueMemoryVaultLog(memoryDir, {
        reason: 'captured',
        actor: 'process:concurrency-test',
        noteSourceId: `memory/fact/concurrent-${i}.md`,
        date,
      }, { maxEntries: 10, maxDays: 90 });
    }
    await flushMemoryVaultLog(memoryDir);

    const main = readLog();
    const archive = readLog(`log-archive-${date.slice(0, 4)}.md`);
    const lines = `${main}\n${archive}`
      .split('\n')
      .filter((line) => line.startsWith('**Creation**'));
    expect(main.split('\n').filter((line) => line.startsWith('**'))).toHaveLength(10);
    expect(lines).toHaveLength(50);
    expect(new Set(lines).size).toBe(50);
    expect(main).toContain('Concurrent 49');
    expect(archive).toContain('Concurrent 0');
  });

  it('serializes an overlapping consolidation pass and interactive capture', async () => {
    const factDir = path.join(memoryDir, 'fact');
    mkdirSync(factDir, { recursive: true });
    const fixtures = [
      {
        sourceId: 'memory/fact/overlap-a.md',
        id: generateUlid(1_000),
        created: '2026-01-01',
        body: 'The reservation calendar lives in the facilities module.',
      },
      {
        sourceId: 'memory/fact/overlap-b.md',
        id: generateUlid(2_000),
        created: '2026-01-02',
        body: 'Facilities module houses the reservation calendar for booking rooms.',
      },
    ];
    for (const fixture of fixtures) {
      const rendered = renderMemoryNote({
        id: fixture.id,
        kind: 'fact',
        tags: [],
        created: fixture.created,
        updated: fixture.created,
        source: 'agent',
      }, fixture.body);
      writeFileSync(
        path.join(vaultRoot, fixture.sourceId),
        rendered,
        'utf8',
      );
      await index.upsertNote({
        sourceId: fixture.sourceId,
        parsed: { kind: 'fact', tags: [], content: fixture.body },
      });
    }

    const [consolidation, capture] = await Promise.all([
      runMemoryConsolidation({ memoryDir, index, repo, threshold: 0.2 }),
      rememberToVault(
        {
          kind: 'context',
          content: 'Interactive capture while consolidation is active.',
        },
        { memoryDir, index },
      ),
    ]);
    expect(consolidation.mergedClusters).toBe(1);
    expect(capture.id).toBeTruthy();
    await flushMemoryVaultLog(memoryDir);

    const log = readLog();
    expect(log).toContain(
      '**Creation** [Interactive Capture While Consolidation Is Active]',
    );
    expect(log).toContain(
      '**Update** [Overlap A](/fact/overlap-a.md) - merged [Overlap B](/fact/overlap-b.md)',
    );
    expect(log.split('\n').filter((line) => line.startsWith('**')))
      .toHaveLength(3);
  });

  it('records a canonical mutation even when the derived index refresh fails', async () => {
    const created = await rememberToVault(
      { kind: 'fact', content: 'Vault-first audit ordering.' },
      { memoryDir, index },
    );
    await flushMemoryVaultLog(memoryDir);
    const failingIndex = {
      upsertNote: async () => {
        throw new Error('forced derived-index failure');
      },
    } as unknown as MemoryIndexService;

    await expect(verifyMemory(
      created.path,
      'human:ordering-test',
      {
        memoryDir,
        index: failingIndex,
        at: '2026-07-26T14:00:00Z',
      },
    )).rejects.toThrow('forced derived-index failure');
    await flushMemoryVaultLog(memoryDir);

    expect(readLog()).toContain('verified by human:ordering-test');
  });

  it('rotates entries older than the retention window into yearly archives', async () => {
    enqueueMemoryVaultLog(memoryDir, {
      reason: 'captured',
      actor: 'process:retention-test',
      noteSourceId: 'memory/fact/historical.md',
      date: '2020-01-02',
    });
    enqueueMemoryVaultLog(memoryDir, {
      reason: 'captured',
      actor: 'process:retention-test',
      noteSourceId: 'memory/fact/current.md',
    });
    await flushMemoryVaultLog(memoryDir);

    expect(readLog()).toContain('[Current]');
    expect(readLog()).not.toContain('[Historical]');
    expect(readLog('log-archive-2020.md')).toContain('[Historical]');
  });

  it('retains all history in the main log when archive rotation fails', async () => {
    const outside = path.join(vaultRoot, 'outside-archive.md');
    writeFileSync(outside, 'do not overwrite', 'utf8');
    symlinkSync(
      outside,
      path.join(memoryDir, 'log-archive-2026.md'),
    );
    for (let index = 0; index < 5; index += 1) {
      enqueueMemoryVaultLog(memoryDir, {
        reason: 'updated',
        actor: 'process:rotation-failure-test',
        noteSourceId: `memory/fact/retained-${index}.md`,
        date: '2026-07-26',
      }, {
        maxEntries: 2,
        maxDays: 90,
        today: '2026-07-26',
      });
    }
    await flushMemoryVaultLog(memoryDir);

    expect(readLog().split('\n').filter((line) => line.startsWith('**')))
      .toHaveLength(5);
    expect(readFileSync(outside, 'utf8')).toBe('do not overwrite');
  });

  it('fails open and refuses a symlinked audit output', async () => {
    const outside = path.join(vaultRoot, 'outside.md');
    writeFileSync(outside, 'do not overwrite', 'utf8');
    symlinkSync(outside, path.join(memoryDir, 'log.md'));

    const result = await rememberToVault(
      { kind: 'fact', content: 'The mutation still succeeds.' },
      { memoryDir, index },
    );
    expect(result.id).toBeTruthy();
    expect(existsSync(path.join(vaultRoot, result.path))).toBe(true);
    await flushMemoryVaultLog(memoryDir);
    expect(readFileSync(outside, 'utf8')).toBe('do not overwrite');
  });
});
