import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { scoreSkillsBm25 } from './skill_retrieval';
import { scoreDocsBm25 } from './bm25';

describe('scoreDocsBm25', () => {
  it('scores document strings with the existing deduped-token BM25 semantics', () => {
    // Regression: changing tokenization or BM25 normalization alters skill rankings.
    const scores = scoreDocsBm25('Alpha, beta!', [
      'Alpha, beta! alpha',
      'beta gamma',
      'zeta',
    ]);

    expect(scores).toHaveLength(3);
    expect(scores[0]).toBeCloseTo(1.3411060256161416, 12);
    expect(scores[1]).toBeCloseTo(0.43445713627757077, 12);
    expect(scores[2]).toBe(0);
  });

  it('returns aligned zeros for empty or tokenless queries and an empty corpus', () => {
    // Regression: empty input returns unaligned output or scores punctuation as terms.
    expect(scoreDocsBm25('   ! ', ['alpha', 'beta'])).toEqual([0, 0]);
    expect(scoreDocsBm25('alpha', [])).toEqual([]);
  });

  it('keeps the skill scorer as a compatibility wrapper over the shared scorer', () => {
    // Regression: a second scorer drifts from the generic BM25 implementation.
    const skill = {
      title: 'Weekly report',
      description: 'Build the weekly report',
      whenToUse: null,
      tags: ['weekly', 'report'],
      steps: ['Gather notes'],
    } as Parameters<typeof scoreSkillsBm25>[1][number];
    const document = 'Weekly report Build the weekly report  weekly report Gather notes';

    const skillScores = scoreSkillsBm25('weekly report', [skill]);
    expect(skillScores).toEqual(scoreDocsBm25('weekly report', [document]));
    expect(skillScores[0]).toBeCloseTo(0.5753641449035617, 12);
  });

  it('contains no second BM25 formula in skill retrieval', () => {
    // Regression: duplicated formula lets task and skill scoring diverge.
    const source = readFileSync(resolve(__dirname, 'skill_retrieval.ts'), 'utf8');

    expect(source).not.toContain('const BM25_K1');
    expect(source).not.toContain('Math.log(\n        1 + (documents.length - documentFrequency');
  });
});
