/**
 * Core boundary item 2: exact decoded generic admission decides membership
 * BEFORE list/count/search budgets (SQLite scalar), identical to the JS guard.
 * Real migrated SQLite handle registered through the existing setDb seam.
 */
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { agentMemoryService } from '../services/agentMemoryService';
import { buildMemoryPreface, getRelevantMemories } from '../services/memory_retrieval';
import { isAutomaticMemoryAdmissionAllowed, isGenericMemoryAdmissionAllowed } from '../services/automatic_memory_preface';
import {
  genericAdmissionScalar,
  isGenericMemoryAdmissionAllowedFields,
} from '../utils/generic_memory_admission';

const OWNER = 7;
const repo = new AgentMemoryRepository();
let db: Database.Database;
let previous: ReturnType<typeof setDb>;

beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
  db.pragma('foreign_keys = OFF');
  previous = setDb(db);
});
afterEach(() => { setDb(previous); db.close(); });

interface Row {
  id: string; updatedAt: string; tags?: string; sources?: string; source?: string;
  owner?: number | null; status?: 'stable' | 'deprecated'; kind?: string; content?: string; injectable?: boolean;
}
async function put(row: Row): Promise<void> {
  await repo.upsertBySourceAsync({
    kind: row.kind ?? 'context', content: row.content ?? `shortlistterm ${row.id}`, source: row.source ?? 'ordinary',
    sourceId: row.id, tagsJson: row.tags ?? '[]', sourcesJson: row.sources ?? '[]',
    ownerUserId: row.owner === undefined ? OWNER : row.owner, status: row.status ?? 'stable',
    autoInjectable: row.injectable ?? true, createdAt: row.updatedAt, updatedAt: row.updatedAt,
  });
}

describe('one pure decoded policy', () => {
  const allowed = (f: Parameters<typeof isGenericMemoryAdmissionAllowedFields>[0]) => isGenericMemoryAdmissionAllowedFields(f);
  it('withholds decoded values, nested values, root strings, duplicate-key winners and malformed literals', () => {
    expect(allowed({ tagsJson: '["d\\u0061yflow"]' })).toBe(false); // escaped
    expect(allowed({ tagsJson: '[["x",{"a":[{"b":"Source:DAYFLOW"}]}]]' })).toBe(false); // nested
    expect(allowed({ sourcesJson: '"dayflow"' })).toBe(false); // root string
    expect(allowed({ tagsJson: '{"a":"x","a":"dayflow"}' })).toBe(false); // duplicate key: last wins
    expect(allowed({ tagsJson: '{not-dayflow' })).toBe(false); // malformed literal
    expect(allowed({ source: 'DayFlow-qualified-index' })).toBe(false);
  });
  it('admits key-only markers, overwritten duplicate keys, malformed without a marker, null and numbers', () => {
    expect(allowed({ tagsJson: '{"dayflow":"ordinary"}' })).toBe(true); // keys are not values
    expect(allowed({ tagsJson: '{"a":"dayflow","a":"x"}' })).toBe(true); // duplicate key: last wins
    expect(allowed({ tagsJson: '{not json' })).toBe(true);
    expect(allowed({ tagsJson: 'null', sourcesJson: '[1,2,null,true]' })).toBe(true);
    expect(allowed({ source: null, tagsJson: null, sourcesJson: undefined })).toBe(true);
  });
  it('the SQLite scalar and the JS guard are the same decision', () => {
    for (const fields of [
      { source: 'ordinary', tagsJson: '["d\\u0061yflow"]' }, { tagsJson: '{"dayflow":"x"}' }, { sourcesJson: '[{"label":"DAYFLOW"}]' },
      { tagsJson: '{bad-dayflow' }, { tagsJson: '[]', sourcesJson: '[]' },
    ]) {
      expect(genericAdmissionScalar(fields.source, fields.tagsJson, fields.sourcesJson)).toBe(allowed(fields) ? 1 : 0);
    }
  });
  it('is registered on the handle handed to setDb', () => {
    expect(db.prepare(`SELECT rhythm_generic_memory_admitted('ordinary','[]','[]') AS ok`).get()).toEqual({ ok: 1 });
  });
});

