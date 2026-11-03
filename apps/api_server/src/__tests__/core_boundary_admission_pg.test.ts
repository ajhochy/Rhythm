/**
 * Core boundary item 2, hosted PostgreSQL branch: no scalar/migration exists,
 * so the same decoded policy runs over ordered finite batches. Within the
 * bound the answer is exact; beyond it the call FAILS explicitly (never a
 * partial count, a short page or a full-looking empty page). The pool is a
 * synthetic stand-in that honors LIMIT/OFFSET; no database is contacted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { env } from '../config/env';

const { fakeQuery } = vi.hoisted(() => ({ fakeQuery: vi.fn() }));
vi.mock('../database/db', () => ({
  getDb: () => { throw new Error('sqlite must not be used on the hosted branch'); },
  getPostgresPool: () => ({ query: fakeQuery }),
}));

import {
  AgentMemoryRepository,
  GENERIC_ADMISSION_BATCH_ROWS,
  GENERIC_ADMISSION_MAX_BATCHES,
  GenericAdmissionScanIncompleteError,
} from '../repositories/agent_memory_repository';

type Dataset = Array<Record<string, unknown>>;
let dataset: Dataset = [];
let queries = 0;
const original = (env as { dbClient: string }).dbClient;
const BOUND = GENERIC_ADMISSION_BATCH_ROWS * GENERIC_ADMISSION_MAX_BATCHES;

function row(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, kind: 'context', content: `c ${id}`, source: 'ordinary', source_id: id, tags_json: '[]', status: 'stable',
    stale_after: null, verified_json: '[]', sources_json: '[]', generated_by: null, generated_at: null,
    trust_tier: 'unverified', auto_injectable: true, owner_user_id: 7,
    created_at: '2026-10-06T00:00:00.000Z', updated_at: '2026-10-06T00:00:00.000Z', ...over,
  };
}
const hidden = (id: string) => row(id, { tags_json: '["d\\u0061yflow"]' });

beforeEach(() => {
  (env as { dbClient: string }).dbClient = 'postgres';
  queries = 0;
  // Every hosted query ends with `... LIMIT <n> OFFSET <m>` parameters.
  fakeQuery.mockReset().mockImplementation(async (_sql: string, params: unknown[]) => {
    queries += 1;
    const limit = Number(params[params.length - 2]);
    const offset = Number(params[params.length - 1]);
    return { rows: dataset.slice(offset, offset + limit) };
  });
});
afterEach(() => { (env as { dbClient: string }).dbClient = original; });

const repo = new AgentMemoryRepository();
const ids = (rows: Array<{ sourceId: string | null }>) => rows.map((r) => r.sourceId);

describe('hosted generic admission: ordered finite batches', () => {
  it('walks past withheld rows across batches and skips admitted rows by offset exactly', async () => {
    dataset = [
      ...Array.from({ length: GENERIC_ADMISSION_BATCH_ROWS + 5 }, (_, i) => hidden(`h${i}`)),
      row('a1'), row('a2'), row('a3'),
    ];
    expect(ids(await repo.listAsync(7, undefined, 1, { genericAdmissionOnly: true }))).toEqual(['a1']);
    expect(ids(await repo.listAsync(7, undefined, 2, { genericAdmissionOnly: true, offset: 1 }))).toEqual(['a2', 'a3']);
    expect(ids(await repo.listAsync(7, undefined, 5, { genericAdmissionOnly: true, offset: 3 }))).toEqual([]); // exact, exhausted
    expect(await repo.countByKindAsync(7, true, true)).toEqual({ context: 3 });
  });

  it('the raw path keeps one ordinary query and no batching', async () => {
    dataset = [hidden('h1'), row('a1')];
    expect(ids(await repo.listAsync(7, undefined, 10))).toEqual(['h1', 'a1']);
    expect(queries).toBe(1);
  });

  it('search shares the same ordered batching', async () => {
    dataset = [hidden('h1'), hidden('h2'), row('a1')];
    expect(ids(await repo.searchAsync('q', 7, 1, { genericAdmissionOnly: true }))).toEqual(['a1']);
  });

  it('exhausting the bound is an explicit incomplete error for list, count and search — never a short or empty page', async () => {
    dataset = [...Array.from({ length: BOUND }, (_, i) => hidden(`h${i}`)), row('late-admitted')];
    await expect(repo.listAsync(7, undefined, 1, { genericAdmissionOnly: true })).rejects.toBeInstanceOf(GenericAdmissionScanIncompleteError);
    await expect(repo.countByKindAsync(7, true, true)).rejects.toBeInstanceOf(GenericAdmissionScanIncompleteError);
    await expect(repo.searchAsync('q', 7, 1, { genericAdmissionOnly: true })).rejects.toBeInstanceOf(GenericAdmissionScanIncompleteError);
    expect(queries).toBe(GENERIC_ADMISSION_MAX_BATCHES * 3);
  });

  it('a corpus strictly inside the bound is answered exactly (a full final batch cannot prove exhaustion, so exactly-BOUND stays held)', async () => {
    dataset = [...Array.from({ length: BOUND - 2 }, (_, i) => hidden(`h${i}`)), row('last')];
    expect(ids(await repo.listAsync(7, undefined, 1, { genericAdmissionOnly: true }))).toEqual(['last']);
    expect(await repo.countByKindAsync(7, true, true)).toEqual({ context: 1 });
  });
});
