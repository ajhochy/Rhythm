import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import type { AgentMemory } from '../repositories/agent_memory_repository';
import { buildMemoryPreface } from './memory_retrieval';
import { listDecisions } from './decision/decision_log';
import { setRerankClientForTests, type RerankClient, type RerankResult } from './decision/decision_client';

const ENV_KEYS = [
  'AGENT_DECISION_MEMORY_RANKING',
  'AGENT_DECISION_MEMORY_MIN_SCORE',
  'AGENT_MEMORY_RETRIEVAL_MODE',
  'AGENT_MEMORY_LINK_EXPANSION_ENABLED',
  'AGENT_MEMORY_INJECTION_ENABLED',
  'MEMORY_VAULT_PATH',
  'MEMORY_VAULT_SUBDIR',
] as const;
const savedEnv: Record<string, string | undefined> = {};

let db: Database.Database;
let previousDb: Database.Database | null;

function mem(over: Partial<AgentMemory>): AgentMemory {
  return {
    id: 'm-x', kind: 'fact', content: 'some content', source: null, sourceId: null,
    tagsJson: '[]', status: 'stable', staleAfter: null, verifiedJson: '[]', sourcesJson: '[]',
    generatedBy: null, generatedAt: null, trustTier: 'unverified', autoInjectable: true,
    ownerUserId: 1, createdAt: 'x', updatedAt: 'x', ...over,
  };
}

/** Fake reranker: score of a document = first matching rule, else 0.05. Records every call. */
function fakeClient(
  rules: Array<[string, number]>,
  result?: RerankResult,
): RerankClient & { calls: Array<{ query: string; documents: string[] }> } {
  const calls: Array<{ query: string; documents: string[] }> = [];
  return {
    calls,
    async rerank(query, documents) {
      calls.push({ query, documents });
      if (result) return result;
      return {
        status: 'ok',
        latencyMs: 3,
        model: 'fake-reranker',
        scores: documents.map((d) => rules.find(([needle]) => d.includes(needle))?.[1] ?? 0.05),
      };
    },
  };
}

const QUERY = 'when does youth group meets';
// Fresh objects per test: retrieval evidence is a WeakMap keyed by object identity.
let lexical: AgentMemory;
let semantic: AgentMemory;
let weak: AgentMemory;

function setMode(mode?: string): void {
  if (mode) process.env.AGENT_DECISION_MEMORY_RANKING = mode;
  else delete process.env.AGENT_DECISION_MEMORY_RANKING;
}

beforeEach(() => {
  lexical = mem({ id: 'lex', content: 'The youth group meets Sunday evenings at six' });
  semantic = mem({ id: 'sem', content: 'Teenagers gather in the fellowship hall after supper' });
  weak = mem({ id: 'weak', content: 'The youth group budget is reviewed yearly' });
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  delete process.env.AGENT_DECISION_MEMORY_MIN_SCORE;
  delete process.env.AGENT_MEMORY_INJECTION_ENABLED;
  process.env.AGENT_MEMORY_LINK_EXPANSION_ENABLED = 'false';
  process.env.AGENT_MEMORY_RETRIEVAL_MODE = 'fts';
  db = new Database(':memory:');
  runMigrations(db);
  previousDb = setDb(db);
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  setRerankClientForTests(null);
  setDb(previousDb);
  db.close();
});

