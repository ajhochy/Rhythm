import { describe, expect, it } from 'vitest';
import { defaultRouterGridConfig } from './router_grid_config';
import { gridTierFromScore } from './router_grid_classifier';

describe('Grid default calibration respects the named difficulty levels', () => {
  // Real Decisions scores captured before the fix; do not recompute expected tiers from the thresholds.
  it.each([
    ['formatting', 0.05, 4], ['literal edit', 0.85, 3], ['single-file level', 1, 3],
    ['multi-file feature', 2.01, 2], ['hard architecture', 2.97, 1],
    ['below edit/feature boundary', 1.4999, 3], ['at edit/feature boundary', 1.5, 2],
  ])('%s score %s stays in tier %s', (_name, score, tier) => {
    expect(gridTierFromScore(Number(score), defaultRouterGridConfig().classifier.tier_thresholds)).toBe(tier);
  });
});
