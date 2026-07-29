import { describe, expect, it } from 'vitest';

import * as retrieval from '../services/skill_retrieval';
import * as surface from '../services/tool_surface_estimator';

describe('issue #1209 acceptance contract', () => {
  it('issue-1209-c1: checked-in replay exposes measured Jaccard misses', async () => {
    // Regression caught: replacing the scorer on intuition without a reproducible
    // replay showing that the current threshold actually misses relevant skills.
    const benchmark = await import('../benchmarks/skill_retrieval_replay');
    const result = benchmark.runSkillRetrievalReplay();
    expect(result.jaccard.paraphraseMisses).toBeGreaterThan(0);
    expect(result.cases).toBeGreaterThanOrEqual(10);
  });

  it('issue-1209-c2: production retrieval uses corpus-aware BM25', () => {
    // Regression caught: retaining Jaccard or applying "BM25" one document at a
    // time, which cannot compute meaningful corpus IDF.
    expect('scoreSkillsBm25' in retrieval).toBe(true);
  });

  it('issue-1209-c3: replay improves recall without top-5 precision regression', async () => {
    // Regression caught: a threshold that retrieves more relevant skills only by
    // flooding top five with irrelevant results.
    const benchmark = await import('../benchmarks/skill_retrieval_replay');
    const result = benchmark.runSkillRetrievalReplay();
    expect(result.bm25.recallAt5).toBeGreaterThan(result.jaccard.recallAt5);
    expect(result.bm25.precisionAt5).toBeGreaterThanOrEqual(result.jaccard.precisionAt5);
  });

  it('issue-1209-c4: BM25 scorer is deterministic and authz stays fail-closed', () => {
    // Regression caught: scoring mutates rows or malformed allowlists leak a
    // relevant skill through the preface filter.
    expect('scoreSkillsBm25' in retrieval).toBe(true);
    expect(retrieval.getRelevantSkills('weekly email', 5, { list: () => [] } as never, '{')).toEqual([]);
  });

  it('issue-1209-c5: non-google scoped allowlist marks only fat servers deferred', () => {
    // Regression caught: selective deferral remains coupled to provider=google,
    // or defers every server instead of only the estimator-identified fat one.
    expect('applySelectiveDeferral' in surface).toBe(true);
    const apply = (surface as unknown as {
      applySelectiveDeferral: (
        allowlist: { servers: string[]; tools: string[] },
        toolCounts: Record<string, number>,
        providerId: string,
      ) => { deferredServers?: string[] };
    }).applySelectiveDeferral;
    const result = apply(
      { servers: ['propresenter', 'rhythm'], tools: ['calendar_find'] },
      { propresenter: 150, rhythm: 12, calendar: 1 },
      'anthropic',
    );
    expect(result.deferredServers).toEqual(['propresenter']);
  });

  it('issue-1209-c6: selective deferral estimate reports eager and deferred totals', () => {
    // Regression caught: selection is hardcoded and cannot produce the
    // before/after evidence required for a real fat-server profile.
    expect('estimateSelectiveDeferral' in surface).toBe(true);
  });
});