describe('memory_ranking rerank integration', () => {
  it('off: unchanged lexical behavior, reranker never called, nothing logged', async () => {
    const client = fakeClient([['Teenagers', 0.99]]);
    setRerankClientForTests(client);
    const getRelevant = vi.fn().mockResolvedValue([weak, lexical, semantic]);
    const preface = await buildMemoryPreface(QUERY, 1, { getRelevant });
    expect(client.calls).toHaveLength(0);
    expect(getRelevant).toHaveBeenCalledTimes(1);
    expect(getRelevant).toHaveBeenCalledWith(QUERY, 1, 5);
    expect(preface.memoryIds).toEqual(['lex', 'weak']);
    expect(preface.items.every((i) => i.lane === 'fts')).toBe(true);
    expect(listDecisions({ feature: 'memory_ranking' })).toHaveLength(0);
  });

  it('on: reorders and admits a zero-overlap memory, with rerank provenance', async () => {
    setMode('on');
    const client = fakeClient([['Teenagers', 0.92], ['Sunday evenings', 0.7], ['budget', 0.2]]);
    setRerankClientForTests(client);
    const getRelevant = vi.fn().mockResolvedValue([lexical, semantic, weak]);
    const preface = await buildMemoryPreface(QUERY, 1, { getRelevant, sessionId: 's1' });

    expect(getRelevant).toHaveBeenCalledWith(QUERY, 1, 20); // wider pool
    expect(client.calls).toHaveLength(1); // single batch
    expect(preface.memoryIds).toEqual(['sem', 'lex']);
    expect(preface.items[0]).toMatchObject({ memoryId: 'sem', lane: 'rerank', score: 0.92, confidence: 0.92 });
    expect(preface.items[0].reason).toContain('reranker');
    expect(preface.text).toContain('Teenagers gather');

    const [row] = listDecisions({ feature: 'memory_ranking' });
    expect(row).toMatchObject({
      mode: 'on', status: 'ok', applied: true, chosen: 'sem,lex', baseline: 'lex,weak',
      sessionId: 's1', model: 'fake-reranker', confidence: 0.92,
    });
    expect(row.detail).toMatchObject({ candidates: 3 });
    expect((row.detail.scores as unknown[]).length).toBe(3);
  });

  it('on: rejects candidates below the min score (including all of them)', async () => {
    setMode('on');
    setRerankClientForTests(fakeClient([['Sunday evenings', 0.6]])); // others 0.05
    const some = await buildMemoryPreface(QUERY, 1, { getRelevant: async () => [lexical, semantic, weak] });
    expect(some.memoryIds).toEqual(['lex']);

    process.env.AGENT_DECISION_MEMORY_MIN_SCORE = '0.9';
    const none = await buildMemoryPreface(QUERY, 1, { getRelevant: async () => [lexical, semantic, weak] });
    expect(none.text).toBe('');
    expect(none.memoryIds).toEqual([]);
    const [row] = listDecisions({ feature: 'memory_ranking' });
    expect(row).toMatchObject({ status: 'ok', applied: true, chosen: '' });
  });

  it.each([
    ['timeout', { status: 'timeout', reason: 'slow', latencyMs: 9 } as RerankResult],
    ['error', { status: 'error', reason: 'boom', latencyMs: 1 } as RerankResult],
  ])('on: falls back to lexical behavior on %s', async (status, result) => {
    setMode('on');
    setRerankClientForTests(fakeClient([], result));
    const getRelevant = vi.fn().mockResolvedValue([weak, lexical, semantic]);
    const preface = await buildMemoryPreface(QUERY, 1, { getRelevant });
    expect(preface.memoryIds).toEqual(['lex', 'weak']);
    expect(preface.items.every((i) => i.lane === 'fts')).toBe(true);
    // Preserve the exact lexical/hybrid fallback semantics.
    expect(getRelevant).toHaveBeenCalledWith(QUERY, 1, 20);
    expect(getRelevant).toHaveBeenCalledWith(QUERY, 1, 5);
    const [row] = listDecisions({ feature: 'memory_ranking' });
    expect(row).toMatchObject({ status, applied: false, chosen: null, baseline: 'lex,weak' });
  });

  it('shadow: injects the lexical baseline but logs the rerank choice', async () => {
    setMode('shadow');
    setRerankClientForTests(fakeClient([['Teenagers', 0.95], ['Sunday evenings', 0.8]]));
    const preface = await buildMemoryPreface(QUERY, 1, {
      getRelevant: async () => [lexical, semantic, weak],
    });
    expect(preface.memoryIds).toEqual(['lex', 'weak']);
    expect(preface.items.every((i) => i.lane === 'fts')).toBe(true);
    const [row] = listDecisions({ feature: 'memory_ranking' });
    expect(row).toMatchObject({
      mode: 'shadow', status: 'ok', applied: false, chosen: 'sem,lex', baseline: 'lex,weak', confidence: 0.95,
    });
  });

  it('shadow: reranker failure still returns baseline and logs the status', async () => {
    setMode('shadow');
    setRerankClientForTests(fakeClient([], { status: 'timeout', reason: 'slow', latencyMs: 5 }));
    const preface = await buildMemoryPreface(QUERY, 1, { getRelevant: async () => [lexical] });
    expect(preface.memoryIds).toEqual(['lex']);
    const [row] = listDecisions({ feature: 'memory_ranking' });
    expect(row).toMatchObject({ status: 'timeout', applied: false, baseline: 'lex' });
  });

  it('owner isolation: another user\'s memory never reaches the reranker', async () => {
    setMode('on');
    const client = fakeClient([['Teenagers', 0.9]]);
    setRerankClientForTests(client);
    const secret = mem({ id: 'secret', ownerUserId: 2, content: 'SECRET-OTHER-USER teenagers plan' });
    const stale = mem({ id: 'stale', staleAfter: '2000-01-01', content: 'STALE-NOTE youth group' });
    const global = mem({ id: 'glob', ownerUserId: null, content: 'Global youth group meeting time is posted' });
    await buildMemoryPreface(QUERY, 1, { getRelevant: async () => [secret, stale, semantic, global] });
    const sent = client.calls.flatMap((c) => c.documents).join('\n');
    expect(sent).not.toContain('SECRET-OTHER-USER');
    expect(sent).not.toContain('STALE-NOTE');
    expect(sent).toContain('Teenagers');
    expect(sent).toContain('Global youth group');

    // unresolved owner → only null-owner rows
    client.calls.length = 0;
    await buildMemoryPreface(QUERY, null, { getRelevant: async () => [semantic, global] });
    const sentNull = client.calls.flatMap((c) => c.documents).join('\n');
    expect(sentNull).not.toContain('Teenagers');
    expect(sentNull).toContain('Global youth group');
  });

  it('hybrid pool includes rank-only Engraph hits, still owner-filtered', async () => {
    setMode('on');
    process.env.AGENT_MEMORY_RETRIEVAL_MODE = 'hybrid';
    process.env.MEMORY_VAULT_PATH = '/tmp/rhythm-rerank-test-vault';
    process.env.MEMORY_VAULT_SUBDIR = '';
    const client = fakeClient([['Teenagers', 0.9]]);
    setRerankClientForTests(client);
    const mine = mem({
      id: 'eg-mine', source: 'obsidian-memory', sourceId: 'fact/teens.md',
      content: 'Teenagers gather in the fellowship hall after supper',
    });
    const theirs = mem({
      id: 'eg-theirs', ownerUserId: 2, source: 'obsidian-memory', sourceId: 'fact/other.md',
      content: 'OTHER-USER teenagers note',
    });
    const engraphClient = {
      search: async () => [{ file: 'fact/teens.md', score: 0.03 }, { file: 'fact/other.md', score: 0.02 }],
    };
    const linkRepository = {
      searchAsync: async () => [],
      findBySourceIdsAsync: async () => [mine, theirs],
    };
    const preface = await buildMemoryPreface(QUERY, 1, {
      getRelevant: async () => [],
      engraphClient,
      linkRepository,
    });
    expect(preface.memoryIds).toEqual(['eg-mine']);
    expect(preface.semanticStatus).toBe('used');
    expect(client.calls[0].documents.join('\n')).not.toContain('OTHER-USER');
    const [row] = listDecisions({ feature: 'memory_ranking' });
    expect(row).toMatchObject({ applied: true, chosen: 'eg-mine', baseline: '' });
  });
});
