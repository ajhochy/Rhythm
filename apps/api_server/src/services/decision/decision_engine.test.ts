import { describe, expect, it } from 'vitest';

import type { RerankClient } from './decision_client';
import { classify, rankCandidates } from './decision_engine';

const fixed = (scores: number[]): RerankClient & { calls: string[][] } => {
  const calls: string[][] = [];
  return {
    calls,
    async rerank(_q, docs) {
      calls.push(docs);
      return { status: 'ok', scores, latencyMs: 3, model: 'fake' };
    },
  };
};

describe('rankCandidates', () => {
  it('sorts descending and is stable on ties', async () => {
    const client = fixed([0.5, 0.9, 0.5, 0.1]);
    const r = await rankCandidates('q', [
      { id: 'a', text: 'A' }, { id: 'b', text: 'B' },
      { id: 'c', text: 'C' }, { id: 'd', text: 'D' },
    ], { client });
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.ranked.map((x) => x.id)).toEqual(['b', 'a', 'c', 'd']);
    expect(r).toMatchObject({ latencyMs: 3, model: 'fake' });
  });

  it('returns disabled/empty for blank query or no candidates', async () => {
    const client = fixed([]);
    expect(await rankCandidates('  ', [{ id: 'a', text: 'A' }], { client }))
      .toMatchObject({ status: 'disabled', reason: 'empty' });
    expect(await rankCandidates('q', [], { client }))
      .toMatchObject({ status: 'disabled', reason: 'empty' });
  });

  it('truncates documents and passes failures through', async () => {
    const client = fixed([0.2]);
    await rankCandidates('q', [{ id: 'a', text: 'x'.repeat(50) }], { client, maxChars: 10 });
    expect(client.calls[0][0]).toHaveLength(10);
    const failing: RerankClient = {
      rerank: async () => ({ status: 'timeout', reason: 't', latencyMs: 9 }),
    };
    expect(await rankCandidates('q', [{ id: 'a', text: 'A' }], { client: failing }))
      .toMatchObject({ status: 'timeout' });
  });

  it('never throws when the client throws', async () => {
    const client: RerankClient = { rerank: async () => { throw new Error('x'); } };
    expect((await rankCandidates('q', [{ id: 'a', text: 'A' }], { client })).status).toBe('error');
  });
});

describe('classify', () => {
  it('returns label, confidence, margin and per-label scores', async () => {
    const client = fixed([0.2, 0.8, 0.5]);
    const r = await classify('q', [
      { id: 'cheap', description: 'c' },
      { id: 'standard', description: 's' },
      { id: 'frontier', description: 'f' },
    ], { client });
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.label).toBe('standard');
    expect(r.confidence).toBe(0.8);
    expect(r.margin).toBeCloseTo(0.3, 10);
    expect(r.scores).toEqual({ cheap: 0.2, standard: 0.8, frontier: 0.5 });
  });

  it('propagates failures', async () => {
    const failing: RerankClient = {
      rerank: async () => ({ status: 'error', reason: 'e', latencyMs: 1 }),
    };
    expect((await classify('q', [{ id: 'a', description: 'A' }], { client: failing })).status)
      .toBe('error');
  });
});
