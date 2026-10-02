/**
 * Conditional canonical observation writes use a real temporary vault and
 * in-memory SQLite index only. They never touch a user Memory-Vault.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { MemoryIndexService } from '../services/memory_index_service';
import {
  createObservationIfAbsentInVault,
  generateUlid,
  MemoryCreateOnlyError,
  renderMemoryNote,
  rememberToVault,
  type CreateOnlyObservationInput,
} from '../services/memoryVaultWriteService';

let vaultRoot: string;
let memoryDir: string;
let repo: AgentMemoryRepository;
let index: MemoryIndexService;

function input(id = generateUlid(), revision = 'revision-1'): CreateOnlyObservationInput {
  return {
    id,
    kind: 'context',
    content: 'Dayflow activity observation (unverified)\n\nSynthetic detail.',
    source: 'dayflow',
    tags: ['dayflow', 'activity-observation'],
    sources: [{
      id: 'dayflow_fixture',
      resource: 'dayflow://card/synthetic-card',
      revision,
      normalizer_version: 'fixture-normalizer-v1',
    }],
    usageWindow: { from: '2026-10-01', to: '2026-10-01' },
    sourceRevision: revision,
    normalizerVersion: 'fixture-normalizer-v1',
  };
}

function notePath(receipt: { path: string }): string {
  return path.join(vaultRoot, receipt.path);
}

function canonicalFiles(): string[] {
  const context = path.join(memoryDir, 'context');
  return existsSync(context)
    ? readdirSync(context).filter((name) =>
      name.endsWith('.md') && name.toLowerCase() !== 'index.md',
    ).sort()
    : [];
}

beforeEach(() => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  repo = new AgentMemoryRepository();
  index = new MemoryIndexService(repo);
  vaultRoot = mkdtempSync(path.join(tmpdir(), 'dayflow-create-only-'));
  memoryDir = path.join(vaultRoot, 'memory');
});

afterEach(() => rmSync(vaultRoot, { recursive: true, force: true }));

describe('Dayflow conditional canonical observation writer', () => {
  it('creates two identical-heading observations as distinct ID-qualified canonical files', async () => {
    const first = await createObservationIfAbsentInVault(input(), { memoryDir, index });
    const second = await createObservationIfAbsentInVault(input(), { memoryDir, index });

    expect(first.disposition).toBe('created');
    expect(second.disposition).toBe('created');
    expect(first.path).not.toBe(second.path);
    expect(canonicalFiles()).toEqual([
      `import-${first.id.toLowerCase()}.md`,
      `import-${second.id.toLowerCase()}.md`,
    ].sort());
    expect(readFileSync(notePath(first), 'utf8')).toContain('Synthetic detail.');
    expect(readFileSync(notePath(second), 'utf8')).toContain('Synthetic detail.');
    expect(await repo.listAsync(undefined, undefined, 20)).toHaveLength(2);
  });

  it('adopts an exact same-ID replay without rewriting canonical bytes', async () => {
    const observation = input();
    const created = await createObservationIfAbsentInVault(observation, { memoryDir, index });
    const before = readFileSync(notePath(created), 'utf8');

    const replay = await createObservationIfAbsentInVault(observation, { memoryDir, index });

    expect(replay).toMatchObject({
      id: created.id,
      path: created.path,
      disposition: 'already_present',
      canonicalContentHash: created.canonicalContentHash,
    });
    expect(readFileSync(notePath(created), 'utf8')).toBe(before);
  });

  it('refuses a legacy provenance replay without rewriting canonical bytes', async () => {
    const legacy = input();
    const created = await createObservationIfAbsentInVault(legacy, { memoryDir, index });
    const before = readFileSync(notePath(created), 'utf8');
    const enriched = input(legacy.id);
    enriched.sources = [{
      ...enriched.sources[0],
      origin: 'dayflow',
      observationId: 'dayflow_fixture',
      observedAt: '2026-10-01T08:00:00Z',
    }];

    await expect(createObservationIfAbsentInVault(enriched, { memoryDir, index }))
      .rejects.toMatchObject({ code: 'MEMORY_CREATE_CONFLICT' });
    expect(readFileSync(notePath(created), 'utf8')).toBe(before);
  });

  it('replays optional undefined source fields as their canonical omitted form and repairs the index', async () => {
    const observation = input();
    observation.sources = [{
      ...observation.sources[0],
      observed_end: undefined,
    }];
    const created = await createObservationIfAbsentInVault(observation, { memoryDir, index });
    const before = readFileSync(notePath(created), 'utf8');
    await index.removeNote(created.path);

    const replay = await createObservationIfAbsentInVault(observation, { memoryDir, index });

    expect(replay.disposition).toBe('already_present');
    expect(readFileSync(notePath(created), 'utf8')).toBe(before);
    expect(await repo.listAsync(undefined, undefined, 20)).toHaveLength(1);
  });

  it('accepts an observation body within the agreed 8,000-character import bound', async () => {
    const observation = input();
    observation.content = 'Synthetic activity summary '.repeat(24);

    await expect(createObservationIfAbsentInVault(observation, { memoryDir, index }))
      .resolves.toMatchObject({ disposition: 'created' });
  });

  it('rejects changed provenance, body, lifecycle, or another-kind ownership without mutation', async () => {
    const observation = input();
    const created = await createObservationIfAbsentInVault(observation, { memoryDir, index });
    const canonical = notePath(created);
    const before = readFileSync(canonical, 'utf8');

    await expect(createObservationIfAbsentInVault({
      ...observation,
      content: `${observation.content}\nChanged.`,
    }, { memoryDir, index })).rejects.toMatchObject({ code: 'MEMORY_CREATE_CONFLICT' });
    await expect(createObservationIfAbsentInVault(input(observation.id, 'revision-2'), {
      memoryDir, index,
    })).rejects.toMatchObject({ code: 'MEMORY_CREATE_CONFLICT' });
    expect(readFileSync(canonical, 'utf8')).toBe(before);

    writeFileSync(canonical, before.replace('Synthetic detail.', 'Human edit.'));
    await expect(createObservationIfAbsentInVault(observation, { memoryDir, index }))
      .rejects.toMatchObject({ code: 'MEMORY_CREATE_CONFLICT' });

    writeFileSync(canonical, before);
    writeFileSync(canonical, before.replace('status: stable', 'status: deprecated'));
    await expect(createObservationIfAbsentInVault(observation, { memoryDir, index }))
      .rejects.toMatchObject({ code: 'MEMORY_CREATE_CONFLICT' });

    const otherId = generateUlid();
    await rememberToVault({ kind: 'fact', id: otherId, content: 'Different kind ownership.' }, {
      memoryDir, index,
    });
    await expect(createObservationIfAbsentInVault(input(otherId), { memoryDir, index }))
      .rejects.toMatchObject({ code: 'MEMORY_CREATE_CONFLICT' });

    const unmanagedId = generateUlid();
    const unmanagedPath = path.join(memoryDir, 'context', `import-${unmanagedId.toLowerCase()}.md`);
    writeFileSync(unmanagedPath, `---\nid: ${unmanagedId}\nsource: human\n---\n\nUnmanaged note.\n`);
    const unmanagedBefore = readFileSync(unmanagedPath, 'utf8');
    await expect(createObservationIfAbsentInVault(input(unmanagedId), { memoryDir, index }))
      .rejects.toMatchObject({ code: 'MEMORY_CREATE_CONFLICT' });
    expect(readFileSync(unmanagedPath, 'utf8')).toBe(unmanagedBefore);
  });

  it('repairs a missing derived index from an exact canonical note', async () => {
    const created = await createObservationIfAbsentInVault(input(), { memoryDir, index });
    await index.removeNote(created.path);
    expect(await repo.listAsync(undefined, undefined, 20)).toHaveLength(0);

    const replay = await createObservationIfAbsentInVault(input(created.id), { memoryDir, index });

    expect(replay.disposition).toBe('already_present');
    expect(await repo.listAsync(undefined, undefined, 20)).toHaveLength(1);
  });

  it('keeps one winner for concurrent conflicting creates and never clobbers an external promotion race', async () => {
    const id = generateUlid();
    const [first, second] = await Promise.allSettled([
      createObservationIfAbsentInVault(input(id, 'revision-1'), { memoryDir, index }),
      createObservationIfAbsentInVault(input(id, 'revision-2'), { memoryDir, index }),
    ]);
    expect([first, second].filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect([first, second].filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(canonicalFiles()).toHaveLength(1);

    const racedId = generateUlid();
    await expect(createObservationIfAbsentInVault(input(racedId), {
      memoryDir,
      index,
      beforeNotePromotion: async (_parent, destination) => {
        writeFileSync(destination, renderMemoryNote({
          id: generateUlid(), kind: 'context', tags: [], created: '2026-10-01',
          updated: '2026-10-01', source: 'external', status: 'stable',
        }, 'External owner.'));
      },
    })).rejects.toBeInstanceOf(MemoryCreateOnlyError);
    const racedDestination = path.join(memoryDir, 'context', `import-${racedId.toLowerCase()}.md`);
    expect(readFileSync(racedDestination, 'utf8')).toContain('External owner.');
  });

  it('recovers after index failure from the committed canonical note without rewriting it', async () => {
    const observation = input();
    const failingIndex = {
      upsertNote: async () => { throw new Error('synthetic index outage'); },
    } as unknown as MemoryIndexService;
    await expect(createObservationIfAbsentInVault(observation, { memoryDir, index: failingIndex }))
      .rejects.toMatchObject({ code: 'MEMORY_CREATE_UNAVAILABLE' });

    const expectedPath = path.join(memoryDir, 'context', `import-${observation.id.toLowerCase()}.md`);
    const before = readFileSync(expectedPath, 'utf8');
    const recovered = await createObservationIfAbsentInVault(observation, { memoryDir, index });

    expect(recovered.disposition).toBe('already_present');
    expect(readFileSync(expectedPath, 'utf8')).toBe(before);
    expect(await repo.listAsync(undefined, undefined, 20)).toHaveLength(1);
  });
});
