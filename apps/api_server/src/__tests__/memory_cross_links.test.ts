import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import {
  runMemoryConsolidation,
  revertMemoryConsolidation,
} from '../services/memory_consolidation_drafter';
import { MemoryIndexService } from '../services/memory_index_service';
import {
  generateUlid,
  rememberToVault,
  renderMemoryNote,
  resolveMemoryLinkTarget,
} from '../services/memoryVaultWriteService';
import { parseNote, syncMemoryVault } from '../services/memoryVaultSyncService';
import { buildMemoryPreface } from '../services/memory_retrieval';

let vaultRoot: string;
let memoryDir: string;
let repo: AgentMemoryRepository;
let index: MemoryIndexService;
let savedSubdir: string | undefined;

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function abs(sourceId: string): string {
  return path.join(vaultRoot, sourceId);
}

function memoryAbsoluteTarget(sourceId: string): string {
  return `/${sourceId.split(path.sep).slice(1).join('/')}`;
}

async function seedNote(
  rel: string,
  body: string,
  created: string,
): Promise<string> {
  const sourceId = path.join('memory', rel);
  const id = generateUlid(Date.parse(`${created}T00:00:00Z`));
  const rendered = renderMemoryNote({
    id,
    kind: 'fact',
    tags: [],
    created,
    updated: created,
    source: 'agent',
  }, body);
  mkdirSync(path.dirname(abs(sourceId)), { recursive: true });
  writeFileSync(abs(sourceId), rendered, 'utf8');
  await index.upsertNote({ sourceId, parsed: parseNote(rendered) });
  return sourceId;
}

beforeEach(() => {
  savedSubdir = process.env.MEMORY_VAULT_SUBDIR;
  delete process.env.MEMORY_VAULT_SUBDIR;
  process.env.AGENT_MEMORY_RETRIEVAL_MODE = 'fts';
  setDb(makeDb());
  repo = new AgentMemoryRepository();
  index = new MemoryIndexService(repo);
  vaultRoot = mkdtempSync(path.join(tmpdir(), 'memory-links-'));
  memoryDir = path.join(vaultRoot, 'memory');
});

afterEach(() => {
  if (savedSubdir === undefined) delete process.env.MEMORY_VAULT_SUBDIR;
  else process.env.MEMORY_VAULT_SUBDIR = savedSubdir;
  delete process.env.AGENT_MEMORY_RETRIEVAL_MODE;
  delete process.env.AGENT_MEMORY_LINK_EXPANSION_ENABLED;
  rmSync(vaultRoot, { recursive: true, force: true });
});

