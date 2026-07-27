import Database from 'better-sqlite3';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { MemoryIndexService } from '../services/memory_index_service';
import { parseMemoryNote } from '../services/memory_note_format';
import {
  deprecateMemory,
  rememberToVault,
  verifyMemory,
} from '../services/memoryVaultWriteService';

let vaultRoot: string;
let memoryDir: string;
let repo: AgentMemoryRepository;
let index: MemoryIndexService;
let savedSubdir: string | undefined;

beforeEach(() => {
  savedSubdir = process.env.MEMORY_VAULT_SUBDIR;
  delete process.env.MEMORY_VAULT_SUBDIR;
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  repo = new AgentMemoryRepository();
  index = new MemoryIndexService(repo);
  vaultRoot = mkdtempSync(path.join(tmpdir(), 'mem-verify-'));
  memoryDir = path.join(vaultRoot, 'memory');
});

afterEach(() => {
  if (savedSubdir === undefined) delete process.env.MEMORY_VAULT_SUBDIR;
  else process.env.MEMORY_VAULT_SUBDIR = savedSubdir;
  rmSync(vaultRoot, { recursive: true, force: true });
});

function readNote(sourceId: string) {
  return parseMemoryNote(
    readFileSync(path.join(vaultRoot, sourceId), 'utf8'),
  );
}

describe('MEM-OKF #1190 vault-first verification writes', () => {
  it('appends later confirmations and dedupes an exact by/at retry', async () => {
    const created = await rememberToVault(
      { kind: 'fact', content: 'The welcome desk opens at eight.' },
      { memoryDir, index },
    );
    const before = readNote(created.path);

    await verifyMemory(
      created.path,
      'human:ajh@example.com',
      {
        memoryDir,
        index,
        at: '2026-07-26T10:00:00Z',
      },
    );
    await verifyMemory(
      created.path,
      'human:ajh@example.com',
      {
        memoryDir,
        index,
        at: '2026-07-26T11:00:00Z',
      },
    );
    await verifyMemory(
      created.path,
      'human:ajh@example.com',
      {
        memoryDir,
        index,
        at: '2026-07-26T11:00:00Z',
      },
    );

    const after = readNote(created.path);
    expect(after.verified).toEqual([
      {
        by: 'human:ajh@example.com',
        at: '2026-07-26T10:00:00.000Z',
      },
      {
        by: 'human:ajh@example.com',
        at: '2026-07-26T11:00:00.000Z',
      },
    ]);
    expect(after.frontmatter.created).toEqual(before.frontmatter.created);
    const [row] = await repo.listAsync(undefined, undefined, 10);
    expect(row.trustTier).toBe('human');
    expect(JSON.parse(row.verifiedJson)).toEqual(after.verified);
  });

  it('replaces stale_after only when a new horizon is supplied', async () => {
    const created = await rememberToVault(
      {
        kind: 'context',
        content: 'The seasonal schedule applies this quarter.',
        staleAfter: '2020-01-01',
      },
      { memoryDir, index },
    );

    await verifyMemory(
      created.path,
      'human:ajh@example.com',
      {
        memoryDir,
        index,
        at: '2026-07-26T10:00:00Z',
      },
    );
    expect(readNote(created.path).staleAfter).toBe('2020-01-01');

    await verifyMemory(
      created.path,
      'human:ajh@example.com',
      {
        memoryDir,
        index,
        at: '2026-07-26T11:00:00Z',
        staleAfter: '2026-10-24',
      },
    );
    expect(readNote(created.path).staleAfter).toBe('2026-10-24');
    expect((await repo.listAsync(undefined, undefined, 10))[0].staleAfter)
      .toBe('2026-10-24');
  });

  it('deprecates non-destructively and records the actor', async () => {
    const created = await rememberToVault(
      { kind: 'fact', content: 'The old rehearsal time was six.' },
      { memoryDir, index },
    );

    await deprecateMemory(
      created.path,
      'human:ajh@example.com',
      {
        memoryDir,
        index,
        at: '2026-07-26T12:00:00Z',
      },
    );

    expect(existsSync(path.join(vaultRoot, created.path))).toBe(true);
    const note = readNote(created.path);
    expect(note.status).toBe('deprecated');
    expect(note.verified).toContainEqual({
      by: 'human:ajh@example.com',
      at: '2026-07-26T12:00:00.000Z',
    });
    const rows = await repo.listAsync(undefined, undefined, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('deprecated');
  });

  it('leaves the canonical vault mutation intact when index refresh fails', async () => {
    const created = await rememberToVault(
      { kind: 'fact', content: 'Vault-first failure marker.' },
      { memoryDir, index },
    );
    const failingIndex = {
      upsertNote: async () => {
        throw new Error('forced index failure');
      },
    } as unknown as MemoryIndexService;

    await expect(verifyMemory(
      created.path,
      'human:ajh@example.com',
      {
        memoryDir,
        index: failingIndex,
        at: '2026-07-26T13:00:00Z',
      },
    )).rejects.toThrow('forced index failure');

    expect(readNote(created.path).verified).toContainEqual({
      by: 'human:ajh@example.com',
      at: '2026-07-26T13:00:00.000Z',
    });
  });
});
