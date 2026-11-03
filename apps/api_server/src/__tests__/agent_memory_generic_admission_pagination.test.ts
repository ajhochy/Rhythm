/**
 * Generic Dayflow withholding must decide page/count/shortlist membership
 * BEFORE the visible LIMIT/OFFSET, not after. Newer withheld rows used to
 * starve ordinary-memory pages and inflate counts. The raw repository path
 * (used by the qualified Dayflow reader) is deliberately unchanged.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { agentMemoryService } from '../services/agentMemoryService';

const OWNER = 7;
const repo = new AgentMemoryRepository();

async function put(
  id: string,
  updatedAt: string,
  over: Partial<Parameters<AgentMemoryRepository['upsertBySourceAsync']>[0]> = {},
): Promise<void> {
  await repo.upsertBySourceAsync({
    kind: 'context',
    content: `shortlistterm ${id}`,
    source: 'obsidian-memory',
    sourceId: id,
    tagsJson: '[]',
    ownerUserId: OWNER,
    createdAt: updatedAt,
    updatedAt,
    ...over,
  });
}

beforeEach(async () => {
  const db = new Database(':memory:');
  runMigrations(db);
  // Fixture owners have no users catalog rows.
  db.pragma('foreign_keys = OFF');
  setDb(db);
  // Three NEWER withheld rows (each way the predicate recognizes Dayflow) ...
  await put('hidden-source', '2026-10-06T10:00:03Z', { source: 'dayflow-qualified-index', content: 'shortlistterm shortlistterm shortlistterm' });
  await put('hidden-tag', '2026-10-06T10:00:02Z', { tagsJson: '["source:Dayflow"]', content: 'shortlistterm shortlistterm' });
  await put('hidden-sources', '2026-10-06T10:00:01Z', { sourcesJson: '[{"label":"DAYFLOW export"}]' });
  // ... four older ordinary rows, one of them another owner's.
  await put('plain-1', '2026-10-06T09:00:04Z');
  await put('plain-2', '2026-10-06T09:00:03Z');
  await put('plain-3', '2026-10-06T09:00:02Z', { kind: 'decision' });
  await put('plain-4', '2026-10-06T09:00:01Z');
  await put('foreign', '2026-10-06T09:30:00Z', { ownerUserId: 8 });
});

const ids = (rows: Array<{ sourceId: string | null }>): Array<string | null> => rows.map((row) => row.sourceId);

describe('generic admission before pagination', () => {
  it('returns the newest ordinary row for limit 1 despite newer withheld rows', async () => {
    expect(ids(await agentMemoryService.list(OWNER, undefined, 1))).toEqual(['plain-1']);
  });

  it('pages through ordinary rows with no gaps, repeats or short pages', async () => {
    const pages: Array<Array<string | null>> = [];
    for (const offset of [0, 2, 4]) {
      pages.push(ids(await agentMemoryService.list(OWNER, undefined, 2, { offset })));
    }
    expect(pages).toEqual([['plain-1', 'plain-2'], ['plain-3', 'plain-4'], []]);
  });

  it('counts exactly the collection the pages walk, preserving owner scope', async () => {
    const counts = await agentMemoryService.countByKind(OWNER);
    expect(counts).toEqual({ context: 3, decision: 1 });
    const walked = [
      ...(await agentMemoryService.list(OWNER, undefined, 50)),
    ];
    expect(walked).toHaveLength(Object.values(counts).reduce((sum, n) => sum + n, 0));
    expect(await agentMemoryService.countByKind(OWNER, true)).toEqual(counts);
  });

  it('keeps the kind filter and its count consistent', async () => {
    expect(ids(await agentMemoryService.list(OWNER, 'decision', 5))).toEqual(['plain-3']);
  });

  it('does not let withheld, better-ranked rows starve the search shortlist', async () => {
    const found = await agentMemoryService.search('shortlistterm', OWNER, 1);
    expect(found).toHaveLength(1);
    expect(found[0].sourceId).toMatch(/^plain-/);
  });

  it('leaves the raw repository path, which qualified Dayflow readers use, unfiltered', async () => {
    const raw = ids(await repo.listAsync(OWNER, undefined, 50));
    expect(raw).toEqual(expect.arrayContaining(['hidden-source', 'hidden-tag', 'hidden-sources', 'plain-1']));
    expect(await repo.countByKindAsync(OWNER)).toEqual({ context: 6, decision: 1 });
    expect(ids(await repo.searchAsync('shortlistterm', OWNER, 1))[0]).toBe('hidden-source');
  });
});