describe('MEM-OKF cross-link resolution and writes (#1195)', () => {
  it('resolves absolute/relative notes and rejects broken, escaping, reserved, and symlink targets', async () => {
    const target = await rememberToVault(
      { kind: 'person', content: 'Pastor Mike owns service planning.' },
      { memoryDir, index },
    );
    const targetName = path.basename(target.path);
    const from = path.join('memory', 'project', 'source.md');

    await expect(resolveMemoryLinkTarget(
      memoryDir,
      from,
      `/person/${targetName}`,
    )).resolves.toBe(target.path);
    await expect(resolveMemoryLinkTarget(
      memoryDir,
      from,
      `../person/${targetName}`,
    )).resolves.toBe(target.path);
    await expect(resolveMemoryLinkTarget(
      memoryDir,
      path.join('memory', 'person', 'source.md'),
      `./${targetName}`,
    )).resolves.toBe(target.path);
    await expect(resolveMemoryLinkTarget(
      memoryDir,
      from,
      `../person/${targetName}#owner`,
    )).resolves.toBe(target.path);
    await expect(resolveMemoryLinkTarget(
      memoryDir,
      from,
      '../../etc/passwd.md',
    )).resolves.toBeNull();
    await expect(resolveMemoryLinkTarget(
      memoryDir,
      from,
      '..\\..\\etc\\passwd.md',
    )).resolves.toBeNull();
    await expect(resolveMemoryLinkTarget(
      memoryDir,
      from,
      '/person/missing.md',
    )).resolves.toBeNull();
    await expect(resolveMemoryLinkTarget(
      memoryDir,
      from,
      '/person/index.md',
    )).resolves.toBeNull();
    await expect(resolveMemoryLinkTarget(
      memoryDir,
      from,
      '/person/%E0%A4%A.md',
    )).resolves.toBeNull();
    writeFileSync(
      path.join(memoryDir, 'person', 'hash #1.md'),
      '---\nkind: person\n---\nHash filename.',
    );
    await expect(resolveMemoryLinkTarget(
      memoryDir,
      from,
      '/person/hash%20%231.md',
    )).resolves.toBe(path.join('memory', 'person', 'hash #1.md'));

    writeFileSync(path.join(memoryDir, 'person', 'not-memory.txt'), 'text');
    mkdirSync(path.join(memoryDir, 'person', 'directory.md'));
    await expect(resolveMemoryLinkTarget(
      memoryDir,
      from,
      '/person/not-memory.txt',
    )).resolves.toBeNull();
    await expect(resolveMemoryLinkTarget(
      memoryDir,
      from,
      '/person/directory.md',
    )).resolves.toBeNull();

    const outside = mkdtempSync(path.join(tmpdir(), 'memory-link-outside-'));
    try {
      writeFileSync(path.join(outside, 'outside.md'), 'outside');
      symlinkSync(
        path.join(outside, 'outside.md'),
        path.join(memoryDir, 'person', 'escape.md'),
      );
      await expect(resolveMemoryLinkTarget(
        memoryDir,
        from,
        '/person/escape.md',
      )).resolves.toBeNull();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('resolves clean-layout sourceIds without introducing a memory/ prefix', async () => {
    process.env.MEMORY_VAULT_SUBDIR = '';
    const cleanDir = path.join(vaultRoot, 'clean-memory');
    mkdirSync(path.join(cleanDir, 'person'), { recursive: true });
    writeFileSync(
      path.join(cleanDir, 'person', 'target.md'),
      '---\nkind: person\n---\nTarget.',
    );

    await expect(resolveMemoryLinkTarget(
      cleanDir,
      path.join('fact', 'source.md'),
      '/person/target.md',
    )).resolves.toBe(path.join('person', 'target.md'));
  });

  it('writes resolved inputs as deduplicated absolute markdown and derives backlinks', async () => {
    const target = await rememberToVault(
      { kind: 'person', content: 'Pastor Mike owns service planning.' },
      { memoryDir, index },
    );
    const targetLink = memoryAbsoluteTarget(target.path);
    const source = await rememberToVault(
      {
        kind: 'project',
        content: `Mike leads this project. [Existing](${targetLink})`,
        links: [
          { target: targetLink, label: 'Pastor Mike' },
          { target: '../../etc/passwd.md', label: 'Unsafe' },
          { target: '/person/index.md', label: 'Generated' },
        ],
      },
      { memoryDir, index },
    );

    const body = parseNote(readFileSync(abs(source.path), 'utf8')).content;
    expect(body.match(new RegExp(targetLink, 'g'))).toHaveLength(1);
    expect(body).not.toContain('Unsafe');
    expect(body).not.toContain('Generated');

    const targetIndex = readFileSync(
      path.join(memoryDir, 'person', 'index.md'),
      'utf8',
    );
    expect(targetIndex).toContain('Backlinks:');
    expect(targetIndex).toContain('../project/');
  });

  it('tolerates a dangling link through sync, indexing, injection, and consolidation', async () => {
    const remembered = await rememberToVault(
      {
        kind: 'fact',
        content:
          'Danglingtoken remains useful. [Missing](/person/never-existed.md)',
      },
      { memoryDir, index },
    );

    await expect(syncMemoryVault({ vaultPath: vaultRoot })).resolves.toMatchObject({
      scanned: 1,
    });
    const preface = await buildMemoryPreface('danglingtoken', null);
    expect(preface.text).toContain('Danglingtoken remains useful.');
    await expect(runMemoryConsolidation({ memoryDir, index, repo }))
      .resolves.toMatchObject({ mergedClusters: 0, retiredCount: 0 });
    expect(existsSync(abs(remembered.path))).toBe(true);
  });

  it('preserves links from both bodies during merge-on-capture', async () => {
    const mike = await rememberToVault(
      { kind: 'person', content: 'Mike is the facilities lead.' },
      { memoryDir, index },
    );
    const sunday = await rememberToVault(
      { kind: 'project', content: 'Sunday service is the weekly gathering.' },
      { memoryDir, index },
    );
    const first = await rememberToVault(
      {
        kind: 'fact',
        content:
          `Facilities reservation uses the shared calendar for room booking. [Mike](${memoryAbsoluteTarget(mike.path)})`,
      },
      { memoryDir, index },
    );
    const second = await rememberToVault(
      {
        kind: 'fact',
        content:
          `Facilities reservation uses the shared calendar for room requests. [Sunday](${memoryAbsoluteTarget(sunday.path)})`,
      },
      { memoryDir, index },
    );

    expect(second.id).toBe(first.id);
    const body = parseNote(readFileSync(abs(first.path), 'utf8')).content;
    expect(body).toContain(`[Mike](${memoryAbsoluteTarget(mike.path)})`);
    expect(body).toContain(`[Sunday](${memoryAbsoluteTarget(sunday.path)})`);
  });
});

describe('MEM-OKF consolidation link rewrites (#1195)', () => {
  it('rewrites retiree backlinks to the survivor and revert restores exact bytes', async () => {
    const survivor = await seedNote(
      path.join('fact', 'note-a.md'),
      'Facilities booking uses the shared reservation calendar for rooms.',
      '2026-01-01',
    );
    const retiree = await seedNote(
      path.join('fact', 'note-b.md'),
      'Facilities booking uses the shared reservation calendar for room requests.',
      '2026-02-01',
    );
    const referrer = await seedNote(
      path.join('fact', 'referrer.md'),
      'Related operating note. [Booking detail](./note-b.md)',
      '2026-03-01',
    );
    const referrerBefore = readFileSync(abs(referrer), 'utf8');

    const result = await runMemoryConsolidation({
      memoryDir,
      index,
      repo,
    });

    expect(result.retiredCount).toBe(1);
    expect(existsSync(abs(retiree))).toBe(false);
    expect(parseNote(readFileSync(abs(referrer), 'utf8')).content)
      .toContain('[Booking detail](/fact/note-a.md)');
    const navigation = readFileSync(
      path.join(memoryDir, 'fact', 'index.md'),
      'utf8',
    );
    const survivorLine = navigation
      .split('\n')
      .find((line) => line.startsWith('* [Note A]'));
    expect(survivorLine).toContain('Backlinks: [Referrer](referrer.md)');
    expect(navigation).not.toContain('note-b.md');

    await revertMemoryConsolidation(result.beforeSnapshot, {
      memoryDir,
      index,
      repo,
    });
    expect(readFileSync(abs(referrer), 'utf8')).toBe(referrerBefore);
    expect(existsSync(abs(survivor))).toBe(true);
    expect(existsSync(abs(retiree))).toBe(true);
  });
});