describe('admission before page/count/search budgets (SQLite)', () => {
  async function seed(): Promise<void> {
    // Newest first: every withheld shape, so a post-limit filter would starve the page.
    await put({ id: 'w-escaped', updatedAt: '2026-10-06T10:00:09Z', tags: '["d\\u0061yflow"]' });
    await put({ id: 'w-nested', updatedAt: '2026-10-06T10:00:08Z', sources: '[{"a":[{"label":"Dayflow"}]}]' });
    await put({ id: 'w-root', updatedAt: '2026-10-06T10:00:07Z', tags: '"dayflow"' });
    await put({ id: 'w-dup', updatedAt: '2026-10-06T10:00:06Z', tags: '{"a":"x","a":"dayflow"}' });
    await put({ id: 'w-malformed', updatedAt: '2026-10-06T10:00:05Z', tags: '{bad-dayflow' });
    await put({ id: 'w-source', updatedAt: '2026-10-06T10:00:04Z', source: 'dayflow-index' });
    await put({ id: 'ok-key-only', updatedAt: '2026-10-06T09:00:09Z', tags: '{"dayflow":"ordinary"}' });
    await put({ id: 'ok-dup', updatedAt: '2026-10-06T09:00:08Z', tags: '{"a":"dayflow","a":"x"}' });
    await put({ id: 'ok-global', updatedAt: '2026-10-06T09:00:07Z', owner: null, kind: 'decision' });
    await put({ id: 'ok-old', updatedAt: '2026-10-06T09:00:06Z', status: 'deprecated' });
    await put({ id: 'ok-plain', updatedAt: '2026-10-06T09:00:05Z' });
    await put({ id: 'foreign', updatedAt: '2026-10-06T11:00:00Z', owner: 99 });
  }
  const ids = (rows: Array<{ sourceId: string | null }>) => rows.map((r) => r.sourceId);

  it('pages the admitted collection exactly: no starvation, gaps, repeats or inflated count', async () => {
    await seed();
    const pages: Array<Array<string | null>> = [];
    for (const offset of [0, 2, 4, 6]) pages.push(ids(await agentMemoryService.list(OWNER, undefined, 2, { offset })));
    expect(pages).toEqual([['ok-key-only', 'ok-dup'], ['ok-global', 'ok-plain'], ['ok-old'], []]);
    // Deprecated sorts last (existing order), owner/global preserved, foreign excluded.
    const counts = await agentMemoryService.countByKind(OWNER);
    expect(counts).toEqual({ context: 4, decision: 1 });
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(pages.flat().length);
    // Lifecycle and kind filters share the same admitted base.
    expect(await agentMemoryService.countByKind(OWNER, false)).toEqual({ context: 3, decision: 1 });
    expect(ids(await agentMemoryService.list(OWNER, 'decision', 5))).toEqual(['ok-global']);
    expect(ids(await agentMemoryService.list(OWNER, undefined, 5, { includeDeprecated: false }))).toEqual(['ok-key-only', 'ok-dup', 'ok-global', 'ok-plain']);
  });

  it('SQL membership equals the JS guard for every stored row (final guard is defense only)', async () => {
    await seed();
    const raw = await repo.listAsync(OWNER, undefined, 100);
    const viaSql = new Set(ids(await repo.listAsync(OWNER, undefined, 100, { genericAdmissionOnly: true })));
    for (const memory of raw) {
      expect(viaSql.has(memory.sourceId), memory.sourceId ?? '').toBe(isGenericMemoryAdmissionAllowed(memory));
    }
    // Raw qualified reads still see everything.
    expect(raw.length).toBe(11);
    expect(await repo.countByKindAsync(OWNER)).toEqual({ context: 10, decision: 1 });
  });

  it('search budget: better-ranked withheld candidates cannot consume the shortlist', async () => {
    await seed();
    for (const id of ['w-escaped', 'w-nested', 'w-root']) {
      db.prepare(`UPDATE agent_memory SET content='shortlistterm shortlistterm shortlistterm shortlistterm' WHERE source_id=?`).run(id);
    }
    expect(ids(await agentMemoryService.search('shortlistterm', OWNER, 1)).every((id) => id?.startsWith('ok-'))).toBe(true);
    expect((await agentMemoryService.search('shortlistterm', OWNER, 1))).toHaveLength(1);
    // The raw search path (qualified readers) keeps the better-ranked rows.
    expect(ids(await repo.searchAsync('shortlistterm', OWNER, 1))[0]).toMatch(/^w-/);
  });
});

describe('automatic retrieval applies generic admission before its shortlist', () => {
  async function seed(): Promise<void> {
    await put({ id: 'w-escaped', updatedAt: '2026-10-06T10:00:09Z', tags: '["d\\u0061yflow"]', content: 'shortlistterm shortlistterm shortlistterm shortlistterm' });
    await put({ id: 'ok-plain', updatedAt: '2026-10-06T09:00:05Z', content: 'shortlistterm ordinary fact' });
  }

  it('lexical lane: the explicit flag reaches searchAsync; without it the withheld row wins the slot', async () => {
    await seed();
    expect((await getRelevantMemories('shortlistterm', OWNER, 1)).map((m) => m.sourceId)).toEqual(['w-escaped']);
    expect((await getRelevantMemories('shortlistterm', OWNER, 1, undefined, true)).map((m) => m.sourceId)).toEqual(['ok-plain']);
  });

  it('buildMemoryPreface with the automatic generic option releases the ordinary row and never the withheld one', async () => {
    await seed();
    const preface = await buildMemoryPreface('shortlistterm ordinary fact', OWNER, {
      enabled: true, topN: 1, genericAdmission: true, automaticAdmission: isAutomaticMemoryAdmissionAllowed,
    });
    expect(preface.notePaths).toEqual(['ok-plain']);
    expect(JSON.stringify(preface)).not.toContain('w-escaped');
  });

  it('the injected explicit retriever and a withheld-only corpus fail safe to an empty preface', async () => {
    await put({ id: 'w-only', updatedAt: '2026-10-06T10:00:09Z', tags: '["d\\u0061yflow"]' });
    const preface = await buildMemoryPreface('shortlistterm', OWNER, {
      enabled: true, genericAdmission: true, automaticAdmission: isAutomaticMemoryAdmissionAllowed,
    });
    expect(preface.memoryIds).toEqual([]);
  });
});
